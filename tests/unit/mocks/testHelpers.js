/**
 * Shared unit-test helpers.
 */

/**
 * Build a mock ArangoDB cursor from an array of results.
 *
 * The production code iterates cursors using the `hasNext` property (not a
 * function) and awaits `next()`. This mock mirrors that contract: `hasNext`
 * is a getter that reflects whether unread items remain.
 */
function makeCursor(items = [], count) {
  let index = 0;
  const cursor = {
    get hasNext() {
      return index < items.length;
    },
    next: jest.fn(async () => items[index++]),
  };
  if (count !== undefined) {
    cursor.count = count;
  } else {
    cursor.count = items.length;
  }
  return cursor;
}

/**
 * Snapshot process.env and return a restore function.
 */
function snapshotEnv() {
  const original = { ...process.env };
  return function restore() {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, original);
  };
}

module.exports = { makeCursor, snapshotEnv };
