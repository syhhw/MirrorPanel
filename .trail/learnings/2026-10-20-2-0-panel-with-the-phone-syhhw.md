---
title: "2.0 panel with the phone in the center, not looking like a generated interface"
author: Syhhw
date: 2026-10-20
branch: mirrorpanel-2.0
cost: { minutes: 17, tokens: 234048 }
touches:
  - native/package-lock.json
  - native/package.json
  - native/scripts/build.mjs
  - native/src/icons.ts
  - native/src/main.ts
  - native/src/renderer.ts
  - native/src/style.css
  - native/src/adb.ts
  - native/tests/protocol.test.ts
  - native/src/session.ts
---

## Decided
- The panel draws each connected phone as an outline with its real screen shape (wm size ratio, always upright) and real model name (getprop ro.product.model). Clicking the phone mirrors, or shows the window when live. Device settings sit on a small sliders button next to the name.
- Preferences and the activity log moved to their own view behind the gear in the title bar. The home footer only holds "Connect over the network", a warnings count when there are warnings, and Help.
- No cards: the drawn phone is the only framed element, because it is the interaction. Colour marks state only (aqua = live, coral = recording, amber = warning). Buttons, switches and the selected segment use the neutral --button colour.
- Typeface: Segoe UI Variable, chosen on purpose for a native Windows utility, using its optical-size families (Text for body, Display for names and headings, Small for captions). Manrope was removed.
- Design rules come from the design-review AI-slop list plus the Impeccable and Make Interfaces Feel Better guidance:
  - tinted neutrals and concentric radii;
  - scale(.96) on press, hover transitions of 150 ms or less, no `transition: all`;
  - hit areas of at least 40 px;
  - no coloured left border, no pills, no icon tiles.

## Tried and ruled out
- The first 2.0 redesign: Manrope on a teal-black background, a card per section, icon tiles, pills, helper text under every block, and preferences on the main screen. The user called it vibe-coded.
- `align-content: center` on the scrolling home clipped the top phones once they no longer fit. `safe center` scrolls from the top instead.

## Watch out
- A visual audit that pushes demo state into a real panel must use fictitious serials and `setIgnoreMouseEvents(true)`. With a real serial, any click on a drawn phone starts a real session on the connected device.
- Staging zero-context (`-U0`) hunks one at a time can misplace lines in the index. To split a file across commits, build the staged blob from the working file with reverse replacements, run `git hash-object --path <file>` (which applies the CRLF filters), and verify the staged snapshot before committing.
- build.mjs now deletes build/desktop before building, so files removed from the app can never be packaged.
