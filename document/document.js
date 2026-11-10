const { camelToSnakeCase, saveLastTimestampsToES } = require('../utils/utils');
const { INIT_SYNC_TRIGGER_ELEM_COUNT, INIT_SYNC_CHUNK_SIZE, SYNC_CHUNK_SIZE } = require('../config/config');
const logger = require('../utils/logger');

const DATE_KEYS = [
    ['time_completed'],
    ['time_obsoleted'],
    ['time_released'],
    ['time_approved'],
    ['time_saved'],
    ['time_started'],
    ['time_updated'],
    ['time_submitted'],
    ['time_versioned'],
    ['venue_status', 'started_on'],
    ['conversations', 'time_resolved'],
    ['execution', 'meta_data', 'time_completed'],
    ['execution', 'meta_data', 'time_started'],
    ['execution', 'meta_data', 'time_updated'],
    ['execution', 'results', 'time_verified'],
    ['execution', 'results', 'translated_start_time'],
    ['execution', 'results', 'entries', 'verified_time'],
    ['execution', 'results', 'entries', 'radiated_time'],
    ['execution', 'results', 'entries', 'ert'],
    ['execution', 'results', 'entries', 'scet'],
    ['execution', 'results', 'entries', 'evr_data', 'ert'],
    ['execution', 'results', 'entries', 'evr_data', 'scet'],
    ['execution', 'results', 'entries', 'products', 'ert'],
    ['execution', 'results', 'entries', 'products', 'scet'],
    ['execution_user_input', 'time_verified'],
    ['procedure_modification', 'justification', 'time_updated'],
    ['procedure_modification', 'approval', 'time_updated'],
];

function notADate(value) {
    const res = isNaN(Date.parse(value));
    return res;
}


function processEntries(entries) {
    return entries.map(entry => {
        if (entry.verification_value) {
            entry.verification_value = String(entry.verification_value);
        }
        return entry;
    });
}


function preprocessDocument(document) {
    if (!document) {
        return;
    }

    // sanitize attributes that causes conflicts for ES
    delete document._id;
    delete document._version;

    // do not need specification field
    delete document.specification;

    // sanitize invalid dates
    for (const keys of DATE_KEYS) {
        _sanitizeDateFields(document, keys);
    }

    // sanitize verification_value in entries
    if (document.authoring_user_input?.entries) {
        document.authoring_user_input.entries = processEntries(document.authoring_user_input.entries);
    }

    if (document.execution_user_input?.entries) {
        document.execution_user_input.entries = processEntries(document.execution_user_input.entries);
    }

    if (document.execution?.results?.entries) {
        document.execution.results.entries = processEntries(document.execution.results.entries);
    }

    // sanitize outputs of custom scripts outputs
    if (document.execution?.results?.outputs) {
        document.execution.results.outputs = document.execution.results.outputs.map(output => {
            if (output.value) {
                output.value = String(output.value);
            }
            return output;
        });
    }
}


/**
 * ES will throw an error if date field is an empty string. If a date field does not have a valid value, set it to null.
 */
function _sanitizeDateFields(parent, keys) {
    let targetTemp = null;
    let target = null;

    let notFound = false;
    let lastParent = parent;
    for (const [i, key] of keys.entries()) {
        if (parent.hasOwnProperty(key)) {
            targetTemp = parent[key];
            if (Array.isArray(targetTemp) && i < (keys.length-1)) {
                for (const item of targetTemp) {
                    _sanitizeDateFields(item, keys.slice(i+1))
                }
            } else {
                target = targetTemp;
                lastParent = parent;
                parent = target;
            }
        } else {
            notFound = true;
            break;
        }
    }
    if (!notFound) {
        if (Array.isArray(target)) {
            for (let i=0; i < target.length; i++) {
                if (notADate(target[i])) {
                    target[i] = null;
                }
            }
        } else {
            if (notADate(target)) {
                const lastKey = keys[keys.length-1];
                lastParent[lastKey] = null;
            }
        }
    }
}

function getTagNames(document) {
    if (document.procedureVersionDetails && Array.isArray(document.procedureVersionDetails.tags)) {
        const tagNames = document.procedureVersionDetails.tags
          .filter(tag => document.tag_ids.includes(tag.tag_id))
          .map(tag => tag.name);
        return {tag_names: tagNames};
    } else {
        return {tag_names: []};
    }
}
  

