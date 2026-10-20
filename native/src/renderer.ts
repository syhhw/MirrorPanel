import { AudioPlayer } from './audio-player';
import { Gestures } from './gestures';
import { bindRipple } from './ripple';
import { html } from './html';
import { admitFrame } from './video-gate';
import { setLanguage, t, type Language } from './i18n';
import { icon, logoMark } from './icons';

/** Minimum gap between keyframe requests sent from the mirror window. */
const SYNC_INTERVAL_MS = 1000;
interface DeviceRow {
  serial: string;
  state: string;
  model: string;
  name: string;
  session: string | null;
  recording: string | null;
  quality: { maxSize: number; fps: number; bitrate: number };
  /** Screen width / height from wm size, or null until it is known. */
  ratio: number | null;
}
interface PanelState {
  devices: DeviceRow[];
  /** The app's version, such as 2.0.0-preview.5. */
  version: string;
  logs: { time: string; message: string; level: string }[];
  settings: {
    alwaysOnTop: boolean;
    stayAwake: boolean;
    showSerial: boolean;
    language: 'pt' | 'en';
    theme: 'system' | 'light' | 'dark';
  };
}
interface Info {
  width: number;
  height: number;
}
interface FramePacket {
  id: number;
  flags: number;
  pts: number;
  data: Uint8Array;
}
type Api = { [key: string]: (...args: unknown[]) => Promise<unknown> } & {
  ack: (id: number) => void;
};
declare global {
  interface Window {
    mirrorpanel: Api;
  }
}
const api = window.mirrorpanel;
const root = document.getElementById('app')!;
const dialog = document.getElementById('dialog') as HTMLDialogElement;
const form = document.getElementById('dialog-form') as HTMLFormElement;
let state: PanelState;
let issuesOnly = false;
let toastTimer: ReturnType<typeof setTimeout>;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
/** Short note at the bottom of the window; errors stay a little longer and get a red mark. */
function toast(value: unknown): void {
  const el = $('toast');
  const text = String(value);
  const failed = value instanceof Error || /^\w*Error\b/.test(text);
  el.textContent = text
    .replace(/^Error: Error invoking remote method '[^']+': /, '')
    .replace(/^\w*Error: /, '');
  el.classList.toggle('is-error', failed);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), failed ? 6000 : 3500);
}
function act(promise: Promise<unknown>): void {
  void promise.catch(toast);
}
/** Sets the language for texts built from now on and for the page itself. */
function applyLanguage(value: unknown): void {
  const next: Language = value === 'en' ? 'en' : 'pt';
  setLanguage(next);
  document.documentElement.lang = next === 'en' ? 'en' : 'pt-BR';
}
/** Icon-only buttons carry their text as tooltip and accessible name. */
function label(element: HTMLElement, text: string): void {
  element.title = text;
  element.setAttribute('aria-label', text);
}
/**
 * Opens the shared dialog. `single` keeps only the confirm button, for dialogs
 * that inform rather than ask (help).
 */
function ask(
  content: string,
  submit: (data: FormData) => Promise<unknown>,
  confirm = t('Save', 'Salvar'),
  single = false,
): void {
  $('dialog-content').innerHTML = content;
  $('confirm').textContent = confirm;
  $('cancel').textContent = t('Cancel', 'Cancelar');
  $('cancel').hidden = single;
  const heading = $('dialog-content').querySelector('h2');
  if (heading) heading.id = 'dialog-title';
  form.onsubmit = (event) => {
    if ((event as SubmitEvent).submitter?.getAttribute('value') === 'cancel') return;
    event.preventDefault();
    const button = $<HTMLButtonElement>('confirm');
    button.disabled = true;
    void submit(new FormData(form))
      .then(() => dialog.close())
      .catch(toast)
      .finally(() => (button.disabled = false));
  };
  dialog.showModal();
}
const iconButton = (id: string, label: string, name = id, extra = '') =>
  `<button type="button" id="${id}" class="icon-button" title="${label}" aria-label="${label}" ${extra}>${icon(name)}</button>`;
const windowButtons = () =>
  html`<div class="window-buttons">${['minimize', 'maximize', 'close']
    .map((name) => `<button type="button" data-window="${name}">${icon(name)}</button>`)
    .join('')}</div>`;
