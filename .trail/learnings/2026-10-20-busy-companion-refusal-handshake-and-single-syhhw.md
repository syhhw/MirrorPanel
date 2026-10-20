---
title: Busy Companion refusal handshake and single-instance lock
author: Syhhw
date: 2026-10-20
branch: claude/fervent-sanderson-a2021a
cost: { minutes: 1, tokens: 1597 }
touches:
  - native/android/common/src/com/mirrorpanel/protocol/Handshake.java
  - native/android/companion/src/com/mirrorpanel/companion/SessionService.java
  - native/android/companion/src/com/mirrorpanel/companion/ConnectActivity.java
  - native/android/server/src/com/mirrorpanel/server/Main.java
  - native/src/session.ts
  - native/src/main.ts
  - native/src/single-instance.ts
---

## Decided
- One Companion session at a time; a new valid ConnectActivity request is refused, not allowed to take over. Takeover would let two desktops race on the IME (each reads the other's MirrorInput as "previous"), audio consent and the notification, and a test profile could end the user's real mirror.
- Handshake (common/Handshake.java): after the token the Companion sends a heartbeat (type 6) to accept or an end frame (type 4, reason companion-busy | indicator-blocked) to refuse. The server reads this first frame before capturing; on refusal it accepts the desktop, sends type 4 with the reason and exits only after the desktop closes.
- session.ts maps the reason with refusalMessage() and fails start() at once; the session ends as start-failed, which main.ts never auto-retries. The 15 s "did not confirm the mirroring indicator" timeout stays as the fallback.
- app.requestSingleInstanceLock() was already there since d0910db and is per userData, so smoke/verification profiles (app.setPath('userData') before require) coexist. Two MirrorPanels on one phone means two profiles, not a missing lock.

## Tried and ruled out
- Letting the refusing server exit right after writing the reason: the PC can see the adb shell exit first, end('process-exit') destroys the socket synchronously and the reason is lost. Hence the wait for the desktop's close.
- Relying on the bridge's heartbeat thread for the accept answer: a status frame could precede it in theory; Handshake.accept writes token + heartbeat together.

## Watch out
- The old second-instance handler called panel.restore() on a destroyed panel while quitting (throws in main). revealPanel() checks isDestroyed; a launch while quitting relaunches after cleanup.
- A worktree build reinstalls the Companion (different digest), which kills a session another MirrorPanel is running on the same phone. Do not device-test while another MirrorPanel is open.
- Electron verification scripts placed outside native/ get no resources/adb, so they never touch the phone: handy for lock/lifecycle checks.
