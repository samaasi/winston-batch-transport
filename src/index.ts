import zlib from "zlib";
import fs from "fs/promises";
import { promisify } from "util";
import TransportStream from "winston-transport";
import axios, { AxiosRequestConfig } from "axios";

const gzip = promisify(zlib.gzip);

interface LogEntry {
    level: string;
    message: string;
    timestamp: string;
}

interface BatchTransportOptions extends TransportStream.TransportStreamOptions {
    batchSize: number;
    flushInterval: number;
    apiUrl: string;
    apiKey?: string;
    retryLimit?: number;
    backoffFactor?: number;
    backupFilePath?: string;
    requestTimeout?: number;
    maxConcurrentBatches?: number;
    useCompression?: boolean;
    initialized?: boolean;
    retryInterval?: number;
}

class BatchTransport extends TransportStream {
    private logQueue: LogEntry[] = [];
    private retryQueue: LogEntry[] = [];
    private readonly batchSize: number;
    private readonly flushInterval: number;
    private readonly apiUrl: string;
    private readonly retryLimit: number;
    private readonly backoffFactor: number;
    private readonly backupFilePath: string;
    private readonly requestTimeout: number;
    private readonly maxConcurrentBatches: number;
    private readonly useCompression: boolean;
    private readonly apiKey?: string;
    private readonly retryInterval: number;
    private flushTimer: NodeJS.Timeout | null = null;
    private retryTimer: NodeJS.Timeout | null = null;
    private activeBatches: number = 0;
    private initialized: boolean;
    private backupWriteInProgress: boolean = false;

    constructor(opts: BatchTransportOptions) {
        super(opts);
        this.batchSize = opts.batchSize;
        this.flushInterval = opts.flushInterval;
        this.apiUrl = opts.apiUrl;
        this.apiKey = opts.apiKey;
        this.retryLimit = opts.retryLimit || 3;
        this.backoffFactor = opts.backoffFactor || 1000;
        this.backupFilePath = opts.backupFilePath || "./unsent-logs.json";
        this.requestTimeout = opts.requestTimeout || 5000;
        this.maxConcurrentBatches = opts.maxConcurrentBatches || 3;
        this.useCompression = opts.useCompression || false;
        this.initialized = opts.initialized || false;
        this.retryInterval = opts.retryInterval || 10000; 
    }

    public async init() {
        if (!this.initialized) {
            await this.loadBackupLogs();
            this.initialized = true;
            this.startFlushTimer();
            this.startRetryTimer();
        }
    }

    log(info: any, callback: () => void) {
        const logEntry: LogEntry = {
            level: info.level,
            message: info.message,
            timestamp: new Date().toISOString(),
        };

        this.logQueue.push(logEntry);

        if (this.initialized && this.logQueue.length >= this.batchSize) {
            this.flushLogs();
        }

        callback();
    }

    private startFlushTimer() {
        this.flushTimer = setInterval(() => this.flushLogs(), this.flushInterval);
    }

    private startRetryTimer() {
        this.retryTimer = setInterval(() => this.retryFailedLogs(), this.retryInterval);
    }

    private validateLog(log: LogEntry): boolean {
        return (
            typeof log.level === 'string' &&
            typeof log.message === 'string' &&
            typeof log.timestamp === 'string' &&
            new Date(log.timestamp).toString() !== 'Invalid Date'
        );
    }

    private sanitizeLog(log: LogEntry): LogEntry {
        return {
            level: String(log.level).slice(0, 32),
            message: String(log.message).slice(0, 32768),
            timestamp: new Date(log.timestamp).toISOString()
        };
    }

