import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, AddressInfo } from 'node:net';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { Adb } from '../src/adb';
import { MirrorSession, DEFAULT_QUALITY, refusalMessage } from '../src/session';
import { setLanguage } from '../src/i18n';

test('busy and blocked-indicator refusals have distinct messages in both languages', () => {
  const busy = refusalMessage('companion-busy');
  const blocked = refusalMessage('indicator-blocked');
  assert.match(busy!, /já está espelhando em outro MirrorPanel/);
  assert.match(blocked!, /notificações .* desligadas/);
  setLanguage('en');
  try {
    assert.match(refusalMessage('companion-busy')!, /already mirroring in another MirrorPanel/);
    assert.match(refusalMessage('indicator-blocked')!, /notifications are off/);
  } finally {
    setLanguage('pt');
  }
  assert.notEqual(busy, blocked);
  for (const other of ['companion-lost', 'phone-stop', '', 'Companion ocupado'])
    assert.equal(refusalMessage(other), undefined);
});

/** Runs a session against a server whose Companion refused, as the Android server reports it. */
async function refusedStart(reason: string) {
  const packet = (type: number, body: Buffer) => {
    const header = Buffer.alloc(20);
    header.writeUInt32BE(0x4d505631);
    header[4] = type;
    header.writeUInt32BE(body.length, 8);
    return Buffer.concat([header, body]);
  };
  let child: ChildProcessWithoutNullStreams | undefined;
  const commands: string[] = [],
    ended: string[] = [];
  const server = createServer((socket) => {
    let received = 0;
    socket.on('data', (data) => {
      if (received < 32 && (received += data.length) >= 32)
        socket.write(packet(4, Buffer.from(reason)));
    });
    // Like the Android server, exit only after the desktop has read the reason and closed.
    socket.on('end', () => {
      socket.end();
      child?.kill();
    });
    socket.on('error', () => {});
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  class Transport extends Adb {
    override async shell(_serial: string, args: string[]): Promise<string> {
      commands.push(args.join(' '));
      if (args[0] === 'getprop') return '31';
      if (args[0] === 'settings') return 'keyboard/.Ime';
      return '';
    }
    override async device(_serial: string, args: string[]): Promise<string> {
      commands.push(args.join(' '));
      return args[0] === 'forward' && args[1] === 'tcp:0' ? String(port) : '';
    }
    override launch(): ChildProcessWithoutNullStreams {
      child = spawn(
        process.execPath,
        [
          '-e',
          "process.stdin.resume();process.stdin.on('end',()=>process.exit(0));console.log('MIRRORPANEL_READY 1234');setInterval(()=>{},1000)",
        ],
        { stdio: 'pipe', windowsHide: true },
      );
      return child;
    }
  }
  const adb = new Transport('unused'),
    session = new MirrorSession('fixture', DEFAULT_QUALITY, adb, 'unused');
  session.on('ended', (why) => ended.push(why));
  const began = Date.now();
  try {
    const error = await session.start().then(
      () => undefined,
      (e: Error) => e,
    );
    return { error, ms: Date.now() - began, ended, commands, state: session.state };
  } finally {
    await session.stop();
    child?.kill();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

for (const reason of ['companion-busy', 'indicator-blocked'])
  test(
    reason + ' fails the start at once with its explanation, without retry or IME changes',
    async () => {
      const result = await refusedStart(reason);
      assert.equal(result.error?.message, refusalMessage(reason));
      assert.ok(result.ms < 5000, 'The refusal must not wait for the 15 s indicator timeout');
      // start-failed is the reason main.ts never retries; a retry would be refused again.
      assert.deepEqual(result.ended, ['start-failed']);
      assert.equal(result.state, 'stopped');
      assert.ok(
        !result.commands.some((c) => c.startsWith('ime ')),
        'The keyboard must be untouched',
      );
      assert.ok(result.commands.some((c) => c.startsWith('forward --remove tcp:')));
      assert.ok(result.commands.some((c) => c.startsWith('rm -f /data/local/tmp/mp_')));
    },
  );

test('the refusal is reported in English when the interface is in English', async () => {
  setLanguage('en');
  try {
    const result = await refusedStart('companion-busy');
    assert.equal(
      result.error?.message,
      'This phone is already mirroring in another MirrorPanel. Stop mirroring there and try again.',
    );
  } finally {
    setLanguage('pt');
  }
});