function labelWindowButtons(): void {
  const labels: Record<string, string> = {
    minimize: t('Minimize', 'Minimizar'),
    maximize: t('Maximize / restore', 'Maximizar / restaurar'),
    close: t('Close', 'Fechar'),
  };
  document
    .querySelectorAll<HTMLButtonElement>('[data-window]')
    .forEach((button) => label(button, labels[button.dataset.window!]));
}
function bindWindowButtons(): void {
  labelWindowButtons();
  document
    .querySelectorAll<HTMLButtonElement>('[data-window]')
    .forEach((button) => (button.onclick = () => act(api.windowAction(button.dataset.window))));
  document
    .querySelector<HTMLElement>('.title-drag')
    ?.addEventListener('dblclick', () => act(api.windowAction('maximize')));
}
function showHelp(): void {
  const shortcut = (keys: string, action: string) =>
    `<div><dt>${keys}</dt><dd>${action}</dd></div>`;
  ask(
    html`
      <h2>${t('Mouse and shortcuts', 'Mouse e atalhos')}</h2>
      <dl class="shortcuts">
        ${shortcut('<kbd>Alt</kbd> + ' + t('click', 'clique'), t('Anchors one finger; drag the second point for multitouch', 'Fixa um dedo; arraste o segundo ponto para multitoque'))}
        ${shortcut(t('Right button', 'Botão direito'), t('Back', 'Voltar'))}
        ${shortcut(t('Middle button', 'Botão do meio'), t('Home', 'Início'))}
        ${shortcut('<kbd>Esc</kbd>', t('Back, or release the contacts', 'Voltar ou soltar os contatos'))}
        ${shortcut('<kbd>Home</kbd>', t('Home', 'Início'))}
        ${shortcut('<kbd>End</kbd>', t('Recent apps', 'Apps recentes'))}
        ${shortcut('<kbd>Ctrl</kbd> + <kbd>V</kbd>', t('Pastes the computer text on the phone', 'Cola o texto do computador no celular'))}
        ${shortcut('<kbd>F11</kbd>', t('Fullscreen', 'Tela cheia'))}
      </dl>
      <h3>${t('USB connection', 'Conexão USB')}</h3>
      <p>
        ${t('Turn on USB debugging in developer options and authorize this computer on the phone. To hear audio, accept the capture when Android asks.', 'Ative a depuração USB nas opções do desenvolvedor e autorize este computador no celular. Para ouvir o áudio, aceite a captura quando o Android pedir.')}
      </p>
    `,
    async () => {},
    t('Got it', 'Entendi'),
    true,
  );
}
type Quality = { maxSize: number; fps: number; bitrate: number };
/** Where the device settings sheet reads and writes: a mirror window, or the panel. */
interface SettingsHost {
  load(): Promise<{ serial: string; name: string; quality: Quality; wifi: boolean }>;
  /** Saves and says what happened, for the toast. */
  save(value: { name: string; quality: Quality }): Promise<string>;
  useWifi(): Promise<unknown>;
  installApk(): Promise<unknown>;
  /** What saving a new quality does in this place. */
  hint: string;
  afterClose(): void;
}
/** The one device settings sheet, the same in a mirror window and in the panel. */
const settingsSheetMarkup = (place = '') => html`
  <div id="settings-sheet" class="shot ${place}" role="dialog" aria-modal="true" aria-labelledby="settings-title" hidden>
    <form id="settings-form" class="shot-card settings-card">
      <h2 id="settings-title"></h2>
      <label class="sheet-field">
        <span id="settings-name-label"></span>
        <input name="name" maxlength="80">
      </label>
      <small id="settings-serial" class="sheet-note"></small>
      <h3 id="settings-quality-title"></h3>
      <div class="quality-fields">
        <label class="sheet-field"><span id="settings-size-label"></span><select name="maxSize">${[720, 1080, 1280, 1920, 2560, 3840].map((v) => `<option>${v}</option>`).join('')}</select></label>
        <label class="sheet-field"><span>FPS</span><select name="fps">${[15, 24, 30, 60, 90, 120].map((v) => `<option>${v}</option>`).join('')}</select></label>
        <label class="sheet-field"><span>Mbps</span><input name="bitrate" type="number" min="0.5" max="50" step="0.5"></label>
      </div>
      <div class="presets">${[0, 1, 2].map((i) => `<button type="button" data-preset="${i}"></button>`).join('')}</div>
      <p id="settings-quality-hint" class="sheet-note"></p>
      <div class="sheet-tools">
        <button type="button" id="settings-wifi" class="secondary">${icon('wifi')} <span id="settings-wifi-label"></span></button>
        <button type="button" id="settings-apk" class="secondary"><span id="settings-apk-label"></span></button>
      </div>
      <div class="shot-actions">
        <button type="button" id="settings-cancel" class="text-button"></button>
        <button type="submit" id="settings-save" class="primary"></button>
      </div>
    </form>
  </div>
`;
/** Fixed texts of the settings sheet; runs again when the language changes. */
function labelSettingsSheet(): void {
  $('settings-title').textContent = t('Device settings', 'Configurações do aparelho');
  $('settings-name-label').textContent = t('Device name', 'Nome do aparelho');
  $('settings-quality-title').textContent = t('Image quality', 'Qualidade da imagem');
  $('settings-size-label').textContent = t('Maximum resolution', 'Resolução máxima');
  const presets = [t('Low', 'Leve'), t('Balanced', 'Equilibrada'), t('High', 'Alta')];
  document
    .querySelectorAll<HTMLButtonElement>('#settings-form [data-preset]')
    .forEach((button, i) => (button.textContent = presets[i]));
  $('settings-wifi-label').textContent = t('Use over Wi-Fi', 'Usar pela rede Wi-Fi');
  $('settings-apk-label').textContent = t('Install APK', 'Instalar APK');
  $('settings-cancel').textContent = t('Cancel', 'Cancelar');
  $('settings-save').textContent = t('Save', 'Salvar');
}
/** Wires the sheet once per page; `open` takes the host for the device being edited. */
function settingsSheet() {
  const sheet = $('settings-sheet'),
    form = $<HTMLFormElement>('settings-form');
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  let host: SettingsHost | undefined;
  const close = () => {
    sheet.hidden = true;
    host?.afterClose();
    host = undefined;
  };
  const open = async (next: SettingsHost) => {
    const current = await next.load();
    host = next;
    field('name').value = current.name;
    $('settings-serial').textContent = current.serial;
    field('maxSize').value = String(current.quality.maxSize);
    field('fps').value = String(current.quality.fps);
    field('bitrate').value = String(current.quality.bitrate / 1000000);
    $('settings-quality-hint').textContent = next.hint;
    $('settings-wifi').hidden = current.wifi;
    sheet.hidden = false;
    field('name').focus();
  };
  $('settings-cancel').onclick = close;
  sheet.onclick = (event) => {
    if (event.target === sheet) close();
  };
  form.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(
    (button) =>
      (button.onclick = () => {
        const [maxSize, fps, mbps] = [
          [720, 30, 2],
          [1280, 30, 4],
          [1920, 60, 8],
        ][Number(button.dataset.preset)];
        field('maxSize').value = String(maxSize);
        field('fps').value = String(fps);
        field('bitrate').value = String(mbps);
      }),
  );
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!host) return;
    const save = $<HTMLButtonElement>('settings-save');
    save.disabled = true;
    act(
      host
        .save({
          name: field('name').value,
          quality: {
            maxSize: Number(field('maxSize').value),
            fps: Number(field('fps').value),
            bitrate: Number(field('bitrate').value) * 1000000,
          },
        })
        .then((message) => {
          close();
          toast(message);
        })
        .finally(() => (save.disabled = false)),
    );
  };
  $('settings-wifi').onclick = () => {
    if (host)
      act(
        host.useWifi().then(() => {
          close();
          toast(t('Connected over Wi-Fi', 'Conectado pela rede Wi-Fi'));
        }),
      );
  };
  $('settings-apk').onclick = () => {
    if (host)
      act(
        host.installApk().then((name) => {
          if (name) toast(t('APK installed: ', 'APK instalado: ') + String(name));
        }),
      );
  };
  return { open, close, isOpen: () => !sheet.hidden };
}
let panelSettings: ReturnType<typeof settingsSheet> | undefined;
/**
 * The adjust button on a drawn phone. A phone that is mirroring has its settings over its own
 * window, where a new quality applies at once; otherwise they open over the panel.
 */
function openDeviceSettings(d: DeviceRow): void {
  if (d.session) {
    act(api.showMirrorSettings(d.serial));
    return;
  }
  act(
    panelSettings!.open({
      load: async () => ({
        serial: d.serial,
        name: d.name,
        quality: d.quality,
        wifi: d.serial.includes(':'),
      }),
      save: async (value) => {
        await api.rename(d.serial, value.name);
        await api.quality(d.serial, value.quality);
        return t('Settings saved', 'Configurações salvas');
      },
      useWifi: () => api.usbWifi(d.serial),
      installApk: () => api.installApk(d.serial),
      hint: t(
        'The quality applies the next time you mirror.',
        'A qualidade vale a partir da próxima vez que espelhar.',
      ),
      afterClose: () => {},
    }),
  );
}
/**
 * What reads under a phone and the tone that colours it. A live phone keeps reading how it is
 * connected: the drawing already shows it is live, so the text does not jump.
 */
