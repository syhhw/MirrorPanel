const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const root = __dirname,
  serial = process.argv[2] || 'emulator-5580',
  dir = path.join(root, 'build/smoke');
const profile = path.join(dir, 'ui-features-profile');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({ quality: { [serial]: { maxSize: 1280, fps: 30, bitrate: 4000000 } } }),
);
app.setPath('userData', profile);
process.env.MIRRORPANEL_SMOKE_SERIAL = serial;
process.env.MIRRORPANEL_TEST_MEDIA_ROOT = path.join(dir, 'ui-media');
const adb = async (...args) =>
  (
    await execute(path.join(root, 'resources/adb/adb.exe'), ['-s', serial, ...args], {
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 2e6,
      encoding: 'utf8',
    })
  ).stdout.trim();
const fixture = async (name) =>
  Buffer.from(
    (await adb('exec-out', 'run-as', 'com.mirrorpanel.fixture', 'base64', 'files/' + name)).replace(
      /\s/g,
      '',
    ),
    'base64',
  ).toString('utf8');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
app.on('browser-window-created', (_e, w) => {
  w.setIgnoreMouseEvents(true);
  w.setFocusable(false);
  w.webContents.on('render-process-gone', (_e, d) => errors.push(d));
});
require('./build/desktop/main.cjs');
let mirror, panel;
const evaluate = (source, gesture = false) => mirror.webContents.executeJavaScript(source, gesture);
async function until(test, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await delay(100);
  }
  throw Error(message);
}
async function clickAt(x, y, modifiers = []) {
  mirror.webContents.sendInputEvent({
    type: 'mouseDown',
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    clickCount: 1,
    modifiers,
  });
  mirror.webContents.sendInputEvent({
    type: 'mouseUp',
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    clickCount: 1,
    modifiers,
  });
  await delay(120);
}
async function consent() {
  const remote = '/data/local/tmp/mp-ui-consent.xml';
  try {
    for (let i = 0; i < 12; i++) {
      if (await evaluate('document.getElementById("audio").getAttribute("aria-pressed")==="true"'))
        return;
      await adb('shell', 'uiautomator', 'dump', remote);
      const xml = await adb('shell', 'cat', remote);
      const node =
        xml.match(/<node\b[^>]*content-desc="MirrorPanel Test"[^>]*clickable="true"[^>]*>/)?.[0] ??
        xml.match(/<node\b[^>]*resource-id="android:id\/button1"[^>]*>/)?.[0];
      const b = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (b)
        await adb(
          'shell',
          'input',
          'tap',
          String((+b[1] + +b[3]) / 2),
          String((+b[2] + +b[4]) / 2),
        );
      await delay(300);
    }
    throw Error('Audio consent did not complete');
  } finally {
    await adb('shell', 'rm', '-f', remote).catch(() => {});
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
          (await evaluate('Number(document.querySelector("canvas")?.dataset.frames||0)>8'))
        );
      },
      'No decoded video',
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
      'tone',
      'true',
    );
    await delay(700);
    const rect = await evaluate(
      '(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()',
    );
    await clickAt(rect.x + rect.width * 0.4, rect.y + rect.height * 0.13);
    const basic = 'façade 😀 ';
    await mirror.webContents.insertText(basic);
    await until(async () => (await fixture('text.txt')) === basic, 'Typed Unicode missing');
    const composing = '日本語 👩🏽‍💻';
    await evaluate(
      `(()=>{const e=document.getElementById('text-input');e.dispatchEvent(new CompositionEvent('compositionstart'));e.value=${JSON.stringify(composing)};e.dispatchEvent(new InputEvent('input',{data:e.value,isComposing:true}));})()`,
    );
    await delay(150);
    assert.equal(await fixture('text.txt'), basic, 'Composition leaked before commit');
    await evaluate(
      "document.getElementById('text-input').dispatchEvent(new CompositionEvent('compositionend'))",
    );
    const pasted = ' العربية e\u0301 👨‍👩‍👧‍👦';
    await evaluate(
      `(()=>{const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(pasted)});document.getElementById('text-input').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,cancelable:true}));})()`,
    );
    await until(
      async () => (await fixture('text.txt')) === basic + composing + pasted,
      'Composition/paste changed Unicode',
    );
    const a = { x: rect.x + rect.width * 0.3, y: rect.y + rect.height * 0.7 },
      b = { x: rect.x + rect.width * 0.7, y: rect.y + rect.height * 0.8 };
    await clickAt(a.x, a.y, ['alt']);
    assert.equal(await evaluate('document.getElementById("touch-anchor").hidden'), false);
    await clickAt(b.x, b.y);
    await clickAt(a.x, a.y, ['alt']);
    await until(
      async () => JSON.parse(await fixture('touch.json')).some((e) => e.action === 1),
      'Alt anchor did not release',
    );
    const touch = JSON.parse(await fixture('touch.json'));
    assert.deepEqual(
      touch.filter((e) => e.action !== 2).map((e) => e.action),
      [0, 5, 6, 1],
    );
    await evaluate('document.getElementById("audio").click()', true);
    await consent();
    await until(
      async () =>
        await evaluate('Number(document.querySelector("canvas").dataset.audioFrames||0)>30'),
      'AudioDecoder did not decode',
    );
    const peak = await evaluate('Number(document.querySelector("canvas").dataset.audioPeak)');
    assert.ok(peak > 0.01, 'Live audio is silent');
    const recording = await evaluate('window.mirrorpanel.record()');
    await delay(2200);
    await evaluate('window.mirrorpanel.record()');
    await evaluate('window.mirrorpanel.screenshot()');
    fs.writeFileSync(path.join(dir, 'features-mirror.png'), (await mirror.capturePage()).toPNG());
    fs.writeFileSync(path.join(dir, 'features-panel.png'), (await panel.capturePage()).toPNG());
    const metrics = await evaluate('({...document.querySelector("canvas").dataset})');
    await evaluate('document.getElementById("audio").click()', true);
    await until(
      async () =>
        await evaluate('document.getElementById("audio").getAttribute("aria-pressed")==="false"'),
      'Audio did not stop',
    );
    mirror.close();
    await delay(2000);
    const snapshot = await panel.webContents.executeJavaScript('window.mirrorpanel.snapshot()');
    assert.equal(snapshot.devices.find((d) => d.serial === serial).session, null);
    const result = {
      ok: true,
      serial,
      unicodeExact: true,
      compositionDeferred: true,
      pasteExact: true,
      altMultitouch: touch,
      liveAudioPeak: peak,
      metrics,
      recording,
      closedWithoutRestart: true,
      errors,
    };
    assert.equal(errors.length, 0);
    fs.writeFileSync(path.join(dir, 'ui-feature-result.json'), JSON.stringify(result, null, 2));
    console.log('UI_FEATURES_OK', JSON.stringify(result));
  } catch (error) {
    console.error(error);
    fs.writeFileSync(
      path.join(dir, 'ui-feature-result.json'),
      JSON.stringify({ ok: false, error: String(error), errors }, null, 2),
    );
    process.exitCode = 1;
  } finally {
    await adb('shell', 'am', 'force-stop', 'com.mirrorpanel.fixture').catch(() => {});
    app.quit();
  }
}, 1000);
