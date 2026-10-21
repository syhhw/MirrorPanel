---
title: "In-app updater for 2.0: GitHub releases, SHA-256 check, silent setup"
author: Syhhw
date: 2026-10-21
branch: new
cost: { minutes: 32, tokens: 1094551 }
touches:
  - native/src/updater.ts
  - native/src/main.ts
  - native/src/renderer.ts
  - native/tests/updater.test.ts
---

## Decided
- The 2.0 updater (native/src/updater.ts, wired in main.ts) reads https://api.github.com/repos/syhhw/MirrorPanel/releases, 15 s after start and every 12 h, only in packaged builds. It installs only an asset named exactly MirrorPanel-Setup-<version>.exe under the repo's releases/download URL that GitHub lists with `digest: "sha256:..."` (the API has published asset digests since 2025; the v2.0.0-preview.5 asset has one).
- Preview rule: an installed preview is offered previews and stable releases; an installed stable version only stable ones. 2.0.0-preview.N sorts before 2.0.0.
- Install flow: refuse while any mirror window is open, download to %TEMP% with progress, stop when more bytes arrive than announced, delete unless size and SHA-256 match, run the setup with /SILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER, then app.quit(); the setup's [Run] (no skipifsilent) reopens the app. Leftover MirrorPanel-Setup-*.exe in %TEMP% are removed at the next packaged start (a still-running setup is skipped).
- The Update button sits under the home hint, not in the footer: in the footer it wrapped to two lines at 480 px and overflowed at the 380 px minimum.
- v2.0.0-preview.5 has no updater; testers on it must download the next release by hand once.

## Tried and ruled out
- The codebase-memory index lagged behind edits made in the same session (renderPanel resolved to the wrong lines); trail grep/skeleton stayed current.

## Watch out
- Deleting a partially written download right after an early error left the file behind: fs.createWriteStream opens asynchronously, so rm ran before the file existed. Wait for 'close' (only when !stream.closed, or it hangs) before rm.
- End-to-end test without GitHub: MIRRORPANEL_UPDATE_URL=http://127.0.0.1:<port>/releases (other hosts are ignored) and a local server that serves a releases array plus the setup; build the served setup with the test identity (/DAppId=MirrorPanelInstallerTest /DAppName="MirrorPanel Installer Test" /DNoLaunch) so the real install is untouched, then uninstall it.
- If MirrorPanel applies to the SignPath Foundation for code signing, its terms want a privacy statement for software that contacts systems the user did not choose; the update check now talks to api.github.com.
