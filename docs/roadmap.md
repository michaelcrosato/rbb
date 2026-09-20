# Alpha delivery and iteration

## Foundation acceptance

- [x] Current stable Three.js, reproducible TypeScript build and public GitHub repository.
- [x] Attractive seeded island, collision, first-person movement, touch controls, quality settings.
- [x] Gather, craft, build, survival, wildlife, death/respawn and milestones.
- [x] Validated solo persistence, backup/recovery and save export/import.
- [x] Playable authoritative multiplayer, reconnect, disk persistence and abuse limits.
- [x] Unit, integration, browser, mobile-layout and soak verification; CI and contributor guidance.
- [x] Published Vercel static client and documented container server deployment.

Acceptance evidence and measured limits are recorded in [QA](qa.md). The [solo client is live](https://rbb-nine.vercel.app). Physical RTX 3000/S25 testing, human balance feedback and public persistent-world hosting remain follow-up work.

## Living-world foundation · 0.2

- [x] Continuous sun/moon, shadows, dawn/dusk, moon phases/size-driven lighting and stars.
- [x] Six weather states, transitions, wind, rain/snow, wet/snowy ground and storm atmosphere/audio.
- [x] Ocean waves, foam, underwater effects/diving and optional actual coastal reflections.
- [x] Independent AO/bloom/sun shafts/lens flare/grade controls, camp lighting, dust/fireflies/embers.
- [x] Explicit Low preset with unchanged survival rules, populations and progression.
- [x] Quick developer panel, advanced tuning, variation presets/import/export, inspector and recovery checkpoints.
- [x] Five land and three marine wildlife species; habitat, threats, loot, respawn and animation.
- [x] Save v1 migration, protocol v2 and opt-in trusted test servers.

The [rendering matrix](rendering-and-world.md) records implemented effects and deferred techniques. Physical RTX 3070 Ti/S25 profiling remains the next evidence gate; optional effects are not a claim of target-device frame rate.

## Advanced rendering foundation · 0.3

- [x] Independent, default-off cascades, volume clouds/fog, diffuse probes, SSR, temporal upscaling, motion blur and depth of field.
- [x] Shared depth/normal/motion buffers, history invalidation, material adapters and capability fallbacks.
- [x] Asynchronous GPU timing, conservative visibility queries and finite-island GPU buffer residency/reload.
- [x] Expanded [implementation guide](rendering-pipeline.md), comparison workload and lifecycle/Low-parity browser coverage.

These implementations have bounded budgets and documented quality limits. Physical-device profiling, probe visibility/vertical layers, cloud-to-ground shadows, stronger temporal masks/reconstruction and larger-world streaming remain follow-up work.

## Four-player co-op

- [x] Four simultaneous authoritative survivors, bounded handshakes and explicit full-world rejection.
- [x] Shareable server invites, remembered join details, live crew roster and teammate map markers.
- [x] Render-rate remote survivor smoothing and per-tab survivor resume storage.
- [x] Concurrent join/contention integration tests and four-browser gameplay, overflow, shared camp, same-browser identity and touch-layout coverage in CI.

Player-hosted browser sessions, automatic relays/server discovery, reserved reconnect slots, chat and client prediction remain future work. A running persistent world server is required; the hosting walkthrough covers localhost, LAN and a public WSS deployment.

## Editable terrain foundation

- [x] Sparse volumetric terrain preserving seeded islands; pits, overhangs, cave floors/ceilings and fill.
- [x] Player pickaxe excavation, dirt deposition and flattening through authoritative commands.
- [x] Developer sphere/box brushes, numeric placement, strength, smoothing, restoration and whole-world checkpoints.
- [x] Terrain-aware collision, resource displacement, wildlife, line of sight and underground building placement.
- [x] Save v3 migrations and protocol 3 terrain baselines/deltas with bounded edit capacity.
- [x] Desktop/mobile regression run and final QA audit, with finite terrain, persistence and presentation limits recorded in [QA](qa.md#editable-terrain--2026-09-19).

[Terrain architecture, controls and limits](terrain.md). Subsequent terrain extensions include separate materials, flowing water and sealed water volumes, structural collapse if desired, larger-world streaming, and more complete underground weather/lighting isolation.

## Frontier progression expansion

- [x] Chosen-quantity ground drops, partial pickup, cooperative sharing and restart-safe item accounting.
- [x] Three map-tracked salvage landmarks with deterministic shared loot and persistent restock cycles.
- [x] Stone, iron and sulfur quarries with six rich nodes each and improved gathering tools.
- [x] Timber/stone/metal structure grades, repair, wildlife damage, support collapse and protected storage recovery.
- [x] Doorways, working doors, windows, upper floors, stairwell floors, roofs, stairs, fences, shared chests, workbenches and furnaces.
- [x] 33 items and 23 recipes, batches and station checks, hunting weapons/ammunition, worn vest/pack and configurable quick slots.
- [x] Save v4 migration and protocol 4, modular shared systems, authoritative server coverage and desktop/touch gameplay journeys.

[Controls, module ownership and bounds](progression-expansion.md). Storage permissions, queued crafting, weapon/tool wear, magazine/reload mechanics, projectile ballistics, more landmark layouts and human balance testing remain follow-up work. Published revisions are tracked in GitHub deployments; see [QA](qa.md) for verification evidence.

## Repository audit · 2026-09-19

- [x] Protect active solo saves across tabs on HTTPS/localhost, reject stale writes, recover a missing primary slot from a valid backup, and reload fresh state when continuing.
- [x] Move server-message schemas beside command schemas; infer wire types and test reconnect, stale callbacks, malformed data and offline input with fake sockets/clocks.
- [x] Preserve post-processing targets on scalar/device setting changes and retain unchanged sun shadow maps; cover graph reuse and disposal.
- [x] Unify browser exception/console/WebGL checks across all pages and survivors, wait for session readiness, and replace fixed movement sleeps with observed state.
- [x] Add pinned V8 coverage tooling, a browser-install command, CI coverage artifacts and a [testing guide](testing.md); isolate the browser world fixture from existing servers.

The [QA ledger](qa.md) records verification results and limitations, including non-secure-origin save fallback and the distinction between unit coverage and browser evidence.

## Remaining engineering follow-ups

Verified by reading the code, deferred because each needs browser or hardware evidence before it is clearly worth its risk:

- `game.ts` is orchestrator, settings store, form reader, importer and overlay renderer, and `UI` keeps shadow copies of mode and player state. Extract a settings store and typed form readers before adding settings.
- GTAO still rasterizes its own normal pre-pass although the shared depth/normal buffers exist. Investigate reuse with visual equivalence and GPU measurements before replacing it.
- `renderer.ts` owns culling tables, collision-debug geometry, actor interpolation, camp lights and auto-quality. Split by ownership, and derive the height-map encoding constants in the water, buffer and fog shaders from `WORLD_HALF`/`WORLD_SIZE`.
- Non-terrain snapshots remain full state at 10 Hz per client (about 47 KB each with a 400-piece camp). Terrain now uses revision patches. General interest management and entity deltas remain prerequisites for larger worlds or player counts.

## Subsequent iterations

Human QA should set priorities after this foundation. Candidate systems: additional building shapes and interiors, storage permissions, dedicated-server accounts, PvP and combat balance, tool durability, technology trees, farming, cooking queues, temperature/weather gameplay, more complex animal ecology, spatial interest management, client prediction/reconciliation, world sharding and moderation. Hardware ray tracing can wait for measured need and mature examples.
