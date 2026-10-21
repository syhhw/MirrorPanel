# MirrorPanel app

Electron + TypeScript + WebCodecs, with its own Android engine. The package runs
without Python or third-party programs. It includes the official ADB for USB/Wi-Fi transport.

## Usage

Install with `MirrorPanel-Setup-<version>.exe` from the GitHub releases, or run
`dist/MirrorPanel-win32-x64/MirrorPanel.exe` after `npm run package`. Keep the
files of that folder together.

1. Android **10 or later**, USB debugging enabled and the computer authorized.
2. Click the phone drawn in the panel. The app installs its Companion and shows
   an indicator on the phone.
3. Click a text field to type or paste. Accents, languages, composition
   and emoji sequences are sent through the MirrorPanel IME, without normalization.
4. **Alt+click** pins one finger. Drag with the mouse to use the second; another
   Alt+click releases the anchor. Esc cancels contacts. A touch screen on the PC can
   send up to ten simultaneous contacts.
5. Click the **headphones** and authorize the capture on Android to hear media audio.
   The volume control affects the computer. Start audio before recording to
   include the AAC track in the MP4.

Right click/Esc: Back; middle click/Home: Home; End: recents;
F11: fullscreen; Ctrl+V: paste. The bar offers PNG and MP4 recording.
Closing the mirror window ends the session.
The Android app shows guidance and the connection status; closing that screen
or dismissing the notification does not end mirroring.
Use the gear for quality, device name and additional controls.
The window has a single top bar, video fitted to the device's
aspect ratio and bottom navigation. Heartbeats keep the connection alive on static screens;
a real lack of response is still detected by the watchdog.
Dragging the borders is free; after 500 ms without movement, the window
fits the video by its larger dimension, keeping the aspect ratio. Reduce the height in
portrait to shrink the mirror; narrowing only from the side makes the width return.
Maximize and fullscreen center the video. The navigation buttons animate
when pressed with the mouse or keyboard.
Drag local files onto the mirror window: a single APK is installed
on that device; other files (up to 20 at a time, 4 GB each) go to the phone's
Download folder without overwriting existing names. Network folders are refused.
The window controls keep working even without a session. Losing the
Companion is recoverable; after repeated failures, Try again reconnects
in the same window. Reconnecting does not restore a window you minimized.
Renderer crashes try to recover the image in the same window and transport,
cancelling pending contacts. After three recoveries, the window offers Try again
and keeps Close/Minimize. Audio has to be turned on again after such a crash.
The local diagnostics log is at `%APPDATA%/MirrorPanel/diagnostics/lifecycle.jsonl`;
it records the close origin, state and counters, without typed text or clipboard contents.
The previous keyboard is restored when the session ends. If Android restarts during a
session, select your usual keyboard in Settings → Languages & input.

## Features

- Independent windows per device; names, quality and preferences are persisted.
- H.264 MediaCodec → WebCodecs; playback audio → AAC 48 kHz stereo → AudioDecoder.
- Multi-touch with stable identity, drag, scroll, keys and Unicode up to 64 KiB per send.
- MP4 with the original video and audio, no re-encoding; PNG screenshots.
- Bounded reconnection, input cancellation, recovery after video loss.
- USB, Wi-Fi connection by IP, pairing by code, enabling TCP/IP over USB.
- APK install from a file picker or by dragging onto the window, and local logs.
- File transfer by drag and drop to Download, with safe names and no overwriting.

Files are saved in `Videos/MirrorPanel Media`. The app only removes its own
processes, forwards and temporary JARs; it does not stop the shared ADB server.
The Companion is visible and can be uninstalled normally.

## Compatibility and limits

The Android 10–13 path uses SurfaceControl; Android 14+ uses DisplayManager.
The API 29 minimum is an implementation decision, not a certification of every ROM.

Audio depends on the Android app's policy: apps can block capture;
calls, protected content and the microphone are not captured. The system
permission is requested for each new capture when Android requires it.
Unicode is preserved; the available glyphs depend on the app and the phone's fonts.

Rotation, an audio change or ending the session finishes the current recording. Start
another file after the change. There is no H.265, two-way clipboard, QR,
tray or automatic update in this preview. Wi-Fi has not yet been validated
on a physical network in this round.

## Build and verify

Windows x64, Node >=22.12, Python 3, JDK 17, SDK `platforms;android-35` and
`build-tools;36.0.0`. Set `JAVA_HOME` and `ANDROID_HOME` if needed.
These requirements are for development; people who install the app do not need them.

```powershell
npm ci
node node_modules/electron/install.js
npm run android
npm run typecheck
npm run lint
npm test
npm run test:android
npm run package
npm run installer
```

`npm run package` writes the portable folder to `dist/`. `npm run installer`
packages into `build/installer`, audits the package and compiles
`installer/MirrorPanel.iss` with Inno Setup 6 into
`dist/MirrorPanel-Setup-<version>.exe`. It finds ISCC.exe in the usual install
folders or in the `ISCC` environment variable.

The build uses a local development key in `build/android`. It is not
included in the package. For reproducible Companion updates, use the same
stable key through `MIRRORPANEL_KEYSTORE`, `MIRRORPANEL_STORE_PASSWORD` and
`MIRRORPANEL_KEY_ALIAS`. An app with a different signature is not removed automatically.

Real tests require authorized, unlocked test devices:

```powershell
python scripts/build-fixture.py
adb -s SERIAL install -r build/android/fixture.apk
node_modules/.bin/tsx scripts/smoke-features.ts SERIAL
node_modules/electron/dist/electron.exe smoke-features.cjs SERIAL
node_modules/electron/dist/electron.exe scripts/verify-media.cjs MP4_PATH
node_modules/electron/dist/electron.exe smoke-preview5.cjs SERIAL
node_modules/electron/dist/electron.exe smoke-visual.cjs SERIAL
node_modules/electron/dist/electron.exe smoke-window-lifecycle.cjs SERIAL
node_modules/.bin/tsx scripts/smoke-stability.ts SERIAL 90 final
node_modules/.bin/tsx scripts/smoke-lifecycle.ts SERIAL_ROTATION SERIAL_STOP
```

The fixture produces text, events and a 440 Hz tone; its data is private to the app.
`smoke-preview5.cjs` installs the fixture through a Chromium drop event, triggers
renderer crashes and checks recovery, ripple, resize and controls.
`smoke-window-lifecycle.cjs`
tests Companion loss and geometry through Electron.setBounds; this does not replace
dragging the borders with a mouse.
The lifecycle test temporarily changes the rotation on the first device and stops
the Companion on the second. The fixture, evidence and keys are not included in the package.

## Engineering

`docs/PROTOCOL.md` describes the MPV1 protocol. MirrorPanel uses its own code and interface.

The TCP test needs local access to 127.0.0.1.

Original code is Apache-2.0; Electron and mp4-muxer are MIT. Chromium notices ship with
Electron and the ADB notices are in `resources/adb`. Chromium includes `ffmpeg.dll`
internally; the app does not invoke an external FFmpeg program.
