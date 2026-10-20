import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlPacket, validText, validateControl } from '../src/protocol';
import { Gestures } from '../src/gestures';

test('Unicode survives UTF-8 framing without normalization or splitting surrogate pairs', () => {
  const text = 'ação 日本語 中文 한국어 العربية עברית e\u0301 👩🏽‍💻 👨‍👩‍👧‍👦 𐐷\n';
  const bytes = controlPacket({ type: 'text', text });
  assert.equal(JSON.parse(bytes.subarray(4).toString('utf8')).text, text);
  assert.equal(validText('😀'.repeat(16384)), true);
  assert.equal(validText('😀'.repeat(16385)), false);
  for (const text of ['\ud800', '\udc00', 'a\ud83dx']) assert.equal(validText(text), false);
});
test('three fingers keep stable IDs when the middle pointer lifts, then cancel', () => {
  const events: ReturnType<typeof validateControl>[] = [];
  const g = new Gestures((e) => events.push(validateControl(e)));
  g.down(100, 0.2, 0.2);
  g.down(900, 0.5, 0.5);
  g.down(5000, 0.8, 0.8);
  g.up(900, 0.6, 0.6);
  g.move(5000, 0.9, 0.9);
  g.cancel();
  const touches = events.filter((e) => e.type === 'touch');
  assert.deepEqual(
    touches[3].pointers?.map((p) => p.id),
    [1, 2, 3],
  );
  assert.equal(touches[3].id, 2);
  assert.deepEqual(
    touches[4].pointers?.map((p) => p.id),
    [1, 3],
  );
  assert.equal(touches[4].id, 3);
  assert.equal(touches.at(-1)?.action, 3);
  assert.equal(g.active, false);
});
test('Alt anchor remains after mouse release and is explicitly released on toggle', () => {
  const events: ReturnType<typeof validateControl>[] = [];
  const g = new Gestures((e) => events.push(validateControl(e)));
  g.anchorAt(0.3, 0.3);
  g.down(17, 0.7, 0.7);
  g.up(17, 0.8, 0.8);
  assert.equal(g.active, true);
  g.anchorAt(0.1, 0.1);
  assert.equal(g.active, false);
  assert.equal(events.length, 4);
});
test('duplicate IDs, missing changed pointer and excessive contacts are rejected', () => {
  for (const pointers of [
    [
      { id: 1, x: 0, y: 0 },
      { id: 1, x: 1, y: 1 },
    ],
    [{ id: 5, x: 0, y: 0 }],
    Array.from({ length: 11 }, (_, id) => ({ id, x: 0, y: 0 })),
  ])
    assert.throws(() => validateControl({ type: 'touch', action: 0, id: 1, pointers }));
});
