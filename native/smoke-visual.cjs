const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { execFile } = require('node:child_process'),
  { promisify } = require('node:util');
const execute = promisify(execFile),
  root = __dirname,
  serial = process.argv[2] || 'ZF523DZS5J',
  dir = path.join(root, 'build/smoke');
const profile = path.join(dir, 'ui-preview3-profile');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({ quality: { [serial]: { maxSize: 1280, fps: 30, bitrate: 4000000 } } }),
);
app.setPath('userData', profile);
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-debugging-port', '9342');
process.env.MIRRORPANEL_SMOKE_SERIAL = serial;
const adb = async (...args) =>
  (
    await execute(path.join(root, 'resources/adb/adb.exe'), ['-s', serial, ...args], {
      windowsHide: true,
      timeout: 20000,
      encoding: 'utf8',
    })
  ).stdout.trim();
const delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  errors = [];
app.on('browser-window-created', (_e, w) => {
  w.setIgnoreMouseEvents(true);
  w.setFocusable(false);
  w.webContents.on('render-process-gone', (_e, e) => errors.push(e));
});
require('./build/desktop/main.cjs');
let mirror, panel;
const evalMirror = (source) => mirror.webContents.executeJavaScript(source, true),
  evalPanel = (source) => panel.webContents.executeJavaScript(source, true);
async function until(fn, message, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await delay(100);
  }
  throw Error(message);
}
const shot = async (window, name) => {
  await delay(250);
  fs.writeFileSync(path.join(dir, name + '.png'), (await window.capturePage()).toPNG());
};
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
      'No video',
      60000,
    );
    panel = BrowserWindow.getAllWindows().find((w) => w !== mirror);
    await adb('shell', 'am', 'force-stop', 'com.mirrorpanel.fixture');
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
    await delay(1200);
    const geometry = await evalMirror(
      `(()=>{const r=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}};return {viewport:r(document.querySelector('.viewport')),canvas:r(document.querySelector('canvas')),top:r(document.querySelector('.mirror-titlebar')),bottom:r(document.querySelector('.android-navigation')),window:{width:innerWidth,height:innerHeight}}})()`,
    );
    assert.equal(geometry.top.height, 38);
    assert.equal(geometry.bottom.height, 48);
    assert.ok(
      Math.abs(geometry.viewport.width - geometry.canvas.width) < 2,
      'Side bars remain in normal window',
    );
    assert.ok(
      Math.abs(geometry.viewport.height - geometry.canvas.height) < 2,
      'Video not fitted to window',
    );
    assert.equal(await evalMirror('Boolean(document.querySelector(".mirror-help"))'), false);
    await shot(mirror, 'preview3-mirror');
    await shot(panel, 'preview3-panel');
    await assert.rejects(
      evalMirror('window.mirrorpanel.windowAction("arbitrary-window")'),
      /inválida/,
    );
    await evalMirror('document.getElementById("more").click()');
    await shot(mirror, 'preview3-menu');
    await evalMirror('document.getElementById("pin-window").click()');
    await until(() => mirror.isAlwaysOnTop(), 'Pin failed');
    await evalMirror('document.getElementById("pin-window").click()');
    await until(() => !mirror.isAlwaysOnTop(), 'Unpin failed');
    await evalMirror('document.getElementById("device-settings").click()');
    await until(
      () => evalPanel('document.querySelector("dialog").open'),
      'Settings menu did not open',
    );
    assert.ok(
      await evalPanel('document.querySelector("dialog").getBoundingClientRect().height>200'),
      'Settings dialog is not visible',
    );
    assert.equal(await evalPanel('document.querySelector("fieldset").disabled'), true);
    await shot(panel, 'preview3-settings');
    await evalPanel('document.querySelector("dialog").close()');
    await evalPanel('document.getElementById("show-serial").click()');
    await until(
      () =>
        evalPanel(
          'document.getElementById("device-list").textContent.includes(' +
            JSON.stringify(serial) +
            ')',
        ),
      'Serial preference not rendered',
    );
    await evalPanel('document.getElementById("show-serial").click()');
    await evalMirror('window.mirrorpanel.windowAction("maximize")');
    await delay(600);
    assert.ok(mirror.isMaximized());
    await evalMirror('window.mirrorpanel.windowAction("maximize")');
    await delay(600);
    assert.ok(!mirror.isMaximized());
    await evalMirror('window.mirrorpanel.windowAction("minimize")');
    await delay(400);
    assert.ok(mirror.isMinimized());
    mirror.restore();
    console.log('VISUAL_CONTROLS_OK', JSON.stringify(geometry));
    // Leave a stable window available for passive REA observation and ensure no idle reconnect.
    const contentsId = mirror.webContents.id;
    await delay(40000);
    const state = await evalPanel('window.mirrorpanel.snapshot()');
    assert.equal(state.devices.find((d) => d.serial === serial).session, 'mirroring');
    assert.equal(state.logs.filter((l) => /Reconectando/.test(l.message)).length, 0);
    assert.equal(mirror.webContents.id, contentsId);
    const metrics = await evalMirror('({...document.querySelector("canvas").dataset})');
    await evalMirror('window.mirrorpanel.windowAction("close")');
    await delay(1800);
    const after = await evalPanel('window.mirrorpanel.snapshot()');
    assert.equal(after.devices.find((d) => d.serial === serial).session, null);
    assert.deepEqual(errors, []);
    const result = {
      ok: true,
      serial,
      geometry,
      metrics,
      pin: true,
      maximizeRestore: true,
      minimize: true,
      settingsFromMirror: true,
      serialPreference: true,
      unknownActionRejected: true,
      idleWithoutReconnectSeconds: 40,
      closeClean: true,
      errors,
    };
    fs.writeFileSync(
      path.join(dir, 'preview3-visual-result.json'),
      JSON.stringify(result, null, 2),
    );
    console.log('VISUAL_REGRESSION_OK', JSON.stringify(result));
  } catch (error) {
    console.error(error);
    fs.writeFileSync(
      path.join(dir, 'preview3-visual-result.json'),
      JSON.stringify({ ok: false, error: String(error) }, null, 2),
    );
    process.exitCode = 1;
  } finally {
    await adb('shell', 'am', 'force-stop', 'com.mirrorpanel.fixture').catch(() => {});
    app.quit();
  }
}, 1000);
