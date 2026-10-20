---
title: "Full 2.0 code review: release hazard, untracked native and vibe-code causes"
author: Syhhw
date: 2026-10-20
branch: main
cost: { minutes: 10, tokens: 110116 }
touches:
  - README.md
  - ".Codex/HANDOFF-before-native-2026-10-18.md"
  - ".Codex/HANDOFF.md"
  - ".claude-flow/policy/state.json"
  - ".github/workflows/native-tests.yml"
  - ".swarm/hnsw.index"
  - ".swarm/hnsw.metadata.json"
  - ".swarm/memory.db"
  - ".swarm/schema.sql"
  - Abrir MirrorPanel 2.0.vbs
---

## Decided
- The "vibe code" look of MirrorPanel 2.0 comes from form, not logic: hand-minified TS/CSS (renderer.ts:70 is 2608 chars, main.ts:354 is 547, style.css is 27 lines/14.6 KB), god functions (main.ts startSession L124-276, renderer mirror() ~L118-273, Main.java run ~L52-144), untyped IPC (renderer Api = {[key:string]:...}), magic protocol numbers, no formatter. Security baseline (sandbox, contextIsolation, strict CSP, argv-only adb, bounded protocol reads, constant-time token compare) is sound and should be kept.
- Recommended order: protect repo first (gitignore + commit native/ + restrict release.yml), then one isolated Prettier/stylelint/google-java-format commit (add to .git-blame-ignore-revs), then real bug fixes, then lint/tsconfig hardening, then splitting main.ts/renderer.ts with a typed ipc-contract.

## Tried and ruled out
- Not a logic rewrite: typecheck, eslint and 22/22 unit tests are green on 2026-10-19; the issues are structure, tooling and a handful of verified bugs.

## Watch out
- .github/workflows/release.yml triggers on any v* tag, builds the Python 1.x app, writes the tag into updater.py and publishes as latest without --prerelease. A tag like v2.0.0-preview.5 would make every 1.3.1 install auto-update (updater _parse_version -> (2,0,0,5)) to a 1.x build labelled 2.0. Restrict it to v1.* before tagging 2.0.
- The whole native/ tree (2.0 engine) was untracked in git; Vysor/Vysor-win-5.0.7.exe (126 MB, third-party) and AI tool state (.swarm, .claude-flow, .Codex) were not ignored, so git add -A would pull them in.
- Verified bugs: renderer.ts:214 returns while decoder.state==='closed', so after one VideoDecoder error the video freezes until reconnect (config is only resent on renderer-crash recovery, main.ts:254). main.ts owner()/frame-ack read window.webContents of destroyed windows while a closing session is still in the map (no uncaughtException handler). Session listeners run inside the socket data try, so a throwing listener ends the session as protocol-error. Companion MainActivity is exported and accepts port/token from any caller (server is not authenticated). SessionService calls stopSelf() before startForeground() after startForegroundService.
- Main process, mirror window and Android send hard-coded Portuguese messages even when language is 'en'.
