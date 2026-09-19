# Frontier progression expansion

The six-part 2026-09-19 game-improvement brief is implemented in the shared simulation,
with desktop/touch controls and authoritative co-op. Final verification is recorded below
and in [QA](qa.md#frontier-progression--2026-09-19).

## Play the progression loop

1. **Share supplies.** Open Pack, choose **Details / drop**, enter a quantity (or use one,
   half or all), then drop. Aim at the bag and use E / Use for partial pickup or **Take all
   that fits**. Anyone nearby can collect it; capacity leaves remaining supplies in place.
   Hand-dropped bags expire after 15 world minutes; death bags last 30. Paused worlds do
   not advance expiry. Shared chests hold 240 kg without bag expiry.
2. **Explore for salvage.** Map lists an abandoned camp, depot and lookout plus three
   quarries. Select **Track destination** for distance and cardinal guidance. Find each
   landmark's crate among its ruins. Camps supply provisions/cloth, depots supply machine
   parts and scrap, and lookouts supply hunting provisions/ammunition. Loot is shared,
   finite and restocks only after the crate is emptied and its world-time timer elapses.
3. **Mine and process.** Quarry stone deposits contain 288 stone, iron veins 96 ore and
   sulfur veins 54 sulfur before depletion. Each quarry has four primary and two secondary
   deposits. Stone tools apply three gathering hits; iron tools apply five. A furnace turns
   wood into charcoal, ore into metal and scrap into recycled metal. A workbench produces
   plates, parts, powder, cartridges and advanced equipment. Category filters and batches
   of 1–20 keep recipes manageable; the full cost and resulting capacity are checked atomically.
4. **Equip and hunt.** Craft a spear or bow, then progress to a salvage pistol or hunting
   rifle. Aim at wildlife and use E / left mouse / touch Use. Ranged shots consume an arrow
   or cartridge even on a miss and respect terrain, structures and solid resources. A hide
   vest reduces wildlife damage by 35%; a worn trail pack raises capacity from 60 to 90 kg.
   Gear remains in inventory, and removing the last needed pack is rejected while overloaded.
   Assign any inventory item to one of five quick slots from Details.
5. **Build upward.** Foundations snap to a 4 m grid. R rotates edge walls/windows/doorways
   around the supporting platform; doors fill frames. Floors and roofs need a wall below.
   Pair stairs with a **stairwell floor** of the same rotation for an opening and landing;
   a solid upper floor intentionally blocks the stairs. Build up to four storeys. Furniture
   can sit on dry terrain or a supported platform. A bedroll records respawn.
6. **Reinforce and maintain.** Aim at a piece and use E / Use to inspect its condition.
   Timber has 180 health, stone 450 with 20% damage resistance, and metal 900 with 45%.
   Stone upgrades cost 36 stone + 4 wood; metal upgrades cost 6 plates + 6 ingots. Upgrading
   preserves the current health fraction. Repair adds up to 25% of maximum health per action
   for the displayed materials. Blocked aggressive wildlife can attack a nearby structure.
   Anyone can repair, upgrade, open doors or use chests; owners can dismantle empty pieces
   with no supported children. Dismantling gives no refund.

## Bounds and deliberate limits

There are **33 items, 23 recipes and 15 building pieces**. Content/balance live in one registry.
The world allows 512 pieces, four storeys and 2,048 ground bags. Support is a recorded parent,
not a load-bearing physics solver: destroying that parent collapses descendants. Storage
contents become ground bags; if there is no bag capacity, collapse is refused rather than
losing contents. The same full-pool safeguard retains a dead survivor's inventory on respawn.

This is cooperative hunting with unlocked shared doors/storage. There is no PvP, tool/weapon
wear, locks, technology research, timed crafting queue, magazine reload or projectile travel.
Shots are authoritative rays. Stations require proximity and clear visibility; they consume
recipe inputs immediately. Quarry nodes regrow; crates use 20/30-minute world timers. Sites
use a compact family of procedural ruins/markers, not large authored interiors or dungeons.

Save **v4** migrates saves 1–3, retaining generation-v1 terrain and original resources. An old
base or terrain edit can suppress a conflicting new site and its nodes rather than relocate
the player's work. Such sites are absent from the map. Network **protocol 4** requires matching
client and server versions. Production rollout is verified separately; local automation does
not establish physical RTX 3070 Ti/S25 performance.

## Required player journeys

- [x] Drop a chosen quantity from the pack, see it in the world, and let another survivor
      collect it. Support partial collection, full packs, disappearing/expired drops, death
      bags, shared contention and save/server restart without lost or duplicated items.
- [x] Explore distinct, visible landmarks with map markers and useful shared loot.
      Loot tables supply tools, provisions and equipment/firearm components. Container depletion
      and restocking are deterministic and persistent; distance, sight and capacity are authoritative.
- [x] Gather and process reinforcement materials; upgrade and repair existing structures
      through useful material tiers. Health, damage resistance, costs and rendered materials
      change together. Upgrades preserve structure identity, support and contents.
- [x] Visit multiple marked quarries with substantial stone, ore and mineral deposits.
      Appropriate tools improve extraction. Deposits deplete and recover without duplicating
      resources, invalidating old terrain or granting client-supplied rewards.
- [x] Build complete shelters and useful camps: foundations, walls, doorways and working
      doors, windows, floors/ceilings, roofs, stairs, fences, storage and crafting stations.
      Placement, support, collision, line of sight, occupancy and terrain protection agree.
- [x] Progress from basic gathering to improved tools, melee/ranged weapons and ammunition,
      protective/carrying equipment, processed materials and provisions. Recipes, batches,
      station requirements, equipment effects and combat are usable in ordinary solo and co-op.

The existing cooperative rules remain: these additions do not introduce player-versus-player
damage. Weapons must work against wildlife, and reinforcement must have gameplay effects.

## Module boundaries

- `content.ts`: item, recipe, station, weapon/tool, equipment, building, grade, site/loot and
  quarry definitions and balance. New content should primarily require registry entries.
- Shared inventory/transfer rules: validated quantities and atomic two-sided transfers;
  carrying capacity and equipment restrictions are applied consistently.
- Shared site generation/loot rules: stable seeded IDs and layouts, deterministic rolls,
  persistent depletion/restock state and compatibility with existing expeditions.
- Shared construction geometry/rules: placement anchors, structural support, colliders,
  door states, grade health/resistance, repair and storage. Rendering consumes the same shapes.
- Shared crafting/combat/equipment rules: station and line-of-sight validation, batch costs,
  ammo/cooldown/range, server-owned hit resolution and equipment modifiers.
- The simulation dispatches typed intent commands to those modules. Client panels/controllers
  present state and send commands; they never own rewards, damage, inventory or positions.
- Versioned state and wire schemas include explicit migration of saves 1–3, bounded new
  entities and private/shared data boundaries. Existing island generation stays stable.

## Verification gates

- [x] Unit coverage proves deterministic generation/loot, all-or-nothing crafting and
      upgrades, transfer conservation and partial capacity, quantity/range/sight failures,
      station requirements, weapon/ammo rules, equipment effects and structural invariants.
- [x] Save migrations and round trips preserve drops, container contents, depletion,
      upgraded/damaged structures, doors, equipment and progression. Corrupt data is rejected.
- [x] Real server tests prove contested pickup/loot, authoritative costs/hits, privacy,
      reconnect and durable restart for the new systems.
- [x] Desktop WebGL journeys use real inventory, crafting, loot, construction and combat
      controls; an ordinary multiplayer journey shares resources without developer privileges.
- [x] Touch portrait and landscape controls are usable; screenshots and browser errors
      are inspected. Fixtures use visible developer controls or the public save import; diagnostics remain read-only.
- [x] `npm run check`, `npm run test:e2e`, and `npm run format:check` pass. README,
      architecture, content guide, roadmap and QA describe the verified final behavior and limits.

## Current evidence

The baseline is clean `main` at `1e609d0`, with the editable-terrain implementation.
The expansion is implemented on `codex/frontier-progression`. Final validation passes
138 unit/integration tests, 33 desktop/touch browser scenarios, types, lint, formatting and
both production builds. Detailed evidence is recorded in [QA](qa.md#frontier-progression--2026-09-19).
