# Architecture

## Boundaries

`src/shared` owns world generation, registries, state, physics, simulation and the wire protocol. No DOM, Three.js, wall-clock time, filesystem or network dependencies belong here; `npm run lint` rejects such imports and globals, and a unit test replays a scripted session on two simulations to prove they stay identical. Simulation advances at a fixed 30 Hz. Commands express intent; simulation validates range, cost, cooldowns, support and capacity before applying a transaction.

`src/client` owns Three.js presentation, input, audio, UI, transports and browser persistence. Solo mode and the dedicated server run the same simulation. Rendering runs independently of simulation and smooths the camera toward fixed-step or authoritative snapshots. Content IDs and stable world entity IDs join these layers. Foliage uses spatial instance batches; buildings share instance batches by piece type so adding a large camp does not add one draw call per piece.

`server` owns WebSocket sessions, authoritative ticks, payload/origin/rate limits, private resume credentials, SQLite snapshots and health checks. A session controls one player. Normal gameplay commands never send inventory or player position. Explicit developer commands can request bounded grants/travel only when the host enables the test-world capability; ordinary servers reject them before mutation. The server sends only the local player's private inventory, plus public player appearances and shared world mutations.

## World

The seeded island retains generation version 1 and adds a versioned sparse volumetric terrain layer. Metre-lattice density samples support caves, overhangs and fill. Shared tetrahedral interpolation, surface queries and polygonization keep collision and visuals aligned; unedited land keeps its original triangles. Vegetation and mineral locations are deterministic. Terrain is chunked and repeated props are instanced. Only changed terrain samples and entity mutations need persistence; generated terrain and resource definitions are rebuilt from the seed. Terrain operations prepare a patch, validate occupancy/support and material costs, then commit atomically. See [terrain architecture and controls](terrain.md). World generation has its own version so an engine update cannot silently move an existing save's land.

## Hosting

The Vite client is static and can be hosted on Vercel. The optional Node 24 world server is a separate process with a persistent disk. Vercel Functions now support WebSockets, but connections have finite instance lifetimes and new connections need not reach the same instance. This alpha uses a single authoritative process per world; running it as an ephemeral Function without world ownership and distributed storage would lose that guarantee. See `docs/deployment.md` for the supported topology.

## Extension seams

`shared/environment.ts` owns a separate sky clock, weather transitions and validated world tuning. Monotonic simulation time continues to govern survival and expiry. `shared/wildlife.ts` uses the content registry for species, habitat, navigation, threats and respawn. Save v3 explicitly migrates v1 and v2 without changing world generation; protocol v3 broadcasts terrain baselines/revision patches alongside shared environment/tuning and the host's developer capability.

Rendering is divided into atmosphere, surfaces/ocean, wildlife models, optional post effects and bounded ambient particles. Low quality affects only this presentation layer. Optional render targets are disposed when disabled. Statistics count every render pass, including shadow and offscreen passes. Camera, wildlife and remote survivor motion are smoothed toward authoritative samples at render rate; survivor respawns and large corrections snap into place. Client prediction and buffered snapshot interpolation remain future work.

Cooperative worlds admit at most four active survivors. The server bounds pending sockets independently and rejects overflow before allocating a survivor or resume token. Guest resume tokens live in tab storage as well as the browser's default slot, so separate survivors in open tabs retain their identities on reload. Invite URLs carry only a server address and require an explicit join. Crew UI and map markers consume the same public survivor snapshots as the renderer; no remote private inventories are sent.

The [advanced rendering graph](rendering-pipeline.md) owns shared depth/normal/motion attachments and native temporal history. `FrameState` owns camera jitter/invalidation; named material hooks compose foliage, cascades and spatial irradiance probes. Probes use bounded raster captures and asynchronous SH extraction. GPU visibility queries consume shared depth without waiting; chunk residency releases only unused GPU buffers and retains canonical CPU objects. Graphics settings, resource ownership and capability fallbacks stay client-local. Context restoration rebuilds the optional graph and leaves the player in the pause menu; online transport remains connected.

`client/developer.ts` coordinates visible playtest workflows, validated variation JSON and solo recovery checkpoints. `shared/developer.ts` validates and applies mutations after the simulation checks host authorization. A successful developer world mutation sets the persisted sandbox flag. Normal player terrain edits use the same authoritative validation with pickaxe, dirt, reach and cooldown rules, and do not set that flag. Rendering controls are device-local and never set that flag.

Add items/recipes/build pieces in the content registry; add commands and their validation in the shared protocol/simulation; add render models by content ID. Progression uses persisted milestone counters. New systems should consume simulation events instead of reaching into the UI. Persist only serializable domain state. Save migrations are explicit and covered by fixtures. Tests can construct worlds and issue commands without a GPU.
