import assert from 'node:assert/strict';
import test from 'node:test';
import { admitFrame, MAX_DECODE_QUEUE } from '../src/video-gate';

const running = { exists: true, closed: false, fresh: false, queueSize: 0 };

test('frames wait for the stream configuration', () => {
  assert.equal(admitFrame({ ...running, exists: false }, true, false, true), 'ignore');
  assert.equal(admitFrame(running, false, false, true), 'ignore');
});

test('a decoder closed by an error recovers on the next keyframe instead of freezing', () => {
  const closed = { ...running, closed: true };
  assert.equal(admitFrame(closed, true, true, false), 'drop-and-sync');
  assert.equal(admitFrame(closed, true, false, false), 'drop-and-sync');
  assert.equal(admitFrame(closed, true, true, true), 'restart-and-decode');
});

test('a full decode queue drops the frame and asks for a keyframe', () => {
  const full = { ...running, queueSize: MAX_DECODE_QUEUE + 1 };
  assert.equal(admitFrame(full, true, false, true), 'drop-and-sync');
  assert.equal(
    admitFrame({ ...running, queueSize: MAX_DECODE_QUEUE }, true, false, false),
    'decode',
  );
});

test('after a gap only a keyframe restarts decoding', () => {
  assert.equal(admitFrame(running, true, true, false), 'drop');
  assert.equal(admitFrame(running, true, true, true), 'restart-and-decode');
  assert.equal(admitFrame(running, true, false, false), 'decode');
});

test('a freshly configured decoder takes the first keyframe without being recreated', () => {
  const fresh = { ...running, fresh: true };
  assert.equal(admitFrame(fresh, true, true, true), 'decode');
  assert.equal(admitFrame(fresh, true, true, false), 'drop');
});
