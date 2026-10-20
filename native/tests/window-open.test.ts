import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIRROR_BARS,
  accommodatedBounds,
  initialMirrorSize,
  parseDisplayRatio,
} from '../src/window-sizing';

const fullHd = { x: 0, y: 0, width: 1920, height: 1032 };

test('the device ratio comes from wm size, preferring an override resolution', () => {
  assert.equal(parseDisplayRatio('Physical size: 720x1600\n'), 0.45);
  assert.equal(parseDisplayRatio('Physical size: 1080x2400\nOverride size: 720x1600\n'), 0.45);
  assert.equal(parseDisplayRatio('error: no devices'), undefined);
});

test('a portrait mirror opens with the phone shape at a comfortable height', () => {
  const size = initialMirrorSize(0.45, fullHd);
  assert.deepEqual(size, { width: 337, height: 835 });
});

test('the opening size is already settled, so the first frame does not resize it', () => {
  for (const ratio of [0.45, 9 / 19.5, 16 / 9]) {
    const size = initialMirrorSize(ratio, fullHd);
    const settled = accommodatedBounds({ x: 100, y: 50, ...size }, ratio, fullHd);
    assert.equal(settled.width, size.width);
    assert.ok(Math.abs(settled.height - size.height) <= 1);
  }
});

test('landscape devices open wide and small screens stay within limits', () => {
  assert.deepEqual(initialMirrorSize(16 / 9, fullHd), { width: 960, height: 540 + MIRROR_BARS });
  const small = initialMirrorSize(0.45, { x: 0, y: 0, width: 1366, height: 728 });
  assert.ok(small.height <= 728);
  assert.throws(() => initialMirrorSize(0, fullHd));
});
