import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Adb } from '../src/adb';
import { MirrorSession } from '../src/session';
const root = process.cwd(),
  adb = new Adb(join(root, 'resources/adb/adb.exe'));
const serials = process.argv.slice(2);
assert.equal(
  serials.length,
  2,
  'Pass two authorized test device serials; rotation changes only the first.',
);
const sessions = serials.map(
  (serial) =>
    new MirrorSession(
      serial,
      { maxSize: 1280, fps: 30, bitrate: 4000000 },
      adb,
      join(root, 'resources'),
    ),
);
const counts = [0, 0],
  sizes: unknown[][] = [[], []],
  ended: string[] = [];
sessions.forEach((s, i) => {
  s.on('video', () => counts[i]++);
  s.on('info', (info) => sizes[i].push(info));
  s.on('ended', (reason) => ended.push(reason));
  s.on('log', (value) => console.log(i, value));
});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let rotation = 'free',
  fixed = 'default',
  ignore = 'false',
  baselineForwards = '';
async function run() {
  rotation = (await adb.shell(serials[0], ['wm', 'user-rotation'])).trim();
  fixed = (await adb.shell(serials[0], ['wm', 'fixed-to-user-rotation'])).trim();
  ignore = (await adb.shell(serials[0], ['wm', 'get-ignore-orientation-request'])).includes('true')
    ? 'true'
    : 'false';
  baselineForwards = await adb.run(['forward', '--list']);
  await adb.shell(serials[0], ['wm', 'fixed-to-user-rotation', 'enabled']);
  await adb.shell(serials[0], ['wm', 'user-rotation', 'lock', '0']);
  await delay(700);
  await Promise.all(sessions.map((s) => s.start()));
  await delay(1500);
  assert.ok(counts.every((n) => n > 5));
  sessions[0].startRecording(join(root, 'build/smoke/rotation-' + Date.now() + '.mp4'));
  await delay(1000);
  await adb.shell(serials[0], ['wm', 'set-ignore-orientation-request', 'true']);
  await adb.shell(serials[0], ['wm', 'user-rotation', 'lock', '1']);
  for (let i = 0; i < 30 && sizes[0].length < 2; i++) await delay(200);
  assert.ok(sizes[0].length >= 2, 'Rotation did not restart encoder: ' + JSON.stringify(sizes[0]));
  assert.equal(sessions[0].recording, undefined, 'Rotation must finalize the old-sized recording');
  sessions[0].control({ type: 'key', code: 3 });
  await delay(500);
  const focus = await adb.shell(serials[0], ['dumpsys', 'window', 'windows']);
  assert.match(focus, /Launcher|launcher|NexusLauncherActivity/);
  await sessions[0].stop();
  const before = counts[1];
  await delay(600);
  assert.ok(counts[1] > before, 'Stopping phone killed TV stream');
  // App process death must also stop capture and remove its ADB forward.
  await adb.shell(serials[1], ['am', 'force-stop', 'com.mirrorpanel.companion']);
  for (let i = 0; i < 30 && sessions[1].state !== 'stopped'; i++) await delay(200);
  assert.equal(sessions[1].state, 'stopped');
  assert.ok(ended.includes('companion-lost'));
  const forwards = await adb.run(['forward', '--list']);
  assert.equal(forwards.trim(), baselineForwards.trim());
  const result = {
    ok: true,
    serials,
    frames: counts,
    sizes,
    ended,
    isolatedSessions: true,
    rotationFinalizedRecording: true,
    forwardsRestored: true,
  };
  writeFileSync('build/smoke/lifecycle-result.json', JSON.stringify(result, null, 2));
  console.log('LIFECYCLE_OK', JSON.stringify(result));
}
void run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(sessions.map((s) => s.stop()));
    await adb.shell(serials[0], ['wm', 'user-rotation', ...rotation.split(/\s+/)]);
    await adb.shell(serials[0], ['wm', 'set-ignore-orientation-request', ignore]);
    await adb.shell(serials[0], ['wm', 'fixed-to-user-rotation', fixed]);
  });