function deviceState(d: DeviceRow): { text: string; tone: string } {
  if (d.recording) return { text: t('Recording', 'Gravando'), tone: 'recording' };
  if (d.session === 'mirroring') return { text: connectionLabel(d), tone: 'live' };
  if (d.session === 'starting') return { text: t('Opening…', 'Abrindo…'), tone: 'busy' };
  if (d.state === 'device') return { text: connectionLabel(d), tone: 'ready' };
  if (d.state === 'unauthorized')
    return { text: t('Allow it on the phone', 'Autorize no celular'), tone: 'warning' };
  return { text: t('Offline', 'Desconectado'), tone: 'warning' };
}
const connectionLabel = (d: DeviceRow) =>
  d.serial.includes(':')
    ? t('Over the network', 'Pela rede')
    : d.serial.startsWith('emulator-')
      ? t('Emulator', 'Emulador')
      : t('Over USB', 'Pelo cabo');
/**
 * Each phone is drawn with its own screen's proportions, always upright, at one height.
 * Until `wm size` answers, a common 20:9 shape stands in.
 */
const PHONE_HEIGHT = 188;
function phoneWidth(ratio: number | null): number {
  const upright = ratio ? Math.min(ratio, 1 / ratio) : 0.45;
  return Math.round(PHONE_HEIGHT * Math.min(0.8, Math.max(0.4, upright)));
}
// The shelf is rebuilt on every state broadcast; remembering the previous tones keeps
// the arrival and "now live" moments to when they actually happen.
let previousTones: Map<string, string> | undefined;
let view: 'home' | 'preferences' = 'home';

function showView(next: typeof view): void {
  view = next;
  $('home').hidden = next !== 'home';
  $('home-foot').hidden = next !== 'home';
  $('preferences').hidden = next !== 'preferences';
  $('open-preferences').setAttribute('aria-pressed', String(next === 'preferences'));
}

function buildPanel(): void {
  root.innerHTML = html`
    <section id="panel">
      <header class="app-titlebar">
        <div class="title-drag">
          ${logoMark()}
          <h1>MirrorPanel</h1>
        </div>
        ${iconButton('open-preferences', '', 'settings')}
        ${windowButtons()}
      </header>
      <main class="home" id="home">
        <div id="shelf" class="shelf"></div>
        <p class="home-hint" id="home-hint"></p>
      </main>
      <section class="preferences" id="preferences" aria-labelledby="preferences-title" hidden>
        <header class="view-head">
          ${iconButton('back', '', 'back')}
          <h2 id="preferences-title"></h2>
        </header>
        <div class="pref-list">
          <div class="pref-row">
            <span id="theme-label"></span>
            <div class="segmented" role="radiogroup" aria-labelledby="theme-label">
              <label><input type="radio" name="theme" value="system"><span id="theme-system"></span></label>
              <label><input type="radio" name="theme" value="light"><span id="theme-light"></span></label>
              <label><input type="radio" name="theme" value="dark"><span id="theme-dark"></span></label>
            </div>
          </div>
          <label class="pref-row">
            <span id="language-label"></span>
            <select id="language">
              <option value="pt">Português</option>
              <option value="en">English</option>
            </select>
          </label>
          <label class="pref-row">
            <span id="awake-label"></span>
            <input id="stay-awake" type="checkbox" data-setting="stayAwake">
            <span class="switch-track" aria-hidden="true"></span>
          </label>
          <label class="pref-row">
            <span id="top-label"></span>
            <input id="always-top" type="checkbox" data-setting="alwaysOnTop">
            <span class="switch-track" aria-hidden="true"></span>
          </label>
          <label class="pref-row">
            <span id="serial-label"></span>
            <input id="show-serial" type="checkbox" data-setting="showSerial">
            <span class="switch-track" aria-hidden="true"></span>
          </label>
          <div class="pref-row">
            <span id="media-label"></span>
            <button id="media" class="text-button">${icon('folder')}<span id="media-open"></span></button>
          </div>
        </div>
        <section class="activity" id="activity" aria-labelledby="activity-title">
          <header class="activity-head">
            <h3 id="activity-title"></h3>
            <span class="activity-summary" id="activity-summary"></span>
            <button id="filter" class="text-button"></button>
            <button id="copy" class="text-button"></button>
            <button id="clear" class="text-button"></button>
          </header>
          <div id="logs" class="logs" role="log" aria-live="polite"></div>
        </section>
        <p class="about" id="about"></p>
      </section>
      ${settingsSheetMarkup('in-panel')}
      <footer class="home-foot" id="home-foot">
        <button id="wifi" class="text-button">${icon('wifi')}<span id="wifi-label"></span></button>
        <button id="issues" class="text-button is-warning" hidden></button>
        <button id="help" class="text-button">${icon('help')}<span id="help-label"></span></button>
      </footer>
    </section>
  `;
  bindWindowButtons();
  panelSettings = settingsSheet();
  $('open-preferences').onclick = () => showView(view === 'home' ? 'preferences' : 'home');
  $('back').onclick = () => showView('home');
  $('issues').onclick = () => {
    showView('preferences');
    $('activity').scrollIntoView({ block: 'start' });
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || dialog.open) return;
    if (panelSettings?.isOpen()) panelSettings.close();
    else if (view === 'preferences') showView('home');
  });
  $('media').onclick = () => act(api.openMedia());
  $('copy').onclick = () => act(api.copyLogs());
  $('clear').onclick = () => act(api.clearLogs());
  $('filter').onclick = () => {
    issuesOnly = !issuesOnly;
    renderPanel(state);
  };
  $('help').onclick = showHelp;
  document
    .querySelectorAll<HTMLInputElement>('[data-setting]')
    .forEach(
      (input) =>
        (input.onchange = () =>
          act(api.preferences({ ...state.settings, [input.dataset.setting!]: input.checked }))),
    );
  document
    .querySelectorAll<HTMLInputElement>('input[name="theme"]')
    .forEach(
      (input) =>
        (input.onchange = () => act(api.preferences({ ...state.settings, theme: input.value }))),
    );
  $<HTMLSelectElement>('language').onchange = () =>
    act(api.preferences({ ...state.settings, language: $<HTMLSelectElement>('language').value }));
  $('wifi').onclick = () =>
    ask(
      html`
        <h2>${t('Connect over the network', 'Conectar pela rede')}</h2>
        <p class="dialog-lead">
          ${t('Use the address shown in Wireless debugging on Android. To pair for the first time, also enter the code.', 'Use o endereço mostrado em Depuração sem fio, no Android. No primeiro pareamento, informe também o código.')}
        </p>
        <label>
          ${t('Address (IP:port)', 'Endereço (IP:porta)')}
          <input required name="address" placeholder="192.168.1.10:5555">
        </label>
        <label>
          ${t('Pairing code (optional)', 'Código de pareamento (opcional)')}
          <input name="code" inputmode="numeric" maxlength="6">
        </label>
      `,
      (data) =>
        String(data.get('code')).trim()
          ? api.pair(data.get('address'), data.get('code'))
          : api.wifi(data.get('address')),
      t('Connect', 'Conectar'),
    );
}

