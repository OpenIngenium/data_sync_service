jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../../utils/logger');
const {
  sleep,
  camelToSnakeCase,
  saveLastTimestampsToES,
  readLastTimestampsFromES,
} = require('../../utils/utils');
const { makeEsClient } = require('./mocks/mockSearchClient');

describe('utils/utils.js', () => {
  describe('sleep', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    test('resolves after the given number of milliseconds', async () => {
      jest.useFakeTimers();
      const spy = jest.spyOn(global, 'setTimeout');

      const promise = sleep(1000);
      jest.advanceTimersByTime(1000);
      await expect(promise).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 1000);
    });
  });

  describe('camelToSnakeCase', () => {
    test('converts camelCase to snake_case', () => {
      expect(camelToSnakeCase('procedureElement')).toBe('procedure_element');
    });

    test('leaves already lowercase strings unchanged', () => {
      expect(camelToSnakeCase('element')).toBe('element');
    });
  });

  describe('saveLastTimestampsToES', () => {
    test('indexes the timestamps document into the syncdata index', async () => {
      const esClient = makeEsClient();
      const timestamps = { element: '123' };

      await saveLastTimestampsToES(esClient, timestamps);

      expect(esClient.index).toHaveBeenCalledWith({
        index: 'syncdata',
        id: 'last_timestamps',
        body: { data: timestamps },
      });
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('logs an error when indexing fails and does not throw', async () => {
      const failure = new Error('boom');
      const esClient = makeEsClient({
        indexImpl: async () => {
          throw failure;
        },
      });

      await expect(saveLastTimestampsToES(esClient, {})).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        'Error saving lastTimestamps to Elasticsearch:',
        failure,
      );
    });
  });

  describe('readLastTimestampsFromES', () => {
    test('returns the stored data on success', async () => {
      const data = { element: '999' };
      const esClient = makeEsClient({
        getImpl: async () => ({ _source: { data } }),
      });

      await expect(readLastTimestampsFromES(esClient)).resolves.toEqual(data);
      expect(esClient.get).toHaveBeenCalledWith({
        index: 'syncdata',
        id: 'last_timestamps',
      });
    });

    test('returns an empty object when the document is missing (404)', async () => {
      const esClient = makeEsClient({
        getImpl: async () => {
          throw { meta: { statusCode: 404 } };
        },
      });

      await expect(readLastTimestampsFromES(esClient)).resolves.toEqual({});
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('logs and rethrows on non-404 errors', async () => {
      const failure = { meta: { statusCode: 500 } };
      const esClient = makeEsClient({
        getImpl: async () => {
          throw failure;
        },
      });

      await expect(readLastTimestampsFromES(esClient)).rejects.toBe(failure);
      expect(logger.error).toHaveBeenCalledWith(
        'Error reading lastTimestamps from Elasticsearch:',
        failure,
      );
    });
  });
});
