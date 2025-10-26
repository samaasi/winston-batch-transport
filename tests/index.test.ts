import axios from 'axios';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import BatchTransport from '../src/index';

jest.mock('axios', () => ({
  post: jest.fn(),
}));
const mockedAxios = axios as jest.Mocked<typeof axios>;
(mockedAxios as any).isAxiosError = (err: any) => err.isAxiosError === true;

let mockFileContent: any[] = [];
jest.mock("fs/promises", () => ({
  writeFile: jest.fn(async (path, content) => {
    mockFileContent = JSON.parse(content as string);
    return Promise.resolve();
  }),
  readFile: jest.fn(async (path) => {
    return Promise.resolve(JSON.stringify(mockFileContent));
  }),
}));
const mockedFsPromises = fs as jest.Mocked<typeof fs>;

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
}));

describe('BatchTransport', () => {
    const mockBatchSize = 2;
    const mockFlushInterval = 100;
    const mockRetryInterval = 500;
    const mockBackoffFactor = 100;
    const mockApiUrl = 'http://test-api.com/logs';
  
  const JEST_TIMER_FLUSH_TIME = 10000;

  let transport: BatchTransport;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.clearAllMocks(); 
    mockFileContent = []; 

    mockedAxios.post.mockResolvedValue({ status: 200 });
    (fsSync.existsSync as jest.Mock).mockReturnValue(true);
    mockedFsPromises.readFile.mockImplementation(async () => 
      Promise.resolve(JSON.stringify(mockFileContent))
    );

    transport = new BatchTransport({
      batchSize: mockBatchSize,
      flushInterval: mockFlushInterval,
      apiUrl: mockApiUrl,
      initialized: false,
      retryInterval: mockRetryInterval,
      backoffFactor: mockBackoffFactor,
    });
  });

  afterEach(async () => {
    if (transport) {
      const closePromise = transport.close();

      await jest.advanceTimersByTimeAsync(JEST_TIMER_FLUSH_TIME);
      await closePromise;
    }
    
    await jest.advanceTimersByTimeAsync(JEST_TIMER_FLUSH_TIME);
    jest.useRealTimers(); 
  });

  it('should initialize correctly and load/flush backup logs', async () => {
    mockFileContent = [{ level: 'info', message: 'Backed up log', timestamp: new Date().toISOString() }];
    
    await transport.init(); 
    
    expect(transport).toBeInstanceOf(BatchTransport);
    expect(mockedFsPromises.readFile).toHaveBeenCalledWith(expect.any(String), 'utf-8');
    expect(mockedFsPromises.writeFile).toHaveBeenCalledWith(expect.any(String), JSON.stringify([], null, 2));

    await jest.advanceTimersByTimeAsync(JEST_TIMER_FLUSH_TIME); 

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
        mockApiUrl,
        expect.arrayContaining([
            expect.objectContaining({ message: 'Backed up log' })
        ]),
        expect.anything()
    );
  });

  it('should add logs to the queue', async () => {
    await transport.init();
    const callback = jest.fn();
    transport.log({ level: 'info', message: 'Test log 1' }, callback);
    
    expect(callback).toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('should flush logs when batch size is reached', async () => {
    await transport.init();
    const callback = jest.fn();
    
    transport.log({ level: 'info', message: 'Test log 1' }, callback);
    transport.log({ level: 'info', message: 'Test log 2' }, callback); 
    
    await jest.advanceTimersByTimeAsync(JEST_TIMER_FLUSH_TIME);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      mockApiUrl,
      expect.arrayContaining([
        expect.objectContaining({ message: 'Test log 1' }),
        expect.objectContaining({ message: 'Test log 2' }),
      ]),
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    );
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should flush logs when flush interval is reached', async () => {
    await transport.init();
    const callback = jest.fn();
    
    transport.log({ level: 'info', message: 'Test log 1' }, callback);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    
    await jest.advanceTimersByTimeAsync(mockFlushInterval + 50);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      mockApiUrl,
      expect.arrayContaining([
        expect.objectContaining({ message: 'Test log 1' })
      ]),
      expect.anything()
    );
  });

  it('should automatically retry failed logs', async () => {
    await transport.init();
    const callback = jest.fn();
    
    mockedAxios.post
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ status: 200 });

    transport.log({ level: 'info', message: 'Test log 1' }, callback);
    transport.log({ level: 'info', message: 'Test log 2' }, callback); 
    
    await jest.advanceTimersByTimeAsync(1);
    
    expect(mockedAxios.post).toHaveBeenCalledTimes(1); 
    
    await jest.advanceTimersByTimeAsync(JEST_TIMER_FLUSH_TIME);

    expect(mockedAxios.post).toHaveBeenCalledTimes(2); 
    expect(callback).toHaveBeenCalledTimes(2);
  });
  
  it('should still retry pending failed logs on close', async () => {
    await transport.init();
    const callback = jest.fn();

    mockedAxios.post
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ status: 200 }); 

    transport.log({ level: 'info', message: 'Test log 1' }, callback);
    transport.log({ level: 'info', message: 'Test log 2' }, callback);

    await jest.advanceTimersByTimeAsync(1); 
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    
    const closePromise = transport.close();
    await jest.advanceTimersByTimeAsync(JEST_TIMER_FLUSH_TIME); 
    await closePromise;

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledTimes(2);
  });
  
  it('should handle permanent errors and backup logs', async () => {
    jest.useRealTimers();

    await transport.init();

    clearInterval((transport as any).flushTimer);
    clearInterval((transport as any).retryTimer);

    const callback = jest.fn();

    mockedAxios.post.mockRejectedValue({
        isAxiosError: true,
        message: 'Request failed with status code 401',
        response: { status: 401 },
    });

    transport.log({ level: 'info', message: 'Test log 1', timestamp: new Date().toISOString() }, callback);

    await (transport as any).flushLogs();
    await new Promise(setImmediate);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedFsPromises.writeFile).toHaveBeenCalledTimes(1);
    expect(mockFileContent).toHaveLength(1);
    expect(mockFileContent[0].message).toBe('Test log 1');

    transport.log({ level: 'info', message: 'Test log 2', timestamp: new Date().toISOString() }, callback);

    await (transport as any).flushLogs();
    await new Promise(setImmediate);

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedFsPromises.writeFile).toHaveBeenCalledTimes(2);
    expect(mockFileContent).toHaveLength(2);
    expect(mockFileContent[1].message).toBe('Test log 2');

    expect(callback).toHaveBeenCalledTimes(2);
  }, 15000);
  
  it('should compress logs when useCompression is true', async () => {
    const localTransport = new BatchTransport({
      apiUrl: mockApiUrl,
      batchSize: mockBatchSize,
      flushInterval: mockFlushInterval,
      useCompression: true,
      initialized: false,
      retryInterval: mockRetryInterval,
      backoffFactor: mockBackoffFactor,
    });
    mockedAxios.post.mockResolvedValue({ status: 200 }); 
    
    await localTransport.init(); 

    const callback = jest.fn();
    localTransport.log({ level: 'info', message: 'Compressed log 1' }, callback);
    localTransport.log({ level: 'info', message: 'Compressed log 2' }, callback); 

    await Promise.resolve();

    await jest.runOnlyPendingTimersAsync();

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      mockApiUrl,
      expect.any(Buffer), 
      expect.objectContaining({ 
          headers: expect.objectContaining({ 
              'Content-Type': 'application/octet-stream', 
              'Content-Encoding': 'gzip' 
          })
      })
    );
    expect(callback).toHaveBeenCalledTimes(2);

    await localTransport.close();
  });

  it('should ensure all logs are processed on close', async () => {
    await transport.init();
    const callback = jest.fn();
    mockedAxios.post.mockResolvedValue({ status: 200 });

    transport.log({ level: 'info', message: 'Closing log 1' }, callback);

    await jest.advanceTimersByTimeAsync(mockFlushInterval + 50);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    
    transport.log({ level: 'info', message: 'Closing log 2' }, callback);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    await transport.close();
    
    await jest.advanceTimersByTimeAsync(JEST_TIMER_FLUSH_TIME);

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post).toHaveBeenLastCalledWith(
        mockApiUrl,
        expect.arrayContaining([
            expect.objectContaining({ message: 'Closing log 2' })
        ]),
        expect.anything()
    );
    expect(callback).toHaveBeenCalledTimes(2);
  });
});