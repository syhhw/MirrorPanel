// Deliberate fault/feature tests. Never run concurrently with the passive soak.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { execFile } = require('node:child_process'),
  { promisify } = require('node:util');
const execute = promisify(execFile);
const root = __dirname,
  serial = process.argv[2] || 'ZF523DZS5J',
  dir = path.join(root, 'build/smoke');
const profile = path.join(dir, 'preview5-features-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({
    stayAwake: true,
    quality: { [serial]: { maxSize: 1280, fps: 30, bitrate: 4000000 } },
  }),
);
process.env.MIRRORPANEL_SMOKE_SERIAL = serial;
const delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  result = { ok: false, profile, checks: [] },
  errors = [];
const adb = async (...args) =>
  (
    await execute(path.join(root, 'resources/adb/adb.exe'), ['-s', serial, ...args], {
      windowsHide: true,
      timeout: 30000,
      encoding: 'utf8',
    })
  ).stdout.trim();
let mirror, panel;
const evaluate = (s) => mirror.webContents.executeJavaScript(s, true),
  snapshot = () => panel.webContents.executeJavaScript('window.mirrorpanel.snapshot()');
async function until(fn, message, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await Promise.race([fn(), delay(2000).then(() => false)])) return;
    } catch {}
    await delay(150);
  }
  throw Error(message);
}
function pass(name, data = {}) {
  result.checks.push({ name, ...data });
  console.log('PASS', name, JSON.stringify(data));
}
async function crash() {
  const loaded = new Promise((resolve) => mirror.webContents.once('did-finish-load', resolve));
  mirror.webContents.forcefullyCrashRenderer();
  await Promise.race([
    loaded,
    delay(15000).then(() => {
      throw Error('Reload after crash timed out');
    }),
  ]);
}
app.on('browser-window-created', (_e, w) =>
  w.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) errors.push(message);
  }),
);
require('./build/desktop/main.cjs');
setTimeout(async () => {
  try {
    await until(async () => {
      mirror = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('view=mirror'),
      );
      panel = BrowserWindow.getAllWindows().find((w) => w !== mirror);
      return (
        mirror && (await evaluate('Number(document.querySelector("canvas")?.dataset.frames||0)>8'))
      );
    }, 'No decoded video');
    const id = mirror.id,
      sessionId = (await snapshot()).lifecycle[0].id,
      pid = await adb('shell', 'pidof', 'com.mirrorpanel.companion');
    pass('initial-video', { id, sessionId, pid });
    const before = mirror.getContentSize();
    mirror.setContentSize(before[0] - 65, before[1]);
    assert.equal(mirror.getContentSize()[0], before[0] - 65, 'Native resize was intercepted');
    await delay(850);
    assert.ok(Math.abs(mirror.getContentSize()[0] - before[0]) <= 3);
    pass('lateral-free-then-snap', { before, after: mirror.getContentSize() });
    mirror.setContentSize(before[0], before[1] - 100);
    await delay(850);
    const small = mirror.getContentSize();
    assert.ok(small[0] < before[0] - 20);
    pass('height-rescales-width', { small });
    const geometry = await evaluate(
      '(()=>{const c=document.querySelector("canvas").getBoundingClientRect(),v=document.querySelector(".viewport").getBoundingClientRect();return{cw:c.width,ch:c.height,vw:v.width,vh:v.height};})()',
    );
    assert.ok(Math.abs(geometry.cw - geometry.vw) <= 3 && Math.abs(geometry.ch - geometry.vh) <= 3);
    pass('video-fills-settled-window', geometry);
    await evaluate('window.mirrorpanel.windowAction("minimize")');
    await delay(700);
    assert.ok(mirror.isMinimized());
    mirror.restore();
    await evaluate('window.mirrorpanel.windowAction("maximize")');
    await delay(700);
    assert.ok(mirror.isMaximized());
    await evaluate('window.mirrorpanel.windowAction("maximize")');
    await delay(850);
    assert.ok(!mirror.isMaximized());
    assert.equal((await snapshot()).lifecycle[0].id, sessionId);
    pass('minimize-maximize-restore-same-session');
    const button = await evaluate(
      '(()=>{const b=document.querySelector("#home").getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()',
    );
    mirror.webContents.sendInputEvent({
      type: 'mouseDown',
      ...button,
      button: 'left',
      clickCount: 1,
    });
    await delay(120);
    assert.equal(await evaluate('document.querySelectorAll("#home .nav-ripple").length'), 1);
    fs.writeFileSync(path.join(dir, 'preview5-ripple.png'), (await mirror.capturePage()).toPNG());
    mirror.webContents.sendInputEvent({
      type: 'mouseUp',
      ...button,
      button: 'left',
      clickCount: 1,
    });
    await delay(600);
    assert.equal(await evaluate('document.querySelectorAll(".nav-ripple").length'), 0);
    pass('navigation-ripple-visible-and-removed');
    await evaluate('document.querySelector("#home").focus()');
    mirror.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    await delay(100);
    assert.equal(await evaluate('document.querySelectorAll("#home .nav-ripple").length'), 1);
    mirror.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await delay(600);
    pass('keyboard-ripple');
    const fixture = path.join(root, 'build/android/fixture.apk');
    assert.ok(fs.existsSync(fixture));
    mirror.webContents.debugger.attach('1.3');
    for (const type of ['dragEnter', 'dragOver', 'drop'])
      await mirror.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
        type,
        x: 100,
        y: 180,
        data: { items: [], files: [fixture], dragOperationsMask: 1 },
      });
    await until(
      async () => await evaluate('document.body.dataset.apkInstall==="success"'),
      'Dropped APK was not installed',
    );
    assert.ok((await adb('shell', 'pm', 'path', 'com.mirrorpanel.fixture')).startsWith('package:'));
    pass('disk-backed-APK-drop-installed-on-phone');
    await evaluate(
      '(()=>{const d=new DataTransfer();d.items.add(new File(["bogus"],"fake.apk"));document.dispatchEvent(new DragEvent("drop",{dataTransfer:d,bubbles:true,cancelable:true}));})()',
    );
    await until(
      async () => await evaluate('document.body.dataset.apkInstall==="error"'),
      'Synthetic file was not rejected',
    );
    pass('synthetic-file-rejected');
    mirror.webContents.debugger.detach();
    await adb('shell', 'am', 'start', '-W', '-n', 'com.mirrorpanel.fixture/.MainActivity');
    const rect = await evaluate(
      '(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return{x:Math.round(r.x+r.width*.5),y:Math.round(r.y+r.height*.7)}})()',
    );
    mirror.webContents.sendInputEvent({
      type: 'mouseDown',
      ...rect,
      button: 'left',
      clickCount: 1,
    });
    await delay(200);
    await crash();
    await until(
      async () =>
        !mirror.isDestroyed() &&
        (await evaluate('Number(document.querySelector("canvas")?.dataset.frames||0)>5')),
      'Renderer did not recover',
    );
    assert.equal(mirror.id, id);
    assert.equal((await snapshot()).lifecycle[0].id, sessionId);
    assert.equal(await adb('shell', 'pidof', 'com.mirrorpanel.companion'), pid);
    const touch = JSON.parse(
      Buffer.from(
        (
          await adb('exec-out', 'run-as', 'com.mirrorpanel.fixture', 'base64', 'files/touch.json')
        ).replace(/\s/g, ''),
        'base64',
      ).toString(),
    );
    assert.ok(
      touch.some((e) => e.action === 3),
      'Held pointer was not cancelled after crash',
    );
    pass('renderer-crash-recovers-same-window-session-and-Android-process', {
      id,
      sessionId,
      cancelledTouch: true,
    });
    const starts = (await snapshot()).logs.filter((l) =>
      l.message.startsWith('Espelhando '),
    ).length;
    await panel.webContents.executeJavaScript(
      `Promise.all([window.mirrorpanel.start(${JSON.stringify(serial)}),window.mirrorpanel.start(${JSON.stringify(serial)})])`,
    );
    await delay(1200);
    assert.equal(
      (await snapshot()).logs.filter((l) => l.message.startsWith('Espelhando ')).length,
      starts,
    );
    pass('duplicate-start-keeps-session');
    for (let i = 2; i <= 3; i++) {
      if (i === 2) {
        await evaluate('window.mirrorpanel.windowAction("maximize")');
        await delay(700);
      }
      await crash();
      await until(
        async () => await evaluate('Number(document.querySelector("canvas")?.dataset.frames||0)>5'),
        'Repeated crash recovery failed',
      );
      assert.equal((await snapshot()).lifecycle[0].id, sessionId);
      if (i === 2) {
        assert.ok(await evaluate('document.body.classList.contains("window-contained")'));
        await evaluate('window.mirrorpanel.windowAction("maximize")');
        await delay(700);
        pass('maximized-renderer-recovery-keeps-contained-layout');
      }
    }
    await crash();
    await until(
      async () =>
        !(await snapshot()).lifecycle.length &&
        (await evaluate('!document.querySelector("#reconnect").hidden')),
      'Recovery limit did not preserve interactive controls',
    );
    await evaluate('window.mirrorpanel.windowAction("minimize")');
    assert.ok(mirror.isMinimized());
    mirror.restore();
    await evaluate('document.querySelector("#reconnect").click()');
    await until(
      async () => await evaluate('Number(document.querySelector("canvas")?.dataset.frames||0)>8'),
      'Retry after renderer limit failed',
    );
    assert.equal(mirror.id, id);
    pass('repeated-renderer-failure-preserves-controls-and-manual-retry');
    fs.writeFileSync(path.join(dir, 'preview5-features.png'), (await mirror.capturePage()).toPNG());
    await evaluate('window.mirrorpanel.windowAction("close")').catch(() => {});
    await until(
      async () => mirror.isDestroyed() && !(await snapshot()).lifecycle.length,
      'Close did not clean up',
    );
    await delay(2200);
    assert.equal(BrowserWindow.getAllWindows().filter((w) => w !== panel).length, 0);
    pass('toolbar-close-no-reconnect');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    result.ok = true;
  } catch (error) {
    result.error = String(error);
    result.stack = error.stack;
    result.errors = errors;
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(dir, 'preview5-features.json'), JSON.stringify(result, null, 2));
    console.log('PREVIEW5_FEATURES', JSON.stringify(result));
    app.quit();
  }
}, 1000);
