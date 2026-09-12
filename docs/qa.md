# Alpha verification ledger

This ledger distinguishes implementation, automated evidence, and physical-device QA. It is updated during foundation verification.

## Executed so far

- Three.js `0.186.0` and matching types verified against the npm registry on 2026-09-12.
- TypeScript and ESLint pass on Windows / Node 24.20.0.
- 32 unit/integration tests pass: deterministic worlds and triangle collision; spatial queries; resource/crafting/building transactions; jump input preservation; survival/boar/death/respawn; save validation and backup recovery; real WebSocket sessions, replay/origin/schema rejection; private inventories; stale input; restart recovery; 12-client load; SQLite fail-closed recovery.
- A 10-world-minute deterministic simulation soak maintains finite coordinates, bounded inventory and valid serialization.
- Initial agent-browser visual verification: the menu and WebGL world render; no browser exceptions. Procedural models were merged to lower draw calls, and foliage self-shadow artifacts were removed.
- Playwright desktop/touch scenarios are undergoing verification. Final results will replace this pending entry before alpha completion.

## Physical hardware gates

The available development desktop reports an RTX 4070 SUPER. This is **not** an RTX 3000 or an S25 measurement. Browser mobile emulation checks touch mechanics and layout only.

Human device QA should record browser version, exact GPU/phone, viewport, preset, overlay FPS/draw calls, and a 15-minute warm run including shoreline, dense trees, a 100-piece camp, wildlife, crafting, tab suspension and reconnect. Targets: stable 60 FPS on an RTX 3060 at 1080p Balanced; stable 30+ FPS on S25 Mobile after warming. These are design targets until measured.

## Current limits

- Cooperative shared world; no PvP, verified accounts, moderation, build removal, doors/roofs, storage containers, or technology tree yet.
- Remote snapshots are 10 Hz. The local camera smooths authoritative motion; remote-actor interpolation and client prediction remain future work. Internet latency is therefore visible in movement.
- Server limit: 16 simultaneous clients, 512 registered survivors, 512 building pieces. This is a single-process SQLite deployment.
- The world is a finite island, with chunk culling rather than unbounded streaming.
- Saves are origin-local, with one active solo slot and a previous healthy backup. Export before changing browser/device or clearing site data.
- The Docker daemon is not running on the development machine; the container build/restart check is included in GitHub CI and needs a verified green run.
- Production Vercel publication and real hardware performance are not claimed by the static build alone.

## Reproduction commands

```sh
npm run check
npm run test:e2e
npm run format:check
```

For browser failures, inspect the retained Playwright trace and screenshot. Unit fixtures may construct domain state; browser tests navigate with real mouse, keyboard and touch input and read diagnostics without mutating the game.
