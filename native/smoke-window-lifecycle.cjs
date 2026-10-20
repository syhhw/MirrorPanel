const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { execFile, execFileSync } = require('node:child_process'),
  { promisify } = require('node:util');
const execute = promisify(execFile);
const root = __dirname,
  serial = process.argv[2] || 'ZF523DZS5J',
  dir = path.join(root, 'build/smoke');
const profile = path.join(dir, 'preview5-window-profile');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({ quality: { [serial]: { maxSize: 1280, fps: 30, bitrate: 4000000 } } }),
);
app.setPath('userData', profile);
process.env.MIRRORPANEL_SMOKE_SERIAL = serial;
const delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  errors = [],
  events = [];
const adb = async (...args) =>
  (
    await execute(path.join(root, 'resources/adb/adb.exe'), ['-s', serial, ...args], {
      windowsHide: true,
      timeout: 20000,
      encoding: 'utf8',
    })
  ).stdout.trim();
const readBefore = (...args) =>
  execFileSync(path.join(root, 'resources/adb/adb.exe'), ['-s', serial, ...args], {
    windowsHide: true,
    timeout: 20000,
    encoding: 'utf8',
  }).trim();
const onlyDevice = (value) =>
  value
    .split(/\r?\n/)
    .filter((line) => line.startsWith(serial + ' '))
    .sort()
    .join('\n');
const before = {
  ime: readBefore('shell', 'settings', 'get', 'secure', 'default_input_method'),
  awake: readBefore('shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in'),
  forwards: onlyDevice(readBefore('forward', '--list')),
};
const cleanupState = async () => ({
  ime: await adb('shell', 'settings', 'get', 'secure', 'default_input_method'),
  awake: await adb('shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in'),
  forwards: onlyDevice(await adb('forward', '--list')),
});
app.on('browser-window-created', (_e, w) => {
  w.setIgnoreMouseEvents(true);
  w.setFocusable(false);
  w.webContents.on('render-process-gone', (_e, d) => errors.push(d));
  w.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) {
      errors.push(message);
      console.error('RENDERER_ERROR', message);
    }
  });
});
require('./build/desktop/main.cjs');
let mirror, panel;
const evalMirror = (s) => mirror.webContents.executeJavaScript(s, true),
  evalPanel = (s) => panel.webContents.executeJavaScript(s, true);
