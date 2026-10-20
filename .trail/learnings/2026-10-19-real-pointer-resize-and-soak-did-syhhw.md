---
title: Real pointer resize and soak did not certify preview4 stability
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
The user's resize/stability acceptance gate requires real pointer drags and a sustained live-device observation. Posted WM_SIZING messages test the handler but do not certify physical dragging, corner hit-testing, or session stability. Preview4's real comparison did NOT pass the no-spontaneous-closure gate. Keep the previous automated pass results historical, not a substitute.

## Tried and ruled out
Real sky.drag reduced MirrorPanel proportionally through top, bottom and outer side edges; near-corner attempts sometimes did nothing or resized only a side. Vysor reverted a width-only reduction after release and fitted width after a height reduction. MirrorPanel's continuous proportional resize is not identical to that behavior. Sky rejects drag endpoints outside the window, so outward growth was not certified. Do not call a requested/manual gesture verified just because the user says continue.

## Watch out
Both initial mirror windows disappeared; user confirmed not closing them. After re-opening, passive samples showed Companion PID7708->8398 near19:31:49, a new MirrorPanel renderer/HWND, and later a new Vysor renderer/HWND. Cause was not isolated. Later transitions occurred during minimize/restore and requested manual-growth phase; do not infer causality. Android EOF/service-destroyed is evidence of transport closure, not its initiating cause. Panel recorded new starts without a close reason. Stable Vysor Android PID alone does not prove uninterrupted video. Record native-close, IPC close/stop, renderer exit and transport reason separately in the next diagnosis. Screenshots from sky immediately after actions can show transition animations or occluding apps; only save settled, task-specific evidence. Test report and raw samples live in the task outputs/comparacao-real-*.
