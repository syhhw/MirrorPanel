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
}
interface PanelState {
  devices: DeviceRow[];
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
  confirm = t('Salvar', 'Save'),
  single = false,
): void {
  $('dialog-content').innerHTML = content;
  $('confirm').textContent = confirm;
  $('cancel').textContent = t('Cancelar', 'Cancel');
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
    minimize: t('Minimizar', 'Minimize'),
    maximize: t('Maximizar / restaurar', 'Maximize / restore'),
    close: t('Fechar', 'Close'),
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
      <h2>${t('Mouse e atalhos', 'Mouse and shortcuts')}</h2>
      <dl class="shortcuts">
        ${shortcut('<kbd>Alt</kbd> + ' + t('clique', 'click'), t('Fixa um dedo; arraste o segundo ponto para multitoque', 'Anchors one finger; drag the second point for multitouch'))}
        ${shortcut(t('Botão direito', 'Right button'), t('Voltar', 'Back'))}
        ${shortcut(t('Botão do meio', 'Middle button'), t('Início', 'Home'))}
        ${shortcut('<kbd>Esc</kbd>', t('Voltar ou soltar os contatos', 'Back, or release the contacts'))}
        ${shortcut('<kbd>Home</kbd>', t('Início', 'Home'))}
        ${shortcut('<kbd>End</kbd>', t('Apps recentes', 'Recent apps'))}
        ${shortcut('<kbd>Ctrl</kbd> + <kbd>V</kbd>', t('Cola o texto do computador no celular', 'Pastes the computer text on the phone'))}
        ${shortcut('<kbd>F11</kbd>', t('Tela cheia', 'Fullscreen'))}
      </dl>
      <h3>${t('Conexão USB', 'USB connection')}</h3>
      <p>
        ${t('Ative a depuração USB nas opções do desenvolvedor e autorize este computador no celular. Para ouvir o áudio, aceite a captura quando o Android pedir.', 'Turn on USB debugging in developer options and authorize this computer on the phone. To hear audio, accept the capture when Android asks.')}
      </p>
    `,
    async () => {},
    t('Entendi', 'Got it'),
    true,
  );
}
function showDeviceSettings(d: DeviceRow): void {
  if (dialog.open) dialog.close();
  ask(
    html`
      <h2>${t('Configurações do aparelho', 'Device settings')}</h2>
      <div class="settings-section">
        <h3>${t('Janela', 'Window')}</h3>
        <label>
          ${t('Nome do aparelho', 'Device name')}
          <input name="name" maxlength="80" value="${escape(d.name)}">
        </label>
        <small>${escape(d.serial)}</small>
      </div>
      <div class="settings-section">
        <h3>${t('Qualidade da imagem', 'Image quality')}</h3>
        <fieldset ${d.session ? 'disabled' : ''}>
          <div class="quality-fields">
            <label>
              ${t('Resolução máxima', 'Maximum resolution')}
              <select name="maxSize">
                ${[720, 1080, 1280, 1920, 2560, 3840].map((v) => `<option ${v === d.quality.maxSize ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </label>
            <label>
              FPS
              <select name="fps">
                ${[15, 24, 30, 60, 90, 120].map((v) => `<option ${v === d.quality.fps ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </label>
            <label>
              Mbps
              <input name="bitrate" type="number" min="0.5" max="50" step="0.5"
                value="${d.quality.bitrate / 1000000}">
            </label>
          </div>
          <div class="presets">
            ${[t('Leve', 'Low'), t('Equilibrada', 'Balanced'), t('Alta', 'High')].map((s, i) => `<button type="button" data-preset="${i}">${s}</button>`).join('')}
          </div>
        </fieldset>
        <p class="field-hint">
          ${d.session ? t('Pare o espelhamento para alterar a qualidade.', 'Stop mirroring to change quality.') : t('A qualidade escolhida será usada na próxima conexão.', 'The selected quality applies on the next connection.')}
        </p>
      </div>
      <div class="settings-section">
        <h3>${t('Aparelho', 'Device')}</h3>
        <div class="device-settings-actions">
          <button type="button" data-device-tool="usbWifi"
            ${d.serial.includes(':') || d.state !== 'device' ? 'disabled' : ''}>
            ${icon('wifi')} ${t('Usar Wi-Fi', 'Use Wi-Fi')}
          </button>
          <button type="button" data-device-tool="installApk" ${d.state !== 'device' ? 'disabled' : ''}>
            ${t('Instalar APK', 'Install APK')}
          </button>
          ${d.session ? `<button type="button" class="danger" data-device-tool="stop">${t('Parar espelhamento', 'Stop mirroring')}</button>` : ''}
        </div>
      </div>
    `,
    async (data) => {
      await api.rename(d.serial, String(data.get('name')));
      if (!d.session)
        await api.quality(d.serial, {
          maxSize: Number(data.get('maxSize')),
          fps: Number(data.get('fps')),
          bitrate: Number(data.get('bitrate')) * 1000000,
        });
    },
    t('Salvar', 'Save'),
  );
  dialog.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(
    (button) =>
      (button.onclick = () => {
        const preset = [
          [720, 30, 2],
          [1280, 30, 4],
          [1920, 60, 8],
        ][Number(button.dataset.preset)];
        ['maxSize', 'fps', 'bitrate'].forEach(
          (name, i) =>
            ((form.elements.namedItem(name) as HTMLInputElement).value = String(preset[i])),
        );
      }),
  );
  dialog.querySelectorAll<HTMLButtonElement>('[data-device-tool]').forEach(
    (button) =>
      (button.onclick = () =>
        act(
          (async () => {
            await api[button.dataset.deviceTool!](d.serial);
            dialog.close();
          })(),
        )),
  );
}
/** How a device row reads: its state text and the tone that colours it. */
function deviceState(d: DeviceRow): { text: string; tone: string } {
  if (d.recording) return { text: t('Gravando', 'Recording'), tone: 'recording' };
  if (d.session === 'mirroring') return { text: t('Espelhando', 'Mirroring'), tone: 'live' };
  if (d.session === 'starting') return { text: t('Conectando…', 'Connecting…'), tone: 'busy' };
  if (d.state === 'device') return { text: t('Pronto', 'Ready'), tone: 'ready' };
  if (d.state === 'unauthorized')
    return { text: t('Autorize no celular', 'Allow it on the phone'), tone: 'warning' };
  return { text: t('Desconectado', 'Offline'), tone: 'warning' };
}
const connectionLabel = (d: DeviceRow) =>
  d.serial.includes(':')
    ? 'Wi-Fi'
    : d.serial.startsWith('emulator-')
      ? t('Emulador', 'Emulator')
      : 'USB';
// Rows are rebuilt on every state broadcast; remembering the previous tones keeps
// the arrival and "now live" animations to the moment they actually happen.
let previousTones: Map<string, string> | undefined;

function buildPanel(): void {
  root.innerHTML = html`
    <section id="panel">
      <header class="app-titlebar">
        <div class="title-drag">
          ${logoMark()}
          <h1>MirrorPanel</h1>
        </div>
        ${windowButtons()}
      </header>
      <main class="panel-scroll">
        <div class="panel-content">
          <section class="devices" aria-labelledby="devices-title">
            <header class="section-head">
              <h2 id="devices-title"></h2>
              <span class="count" id="count"></span>
              ${iconButton('refresh', '', 'refresh')}
            </header>
            <div id="device-list" class="device-list"></div>
            <p class="hint" id="usb-help"></p>
          </section>
          <section class="wireless">
            <span class="wireless-art">${icon('wifi')}</span>
            <div class="wireless-text">
              <h2 id="network-title"></h2>
              <p id="network-help"></p>
            </div>
            <button id="wifi" class="secondary-button"></button>
          </section>
          <section class="preferences" aria-labelledby="preferences-title">
            <h2 id="preferences-title"></h2>
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
          </section>
          <details class="activity" id="activity">
            <summary>
              ${icon('chevron')}<span id="activity-title"></span>
              <span class="activity-summary" id="activity-summary"></span>
            </summary>
            <div class="activity-tools">
              <button id="filter" class="text-button"></button>
              <button id="copy" class="text-button"></button>
              <button id="clear" class="text-button"></button>
            </div>
            <div id="logs" class="logs" role="log" aria-live="polite"></div>
          </details>
        </div>
      </main>
      <footer class="statusbar">
        <span class="statusbar-state" id="footer-status"></span>
        <button id="help" class="text-button">${icon('help')}<span id="help-label"></span></button>
        <span class="version">2.0</span>
      </footer>
    </section>
  `;
  bindWindowButtons();
  $('media').onclick = () => act(api.openMedia());
  $('refresh').onclick = () => act(api.refresh());
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
        <h2>${t('Conectar pela rede', 'Connect over the network')}</h2>
        <p class="dialog-lead">
          ${t('Use o endereço mostrado em Depuração sem fio, no Android. No primeiro pareamento, informe também o código.', 'Use the address shown in Wireless debugging on Android. To pair for the first time, also enter the code.')}
        </p>
        <label>
          ${t('Endereço (IP:porta)', 'Address (IP:port)')}
          <input required name="address" placeholder="192.168.1.10:5555">
        </label>
        <label>
          ${t('Código de pareamento (opcional)', 'Pairing code (optional)')}
          <input name="code" inputmode="numeric" maxlength="6">
        </label>
      `,
      (data) =>
        String(data.get('code')).trim()
          ? api.pair(data.get('address'), data.get('code'))
          : api.wifi(data.get('address')),
      t('Conectar', 'Connect'),
    );
  api.onDeviceSettings((serial: unknown) => {
    const d = state.devices.find((d) => d.serial === serial);
    if (d) showDeviceSettings(d);
  });
}

function renderDevices(): void {
  const list = $('device-list'),
    focused = list.querySelector<HTMLButtonElement>('button:focus');
  const focusSerial = focused?.closest<HTMLElement>('[data-serial]')?.dataset.serial,
    focusAction = focused?.dataset.action;
  const tones = new Map<string, string>();
  list.innerHTML = state.devices.length
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
            busy = tone === 'busy',
            authorized = d.state === 'device';
          return html`
            <article class="device is-${tone} ${motion}" data-index="${index}"
              data-serial="${escape(d.serial)}">
              <span class="device-art">${icon('phone')}<span class="device-dot"></span></span>
              <div class="device-text">
                <strong title="${escape(d.name)}">${escape(d.name)}</strong>
                <span class="device-meta">
                  <span class="chip">${connectionLabel(d)}</span>
                  <span class="device-state">${escape(text)}</span>
                  ${state.settings.showSerial ? `<span class="device-serial">${escape(d.serial)}</span>` : ''}
                </span>
              </div>
              <div class="device-actions">
                <button class="icon-button" data-action="settings"
                  title="${t('Configurações do aparelho', 'Device settings')}"
                  aria-label="${t('Configurações do aparelho', 'Device settings')}"
                  ${!authorized ? 'disabled' : ''}>
                  ${icon('sliders')}
                </button>
                <button class="icon-button" data-action="usbWifi"
                  title="${t('Usar pela rede Wi-Fi', 'Use over Wi-Fi')}"
                  aria-label="${t('Usar pela rede Wi-Fi', 'Use over Wi-Fi')}"
                  ${!authorized || d.serial.includes(':') ? 'disabled' : ''}>
                  ${icon('wifi')}
                </button>
                <button class="mirror-button ${live ? 'is-live' : ''}" data-action="start"
                  ${!authorized || busy ? 'disabled' : ''}>
                  ${busy ? '<span class="spinner"></span>' : icon(live ? 'show' : 'play')}
                  <span>${live ? t('Mostrar', 'Show') : busy ? t('Abrindo', 'Opening') : t('Espelhar', 'Mirror')}</span>
                </button>
              </div>
            </article>
          `;
        })
        .join('')
    : html`
        <div class="empty">
          <span class="empty-art">${icon('phone')}</span>
          <h3>${t('Conecte um Android', 'Connect an Android')}</h3>
          <p>
            ${t('Use um cabo USB e autorize este computador quando o celular pedir.', 'Use a USB cable and authorize this computer when the phone asks.')}
          </p>
        </div>
      `;
  previousTones = tones;
  list.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((button) => {
    const row = button.closest<HTMLElement>('[data-index]')!,
      d = state.devices[Number(row.dataset.index)];
    button.onclick = () =>
      button.dataset.action === 'settings'
        ? showDeviceSettings(d)
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
    `<p class="log-empty">${t('Nenhum evento nesta sessão.', 'No events in this session.')}</p>`;
  const issues = state.logs.filter((l) => l.level !== 'info').length;
  const summary = $('activity-summary');
  summary.textContent = issues
    ? issues === 1
      ? t('1 aviso', '1 warning')
      : `${issues} ${t('avisos', 'warnings')}`
    : t('Tudo certo', 'All clear');
  summary.classList.toggle('has-issues', issues > 0);
}

function renderPanel(next: unknown): void {
  state = next as PanelState;
  applyLanguage(state.settings.language);
  if (!$('panel')) buildPanel();
  const count = state.devices.length;
  const labels: Record<string, string> = {
    'devices-title': t('Aparelhos', 'Devices'),
    'usb-help': t(
      'Não aparece? Ative a depuração USB nas opções do desenvolvedor e autorize este computador no celular.',
      'Not listed? Turn on USB debugging in developer options and authorize this computer on the phone.',
    ),
    'network-title': t('Sem cabo', 'Wireless'),
    'network-help': t(
      'Conecte pela rede Wi-Fi quando o celular e o computador estiverem na mesma rede.',
      'Connect over Wi-Fi when the phone and the computer share the same network.',
    ),
    wifi: t('Conectar pela rede', 'Connect over the network'),
    'preferences-title': t('Preferências', 'Preferences'),
    'theme-label': t('Tema', 'Theme'),
    'theme-system': t('Automático', 'Automatic'),
    'theme-light': t('Claro', 'Light'),
    'theme-dark': t('Escuro', 'Dark'),
    'language-label': t('Idioma', 'Language'),
    'awake-label': t(
      'Manter a tela do celular ligada pelo USB',
      'Keep the phone screen on over USB',
    ),
    'top-label': t('Janelas de espelho sempre no topo', 'Keep mirror windows on top'),
    'serial-label': t('Mostrar números de série', 'Show serial numbers'),
    'media-label': t('Capturas e gravações', 'Screenshots and recordings'),
    'media-open': t('Abrir pasta', 'Open folder'),
    'activity-title': t('Atividade', 'Activity'),
    filter: issuesOnly ? t('Mostrar tudo', 'Show all') : t('Só avisos', 'Warnings only'),
    copy: t('Copiar', 'Copy'),
    clear: t('Limpar', 'Clear'),
    'help-label': t('Ajuda', 'Help'),
    count: String(count),
    'footer-status':
      count === 0
        ? t('Nenhum aparelho conectado', 'No device connected')
        : count === 1
          ? t('1 aparelho conectado', '1 device connected')
          : `${count} ${t('aparelhos conectados', 'devices connected')}`,
  };
  for (const [id, text] of Object.entries(labels)) $(id).textContent = text;
  labelWindowButtons();
  label($('refresh'), t('Atualizar a lista', 'Refresh the list'));
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
  const toolbar = ['capture', 'record', 'audio', 'fullscreen', 'more']
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
        <div class="mirror-device title-drag">
          <button id="device-home">
            <span class="live-dot" aria-hidden="true"></span><span id="mirror-name"></span>
          </button>
        </div>
        <div class="mirror-actions">${toolbar}</div>
        ${windowButtons()}
      </header>
      <div id="mirror-menu" class="mirror-menu" hidden>
        <button id="device-settings">${icon('sliders')} <span id="device-settings-text"></span></button>
        <button id="paste-text">${icon('paste')} <span id="paste-text-label"></span> <kbd>Ctrl+V</kbd></button>
        <button id="screen-power">${icon('power')} <span id="screen-power-text"></span></button>
        <button id="pin-window" aria-pressed="false">${icon('pin')} <span id="pin-window-text"></span></button>
        <div class="volume-control">
          ${icon('audio')}
          <label for="volume" id="volume-label"></label>
          <input id="volume" type="range" min="0" max="100" value="100">
        </div>
        <button id="mirror-help">${icon('help')} <span id="mirror-help-text"></span></button>
      </div>
      <div id="apk-drop" class="apk-drop" hidden role="status"></div>
      <div class="viewport">
        <canvas id="video" tabindex="0"></canvas>
        <span id="touch-anchor" hidden aria-hidden="true"></span>
        <textarea id="text-input" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
        <div id="video-status" class="video-status">
          <span id="status-spinner" class="spinner" aria-hidden="true"></span>
          <span id="status-message"></span>
          <button id="reconnect" hidden></button>
        </div>
      </div>
      <nav class="android-navigation">
        ${iconButton('back', '')}${iconButton('home', '')}${iconButton('recent', '')}
      </nav>
    </section>
  `;
  const recordLabel = () =>
    recording ? t('Finalizar gravação', 'Stop recording') : t('Gravar vídeo', 'Record video');
  const audioLabel = () =>
    audioState === 'started'
      ? t('Desligar áudio', 'Turn audio off')
      : audioState === 'starting'
        ? t('Autorize no celular…', 'Allow it on your phone…')
        : t('Ativar áudio', 'Turn audio on');
  /** Every fixed text of the mirror window; runs again when the language changes. */
  const applyTexts = () => {
    const back = t('Voltar ao painel', 'Back to panel');
    $('mirror-name').textContent = deviceName;
    $('device-home').title = deviceName + ' · ' + back;
    $('device-home').setAttribute('aria-label', back);
    label($('capture'), t('Capturar tela', 'Take screenshot'));
    label($('record'), recordLabel());
    label($('audio'), audioLabel());
    label($('fullscreen'), t('Tela cheia (F11)', 'Fullscreen (F11)'));
    label($('more'), t('Mais controles', 'More controls'));
    $('device-settings-text').textContent = t('Configurações do aparelho', 'Device settings');
    $('paste-text-label').textContent = t('Colar no aparelho', 'Paste on device');
    $('screen-power-text').textContent = t('Ligar / desligar tela', 'Screen on / off');
    $('pin-window-text').textContent = t('Sempre no topo', 'Always on top');
    $('volume-label').textContent = t('Volume no PC', 'PC volume');
    $('volume').setAttribute('aria-label', t('Volume no computador', 'Computer volume'));
    $('mirror-help-text').textContent = t('Mouse e atalhos', 'Mouse and shortcuts');
    $('apk-drop').textContent = t(
      'Solte para enviar os arquivos ao Android (pasta Download). Um APK sozinho é instalado.',
      'Drop to send the files to Android (Download folder). A single APK is installed.',
    );
    $('video').setAttribute(
      'aria-label',
      t(
        'Tela do aparelho: controle com mouse e teclado',
        'Device screen: control it with mouse and keyboard',
      ),
    );
    $('text-input').setAttribute(
      'aria-label',
      t('Digite para enviar texto ao aparelho', 'Type to send text to the device'),
    );
    $('reconnect').textContent = t('Reconectar', 'Reconnect');
    document
      .querySelector('.android-navigation')!
      .setAttribute('aria-label', t('Navegação Android', 'Android navigation'));
    label($('back'), t('Voltar (Esc)', 'Back (Esc)'));
    label($('home'), t('Início', 'Home'));
    label($('recent'), t('Apps recentes', 'Recent apps'));
    labelWindowButtons();
  };
  applyTexts();
  $('status-message').textContent = t('Conectando ao aparelho…', 'Connecting to the device…');
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
        t('Aguarde a transferência atual terminar.', 'Wait for the current transfer to finish.'),
      );
      return;
    }
    transferring = true;
    // A single APK is installed; anything else is copied to the phone's Download folder.
    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.apk')) {
      document.body.dataset.apkInstall = 'installing';
      toast(t('Instalando ', 'Installing ') + files[0].name + '…');
      clearTimeout(toastTimer);
      void Promise.resolve()
        .then(() => api.installDroppedApk(files[0]))
        .then((name) => {
          document.body.dataset.apkInstall = 'success';
          toast(t('Instalado: ', 'Installed: ') + String(name));
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
        ? t('Enviando ', 'Sending ') + files[0].name + '…'
        : t(`Enviando ${files.length} arquivos…`, `Sending ${files.length} files…`),
    );
    clearTimeout(toastTimer);
    void Promise.resolve()
      .then(() => api.sendDroppedFiles(files))
      .then((names) => {
        document.body.dataset.fileTransfer = 'success';
        const saved = names as string[];
        toast(
          saved.length === 1
            ? t('Salvo em Download: ', 'Saved to Download: ') + saved[0]
            : t(
                `${saved.length} arquivos salvos em Download`,
                `${saved.length} files saved to Download`,
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
  $('device-home').onclick = () => act(api.windowAction('panel'));
  $('device-settings').onclick = () => {
    closeMenu();
    act(api.windowAction('settings'));
  };
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
  /**
   * With the picture already on screen a passing status is a small note over it;
   * before the first frame, or when the user has to act, it covers the video.
   */
  /** The one orchestrated moment: a sweep of light across the first frame of a session. */
  const reveal = () => {
    const viewport = document.querySelector<HTMLElement>('.viewport')!;
    viewport.classList.add('is-revealing');
    viewport.addEventListener('animationend', () => viewport.classList.remove('is-revealing'), {
      once: true,
    });
  };
  const showStatus = (message: string, retry = false) => {
    $('status-message').textContent = message;
    status.hidden = !message;
    if (message) document.body.classList.remove('is-live');
    status.classList.toggle('is-notice', Boolean(message) && frames > 0 && !retry);
    $('status-spinner').hidden = retry;
    $('reconnect').hidden = !retry;
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
  const audio = new AudioPlayer((message) => toast(t('Áudio: ', 'Audio: ') + message));
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
    if (audioState === 'off' || audioState === 'error') audio.reset();
    if (audioState === 'error' || audioState === 'starting') toast(status.message);
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
          showStatus(t('Recuperando a imagem…', 'Restoring the picture…'));
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
  $('fullscreen').onclick = () => act(fullscreen());
  $('back').onclick = () => act(control({ type: 'key', code: 4 }));
  $('home').onclick = () => act(control({ type: 'key', code: 3 }));
  $('recent').onclick = () => act(control({ type: 'key', code: 187 }));
  $('record').onclick = () =>
    act(
      api.record().then((path) => {
        recordingState(path);
      }),
    );
  const screenshot = () => {
    if (!frames) {
      toast(t('Aguarde o primeiro quadro', 'Wait for the first frame'));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob)
        act(
          blob
            .arrayBuffer()
            .then((buffer) => api.savePng(new Uint8Array(buffer)))
            .then(() => toast(t('Captura salva', 'Screenshot saved'))),
        );
    }, 'image/png');
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
