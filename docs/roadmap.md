# Alpha delivery and iteration

## Foundation acceptance

- [x] Current stable Three.js, reproducible TypeScript build and public GitHub repository.
- [x] Attractive seeded island, collision, first-person movement, touch controls, quality settings.
- [x] Gather, craft, build, survival, wildlife, death/respawn and milestones.
- [x] Validated solo persistence, backup/recovery and save export/import.
- [x] Playable authoritative multiplayer, reconnect, disk persistence and abuse limits.
- [x] Unit, integration, browser, mobile-layout and soak verification; CI and contributor guidance.
- [x] Vercel-ready static client and documented container server deployment.

Acceptance evidence and measured limits are recorded in [QA](qa.md). Physical RTX 3000/S25 testing, human balance feedback and production publication remain follow-up work; the static client and persistent server are ready for those steps.

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

## Subsequent iterations

Human QA should set priorities after this foundation. Candidate systems: modular building interiors/doors, storage permissions, dedicated-server accounts, PvP and combat balance, tool durability, technology trees, farming, cooking queues, temperature/weather gameplay, more complex animal ecology, spatial interest management, client prediction/reconciliation, world sharding and moderation. Expensive rendering techniques such as ray tracing and volumetric clouds can wait for measured need and mature examples.
