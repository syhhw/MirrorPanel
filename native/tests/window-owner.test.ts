import assert from 'node:assert/strict';
import test from 'node:test';
import { findBySender } from '../src/window-owner';

/** Mimics Electron: reading webContents from a destroyed window throws. */
function fakeWindow(contents: object, destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    get webContents(): unknown {
      if (destroyed) throw new Error('Object has been destroyed');
      return contents;
    },
  };
}

test('a closing mirror listed first does not break messages from another mirror', () => {
  const closingContents = {};
  const liveContents = {};
  const entries = [
    { id: 'closing', window: fakeWindow(closingContents, true) },
    { id: 'live', window: fakeWindow(liveContents) },
  ];
  assert.equal(findBySender(entries, liveContents)?.id, 'live');
  assert.equal(findBySender(entries, closingContents), undefined);
});

test('unknown senders find nothing', () => {
  const entries = [{ id: 'live', window: fakeWindow({}) }];
  assert.equal(findBySender(entries, {}), undefined);
  assert.equal(findBySender([], {}), undefined);
});
