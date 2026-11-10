const { snapshotEnv } = require('./mocks/testHelpers');

const CONFIG_PATH = '../../config/config';

function loadConfig() {
  let config;
  jest.isolateModules(() => {
    config = require(CONFIG_PATH);
  });
  return config;
}

describe('config/config.js', () => {
  let restoreEnv;

  beforeEach(() => {
    restoreEnv = snapshotEnv();
    // Remove any config-relevant env vars so defaults are deterministic.
    for (const key of [
      'ARANGO_URL', 'ARANGO_USER', 'ARANGO_ROOT_PASSWORD', 'ARANGO_DB_NAME',
      'ES_HOST', 'ES_PORT', 'INIT_SYNC_DELAY_SECS', 'INIT_SYNC_TRIGGER_ELEM_COUNT',
      'INIT_SYNC_CHUNK_SIZE', 'SYNC_INTERVAL_SECS',
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    restoreEnv();
  });

  test('uses documented defaults when no env vars are set', () => {
    const config = loadConfig();

    expect(config.ARANGO_URL).toBe('http://127.0.0.1:18529');
    expect(config.ARANGO_USER).toBe('root');
    expect(config.ARANGO_PASSWORD).toBe('password');
    expect(config.ARANGO_DB_NAME).toBe('ingenium');
    expect(config.ARANGO_COLLECTION_NAMES).toEqual(['element', 'procedureElement']);
    expect(config.ES_HOST).toBe('127.0.0.1');
    expect(config.ES_PORT).toBe(19200);
    expect(config.INIT_SYNC_DELAY_SECS).toBe(60);
    expect(config.INIT_SYNC_TRIGGER_ELEM_COUNT).toBe(500000);
    expect(config.INIT_SYNC_CHUNK_SIZE).toBe(100000);
    expect(config.SYNC_INTERVAL_SECS).toBe(30);
    expect(config.SYNC_CHUNK_SIZE).toBe(100000);
    expect(config.LOG_LEVEL).toBe('info');
  });

  test('reads overrides from environment variables', () => {
    process.env.ARANGO_URL = 'http://arango:8529';
    process.env.ARANGO_USER = 'admin';
    process.env.ARANGO_ROOT_PASSWORD = 'secret';
    process.env.ARANGO_DB_NAME = 'testdb';
    process.env.ES_HOST = 'es-host';
    process.env.ES_PORT = '9200';
    process.env.INIT_SYNC_DELAY_SECS = '5';
    process.env.INIT_SYNC_TRIGGER_ELEM_COUNT = '10';
    process.env.INIT_SYNC_CHUNK_SIZE = '7';
    process.env.SYNC_INTERVAL_SECS = '15';

    const config = loadConfig();

    expect(config.ARANGO_URL).toBe('http://arango:8529');
    expect(config.ARANGO_USER).toBe('admin');
    expect(config.ARANGO_PASSWORD).toBe('secret');
    expect(config.ARANGO_DB_NAME).toBe('testdb');
    expect(config.ES_HOST).toBe('es-host');
    expect(config.ES_PORT).toBe(9200);
    expect(config.INIT_SYNC_DELAY_SECS).toBe(5);
    expect(config.INIT_SYNC_TRIGGER_ELEM_COUNT).toBe(10);
    expect(config.INIT_SYNC_CHUNK_SIZE).toBe(7);
    expect(config.SYNC_INTERVAL_SECS).toBe(15);
    // Known quirk: SYNC_CHUNK_SIZE is derived from INIT_SYNC_CHUNK_SIZE.
    expect(config.SYNC_CHUNK_SIZE).toBe(7);
  });

  test('falls back to numeric defaults when env values are not numbers', () => {
    process.env.ES_PORT = 'not-a-number';
    process.env.INIT_SYNC_DELAY_SECS = 'abc';
    process.env.INIT_SYNC_TRIGGER_ELEM_COUNT = '';
    process.env.INIT_SYNC_CHUNK_SIZE = 'xyz';
    process.env.SYNC_INTERVAL_SECS = 'foo';

    const config = loadConfig();

    expect(config.ES_PORT).toBe(19200);
    expect(config.INIT_SYNC_DELAY_SECS).toBe(60);
    expect(config.INIT_SYNC_TRIGGER_ELEM_COUNT).toBe(500000);
    expect(config.INIT_SYNC_CHUNK_SIZE).toBe(100000);
    expect(config.SYNC_INTERVAL_SECS).toBe(30);
    expect(config.SYNC_CHUNK_SIZE).toBe(100000);
  });
});
