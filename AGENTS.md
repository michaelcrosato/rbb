# RBB contributor instructions

RBB is an AI-authored, human-directed survival-game alpha. Keep it easy to extend.

- Read `README.md`, `docs/architecture.md`, and the relevant subsystem before changing behavior.
- Use Node 24 and the checked-in npm lockfile. Run `npm ci` on a fresh checkout.
- Check `git status` first. Never overwrite unrelated changes or commit secrets or saves.
- `src/shared` is deterministic, renderer-free game logic. It must run unchanged on client and server.
- New gameplay uses typed commands and the shared simulation. Never trust client-supplied inventory, positions, rewards, or damage on the server.
- Content and balance belong in `src/shared/content.ts`, not the UI or renderer.
- Keep render objects out of save files. Version and validate saves and network messages.
- Test gameplay invariants, failure cases, and persistence. Browser tests must exercise real controls and WebGL rendering; test hooks must remain read-only.
- Run `npm run check` and `npm run test:e2e` for gameplay/infrastructure changes. For visual changes, start the dev server, inspect desktop and mobile screenshots, and check browser errors.
- Record material limitations honestly in `docs/qa.md`. Browser emulation is not physical RTX/S25 performance evidence.
- Keep `docs/roadmap.md` current; do not describe future features as implemented.
- For Codex CLI updates on this machine, use the standalone Windows installer from the global instructions, never the npm global package.
