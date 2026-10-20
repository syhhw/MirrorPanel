import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  powerSaveBlocker,
  screen,
  IpcMainInvokeEvent,
} from 'electron';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Adb, Device } from './adb';
import { MirrorSession, Quality, DEFAULT_QUALITY, quality } from './session';
import { Packet, validateControl } from './protocol';
import {
  accommodatedBounds,
  RESIZE_SETTLE_MS,
  MIRROR_BARS,
  MIRROR_MIN_WIDTH,
} from './window-sizing';
import { Diagnostics } from './diagnostics';
import { ApkInstaller } from './apk-install';
import { FileSender, validateDroppedFiles } from './file-transfer';
import { findBySender } from './window-owner';
import { setLanguage, t } from './i18n';

type Settings = {
  alwaysOnTop: boolean;
  stayAwake: boolean;
  showSerial: boolean;
  language: 'pt' | 'en';
  quality: Record<string, Quality>;
  nicknames: Record<string, string>;
  wifi: string[];
};
type Entry = {
  id: string;
  session: MirrorSession;
  window: BrowserWindow;
  frames: Set<number>;
  audioFrames: Set<number>;
  nextFrame: number;
  waitingKey: boolean;
  lastSync: number;
  requestedStop: boolean;
  rendererGone: boolean;
  attempt: number;
  awake?: string;
  finishPromise?: Promise<void>;
};
let panel: BrowserWindow;
let adb: Adb;
let resources: string;
let devices: Device[] = [];
let settings: Settings;
let settingsFile: string;
let polling = false,
  quitting = false;
let diagnostics: Diagnostics, installer: ApkInstaller, fileSender: FileSender;
let healthTimer: ReturnType<typeof setInterval>;
const startOperations = new Map<string, Promise<void>>();
const closeOrigins = new WeakMap<BrowserWindow, string>();
const diagnose = (event: string, data: Record<string, unknown> = {}) =>
  diagnostics?.write(event, data);
