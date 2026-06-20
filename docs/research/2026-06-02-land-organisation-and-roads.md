# Land organisation and roads — research and the plan to resolve

## The problem on screen

The plot layer (slice 67) scattered about ten named "vibe" plots up to 60 cells out from the colony core,
and dragged a **straight spoke road** from the core to each one. On the island those spokes run dead
straight over hills, forest and open water, cross each other and the plot pads, and the far-flung lots read
exactly like Caesar III's old paradigm — _a settler walking to a plot a human marked in the wilderness._
The operator's verdict is correct: **the roads have no idea what they are built on.**

Three root causes:

1. **No land-type metadata.** Neither the planner nor the renderer knows what each cell is _for_ — only the
   raw terrain (biome, elevation, water). There is no graded "this is good residential ground / this is bare
   rock / this is a flood verge."
2. **Roads are geometry, not routing.** The spokes are straight line segments. A real road minimises a
   _terrain cost_; a straight line does not.
3. **The wrong paradigm.** Plots are marked far out and roads dragged to them. A settlement is not built by
   flagging lots across a map — it is organised, compactly, by a planner, from the land outward.

This tick the scattered pads + spokes were **retired** (`buildPlotPads` is now a no-op) so the colony stops
looking silly while the proper system is built.

## What the research says

**1. Terrain-aware roads are least-cost paths, not straight lines.** Procedural road generation imitates
real road-building by choosing the path that _minimises a terrain cost_: open water is an obstacle, crossed
only by an explicit **bridge** at a configurable cost; steep slope is expensive and, past a maximum grade,
forces a **tunnel**; gentle land is cheap. An _anisotropic least-cost path_ finder routes between two points
respecting those costs, and **L-systems** grow a road network outward to service population density. Roads
are laid _first_; everything else hangs off them. ([StreetGen](https://arxiv.org/pdf/1801.05741),
[Procedural Generation of Roads](https://www.researchgate.net/publication/229707505_Procedural_Generation_of_Roads))

**2. Land-type metadata is a suitability raster (weighted overlay).** GIS land-suitability analysis takes
each terrain layer — slope, elevation, distance to water, land-use/biome, hazards — reclassifies every cell
onto a _common scale_ (typically 1–9, or 0–1 for a fuzzy overlay, higher = more favourable), weights the
layers (Analytic Hierarchy Process), and **overlays** them into one suitability map graded _highly /
moderately / not suitable_. This is precisely the "metadata for land types" the colony needs: every cell
carries a buildability score and a best-use class the planner reads.
([GIS land suitability + AHP](https://www.nature.com/articles/s41599-023-01609-x),
[Suitability analysis](https://en.wikipedia.org/wiki/Suitability_analysis))

**3. Settlements organise roads-first, then parcels, then lots.** City-builders zone land into residential,
commercial and industrial districts; the procedural pipeline lays the **road skeleton first**, the areas
_enclosed by roads_ become **parcels**, and parcels are recursively **subdivided into building lots** (OBB
parcelling). The causal chain is _road → access → settlement → services → land value_. The planner never
marks a lot in the wilderness — lots **emerge** from the road and parcel structure.
([Lot subdivision](https://martindevans.me/game-development/2015/12/27/Procedural-Generation-For-Dummies-Lots/),
[City-building game](https://en.wikipedia.org/wiki/City-building_game))

## The plan to resolve (phased, planner-driven)

Guiding principle: **only the City Planner (the border-patrol brain) organises land** — from metadata,
compactly, near the core, on good ground — and **roads follow the land**, never crossing open water without
an explicit bridge.

- **Phase L1 — Land-type metadata layer.** Compute a per-cell `LandCell` from the terrain the colony already
  has: `slope` (elevation gradient), `distToWater`, `biome`, `elev`, `buildable`. Reclassify each to 0–1,
  weight them, overlay into a `suitability` (0–1) and a `bestUse` class (civic / residential / commercial /
  industrial / farm / unbuildable). The GIS weighted-overlay, in code. This is the foundation everything
  else reads; surface it through the existing liveability/zoning overlay, now grounded in real suitability.
- **Phase L2 — A compact, terrain-aware road skeleton.** Replace the straight spokes. The planner grows a
  small road network out from the core along the **highest-suitability, lowest-cost** land (a least-cost
  expansion — water an obstacle, slope a cost), staying **compact** instead of radiating to the horizon.
  Roads bend with the land and stop at the shore (bridges become an explicit, costed mechanic later). The
  sim's grid roads already stop at water; this extends them with cost-aware routing.
- **Phase L3 — Parcels + lots, not marked plots.** The areas the road skeleton encloses become parcels;
  parcels on residential-suitable land subdivide into house lots; a building sits on a lot facing its road.
  **Retire the named "vibe" plots** scattered in the wilderness — a plot becomes a _lot inside the organised
  settlement_, placed by the planner, never a flag a settler crosses the island to reach.
- **Phase L4 — Massing on the lots.** Buildings get their declared composite massing (per
  `docs/specs/VISUAL-STANDARD.md`) on their lots, and the porter carts (spec 073) run the real road skeleton.

## Immediate action this tick

- **Retired** the scattered plot pads + straight spoke roads — `buildPlotPads` is a no-op pending L1–L3.
- Logged the land-metadata + planner-organisation direction in the README backlog so the routines build it.

## Sources

- StreetGen — base city-scale procedural streets: <https://arxiv.org/pdf/1801.05741>
- Procedural Generation of Roads: <https://www.researchgate.net/publication/229707505_Procedural_Generation_of_Roads>
- GIS + AHP land-use suitability (Nature HSSC): <https://www.nature.com/articles/s41599-023-01609-x>
- Suitability analysis (Wikipedia): <https://en.wikipedia.org/wiki/Suitability_analysis>
- Procedural lot subdivision: <https://martindevans.me/game-development/2015/12/27/Procedural-Generation-For-Dummies-Lots/>
- City-building game (Wikipedia): <https://en.wikipedia.org/wiki/City-building_game>