/** What the screen of a drawn phone shows for each tone. */
function phoneScreen(tone: string, d: DeviceRow): string {
  if (tone === 'busy') return '<span class="spinner"></span>';
  if (tone === 'recording') return '<span class="rec-mark"></span>';
  if (tone === 'live') return `<span class="phone-glyph">${icon('show')}</span>`;
  if (tone === 'ready') return `<span class="phone-glyph">${icon('play')}</span>`;
  return d.state === 'unauthorized' ? `<span class="phone-lock">${icon('lock')}</span>` : '';
}

function renderDevices(): void {
  const shelf = $('shelf'),
    focused = shelf.querySelector<HTMLButtonElement>('button:focus');
  const focusSerial = focused?.closest<HTMLElement>('[data-serial]')?.dataset.serial,
    focusAction = focused?.dataset.action;
  const tones = new Map<string, string>();
  shelf.innerHTML = state.devices.length
    ? state.devices
        .map((d, index) => {
          const { text, tone } = deviceState(d);
          tones.set(d.serial, tone);
          const before = previousTones?.get(d.serial);
          const motion =
            previousTones && before === undefined
              ? 'is-new'
              : tone === 'live' && before !== 'live' && before !== 'recording'
                ? 'went-live'
                : '';
          const live = tone === 'live' || tone === 'recording',
            authorized = d.state === 'device',
            name = escape(d.name);
          const action = live
            ? t('Show the window of', 'Mostrar a janela de')
            : t('Mirror', 'Espelhar');
          return html`
            <article class="device is-${tone} ${motion}" data-index="${index}"
              data-serial="${escape(d.serial)}">
              <button class="phone" data-action="start" aria-label="${action} ${name}"
                ${!authorized || tone === 'busy' ? 'disabled' : ''}>
                <span class="phone-screen">${phoneScreen(tone, d)}</span>
              </button>
              <div class="device-caption">
                <div class="device-name-row">
                  <strong class="device-name" title="${name}">${name}</strong>
                  <button class="icon-button device-options" data-action="settings"
                    title="${t('Device settings', 'Ajustes do aparelho')}"
                    aria-label="${t('Settings for', 'Ajustes de')} ${name}"
                    ${!authorized ? 'disabled' : ''}>
                    ${icon('sliders')}
                  </button>
                </div>
                <span class="device-state">${escape(text)}</span>
                ${state.settings.showSerial ? `<span class="device-serial">${escape(d.serial)}</span>` : ''}
              </div>
            </article>
          `;
        })
        .join('')
    : html`
        <div class="empty">
          <span class="phone is-placeholder" aria-hidden="true"><span class="phone-screen"></span></span>
          <h2>${t('Connect a phone with a USB cable', 'Conecte um celular pelo cabo USB')}</h2>
          <p>
            ${t('Turn on USB debugging in developer options and authorize this computer when the phone asks.', 'Ative a depuração USB nas opções do desenvolvedor e autorize este computador quando o celular pedir.')}
          </p>
        </div>
      `;
  previousTones = tones;
  shelf.querySelectorAll<HTMLElement>('[data-index]').forEach((article) => {
    const d = state.devices[Number(article.dataset.index)];
    article.style.setProperty('--phone-w', phoneWidth(d.ratio) + 'px');
  });
  shelf
    .querySelector<HTMLElement>('.is-placeholder')
    ?.style.setProperty('--phone-w', phoneWidth(null) + 'px');
  shelf.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((button) => {
    const article = button.closest<HTMLElement>('[data-index]')!,
      d = state.devices[Number(article.dataset.index)];
    button.onclick = () =>
      button.dataset.action === 'settings'
        ? openDeviceSettings(d)
        : act(api[button.dataset.action!](d.serial));
    if (d.serial === focusSerial && button.dataset.action === focusAction)
      button.focus({ preventScroll: true });
  });
}

function renderActivity(): void {
  const shown = state.logs.filter((l) => !issuesOnly || l.level !== 'info');
  $('logs').innerHTML =
    shown
      .map(
        (l) =>
          `<div class="log-line ${escape(l.level)}"><time>${escape(l.time)}</time><span>${escape(l.message)}</span></div>`,
      )
      .join('') ||
    `<p class="log-empty">${t('No events in this session.', 'Nenhum evento nesta sessão.')}</p>`;
  const issues = state.logs.filter((l) => l.level !== 'info').length;
  const count = issues
    ? issues === 1
      ? t('1 warning', '1 aviso')
      : `${issues} ${t('warnings', 'avisos')}`
    : '';
  $('activity-summary').textContent = count;
  $('issues').textContent = count;
  $('issues').hidden = !issues;
}

function renderPanel(next: unknown): void {
  state = next as PanelState;
  applyLanguage(state.settings.language);
  if (!$('panel')) buildPanel();
  const idle = state.devices.length > 0 && state.devices.every((d) => !d.session);
  const labels: Record<string, string> = {
    'home-hint': idle ? t('Click a phone to mirror it.', 'Clique no celular para espelhar.') : '',
    'wifi-label': t('Connect over the network', 'Conectar pela rede'),
    'help-label': t('Help', 'Ajuda'),
    'preferences-title': t('Preferences', 'Preferências'),
    'theme-label': t('Theme', 'Tema'),
    'theme-system': t('Automatic', 'Automático'),
    'theme-light': t('Light', 'Claro'),
    'theme-dark': t('Dark', 'Escuro'),
    'language-label': t('Language', 'Idioma'),
    'awake-label': t(
      'Keep the phone screen on over USB',
      'Manter a tela do celular ligada pelo USB',
    ),
    'top-label': t('Keep mirror windows on top', 'Janelas de espelho sempre no topo'),
    'serial-label': t('Show serial numbers', 'Mostrar números de série'),
    'media-label': t('Screenshots and recordings', 'Capturas e gravações'),
    'media-open': t('Open folder', 'Abrir pasta'),
    'activity-title': t('Activity', 'Atividade'),
    filter: issuesOnly ? t('Show all', 'Mostrar tudo') : t('Warnings only', 'Só avisos'),
    copy: t('Copy', 'Copiar'),
    clear: t('Clear', 'Limpar'),
  };
  for (const [id, text] of Object.entries(labels)) $(id).textContent = text;
  $('home-hint').hidden = !idle;
  labelWindowButtons();
  labelSettingsSheet();
  // The name is just MirrorPanel; the version reads like one: "2.0.0 (preview 5)".
  const [number, preview] = state.version.split('-preview.');
  $('about').textContent =
    t('MirrorPanel, version ', 'MirrorPanel, versão ') +
    number +
    (preview ? t(' (preview ', ' (prévia ') + preview + ')' : '');
  label($('open-preferences'), t('Preferences', 'Preferências'));
  label($('back'), t('Back', 'Voltar'));
  $<HTMLInputElement>('show-serial').checked = state.settings.showSerial;
  $<HTMLInputElement>('always-top').checked = state.settings.alwaysOnTop;
  $<HTMLInputElement>('stay-awake').checked = state.settings.stayAwake;
  $<HTMLSelectElement>('language').value = state.settings.language;
  document
    .querySelectorAll<HTMLInputElement>('input[name="theme"]')
    .forEach((input) => (input.checked = input.value === state.settings.theme));
  renderDevices();
  renderActivity();
}