const snapshot = () => evalPanel('window.mirrorpanel.snapshot()');
async function until(fn, message, timeout = 40000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await delay(150);
  }
  throw Error(message);
}
async function click(selector) {
  const p = await evalMirror(
    `(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`,
  );
  for (const type of ['mouseDown', 'mouseUp'])
    mirror.webContents.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 });
  await delay(180);
}
async function geometry() {
  await delay(200);
  return evalMirror(
    `(()=>{const r=e=>{const b=e.getBoundingClientRect();return {width:b.width,height:b.height}};return {canvas:r(document.querySelector('canvas')),viewport:r(document.querySelector('.viewport'))}})()`,
  );
}
async function fitted() {
  const g = await geometry();
  assert.ok(Math.abs(g.canvas.width - g.viewport.width) < 2, JSON.stringify(g));
  assert.ok(Math.abs(g.canvas.height - g.viewport.height) < 2, JSON.stringify(g));
  return g;
}
async function shot(name) {
  await delay(250);
  fs.writeFileSync(path.join(dir, name + '.png'), (await mirror.capturePage()).toPNG());
}
async function losses(count) {
  for (let i = 0; i < count; i++) {
    const prior = (await snapshot()).logs.filter((l) => l.message.startsWith('Espelhando ')).length;
    await adb('shell', 'am', 'force-stop', 'com.mirrorpanel.companion');
    if (i === count - 1) {
      await until(async () => {
        const s = await snapshot();
        return (
          s.devices.find((d) => d.serial === serial).session === null &&
          (await evalMirror('!document.getElementById("reconnect").hidden'))
        );
      }, 'Terminal connection state did not expose reconnect');
    } else {
      await until(async () => {
        const s = await snapshot();
        return (
          s.devices.find((d) => d.serial === serial).session === 'mirroring' &&
          s.logs.filter((l) => l.message.startsWith('Espelhando ')).length > prior
        );
      }, 'Companion loss did not recover');
    }
    events.push({
      loss: i + 1,
      state: (await snapshot()).devices.find((d) => d.serial === serial).session,
    });
    console.log('LOSS_CHECK', events.at(-1));
  }
}
setTimeout(async () => {
  try {
    await until(
      async () => {
        mirror = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('view=mirror'),
        );
        return (
          mirror &&
          (await evalMirror('Number(document.querySelector("canvas")?.dataset.frames||0)>8'))
        );
      },
      'No initial video',
      60000,
    );
    panel = BrowserWindow.getAllWindows().find((w) => w !== mirror);
    const originalId = mirror.webContents.id;
    await adb('shell', 'am', 'start', '-W', '-n', 'com.mirrorpanel.companion/.MainActivity');
    await delay(1000);
    const uiFile = '/data/local/tmp/mp-preview5-ui.xml';
    try {
      await adb('shell', 'uiautomator', 'dump', uiFile);
      const xml = await adb('shell', 'cat', uiFile);
      // The Companion screen follows the phone's language.
      assert.ok(/Your Android is on the computer|Seu Android está no computador/.test(xml));
      assert.ok(!/STOP MIRRORING|PARAR ESPELHAMENTO/i.test(xml));
    } finally {
      await adb('shell', 'rm', '-f', uiFile);
    }
    await shot('preview5-companion');
    await evalMirror('window.mirrorpanel.control({type:"key",code:4})');
    await delay(1200);
    assert.equal((await snapshot()).devices.find((d) => d.serial === serial).session, 'mirroring');
    await adb(
      'shell',
      'am',
      'start',
      '-W',
      '-n',
      'com.mirrorpanel.fixture/.MainActivity',
      '--ez',
      'readonly',
      'true',
    );
    await delay(600);
    // Geometry coverage uses Electron's API. Physical mouse drags are recorded
    // separately; synthetic WM_SIZING must not be reported as a real drag.
    const area = screen.getDisplayMatching(mirror.getBounds()).workArea;
    const sizes = [];
    for (const [width, height] of [
      [360, 886],
      [310, 886],
      [360, 730],
      [600, 1200],
      [240, 620],
    ]) {
      mirror.setBounds({ x: area.x + 100, y: area.y + 40, width, height });
      await delay(900);
      sizes.push({
        requested: { width, height },
        bounds: mirror.getBounds(),
        geometry: await fitted(),
      });
    }
    console.log('SETTLED_GEOMETRY_OK', JSON.stringify(sizes));
    await shot('preview5-resized');
    await click('[data-window="maximize"]');
    await until(() => mirror.isMaximized(), 'Maximize failed');
    await click('[data-window="maximize"]');
    await until(() => !mirror.isMaximized(), 'Restore failed');
    await fitted();
    await click('[data-window="minimize"]');
    await until(() => mirror.isMinimized(), 'Minimize failed');
    await losses(4);
    assert.ok(mirror.isMinimized(), 'Reconnect unexpectedly restored a minimized window');
    mirror.restore();
    await delay(300);
    assert.equal(mirror.webContents.id, originalId);
    await fitted();
    await shot('preview5-disconnected');
    // These exact controls previously failed with "This window has no session".
    await click('[data-window="minimize"]');
    assert.ok(mirror.isMinimized());
    mirror.restore();
    await delay(200);
    await click('[data-window="maximize"]');
    await until(() => mirror.isMaximized(), 'Maximize after end failed');
    await click('[data-window="maximize"]');
    await until(() => !mirror.isMaximized(), 'Restore after end failed');
    await click('#reconnect');
    await until(async () => {
      const s = await snapshot();
      return (
        s.devices.find((d) => d.serial === serial).session === 'mirroring' &&
        (await evalMirror('document.getElementById("video-status").hidden'))
      );
    }, 'Manual retry failed');
    assert.equal(mirror.webContents.id, originalId);
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    await fitted();
    await shot('preview5-reconnected');
    await losses(4);
    const logs = (await snapshot()).logs;
    assert.ok(!logs.some((l) => /stopped on the device|interrompido no aparelho/.test(l.message)));
    await click('[data-window="close"]');
    await until(() => mirror.isDestroyed(), 'Close after terminal session failed');
    await delay(2200);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    assert.equal((await snapshot()).devices.find((d) => d.serial === serial).session, null);
    await until(
      async () => JSON.stringify(await cleanupState()) === JSON.stringify(before),
      'IME, stay-awake or forwards did not return to baseline',
    );
    assert.deepEqual(errors, []);
    const result = {
      ok: true,
      serial,
      resizeMethod: 'Electron.setBounds',
      sizes,
      companionGuidance: true,
      closingPhoneScreenKeepsSession: true,
      recoveredAfterCompanionLoss: true,
      minimizedDuringRecovery: true,
      manualRetrySameWindow: true,
      closeAfterEnded: true,
      imeRestored: true,
      awakeRestored: true,
      forwardsRestored: true,
      events,
      errors,
    };
    fs.writeFileSync(
      path.join(dir, 'preview5-window-result.json'),
      JSON.stringify(result, null, 2),
    );
    console.log('WINDOW_LIFECYCLE_OK', JSON.stringify(result));
  } catch (error) {
    console.error(error);
    fs.writeFileSync(
      path.join(dir, 'preview5-window-result.json'),
      JSON.stringify({ ok: false, error: String(error), events, errors }, null, 2),
    );
    process.exitCode = 1;
  } finally {
    await adb('shell', 'am', 'force-stop', 'com.mirrorpanel.fixture').catch(() => {});
    app.quit();
  }
}, 1000);
