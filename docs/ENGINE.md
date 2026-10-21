# MirrorPanel — architecture

Electron + TypeScript + WebCodecs, its own Android engine.

```text
Electron panel → Session manager → official ADB → app_process (UID shell)
                                   │               MediaCodec H.264 / display
                                   └→ Companion    indicator / IME / audio
Electron window ← limited IPC ← MPV1 forward ← capture and authenticated status
 WebCodecs canvas + AudioDecoder               → InputManager / commitText
 PNG and MP4 H.264 + AAC
```

Main controls processes, files and ADB. Preload exposes specific operations;
the renderer has sandbox, contextIsolation, a local CSP and nodeIntegration disabled.
Two random tokens separate the desktop stream from the Companion's private channel.
The server only captures while the authenticated indicator is active.

## Android

API 29–33: SurfaceControl with a MediaCodec surface and the real display's layer stack.
API 34+: the static DisplayManager signature for mirroring. The product minimum
is now Android 10; untested OEMs/versions are listed in the validation matrix.

Multi-touch validates states and maps external IDs to stable Android slots 0..9.
This avoids the Android 12 InputTarget problem with high IDs. UP releases only
the changed contact; CANCEL, rotation and shutdown release the gesture.

Unicode uses its own InputMethodService, without reading the editor's content. The previous
keyboard is saved and restored at shutdown. Text requires an active editor and an ACK.
Composition and paste preserve the code points, with a 64 KiB limit per command.

Audio uses a MediaProjection consent Activity and AudioPlaybackCapture;
only playback that the apps allow. AAC-LC 48k stereo is encoded
with MediaCodec, with monotonic timestamps and a bounded queue. The microphone is not used.

## Desktop and lifecycle

Video: WebCodecs + canvas. Audio: AudioDecoder + AudioContext, volume, bounded
queue and stopping the scheduled sources on stop. MP4 remuxes H.264/AAC without
re-encoding; PNG comes from the canvas. Rotation and audio changes finish the current MP4.

A session owns one process, one forward and one temporary JAR. It never uses
kill-server or kill by name. Cleanup waits for late ADB operations, restores
IME/stay-awake and ends only the resources it owns. A renderer crash cancels pending contacts and reloads the image in the same
window, keeping the Android transport; queues meant for the old renderer are
discarded. There are three automatic recoveries; after that, Try again is still
available and the window controls stay usable. Destroying the window
ends the session. Concurrent starts for the same device are serialized. Closing the Android guidance screen does not end the mirror. Unexpected disconnections get up to
three reconnection attempts. Switching USB→Wi-Fi may require a new Start.

The Companion's authenticated heartbeat is forwarded to the PC as an MPV1 status.
The 15 s watchdog measures absence of communication, not absence of new frames.
So a static screen stays connected without disabling failure detection.

Windows use their own frame, a 44 px top bar and a 48 px bottom navigation
bar. Native dragging is free; after 500 ms without a resize, the video and the window
are fitted by the larger dimension, with a 3 px tolerance and the monitor's bounds.
Maximize/fullscreen use contained, centered video; the state is resent when
a renderer is recovered. The window registry
is independent of sessions, so windows can be closed/minimized even while disconnected. Window actions
accept only the owning sender and a closed list of commands.

Losing the Companion is a recoverable connection failure, not a stop request.
Exit code zero does not imply user intent either. The Android app shows
guidance and the connection; dismissing the notification does not end the service.

## References and status

- `native/docs/PROTOCOL.md`: contracts, limits, authentication and timestamps.

H.265, two-way clipboard, QR, tray and updater are not implemented yet.
No third-party code or resource takes part in the engine besides the official ADB
and Electron. Chromium keeps its internal ffmpeg.dll component.

## APK, interaction and diagnostics

The preload turns a real File into a path through webUtils.getPathForFile. Main
validates a local APK/ZIP file, its size and the owning window; the installer uses
argv `adb install -r`, with no shell and a per-device lock. The panel's file picker
shares that installer. Synthetic files from the renderer do not become paths.

Navigation ripple: 250 ms expansion, 0.25 opacity, 250 ms minimum and
300 ms exit. Mouse and keyboard do not duplicate the Android action.

Rotating local diagnostics (2 MiB + one previous file): window lifecycle, native
close/minimize/maximize commands, renderer crashes, start/end, heartbeat,
packet counts and the transport PID. It does not log tokens, text, clipboard
or ADB arguments. A failure to write diagnostics does not interrupt the product.
