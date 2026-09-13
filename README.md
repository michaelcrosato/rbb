# RBB · The quiet frontier

[![Alpha checks](https://github.com/michaelcrosato/rbb/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/michaelcrosato/rbb/actions/workflows/ci.yml)

A low-poly survival sandbox built on **Three.js r186**, TypeScript, and a deterministic simulation shared by browser and server. AI authors the implementation; humans direct features, playtest, and tune the balance.

Explore a seeded island, gather materials, craft better tools, build a camp, and survive. Start a solo expedition immediately or connect to a persistent cooperative world. This is an expandable foundation alpha, not a complete Rust clone.

![The running 0.2 alpha: faceted coastal pines and their optional water reflections](docs/images/coastal-reflections.png)

## Run locally

Install **Node 24** (see `.nvmrc`), then:

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. No account, assets service, database, or environment variables are needed for solo play. The game saves on the current browser origin; use **Pause → Export save** to keep a portable backup or move between localhost and a hosted deployment.

For a shared world, run this in another terminal:

```sh
npm run dev:server
```

Choose **Join a world**, enter `ws://localhost:8787`, and join. The server creates `data/world.db`. Other clients on your LAN need the host's address and their exact browser origin listed in `ALLOWED_ORIGINS`. Production clients use HTTPS and `wss://`. See [deployment](docs/deployment.md).

## Play

| Control        | Action                                                |
| -------------- | ----------------------------------------------------- |
| WASD / arrows  | Move                                                  |
| Mouse          | Look; drag if uncaptured; double-click to capture     |
| Shift / Space  | Sprint / jump                                         |
| C              | Hold to dive; release to surface                      |
| E / left mouse | Gather, attack, collect, or place a building          |
| Tab / I        | Pack and crafting                                     |
| 1–5            | Equip river stone, hatchet, pickaxe, berries, bandage |
| B / 6          | Building menu; B cancels placement                    |
| R              | Rotate building                                       |
| F              | Use equipped consumable, or eat a berry               |
| M / Esc        | Map / pause                                           |
| F2             | Developer tools                                       |

Touch has a movement stick, drag-to-look, sprint, jump, dive, use, eat, rotate, pack, and map controls. Landscape offers more room. Solo pauses in menus; developer tools can run or pause the simulation independently. Shared worlds continue running. Disconnected survivors stop simulating. Empty servers pause world time.

Haven meadow has guaranteed wood, stone, flax, berries, and a freshwater spring on every seed. A hatchet costs 12 wood, 8 stone, 3 fiber. A foundation costs 24 wood and 12 stone. Walls attach to foundation edges; campfires unlock nearby cooking and healing; bedrolls set respawn. Boars defend territory and wolves hunt beyond the starter refuge. Death leaves a supply pack for 30 world minutes. Watch your air when diving.

## What is implemented

- 640 × 640 m seeded heightfield with matching triangle collision, spatial resource queries, chunk culling, instanced foliage/buildings, and adaptive resolution with recovery.
- Moving sun and moon lighting/shadows, dawn/dusk, phased moon, stars, six weather conditions, foliage wind, wetness/snow, ocean waves/reflections/foam, underwater atmosphere, campfire lights and ambient particles. Optional AO, bloom, sun shafts, lens flare, planar coastal reflections and color controls. [Feature matrix and limits](docs/rendering-and-world.md).
- Fixed 30 Hz simulation, movement/jump/swim/dive, oxygen, stamina, hunger/thirst, resource depletion/regrowth, bounded inventories, atomic recipes, building validation, wildlife combat, cooking, healing, death/respawn, and persisted milestones.
- Five land species (boar, deer, wolf, fox, rabbit) and three marine species (fish, turtle, dolphin), habitat-aware movement, threat responses, animation, loot and respawn.
- Quick developer tools, 27 editable world variables, named/importable variations, entity inspection and recoverable solo checkpoints. Online mutations require an explicitly enabled test server.
- Version 2 solo saves with explicit v1 migration, schema validation, previous-save recovery, export/import, and storage failure messages. Network protocol 2 requires matching client/server upgrades.
- Optional authoritative Node/WebSocket server: command validation, replay protection, speed and reach authority, action/payload/connection limits, origin checks, private inventories, guest resume sessions, reconnect backoff, stale-input clearing, slow-client rejection, SQLite WAL snapshots, recovery and health endpoint.
- Reproducible npm toolchain; lint, typecheck, build, simulation/abuse/persistence tests, desktop and touch browser tests, CI artifacts, container setup, and Vercel configuration.

## Develop and verify

```sh
npm run check          # types, lint, unit/integration tests, client + server build
npm exec playwright -- install chromium
npm run test:e2e       # real browser controls, WebGL, saves, multiplayer and touch
npm run format:check
npm run benchmark      # 100-piece camp workload; dev server + installed Chrome required
npm run preview       # serve the production client on :4175
npm run start:server   # run the built world server
```

Tests use temporary databases. Browser test artifacts are in `test-results/` and `playwright-report/`; neither is committed. Development builds expose `window.rbbDiagnostics()`, which returns **read-only copies** for AI navigation and bug reports. Browser tests use real controls, including the visible developer tools when testing sandbox workflows; they do not call hidden gameplay mutators.

Open **F2** or **Pause → Developer tools** to preview time/weather, spawn wildlife, fly, build freely, inspect entities and tune a variation without editing code. A world mutation marks the expedition as a sandbox and captures a solo recovery checkpoint. Normal **Settings → Rendering effects** changes only your device, including on ordinary multiplayer servers.

Start with [architecture](docs/architecture.md), [rendering and developer tools](docs/rendering-and-world.md), [adding content](docs/adding-content.md), [QA and limits](docs/qa.md), and the [roadmap](docs/roadmap.md). Read [AGENTS.md](AGENTS.md) before editing.

## Hosting and hardware

Import this repository into Vercel; the checked-in configuration builds the static Vite client. Solo works without a backend. The persistent world server has a Dockerfile and Compose configuration and needs one process plus persistent storage per world. Do not run multiple replicas against one world database.

The design targets **RTX 3070 Ti** desktops and **Galaxy S25** phones. Auto, Low, Mobile, Balanced and High presets provide adjustable rendering cost; optional effects can be enabled independently. **Low preserves survival rules, wildlife, inventory and progression.** Emulated mobile tests verify controls and layout; they do not prove physical S25 frame rate, battery use, or thermal performance. Recorded evidence and remaining hardware QA live in [docs/qa.md](docs/qa.md).

Current scope is a small cooperative alpha. PvP, accounts, doors/roofs, storage containers, durability, research trees, production moderation, distributed world ownership, and client prediction are future work. All geometry and sounds are procedural; fonts are bundled locally. Dependencies retain their own licenses. RBB code is MIT licensed.
