---
title: Volta sozinha apos queda longa e valor de tela ligada preservado
author: Syhhw
date: 2026-10-20
branch: mirrorpanel-2.0
cost: { minutes: 3, tokens: 20124 }
touches:
  - native/src/main.ts
  - native/verify-mirror.tmp.cjs
  - native/src/preload.ts
  - native/src/renderer.ts
  - native/src/style.css
  - native/src/window-sizing.ts
  - native/tests/resize-settle.test.ts
  - native/tests/window-open.test.ts
---

## Decided
- An automatic reconnect that fails counts as a lost link, as does a start whose device vanished. Both wait for the device and show "Aparelho desconectado…", never the raw adb error. A Companion refusal (the `refused` event) is not a lost link and keeps its own message.
- The wait resumes only after the device is listed ready on two refreshes in a row, and gives up after 5 resumes in a row (MAX_RESUMES), so a persistent failure cannot loop forever.
- If a session ends while the device is gone, the phone's original stay_on_while_plugged_in is kept in `unrestoredAwake`. The resumed session reuses it instead of reading back the 3 MirrorPanel had set. If no session follows, it is restored as soon as the device is listed again.
- Verified on the Moto G30 with two `adb -s <serial> usb` calls 3 s apart: the card appeared over the dimmed last frame, the mirror resumed about 12 s later, and stay_on came back to 7.

## Tried and ruled out
- Twelve `adb reconnect` calls one second apart left the phone's adbd stuck "offline". Neither a cable replug nor `adb kill-server` fixed it; the user had to toggle USB debugging. Do not use that loop. Two `adb usb` calls a few seconds apart give the same long absence safely.

## Watch out
- A session that drops and comes back used to leave stay_on at 3 for good, because the resumed session read 3 as the phone's original value.
