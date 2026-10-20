---
title: MirrorPanel preview2 audio Unicode Android12 pointer slots
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
- MirrorPanel 2.0 uses Electron/WebCodecs and original Android code. User asked for Vysor behavior as a reference while retaining MirrorPanel identity. No Vysor assets/code are shipped.
- API29–33 capture uses SurfaceControl; API34+ uses DisplayManager. Android14-only was an implementation limitation, not a requirement for mirroring.
- Unicode uses an authenticated Companion IME and InputConnection.commitText with editor validation and ACK. Playback audio uses explicit MediaProjection consent, PlaybackCapture, AAC48k stereo, AudioDecoder and MP4 remux.
- External touch IDs must be mapped to stable Android slots0..9, even though the protocol accepts IDs0..31. Keep slots through UP; never renumber remaining contacts.

## Tried and ruled out
- Passing MediaCodec profile without a matching level failed on MotoG30 Qualcomm OMX; derive decoder profile from SPS instead.
- Sending Companion status from Android main thread caused NetworkOnMainThreadException. A bounded single-thread reply executor fixed it.
- An InputConnection alone is not proof of an editable field: dummy editors need TYPE_NULL rejection.
- IDs3,9,17 triggered system_server abort in Android12 InputTarget::addPointers. AOSP12 has16 transforms indexed by pointer ID despite accepting IDs through31. Do not repeat high native IDs.
- REA Electron active capture returned hook_conflict and0IPC; app:// is unsupported by its passive Electron-page adapter. Record this limitation instead of claiming runtime IPC coverage.
- Vysor5.0.7 could not connect its control socket on the API37 test emulator. Static code findings are not runtime guarantees.

## Watch out
- A locked phone can look like an input/IME bug. Inspect keyguard state; never bypass authentication or keep retrying touches against a locked device.
- Check exact APK digests and versionCode: installed Vysor4.2.2 differs from its bundled4.2.2. No downgrade/uninstall was performed.
- After unexpected Android system restart, IME recovery may require choosing the normal keyboard. Ordinary session cleanup restores it; validate crashes separately.
- During concurrent device tests, compare ADB forwards for the device under test, not the global list. Other sessions must remain untouched.
- Closing only a mirror window should leave the panel. Renderer crash must stop its session and release contacts/audio. Avoid IPC to disposed render frames.
- Keep private signing keys only in staging/managed signing storage; never copy keys into the project deliverable or portable archive. Fixture is test-only.
- Physical Android12 video/Unicode passed. Final physical multitouch/audio retest was blocked by the lock screen when this note was written; consult VALIDATION for later results.
