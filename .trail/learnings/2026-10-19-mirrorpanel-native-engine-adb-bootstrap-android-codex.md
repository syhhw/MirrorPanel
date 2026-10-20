---
title: "MirrorPanel native engine: ADB bootstrap, Android API floor and verified lifecycle"
author: Codex
date: 2026-10-19
branch: main
touches:
  - native/src/session.ts
  - native/src/main.ts
  - native/android/server/src/com/mirrorpanel/server/Main.java
  - docs/ENGINE.md
---

## Decided

The user explicitly selected Electron + TypeScript + WebCodecs for MirrorPanel
2.0 and requested the trail skill. Preserve Python 1.x under mirrorpanel/ until
feature parity. Native engine source lives in native/, with a separate portable
distribution and root launcher. No scrcpy/Vysor binary or source enters that package.

The original Android app_process server uses MediaCodec H.264, the AOSP static
DisplayManager mirroring API and a custom bounded MPV1 protocol. The exact static
API is absent in Android 12/13 and present in Android 14: require API34+.
Companion foreground indicator/Stop uses a separate capability token and loopback
heartbeat. Explicit phone-stop is distinct from transport failure and must not retry.

## Tried and ruled out

Sending raw random token bytes then immediately ending ADB stdin intermittently
produced EOFException. ASCII hex bootstrap with stdin left open passed repeated
device and multi-device tests. Never put video tokens in argv or error logs.
ExecFile errors embed arguments, so public errors must omit full shell commands.

The stock emulator launcher kept portrait despite user-rotation. For a deterministic
rotation test, set fixed-to-user-rotation enabled, establish lock 0, then lock 1,
and restore defaults afterward. This was a test precondition, not a capture bug.

REA accepts directories/asar, not a single JS path. The public Vysor web bundle
analysis is partial and does not revalidate the entire supplied installer/APK report.

## Watch out

Verified: 9 native unit tests, TypeScript, ESLint, Android build/signature; real
WebCodecs/MP4/PNG; two emulators API36/37, rotation, isolated close, Companion death,
forward cleanup. 112 legacy Python tests remain green. No physical phone/Wi-Fi test.

Audio, multitouch, full Unicode IME, QR, tray and updater parity are not implemented.
Electron contains its own ffmpeg.dll: absence of an external FFmpeg executable
must not be described as absence of all FFmpeg components.

Private signing key was not copied into the repository/distribution. Rebuilding
with a different key cannot replace an already installed Companion automatically;
use a deliberately managed stable signing key for releases. No automatic uninstall.
No commits, pushes, tags or public release were made during this integration.
