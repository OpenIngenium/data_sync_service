const { makeCursor } = require('./testHelpers');

/**
 * Create a mock ArangoDB database object.
 *
 * `queryImpl` (optional) lets a test control what each `query()` call returns.
 * By default `query()` resolves to an empty cursor and `exists()` resolves true.
 */
function makeArangoDb({ queryImpl, exists = true } = {}) {
  return {
    exists: jest.fn(async () => exists),
    query: jest.fn(queryImpl || (async () => makeCursor([]))),
  };
}

module.exports = { makeArangoDb };
