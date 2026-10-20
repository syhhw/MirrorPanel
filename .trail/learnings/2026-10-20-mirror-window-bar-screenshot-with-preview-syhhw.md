---
title: "Mirror window: bar, screenshot with preview and automatic resume after a drop"
author: Syhhw
date: 2026-10-20
branch: mirrorpanel-2.0
cost: { minutes: 34, tokens: 229491 }
touches:
  - native/src/main.ts
  - native/src/preload.ts
  - native/src/renderer.ts
  - native/src/style.css
  - native/src/window-sizing.ts
  - native/tests/resize-settle.test.ts
  - native/tests/window-open.test.ts
  - native/verify-mirror.tmp.cjs
  - native/package-lock.json
  - native/package.json
---

## Decided
- The mirror title bar is 44 px tall. MIRROR_BARS (window-sizing.ts) is now 92 = 44 bar + 48 Android navigation; the sizing tests derive from the constant.
- The whole title bar is a drag region and only its buttons are no-drag. The device name is plain text, so the left side always moves the window. "Show the panel" moved from the name click to the ⋮ menu, and Fullscreen (F11) moved to the menu so the name fits a narrow window.
- A screenshot freezes the current frame into a preview with Copy (primary), Save and Discard.
  - Esc discards, Ctrl+C copies, Ctrl+S saves.
  - The preview owns the keyboard, so nothing reaches the phone while it is open.
  - Copy goes through the `copy-png` IPC, which runs the same PNG validation as `save-png`.
- When the decision is the person's (try again or close), the status cover becomes a card: over the last frame, dimmed, if a frame ever arrived, otherwise over the solid cover.
- A device that drops off for longer than the 1.8 s retry is remembered in `awaitingDevice`. When refresh() lists it as ready again, the same window resumes by itself. A failed start whose device vanished joins the same wait.
- Text is only selectable in the activity log (and in form fields).

## Tried and ruled out
- `adb reconnect device` did not interrupt a running session on the Moto G30.
- `adb reconnect` (host side) and `adb usb` do drop the link, but only for about 2 s. The existing 3-attempt retry recovers that, so neither exercises the long-absence path. Only keeping the device off the bus for longer, with a real unplug or with `adb reconnect` repeated for several seconds, reaches `awaitingDevice`.

## Watch out
- Electron 44's main-process clipboard is the async W3C-style API: no `writeImage`. Use `clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes]) })])`. `readText()` is a Promise.
- Before a device test, check that no packaged MirrorPanel is mirroring: look at the forwards, the Companion service, and the IME switched to MirrorInput. The user may reopen it between turns, and a click on the drawn phone now starts a session.
