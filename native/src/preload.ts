import { contextBridge, ipcRenderer, webUtils } from 'electron';
const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);
const on = (channel: string, callback: (value: unknown) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('mirrorpanel', {
  // Files that only exist in memory have no path; the main process rejects them in
  // the interface language.
  installDroppedApk: (file: File) =>
    ipcRenderer.invoke('install-dropped-apk', webUtils.getPathForFile(file)),
  sendDroppedFiles: (files: File[]) =>
    ipcRenderer.invoke(
      'send-files',
      files.map((file) => webUtils.getPathForFile(file)),
    ),
  onLanguage: (cb: (v: unknown) => void) => on('language', cb),
  onWindowLayout: (cb: (v: unknown) => void) => on('window-layout', cb),
  windowAction: invoke('window-action'),
  onDeviceName: (cb: (v: unknown) => void) => on('device-name', cb),
  audio: invoke('audio'),
  snapshot: invoke('snapshot'),
  refresh: invoke('refresh'),
  start: invoke('start'),
  stop: invoke('stop'),
  quality: invoke('quality'),
  rename: invoke('rename'),
  preferences: invoke('preferences'),
  control: invoke('control'),
  record: invoke('record'),
  screenshot: invoke('screenshot'),
  savePng: invoke('save-png'),
  copyPng: invoke('copy-png'),
  paste: invoke('paste'),
  openMedia: invoke('open-media'),
  copyLogs: invoke('copy-logs'),
  clearLogs: invoke('clear-logs'),
  wifi: invoke('wifi'),
  pair: invoke('pair'),
  usbWifi: invoke('usb-wifi'),
  installApk: invoke('install-apk'),
  mirrorSettings: invoke('mirror-settings'),
  showMirrorSettings: invoke('show-mirror-settings'),
  onOpenSettings: (cb: () => void) => on('open-device-settings', cb),
  saveMirrorSettings: invoke('mirror-settings-save'),
  mirrorUsbWifi: invoke('mirror-usb-wifi'),
  mirrorInstallApk: invoke('mirror-install-apk'),
  ack: (id: number) => ipcRenderer.send('frame-ack', id),
  onState: (cb: (v: unknown) => void) => on('state', cb),
  onInfo: (cb: (v: unknown) => void) => on('video-info', cb),
  onConfig: (cb: (v: unknown) => void) => on('video-config', cb),
  onFrame: (cb: (v: unknown) => void) => on('video-frame', cb),
  onStatus: (cb: (v: unknown) => void) => on('session-status', cb),
  onScreenshot: (cb: () => void) => on('take-screenshot', cb),
  onAudioState: (cb: (v: unknown) => void) => on('audio-state', cb),
  onAudioConfig: (cb: (v: unknown) => void) => on('audio-config', cb),
  onAudioFrame: (cb: (v: unknown) => void) => on('audio-frame', cb),
  onRecording: (cb: (v: unknown) => void) => on('recording-state', cb),
});
