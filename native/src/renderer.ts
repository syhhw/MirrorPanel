import { AudioPlayer } from './audio-player';
import { Gestures } from './gestures';
import { bindRipple } from './ripple';
import { html } from './html';
import { admitFrame } from './video-gate';
import { setLanguage, t, type Language } from './i18n';

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
function toast(value: unknown): void {
  const el = $('toast');
  el.textContent = String(value).replace(
    /^Error: Error invoking remote method '[^']+': Error: /,
    '',
  );
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 6000);
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
function ask(
  content: string,
  submit: (data: FormData) => Promise<unknown>,
  confirm = t('Salvar', 'Save'),
): void {
  $('dialog-content').innerHTML = content;
  $('confirm').textContent = confirm;
  $('cancel').textContent = t('Cancelar', 'Cancel');
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
const icons: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  home: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  recent: 'M5 6h14M5 12h14M5 18h14',
  capture: 'M8 5l2-2h4l2 2h4v15H4V5z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  record: 'M15 8l6-3v14l-6-3z M3 6h12v12H3z',
  audio: 'M4 14v-3a8 8 0 0 1 16 0v3 M4 12h3v8H4z M17 12h3v8h-3z',
  fullscreen: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5',
  settings: 'M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  wifi: 'M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0M12 20h.01',
  play: 'M8 4l12 8-12 8z',
  stop: 'M6 6h12v12H6z',
  refresh: 'M20 10a8 8 0 1 0-2 8M20 3v7h-7',
  phone: 'M7 2h10v20H7zM10 18h4',
  folder: 'M3 6h7l2 3h9v11H3z',
  help: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4M12 18h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  pin: 'M8 3h8l-1 6 4 4v2H5v-2l4-4zM12 15v7',
  power: 'M12 2v10M6 5a9 9 0 1 0 12 0',
  paste: 'M8 5H5v17h14V5h-3M8 2h8v5H8z',
  minimize: 'M4 12h16',
  maximize: 'M5 5h14v14H5z',
  close: 'M5 5l14 14M19 5L5 19',
  chevron: 'M9 5l7 7-7 7',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[name] ?? icons.phone}"/></svg>`;
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
  ask(
    html`
      <h2>${t('Controlar seu Android', 'Control your Android')}</h2>
      <div class="settings-section">
        <h3>${t('Mouse e teclado', 'Mouse and keyboard')}</h3>
        <p>
          Alt + clique ${t('fixa um dedo. Arraste o segundo ponto para multitoque.', 'anchors one finger. Drag the second point for multitouch.')}<br>
          Esc · ${t('Voltar ou soltar os contatos', 'Back or release contacts')}<br>
          Ctrl + V · ${t('Colar texto', 'Paste text')}<br>
          F11 · ${t('Tela cheia', 'Fullscreen')}
        </p>
      </div>
      <div class="settings-section">
        <h3>${t('Conexão USB', 'USB connection')}</h3>
        <p>
          ${t('Ative a depuração USB nas Opções do desenvolvedor e autorize este computador no aparelho. Para áudio, aceite a autorização de captura no Android.', 'Enable USB debugging in Developer options and authorize this computer on your device. For audio, accept Android capture permission.')}
        </p>
      </div>
    `,
    async () => {},
    'OK',
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
function renderPanel(next: unknown): void {
  state = next as PanelState;
  applyLanguage(state.settings.language);
  if (!$('panel')) {
    root.innerHTML = html`
      <section id="panel">
        <header class="app-titlebar">
          <div class="title-drag">
            <span class="brand-mark">${icon('phone')}</span>
            <h1>MirrorPanel</h1>
            <span class="version">2.0</span>
          </div>
          ${windowButtons()}
        </header>
        <div class="panel-scroll">
          <div class="connection-grid">
            <section class="android-card">
              <header class="card-heading">
                <h2 id="devices-title"></h2>
                ${iconButton('refresh', 'Atualizar aparelhos', 'refresh')}
              </header>
              <div id="device-list" class="device-list"></div>
              <div class="connection-help">
                <strong id="usb-title"></strong>
                <p id="usb-help"></p>
                <span class="connection-count" id="count"></span>
              </div>
            </section>
            <section class="network-card">
              <div class="network-symbol">${icon('wifi')}</div>
              <h2 id="network-title"></h2>
              <p id="network-help"></p>
              <button id="wifi" class="surface-button"></button>
              <p class="network-note" id="network-note"></p>
            </section>
          </div>
          <section class="surface-card preferences-card">
            <header>
              <h2 id="preferences-title"></h2>
              <span class="section-caption" id="preferences-caption"></span>
            </header>
            <div class="switch-grid">
              <label class="switch-row">
                <input id="show-serial" type="checkbox" data-setting="showSerial">
                <span class="switch-track"></span>
                <span id="serial-label"></span>
              </label>
              <label class="switch-row">
                <input id="always-top" type="checkbox" data-setting="alwaysOnTop">
                <span class="switch-track"></span>
                <span id="top-label"></span>
              </label>
              <label class="switch-row">
                <input id="stay-awake" type="checkbox" data-setting="stayAwake">
                <span class="switch-track"></span>
                <span id="awake-label"></span>
              </label>
            </div>
            <div class="preferences-bottom">
              <label>
                <span id="language-label"></span> <select id="language">
                  <option value="pt">Português</option>
                  <option value="en">English</option>
                </select>
              </label>
              <button id="media" class="text-button"></button>
            </div>
          </section>
          <section class="surface-card about-card">
            <h2>MirrorPanel <span class="version">2.0 preview 5</span></h2>
            <p id="about-copy"></p>
            <button class="text-button" id="help"></button>
          </section>
          <details class="surface-card activity" id="activity">
            <summary>
              <span id="activity-title"></span>
              <span id="activity-summary"></span>
            </summary>
            <div class="activity-tools">
              <button id="filter" class="text-button"></button>
              <button id="copy" class="text-button"></button>
              <button id="clear" class="text-button"></button>
            </div>
            <div id="logs" class="logs" role="log" aria-live="polite"></div>
          </details>
        </div>
        <footer class="panel-footer">
          <button id="footer-home">${icon('home')}<span>MirrorPanel</span></button>
          <button id="footer-help"></button>
          <button id="footer-activity"></button>
          <span id="footer-status"></span>
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
    $('footer-help').onclick = showHelp;
    $('footer-home').onclick = () =>
      document.querySelector('.panel-scroll')!.scrollTo({ top: 0, behavior: 'smooth' });
    $('footer-activity').onclick = () => {
      ($('activity') as HTMLDetailsElement).open = true;
      $('activity').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    document
      .querySelectorAll<HTMLInputElement>('[data-setting]')
      .forEach(
        (input) =>
          (input.onchange = () =>
            act(api.preferences({ ...state.settings, [input.dataset.setting!]: input.checked }))),
      );
    $<HTMLSelectElement>('language').onchange = () =>
      act(api.preferences({ ...state.settings, language: $<HTMLSelectElement>('language').value }));
    $('wifi').onclick = () =>
      ask(
        html`
          <h2>${t('Conectar pela rede', 'Connect over network')}</h2>
          <div class="settings-section">
            <p>
              ${t('Use o endereço de conexão mostrado em Depuração sem fio no Android. Para o primeiro pareamento, informe o endereço de pareamento e o código.', 'Use the connection address shown in Android Wireless debugging. To pair for the first time, enter the pairing address and code.')}
            </p>
            <label>
              IP:${t('porta', 'port')}
              <input required name="address" placeholder="192.168.1.10:5555">
            </label>
            <label>
              ${t('Código de pareamento (opcional)', 'Pairing code (optional)')}
              <input name="code" inputmode="numeric" maxlength="6">
            </label>
          </div>
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
  const labels: Record<string, string> = {
    'devices-title': t('Aparelhos Android', 'Android devices'),
    'network-title': t('Conectar sem cabo', 'Connect wirelessly'),
    'network-help': t(
      'Seu Android também pode ficar ao alcance do mouse pela rede Wi-Fi.',
      'Your Android can also be within mouse reach over Wi-Fi.',
    ),
    wifi: t('Conectar pela rede', 'Connect over network'),
    'network-note': t(
      'Mantenha o computador e o aparelho na mesma rede.',
      'Keep your computer and device on the same network.',
    ),
    'usb-title': t('Não encontrou seu aparelho?', 'Can’t find your device?'),
    'usb-help': t(
      'Conecte por USB, ative a depuração USB e autorize este computador no celular.',
      'Connect over USB, enable USB debugging and authorize this computer on your phone.',
    ),
    'preferences-title': t('Configurações', 'Settings'),
    'preferences-caption': t('Do seu jeito', 'Make it yours'),
    'serial-label': t('Mostrar números de série', 'Show serial numbers'),
    'top-label': t('Janelas sempre no topo', 'Always on top'),
    'awake-label': t('Manter a tela ligada por USB', 'Keep screen awake over USB'),
    'language-label': t('Idioma', 'Language'),
    media: t('Abrir capturas e gravações', 'Open screenshots and recordings'),
    'about-copy': t(
      'Controle seu Android, escreva com o teclado e capture o que acontece na tela.',
      'Control your Android, type with your keyboard and capture what happens on screen.',
    ),
    help: t('Como usar e atalhos', 'Help and keyboard shortcuts'),
    'activity-title': t('Atividade', 'Activity'),
    filter: issuesOnly ? t('Mostrar tudo', 'Show all') : t('Só avisos', 'Warnings only'),
    copy: t('Copiar', 'Copy'),
    clear: t('Limpar', 'Clear'),
    'footer-help': t('Ajuda', 'Help'),
    'footer-activity': t('Diagnóstico', 'Diagnostics'),
    'footer-status': t('Android · USB e Wi-Fi', 'Android · USB and Wi-Fi'),
  };
  for (const [id, text] of Object.entries(labels)) $(id).textContent = text;
  labelWindowButtons();
  label($('refresh'), t('Atualizar aparelhos', 'Refresh devices'));
  $('count').textContent =
    state.devices.length + ' ' + t('aparelho(s) detectado(s)', 'device(s) detected');
  $<HTMLInputElement>('show-serial').checked = state.settings.showSerial;
  $<HTMLInputElement>('always-top').checked = state.settings.alwaysOnTop;
  $<HTMLInputElement>('stay-awake').checked = state.settings.stayAwake;
  $<HTMLSelectElement>('language').value = state.settings.language;
  const list = $('device-list'),
    focused = list.querySelector<HTMLButtonElement>('button:focus');
  const focusSerial = focused?.closest<HTMLElement>('[data-serial]')?.dataset.serial,
    focusAction = focused?.dataset.action;
  list.innerHTML = state.devices.length
    ? state.devices
        .map((d, index) => {
          const active = d.session === 'mirroring',
            busy = d.session === 'starting',
            authorized = d.state === 'device';
          const status = d.recording
            ? t('Gravando', 'Recording')
            : active
              ? t('Espelhando', 'Mirroring')
              : busy
                ? t('Conectando…', 'Connecting…')
                : authorized
                  ? d.serial.includes(':')
                    ? 'Wi-Fi'
                    : d.serial.startsWith('emulator-')
                      ? t('Emulador', 'Emulator')
                      : 'USB'
                  : d.state === 'unauthorized'
                    ? t('Autorize no aparelho', 'Authorize on your device')
                    : d.state;
          return html`
            <article class="device ${active ? 'device-live' : ''}" data-index="${index}"
              data-serial="${escape(d.serial)}">
              <div class="device-symbol">${icon('phone')}</div>
              <div class="device-name">
                <strong title="${escape(d.name)}">${escape(d.name)}</strong>
                <small class="status ${d.recording ? 'recording' : ''}">${escape(status)}${state.settings.showSerial ? ' · ' + escape(d.serial) : ''}</small>
              </div>
              <div class="device-actions">
                <button class="round-action" data-action="settings"
                  title="${t('Configurações', 'Settings')}"
                  aria-label="${t('Configurações', 'Settings')}"
                  ${!authorized ? 'disabled' : ''}>
                  ${icon('settings')}
                </button>
                <button class="round-action" data-action="usbWifi"
                  title="${t('Usar Wi-Fi', 'Use Wi-Fi')}"
                  aria-label="${t('Usar Wi-Fi', 'Use Wi-Fi')}"
                  ${!authorized || d.serial.includes(':') ? 'disabled' : ''}>
                  ${icon('wifi')}
                </button>
                <button class="round-action start-action" data-action="start"
                  title="${active ? t('Abrir tela', 'Open screen') : t('Espelhar', 'Mirror')}"
                  aria-label="${active ? t('Abrir tela', 'Open screen') : t('Espelhar', 'Mirror')}"
                  ${!authorized || busy ? 'disabled' : ''}>
                  ${busy ? '<span class="spinner"></span>' : icon(active ? 'fullscreen' : 'play')}
                </button>
              </div>
            </article>
          `;
        })
        .join('')
    : `<div class="empty">${icon('phone')}<h3>${t('Seu Android aparece aqui', 'Your Android will appear here')}</h3><p>${t('Conecte o aparelho para começar.', 'Connect your device to get started.')}</p></div>`;
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
  const logs = $('logs');
  logs.innerHTML =
    state.logs
      .filter((l) => !issuesOnly || l.level !== 'info')
      .map(
        (l) =>
          `<div class="log-line ${escape(l.level)}"><time>${escape(l.time)}</time><span>${escape(l.message)}</span></div>`,
      )
      .join('') ||
    `<p class="log-empty">${t('Nenhum evento nesta sessão.', 'No events in this session.')}</p>`;
  $('activity-summary').textContent = state.logs.length
    ? String(state.logs.length)
    : t('Tudo certo', 'All clear');
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
        id === 'more' ? 'settings' : id,
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
            <span id="mirror-name"></span>
          </button>
        </div>
        <div class="mirror-actions">${toolbar}</div>
        ${windowButtons()}
      </header>
      <div id="mirror-menu" class="mirror-menu" hidden>
        <button id="device-settings">${icon('settings')} <span id="device-settings-text"></span></button>
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
      'Solte o APK para instalar neste aparelho',
      'Drop the APK to install it on this device',
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
    installing = false;
  const hideDrop = () => {
    dragDepth = 0;
    drop.hidden = true;
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
    if (event.dataTransfer) event.dataTransfer.dropEffect = installing ? 'none' : 'copy';
  });
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) hideDrop();
  });
  window.addEventListener('blur', hideDrop);
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    hideDrop();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (installing) {
      toast(
        t('Aguarde a instalação atual terminar.', 'Wait for the current installation to finish.'),
      );
      return;
    }
    if (files.length !== 1 || !files[0].name.toLowerCase().endsWith('.apk')) {
      toast(t('Arraste um único arquivo APK para instalar.', 'Drop a single APK file to install.'));
      return;
    }
    installing = true;
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
      .finally(() => (installing = false));
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
        if (inputReady) status.hidden = true;
      },
      error: (error) => {
        needsKey = true;
        if (++failures >= 2) acceleration = 'no-preference';
        if (inputReady) {
          $('status-message').textContent =
            t('Falha ao decodificar: ', 'Decoding failed: ') + error.message;
          status.hidden = false;
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
    $('status-message').textContent = update.message;
    status.hidden = !update.message;
    $('reconnect').hidden = !update.retry;
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
