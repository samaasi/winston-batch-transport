import axios from "axios";
import fs from "fs/promises";
import winston from "winston";
import BatchTransport from "../index";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("BatchTransport", () => {
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

    it("should backup failed logs", async () => {
        mockedAxios.post.mockRejectedValue(new Error("Network Error"));

        const transport = new BatchTransport({
            batchSize: 1,
            flushInterval: 5000,
            apiUrl: "https://example.com/api/logs",
        });

        const logger = winston.createLogger({
            transports: [transport],
        });

        logger.info("Backup log");

        await new Promise((resolve) => setTimeout(resolve, 100));

        const backupLogs = await transport.loadBackupLogsFromFile();
        expect(backupLogs).toEqual([
            expect.objectContaining({ message: "Backup log" }),
        ]);
    });

    it("should load backup logs on initialization", async () => {
        const backupLog = { level: "info", message: "Backup log", timestamp: new Date().toISOString() };
        await fs.writeFile("./unsent-logs.json", JSON.stringify([backupLog]));

        const transport = new BatchTransport({
            batchSize: 1,
            flushInterval: 5000,
            apiUrl: "https://example.com/api/logs",
        });

        expect(transport.logQueue).toEqual([backupLog]);
    });

    it("should clear backup logs after loading", async () => {
        const backupLog = { level: "info", message: "Backup log", timestamp: new Date().toISOString() };
        await fs.writeFile("./unsent-logs.json", JSON.stringify([backupLog]));

        const transport = new BatchTransport({
            batchSize: 1,
            flushInterval: 5000,
            apiUrl: "https://example.com/api/logs",
        });

        const backupLogs = await transport.loadBackupLogsFromFile();
        expect(backupLogs).toEqual([]);

        const fileContent = await fs.readFile("./unsent-logs.json", "utf-8");
        expect(JSON.parse(fileContent)).toEqual([]);
    });

    it("should handle empty backup file gracefully", async () => {
        await fs.writeFile("./unsent-logs.json", "");

        const transport = new BatchTransport({
            batchSize: 1,
            flushInterval: 5000,
            apiUrl: "https://example.com/api/logs",
        });

        expect(transport.logQueue).toEqual([]);
    });
});