# RBB · The quiet frontier

A low-poly survival sandbox built on **Three.js r186**, TypeScript, and a deterministic simulation shared by browser and server. AI authors the implementation; humans direct features, playtest, and tune the balance.

Explore a seeded island, gather materials, craft better tools, build a camp, and survive. Start a solo expedition immediately or connect to a persistent cooperative world. This is an expandable foundation alpha, not a complete Rust clone.

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
| Mouse          | Look; double-click the world to capture if needed     |
| Shift / Space  | Sprint / jump                                         |
| E / left mouse | Gather, attack, collect, or place a building          |
| Tab / I        | Pack and crafting                                     |
| 1–5            | Equip river stone, hatchet, pickaxe, berries, bandage |
| B / 6          | Building menu; B cancels placement                    |
| R              | Rotate building                                       |
| F              | Use equipped consumable, or eat a berry               |
| M / Esc        | Map / pause                                           |

Touch has a movement stick, drag-to-look, sprint, jump, use, eat, rotate, pack, and map controls. Landscape offers more room. Solo pauses in menus; shared worlds continue running. Disconnected survivors stop simulating. Empty servers pause world time.

Haven meadow has guaranteed wood, stone, flax, berries, and a freshwater spring on every seed. A hatchet costs 12 wood, 8 stone, 3 fiber. A foundation costs 24 wood and 12 stone. Walls attach to foundation edges; campfires unlock nearby cooking and healing; bedrolls set respawn. Boars defend their territory. Death leaves a supply pack for 30 world minutes.

## What is implemented

- 640 × 640 m seeded heightfield with matching triangle collision, spatial resource queries, chunk culling, instanced foliage and buildings, low-poly models, ocean, day/night lighting, and adaptive resolution with recovery.
- Fixed 30 Hz simulation, movement/jump/swim, stamina, hunger/thirst, resource depletion/regrowth, bounded inventories, atomic recipes, building validation, boar combat, cooking, healing, death/respawn, and persisted milestones.
- Versioned solo saves with schema validation, previous-save recovery, export/import, and explicit storage failure messages.
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

Tests use temporary databases. Browser test artifacts are in `test-results/` and `playwright-report/`; neither is committed. Development builds expose `window.rbbDiagnostics()`, which returns **read-only copies** for AI navigation and bug reports. Tests do not inject inventory, teleport players, or call hidden gameplay commands.

Start with [architecture](docs/architecture.md), [adding content](docs/adding-content.md), [QA and limits](docs/qa.md), and the [roadmap](docs/roadmap.md). Read [AGENTS.md](AGENTS.md) before editing.

## Hosting and hardware

Import this repository into Vercel; the checked-in configuration builds the static Vite client. Solo works without a backend. The persistent world server has a Dockerfile and Compose configuration and needs one process plus persistent storage per world. Do not run multiple replicas against one world database.

The design targets RTX 3000-class desktops and Galaxy S25-class phones through adjustable resolution, a mobile preset, no required postprocessing, and low draw-call models. Emulated mobile tests verify controls and layout; they do not prove physical S25 frame rate, battery use, or thermal performance. Recorded evidence and remaining hardware QA live in [docs/qa.md](docs/qa.md).

Current scope is a small cooperative alpha. PvP, accounts, doors/roofs, storage containers, durability, research trees, production moderation, distributed world ownership, and client prediction are future work. All geometry and sounds are procedural; fonts are bundled locally. Dependencies retain their own licenses. RBB code is MIT licensed.
