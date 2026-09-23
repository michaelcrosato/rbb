# Testing and verification

Use Node 24 and the checked-in npm lockfile. On a fresh checkout:

```sh
npm ci
npm run test:install
npm run check
npm run test:e2e
npm run format:check
```

`test:install` installs the Chromium revision required by the pinned Playwright version, including Linux system dependencies. Run it again after a Playwright update. No global test packages, credentials, saved worlds or external backend are required. The dedicated server and persistence tests use Node 24's built-in SQLite.

## Available checks

| Command                                                | What it verifies / produces                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                        | TypeScript, architectural ESLint rules, Vitest unit/integration tests, Vite client build and esbuild server build               |
| `npm run test:coverage`                                | V8 unit/integration coverage for **all** TypeScript under `src`, `server` and `api`; HTML, LCOV and JSON summary in `coverage/` |
| `npm run test:e2e`                                     | Desktop and emulated touch Chromium journeys with real input and WebGL                                                          |
| `npm run test:watch`                                   | Interactive Vitest development loop                                                                                             |
| `npm run format:check`                                 | Repository formatting                                                                                                           |
| `npm audit`                                            | Known vulnerabilities in runtime and development dependencies at the time of the request                                        |
| `npm run benchmark -- http://127.0.0.1:5173`           | Reproducible camp/coast workload on installed Chrome; requires a running dev server                                             |
| `npm run benchmark:rendering -- http://127.0.0.1:5173` | Per-effect measurements and comparison images; requires a running dev server and installed Chrome                               |

Both benchmarks accept `--software` for an explicit software-rendering baseline. They write to `.artifacts/`. Emulated touch viewports and SwiftShader results do not establish physical phone or target-GPU performance. See [QA](qa.md) for hardware gates.

CI enables coverage during its existing `npm run check` run and uploads `unit-integration-coverage`; it does not run the unit suite twice. The coverage denominator includes client UI and GPU code that is primarily exercised by Playwright. These percentages measure the unit/integration suite only; they are not combined browser coverage or a claim that an unexecuted branch is safe. Review missing branches alongside gameplay invariants and the browser journeys. No arbitrary percentage threshold replaces those checks.

## Browser setup and isolation

Playwright starts a Vite client and a separate temporary world fixture. Defaults are client port **5173** and fixture port **8788**. If another project uses 5173:

```powershell
$env:RBB_TEST_PORT = '5174'
npm run test:e2e
```

On a POSIX shell, use `RBB_TEST_PORT=5174 npm run test:e2e`. A running RBB dev server on that client port can be reused locally; stop any unrelated application first. The world fixture must own port 8788 and is never reused, so tests cannot mutate an existing persistent world. Several multiplayer tests also create their own temporary databases and ephemeral server ports.

The suite uses full Chromium headless mode (`channel: 'chromium'`) for native pointer-lock input, one worker per suite, and zero retries. On Windows the fixtures refuse pointer lock instead: Chromium implements it there with the global Win32 ClipCursor, which would trap the real mouse cursor in the headless viewport's screen rectangle. Those runs exercise drag-to-look; captured-mouse look is covered on Linux/CI. GitHub runs the seven browser files in separate jobs, plus a Docker build/readiness/restart test. The final `verify` job requires all code, browser and container jobs to succeed.

Import `test` and `expect` from `tests/e2e/fixtures.ts` in browser specs. Its automatic fixture fails on browser exceptions, console errors and WebGL validation messages. Use the `newContext` fixture for extra survivors; it monitors every page, including popups, and retains errors after a context closes. Do not instantiate unmonitored contexts through `browser.newContext` or `browser.newPage` in a spec; ESLint rejects both. Wait for the visible HUD after opening a session before sending gameplay input.

Domain tests can construct state and issue typed commands. Browser tests use visible controls and public save import for fixtures. `window.rbbDiagnostics()` is a development-only, read-only copy of state and rendering statistics; never add hidden gameplay mutators to make a test pass. Remote-session unit tests use fake sockets and clocks to cover malformed messages, handshake timeout, retry schedules, stale callbacks, resume credentials and input ordering without real-time sleeps.

## Investigating failures

```sh
npm test -- tests/unit/session.test.ts
npm run test:e2e -- tests/e2e/game.spec.ts
npm exec playwright -- show-report
npm exec playwright -- show-trace test-results/<scenario>/trace.zip
```

Inspect `test-results/` and `playwright-report/` for error context, failure screenshots, explicit gameplay images and retained traces. Continuous trace screenshots are disabled to avoid distorting input timing with WebGL readbacks. Some multi-scene suites also omit continuous DOM snapshots; actions, sources and explicit images remain. The shared fixture attaches `browser-errors` when it finds a runtime problem. Fix the cause before rerunning; keep assertions, tolerances and timeouts meaningful.

For release verification, run the production client and world server, then verify the GitHub checks and the actual deployed menu, solo controls, reload/continue and `/api/health`. A local build alone does not prove that a hosted runtime works.