async function getElementData(document, arangoDb) {

    const executionQuery = `
              FOR execution IN execution
              FILTER @execution_id == execution.execution_id
              RETURN execution
            `;
    const executionBindVars = { execution_id: document.execution_id };
    const executionCursor = await arangoDb.query(executionQuery, executionBindVars);

    let executionDocument = {};
    let venueDocument = {};
    let procedureVersionDocument = {};
    let runRecordDocument = {};

    if (executionCursor.hasNext) {
        executionDocument = await executionCursor.next();
        preprocessDocument(executionDocument);
    }

    const venueQuery = `
              FOR venue IN venue
              FILTER @venue_id == venue.venue_id
              RETURN venue
            `;
    const venueBindVars = { venue_id: executionDocument.venue_id };
    const venueCursor = await arangoDb.query(venueQuery, venueBindVars);

    if (venueCursor.hasNext) {
        venueDocument = await venueCursor.next();
        preprocessDocument(venueDocument);
    }

    const runRecordQuery =  `
                FOR runRecord IN runRecord
                FILTER @run_elem_id == runRecord._to
                RETURN runRecord
            `;
    
    const runRecordBindVars = { run_elem_id: `element/${document.elem_id}` };
    const runRecordCursor = await arangoDb.query(runRecordQuery, runRecordBindVars);
     
    if (runRecordCursor.hasNext) {
        runRecordDocument = await runRecordCursor.next();
        preprocessDocument(runRecordDocument);
    }
            
    if (document.version_id && document.version_id != '') {
        const procedureVersionQuery = `
              FOR procedureVersion IN procedureVersion
              FILTER @version_id == procedureVersion.version_id
              RETURN procedureVersion
            `;
        const procedureVersionBindVars = { version_id: document.version_id };
        
        try {
            //Denormalizing procedureVersion data
            const procedureVersionCursor = await arangoDb.query(procedureVersionQuery, procedureVersionBindVars);
            if (procedureVersionCursor.hasNext) {
                procedureVersionDocument = await procedureVersionCursor.next();
                preprocessDocument(procedureVersionDocument);
            }

            return { executionDetails: executionDocument, venueDetails: venueDocument, procedureVersionDetails: procedureVersionDocument, runRecordDetails: runRecordDocument };
        } catch (error) {
            logger.error('Error retrieving procedure version:', error);
            return { executionDetails: executionDocument, venueDetails: venueDocument, procedureVersionDetails: {}, runRecordDetails: runRecordDocument };
        }
    }
    
    return { executionDetails: executionDocument, venueDetails: venueDocument, procedureVersionDetails: {}, runRecordDetails: runRecordDocument };
}

async function getProcedureElementData(document, arangoDb) {
    let procedureDocument = {};
    let procedureVersionDocument = {};

    const procedureQuery = `
              FOR procedure IN procedure
              FILTER @procedure_id == procedure.procedure_id
              RETURN procedure
            `;
    const procedureBindVars = { procedure_id: document.procedure_id };
    const procedureCursor = await arangoDb.query(procedureQuery, procedureBindVars);

    if (procedureCursor.hasNext) {
        procedureDocument = await procedureCursor.next();
        preprocessDocument(procedureDocument);
    }

    const procedureVersionQuery = `
              FOR procedureVersion IN procedureVersion
              FILTER @version_id == procedureVersion.version_id
              RETURN procedureVersion
            `;
    const procedureVersionBindVars = { version_id: document.version_id };
    const procedureVersionCursor = await arangoDb.query(procedureVersionQuery, procedureVersionBindVars);

    if (procedureVersionCursor.hasNext) {
        procedureVersionDocument = await procedureVersionCursor.next();
        preprocessDocument(procedureVersionDocument);
    }

    return { procedureDetails: procedureDocument, procedureVersionDetails: procedureVersionDocument };
}

