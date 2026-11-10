const logger = require('./logger');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function camelToSnakeCase(str) {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

async function saveLastTimestampsToES(esClient, lastTimestamps) {
  try {
    await esClient.index({
      index: 'syncdata',
      id: 'last_timestamps',
      body: { data: lastTimestamps },
    });
  } catch (error) {
    logger.error('Error saving lastTimestamps to Elasticsearch:', error);
  }
}

async function readLastTimestampsFromES(esClient) {
  try {
    const response = await esClient.get({
      index: 'syncdata',
      id: 'last_timestamps',
    });
    return response._source.data;
  } catch (error) {
    if (error.meta.statusCode === 404) {
      // The document doesn't exist yet, so return an empty object
      return {};
    }
    logger.error('Error reading lastTimestamps from Elasticsearch:', error);
    throw error;
  }
}

module.exports = {
  sleep,
  camelToSnakeCase,
  saveLastTimestampsToES,
  readLastTimestampsFromES
};

