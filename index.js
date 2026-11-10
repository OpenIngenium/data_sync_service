
const { sleep, readLastTimestampsFromES } = require('./utils/utils');
const logger = require('./utils/logger');
const { getArangoDb, getEsClient } = require('./db/db');
const { initialSync, incrementalSync } = require('./document/document');
const { ARANGO_COLLECTION_NAMES, SYNC_INTERVAL_SECS, INIT_SYNC_DELAY_SECS } = require('./config/config');

async function sleepMilisecs(miliSecs) {
  await new Promise(resolve => setTimeout(resolve, miliSecs));
}

async function startService() {
  let arangoDb = null;
  let esClient = null;

  // Retry up to 5 mins to connect to ArangoDB and ElasticSearch
  const maxWaitMilisecs = 5 * 60 * 1000;
  const startTime = new Date();
  let trialCount = 0;
  let elapsedTime = new Date() - startTime;
  let arangoConnected = false;
  let esConnected = false;
  while ((!arangoConnected) && (elapsedTime <= maxWaitMilisecs)) {
    try {
      trialCount++;
      arangoDb = await getArangoDb();
      arangoConnected = await arangoDb.exists();
      logger.info(`ArangoDB Connected`);
    } catch (error) {
      logger.warn(`Trial: ${trialCount}. Failed to connect to ArangoDB:`, error);
    }
    await sleepMilisecs(5000);
    elapsedTime = new Date() - startTime;
  }

  trialCount = 0;
  while ((!esConnected) && (elapsedTime <= maxWaitMilisecs)) {
    try {
      trialCount++;
      esClient = await getEsClient();
      esConnected = await esClient.ping();  
      logger.info(`ES Connected`);
    } catch (error) {
      logger.warn(`Trial: ${trialCount}. Failed to connect to ElasticSearch:`, error);
    }
    await sleepMilisecs(5000);
    elapsedTime = new Date() - startTime;
  }

  if (!arangoConnected) {
    logger.error(`Failed to connect to ArangoDB. Exiting...`);
    return;
  }

  if (!esConnected) {
    logger.error(`Failed to connect to ElasticSearch. Exiting...`);
    return;
  }

  try {
    logger.info(`Getting Collection Names ${JSON.stringify(ARANGO_COLLECTION_NAMES)}`);
  } catch (error) {
    logger.error(`Error getting collection names:`, error);
  }

  // give a bit of time for Search Server to set the index mapping
  // sync needs to be done after the mapping is set.
  logger.info(`Waiting for ${INIT_SYNC_DELAY_SECS} seconds before starting the data sync`);
  await sleep(INIT_SYNC_DELAY_SECS);

  try {
    var lastTimestamps = await readLastTimestampsFromES(esClient);
    logger.info(`Checking lastTimestamps from ES: ${JSON.stringify(lastTimestamps)}`);
  } catch (error) {
    logger.error('Error reading lastTimestamps from ES', error);
  }

  await initialSync(lastTimestamps, arangoDb, esClient, ARANGO_COLLECTION_NAMES);
  
  while (true) {
    try {
      lastTimestamps = await incrementalSync(lastTimestamps, arangoDb, esClient, ARANGO_COLLECTION_NAMES);
      logger.info(`Last processed revisions: ${JSON.stringify(lastTimestamps)}`);
    } catch (error) {
      logger.error(`Error lastTimestamps:`, error);
    }
    await sleep(1000 * SYNC_INTERVAL_SECS);
  }
}

/* istanbul ignore next: entry-point guard, exercised only when run directly */
if (require.main === module) {
  startService();
}

module.exports = { startService, sleepMilisecs };
