import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accommodatedBounds } from '../src/window-sizing';
const area = { x: -1920, y: 0, width: 1920, height: 1080 };
test('portrait lateral shrink snaps back; reducing height changes the settled scale', () => {
  const initial = { x: -1500, y: 100, width: 360, height: 886 };
  assert.deepEqual(accommodatedBounds({ ...initial, width: 270 }, 0.45, area), initial);
  assert.deepEqual(accommodatedBounds({ ...initial, height: 786 }, 0.45, area), {
    ...initial,
    width: 315,
    height: 786,
  });
});
test('portrait enlargement follows the long side and preserves the Windows position', () => {
  const next = accommodatedBounds({ x: -1500, y: 100, width: 360, height: 986 }, 0.45, area);
  assert.deepEqual(next, { x: -1500, y: 94, width: 405, height: 986 });
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
      assert.ok(Math.abs(next.width / (next.height - 86) - ratio) < 0.005);
    }
  assert.throws(() => accommodatedBounds(area, NaN, area));
});
