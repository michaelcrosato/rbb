# Deployment and operations

## Vercel client

1. Import `michaelcrosato/rbb` into Vercel with project root `/` and Node 24. `vercel.json` selects Vite, runs the typecheck and client build, and serves `dist`.
2. Solo needs no environment variables. To prefill your shared server, set the public build variable `VITE_SERVER_URL=wss://world.example.com` and redeploy.
3. Verify the menu, start an expedition, gather flax, open the pack, refresh and continue. Verify `/api/health` returns client version/protocol JSON.
4. The host automatically provides HTTPS. Online connections from HTTPS must use WSS. The server's `ALLOWED_ORIGINS` must include the exact client origin, without a trailing slash. Add preview origins deliberately; do not accept arbitrary suffix matches.

Vite's static output is also portable to other static hosts. The optional `/api/health` function is Vercel-specific; solo gameplay does not depend on it. Do not place secrets in any `VITE_*` variable.

## Persistent world process

```sh
npm ci
npm run build:server
# Set ALLOWED_ORIGINS, DATA_DIR and optionally WORLD_SEED in the process environment.
npm run start:server
```

| Variable          | Default                       | Meaning                                                                    |
| ----------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `PORT`            | `8787`                        | HTTP/WebSocket listening port                                              |
| `HOST`            | `0.0.0.0`                     | Bind address                                                               |
| `DATA_DIR`        | `./data`                      | Persistent directory containing SQLite and WAL files                       |
| `WORLD_SEED`      | `quiet-frontier` for a new DB | Existing worlds reject a conflicting seed                                  |
| `ALLOWED_ORIGINS` | Local development origins     | Comma-separated exact browser origins; required with `NODE_ENV=production` |
| `ALLOW_DEV_TOOLS` | `false`                       | Exactly `true` enables shared developer mutations for every joined tester  |

The Node process reads environment variables directly. It does not automatically load `.env` files. Set shell/service variables, or use Node's `--env-file` flag with a task-specific file if needed. Compose reads `.env` for its variable substitution. No credentials are needed to start the server.

For a trusted developer world, set `ALLOW_DEV_TOOLS=true` and use a separate `DATA_DIR`, for example `./data-playtest`. This is a whole-server capability, not an authenticated administrator role: every joined client can change tuning, travel, spawn or remove entities and grant items through the visible tools. The world is marked as a sandbox after mutation. A normal server refuses a saved sandbox world; restore a normal backup or explicitly enable test mode. Device-local graphics controls remain available when developer mutations are disabled.

Version 0.2 uses network protocol 2. Upgrade the static client and dedicated server together. Save v1 migrates to v2 while preserving the existing island and progress; take the normal stopped-server backup before upgrading a persistent deployment.

`docker compose up --build -d` starts a world using the persistent `world-data` volume. Put a TLS reverse proxy in front of port 8787. Configure WebSocket upgrades, a sufficiently long idle timeout, and sensible connection limits. Only trust your own reverse proxy if adding forwarded-IP handling; the current limiter uses the TCP peer address and intentionally ignores user-supplied forwarded headers. Behind a proxy this groups users into one connection bucket; tune or extend trusted-proxy handling before a larger public launch.

`GET /health` returns readiness, protocol, player count, capacity, tick, save time, uptime, and rejected-message count. It contains no credentials. Stop via SIGTERM/SIGINT to save and close connections cleanly. Store failures pause simulation and disconnect clients rather than continuing unsaved progress. A process restart loads the latest valid snapshot and clears held inputs.

## Backups and recovery

- Keep `DATA_DIR` on durable storage. Never put it in Git, Vercel build output, or a disposable container layer.
- Snapshots save every five seconds and on join, disconnect and orderly shutdown. A hard kill can lose up to that interval; current and prior snapshots are checksum- and schema-validated.
- For a filesystem backup, **stop the server cleanly first**, then copy the entire data directory to protected backup storage. Alternatively use SQLite's online backup tooling. Copying only the live `.db` file can omit WAL changes.
- Restore into a separate directory and start against it before replacing the live volume. If both snapshots are invalid, startup fails without regenerating the world.
- Browser saves have independent device-local recovery. Export before clearing browser data or changing origin. A new expedition/import deliberately replaces the active slot while keeping a previous healthy backup.

## Topology and security boundary

One process owns a world and its SQLite database. Do not scale this service horizontally or mount one SQLite database across machines. The client is distributable; the authoritative simulation is not yet a distributed service. Maximum active clients: 16. Maximum registered survivors: 512. Maximum building pieces: 512. The registry cap bounds anonymous-session storage growth; rotating worlds needs a new data directory.

Guest sessions use 256-bit random bearer tokens. Only token hashes are stored server-side; browsers retain their own resume token. A token proves ownership of a survivor, not a verified human identity. Treat it like a password: do not paste it into issues or logs. Production accounts, token revocation UX, moderation, and public-PvP anti-cheat are future work. Origin checks supplement schema/rate validation; they do not authenticate native clients.

Vercel Functions currently support WebSockets, with connections pinned to finite-lived instances and future connections potentially routed elsewhere. This alpha requires stable world ownership and durable disk, so deploy its persistent process separately. Moving the simulation to Functions would require a durable world coordinator, external state, and explicit ownership/failover handling. [Vercel WebSocket guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).