    private async flushLogs() {
        if (this.logQueue.length === 0 || this.activeBatches >= this.maxConcurrentBatches) return;

        const batchSize = Math.min(this.batchSize, this.logQueue.length);
        const logsToSend = this.logQueue.splice(0, batchSize);

        const validatedLogs = logsToSend
            .filter(log => this.validateLog(log))
            .map(log => this.sanitizeLog(log));

        if (validatedLogs.length === 0) return;

        this.activeBatches++;
        try {
            await this.sendLogs(validatedLogs);
        } catch (error: any) {
            if (error.message.startsWith("Unauthorized") || error.message.startsWith("Forbidden") || error.message.startsWith("Permanent error")) {
                for (const log of validatedLogs) {
                    await this.backupFailedLog(log);
                }
            } else {
                this.retryQueue.push(...validatedLogs);
            }
        } finally {
            this.activeBatches--;
        }
    }

    private async sendLogs(logs: LogEntry[]) {
        let payload: any = logs;
        let headers: Record<string, string> = { "Content-Type": "application/json" };

        if (this.apiKey) {
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        }

        if (this.useCompression) {
            const compressedData = await gzip(JSON.stringify(logs));
            payload = compressedData as any;
            headers["Content-Type"] = "application/octet-stream";
            headers["Content-Encoding"] = "gzip";
        }

        const requestConfig: AxiosRequestConfig = {
            headers,
        };

        if (process.env.NODE_ENV !== 'test') {
            requestConfig.timeout = this.requestTimeout;
        }

        try {
            await axios.post(this.apiUrl, payload, requestConfig);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    throw new Error("Unauthorized: Invalid or missing API key");
                } else if (error.response?.status === 403) {
                    throw new Error("Forbidden: Insufficient permissions with provided API key");
                } else if (error.response?.status === 400 || error.response?.status === 404) {
                   throw new Error(`Permanent error: ${error.response.status} - ${error.message}`);
                }
            }
            throw error;
        }
    }

     private async retryFailedLogs() {
         if (this.retryQueue.length === 0) return;

         const logsToRetry = [...this.retryQueue];
         this.retryQueue = [];

         const batchSize = this.batchSize;
         for (let i = 0; i < logsToRetry.length; i += batchSize) {
             const batch = logsToRetry.slice(i, i + batchSize);
             let success = false;
             for (let attempt = 0; attempt < this.retryLimit; attempt++) {
                 try {
                     const backoff = this.backoffFactor * Math.pow(2, attempt);
                     await new Promise((resolve) => setTimeout(resolve, backoff));
                     await this.sendLogs(batch);
                     success = true;
                     break;
                 } catch (error: any) {
                     if (error.message.startsWith("Unauthorized") || error.message.startsWith("Forbidden") || error.message.startsWith("Permanent error")) {
                         for (const log of batch) {
                             await this.backupFailedLog(log);
                         }
                         success = true;
                         break;
                     }
                 }
             }
             if (!success) {
                 for (const log of batch) {
                     await this.backupFailedLog(log);
                 }
             }
         }
     }

     private async backupFailedLog(log: LogEntry) {
         try {
             if (this.backupWriteInProgress) {
                 this.retryQueue.push(log);
                 return;
             }
             this.backupWriteInProgress = true;
             const existingLogs = await this.loadBackupLogsFromFile();
             existingLogs.push(log);
             await fs.writeFile(this.backupFilePath, JSON.stringify(existingLogs, null, 2));
         } catch (error) {
             this.emit('error', error);
         } finally {
             this.backupWriteInProgress = false;
         }
     }

    private async loadBackupLogs() {
        const backupLogs = await this.loadBackupLogsFromFile();
        if (backupLogs.length > 0) {
            this.logQueue.push(...backupLogs);
            
            await fs.writeFile(this.backupFilePath, JSON.stringify([], null, 2));
        }
    }

    public async loadBackupLogsFromFile(): Promise<LogEntry[]> {
        try {
            const data = await fs.readFile(this.backupFilePath, "utf-8");
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    public async close() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
        }

        while (this.activeBatches > 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        await this.flushLogs();
        await this.retryFailedLogs();
    }
}

export default BatchTransport;