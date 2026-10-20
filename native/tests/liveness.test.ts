import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Socket, AddressInfo } from 'node:net';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { Adb } from '../src/adb';
import { MirrorSession, DEFAULT_QUALITY } from '../src/session';

for (const terminal of ['timeout', 'companion-lost', 'process-exit'])
  test(
    'idle heartbeat survives, then ' +
      terminal +
      ' ends once with the correct reason and cleans resources',
    async () => {
      const packet = (type: number, flags: number, body: Buffer) => {
        const header = Buffer.alloc(20);
        header.writeUInt32BE(0x4d505631);
        header[4] = type;
        header[5] = flags;
        header.writeUInt32BE(body.length, 8);
        return Buffer.concat([header, body]);
      };
      let child: ChildProcessWithoutNullStreams | undefined,
        peer: Socket | undefined,
        timer: ReturnType<typeof setInterval> | undefined;
      const commands: string[] = [],
        ended: string[] = [];
      const server = createServer((socket) => {
        peer = socket;
        let bootstrap = Buffer.alloc(0),
          authenticated = false;
        socket.on('data', (data) => {
          if (authenticated) return;
          bootstrap = Buffer.concat([bootstrap, data]);
          if (bootstrap.length < 32) return;
          authenticated = true;
          socket.write(
            packet(
              1,
              0,
              Buffer.from(
                JSON.stringify({
                  width: 720,
                  height: 1600,
                  sourceWidth: 720,
                  sourceHeight: 1600,
                  rotation: 0,
                  codec: 'h264',
                }),
              ),
            ),
          );
          socket.write(packet(2, 2, Buffer.from([0, 0, 0, 1, 0x67, 0x42, 0, 0x1f])));
          timer = setInterval(
            () => socket.write(packet(5, 0, Buffer.from('{"kind":"heartbeat"}'))),
            30,
          );
        });
        socket.on('end', () => child?.kill());
        socket.on('error', () => {});
      }).listen(0, '127.0.0.1');
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      class Transport extends Adb {
        currentIme = 'keyboard/.Ime';
        override async shell(_serial: string, args: string[]): Promise<string> {
          commands.push(args.join(' '));
          if (args[0] === 'getprop') return '31';
          if (args[0] === 'settings') return this.currentIme;
          if (args[0] === 'ime' && args[1] === 'set') this.currentIme = args[2];
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
      let video = 0,
        audio = 0,
        heartbeats = 0;
      session.on('video', () => video++);
      session.on('audio', () => audio++);
      session.on('heartbeat', () => heartbeats++);
      session.on('ended', (reason) => ended.push(reason));
      try {
        await session.start();
        (session as unknown as { socket: Socket }).socket.setTimeout(180);
        await new Promise((resolve) => setTimeout(resolve, 650));
        assert.equal(session.state, 'mirroring');
        assert.ok(heartbeats >= 5);
        assert.equal(video, 1);
        assert.equal(audio, 0);
        assert.deepEqual(ended, []);
        clearInterval(timer);
        timer = undefined;
        if (terminal === 'companion-lost') peer!.write(packet(4, 0, Buffer.from('companion-lost')));
        if (terminal === 'process-exit') child!.stdin.end();
        await Promise.race([
          once(session, 'ended'),
          new Promise((_, reject) =>
            setTimeout(() => reject(Error('Lost connection was not detected')), 3000),
          ),
        ]);
        await session.stop();
        assert.deepEqual(ended, [terminal]);
        assert.equal(adb.currentIme, 'keyboard/.Ime');
        if (terminal === 'process-exit')
          assert.equal(child!.exitCode, 0, 'A successful process exit must not imply user intent');
        assert.ok(commands.includes('forward --remove tcp:' + port));
        assert.ok(commands.some((c) => c.startsWith('rm -f /data/local/tmp/mp_')));
      } finally {
        clearInterval(timer);
        await session.stop();
        peer?.destroy();
        child?.kill();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
