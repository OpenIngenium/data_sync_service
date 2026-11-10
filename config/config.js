module.exports = {
    ARANGO_URL: process.env.ARANGO_URL || 'http://127.0.0.1:18529',
    ARANGO_USER: process.env.ARANGO_USER || 'root',
    ARANGO_PASSWORD: process.env.ARANGO_ROOT_PASSWORD || 'password',
    ARANGO_DB_NAME: process.env.ARANGO_DB_NAME || 'ingenium',
    ARANGO_COLLECTION_NAMES: ['element', 'procedureElement'],
    ES_HOST: process.env.ES_HOST || '127.0.0.1',
    ES_PORT: isNaN(parseInt(process.env.ES_PORT)) ? 19200 : parseInt(process.env.ES_PORT),
    INIT_SYNC_DELAY_SECS: isNaN(parseInt(process.env.INIT_SYNC_DELAY_SECS)) ? 60 : parseInt(process.env.INIT_SYNC_DELAY_SECS),
    INIT_SYNC_TRIGGER_ELEM_COUNT: isNaN(parseInt(process.env.INIT_SYNC_TRIGGER_ELEM_COUNT)) ? 500000 : parseInt(process.env.INIT_SYNC_TRIGGER_ELEM_COUNT),
    INIT_SYNC_CHUNK_SIZE: isNaN(parseInt(process.env.INIT_SYNC_CHUNK_SIZE)) ? 100000 : parseInt(process.env.INIT_SYNC_CHUNK_SIZE),
    SYNC_INTERVAL_SECS: isNaN(parseInt(process.env.SYNC_INTERVAL_SECS)) ? 30 : parseInt(process.env.SYNC_INTERVAL_SECS),
    SYNC_CHUNK_SIZE: isNaN(parseInt(process.env.INIT_SYNC_CHUNK_SIZE)) ? 100000 : parseInt(process.env.INIT_SYNC_CHUNK_SIZE),
    LOG_LEVEL: 'info'
};