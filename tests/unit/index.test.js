jest.mock('../../utils/utils', () => ({
  sleep: jest.fn(),
  readLastTimestampsFromES: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../db/db', () => ({
  getArangoDb: jest.fn(),
  getEsClient: jest.fn(),
}));

jest.mock('../../document/document', () => ({
  initialSync: jest.fn(),
  incrementalSync: jest.fn(),
}));

jest.mock('../../config/config', () => ({
  ARANGO_COLLECTION_NAMES: ['element'],
  SYNC_INTERVAL_SECS: 30,
  INIT_SYNC_DELAY_SECS: 60,
}));

const { sleep, readLastTimestampsFromES } = require('../../utils/utils');
const logger = require('../../utils/logger');
const { getArangoDb, getEsClient } = require('../../db/db');
const { initialSync, incrementalSync } = require('../../document/document');
const { startService, sleepMilisecs } = require('../../index');

/**
 * Replace Date so elapsed-time math advances deterministically, letting the
 * connection retry loops terminate via timeout.
 */
function mockAdvancingDate(step) {
  let now = 0;
  return jest.spyOn(global, 'Date').mockImplementation(() => {
    const t = now;
    now += step;
    return { valueOf: () => t };
  });
}

describe('index.js', () => {
  beforeEach(() => {
    // Make the internal sleepMilisecs (setTimeout-based) resolve immediately.
    jest.spyOn(global, 'setTimeout').mockImplementation((fn) => {
      fn();
      return 0;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('sleepMilisecs resolves once the timer fires', async () => {
    await expect(sleepMilisecs(5000)).resolves.toBeUndefined();
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  test('happy path: connects, performs initial sync, then runs the incremental loop', async () => {
    getArangoDb.mockResolvedValue({ exists: jest.fn().mockResolvedValue(true) });
    getEsClient.mockResolvedValue({ ping: jest.fn().mockResolvedValue(true) });
    readLastTimestampsFromES.mockResolvedValue({ element: 't0' });
    initialSync.mockResolvedValue({ element: 't0' });
    incrementalSync.mockResolvedValue({ element: 't1' });
    // First sleep (init delay) succeeds; second sleep (loop) breaks the loop.
    sleep.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('stop'));

    await expect(startService()).rejects.toThrow('stop');

    expect(logger.info).toHaveBeenCalledWith('ArangoDB Connected');
    expect(logger.info).toHaveBeenCalledWith('ES Connected');
    expect(initialSync).toHaveBeenCalledWith({ element: 't0' }, expect.any(Object), expect.any(Object), ['element']);
    expect(incrementalSync).toHaveBeenCalledTimes(1);
  });

  test('logs and continues when incrementalSync throws inside the loop', async () => {
    getArangoDb.mockResolvedValue({ exists: jest.fn().mockResolvedValue(true) });
    getEsClient.mockResolvedValue({ ping: jest.fn().mockResolvedValue(true) });
    readLastTimestampsFromES.mockResolvedValue({});
    initialSync.mockResolvedValue({});
    incrementalSync.mockRejectedValue(new Error('sync boom'));
    sleep.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('stop'));

    await expect(startService()).rejects.toThrow('stop');

    expect(logger.error).toHaveBeenCalledWith('Error lastTimestamps:', expect.any(Error));
  });

  test('logs errors from optional steps but still starts syncing', async () => {
    getArangoDb.mockResolvedValue({ exists: jest.fn().mockResolvedValue(true) });
    getEsClient.mockResolvedValue({ ping: jest.fn().mockResolvedValue(true) });
    readLastTimestampsFromES.mockRejectedValue(new Error('read boom'));
    initialSync.mockResolvedValue({});
    incrementalSync.mockResolvedValue({});
    sleep.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('stop'));

    await expect(startService()).rejects.toThrow('stop');

    expect(logger.error).toHaveBeenCalledWith('Error reading lastTimestamps from ES', expect.any(Error));
    expect(initialSync).toHaveBeenCalled();
  });

  test('exits when ArangoDB never connects', async () => {
    mockAdvancingDate(200000);
    getArangoDb.mockRejectedValue(new Error('no arango'));

    await startService();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to connect to ArangoDB'),
      expect.any(Error),
    );
    expect(logger.error).toHaveBeenCalledWith('Failed to connect to ArangoDB. Exiting...');
    expect(getEsClient).not.toHaveBeenCalled();
    expect(initialSync).not.toHaveBeenCalled();
  });

  test('exits when ElasticSearch never connects', async () => {
    mockAdvancingDate(60000);
    getArangoDb.mockResolvedValue({ exists: jest.fn().mockResolvedValue(true) });
    getEsClient.mockRejectedValue(new Error('no es'));

    await startService();

    expect(logger.info).toHaveBeenCalledWith('ArangoDB Connected');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to connect to ElasticSearch'),
      expect.any(Error),
    );
    expect(logger.error).toHaveBeenCalledWith('Failed to connect to ElasticSearch. Exiting...');
    expect(initialSync).not.toHaveBeenCalled();
  });
});

describe('index.js collection-name logging failure', () => {
  test('logs an error when collection names cannot be serialized', async () => {
    jest.resetModules();

    const circular = {};
    circular.self = circular;

    const loggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const sleepMock = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('stop'));

    jest.doMock('../../utils/utils', () => ({
      sleep: sleepMock,
      readLastTimestampsFromES: jest.fn().mockResolvedValue({}),
    }));
    jest.doMock('../../utils/logger', () => loggerMock);
    jest.doMock('../../db/db', () => ({
      getArangoDb: jest.fn().mockResolvedValue({ exists: jest.fn().mockResolvedValue(true) }),
      getEsClient: jest.fn().mockResolvedValue({ ping: jest.fn().mockResolvedValue(true) }),
    }));
    jest.doMock('../../document/document', () => ({
      initialSync: jest.fn().mockResolvedValue({}),
      incrementalSync: jest.fn().mockResolvedValue({}),
    }));
    jest.doMock('../../config/config', () => ({
      ARANGO_COLLECTION_NAMES: circular,
      SYNC_INTERVAL_SECS: 30,
      INIT_SYNC_DELAY_SECS: 60,
    }));

    jest.spyOn(global, 'setTimeout').mockImplementation((fn) => {
      fn();
      return 0;
    });

    let indexModule;
    jest.isolateModules(() => {
      indexModule = require('../../index');
    });

    await expect(indexModule.startService()).rejects.toThrow('stop');

    expect(loggerMock.error).toHaveBeenCalledWith('Error getting collection names:', expect.any(Error));

    jest.dontMock('../../utils/utils');
    jest.dontMock('../../utils/logger');
    jest.dontMock('../../db/db');
    jest.dontMock('../../document/document');
    jest.dontMock('../../config/config');
    jest.restoreAllMocks();
  });
});
