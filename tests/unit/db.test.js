jest.mock('arangojs', () => ({
  Database: jest.fn().mockImplementation(function Database(opts) {
    this.opts = opts;
  }),
}));

jest.mock('@elastic/elasticsearch', () => ({
  Client: jest.fn().mockImplementation(function Client(opts) {
    this.opts = opts;
  }),
}));

const { Database } = require('arangojs');
const { Client } = require('@elastic/elasticsearch');
const config = require('../../config/config');
const { getArangoDb, getEsClient } = require('../../db/db');

describe('db/db.js', () => {
  test('getArangoDb constructs a Database with configured connection details', async () => {
    const db = await getArangoDb();

    expect(Database).toHaveBeenCalledTimes(1);
    expect(Database).toHaveBeenCalledWith({
      url: config.ARANGO_URL,
      databaseName: config.ARANGO_DB_NAME,
      auth: { username: config.ARANGO_USER, password: config.ARANGO_PASSWORD },
    });
    expect(db).toBeInstanceOf(Database);
  });

  test('getEsClient constructs a Client pointing at the configured host and port', async () => {
    const client = await getEsClient();

    expect(Client).toHaveBeenCalledTimes(1);
    expect(Client).toHaveBeenCalledWith({
      node: `http://${config.ES_HOST}:${config.ES_PORT}`,
    });
    expect(client).toBeInstanceOf(Client);
  });
});
