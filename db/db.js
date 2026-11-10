const { Database } = require('arangojs');
const { Client } = require('@elastic/elasticsearch');
const {
  ARANGO_URL,
  ARANGO_USER,
  ARANGO_PASSWORD,
  ARANGO_DB_NAME,
  ES_HOST,
  ES_PORT,
} = require('../config/config');

async function getArangoDb() {
  const db = new Database({
    url: ARANGO_URL,
    databaseName: ARANGO_DB_NAME,
    auth: { username: ARANGO_USER, password: ARANGO_PASSWORD },
  });

  return db;
}

async function getEsClient() {
  return new Client({ node: `http://${ES_HOST}:${ES_PORT}` });
}

module.exports = {
  getArangoDb,
  getEsClient,
};
