import assert from 'node:assert/strict';
import test from 'node:test';
import { revealPanel } from '../src/single-instance';

/** Mimics Electron: a destroyed window throws on every call. */
function fakePanel(state: { minimized?: boolean; destroyed?: boolean } = {}) {
  const calls: string[] = [];
  const call = (name: string) => () => {
    if (state.destroyed) throw new Error('Object has been destroyed');
    calls.push(name);
  };
  return {
    calls,
    isDestroyed: () => Boolean(state.destroyed),
    isMinimized: () => {
      if (state.destroyed) throw new Error('Object has been destroyed');
      return Boolean(state.minimized);
    },
    restore: call('restore'),
    show: call('show'),
    focus: call('focus'),
  };
}

test('a second launch restores a minimized panel and focuses it', () => {
  const panel = fakePanel({ minimized: true });
  assert.equal(revealPanel(panel), true);
  assert.deepEqual(panel.calls, ['restore', 'show', 'focus']);
});

test('a panel behind other windows is shown and focused without changing its size', () => {
  const panel = fakePanel();
  assert.equal(revealPanel(panel), true);
  assert.deepEqual(panel.calls, ['show', 'focus']);
});

test('a panel that already closed while the app quits is left alone instead of throwing', () => {
  const panel = fakePanel({ destroyed: true });
  assert.equal(revealPanel(panel), false);
  assert.equal(revealPanel(undefined), false);
});
