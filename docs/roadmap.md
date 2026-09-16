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

## Engineering follow-ups from the 2026-09-14 audit

Verified by reading the code, deferred because each needs browser or hardware evidence before it is clearly worth its risk:

- Solo saves have no cross-tab guard; two tabs autosaving the same origin overwrite each other and the backup slot. Use `navigator.locks` or `storage` events to stop the second tab's autosave with a message.
- `session.ts` hand-mirrors `Snapshot` in its own zod schema. Move a server-message schema next to `clientMessageSchema` and infer the types from it.
- `game.ts` is orchestrator, settings store, form reader, importer and overlay renderer, and `UI` keeps shadow copies of mode and player state. Extract a settings store and typed form readers before adding settings.
- `PostEffects.configure` disposes the whole post graph on any graphics change, including exposure or view distance. Rebuild only when a key the graph consumes changes; apply scalars as uniform updates. GTAO still rasterizes its own normal pre-pass although the shared depth/normal buffers exist.
- `renderer.ts` owns culling tables, collision-debug geometry, actor interpolation, camp lights and auto-quality. Split by ownership, and derive the height-map encoding constants in the water, buffer and fog shaders from `WORLD_HALF`/`WORLD_SIZE`.
- Browser suites capture errors with three different strictness levels; share one fixture with the WebGL regex, and replace the remaining fixed-sleep movement assertions with condition waits. `RemoteSession` reconnect and backoff have no fake-socket unit test.
- Snapshots are full state at 10 Hz per client (about 47 KB each with a 400-piece camp). Interest management or deltas come before larger worlds or player counts.

## Subsequent iterations

Human QA should set priorities after this foundation. Candidate systems: modular building interiors/doors, storage permissions, dedicated-server accounts, PvP and combat balance, tool durability, technology trees, farming, cooking queues, temperature/weather gameplay, more complex animal ecology, spatial interest management, client prediction/reconciliation, world sharding and moderation. Hardware ray tracing can wait for measured need and mature examples.
