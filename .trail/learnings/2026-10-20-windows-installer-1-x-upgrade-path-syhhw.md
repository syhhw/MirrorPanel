---
title: "Windows installer, 1.x upgrade path and the first 2.0 pre-release"
author: Syhhw
date: 2026-10-20
branch: new
cost: { minutes: 19, tokens: 138163 }
touches:
  - native/installer/MirrorPanel.iss
  - native/scripts/installer.mjs
  - native/src/main.ts
---

## Decided
- The installer is Inno Setup 6 (native/installer/MirrorPanel.iss), built by `npm run installer`, which packages into build/installer (never dist/, where a running portable copy may live), runs audit-package.mjs and compiles to dist/MirrorPanel-Setup-<version>.exe.
- It reuses the 1.x AppId so it replaces 1.x in place. The 1.x script wrote `AppId={{7C1B2F1A-9B3E-4E5A-9B0E-4C6D6A1B7E10}}` and Inno keeps the closing "}}" in the value: the uninstall key is `{7C1B...}}_is1`. The doubled brace must stay or the 2.0 installer lands beside 1.x instead of over it.
- [InstallDelete] removes {app}\_internal (1.x Python runtime), installer_language.marker, the previous {app}\resources and \locales, and the 1.x Start menu folder; settings.json and logs from 1.x stay. No skipifsilent on [Run], so a silent update reopens the app.
- The packaged app imports 1.x preferences from settings.json next to MirrorPanel.exe (dirname(process.execPath)); dev runs read the repository root copy.
- 2.0 builds go out as GitHub pre-releases: the 1.3.1 updater reads /releases/latest, takes the first .exe asset and runs it with /SILENT /CURRENTUSER /CLOSEAPPLICATIONS. Publishing a 2.0 build as latest pushes it to every 1.x user.
- v2.0.0-preview.5 was published as a pre-release on 2026-10-20 with the Companion signed by native/build/android/development.keystore. Later releases must keep that key, or installed Companions refuse the update.

## Tried and ruled out
- Testing the real installer on the dev machine: 1.x 1.3.1 is installed there for this user. Tests compile with `/DAppId=MirrorPanelInstallerTest /DAppName="MirrorPanel Installer Test" /DNoLaunch /F<name>` and install into a temp folder laid out like 1.x, then uninstall.

## Watch out
- Run ISCC from PowerShell or Node, not Git Bash: MSYS rewrites arguments that start with "/" (`/DNoLaunch` becomes a path) and ISCC reports "more than one script filename".
- PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM and JSON.parse rejects it; 1.x (Python) wrote settings.json without one. Use [IO.File]::WriteAllText for test fixtures.
- Electron honors `--user-data-dir`, so a packaged build can be checked next to a running MirrorPanel without hitting its single-instance lock; `--remote-debugging-port` plus Runtime.evaluate reads the panel text.
