# MirrorPanel

Mirrors and controls Android phones on Windows, with its own engine: Electron +
WebCodecs on the computer and a Java server on the device. Runs without Python or
third-party programs; the official ADB is included. Current version: preview 5.

Download `MirrorPanel-Setup-<version>.exe` from
[Releases](https://github.com/syhhw/MirrorPanel/releases) and run it. It installs
for the current user without administrator rights and replaces MirrorPanel 1.x
if it is installed. The installer is not code-signed yet, so Windows SmartScreen
may ask for confirmation (More info, then Run anyway).
Connect an Android **10+** phone, authorize USB debugging and click the phone drawn in the panel.

Features: H.264 video, stereo audio with authorization on the phone, Unicode and
text composition, multi-touch with Alt+click, MP4 with sound, PNG, fullscreen,
per-device windows, quality, Wi-Fi, APK install and file transfer by drag and
drop to the phone's Download folder.

The headphones icon turns on audio. Alt+click pins one finger; drag to use the other.
Esc cancels contacts or goes back. The Companion shows guidance and status; mirroring is ended from the computer.

This is a preview. Audio depends on the Android app's policy. H.265, two-way
clipboard, QR, tray and automatic updates do not exist yet.
Rotation and audio changes end the current recording.

Preview 5 fits the aspect ratio after you release the border, recovers from
renderer crashes without closing the window, accepts APKs by drag and drop and animates the navigation buttons.
On the phone, closing the guidance screen does not stop the mirror.

## Development

The code is in [native](native/README.md). The 1.x Python app lives on the
`old` branch; earlier public releases and tags have not changed.

```powershell
cd native
npm ci
node node_modules/electron/install.js
npm run android
npm run typecheck
npm run lint
npm test
npm run test:android
npm start
npm run installer
```

[Architecture](docs/ENGINE.md) · [MPV1 protocol](native/docs/PROTOCOL.md) · [Build, tests and signing](native/README.md).

MirrorPanel is Apache-2.0; Electron/mp4-muxer are MIT; ADB/Chromium notices ship
with the app.
