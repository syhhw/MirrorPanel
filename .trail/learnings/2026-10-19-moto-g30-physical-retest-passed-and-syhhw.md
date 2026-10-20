---
title: Moto G30 physical retest passed and stale fixture diagnosis
author: Syhhw
date: 2026-10-19
branch: main
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
The corrected stable native pointer slots passed on the physical Moto G30 Android 12: external IDs 3/9/17 became 0/1/2, middle removal kept 0/2, MOVE and CANCEL passed without system_server restart. Unicode, audio and the Electron UI also passed. No product code change was needed in this retest.

## Tried and ruled out
An initial text-without-editor assertion failed because the installed synthetic fixture APK was outdated and ignored readonly. Comparing SHA256 exposed the stale fixture; installing the current fixture then rerunning the entire suite passed. Do not misdiagnose this as an IME product regression or relax the assertion.

## Watch out
Confirm fixture artifact identity before negative device tests. Record and restore IME, stay-awake and owned forwards. Verify system_server PID as well as boot ID: framework restarts do not necessarily reboot the kernel. Physical results: 331 video/485 audio engine packets; UI269 decoded video frames,0drops,408audio; actual MP4 decode stereo48k and439.511Hz tone. Other OEMs/versions/long duration remain untested.
