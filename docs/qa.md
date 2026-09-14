# Alpha verification ledger

Advanced rendering 0.3 verification recorded on 2026-09-14 Pacific. This ledger distinguishes implementation, automated evidence, and physical-device QA. The [public CI history](https://github.com/michaelcrosato/rbb/actions/workflows/ci.yml) records checks for each revision. The older 0.2 evidence is retained below as a historical baseline.

## Advanced rendering 0.3

- TypeScript, ESLint, 52 unit/integration tests, and the production client/server builds pass on Windows / Node 24.20.0. The six new rendering tests cover opt-in defaults/legacy settings, Low preference preservation, unavailable capabilities, live shared texture/matrix references, camera jitter/history, and independent material adapters.
- All **16 Playwright scenarios pass** locally. Coverage adds the combined advanced graph and old effects; camera/water/environment history resets; Low inventory, milestone and animal-population parity; repeated target allocation/release; visible normal/velocity inputs; distant buffer release and upload on return; browser context restoration and later world replacement; touch orientation; and ordinary-server graphics controls without sandbox mutations. The same scenarios retain real controls and read-only diagnostics.
- All five advanced scenarios passed with forced SwiftShader as well: composition/Low, residency/reload, target lifetimes, context restoration/later world replacement and ordinary-server graphics. These use the same shaders with bounded pixel/sample budgets; they do not substitute for physical-device quality/performance checks.
- The final **20-case hardware benchmark** covers each advanced option, all advanced together, High with every optional effect, coast/cloud views, mobile viewport and Low suppression. It records asynchronous GPU timing and a repeated baseline control. [Raw results](benchmark-0.3.json) and [before/after images, costs and interpretation](rendering-pipeline.md) accompany the implementation. The development GPU is an RTX 4070 SUPER; every case was frame-paced near 56 FPS. No 3070 Ti/S25 result is claimed.
- Visual and resource inspection caught and fixed shared uniforms being cloned by `ShaderPass`, stale material uniforms after disabling/re-enabling adapters, first-reflection comparison samplers before shadow maps existed, and occlusion hiding contributors needed by other cameras/shadows. Repeated temporal/volume toggles return the texture count to baseline; all optional post targets are released when disabled.
- Production verification also exposed a delayed pointer-lock grant arriving after the developer panel opened. The `pointerlockchange` handler releases that grant so controls retain mouse input. Context recovery rebuilds render resources and keeps the online connection; solo pauses in the menu, while shared worlds continue running.
- The built 0.3 client on port 4175 passed a Chrome smoke check with an isolated protocol-2 server: production diagnostics are absent; advanced defaults are off; all nine probes initialize; solo developer controls work; ordinary servers reject developer mutations while allowing local graphics; context restoration retains the connection; and returning to the saved solo world still works. No browser/WebGL errors were reported. Recovery retires old target, geometry and instance disposal listeners while the context is lost and re-enables extensions after restoration, avoiding stale-handle cleanup later.
- Benchmark browser exceptions and WebGL validation errors are zero. A single ANGLE warning log in the installed FXAA shader remains recorded; its gradient/temporary warnings did not prevent rendering. This is not a claim of warning-free compilation on every driver.
- Save version 2, world version 1 and protocol 2 are unchanged. All advanced switches default off even on High, and rendering preferences remain device-local. Physical-device soak tests and the advanced guide's remaining quality limits are still open.

## Living-world 0.2 historical verification

Recorded on 2026-09-12 Pacific (2026-09-13 UTC).

### Executed for 0.2

- Three.js `0.186.0` and matching types verified against the npm registry on 2026-09-12.
- TypeScript and ESLint pass on Windows / Node 24.20.0.
- 46 unit/integration tests pass: deterministic worlds and collision; transactions; jump/flight/diving/oxygen; survival/combat/respawn; celestial arcs and moon phase/size lighting; deterministic weather transitions and independent clocks; all eight wildlife habitats, navigation, threats, loot and respawn; developer capability/limits; v1 save migration and validation; real WebSocket replication, replay/origin/schema rejection, private inventories, stale input, restart recovery, 16-client load, and SQLite recovery/future-schema rejection.
- A 10-world-minute deterministic simulation soak maintains finite coordinates, bounded inventory and valid serialization.
- Initial agent-browser visual verification: the menu and WebGL world render; no browser exceptions. Procedural models were merged to lower draw calls, and foliage self-shadow artifacts were removed.
- All ten Playwright scenarios pass locally in 56.3 seconds: the six original gameplay/recovery/multiplayer/touch journeys, plus developer sky/weather/wildlife/checkpoint controls; validated persistent variations and repeated render-effect switching; Low preserving inventory, milestones, tuning and animal population; and portrait/landscape developer tools. Repeated AO/bloom/shafts/flare/reflection toggles return GPU textures to the pre-effect baseline. No unexpected browser exceptions or shader compilation errors were reported.
- Direct screenshots were inspected for dawn/dusk, moonlit ground, rain/snow, all eight species, underwater effects, planar reflections, sun glare, Low, and desktop/mobile controls. Holding flight ascent exposed an input-edge issue during inspection; flight now supports held ascent/descent and a regression test verifies release stops vertical motion.
- The complete gather/craft/build/export/reload scenario also passed in Linux with forced SwiftShader rendering and a two-CPU affinity limit, verifying the automation under slower rendering. The mobile gesture scenario passed in Linux as well.
- The built 0.2 static client was served on port 4175 and smoke-tested in Chrome: solo starts, developer time controls work, production diagnostics are absent, and a separate protocol-2 server permits joining while correctly denying developer mutations.
- GitHub Actions runs formatting, types, lint, unit/integration tests, builds and real Chromium scenarios on Linux. A separate job builds the Docker image and verifies readiness before and after a container restart with its persistent volume. The browser driver uses observed movement steps, state-based cooldown waits, in-browser jump observation and drag-to-look when pointer capture is unavailable; all gameplay assertions remain the same across platforms.
- `npm audit --omit=dev` reports zero known production dependency vulnerabilities at verification time.

Browser automation uses full Chromium's headless mode (`channel: 'chromium'`). A minimal Linux reproduction showed that the separate headless shell emits opposing cursor-warp movements under pointer lock; full Chromium preserves the intended relative input. This follows [Playwright's browser-channel guidance](https://playwright.dev/docs/browsers#chromium-new-headless-mode). The game and its input assertions do not change between platforms.

Navigation releases real keyboard input after observing movement. Touch swipes use timed intermediate points. Continuous trace screenshots are disabled because WebGL readbacks distort input timing on software-rendered runners; action/DOM/network traces, failure screenshots and the explicitly captured gameplay images remain available.

A navigation probe with 400 ms delayed key releases also passed the original 0.7 m destination tolerance. The driver uses a lateral correction when delayed input would otherwise cause repeated overshoot. CI requires a first-pass success and stops at the first failure to return diagnostics promptly.

The long gather/craft/build journey and environment control journeys select Mobile with 50% resolution scale through Settings on every platform. The first 0.2 Linux run spent roughly seven seconds per UI action at full resolution and exhausted the scenario timeout, without a failed feature assertion. Bounding pixel cost keeps the full WebGL/effect pipeline and gameplay assertions while making these controls practical on GPU-free runners. Desktop rendering cost and full-resolution visual evidence are recorded separately by the benchmark below.

### 0.2 rendering workload

`npm run benchmark` (with the dev server running) imports validated 100-piece camp and storm-coast fixtures through the actual save UI, warms each scene, records 12 samples and captures screenshots. It covers Balanced, Mobile, Low and High with every optional effect enabled. It defaults to installed Chrome with hardware rendering; `npm run benchmark -- http://127.0.0.1:5173 --software` explicitly selects the software baseline. Inspect the recorded GPU string before interpreting FPS. Evidence is written to `.artifacts/benchmark/`.

Measured at 2026-09-13 01:33 UTC with ANGLE Direct3D11 on **NVIDIA GeForce RTX 4070 SUPER**, after moving AO to half resolution and reusing main-pass shadows:

| Scene                                    | Viewport / ratio  | Median / lowest sampled FPS | Total draw calls | Triangles | Geometries / textures |
| ---------------------------------------- | ----------------- | --------------------------- | ---------------- | --------- | --------------------- |
| 100-piece camp, Balanced                 | 1920 × 1080 / 1.0 | 144 / 144                   | 245              | 153,178   | 122 / 4               |
| Same camp, Mobile on desktop GPU         | 915 × 412 / 1.15  | 144 / 144                   | 95               | 75,908    | 54 / 2                |
| Same camp, Low                           | 1920 × 1080 / 0.8 | 144 / 144                   | 88               | 66,834    | 52 / 2                |
| Same camp, High + all enhanced effects   | 1920 × 1080 / 1.0 | 144 / 144                   | 671              | 467,053   | 131 / 24              |
| Storm coast, High + all enhanced effects | 1920 × 1080 / 1.0 | 144 / 144                   | 677              | 522,701   | 121–123 / 24          |

All five are **display limited** measurements, not GPU ceilings. No scene reported a browser exception or shader compilation error. Texture counts stayed stable; storm-coast geometry varied as wildlife entered visibility. Counters now include shadow, reflection and all post passes, so draw/triangle totals are not directly comparable to the foundation's color-pass-only ledger. The mobile row is emulation on a desktop GPU, **not a Galaxy S25 result**. Short sampling does not replace a warm physical-device soak.

The [recorded benchmark JSON](benchmark-0.2.json) preserves GPU, viewport, settings, resource counts and error arrays for this run. Selected screenshots are included in the [rendering guide](rendering-and-world.md).

## Physical hardware gates

The available development desktop reports an RTX 4070 SUPER. This is **not** an RTX 3000 or an S25 measurement. Browser mobile emulation checks touch mechanics and layout only.

Human device QA should record browser version, exact GPU/phone, viewport, preset, overlay FPS/draw calls, and a 15-minute warm run including shoreline, dense trees, a 100-piece camp, wildlife, night, storms, crafting, tab suspension and reconnect. Targets: stable 60 FPS on an **RTX 3070 Ti** at 1080p Balanced, then profile optional effects individually; stable 30+ FPS on **Galaxy S25** Mobile after warming. Test Low on representative older hardware as well. These are design targets until measured.

## Current limits

- Cooperative shared world; no PvP, verified accounts, moderation, normal-play building demolition, doors/roofs, storage containers, or technology tree yet. Developer removal is available in sandbox worlds.
- Remote snapshots are 10 Hz. Camera and wildlife interpolate; remote survivor interpolation and client prediction remain future work. Internet latency is therefore visible in movement.
- Weather is visual/environmental; temperature, slippery surfaces and weather-driven needs are future work. Ocean waves do not displace gameplay physics. Advanced rendering limitations and deferred techniques are listed in the [feature matrix](rendering-and-world.md).
- Server limit: 16 simultaneous clients, 512 registered survivors, 512 building pieces. This is a single-process SQLite deployment.
- The world is a finite island, with chunk culling and optional GPU-buffer residency rather than unbounded world streaming.
- Saves are origin-local, with one active solo slot and a previous healthy backup. Export before changing browser/device or clearing site data.
- The local Docker daemon is not running; the image build/restart verification was executed successfully in GitHub CI.
- Production Vercel publication and real hardware performance are not claimed by the static build alone.

## Reproduction commands

```sh
npm run check
npm run test:e2e
npm run format:check
npm run benchmark:rendering # dev server + installed Chrome; -- --software for SwiftShader
```

For browser failures, inspect the retained Playwright trace and screenshot. Unit fixtures may construct domain state; browser tests navigate with real mouse, keyboard and touch input and read diagnostics without mutating the game.
