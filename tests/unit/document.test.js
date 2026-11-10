jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Use small sync thresholds so the initialSync chunk loop is exercised with
// only a couple of documents.
jest.mock('../../config/config', () => ({
  INIT_SYNC_TRIGGER_ELEM_COUNT: 1,
  INIT_SYNC_CHUNK_SIZE: 1,
  SYNC_CHUNK_SIZE: 100,
}));

const logger = require('../../utils/logger');
const {
  preprocessDocument,
  initialSync,
  incrementalSync,
  notADate,
  processEntries,
  getTagNames,
  getElementData,
  getProcedureElementData,
} = require('../../document/document');
const { makeArangoDb } = require('./mocks/mockDatabase');
const { makeEsClient } = require('./mocks/mockSearchClient');
const { makeCursor } = require('./mocks/testHelpers');

describe('document/document.js', () => {
  describe('notADate', () => {
    test('returns false for a valid date string', () => {
      expect(notADate('2023-01-01T00:00:00Z')).toBe(false);
    });

    test('returns true for an invalid date value', () => {
      expect(notADate('')).toBe(true);
      expect(notADate('not-a-date')).toBe(true);
    });
  });

  describe('processEntries', () => {
    test('stringifies truthy verification_value and leaves others unchanged', () => {
      const entries = [
        { verification_value: 123 },
        { verification_value: 0 },
        { other: 'x' },
      ];

      const result = processEntries(entries);

      expect(result[0].verification_value).toBe('123');
      expect(result[1].verification_value).toBe(0);
      expect(result[2]).toEqual({ other: 'x' });
    });
  });

  describe('preprocessDocument', () => {
    test('returns undefined for falsy input without throwing', () => {
      expect(preprocessDocument(undefined)).toBeUndefined();
      expect(preprocessDocument(null)).toBeUndefined();
    });

    test('removes conflicting/unneeded fields', () => {
      const doc = { _id: 'a', _version: 2, specification: {}, keep: 'me' };
      preprocessDocument(doc);
      expect(doc).toEqual({ keep: 'me' });
    });

    test('nulls invalid dates and preserves valid ones (migrated example)', () => {
      const doc = {
        time_completed: '2023-01-01T00:00:00Z',
        time_approved: '',
        execution: {
          meta_data: {
            time_started: '2023-01-01T00:00:00Z',
            time_updated: '',
            time_completed: '',
          },
          results: {
            entries: [
              {
                radiated_time: '2023-01-01T00:00:00Z',
                verified_time: '',
                ert: ['2023-01-01T00:00:00Z', '', '2023-01-01T00:00:00Z'],
                evr_data: [
                  { ert: '2023-01-01T00:00:00Z', scet: '2023-01-01T00:00:00Z' },
                  { ert: '', scet: '' },
                  { sclk: 123 },
                ],
              },
            ],
            outputs: [
              { value: 42 },
              { name: 'no-value' },
            ],
          },
        },
      };

      preprocessDocument(doc);

      expect(doc.time_completed).toBe('2023-01-01T00:00:00Z');
      expect(doc.time_approved).toBeNull();
      expect(doc.execution.meta_data.time_started).toBe('2023-01-01T00:00:00Z');
      expect(doc.execution.meta_data.time_updated).toBeNull();
      expect(doc.execution.meta_data.time_completed).toBeNull();

      const entry = doc.execution.results.entries[0];
      expect(entry.radiated_time).toBe('2023-01-01T00:00:00Z');
      expect(entry.verified_time).toBeNull();
      // Array-of-dates branch: invalid entries become null.
      expect(entry.ert).toEqual(['2023-01-01T00:00:00Z', null, '2023-01-01T00:00:00Z']);
      expect(entry.evr_data[0].ert).toBe('2023-01-01T00:00:00Z');
      expect(entry.evr_data[1].ert).toBeNull();
      expect(entry.evr_data[1].scet).toBeNull();
      expect(entry.evr_data[2]).toEqual({ sclk: 123 });

      // outputs: value stringified, entries without value untouched.
      expect(doc.execution.results.outputs[0].value).toBe('42');
      expect(doc.execution.results.outputs[1]).toEqual({ name: 'no-value' });
    });

    test('stringifies verification_value across all entry containers', () => {
      const doc = {
        authoring_user_input: { entries: [{ verification_value: 1 }] },
        execution_user_input: { entries: [{ verification_value: 2 }] },
        execution: { results: { entries: [{ verification_value: 3 }] } },
      };

      preprocessDocument(doc);

      expect(doc.authoring_user_input.entries[0].verification_value).toBe('1');
      expect(doc.execution_user_input.entries[0].verification_value).toBe('2');
      expect(doc.execution.results.entries[0].verification_value).toBe('3');
    });
  });

  describe('getTagNames', () => {
    test('returns tag names filtered by tag_ids', () => {
      const doc = {
        tag_ids: [1, 3],
        procedureVersionDetails: {
          tags: [
            { tag_id: 1, name: 'alpha' },
            { tag_id: 2, name: 'beta' },
            { tag_id: 3, name: 'gamma' },
          ],
        },
      };

      expect(getTagNames(doc)).toEqual({ tag_names: ['alpha', 'gamma'] });
    });

    test('returns empty tag_names when no version details/tags are present', () => {
      expect(getTagNames({})).toEqual({ tag_names: [] });
      expect(getTagNames({ procedureVersionDetails: {} })).toEqual({ tag_names: [] });
    });
  });

  describe('getElementData', () => {
    function router(routes) {
      return async (query) => {
        if (query.includes('FOR execution IN execution')) return routes.execution();
        if (query.includes('FOR venue IN venue')) return routes.venue();
        if (query.includes('FOR runRecord IN runRecord')) return routes.runRecord();
        if (query.includes('FOR procedureVersion IN procedureVersion')) return routes.procedureVersion();
        return makeCursor([]);
      };
    }

    test('denormalizes all related documents when version_id is present', async () => {
      const arangoDb = makeArangoDb({
        queryImpl: router({
          execution: () => makeCursor([{ execution_id: 'x1', venue_id: 'v1', _id: 'drop' }]),
          venue: () => makeCursor([{ venue_id: 'v1' }]),
          runRecord: () => makeCursor([{ _to: 'element/e1' }]),
          procedureVersion: () => makeCursor([{ version_id: 'ver1' }]),
        }),
      });
      const doc = { execution_id: 'x1', elem_id: 'e1', version_id: 'ver1' };

      const result = await getElementData(doc, arangoDb);

      expect(result.executionDetails).toEqual({ execution_id: 'x1', venue_id: 'v1' });
      expect(result.venueDetails).toEqual({ venue_id: 'v1' });
      expect(result.runRecordDetails).toEqual({ _to: 'element/e1' });
      expect(result.procedureVersionDetails).toEqual({ version_id: 'ver1' });
    });

    test('returns empty procedureVersionDetails when that cursor is empty', async () => {
      const arangoDb = makeArangoDb({
        queryImpl: router({
          execution: () => makeCursor([{ execution_id: 'x1', venue_id: 'v1' }]),
          venue: () => makeCursor([{ venue_id: 'v1' }]),
          runRecord: () => makeCursor([{ _to: 'element/e1' }]),
          procedureVersion: () => makeCursor([]),
        }),
      });
      const doc = { execution_id: 'x1', elem_id: 'e1', version_id: 'ver1' };

      const result = await getElementData(doc, arangoDb);

      expect(result.procedureVersionDetails).toEqual({});
    });

    test('handles procedureVersion query failure gracefully', async () => {
      const arangoDb = makeArangoDb({
        queryImpl: router({
          execution: () => makeCursor([{ execution_id: 'x1', venue_id: 'v1' }]),
          venue: () => makeCursor([{ venue_id: 'v1' }]),
          runRecord: () => makeCursor([{ _to: 'element/e1' }]),
          procedureVersion: () => {
            throw new Error('pv failure');
          },
        }),
      });
      const doc = { execution_id: 'x1', elem_id: 'e1', version_id: 'ver1' };

      const result = await getElementData(doc, arangoDb);

      expect(result.procedureVersionDetails).toEqual({});
      expect(result.venueDetails).toEqual({ venue_id: 'v1' });
      expect(logger.error).toHaveBeenCalledWith('Error retrieving procedure version:', expect.any(Error));
    });

    test('skips procedureVersion lookup and returns defaults when version_id is absent', async () => {
      const procedureVersion = jest.fn();
      const arangoDb = makeArangoDb({
        queryImpl: router({
          execution: () => makeCursor([]),
          venue: () => makeCursor([]),
          runRecord: () => makeCursor([]),
          procedureVersion,
        }),
      });
      const doc = { execution_id: 'x1', elem_id: 'e1', version_id: '' };

      const result = await getElementData(doc, arangoDb);

      expect(result).toEqual({
        executionDetails: {},
        venueDetails: {},
        procedureVersionDetails: {},
        runRecordDetails: {},
      });
      expect(procedureVersion).not.toHaveBeenCalled();
    });
  });

  describe('getProcedureElementData', () => {
    function router(routes) {
      return async (query) => {
        if (query.includes('FOR procedure IN procedure')) return routes.procedure();
        if (query.includes('FOR procedureVersion IN procedureVersion')) return routes.procedureVersion();
        return makeCursor([]);
      };
    }

    test('returns procedure and procedureVersion details', async () => {
      const arangoDb = makeArangoDb({
        queryImpl: router({
          procedure: () => makeCursor([{ procedure_id: 'p1' }]),
          procedureVersion: () => makeCursor([{ version_id: 'ver1' }]),
        }),
      });
      const doc = { procedure_id: 'p1', version_id: 'ver1' };

      const result = await getProcedureElementData(doc, arangoDb);

      expect(result).toEqual({
        procedureDetails: { procedure_id: 'p1' },
        procedureVersionDetails: { version_id: 'ver1' },
      });
    });

    test('returns empty objects when cursors are empty', async () => {
      const arangoDb = makeArangoDb({
        queryImpl: router({
          procedure: () => makeCursor([]),
          procedureVersion: () => makeCursor([]),
        }),
      });

      const result = await getProcedureElementData({ procedure_id: 'p1', version_id: 'v' }, arangoDb);

      expect(result).toEqual({ procedureDetails: {}, procedureVersionDetails: {} });
    });
  });

  describe('initialSync', () => {
    test('chunks and indexes documents for the element collection', async () => {
      const arangoDb = makeArangoDb({
        queryImpl: async (query) => {
          if (query.includes('RETURN timestamp')) return makeCursor(['t0', 't1']);
          if (query.includes('RETURN {doc: doc, timestamp: timestamp}')) {
            return makeCursor(
              [{ doc: { _key: 'k1', execution_id: 'x1', elem_id: 'e1', version_id: '' }, timestamp: 't1' }],
              1,
            );
          }
          if (query.includes('FOR execution IN execution')) return makeCursor([{ venue_id: 'v1' }]);
          if (query.includes('FOR venue IN venue')) return makeCursor([{ venue_id: 'v1' }]);
          if (query.includes('FOR runRecord IN runRecord')) return makeCursor([{ _to: 'element/e1' }]);
          return makeCursor([]);
        },
      });
      const esClient = makeEsClient();

      const result = await initialSync({}, arangoDb, esClient, ['element']);

      expect(result).toEqual({ element: 't1' });
      expect(esClient.index).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'element', id: 'k1' }),
      );
      // saveLastTimestampsToES also writes to the syncdata index.
      expect(esClient.index).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'syncdata', id: 'last_timestamps' }),
      );
    });

    test('indexes procedureElement documents via getProcedureElementData', async () => {
      const arangoDb = makeArangoDb({
        queryImpl: async (query) => {
          if (query.includes('RETURN timestamp')) return makeCursor(['t0', 't1']);
          if (query.includes('RETURN {doc: doc, timestamp: timestamp}')) {
            return makeCursor(
              [{ doc: { _key: 'pk1', procedure_id: 'p1', version_id: 'ver1' }, timestamp: 't1' }],
              1,
            );
          }
          if (query.includes('FOR procedure IN procedure')) return makeCursor([{ procedure_id: 'p1' }]);
          if (query.includes('FOR procedureVersion IN procedureVersion')) return makeCursor([{ version_id: 'ver1' }]);
          return makeCursor([]);
        },
      });
      const esClient = makeEsClient();

      const result = await initialSync({}, arangoDb, esClient, ['procedureElement']);

      expect(result).toEqual({ procedureElement: 't1' });
      expect(esClient.index).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'procedure_element', id: 'pk1' }),
      );
    });

    test('does nothing when the document count does not exceed the trigger', async () => {
      const arangoDb = makeArangoDb({
        queryImpl: async (query) => {
          if (query.includes('RETURN timestamp')) return makeCursor(['t0']);
          return makeCursor([]);
        },
      });
      const esClient = makeEsClient();

      const result = await initialSync({}, arangoDb, esClient, ['element']);

      expect(result).toEqual({});
      expect(esClient.index).not.toHaveBeenCalled();
    });

    test('logs an error and continues when indexing fails', async () => {
      const arangoDb = makeArangoDb({
        queryImpl: async (query) => {
          if (query.includes('RETURN timestamp')) return makeCursor(['t0', 't1']);
          if (query.includes('RETURN {doc: doc, timestamp: timestamp}')) {
            return makeCursor(
              [{ doc: { _key: 'k1', execution_id: 'x1', elem_id: 'e1', version_id: '' }, timestamp: 't1' }],
              1,
            );
          }
          return makeCursor([]);
        },
      });
      const esClient = makeEsClient({
        indexImpl: async () => {
          throw new Error('index failure');
        },
      });

      await initialSync({}, arangoDb, esClient, ['element']);

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error indexing document'));
    });
  });

  describe('incrementalSync', () => {
    test('indexes documents for element and procedureElement collections', async () => {
      const arangoDb = makeArangoDb({
        queryImpl: async (query) => {
          if (query.includes('FOR doc IN element')) {
            return makeCursor(
              [{ doc: { _key: 'k1', execution_id: 'x1', elem_id: 'e1', version_id: '' }, timestamp: 'te' }],
              1,
            );
          }
          if (query.includes('FOR doc IN procedureElement')) {
            return makeCursor(
              [{ doc: { _key: 'pk1', procedure_id: 'p1', version_id: 'ver1' }, timestamp: 'tp' }],
              1,
            );
          }
          if (query.includes('FOR execution IN execution')) return makeCursor([{ venue_id: 'v1' }]);
          if (query.includes('FOR venue IN venue')) return makeCursor([{ venue_id: 'v1' }]);
          if (query.includes('FOR runRecord IN runRecord')) return makeCursor([{ _to: 'element/e1' }]);
          if (query.includes('FOR procedure IN procedure')) return makeCursor([{ procedure_id: 'p1' }]);
          if (query.includes('FOR procedureVersion IN procedureVersion')) return makeCursor([{ version_id: 'ver1' }]);
          return makeCursor([]);
        },
      });
      const esClient = makeEsClient();

      const result = await incrementalSync({}, arangoDb, esClient, ['element', 'procedureElement']);

      expect(result).toEqual({ element: 'te', procedureElement: 'tp' });
      expect(esClient.index).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'element', id: 'k1' }),
      );
      expect(esClient.index).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'procedure_element', id: 'pk1' }),
      );
    });

    test('uses the existing lastTimestamp and logs indexing errors', async () => {
      const arangoDb = makeArangoDb({
        queryImpl: async (query) => {
          if (query.includes('FOR doc IN element')) {
            return makeCursor(
              [{ doc: { _key: 'k1', execution_id: 'x1', elem_id: 'e1', version_id: '' }, timestamp: 'te' }],
              1,
            );
          }
          return makeCursor([]);
        },
      });
      const esClient = makeEsClient({
        indexImpl: async () => {
          throw new Error('index failure');
        },
      });

      await incrementalSync({ element: 'prev' }, arangoDb, esClient, ['element']);

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error indexing document'));
    });
  });
});
