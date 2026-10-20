---
title: "Phases 1-3: Prettier rollout, html tag, six fixes validated on Moto G30"
author: Syhhw
date: 2026-10-20
branch: mirrorpanel-2.0-qualidade
cost: { minutes: 30, tokens: 286685 }
touches:
  - native/src/adb.ts
  - native/src/apk-install.ts
  - native/src/i18n.ts
  - native/src/index.html
  - native/src/main.ts
  - native/src/preload.ts
  - native/src/protocol.ts
  - native/src/renderer.ts
  - native/src/session.ts
  - native/tests/i18n.test.ts
---

## Decided
- Formatting is Prettier 3.9.9 + prettier-plugin-java with embeddedLanguageFormatting off; .git-blame-ignore-revs lists the pure formatting commit 23f1635. Prove formatting commits by fingerprinting esbuild-minified JS/CSS and javac -g:none bytecode before/after.
- Long renderer templates use html`` (src/html.ts): a newline next to a tag bracket or at the template edges vanishes, anywhere else it becomes one space. Never break inside a tag right before an interpolation without that rule; a TypeScript-AST comparison of static parts and printed expressions proved the reflow identical.
- Interface language lives in src/i18n.ts per process; main.ts calls setLanguage from settings, mirror windows get ?lang= and a 'language' IPC; Companion texts are replaced by desktop texts in session.ts.
- Companion sessions start only through ConnectActivity and audio consent through AudioConsentActivity, both protected by android.permission.INJECT_EVENTS (signature, held by the ADB shell). MainActivity no longer reads port/token. SessionService calls startForeground before any stopSelf.

## Tried and ruled out
- Feeding a garbage keyframe does not make the Windows hardware H.264 decoder raise an error (configures stayed 0). To exercise the closed-decoder path on a device, close the decoder from a patched decode(); the fixed code then recreated it once and video resumed (16 -> 200 frames).
- Ending an Electron verification script with app.exit skips the app cleanup and leaves forward, temp JAR and stay_on_while_plugged_in changed; close mirror windows and app.quit instead. A SyntaxError in such a script leaves an Electron error dialog that hangs the run.

## Watch out
- The development keystore that signed the old Companion was gone; a new one was generated in native/build/android (git-ignored). Back it up: losing it again forces uninstalling the Companion on every phone.
- Vysor runs its own app_process (com.koushikdutta.vysor.ProtocolCheckMain) on the same phone. Check /proc/<pid>/cmdline before killing any app_process during cleanup.
- Smoke scripts match the Portuguese log prefix 'Espelhando '; they rely on the default language being pt.