async function initialSync(lastTimestamps, arangoDb, esClient, arangoCollectionNames) {
    for (const collectionName of arangoCollectionNames) {
        const lastTimestamp = lastTimestamps[collectionName] || '';
        logger.info(`initialSync Processing collection: ${collectionName} lastTimestamp: ${lastTimestamp}`);

        let bindVars = {lastTimestamp}

        // Note that FILTER uses ">=" so as not to miss any new element with the same timestamp.
        // We may re-index some of the same documents in ES, which is fine.
        let query = `
        FOR doc IN ${collectionName}
        LET timestamp = DECODE_REV(doc._rev).date
        FILTER timestamp >= @lastTimestamp
        SORT timestamp ASC
        RETURN timestamp
        `;
        logger.info(`Getting timestamps: ${collectionName}`);
        let cursor = await arangoDb.query(query, bindVars, { ttl: 3600, batchSize: 10000});
        const timestamps = [];
        while (cursor.hasNext) {
            const timestamp = await cursor.next();
            timestamps.push(timestamp);
        }

        logger.info(`count of timestamps: ${timestamps.length}`);
        // logger.info(JSON.stringify(timestamps, null, 2));

        if (timestamps.length > INIT_SYNC_TRIGGER_ELEM_COUNT) {
            let fromTimestamp = lastTimestamp;

            for (let i = INIT_SYNC_CHUNK_SIZE; i < timestamps.length; i=i+INIT_SYNC_CHUNK_SIZE) {
                let toTimestamp = timestamps[i];
                query = `
                FOR doc IN ${collectionName}
                LET timestamp = DECODE_REV(doc._rev).date
                FILTER timestamp >= @fromTimestamp
                FILTER timestamp <= @toTimestamp
                SORT timestamp ASC
                RETURN {doc: doc, timestamp: timestamp}
                `;
                bindVars = {fromTimestamp, toTimestamp};

                logger.info(`Initial query fromTimestamp: ${fromTimestamp} toTimestamp: ${toTimestamp}`);
                cursor = await arangoDb.query(query, bindVars, { ttl: 3600, batchSize: 10000, count: true });

                logger.info(`Initial indexing fromTimestamp: ${fromTimestamp} toTimestamp: ${toTimestamp} count: ${cursor.count}`);
                while (cursor.hasNext) {
                    let res = await cursor.next();
                    let document = res.doc;
                    let timestamp = res.timestamp;

                    preprocessDocument(document);
                    
                    if (collectionName == 'element') {
                        const elementDetails = await getElementData(document, arangoDb);
                        document = {...document, ...elementDetails}
                    } else {
                        const procedureDetails = await getProcedureElementData(document, arangoDb);
                        document = {...document, ...procedureDetails}
                    }
        
                    const tagNames = getTagNames(document);
                    document = { ...document, ...tagNames}
        
                    try {
                        await esClient.index({ index: camelToSnakeCase(collectionName), id: document._key, body: document });
                        lastTimestamps[collectionName] = timestamp;
                        await saveLastTimestampsToES(esClient, lastTimestamps);
                    } catch (error) {
                        logger.error(`Error indexing document: ${error}`);
                    }
                }
                fromTimestamp = toTimestamp;
            }
        }
    }

    return lastTimestamps;
}

async function incrementalSync(lastTimestamps, arangoDb, esClient, arangoCollectionNames) {
    for (const collectionName of arangoCollectionNames) {

        const lastTimestamp = lastTimestamps[collectionName] || '';

        logger.info(`incrementalSync Processing collection: ${collectionName} lastTimestamp: ${lastTimestamp}`);

        const query = `
          FOR doc IN ${collectionName}
          LET timestamp = DECODE_REV(doc._rev).date
          FILTER timestamp >= @lastTimestamp
          SORT timestamp ASC
          LIMIT ${SYNC_CHUNK_SIZE}
          RETURN {doc: doc, timestamp: timestamp}
        `;
        const bindVars = { lastTimestamp };
        logger.info(`Incremental query lastTimestamp: ${lastTimestamp}`);
        const cursor = await arangoDb.query(query, bindVars, { ttl: 3600, batchSize: 10000, count: true });
        
        logger.info(`Incremental indexing lastTimestamp: ${lastTimestamp} count: ${cursor.count}`);
        while (cursor.hasNext) {
            let res = await cursor.next();
            let document = res.doc;
            let timestamp = res.timestamp;

            preprocessDocument(document);
            
            if(collectionName =='element') {
                const elementDetails = await getElementData(document, arangoDb);
                document = {...document, ...elementDetails}
            } else {
                const procedureDetails = await getProcedureElementData(document, arangoDb);
                document = {...document, ...procedureDetails}
            }

            const tagNames = getTagNames(document);
            document = { ...document, ...tagNames}

            try {
                await esClient.index({ index: camelToSnakeCase(collectionName), id: document._key, body: document });

                lastTimestamps[collectionName] = timestamp;
                await saveLastTimestampsToES(esClient, lastTimestamps);
            } catch (error) {
                logger.error(`Error indexing document: ${error}`);
            } 
        }
    }

    return lastTimestamps;
}

module.exports = {
    preprocessDocument,
    initialSync,
    incrementalSync,
    notADate,
    processEntries,
    getTagNames,
    getElementData,
    getProcedureElementData,
};
