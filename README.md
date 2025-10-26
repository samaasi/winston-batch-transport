# Winston Batch Transport

![build](https://github.com/samaasi/winston-batch-transport/actions/workflows/build.yml/badge.svg)
[![npm version](https://badge.fury.io/js/winston-batch-transport.svg)](https://badge.fury.io/js/winston-batch-transport)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)


A robust Winston transport that batches logs and sends them to a specified API endpoint with support for retries, compression, and concurrent batch processing.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration Options](#configuration-options)
- [Advanced Usage](#advanced-usage)
- [API Reference](#api-reference)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

- Batch log processing with a configurable batch size
- Automatic retry mechanism with exponential backoff
- Concurrent batch processing support
- Compression support for reduced network bandwidth
- Local backup for failed log entries
- Configurable request timeouts
- Log validation and sanitization

## Installation

```bash
npm install winston-batch-transport
# or
yarn add winston-batch-transport
# or
pnpm add winston-batch-transport
```

## Quick Start

```typescript
import winston from 'winston';
import BatchTransport from 'winston-batch-transport';

const logger = winston.createLogger({
  transports: [
    new BatchTransport({
      batchSize: 100,
      flushInterval: 5000,
      apiUrl: 'https://your-logging-api.com/logs'
    })
  ]
});

logger.info('Hello, World!');
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `batchSize` | `number` | Required | Maximum number of logs to batch before sending |
| `flushInterval` | `number` | Required | Interval in milliseconds to flush logs regardless of batch size |
| `apiUrl` | `string` | Required | The endpoint where logs will be sent |
| `apiKey` | `string` | Optional | API key for authentication (sent as Bearer token) |
| `retryLimit` | `number` | 3 | Maximum number of retry attempts for failed requests |
| `backoffFactor` | `number` | 1000 | Base milliseconds for exponential backoff between retries |
| `backupFilePath` | `string` | './unsent-logs.json' | Path to store logs that failed to send after all retries |
| `requestTimeout` | `number` | 5000 | Timeout in milliseconds for API requests |
| `maxConcurrentBatches` | `number` | 3 | Maximum number of batches that can be sent simultaneously |
| `useCompression` | `boolean` | false | Enable gzip compression for log batches |

## Advanced Usage

### With Compression

```typescript
const transport = new BatchTransport({
  batchSize: 100,
  flushInterval: 5000,
  apiUrl: 'https://your-logging-api.com/logs',
  useCompression: true
});
```

### With API Key Authentication

```typescript
const transport = new BatchTransport({
  batchSize: 100,
  flushInterval: 5000,
  apiUrl: 'https://your-logging-api.com/logs',
  apiKey: 'your-api-key-here'
});
```

### With Custom Retry Settings

```typescript
const transport = new BatchTransport({
  batchSize: 100,
  flushInterval: 5000,
  apiUrl: 'https://your-logging-api.com/logs',
  retryLimit: 5,
  backoffFactor: 2000
});
```

### With Concurrent Batch Processing

```typescript
const transport = new BatchTransport({
  batchSize: 100,
  flushInterval: 5000,
  apiUrl: 'https://your-logging-api.com/logs',
  maxConcurrentBatches: 5
});
```

## API Reference

### Log Format

Each log entry follows this structure:

```typescript
interface LogEntry {
  level: string;      // Log level (e.g., 'info', 'error')
  message: string;    // Log message
  timestamp: string;  // ISO 8601 timestamp
}
```

### Methods

#### `constructor(opts: BatchTransportOptions)`
Initializes a new BatchTransport instance with the specified options. Note that asynchronous initialization is handled by the `init` method.

#### `init(): Promise<void>`
Asynchronously initializes the transport, loading any backed-up logs. This method must be called after the constructor.

**Example Usage:**

```typescript
const transport = new BatchTransport({
  batchSize: 100,
  flushInterval: 5000,
  apiUrl: 'https://your-logging-api.com/logs'
});

async function initialize() {
  await transport.init();
  console.log('Batch transport initialized.');
}

initialize();
```

#### `log(info: any, callback: () => void)`
Adds a log entry to the queue. Called internally by Winston.

#### `close(): Promise<void>`
Asynchronously cleans up resources and ensures all pending logs are processed before shutdown.

**Example Usage:**

```typescript
// In your application shutdown logic
process.on('beforeExit', async () => {
  console.log('Application is shutting down. Flushing remaining logs...');
  await batchTransportInstance.close();
  console.log('All logs flushed. Goodbye!');
});
```

## Error Handling

The transport handles errors in multiple ways:

1. **Retry Mechanism**: Failed requests are retried with exponential backoff
2. **Backup Storage**: Logs that fail after all retries are stored locally
3. **Validation**: Logs are validated and sanitized before sending

## Best Practices

1. **Batch Size**: Choose a batch size that balances between latency and throughput
2. **Flush Interval**: Set based on your application's log volume and latency requirements
3. **Compression**: Enable for large log volumes or bandwidth-constrained environments
4. **Concurrent Batches**: Adjust based on your API endpoint's capacity

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Reduce batch size
   - Decrease flush interval
   - Enable compression

2. **Lost Logs**
   - Check backup file location
   - Increase retry limit
   - Verify API endpoint stability

3. **Poor Performance**
   - Adjust concurrent batches
   - Optimize batch size
   - Enable compression

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTE.md) for more details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.