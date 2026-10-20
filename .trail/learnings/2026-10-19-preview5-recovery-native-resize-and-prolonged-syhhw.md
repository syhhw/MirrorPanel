---
title: "Preview5 recovery, native resize and prolonged physical validation"
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

- User requires observed Vysor-like resizing and prolonged physical-device verification, not a UI mockup or synthetic WM_SIZING presented as mouse input.
- Native resize is free; settle after 500ms by fitting the video to the longest content dimension, with 3px tolerance, monitor bounds and stable aspect ratio. Portrait width-only shrink returns to its old width; reduce height to shrink the mirror. Max/fullscreen contains and centers video.
- Renderer failure must not close a healthy mirror/Android transport. Cancel contacts, reload, clear stale queues, resend layout/config, request sync. Three recovery attempts; then interactive retry/close controls. Serialize duplicate starts per device.
- Persist local rotating lifecycle metadata with close origin, renderer failures and heartbeat/frame counters. Never log input text, clipboard, auth tokens or ADB command arguments.
- APK drop uses a real Electron File path in preload, validates local APK size/container, and invokes argv-only adb install -r with a per-device lock. UI reports progress and errors. Synthetic renderer File objects are rejected.
- Navigation ripple is an original implementation (250ms expansion/minimum hold, 300ms fade), with mouse and keyboard support and no duplicate Android action.

## Tried and ruled out

- Preventing every native will-resize event made sizing unlike the reference. Discarded it for native drag plus delayed fitting.
- Independently clamping width and height distorts the aspect ratio. Derive the second dimension from the bounded first.
- A watchdog/soak assertion requiring decoded frames every sample mislabels unchanged screens as frozen. Require heartbeat progress, stable identity, nondecreasing frame counts and decoding progress when video arrives; explicitly change screens to verify response. Keep those false-positive preparation samples separate.
- Waiting indefinitely for executeJavaScript from a crashed renderer hangs the observer, not the product. Bound observations and wait for reload completion.
- Static Vysor REA evidence is partial. A failed preventSnap trace with zero seeds is not evidence of behavior. Use the exact static spans plus real comparisons.

## Watch out

- Historic simultaneous Vysor/MirrorPanel closes remain unattributed. EOF/ServiceDestroyed are consequences, not evidence that a user stopped mirroring. The old render-process-gone close path was reproduced/fixed; do not label it the proven historic cause.
- SKY blocks drag destinations outside the target window. Inward physical drags passed; outward physical growth remains unverified. Do not substitute PInvoke/SendInput or claim programmatic sizing is manual dragging.
- APK installation passed with a disk-backed Chromium drop into the real renderer and physical phone. This is not an Explorer-to-window physical gesture certification.
- Fault suites and soak must not run concurrently on the same phone. Record deliberate closes separately; leave the user's installed EXE usable after tests.
- smoke-renderer-crash.cjs now aliases smoke-preview5.cjs (new recovery contract). smoke-window-lifecycle.cjs uses Electron.setBounds for automated geometry, retains Companion-loss/retry checks, and verifies IME/stay-awake/forward cleanup.
- Keep the stable Android signing key local; never copy development.keystore into the project/release. No Android code changed for preview5.

- Final evidence: packaged preview5 soak1200.21s/119samples, same session/AndroidPID, zero close/reconnect/failures. Separate physical lifecycle suite passed eight Companion losses, manual retry, close and exact IME/stay-awake/forward restoration.
