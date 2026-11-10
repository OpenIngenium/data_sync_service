/**
 * Create a mock Elasticsearch client.
 */
function makeEsClient({ ping = true, getImpl, indexImpl } = {}) {
  return {
    ping: jest.fn(async () => ping),
    get: jest.fn(getImpl || (async () => ({ _source: { data: {} } }))),
    index: jest.fn(indexImpl || (async () => ({ result: 'created' }))),
  };
}

module.exports = { makeEsClient };
