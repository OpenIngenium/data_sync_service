const MESSAGE = Symbol.for('message');

jest.mock('winston', () => {
  const format = jest.fn(() => jest.fn());
  format.combine = jest.fn((...args) => ({ combined: args }));
  const consoleTransport = {};
  const Console = jest.fn(() => consoleTransport);
  return {
    createLogger: jest.fn((opts) => ({ opts })),
    format,
    transports: { Console },
  };
});

// Load winston (mock) and the logger together inside an isolated registry so
// the import-time calls are recorded within each test (jest clears mocks
// between tests, which would otherwise wipe module-load call history).
function load() {
  let winston;
  let logger;
  jest.isolateModules(() => {
    winston = require('winston');
    logger = require('../../utils/logger');
  });
  return { winston, logger };
}

describe('utils/logger.js', () => {
  test('creates a logger at the configured level with a Console transport', () => {
    const { winston, logger } = load();

    expect(winston.createLogger).toHaveBeenCalledTimes(1);
    const opts = winston.createLogger.mock.calls[0][0];
    expect(opts.level).toBe('info');
    expect(winston.transports.Console).toHaveBeenCalledTimes(1);
    expect(opts.transports).toEqual([winston.transports.Console.mock.results[0].value]);
    expect(logger).toEqual({ opts });
  });

  test('json_formatter rewrites the MESSAGE symbol as structured JSON', () => {
    const { winston } = load();
    const jsonFormatter = winston.format.mock.calls[0][0];

    const logEntry = {
      level: 'info',
      message: 'hello world',
      [MESSAGE]: 'plain text',
    };

    const result = jsonFormatter(logEntry);

    expect(result).toBe(logEntry);
    const parsed = JSON.parse(logEntry[MESSAGE]);
    expect(parsed.level).toBe('INFO');
    expect(parsed.message).toBe('hello world');
    expect(typeof parsed.timestamp).toBe('string');
    expect(isNaN(Date.parse(parsed.timestamp))).toBe(false);
  });
});
