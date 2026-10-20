---
title: "Repo translated to English: t(en, pt) and Companion string resources"
author: Syhhw
date: 2026-10-20
branch: new
cost: { minutes: 1, tokens: 1667 }
touches:
  - native/src/i18n.ts
  - native/android/companion/res/values/strings.xml
  - native/android/companion/res/values-pt/strings.xml
  - native/android/companion/src/com/mirrorpanel/companion/MainActivity.java
  - native/src/main.ts
---

## Decided
- The repository is English-only: code, comments, identifiers, docs, learnings and commit messages. Portuguese stays only as interface translation.
- Desktop text uses t(en, pt) from native/src/i18n.ts: English first, Portuguese second. Portuguese is still the default interface language. The swap from t(pt, en) was done with the TypeScript parser and checked pair by pair.
- The Companion's phone screen and notification read from Android string resources: android/companion/res/values/strings.xml (English, the default) and values-pt/strings.xml. build-android.py already compiles res/ with aapt2 and generates R, so a new phone text only needs an entry in both files.
- Strings the Companion sends to the desktop (audio state, text ack) only reach diagnostics; the desktop shows its own t() text. They stay plain English constants, not resources.
- Media folders under Videos\MirrorPanel Media follow the interface language: Screenshots/Recordings in English, the old "Capturas de tela"/"Gravacoes" in Portuguese.
- The 1.x Python app was removed from `new`; it lives on `old` with the v1.x tags. The launcher is "Open MirrorPanel.vbs".

## Tried and ruled out
- Dropping the 1.x rules from .gitignore: checkouts still hold bin/, logs/, settings.json and similar from 1.x, so the rules stay, with an English comment.

## Watch out
- Unit tests that assert error texts call setLanguage('en') at the top of the file. Each test file runs in its own process, so this does not leak into other files.
- Smoke scripts that read interface text from the phone or the panel must accept both languages.
- In this environment's Bash tool, a heredoc turns "\\" into "\", and bytes such as 0x81 (part of "Á") get mangled on the way into Python. Put edit scripts in a file instead.
- When other sessions or agents share the checkout, commit with explicit paths (git commit -- <paths>). A plain git commit takes whatever they staged.
