# Adding systems without tangling the engine

## Item or recipe

1. Add a stable ID to `ITEMS` in `src/shared/content.ts` with a name, description, weight, icon and color. IDs persist in saves; rename them only with an explicit migration. If the item is eaten or applied, add its vitals to `CONSUMABLES`; the simulation, pack UI and F key derive usability from that entry.
2. Add a `RECIPES` entry with `cost`, `output`, category and optional `campfire`, `furnace` or `workbench` station. Costs are quantities of registered items and a misspelled ID fails to compile. `shared/crafting.ts` scales batches and checks station reach/visibility, costs and resulting capacity atomically for server and solo.
3. Add an icon/model if the existing ones do not fit. UI recipes and inventory entries derive from the registry.
4. Test insufficient cost, capacity, station range, duplicate requests, and save round-trip. Never award inventory from a UI handler.

## Building piece

Add its content entry, solids in `shared/structure-geometry.ts`, and placement/support rules in `shared/building.ts`. Rendering in `render/models.ts`, movement, rays, placement and terrain protection consume those shared solids; add decoration without changing the usable openings. Construct state with `createBuilding`, which initializes grade, health, door state, contents and support. `shared/structures.ts` owns repair/upgrade, storage and collapse. The preview and authoritative command use the same placement calculation. Check all four rotations, open/closed doors, stairs/ceilings, player/resource overlap, wet/steep terrain, cost rollback, parent removal and restored saves. Keep instancing by kind/grade/open variant.

## Tools, weapons and equipment

Add gathering families/strength to `TOOLS`, damage/range/cooldown/ammunition to `WEAPONS`, and worn slots/capacity/resistance to `EQUIPMENT`. Use `carryCapacity(player)` wherever a transaction can add items. Removing or transferring equipment must run `canRemoveItems` and `normalizeEquipment`; an equipped pack cannot disappear while its extra capacity is needed. Combat chooses hits on the server from the survivor's validated look direction and geometry. New damage sources must deliberately specify whether armor applies. Test ammo misses, obstructions, cooldowns, unowned gear, capacity removal and persistence.

## Loot areas and transfer paths

Add stable site IDs and loot/restock definitions to `SITE_TYPES`, with deterministic placement and shared prop solids in `site-generation.ts`. Site locations, render props, collision and map entries derive from the same definitions. Quarry mineral yields/health/regrowth belong in `RESOURCE_TYPES`. Preserve the existing generation stream; test multiple seeds, dry separated destinations and node counts, plus migrations around existing edits and bases. Changing generated IDs/geometry needs a compatibility plan for existing saves.

Use `transferInventory` for containers and `transfers.ts` for ground supplies. Validate count, range, vertical separation, visibility, expiry and capacity before moving any item. Partial collection leaves the remainder in its source. Contested commands execute serially in the shared simulation. Never copy a full entity into a loot bag; persist only its position, inventory, owner, ID and expiry. Cover full ground-bag limits and failure paths so destruction or death cannot lose supplies.

## New simulation system

Keep data serializable. Extend the typed command schema only for player intent, then validate and execute it in the simulation. Advance time from the fixed tick, never `Date.now()` in domain logic. Emit typed events for feedback, audio and future progression rather than calling client code. Update runtime save validation before persisting new fields. Unknown save/world versions must fail explicitly until a tested migration exists.

For complex additions, split systems out of `Simulation` by ownership: combat, crafting, building, metabolism, etc. The simulation remains the transaction boundary; rendering and network transport remain adapters. Avoid a general-purpose ECS or plug-in loader until concrete entity/system growth justifies one.

## Terrain systems

Use `shared/terrain.ts` for field queries and brush planning, and `shared/earthworks.ts` for validated gameplay transactions. Never use the generated heightfield alone for live collision, cave placement or interaction visibility. Keep density semantics and mesh interpolation identical. Terrain bounds, migration requirements and command ownership are documented in [the terrain guide](terrain.md).

## Networking

`clientMessageSchema` rejects unknown fields, invalid numbers and content IDs. Extend protocol versions deliberately when old clients cannot interpret new snapshots. Every new command needs server tests for authority and replay behavior. Avoid sending private state about other players. Remote camera smoothing is present; client prediction/reconciliation and interpolated remote actors should be added with network impairment tests before faster combat.

## AI iteration workflow

Read the current worktree and contributor instructions, implement one coherent slice, test domain invariants headlessly, then run the actual browser flow. Use `window.rbbDiagnostics()` only as observation. Capture screenshots and traces when verification fails. Keep balance decisions and unresolved physical-device QA visible. Do not lower acceptance tests simply to turn CI green.