const sessions = new Map<string, Entry>();
// Windows outlive a failed connection; their controls must remain authorized.
const mirrorWindows = new Map<string, BrowserWindow>();
const videoRatios = new WeakMap<BrowserWindow, number>();
const logs: { time: string; message: string; level: string }[] = [];
const identity = new Map<string, string>();
let blocker: number | undefined;
let pollTimer: ReturnType<typeof setInterval>;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function loadSettings(): void {
  settingsFile = join(app.getPath('userData'), 'settings.json');
  const defaults: Settings = {
    alwaysOnTop: false,
    stayAwake: true,
    showSerial: false,
    language: 'pt',
    quality: {},
    nicknames: {},
    wifi: [],
  };
  settings = defaults;
  try {
    const saved = JSON.parse(readFileSync(settingsFile, 'utf8')) as Partial<Settings>;
    settings = {
      ...defaults,
      alwaysOnTop: saved.alwaysOnTop === true,
      stayAwake: saved.stayAwake !== false,
      showSerial: saved.showSerial === true,
      language: saved.language === 'en' ? 'en' : 'pt',
      quality: {},
      nicknames: Object.fromEntries(
        Object.entries(saved.nicknames ?? {}).filter(
          ([, v]) => typeof v === 'string' && v.length <= 80,
        ),
      ),
      wifi: Array.isArray(saved.wifi)
        ? saved.wifi.filter((v) => {
            try {
              validateAddress(v);
              return true;
            } catch {
              return false;
            }
          })
        : [],
    };
    for (const [serial, value] of Object.entries(saved.quality ?? {})) {
      try {
        settings.quality[serial] = quality(value);
      } catch {
        /* Reject corrupt individual settings. */
      }
    }
  } catch {
    // Import compatible 1.x preferences once; never modify the Python settings file.
    const legacy = join(app.getAppPath(), '..', 'settings.json');
    try {
      const old = JSON.parse(readFileSync(legacy, 'utf8')) as Record<string, unknown>;
      settings.alwaysOnTop = old.always_on_top === true;
      settings.stayAwake = old.stay_awake !== false;
      settings.language = old.language === 'en' ? 'en' : 'pt';
      if (old.nicknames && typeof old.nicknames === 'object')
        settings.nicknames = Object.fromEntries(
          Object.entries(old.nicknames).filter(([, v]) => typeof v === 'string' && v.length <= 80),
        );
    } catch {
      /* First launch has no prior settings. */
    }
  }
  setLanguage(settings.language);
}
function saveSettings(): void {
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile + '.tmp', JSON.stringify(settings, null, 2));
  renameSync(settingsFile + '.tmp', settingsFile);
}
function log(message: string, level = 'info'): void {
  logs.push({ time: new Date().toLocaleTimeString(t('pt-BR', 'en-US')), message, level });
  if (logs.length > 300) logs.shift();
  broadcast();
}
function snapshot(): unknown {
  return {
    lifecycle: [...sessions.entries()].map(([serial, e]) => ({
      serial,
      id: e.id,
      windowId: e.window.id,
      attempt: e.attempt,
      requestedStop: e.requestedStop,
      ...e.session.stats(),
    })),
    devices: devices.map((d) => ({
      ...d,
      name: settings.nicknames[d.serial] || d.model,
      session: sessions.get(d.serial)?.session.state ?? null,
      recording: sessions.get(d.serial)?.session.recording?.path ?? null,
      quality: settings.quality[d.serial] ?? DEFAULT_QUALITY,
    })),
    logs,
    settings: {
      alwaysOnTop: settings.alwaysOnTop,
      stayAwake: settings.stayAwake,
      showSerial: settings.showSerial,
      language: settings.language,
    },
  };
}
function broadcast(): void {
  if (panel && !panel.isDestroyed()) panel.webContents.send('state', snapshot());
}
function secureWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const window = new BrowserWindow({
    ...options,
    backgroundColor: '#f5f6f8',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const id = window.id,
    webContentsId = window.webContents.id;
  diagnose('window-created', { windowId: id, webContentsId });
  window.on('close', () =>
    diagnose('window-close', {
      windowId: id,
      origin: closeOrigins.get(window) ?? 'native-or-external',
      quitting,
    }),
  );
  window.on('closed', () => diagnose('window-closed', { windowId: id }));
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F4' && input.alt)
      diagnose('window-shortcut', { windowId: id, key: 'Alt+F4' });
  });
  if (process.platform === 'win32') {
    window.hookWindowMessage(0x0010, () => diagnose('wm-close', { windowId: id }));
    window.hookWindowMessage(0x0112, (wParam) => {
      const command = wParam.readUInt32LE() & 0xfff0;
      if ([0xf020, 0xf030, 0xf060, 0xf120].includes(command))
        diagnose('wm-system-command', { windowId: id, command });
    });
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_web, _permission, callback) =>
    callback(false),
  );
  return window;
}
function assertPanel(event: IpcMainInvokeEvent): void {
  if (event.sender !== panel.webContents)
    throw Error(t('Ação restrita ao painel', 'Only the panel can do this'));
}
function mirrorWindow(event: IpcMainInvokeEvent): { serial: string; window: BrowserWindow } {
  for (const [serial, window] of mirrorWindows)
    if (!window.isDestroyed() && window.webContents === event.sender) return { serial, window };
  throw Error(t('Janela desconhecida', 'Unknown window'));
}
function owner(event: IpcMainInvokeEvent): Entry {
  const entry = findBySender(sessions.values(), event.sender);
  if (!entry) throw Error(t('Janela sem sessão', 'This window has no session'));
  return entry;
}
function assertDevice(serial: unknown): string {
  if (
    typeof serial !== 'string' ||
    !devices.some((d) => d.serial === serial && d.state === 'device')
  )
    throw Error(
      t('Aparelho não está autorizado ou conectado', 'Device is not authorized or connected'),
    );
  return serial;
}
async function refresh(): Promise<void> {
  if (polling || quitting) return;
  polling = true;
  try {
    const found = await adb.devices();
    await Promise.all(
      found
        .filter((d) => d.state === 'device' && !identity.has(d.serial))
        .map(async (d) => {
          const id = d.serial.startsWith('emulator-')
            ? d.serial
            : await adb.shell(d.serial, ['getprop', 'ro.serialno']).catch(() => d.serial);
          identity.set(d.serial, !id || id === 'unknown' ? d.serial : id);
        }),
    );
    const preferred = new Map<string, Device>();
    for (const device of found) {
      const id = identity.get(device.serial) ?? device.serial,
        other = preferred.get(id);
      if (
        !other ||
        sessions.has(device.serial) ||
        (!sessions.has(other.serial) && other.serial.includes(':') && !device.serial.includes(':'))
      )
        preferred.set(id, device);
    }
    devices = [...preferred.values()];
    broadcast();
  } catch (e) {
    log('ADB: ' + String(e), 'error');
  } finally {
    polling = false;
  }
}
function start(serial: string, attempt = 0, existing?: Entry): Promise<void> {
  const pending = startOperations.get(serial);
  if (pending) return pending;
  const operation = startSession(serial, attempt, existing).finally(() => {
    if (startOperations.get(serial) === operation) startOperations.delete(serial);
  });
  startOperations.set(serial, operation);
  return operation;
}
async function startSession(serial: string, attempt = 0, existing?: Entry): Promise<void> {
  if (
    existing &&
    (sessions.get(serial) !== existing || existing.requestedStop || existing.window.isDestroyed())
  )
    return;
  if (quitting) return;
  const active = sessions.get(serial);
  if (active && !existing) {
    if (active.requestedStop || active.window.isDestroyed()) {
      await active.session.stop();
      await finishEntry(serial, active);
    } else {
      active.window.restore();
      active.window.focus();
      return;
    }
  }
  const q = settings.quality[serial] ?? DEFAULT_QUALITY;
  const session = new MirrorSession(serial, q, adb, resources);
  const device = devices.find((d) => d.serial === serial);
  const previousWindow = existing?.window ?? mirrorWindows.get(serial);
  const fresh = !previousWindow || previousWindow.isDestroyed();
  const window = fresh
    ? secureWindow({
        width: 440,
        height: 850,
        minWidth: MIRROR_MIN_WIDTH,
        minHeight: 200,
        title: settings.nicknames[serial] || device?.model || serial,
        alwaysOnTop: settings.alwaysOnTop,
        show: true,
      })
    : previousWindow!;
  mirrorWindows.set(serial, window);
  if (!existing) {
    window.restore();
    window.show();
  }
  const entry: Entry = {
    id: randomBytes(6).toString('hex'),
    session,
    window,
    frames: new Set(),
    audioFrames: new Set(),
    nextFrame: 0,
    waitingKey: false,
    lastSync: 0,
    requestedStop: false,
    rendererGone: false,
    attempt,
    awake: existing?.awake,
  };
  sessions.set(serial, entry);
  diagnose('session-start', { id: entry.id, windowId: window.id, attempt });
  // The Android runtime takes seconds to start the engine; show which part is running.
  const startProgress: Record<string, () => string> = {
    'server-pushed': () => t('Iniciando o motor no celular…', 'Starting the engine on the phone…'),
    'server-ready': () => t('Abrindo a tela do aparelho…', 'Opening the device screen…'),
  };
  session.on('diagnostic', (event: string, details: Record<string, unknown>) => {
    diagnose(event, { id: entry.id, windowId: window.id, ...details });
    const progress = event === 'start-step' && startProgress[String(details.step)];
    if (progress && session.state === 'starting') sendMirror(entry, 'session-status', progress());
  });
  if (blocker === undefined) blocker = powerSaveBlocker.start('prevent-display-sleep');
  sendMirror(entry, 'session-status', t('Conectando…', 'Connecting…'));
  session.on('log', (message: string) => log(serial + ': ' + message, 'warning'));
  session.on('state', () => broadcast());
  session.on('recording', (path) => {
    broadcast();
    if (!window.isDestroyed()) sendMirror(entry, 'recording-state', Boolean(path));
  });
  session.on('info', (info) => {
    entry.waitingKey = false;
    if (!window.isDestroyed()) {
      if (!window.isMaximized() && !window.isFullScreen()) {
        const area = screen.getDisplayMatching(window.getBounds()).workArea;
        const ratio = info.width / info.height,
          previousRatio = videoRatios.get(window);
        const minimum = Math.min(MIRROR_MIN_WIDTH, Math.floor((area.height - MIRROR_BARS) * ratio));
        window.setMinimumSize(minimum, Math.round(minimum / ratio) + MIRROR_BARS);
        if (previousRatio !== ratio) {
          const desired = previousRatio
            ? window.getContentSize()[1] - MIRROR_BARS
            : ratio > 1
              ? 960
              : 440;
          const width = Math.floor(
            Math.min(desired, area.width - 40, (area.height - 64 - MIRROR_BARS) * ratio),
          );
          window.setContentSize(width, Math.round(width / ratio) + MIRROR_BARS);
          const bounds = window.getBounds();
          window.setPosition(
            Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)),
            Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)),
          );
        }
      }
      videoRatios.set(window, info.width / info.height);
      sendMirror(entry, 'video-info', info);
    }
  });
  session.on('audio-state', (status) => {
    if (!window.isDestroyed()) sendMirror(entry, 'audio-state', status);
  });
  session.on('audio', (packet: Packet) => {
    if (window.isDestroyed() || entry.rendererGone) return;
    if (packet.flags & 2) {
      sendMirror(entry, 'audio-config', packet.data);
      return;
    }
    if (entry.audioFrames.size >= 12) return;
    const id = entry.nextFrame++;
    entry.audioFrames.add(id);
    sendMirror(entry, 'audio-frame', {
      id,
      flags: packet.flags,
      pts: packet.pts,
      data: packet.data,
    });
  });
  session.on('video', (packet: Packet) => {
    if (window.isDestroyed() || entry.rendererGone) return;
    if (packet.flags & 2) {
      sendMirror(entry, 'video-config', packet.data);
      return;
    }
    if (entry.frames.size >= 4) entry.waitingKey = true;
    if (entry.waitingKey) {
      if (!(packet.flags & 1) || entry.frames.size >= 4) {
        if (Date.now() - entry.lastSync > 1000) {
          entry.lastSync = Date.now();
          session.control({ type: 'sync' });
        }
        return;
      }
      entry.waitingKey = false;
    }
    const id = entry.nextFrame++;
    entry.frames.add(id);
    sendMirror(entry, 'video-frame', {
      id,
      flags: packet.flags,
      pts: packet.pts,
      data: packet.data,
    });
  });
  session.on('ended', (reason: string) => {
    diagnose('session-ended', {
      id: entry.id,
      windowId: window.id,
      reason,
      requestedStop: entry.requestedStop,
      rendererGone: entry.rendererGone,
    });
    broadcast();
    entry.frames.clear();
    entry.audioFrames.clear();
    let message = t('Não foi possível manter o espelhamento.', 'Mirroring could not continue.');
    if (!window.isDestroyed()) {
      sendMirror(entry, 'audio-state', { state: 'off' });
      const messages: Record<string, string> = {
        'phone-stop': t(
          'Espelhamento interrompido no aparelho.',
          'Mirroring was stopped on the device.',
        ),
        'companion-lost': t(
          'A conexão com o aplicativo Android foi interrompida.',
          'The connection to the Android app was interrupted.',
        ),
        'user-stop': t('Espelhamento encerrado.', 'Mirroring ended.'),
        timeout: t(
          'O aparelho deixou de responder à conexão.',
          'The device stopped responding to the connection.',
        ),
        'stream-ended': t(
          'A conexão com o aparelho foi interrompida.',
          'The connection to the device was interrupted.',
        ),
        'process-exit': t(
          'O motor Android encerrou inesperadamente.',
          'The Android engine stopped unexpectedly.',
        ),
        'protocol-error': t(
          'Erro na comunicação com o aparelho.',
          'Communication with the device failed.',
        ),
      };
      message = messages[reason] ?? message;
      sendMirror(entry, 'session-status', message);
      if (!entry.requestedStop)
        log((device?.model ?? serial) + ': ' + (messages[reason] ?? reason), 'warning');
    }
    if (
      !entry.requestedStop &&
      !quitting &&
      !window.isDestroyed() &&
      !entry.rendererGone &&
      !['phone-stop', 'user-stop', 'start-failed'].includes(reason) &&
      attempt < 3
    ) {
      void (async () => {
        await pause(1800);
        await refresh();
        if (entry.requestedStop || quitting || window.isDestroyed()) {
          await finishEntry(serial, entry);
          return;
        }
        if (devices.some((d) => d.serial === serial && d.state === 'device')) {
          log(t('Reconectando ', 'Reconnecting ') + serial + ' (' + (attempt + 1) + '/3)');
          sendMirror(entry, 'session-status', t('Reconectando…', 'Reconnecting…'));
          await start(serial, attempt + 1, entry);
        } else {
          await finishEntry(serial, entry);
          sendMirror(entry, 'session-status', {
            message: t(
              'Aparelho desconectado. Conecte-o e tente novamente.',
              'Device disconnected. Connect it and try again.',
            ),
            retry: true,
          });
        }
      })();
    } else
      void finishEntry(serial, entry).then(() =>
        sendMirror(entry, 'session-status', { message, retry: !entry.requestedStop }),
      );
  });
  if (fresh) {
    window.on('closed', () => {
      if (mirrorWindows.get(serial) === window) mirrorWindows.delete(serial);
    });
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const fit = () => {
      const ratio = videoRatios.get(window);
      if (
        !ratio ||
        window.isDestroyed() ||
        window.isMinimized() ||
        window.isMaximized() ||
        window.isFullScreen()
      )
        return;
      const bounds = window.getBounds(),
        content = window.getContentBounds();
      const next = accommodatedBounds(bounds, ratio, screen.getDisplayMatching(bounds).workArea, {
        width: bounds.width - content.width,
        height: MIRROR_BARS + bounds.height - content.height,
      });
      if (Math.abs(next.width - bounds.width) > 3 || Math.abs(next.height - bounds.height) > 3) {
        diagnose('resize-fit', { windowId: window.id, before: bounds, after: next });
        window.setBounds(next);
      }
    };
    const scheduleFit = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fit, RESIZE_SETTLE_MS);
    };
    window.on('resize', scheduleFit);
    window.on('unmaximize', scheduleFit);
    window.on('leave-full-screen', scheduleFit);
    window.on('maximize', () =>
      sendMirror(sessions.get(serial) ?? entry, 'window-layout', { contained: true }),
    );
    window.on('unmaximize', () =>
      sendMirror(sessions.get(serial) ?? entry, 'window-layout', { contained: false }),
    );
    window.on('minimize', () => diagnose('window-minimize', { windowId: window.id }));
    window.on('restore', () => diagnose('window-restore', { windowId: window.id }));
    window.once('closed', () => clearTimeout(resizeTimer));
    window.on('close', () => {
      const current = sessions.get(serial);
      if (current && current.window === window) {
        current.requestedStop = true;
        void current.session.stop('window-close');
      }
    });
    window.webContents.once('destroyed', () => {
      const current = sessions.get(serial);
      if (current && current.window === window) {
        current.requestedStop = true;
        current.rendererGone = true;
        void current.session.stop('renderer-destroyed').finally(() => finishEntry(serial, current));
      }
    });
    let rendererRecoveries = 0;
    window.webContents.on('render-process-gone', (_event, details) => {
      const current = sessions.get(serial);
      diagnose('renderer-gone', {
        windowId: window.id,
        reason: details.reason,
        exitCode: details.exitCode,
      });
      if (quitting || window.isDestroyed()) return;
      if (current) {
        current.rendererGone = true;
        current.frames.clear();
        current.audioFrames.clear();
        try {
          current.session.control({ type: 'touch', action: 3 });
        } catch {
          /* A disconnected session is already cleaning up. */
        }
      }
      log(
        t('A janela de vídeo falhou (', 'The video window failed (') +
          details.reason +
          t('). Recuperando a imagem…', '). Restoring the picture…'),
        'warning',
      );
      // A renderer failure must not destroy a healthy Android transport or its window.
      const resume =
        current && current.window === window && !current.requestedStop && ++rendererRecoveries <= 3;
      void (async () => {
        if (!resume && current) {
          current.requestedStop = true;
          await current.session.stop('renderer-recovery-limit');
          await finishEntry(serial, current);
          rendererRecoveries = 0;
        }
        if (window.isDestroyed()) return;
        await window.loadFile(join(__dirname, 'index.html'), {
          query: mirrorQuery(serial, device),
        });
        if (window.isDestroyed()) return;
        if (!resume || sessions.get(serial) !== current || current.requestedStop) {
          window.webContents.send('session-status', {
            message: t(
              'Não foi possível recuperar o vídeo. Tente reconectar.',
              'The video could not be restored. Try reconnecting.',
            ),
            retry: true,
          });
          return;
        }
        current.rendererGone = false;
        current.waitingKey = true;
        current.frames.clear();
        current.audioFrames.clear();
        sendMirror(current, 'window-layout', {
          contained: window.isMaximized() || window.isFullScreen(),
        });
        if (current.session.info) sendMirror(current, 'video-info', current.session.info);
        if (current.session.config) sendMirror(current, 'video-config', current.session.config);
        sendMirror(
          current,
          'session-status',
          current.session.state === 'mirroring'
            ? ''
            : {
                message: t(
                  'Reconecte para retomar o espelhamento.',
                  'Reconnect to resume mirroring.',
                ),
                retry: true,
              },
        );
        current.session.control({ type: 'sync' });
        if (current.session.audioState === 'started')
          void current.session.setAudio(false).catch(() => {});
        diagnose('renderer-recovered', { windowId: window.id, id: current.id });
      })().catch(() => {
        if (current) {
          current.requestedStop = true;
          void current.session.stop('renderer-reload-failed');
        }
      });
    });
  }
  try {
    if (!existing)
      await window.loadFile(join(__dirname, 'index.html'), { query: mirrorQuery(serial, device) });
    sendMirror(entry, 'window-layout', {
      contained: window.isMaximized() || window.isFullScreen(),
    });
    if (entry.requestedStop || window.isDestroyed()) {
      await session.stop();
      return;
    }
    if (settings.stayAwake && entry.awake === undefined) {
      entry.awake = await adb.shell(serial, [
        'settings',
        'get',
        'global',
        'stay_on_while_plugged_in',
      ]);
      await adb.shell(serial, ['settings', 'put', 'global', 'stay_on_while_plugged_in', '3']);
    }
    await session.start();
    if (entry.requestedStop) return;
    if (!window.isDestroyed()) sendMirror(entry, 'session-status', '');
    diagnose('session-ready', { id: entry.id, windowId: window.id });
    log(t('Espelhando ', 'Mirroring ') + (device?.model ?? serial));
    broadcast();
  } catch (e) {
    entry.requestedStop = true;
    await session.stop();
    await finishEntry(serial, entry);
    log(String(e), 'error');
    if (!window.isDestroyed())
      sendMirror(entry, 'session-status', { message: String(e), retry: true });
  }
}
async function finishEntry(serial: string, entry: Entry): Promise<void> {
  if (entry.finishPromise) return entry.finishPromise;
  entry.finishPromise = (async () => {
    if (sessions.get(serial) !== entry) return;
    sessions.delete(serial);
    if (entry.awake !== undefined) {
      const value = entry.awake;
      if (/^\d+$/.test(value))
        await adb
          .shell(serial, ['settings', 'put', 'global', 'stay_on_while_plugged_in', value], 4000)
          .catch(() => {});
      else
        await adb
          .shell(serial, ['settings', 'delete', 'global', 'stay_on_while_plugged_in'], 4000)
          .catch(() => {});
    }
    if (!sessions.size && blocker !== undefined) {
      powerSaveBlocker.stop(blocker);
      blocker = undefined;
    }
    broadcast();
  })();
  return entry.finishPromise;
}
function mirrorQuery(serial: string, device?: Device): Record<string, string> {
  return {
    view: 'mirror',
    serial,
    name: settings.nicknames[serial] || device?.model || serial,
    lang: settings.language,
  };
}
function sendMirror(entry: Entry, channel: string, ...args: unknown[]): void {
  if (entry.rendererGone || entry.window.isDestroyed()) return;
  const contents = entry.window.webContents;
  try {
    if (!contents.isDestroyed() && !contents.isCrashed() && !contents.mainFrame.detached)
      contents.send(channel, ...args);
  } catch {
    /* A disposed render frame must never interrupt session cleanup. */
  }
}
function mediaPath(extension: string): string {
  const directory = join(
    process.env.MIRRORPANEL_TEST_MEDIA_ROOT ?? app.getPath('videos'),
    'MirrorPanel Media',
    extension === 'png' ? 'Capturas de tela' : 'Gravacoes',
  );
  mkdirSync(directory, { recursive: true });
  return join(
    directory,
    new Date().toISOString().replaceAll(':', '-').replace('.', '-') +
      '-' +
      randomBytes(3).toString('hex') +
      '.' +
      extension,
  );
}
function validateAddress(value: unknown): string {
  if (typeof value !== 'string' || !/^([\d]{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(value))
    throw Error(
      t(
        'Informe IP:porta, por exemplo 192.168.1.10:5555',
        'Enter IP:port, for example 192.168.1.10:5555',
      ),
    );
  const [ip, port] = value.split(':');
  if (ip.split('.').some((n) => Number(n) > 255) || Number(port) < 1 || Number(port) > 65535)
    throw Error(t('Endereço inválido', 'Invalid address'));
  return value;
}
function handlers(): void {
  ipcMain.handle('window-action', (event, action: unknown) => {
    const window = event.sender === panel.webContents ? panel : mirrorWindow(event).window;
    if (
      typeof action !== 'string' ||
      ![
        'state',
        'minimize',
        'maximize',
        'close',
        'always-on-top',
        'panel',
        'settings',
        'reconnect',
      ].includes(action)
    )
      throw Error(t('Ação de janela inválida', 'Invalid window action'));
    if (window.isDestroyed()) return null;
    if (action !== 'state') diagnose('window-action', { windowId: window.id, action });
    if (action === 'close') {
      closeOrigins.set(window, 'toolbar');
      window.close();
      return null;
    }
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    }
    if (action === 'always-on-top') window.setAlwaysOnTop(!window.isAlwaysOnTop());
    if (action === 'reconnect') {
      const { serial } = mirrorWindow(event);
      void start(assertDevice(serial));
    }
    if (action === 'panel' || action === 'settings') {
      const { serial } = mirrorWindow(event);
      panel.restore();
      panel.show();
      panel.focus();
      if (action === 'settings') panel.webContents.send('open-device-settings', serial);
    }
    return { maximized: window.isMaximized(), alwaysOnTop: window.isAlwaysOnTop() };
  });
  ipcMain.handle('snapshot', (event) => {
    assertPanel(event);
    return snapshot();
  });
  ipcMain.handle('refresh', async (event) => {
    assertPanel(event);
    await refresh();
  });
  ipcMain.handle('start', (event, serial) => {
    assertPanel(event);
    const valid = assertDevice(serial);
    void start(valid);
  });
  ipcMain.handle('stop', async (event, serial) => {
    assertPanel(event);
    const entry = sessions.get(String(serial));
    if (entry) {
      diagnose('panel-stop', { id: entry.id, windowId: entry.window.id });
      entry.requestedStop = true;
      await entry.session.stop('panel-stop');
      if (!entry.window.isDestroyed()) {
        closeOrigins.set(entry.window, 'panel-stop');
        entry.window.close();
      }
    }
  });
  ipcMain.handle('quality', (event, serial, value) => {
    assertPanel(event);
    const key = assertDevice(serial);
    if (sessions.has(key))
      throw Error(
        t('Pare o espelhamento para alterar a qualidade', 'Stop mirroring to change the quality'),
      );
    settings.quality[key] = quality(value);
    saveSettings();
    broadcast();
  });
  ipcMain.handle('rename', (event, serial, value) => {
    assertPanel(event);
    const key = assertDevice(serial);
    if (typeof value !== 'string' || value.length > 80)
      throw Error(t('Nome inválido', 'Invalid name'));
    settings.nicknames[key] = value.trim();
    saveSettings();
    const entry = sessions.get(key);
    if (entry && !entry.window.isDestroyed()) {
      const name = value.trim() || devices.find((d) => d.serial === key)?.model || key;
      entry.window.setTitle(name);
      sendMirror(entry, 'device-name', name);
    }
    broadcast();
  });
  ipcMain.handle('preferences', (event, value) => {
    assertPanel(event);
    if (
      !value ||
      typeof value.alwaysOnTop !== 'boolean' ||
      typeof value.stayAwake !== 'boolean' ||
      !['pt', 'en'].includes(value.language)
    )
      throw Error(t('Preferências inválidas', 'Invalid preferences'));
    settings.alwaysOnTop = value.alwaysOnTop;
    settings.stayAwake = value.stayAwake;
    settings.language = value.language;
    setLanguage(settings.language);
    if (typeof value.showSerial === 'boolean') settings.showSerial = value.showSerial;
    saveSettings();
    for (const window of mirrorWindows.values()) {
      if (window.isDestroyed()) continue;
      window.setAlwaysOnTop(settings.alwaysOnTop);
      if (!window.webContents.isCrashed()) window.webContents.send('language', settings.language);
    }
    broadcast();
  });
  ipcMain.handle('control', (event, value) => {
    const control = validateControl(value),
      session = owner(event).session;
    return control.type === 'text' ? session.text(control.text) : session.control(control);
  });
  ipcMain.handle('audio', (event, enabled) => {
    if (typeof enabled !== 'boolean')
      throw Error(t('Estado de áudio inválido', 'Invalid audio state'));
    return owner(event).session.setAudio(enabled);
  });
  ipcMain.on('frame-ack', (event, id: number) => {
    const entry = findBySender(sessions.values(), event.sender);
    entry?.frames.delete(id);
    entry?.audioFrames.delete(id);
  });
  ipcMain.handle('record', (event, serial) => {
    const entry = event.sender === panel.webContents ? sessions.get(String(serial)) : owner(event);
    if (!entry) throw Error(t('Inicie o espelhamento', 'Start mirroring first'));
    if (entry.session.recording) {
      const path = entry.session.recording.path;
      entry.session.stopRecording();
      log(t('Gravação salva: ', 'Recording saved: ') + path);
      return null;
    }
    const path = mediaPath('mp4');
    entry.session.startRecording(path);
    log(t('Gravando: ', 'Recording: ') + path);
    return path;
  });
  ipcMain.handle('screenshot', async (event, serial) => {
    const entry = event.sender === panel.webContents ? sessions.get(String(serial)) : owner(event);
    if (!entry || entry.window.isDestroyed())
      throw Error(t('Inicie o espelhamento', 'Start mirroring first'));
    sendMirror(entry, 'take-screenshot');
  });
  ipcMain.handle('save-png', (event, png) => {
    owner(event);
    if (
      !(png instanceof Uint8Array) ||
      png.byteLength > 32 * 1024 * 1024 ||
      Buffer.from(png).readUInt32BE(0) !== 0x89504e47
    )
      throw Error(t('PNG inválido', 'Invalid PNG'));
    const path = mediaPath('png');
    writeFileSync(path, png, { flag: 'wx' });
    log(t('Captura salva: ', 'Screenshot saved: ') + path);
    return path;
  });
  ipcMain.handle('paste', async (event) => {
    return owner(event).session.text(await clipboard.readText());
  });
  ipcMain.handle('open-media', (event) => {
    assertPanel(event);
    const path = join(app.getPath('videos'), 'MirrorPanel Media');
    mkdirSync(path, { recursive: true });
    return shell.openPath(path);
  });
  ipcMain.handle('copy-logs', (event) => {
    assertPanel(event);
    clipboard.writeText(logs.map((l) => l.time + ' ' + l.message).join('\n'));
  });
  ipcMain.handle('clear-logs', (event) => {
    assertPanel(event);
    logs.length = 0;
    broadcast();
  });
  ipcMain.handle('wifi', async (event, address) => {
    assertPanel(event);
    const target = validateAddress(address);
    const result = await adb.run(['connect', target]);
    if (!result.includes('connected')) throw Error(result);
    if (!settings.wifi.includes(target)) settings.wifi.push(target);
    saveSettings();
    log(result);
    await refresh();
  });
  ipcMain.handle('pair', async (event, address, code) => {
    assertPanel(event);
    const target = validateAddress(address);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code))
      throw Error(t('O código deve ter 6 dígitos', 'The code must have 6 digits'));
    const result = await adb.run(['pair', target, code]);
    if (!result.includes('Successfully paired')) throw Error(result);
    log(
      t(
        'Pareamento concluído. Use a porta de conexão para conectar.',
        'Paired. Use the connection port to connect.',
      ),
    );
    await refresh();
  });
  ipcMain.handle('usb-wifi', async (event, serial) => {
    assertPanel(event);
    const valid = assertDevice(serial);
    const route = await adb.shell(valid, ['ip', 'route']);
    const ip = route.match(/\bsrc (\d+\.\d+\.\d+\.\d+)/)?.[1];
    if (!ip)
      throw Error(
        t(
          'Conecte o celular a uma rede Wi-Fi primeiro',
          'Connect the phone to a Wi-Fi network first',
        ),
      );
    await adb.device(valid, ['tcpip', '5555']);
    await pause(1200);
    const target = validateAddress(ip + ':5555');
    const result = await adb.run(['connect', target]);
    if (!result.includes('connected')) throw Error(result);
    settings.wifi.push(target);
    saveSettings();
    log(result);
    await refresh();
  });
  ipcMain.handle('install-apk', async (event, serial) => {
    assertPanel(event);
    const valid = assertDevice(serial);
    const result = await dialog.showOpenDialog(panel, {
      title: t('Instalar APK no aparelho', 'Install APK on the device'),
      filters: [{ name: 'Android APK', extensions: ['apk'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return;
    const name = await installer.install(valid, result.filePaths[0]);
    log(t('APK instalado: ', 'APK installed: ') + name);
  });
  ipcMain.handle('send-files', async (event, paths: unknown) => {
    const { serial, window } = mirrorWindow(event);
    assertDevice(serial);
    const files = await validateDroppedFiles(paths);
    diagnose('file-transfer-start', { windowId: window.id, count: files.length });
    try {
      const names = await fileSender.send(serial, files);
      log(t('Enviado para Download: ', 'Sent to Download: ') + names.join(', '));
      diagnose('file-transfer-complete', { windowId: window.id, count: names.length });
      return names;
    } catch (error) {
      diagnose('file-transfer-failed', { windowId: window.id });
      throw error;
    }
  });
  ipcMain.handle('install-dropped-apk', async (event, path: unknown) => {
    const { serial, window } = mirrorWindow(event);
    assertDevice(serial);
    if (typeof path !== 'string' || !path)
      throw Error(
        t('Arraste um APK salvo neste computador.', 'Drop an APK saved on this computer.'),
      );
    diagnose('apk-install-start', { windowId: window.id });
    try {
      const name = await installer.install(serial, path);
      log(t('APK instalado: ', 'APK installed: ') + name);
      diagnose('apk-install-complete', { windowId: window.id });
      return name;
    } catch (error) {
      diagnose('apk-install-failed', { windowId: window.id });
      throw error;
    }
  });
}

app.setName('MirrorPanel');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (panel) {
      panel.restore();
      panel.focus();
    }
  });
  void app.whenReady().then(async () => {
    resources = app.isPackaged
      ? join(process.resourcesPath, 'resources')
      : join(app.getAppPath(), 'resources');
    diagnostics = new Diagnostics(
      join(app.getPath('userData'), 'diagnostics'),
      randomBytes(6).toString('hex'),
    );
    diagnose('app-ready', { version: app.getVersion() });
    adb = new Adb(join(resources, 'adb', 'adb.exe'));
    installer = new ApkInstaller(adb);
    fileSender = new FileSender(adb);
    loadSettings();
    handlers();
    healthTimer = setInterval(
      () =>
        diagnose('health', {
          sessions: [...sessions.values()].map((e) => ({
            id: e.id,
            windowId: e.window.id,
            attempt: e.attempt,
            rendererGone: e.rendererGone,
            queuedFrames: e.frames.size,
            ...e.session.stats(),
          })),
        }),
      10000,
    );
    panel = secureWindow({
      width: 820,
      height: 850,
      minWidth: 620,
      minHeight: 560,
      title: 'MirrorPanel 2.0',
      show: true,
    });
    await panel.loadFile(join(__dirname, 'index.html'));
    if (!existsSync(adb.executable) || !existsSync(join(resources, 'mirrorpanel-server.jar')))
      log(
        t(
          'Recursos ausentes. Execute npm run android antes de iniciar.',
          'Missing resources. Run npm run android before starting.',
        ),
        'error',
      );
    await refresh();
    pollTimer = setInterval(() => void refresh(), 3000);
    for (const address of settings.wifi) void adb.run(['connect', address], 6000).catch(() => {});
    panel.on('closed', () => {
      diagnose('panel-closed');
      app.quit();
    });
    if (process.env.MIRRORPANEL_SMOKE_SERIAL)
      void start(assertDevice(process.env.MIRRORPANEL_SMOKE_SERIAL));
  });
  app.on('before-quit', (event) => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    clearInterval(pollTimer);
    clearInterval(healthTimer);
    diagnose('app-before-quit');
    // Exit only after flushing recordings and cleaning owned resources. Calling
    // quit again from a cancelled before-quit could leave a windowless process.
    void Promise.allSettled(
      [...sessions.entries()].map(async ([serial, entry]) => {
        entry.requestedStop = true;
        await entry.session.stop('app-quit');
        await finishEntry(serial, entry);
      }),
    ).then(() => app.exit(Number(process.exitCode ?? 0)));
  });
}
