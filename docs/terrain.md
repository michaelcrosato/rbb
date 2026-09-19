# Editable terrain

RBB now uses a sparse volumetric terrain field over the original seeded island. A heightfield alone cannot represent a floor with rock above it; the new field supports pits, tunnels, caves, overhangs and deposited ground. Existing expeditions retain their original island.

## Player tools

Craft a **stone pickaxe**, then press **T** or use the **Terrain tools** HUD button. Choose **Dig terrain**, **Deposit dirt**, or **Flatten ground**. Aim at a visible surface within five metres and press **E**, left click, or the touch **Use** button. Holding E or left click repeats work. The outlined brush shows the working volume.

Digging collects excavated dirt into the normal weight-limited pack. Depositing consumes dirt. Flattening cuts and fills toward the selected height and settles the net dirt cost. Pickaxes are required for digging and flattening. Set a numeric level in the tools menu or aim at a surface and press **R** / **↻** to sample its height. Work around the edge of a deep pit in stages if its floor is out of sight or reach. Put the tools away from the terrain menu, or equip a hotbar item to return to gathering.

For a cave base, start on the side of a hill and excavate inward. Floors and ceilings collide separately; the mountain above stays in place. Building previews choose a floor near the survivor's elevation. Make enough room for the whole building and a standing survivor. Bedrolls, campfires and foundations can occupy excavated space above sea level.

Filling cannot bury survivors, wildlife or structures. Small changes under a survivor's feet can lift them by the normal step allowance. Excavation can make survivors and loose supply bags fall. Edits that remove existing building support are rejected; remove the structure before reshaping its support. Displaced trees and deposits disappear and can regrow only when their original ground support is restored.

## Developer sculpting

Open **F2 → Terrain**. Choose excavate, build up, flatten, smooth, or restore seeded terrain. Sphere and box brushes have a **1–12 m radius/half-size**, adjustable strength, and a flattening height. **Sculpt in world** uses the visible brush at up to 80 metres; **Apply terrain brush** stamps the specified X/Y/Z coordinates. The sample button copies an aimed surface or the survivor's current location. Flight remains under Quick tools.

Developer terrain commands bypass dirt and stamina costs, retain occupancy and building support validation, and mark the world as a sandbox. Solo captures its existing whole-world recovery checkpoint before the first developer mutation. Capturing and restoring checkpoints includes terrain, structures, resources and inventories. Ordinary multiplayer hosts reject developer sculpting; player terrain tools work without enabling developer mode.

## Ownership and extension points

- `shared/terrain.ts`: versioned metre lattice, sparse density samples, spatial column index, brush planning, surface queries, exact ray intersections, polygonization and revision patches. Positive density is air. Lattice zeros belong to solid during polygonization to avoid zero-thickness phantom surfaces. Physics interpolation and the mesh use the same six tetrahedra in each cell.
- `shared/earthworks.ts`: player intent, server-derived aim, cost and occupancy validation, support rules, resource displacement and atomic commits. Brush operations do not write gameplay state until validation and inventory transactions succeed.
- `shared/physics.ts`, `building.ts`, `wildlife.ts`: query the edited volume and select floors by elevation. Terrain height alone is reserved for generation and biome metadata.
- `client/terrain-tools.ts` and `client/developer.ts`: visible controls and brush previews. No inventory or density data supplied by the player becomes authoritative.
- `client/render/terrain.ts`: stable render chunks, dirty geometry replacement, earth surfaces and regenerated shoreline lines. Unedited four-metre surface triangles remain intact; edited areas refine to the metre lattice. Old geometry is disposed when replaced. Shadows and optional rendering history are invalidated after edits.

Balance values such as reach, stroke radius, cooldown, stamina and dirt units belong in `shared/content.ts`. Altering lattice scale or density interpretation requires an explicit terrain-version migration. Keep new brush operations deterministic and test rendering/physics agreement at negative coordinates and chunk boundaries.

## Saves, replication and bounds

Save **v4** stores terrain version 1, a revision and changed samples. Both v1 and v2 saves migrate explicitly to an empty edit layer; v3 edits are retained in v4, preserving world generation version 1. Export/import, browser backups, solo checkpoints and SQLite snapshots include edits. Save files are validated and bounded at 16 MB; available browser storage can be smaller and storage failures still require export.

Network **protocol 4** requires matching clients and servers. A joining or reconnecting client receives a complete terrain baseline. Later snapshots omit unchanged terrain and send revision-based patches, including deleted samples. Bounded in-memory patch history falls back to a baseline when necessary. Other world systems retain their existing full snapshots. Edits and patches are bounded to **160,000 changed samples per world**, on the finite 640 × 640 m island between **−64 and 128 m**. Restoring generated terrain frees sample capacity.

Dirt accounting uses a nodal volume approximation, with gains rounded down and costs rounded up. Repeating cut/fill cycles cannot generate free dirt. It is a gameplay material budget, not a physical soil mass or exact mesh-volume measurement.

The system does not simulate falling rock, erosion or flowing water. Terrain can overhang without structural collapse. Water remains the global sea-level volume, so excavation below sea level floods; sealed dry underwater rooms require a future water-volume system. Material layers, block snapping, individual terrain materials, unbounded world streaming and stratified cave lighting are separate extensions. Optional surface weather and indirect-light effects retain presentation limitations documented in QA. This terrain foundation is not feature parity with either Minecraft or RimWorld as complete games.
