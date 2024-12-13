import axios from "axios";
import fs from "fs/promises";
import TransportStream from "winston-transport";

interface LogEntry {
    level: string;
    message: string;
    timestamp: string;
}

interface BatchTransportOptions extends TransportStream.TransportStreamOptions {
    batchSize: number;
    flushInterval: number;
    apiUrl: string;
    retryLimit?: number;
    backoffFactor?: number;
    backupFilePath?: string;
}

class BatchTransport extends TransportStream {
    public logQueue: LogEntry[] = [];
    private retryQueue: LogEntry[] = [];
    private readonly batchSize: number;
    private readonly flushInterval: number;
    private readonly apiUrl: string;
    private readonly retryLimit: number;
    private readonly backoffFactor: number;
    private readonly backupFilePath: string;
    private flushTimer: NodeJS.Timeout | null = null;

    constructor(opts: BatchTransportOptions) {
        super(opts);
        this.batchSize = opts.batchSize;
        this.flushInterval = opts.flushInterval;
        this.apiUrl = opts.apiUrl;
        this.retryLimit = opts.retryLimit || 3;
        this.backoffFactor = opts.backoffFactor || 1000;
        this.backupFilePath = opts.backupFilePath || "./unsent-logs.json";

        this.startFlushTimer();
        this.loadBackupLogs();
    }

    log(info: any, callback: () => void) {
        const logEntry: LogEntry = {
            level: info.level,
            message: info.message,
            timestamp: new Date().toISOString(),
        };

        this.logQueue.push(logEntry);

        if (this.logQueue.length >= this.batchSize) {
            this.flushLogs();
        }

        callback();
    }

    private startFlushTimer() {
        this.flushTimer = setInterval(() => this.flushLogs(), this.flushInterval);
    }

    private async flushLogs() {
        if (this.logQueue.length === 0) return;

        const logsToSend = [...this.logQueue];
        this.logQueue = [];

        try {
            await this.sendLogs(logsToSend);
        } catch (error) {
            this.retryQueue.push(...logsToSend);
        }
    }

    private async sendLogs(logs: LogEntry[]) {
        await axios.post(this.apiUrl, logs, { headers: { "Content-Type": "application/json" } });
    }

    private async retryFailedLogs() {
        if (this.retryQueue.length === 0) return;

        const logsToRetry = [...this.retryQueue];
        this.retryQueue = [];

        for (const log of logsToRetry) {
            let success = false;
            for (let attempt = 0; attempt < this.retryLimit; attempt++) {
                try {
                    const backoff = this.backoffFactor * Math.pow(2, attempt);
                    await new Promise((resolve) => setTimeout(resolve, backoff));
                    await this.sendLogs([log]);
                    success = true;
                    break;
                } catch (error) {}
            }
            if (!success) {
                await this.backupFailedLog(log);
            }
        }
    }

    private async backupFailedLog(log: LogEntry) {
        const existingLogs = await this.loadBackupLogsFromFile();
        existingLogs.push(log);
        await fs.writeFile(this.backupFilePath, JSON.stringify(existingLogs, null, 2));
    }

    private async loadBackupLogs() {
        const backupLogs = await this.loadBackupLogsFromFile();
        this.logQueue.push(...backupLogs);
        await fs.writeFile(this.backupFilePath, JSON.stringify([]));
    }

    public async loadBackupLogsFromFile(): Promise<LogEntry[]> {
        try {
            const data = await fs.readFile(this.backupFilePath, "utf-8");
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    close() {
        if (this.flushTimer) clearInterval(this.flushTimer);
        this.flushLogs();
        this.retryFailedLogs();
    }
}

export default BatchTransport;