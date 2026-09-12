# Adding systems without tangling the engine

## Item or recipe

1. Add a stable ID to `ITEMS` in `src/shared/content.ts` with a name, description, weight, icon and color. IDs persist in saves; rename them only with an explicit migration.
2. Add a `RECIPES` entry with `cost`, `output` and optional station. Costs are quantities of registered items. Both server and solo use the same atomic inventory transaction.
3. Add an icon/model if the existing ones do not fit. UI recipes and inventory entries derive from the registry.
4. Test insufficient cost, capacity, station range, duplicate requests, and save round-trip. Never award inventory from a UI handler.

## Building piece

Add its content entry, geometry in `render/models.ts`, placement/support rules in `shared/building.ts`, and collision in `shared/physics.ts`. The preview and authoritative command must use the same placement calculation. Check all four rotations, player/resource overlap, wet/steep terrain, cost rollback, and restored saves. Keep merged geometry and instance batches wherever repetition warrants it.

## New simulation system

Keep data serializable. Extend the typed command schema only for player intent, then validate and execute it in the simulation. Advance time from the fixed tick, never `Date.now()` in domain logic. Emit typed events for feedback, audio and future progression rather than calling client code. Update runtime save validation before persisting new fields. Unknown save/world versions must fail explicitly until a tested migration exists.

For complex additions, split systems out of `Simulation` by ownership: combat, crafting, building, metabolism, etc. The simulation remains the transaction boundary; rendering and network transport remain adapters. Avoid a general-purpose ECS or plug-in loader until concrete entity/system growth justifies one.

## Networking

`clientMessageSchema` rejects unknown fields, invalid numbers and content IDs. Extend protocol versions deliberately when old clients cannot interpret new snapshots. Every new command needs server tests for authority and replay behavior. Avoid sending private state about other players. Remote camera smoothing is present; client prediction/reconciliation and interpolated remote actors should be added with network impairment tests before faster combat.

## AI iteration workflow

Read the current worktree and contributor instructions, implement one coherent slice, test domain invariants headlessly, then run the actual browser flow. Use `window.rbbDiagnostics()` only as observation. Capture screenshots and traces when verification fails. Keep balance decisions and unresolved physical-device QA visible. Do not lower acceptance tests simply to turn CI green.
