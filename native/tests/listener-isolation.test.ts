import assert from 'node:assert/strict';
import test from 'node:test';
import { Adb } from '../src/adb';
import type { Packet } from '../src/protocol';
import { MirrorSession, DEFAULT_QUALITY } from '../src/session';

const packet = (type: number, flags: number, data: Buffer): Packet => ({
  type,
  flags,
  pts: 0,
  data,
});
/** handle() is what the socket 'data' handler runs; anything it throws ends the session. */
const handle = (session: MirrorSession, value: Packet) =>
  (session as unknown as { handle(value: Packet): void }).handle(value);
const newSession = () => new MirrorSession('fixture', DEFAULT_QUALITY, new Adb('unused'), 'unused');

test('a throwing app listener is reported instead of ending the session', () => {
  const session = newSession();
  const diagnostics: unknown[] = [];
  session.on('diagnostic', (name, data) => diagnostics.push([name, data]));
  session.on('video', () => {
    throw new Error('Fila de controle cheia');
  });
  session.on('heartbeat', () => {
    throw new Error('listener bug');
  });
  assert.doesNotThrow(() => handle(session, packet(2, 1, Buffer.from([0, 0, 0, 1, 0x65]))));
  assert.doesNotThrow(() => handle(session, packet(5, 0, Buffer.from('{"kind":"heartbeat"}'))));
  assert.deepEqual(diagnostics, [
    ['listener-error', { event: 'video', message: 'Error: Fila de controle cheia' }],
    ['listener-error', { event: 'heartbeat', message: 'Error: listener bug' }],
  ]);
});

test('a malformed packet is still a protocol error', () => {
  const session = newSession();
  assert.throws(() => handle(session, packet(5, 0, Buffer.from('{not json'))));
  assert.throws(() => handle(session, packet(1, 0, Buffer.from('{}'))));
});
