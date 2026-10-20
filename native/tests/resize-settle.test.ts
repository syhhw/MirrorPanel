import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accommodatedBounds, MIRROR_BARS } from '../src/window-sizing';
const area = { x: -1920, y: 0, width: 1920, height: 1080 };
test('portrait lateral shrink snaps back; reducing height changes the settled scale', () => {
  const initial = { x: -1500, y: 100, width: 360, height: 800 + MIRROR_BARS };
  assert.deepEqual(accommodatedBounds({ ...initial, width: 270 }, 0.45, area), initial);
  assert.deepEqual(accommodatedBounds({ ...initial, height: 700 + MIRROR_BARS }, 0.45, area), {
    ...initial,
    width: 315,
    height: 700 + MIRROR_BARS,
  });
});
test('portrait enlargement follows the long side and preserves the Windows position', () => {
  const height = 900 + MIRROR_BARS;
  const next = accommodatedBounds({ x: -1500, y: 100, width: 360, height }, 0.45, area);
  assert.deepEqual(next, { x: -1500, y: 1080 - height, width: 405, height });
  assert.deepEqual(accommodatedBounds(next, 0.45, area), next);
});
test('landscape uses width and includes native frame insets without distorting the video', () => {
  const next = accommodatedBounds({ x: -1800, y: 20, width: 1008, height: 500 }, 16 / 9, area, {
    width: 8,
    height: 96,
  });
  assert.deepEqual(next, { x: -1800, y: 20, width: 1008, height: 659 });
});
test('minimum, huge bounds, negative monitor coordinates and repeated settling remain bounded', () => {
  for (const ratio of [0.45, 1, 16 / 9])
    for (const size of [1, 200, 9000]) {
      let next = accommodatedBounds({ x: -2000, y: -20, width: size, height: size }, ratio, area);
      for (let i = 0; i < 10; i++) next = accommodatedBounds(next, ratio, area);
      assert.ok(next.width >= 240 && next.x >= area.x && next.y >= area.y);
      assert.ok(
        next.x + next.width <= area.x + area.width && next.y + next.height <= area.y + area.height,
      );
      assert.ok(Math.abs(next.width / (next.height - MIRROR_BARS) - ratio) < 0.005);
    }
  assert.throws(() => accommodatedBounds(area, NaN, area));
});
