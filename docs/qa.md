# Alpha verification ledger

Foundation verification recorded on 2026-09-12. This ledger distinguishes implementation, automated evidence, and physical-device QA. The [public CI history](https://github.com/michaelcrosato/rbb/actions/workflows/ci.yml) records checks for each revision.

## Executed so far

- Three.js `0.186.0` and matching types verified against the npm registry on 2026-09-12.
- TypeScript and ESLint pass on Windows / Node 24.20.0.
- 33 unit/integration tests pass: deterministic worlds and triangle collision; spatial queries; resource/crafting/building transactions; jump input preservation; survival/boar/death/respawn; save validation and backup recovery; real WebSocket sessions, replay/origin/schema rejection; private inventories; stale input; restart recovery; 16-client load; SQLite fail-closed recovery, missing-primary recovery and future-schema rejection.
- A 10-world-minute deterministic simulation soak maintains finite coordinates, bounded inventory and valid serialization.
- Initial agent-browser visual verification: the menu and WebGL world render; no browser exceptions. Procedural models were merged to lower draw calls, and foliage self-shadow artifacts were removed.
- All six Playwright scenarios pass locally: gather/craft/build/export/reload/map; settings/keyboard focus/movement/jump/pause; automatic reconnect after a server process restart; graphics-context interruption and save recovery; two-browser session rejoin; portrait/landscape touch controls and menus. No unexpected browser exceptions were reported.
- The built static client was served on port 4175 and checked with agent-browser. It renders and starts an expedition, and development diagnostics are absent from the production build.
- GitHub Actions runs formatting, types, lint, unit/integration tests, builds and real Chromium scenarios on Linux. A separate job builds the Docker image and verifies readiness before and after a container restart with its persistent volume. The browser driver uses observed movement steps, state-based cooldown waits, in-browser jump observation and drag-to-look when pointer capture is unavailable; all gameplay assertions remain the same across platforms.
- `npm audit --omit=dev` reports zero known production dependency vulnerabilities at verification time.

## Repeatable rendering workload

`npm run benchmark` (with the dev server running) imports a validated 100-piece camp fixture through the actual save UI, warms the scene, records 12 samples and captures screenshots. It defaults to installed Chrome with hardware rendering; `npm run benchmark -- http://127.0.0.1:5173 --software` explicitly selects the software baseline. Inspect the recorded GPU string before interpreting FPS. Evidence is written to `.artifacts/benchmark/`.

Measured on 2026-09-12 with ANGLE Direct3D11 on **NVIDIA GeForce RTX 4070 SUPER**:

| Scene                                   | Render size / ratio | Median and lowest sampled FPS | Draw calls | Triangles | Geometry count |
| --------------------------------------- | ------------------- | ----------------------------- | ---------- | --------- | -------------- |
| 100-piece camp, Balanced                | 1920 × 1080 / 1.0   | 144 / 144 (display limited)   | 161        | 110,682   | 76, stable     |
| Same camp, Mobile preset on desktop GPU | 915 × 412 / 1.15    | 144 / 144 (display limited)   | 96         | 68,298    | 54, stable     |

Neither scene reported a browser exception. The mobile row is a reduced viewport on a desktop GPU, **not a Galaxy S25 result**. Short sampling confirms this scene's render cost and steady resource count; it does not replace a warm physical-device soak.

## Physical hardware gates

The available development desktop reports an RTX 4070 SUPER. This is **not** an RTX 3000 or an S25 measurement. Browser mobile emulation checks touch mechanics and layout only.

Human device QA should record browser version, exact GPU/phone, viewport, preset, overlay FPS/draw calls, and a 15-minute warm run including shoreline, dense trees, a 100-piece camp, wildlife, crafting, tab suspension and reconnect. Targets: stable 60 FPS on an RTX 3060 at 1080p Balanced; stable 30+ FPS on S25 Mobile after warming. These are design targets until measured.

## Current limits

- Cooperative shared world; no PvP, verified accounts, moderation, build removal, doors/roofs, storage containers, or technology tree yet.
- Remote snapshots are 10 Hz. The local camera smooths authoritative motion; remote-actor interpolation and client prediction remain future work. Internet latency is therefore visible in movement.
- Server limit: 16 simultaneous clients, 512 registered survivors, 512 building pieces. This is a single-process SQLite deployment.
- The world is a finite island, with chunk culling rather than unbounded streaming.
- Saves are origin-local, with one active solo slot and a previous healthy backup. Export before changing browser/device or clearing site data.
- The local Docker daemon is not running; the image build/restart verification was executed successfully in GitHub CI.
- Production Vercel publication and real hardware performance are not claimed by the static build alone.

## Reproduction commands

```sh
npm run check
npm run test:e2e
npm run format:check
```

For browser failures, inspect the retained Playwright trace and screenshot. Unit fixtures may construct domain state; browser tests navigate with real mouse, keyboard and touch input and read diagnostics without mutating the game.
