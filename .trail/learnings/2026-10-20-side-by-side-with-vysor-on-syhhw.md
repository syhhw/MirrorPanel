---
title: "Side-by-side with Vysor on Moto G30: startup cost, subtle status, file drop"
author: Syhhw
date: 2026-10-20
branch: mirrorpanel-2.0-qualidade
cost: { minutes: 15, tokens: 173213 }
touches:
  - README.md
  - native/README.md
  - native/src/apk-install.ts
  - native/src/file-transfer.ts
  - native/src/main.ts
  - native/src/preload.ts
  - native/src/renderer.ts
  - native/tests/file-transfer.test.ts
  - native/src/style.css
  - native/src/session.ts
---

## Decided
- Session start is measured with start-step diagnostics (server-pushed, server-ready, companion-started, video-ready, ime-ready). On the Moto G30 first frame went from 6.5 s to 5.2 s by checking the Companion APK SHA-256 (pm path + sha256sum) in parallel with the server boot instead of reinstalling it every session.
- About 3.55 s of server-ready is ART starting app_process ("ART APEX data files are untrusted" until "Calling main entry"); our Main to READY is ~0.3 s. Vysor also uses app_process, so this is a platform cost; it is surfaced as progress text instead.
- Status over a live picture is a small top pill (.video-status.is-notice); the full cover with spinner is only before the first frame or when Reconnect is needed. Toasts are compact, 3.5 s (errors 6 s).
- Dropping files in a mirror window: a single APK installs; anything else goes to /sdcard/Download via argv-only adb push with cleaned, non-overwriting names. isLocalPath rejects UNC paths for both flows.

## Tried and ruled out
- ADB server conflict as the cause of Vysor/MirrorPanel interference: both adb binaries speak protocol 1.0.41 and the running server was not restarted. No codec reclaim or Vysor error appeared in logcat either.
- Screen captures of the desktop miss windows covered by other apps; PrintWindow (flag 2) captures a window's own content without moving it.

## Watch out
- During these tests Vysor's window stopped updating (its image froze ten minutes behind the phone clock) and the Vysor Android app showed a "Desconectado" internet dialog. The cause was not determined; do not attribute it to MirrorPanel without evidence.
- Do not test an APK drop with the Companion APK during a session: install -r restarts the Companion and ends the mirror.
- Alternating HOME presses on the launcher does not change the screen; use Recents/Home alternation to keep the encoder producing frames in measurements.
