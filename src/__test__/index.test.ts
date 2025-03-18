import axios from "axios";
import winston from "winston";
import BatchTransport from "../index";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("BatchTransport", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should not flush logs if batch size is not reached", async () => {
        mockedAxios.post.mockResolvedValue({ status: 200 });

        const transport = new BatchTransport({
            batchSize: 3,
            flushInterval: 5000,
            apiUrl: "https://example.com/api/logs",
        });

        const logger = winston.createLogger({
            transports: [transport],
        });

        logger.info("Test log 1");
        logger.info("Test log 2");

        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("should send logs with API key authentication", async () => {
        mockedAxios.post.mockResolvedValue({ status: 200 });

        const transport = new BatchTransport({
            batchSize: 1,
            flushInterval: 5000,
            apiUrl: "https://example.com/api/logs",
            apiKey: "test-api-key"
        });

        const logger = winston.createLogger({
            transports: [transport],
        });

        logger.info("Test log with API key");

        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockedAxios.post).toHaveBeenCalledWith(
            "https://example.com/api/logs",
            expect.any(Array),
            expect.objectContaining({
                headers: expect.objectContaining({
                    "Authorization": "Bearer test-api-key"
                })
            })
        );
    });

    it("should handle compression when enabled", async () => {
        mockedAxios.post.mockResolvedValue({ status: 200 });

        const transport = new BatchTransport({
            batchSize: 1,
            flushInterval: 5000,
            apiUrl: "https://example.com/api/logs",
            useCompression: true
        });

        const logger = winston.createLogger({
            transports: [transport],
        });

        logger.info("Test compressed log");

        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockedAxios.post).toHaveBeenCalledWith(
            "https://example.com/api/logs",
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    "Content-Encoding": "gzip"
                })
            })
        );
    });

    it("should handle concurrent batch processing", async () => {
        mockedAxios.post.mockResolvedValue({ status: 200 });

        const transport = new BatchTransport({
            batchSize: 2,
            flushInterval: 5000,
            apiUrl: "https://example.com/api/logs",
            maxConcurrentBatches: 2
        });

        const logger = winston.createLogger({
            transports: [transport],
        });

        logger.info("Concurrent log 1");
        logger.info("Concurrent log 2");
        logger.info("Concurrent log 3");
        logger.info("Concurrent log 4");

        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it("should handle request timeout and store logs in backup", async () => {
        mockedAxios.post.mockRejectedValue(new Error("timeout"));

        const transport = new BatchTransport({
            batchSize: 1,
            flushInterval: 5000,
            apiUrl: "https://example.com/api/logs",
            requestTimeout: 1000
        });

        const logger = winston.createLogger({
            transports: [transport],
        });

        logger.info("Timeout test log");

        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockedAxios.post).toHaveBeenCalledWith(
            "https://example.com/api/logs",
            expect.any(Array),
            expect.objectContaining({
                timeout: 1000
            })
        );

        const backupLogs = await transport.loadBackupLogsFromFile();
        expect(backupLogs).toEqual([
            expect.objectContaining({ message: "Timeout test log" })
        ]);
    });

    it("should validate and sanitize logs with circular references", async () => {
        mockedAxios.post.mockResolvedValue({ status: 200 });

        const transport = new BatchTransport({
            batchSize: 1,
            flushInterval: 5000,
            apiUrl: "https://example.com/api/logs"
        });

        const logger = winston.createLogger({
            transports: [transport],
        });

        const circularRef: any = {};
        circularRef.self = circularRef;

        logger.info("Test log", { circular: circularRef });

        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockedAxios.post).toHaveBeenCalledWith(
            "https://example.com/api/logs",
            expect.arrayContaining([
                expect.not.objectContaining({
                    meta: expect.objectContaining({
                        circular: expect.any(Object)
                    })
                })
            ])
        );
    });
});
