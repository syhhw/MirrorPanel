---
title: "2.0 visual identity: logo, dark theme and Companion"
author: Syhhw
date: 2026-10-20
branch: mirrorpanel-2.0
cost: { minutes: 52, tokens: 555502 }
touches:
  - native/scripts/icons.cjs
  - native/package-lock.json
  - native/package.json
  - native/scripts/build.mjs
  - native/src/icons.ts
  - native/src/main.ts
  - native/src/renderer.ts
  - native/src/style.css
  - native/android/companion/AndroidManifest.xml
  - native/android/companion/res/drawable/ic_launcher_background.xml
---

## Decided
- Logo is the mirrored M: native/design/logo/mirrorpanel-mark.svg (master) plus mirrorpanel-mark-small.svg, a separate optical size used at 32 px and below. `npm run icons` regenerates every PNG and the .ico from them; never edit the PNGs by hand.
- Colour roles are fixed: aqua (glass) means action or live state, coral means record or stop. Do not reuse them for decoration.
- Theme comes from settings.theme ('system' | 'light' | 'dark') applied with nativeTheme.themeSource; style.css only reads prefers-color-scheme tokens. The native window backgroundColor follows the theme so resizing never flashes the opposite colour.
- Motion only where something changed: dialog opening (@starting-style), a device going live, the first video frame. All of it sits behind prefers-reduced-motion.
- Companion resources live in android/companion/res (adaptive icon with monochrome layer); build-android.py runs aapt2 link --java to generate R before javac.

## Tried and ruled out
- Plain geometric marks and generic glyph logos: rejected by the user as too simple; the mark had to reference the M.
- Letting Prettier format inside html`` templates: it rewrote markup, so embeddedLanguageFormatting stays off.

## Watch out
- In the html`` tagged template a line break next to a tag bracket or at the template edges disappears, anywhere else it becomes one space; check spacing before interpolations in attributes.
- An Electron helper script with an unhandled rejection opens a blocking error dialog; catch it and exit with code 1 (scripts/icons.cjs does).
- Splitting mixed hunks into separate commits: stage a HEAD-based blob with git hash-object + update-index, then verify the staged snapshot in a scratch checkout before committing.
