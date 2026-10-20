---
title: Preview4 window controls outlive sessions and proportional resize
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
- User correction: test interaction after a session ends, not only while mirroring. Window authorization must outlive transport sessions. Keep a trusted window registry keyed by device and validate sender identity; only media/input operations require a live session. Retry reuses the existing window.
- User explicitly requested removing the phone Stop button. Companion is now a connection/status guide; notification opens that guide and has no deleteIntent. The visible foreground indicator, Android audio consent and Android's own app controls remain.
- EOF and process exit code zero are transport/process events, not proof the user intentionally stopped. Classify failures honestly and allow bounded recovery. A minimized window stays minimized during recovery.
- Match resizing behavior with evidence: the local Vysor bundle fits content after a delay; MirrorPanel independently preserves video ratio plus fixed chrome in native Windows resizing. Cover all eight sides/corners, small/large sizes and restore after maximize.

## Tried and ruled out
- Preview3 only checked initial window geometry and controls with a live session. User screenshots exposed the missed disconnected-window state.
- The decoder callback used textContent on a status container and removed the newly added Retry button. Preserve the child elements and toggle visibility instead. Suppress stale input cancellation after disconnection.
- Dismissing a notification should not stop a session; using deleteIntent as a Stop command caused unintended coupling.
- A service declared private rejects shell am stopservice. Simulate process loss with force-stop of the owned test Companion, then test recovery; do not export the service merely to make tests easier.

## Watch out
- Real WM_SIZING messages cover the Windows handler, but do not certify human dragging or every multi-monitor/DPI setup. Record test scope explicitly.
- Test the terminal state and manual retry, then terminate again and click Close through the renderer's actual mouse input path. Ensure no duplicate windows or unexpected restores.
- Test fixtures must be removed from the user's device after final validation to avoid leaving duplicate-looking app icons. Keep their build scripts/APK locally for reproducibility.
- Do not remove the prior learning; this correction supersedes its initial-size-only visual acceptance. No claim of full Vysor parity or all-ROM certification.
