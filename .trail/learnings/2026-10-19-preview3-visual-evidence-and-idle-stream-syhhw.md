---
title: Preview3 visual evidence and idle-stream heartbeat
author: Syhhw
date: 2026-10-19
branch: main
touches:
  - ".github/workflows/release.yml"
  - ".github/workflows/tests.yml"
  - LICENSE
  - README.md
  - docs/interface-design.md
  - docs/screenshot.png
  - docs/ui-polish/panel-en.png
  - docs/ui-polish/panel-pt.png
  - docs/ui-polish/preferences-pt.png
  - docs/ui-polish/quality-pt.png
---

## Decided
- The user explicitly rejected preview2 visual similarity despite green codec tests. Compare real screenshots and window geometry against the Vysor reference before claiming visual delivery: one 38 px title/control bar, full-width proportional video, 48 px bottom navigation, compact device panel. Keep MirrorPanel's own implementation and only expose implemented capabilities.
- Forward the authenticated Companion heartbeat to the desktop as MPV1 status. MediaCodec may stop emitting video on an unchanged screen; lack of frames does not prove the transport is dead. Keep the real 15 s transport watchdog.
- Test both idle connection survival and real transport loss. Actual TCP regression plus physical Moto G30 and packaged Electron checks complement unit tests. Test failures must propagate nonzero exit status.

## Tried and ruled out
- Merely changing toolbar colors or passing video/audio tests did not satisfy the user's interface requirement.
- Removing the socket timeout would hide real disconnects. Forwarding end-to-end authenticated liveness fixes the static-screen case without weakening fault detection.
- Requesting a keyframe does not guarantee a new image on a static Surface: the resume test must change the synthetic fixture before expecting new frames.
- Running separate test profiles alongside an old MirrorPanel instance can reinstall/stop the same Android Companion. Close the identified old app normally before isolated physical tests; preserve unrelated Vysor and shared ADB.

## Watch out
- Electron DOM changes can precede compositor paint; wait for paint before screenshots. A passing dialog.open assertion alone is not visual evidence.
- External mouse input can contaminate synthetic multitouch sequences; isolate the harness's own windows, not the user's desktop. The shipping UI remains interactive.
- No claim of full Vysor parity or all-ROM certification. Tests, exact device/API, screenshots, known limits and package hashes are recorded in native/docs/PREVIEW3.md and the session outputs.