function mirror(): void {
  document.body.classList.add('mirror-body');
  const params = new URLSearchParams(location.search);
  applyLanguage(params.get('lang'));
  let deviceName = params.get('name') ?? 'Android',
    recording = false,
    audioState = 'off';
  // Fullscreen lives in the menu (and on F11) so the device name keeps room in a narrow window.
  const toolbar = ['capture', 'record', 'audio', 'more']
    .map((id) =>
      iconButton(
        id,
        '',
        id,
        id === 'audio'
          ? 'aria-pressed="false"'
          : id === 'more'
            ? 'aria-expanded="false" aria-controls="mirror-menu"'
            : '',
      ),
    )
    .join('');
  root.innerHTML = html`
    <section class="mirror">
      <header class="mirror-titlebar">
        <div class="mirror-device title-drag" id="mirror-title">
          <span class="live-dot" aria-hidden="true"></span><span id="mirror-name"></span>
        </div>
        <div class="mirror-actions">${toolbar}</div>
        ${windowButtons()}
      </header>
      <div id="mirror-menu" class="mirror-menu" hidden>
        <button id="show-panel">${icon('phone')} <span id="show-panel-text"></span></button>
        <button id="device-settings">${icon('sliders')} <span id="device-settings-text"></span></button>
        <button id="paste-text">${icon('paste')} <span id="paste-text-label"></span> <kbd>Ctrl+V</kbd></button>
        <button id="screen-power">${icon('power')} <span id="screen-power-text"></span></button>
        <button id="fullscreen">${icon('fullscreen')} <span id="fullscreen-text"></span> <kbd>F11</kbd></button>
        <button id="pin-window" aria-pressed="false">${icon('pin')} <span id="pin-window-text"></span></button>
        <div class="volume-control">
          ${icon('audio')}
          <label for="volume" id="volume-label"></label>
          <input id="volume" type="range" min="0" max="100" value="100">
        </div>
        <button id="mirror-help">${icon('help')} <span id="mirror-help-text"></span></button>
      </div>
      <div id="apk-drop" class="apk-drop" hidden role="status"></div>
      ${settingsSheetMarkup()}
      <div id="audio-hint" class="audio-hint" role="status" hidden>
        <strong id="audio-hint-title"></strong>
        <span id="audio-hint-text"></span>
      </div>
      <div id="shot" class="shot" role="dialog" aria-modal="true" aria-labelledby="shot-title" hidden>
        <div class="shot-card">
          <h2 id="shot-title"></h2>
          <div id="shot-frame" class="shot-frame"></div>
          <div class="shot-actions">
            <button id="shot-discard" class="text-button"></button>
            <button id="shot-save" class="secondary"></button>
            <button id="shot-copy" class="primary"></button>
          </div>
        </div>
      </div>
      <div class="viewport">
        <canvas id="video" tabindex="0"></canvas>
        <span id="touch-anchor" hidden aria-hidden="true"></span>
        <textarea id="text-input" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
        <div id="video-status" class="video-status">
          <div class="status-card">
            <span id="status-spinner" class="spinner" aria-hidden="true"></span>
            <h2 id="status-title" hidden></h2>
            <p id="status-message"></p>
            <div id="status-actions" class="status-actions" hidden>
              <button id="close-mirror"></button>
              <button id="reconnect"></button>
            </div>
          </div>
        </div>
      </div>
      <nav class="android-navigation">
        ${iconButton('back', '')}${iconButton('home', '')}${iconButton('recent', '')}
      </nav>
    </section>
  `;
  const recordLabel = () =>
    recording ? t('Stop recording', 'Finalizar gravação') : t('Record video', 'Gravar vídeo');
  const audioLabel = () =>
    audioState === 'started'
      ? t('Turn audio off', 'Desligar áudio')
      : audioState === 'starting'
        ? t('Allow it on your phone…', 'Autorize no celular…')
        : t('Turn audio on', 'Ativar áudio');
  /** Every fixed text of the mirror window; runs again when the language changes. */
  const applyTexts = () => {
    $('mirror-name').textContent = deviceName;
    $('mirror-title').title = deviceName;
    $('show-panel-text').textContent = t('Show the panel', 'Mostrar o painel');
    $('shot-title').textContent = t('Screenshot', 'Captura de tela');
    $('shot-discard').textContent = t('Discard', 'Descartar');
    $('shot-save').textContent = t('Save', 'Salvar');
    $('shot-copy').textContent = t('Copy', 'Copiar');
    labelSettingsSheet();
    label($('capture'), t('Take screenshot', 'Capturar tela'));
    label($('record'), recordLabel());
    label($('audio'), audioLabel());
    $('fullscreen-text').textContent = t('Fullscreen', 'Tela cheia');
    label($('more'), t('More controls', 'Mais controles'));
    $('device-settings-text').textContent = t('Device settings', 'Configurações do aparelho');
    $('paste-text-label').textContent = t('Paste on device', 'Colar no aparelho');
    $('screen-power-text').textContent = t('Screen on / off', 'Ligar / desligar tela');
    $('pin-window-text').textContent = t('Always on top', 'Sempre no topo');
    $('volume-label').textContent = t('PC volume', 'Volume no PC');
    $('volume').setAttribute('aria-label', t('Computer volume', 'Volume no computador'));
    $('mirror-help-text').textContent = t('Mouse and shortcuts', 'Mouse e atalhos');
    $('audio-hint-title').textContent = t(
      'Tap “Start now” on the phone',
      'Toque em “Iniciar” no celular',
    );
    $('audio-hint-text').textContent = t(
      'Android calls letting the sound out “recording or casting”. MirrorPanel only uses the audio.',
      'O Android chama a liberação do som de “gravação ou transmissão”. O MirrorPanel usa só o áudio.',
    );
    $('apk-drop').textContent = t(
      'Drop to send the files to Android (Download folder). A single APK is installed.',
      'Solte para enviar os arquivos ao Android (pasta Download). Um APK sozinho é instalado.',
    );
    $('video').setAttribute(
      'aria-label',
      t(
        'Device screen: control it with mouse and keyboard',
        'Tela do aparelho: controle com mouse e teclado',
      ),
    );
    $('text-input').setAttribute(
      'aria-label',
      t('Type to send text to the device', 'Digite para enviar texto ao aparelho'),
    );
    $('reconnect').textContent = t('Try again', 'Tentar de novo');
    $('close-mirror').textContent = t('Close', 'Fechar');
    document
      .querySelector('.android-navigation')!
      .setAttribute('aria-label', t('Android navigation', 'Navegação Android'));
    label($('back'), t('Back (Esc)', 'Voltar (Esc)'));
    label($('home'), t('Home', 'Início'));
    label($('recent'), t('Recent apps', 'Apps recentes'));
    labelWindowButtons();
  };
  applyTexts();
  $('status-message').textContent = t('Connecting to the device…', 'Conectando ao aparelho…');
  api.onLanguage((value: unknown) => {
    applyLanguage(value);
    applyTexts();
  });
  api.onDeviceName((name: unknown) => {
    deviceName = String(name);
    applyTexts();
  });
  bindWindowButtons();
  document.querySelectorAll<HTMLButtonElement>('.android-navigation button').forEach(bindRipple);
  api.onWindowLayout((value: unknown) => {
    document.body.classList.toggle('window-contained', (value as { contained: boolean }).contained);
    layoutVideo();
  });
  const drop = $('apk-drop');
  let dragDepth = 0,
    transferring = false,
    dragWatch: ReturnType<typeof setTimeout> | undefined;
  const hideDrop = () => {
    dragDepth = 0;
    drop.hidden = true;
    clearTimeout(dragWatch);
  };
  document.addEventListener('dragenter', (event) => {
    event.preventDefault();
    if (event.dataTransfer?.types.includes('Files')) {
      dragDepth++;
      drop.hidden = false;
    }
  });
  document.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = transferring ? 'none' : 'copy';
    // Chromium repeats dragover while files hover the window; if they stop (a drag
    // cancelled without dragleave), the banner must not stay over the screen.
    clearTimeout(dragWatch);
    if (!drop.hidden) dragWatch = setTimeout(hideDrop, 700);
  });
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) hideDrop();
  });
  window.addEventListener('blur', hideDrop);
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    hideDrop();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    if (transferring) {
      toast(
        t('Wait for the current transfer to finish.', 'Aguarde a transferência atual terminar.'),
      );
      return;
    }
    transferring = true;
    // A single APK is installed; anything else is copied to the phone's Download folder.
    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.apk')) {
      document.body.dataset.apkInstall = 'installing';
      toast(t('Installing ', 'Instalando ') + files[0].name + '…');
      clearTimeout(toastTimer);
      void Promise.resolve()
        .then(() => api.installDroppedApk(files[0]))
        .then((name) => {
          document.body.dataset.apkInstall = 'success';
          toast(t('Installed: ', 'Instalado: ') + String(name));
        })
        .catch((error) => {
          document.body.dataset.apkInstall = 'error';
          toast(error);
        })
        .finally(() => (transferring = false));
      return;
    }
    document.body.dataset.fileTransfer = 'sending';
    toast(
      files.length === 1
        ? t('Sending ', 'Enviando ') + files[0].name + '…'
        : t(`Sending ${files.length} files…`, `Enviando ${files.length} arquivos…`),
    );
    clearTimeout(toastTimer);
    void Promise.resolve()
      .then(() => api.sendDroppedFiles(files))
      .then((names) => {
        document.body.dataset.fileTransfer = 'success';
        const saved = names as string[];
        toast(
          saved.length === 1
            ? t('Saved to Download: ', 'Salvo em Download: ') + saved[0]
            : t(
                `${saved.length} files saved to Download`,
                `${saved.length} arquivos salvos em Download`,
              ),
        );
      })
      .catch((error) => {
        document.body.dataset.fileTransfer = 'error';
        toast(error);
      })
      .finally(() => (transferring = false));
  });
  const menu = $('mirror-menu'),
    closeMenu = () => {
      menu.hidden = true;
      $('more').setAttribute('aria-expanded', 'false');
    };
  $('more').onclick = () => {
    menu.hidden = !menu.hidden;
    $('more').setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden)
      act(
        api.windowAction('state').then((value) => {
          $('pin-window').setAttribute(
            'aria-pressed',
            String((value as { alwaysOnTop: boolean }).alwaysOnTop),
          );
        }),
      );
  };
  document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target as Node) && !$('more').contains(event.target as Node))
      closeMenu();
  });
  $('show-panel').onclick = () => {
    closeMenu();
    act(api.windowAction('panel'));
  };
  // Device settings over this window, about this device; the panel's adjust button opens them
  // here too while this phone is mirroring.
  const settings = settingsSheet();
  const openSettings = () => {
    closeMenu();
    return settings.open({
      load: () =>
        api.mirrorSettings() as Promise<{
          serial: string;
          name: string;
          quality: Quality;
          wifi: boolean;
        }>,
      save: (value) =>
        api
          .saveMirrorSettings(value)
          .then((result) =>
            (result as { reconnecting: boolean }).reconnecting
              ? t('Reconnecting with the new quality…', 'Reconectando com a nova qualidade…')
              : t('Settings saved', 'Configurações salvas'),
          ),
      useWifi: () => api.mirrorUsbWifi(),
      installApk: () => api.mirrorInstallApk(),
      hint: t(
        'Saving a new quality reconnects the mirror to apply it.',
        'Ao salvar uma qualidade nova, o espelhamento reconecta para aplicar.',
      ),
      afterClose: () => canvas.focus({ preventScroll: true }),
    });
  };
  $('device-settings').onclick = () => act(openSettings());
  api.onOpenSettings(() => act(openSettings()));
  $('paste-text').onclick = () => {
    closeMenu();
    act(api.paste());
  };
  $('screen-power').onclick = () => {
    closeMenu();
    act(api.control({ type: 'key', code: 26 }));
  };
  $('pin-window').onclick = () =>
    act(
      api.windowAction('always-on-top').then((value) => {
        $('pin-window').setAttribute(
          'aria-pressed',
          String((value as { alwaysOnTop: boolean }).alwaysOnTop),
        );
      }),
    );
  $('mirror-help').onclick = () => {
    closeMenu();
    showHelp();
  };

  const canvas = $<HTMLCanvasElement>('video'),
    context = canvas.getContext('2d', { alpha: false })!;
  let videoSize: Info | undefined;
  function layoutVideo(): void {
    if (!videoSize) return;
    const bounds = canvas.parentElement!.getBoundingClientRect();
    const contained =
      document.body.classList.contains('window-contained') || Boolean(document.fullscreenElement);
    const side = Math.max(bounds.width, bounds.height);
    const scale = Math.min(
      (contained ? bounds.width : side) / videoSize.width,
      (contained ? bounds.height : side) / videoSize.height,
    );
    canvas.style.width = Math.round(videoSize.width * scale) + 'px';
    canvas.style.height = Math.round(videoSize.height * scale) + 'px';
  }
  window.addEventListener('resize', layoutVideo);
  document.addEventListener('fullscreenchange', layoutVideo);
  let decoder: VideoDecoder | undefined,
    config = new Uint8Array(0),
    codec = 'avc1.42e01f',
    needsKey = true,
    fresh = false,
    frames = 0,
    dropped = 0;
  // Two decoder errors with no frame in between usually mean the GPU path cannot
  // handle this stream; the software decoder is slower but keeps the mirror alive.
  let acceleration: HardwareAcceleration = 'prefer-hardware',
    failures = 0,
    lastSyncRequest = 0;
  const status = $('video-status');
  /** The first frame of a session fades in over the cover instead of cutting to it. */
  const reveal = () => {
    const viewport = document.querySelector<HTMLElement>('.viewport')!;
    viewport.classList.add('is-revealing');
    viewport.addEventListener('animationend', () => viewport.classList.remove('is-revealing'), {
      once: true,
    });
  };
  /**
   * With the picture already on screen a passing status is a small note over it. When the
   * person has to decide (try again or close), a card asks over the last picture, dimmed,
   * or over the cover if no frame ever arrived.
   */
  const showStatus = (message: string, retry = false) => {
    $('status-message').textContent = message;
    status.hidden = !message;
    if (message) document.body.classList.remove('is-live');
    status.classList.toggle('is-notice', Boolean(message) && frames > 0 && !retry);
    status.classList.toggle('is-asking', retry);
    status.classList.toggle('is-over-picture', retry && frames > 0);
    $('status-title').textContent =
      frames > 0
        ? t('Mirroring stopped', 'Espelhamento interrompido')
        : t('Mirroring could not start', 'Não foi possível espelhar');
    $('status-title').hidden = !retry;
    $('status-spinner').hidden = retry;
    $('status-actions').hidden = !retry;
  };
  let inputReady = false;
  const control = (value: unknown) => (inputReady ? api.control(value) : Promise.resolve());
  const editor = $<HTMLTextAreaElement>('text-input');
  const gestures = new Gestures((command) => act(control(command)));
  const anchor = $('touch-anchor');
  const updateAnchor = () => {
    const point = gestures.anchor;
    anchor.hidden = !point;
    if (point) {
      const bounds = canvas.getBoundingClientRect(),
        parent = canvas.parentElement!.getBoundingClientRect();
      anchor.style.left = bounds.left - parent.left + point.x * bounds.width + 'px';
      anchor.style.top = bounds.top - parent.top + point.y * bounds.height + 'px';
    }
  };
  const cancel = () => {
    gestures.cancel();
    updateAnchor();
  };
  const audio = new AudioPlayer((message) => toast(t('Audio: ', 'Áudio: ') + message));
  $('audio').onclick = () =>
    act(
      (async () => {
        const enabled = audioState !== 'started';
        if (enabled) await audio.activate();
        await api.audio(enabled);
      })(),
    );
  $<HTMLInputElement>('volume').oninput = (event) =>
    audio.setVolume(Number((event.target as HTMLInputElement).value) / 100);
  api.onAudioState((value: unknown) => {
    const status = value as { state: string; message: string };
    audioState = status.state;
    label($('audio'), audioLabel());
    $('audio').setAttribute('aria-pressed', String(audioState === 'started'));
    $<HTMLButtonElement>('audio').disabled = audioState === 'starting';
    // Android's permission dialog speaks of recording or casting; say what to tap and why.
    $('audio-hint').hidden = audioState !== 'starting';
    if (audioState === 'off' || audioState === 'error') audio.reset();
    if (audioState === 'error') toast(status.message);
  });
  api.onAudioConfig((value: unknown) => {
    try {
      audio.configure(new Uint8Array(value as Uint8Array));
    } catch (error) {
      toast(error);
    }
  });
  api.onAudioFrame((value: unknown) => {
    const packet = value as FramePacket;
    try {
      audio.decode(packet.pts, packet.data);
      canvas.dataset.audioFrames = String(audio.decoded);
      canvas.dataset.audioPeak = String(audio.peak);
    } catch (error) {
      toast(error);
    } finally {
      api.ack(packet.id);
    }
  });
  /** Asks Android for a keyframe, at most once per second unless forced. */
  const requestSync = (force = false) => {
    const now = performance.now();
    if (!force && now - lastSyncRequest < SYNC_INTERVAL_MS) return;
    lastSyncRequest = now;
    act(control({ type: 'sync' }));
  };
  const reset = (): VideoDecoder => {
    if (decoder && decoder.state !== 'closed') decoder.close();
    needsKey = true;
    fresh = true;
    const created = new VideoDecoder({
      output: (frame) => {
        // Assigning the canvas size clears it, so only do it when the stream size changes.
        if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth;
        if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight;
        context.drawImage(frame, 0, 0);
        frame.close();
        failures = 0;
        frames++;
        canvas.dataset.frames = String(frames);
        canvas.dataset.dropped = String(dropped);
        if (frames === 1) reveal();
        if (inputReady) {
          status.hidden = true;
          document.body.classList.add('is-live');
        }
      },
      error: (error) => {
        needsKey = true;
        if (++failures >= 2) acceleration = 'no-preference';
        console.warn('Video decoder error, recovering on the next keyframe:', error.message);
        if (inputReady) {
          showStatus(t('Restoring the picture…', 'Recuperando a imagem…'));
          requestSync(true);
        }
      },
    });
    created.configure({ codec, optimizeForLatency: true, hardwareAcceleration: acceleration });
    decoder = created;
    return created;
  };
  api.onInfo((value: unknown) => {
    const info = value as Info;
    cancel();
    inputReady = true;
    videoSize = info;
    canvas.width = info.width;
    canvas.height = info.height;
    layoutVideo();
    config = new Uint8Array(0);
    if (decoder && decoder.state !== 'closed') decoder.close();
    decoder = undefined;
    needsKey = true;
  });
  api.onConfig((value: unknown) => {
    config = new Uint8Array(value as Uint8Array);
    for (let i = 0; i < config.length - 7; i++)
      if (
        config[i] === 0 &&
        config[i + 1] === 0 &&
        (config[i + 2] === 1 || (config[i + 2] === 0 && config[i + 3] === 1))
      ) {
        const offset = i + (config[i + 2] === 1 ? 3 : 4);
        if ((config[offset] & 31) === 7) {
          codec =
            'avc1.' +
            Array.from(config.subarray(offset + 1, offset + 4))
              .map((n) => n.toString(16).padStart(2, '0'))
              .join('');
          break;
        }
      }
    reset();
  });
  api.onFrame((value: unknown) => {
    const packet = value as FramePacket;
    try {
      const key = Boolean(packet.flags & 1);
      const state = {
        exists: decoder !== undefined,
        closed: decoder?.state === 'closed',
        fresh,
        queueSize: decoder?.decodeQueueSize ?? 0,
      };
      const action = admitFrame(state, config.length > 0, needsKey, key);
      if (action === 'ignore') return;
      if (action === 'drop' || action === 'drop-and-sync') {
        dropped++;
        needsKey = true;
        if (action === 'drop-and-sync') requestSync();
        return;
      }
      const target = action === 'restart-and-decode' ? reset() : decoder!;
      needsKey = false;
      fresh = false;
      let bytes = new Uint8Array(packet.data);
      if (key) {
        const combined = new Uint8Array(config.length + bytes.length);
        combined.set(config);
        combined.set(bytes, config.length);
        bytes = combined;
      }
      target.decode(
        new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: packet.pts, data: bytes }),
      );
    } catch (error) {
      toast(error);
      needsKey = true;
      requestSync();
    } finally {
      api.ack(packet.id);
    }
  });
  $('reconnect').onclick = () => act(api.windowAction('reconnect'));
  $('close-mirror').onclick = () => act(api.windowAction('close'));
  api.onStatus((value: unknown) => {
    const update =
      typeof value === 'string'
        ? { message: value, retry: false }
        : (value as { message: string; retry: boolean });
    inputReady = !update.message;
    showStatus(update.message, update.retry);
    if (update.message) cancel();
  });
  const recordingState = (active: unknown) => {
    recording = Boolean(active);
    $('record').classList.toggle('is-recording', recording);
    label($('record'), recordLabel());
  };
  api.onRecording(recordingState);
  const fullscreen = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
  $('fullscreen').onclick = () => {
    closeMenu();
    act(fullscreen());
  };
  $('back').onclick = () => act(control({ type: 'key', code: 4 }));
  $('home').onclick = () => act(control({ type: 'key', code: 3 }));
  $('recent').onclick = () => act(control({ type: 'key', code: 187 }));
  $('record').onclick = () =>
    act(
      api.record().then((path) => {
        recordingState(path);
      }),
    );
  // A screenshot freezes the current frame into a preview; the person then copies, saves or
  // discards it. The preview owns the keyboard while open, so nothing reaches the phone.
  let shot: HTMLCanvasElement | null = null;
  const closeShot = () => {
    $('shot').hidden = true;
    $('shot-frame').replaceChildren();
    shot = null;
    canvas.focus({ preventScroll: true });
  };
  const finishShot = (action: 'copy' | 'save') => {
    if (!shot) return;
    const png = new Promise<Uint8Array>((resolve, reject) =>
      shot!.toBlob(
        (blob) =>
          blob
            ? blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
            : reject(Error(t('Could not create the image', 'Não foi possível gerar a imagem'))),
        'image/png',
      ),
    );
    closeShot();
    act(
      png
        .then((bytes) =>
          action === 'copy'
            ? api.copyPng(bytes).then(() => t('Screenshot copied', 'Captura copiada'))
            : api
                .savePng(bytes)
                .then(() =>
                  t('Screenshot saved to MirrorPanel Media', 'Captura salva em MirrorPanel Media'),
                ),
        )
        .then(toast),
    );
  };
  const screenshot = () => {
    if (!frames) {
      toast(t('Wait for the first frame', 'Aguarde o primeiro quadro'));
      return;
    }
    if (shot) return;
    closeMenu();
    shot = document.createElement('canvas');
    shot.width = canvas.width;
    shot.height = canvas.height;
    shot.getContext('2d')!.drawImage(canvas, 0, 0);
    shot.setAttribute('role', 'img');
    shot.setAttribute('aria-label', t('Screenshot preview', 'Prévia da captura'));
    $('shot-frame').replaceChildren(shot);
    $('shot').hidden = false;
    $('shot-copy').focus();
  };
  $('shot-copy').onclick = () => finishShot('copy');
  $('shot-save').onclick = () => finishShot('save');
  $('shot-discard').onclick = closeShot;
  $('shot').onclick = (event) => {
    if (event.target === $('shot')) closeShot();
  };
  $('capture').onclick = screenshot;
  api.onScreenshot(screenshot);
  const point = (event: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
    };
  };
  canvas.onpointerdown = (event) => {
    if (event.button === 1) {
      event.preventDefault();
      act(control({ type: 'key', code: 3 }));
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    editor.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    const p = point(event);
    if (event.altKey && event.pointerType === 'mouse') {
      gestures.anchorAt(p.x, p.y);
      updateAnchor();
      return;
    }
    gestures.down(event.pointerId, p.x, p.y);
  };
  canvas.onpointermove = (event) => {
    const p = point(event);
    gestures.move(event.pointerId, p.x, p.y);
  };
  canvas.onpointerup = (event) => {
    const p = point(event);
    gestures.up(event.pointerId, p.x, p.y);
  };
  canvas.onpointercancel = cancel;
  window.onblur = cancel;
  window.addEventListener('resize', updateAnchor);
  canvas.oncontextmenu = (event) => {
    event.preventDefault();
    act(control({ type: 'key', code: 4 }));
  };
  let scrolling = false;
  canvas.onwheel = (event) => {
    event.preventDefault();
    if (scrolling || gestures.active) return;
    scrolling = true;
    const p = point(event),
      distance = Math.sign(event.deltaY) * -0.22;
    void (async () => {
      try {
        await control({ type: 'touch', action: 0, ...p });
        for (let step = 1; step <= 6; step++) {
          await new Promise((r) => setTimeout(r, 15));
          await control({
            type: 'touch',
            action: 2,
            x: p.x,
            y: Math.max(0.01, Math.min(0.99, p.y + (distance * step) / 6)),
          });
        }
        await control({
          type: 'touch',
          action: 1,
          x: p.x,
          y: Math.max(0.01, Math.min(0.99, p.y + distance)),
        });
      } catch (e) {
        toast(e);
      } finally {
        scrolling = false;
      }
    })();
  };
  let composing = false;
  const sendInput = () => {
    if (composing || !editor.value) return;
    const text = editor.value;
    editor.value = '';
    act(control({ type: 'text', text }));
  };
  editor.addEventListener('compositionstart', () => {
    composing = true;
  });
  editor.addEventListener('compositionend', () => {
    composing = false;
    sendInput();
  });
  editor.oninput = (event) => {
    if (!(event as InputEvent).isComposing) sendInput();
  };
  editor.onpaste = (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain');
    if (text) act(control({ type: 'text', text }));
  };
  window.onkeydown = (event) => {
    if (dialog.open || composing || event.isComposing) return;
    if (settings.isOpen()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        settings.close();
      }
      return; // typing goes to the form, never to the phone
    }
    if (!$('shot').hidden) {
      const key = event.key.toLowerCase();
      if (event.key === 'Escape') closeShot();
      else if (event.ctrlKey && key === 'c') finishShot('copy');
      else if (event.ctrlKey && key === 's') finishShot('save');
      else return; // Tab, Enter and Space keep working on the preview's own buttons
      event.preventDefault();
      return;
    }
    if (event.key === 'F11') {
      event.preventDefault();
      act(fullscreen());
      return;
    }
    if (event.key === 'Escape' && document.fullscreenElement) {
      event.preventDefault();
      act(document.exitFullscreen());
      return;
    }
    if (event.key === 'Escape' && gestures.active) {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.target !== editor && event.target !== canvas && event.key !== 'Escape') return;
    const key: Record<string, number> = {
      Escape: 4,
      Home: 3,
      Enter: 66,
      Backspace: 67,
      Delete: 112,
      Tab: 61,
      ArrowUp: 19,
      ArrowDown: 20,
      ArrowLeft: 21,
      ArrowRight: 22,
      End: 187,
    };
    if (key[event.key]) {
      event.preventDefault();
      act(control({ type: 'key', code: key[event.key] }));
    }
  };
  window.addEventListener('beforeunload', () => {
    cancel();
    if (decoder && decoder.state !== 'closed') decoder.close();
    audio.close();
  });
}
if (new URLSearchParams(location.search).get('view') === 'mirror') mirror();
else {
  api.onState(renderPanel);
  void api.snapshot().then(renderPanel).catch(toast);
}
export {};
