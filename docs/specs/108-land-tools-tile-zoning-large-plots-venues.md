# Spec 108 — Land Tools: RCT-style tile zoning, large plots, and real venues

(Renumbered from 107 to avoid collision with Jack's spec 107 commercial-high-street-variety.)

Status: DESIGN — direction decisions LOCKED (see Decisions) · Owner: lead (design) + Jack/World & Joe/UI (slices) · Date: 2026-06-26

## Why — the operator's steer (Irwin, 2026-06-26)

The commercial plots are too small. You cannot build a radar **walk-in bar** (The Nearest) or a **sports club with a sports field** (Sportifine) on a 6x5 shop pad. These are real buildings we should still build. So rather than cram tiny shops, **lay out commercial roads and LARGE plots for commercial zones**. The whole map should work like **RollerCoaster Tycoon landscaping tools** — a grid of squares you can mark for commercial / road / residential and so on — **so we build our land easily**.

This also fixes the duplication Irwin flagged: the marquee apps render as identical small recoloured boxes because there is no room (or framework) for them to be distinct venues.

## What exists today (research, file-precise)

- World is a **608x608 deterministic cell grid** (`config.ts:9` world.size=608). Per-cell data layers already exist: `elev / buildable / biome / water / distToWater` (`terrain.ts:34-77`). Deterministic from the seed, no Math.random/Date.now.
- **Zoning is a formula, not data**: `cellZone(landing,x,y)` derives a zone from distance + angle to the landing (`cityPlan.ts:38-53`). A translucent tint renders only in the "buildable" view mode and is off by default; prior research calls it ugly/low-value (`docs/research/2026-06-01-zoning-redesign.md`).
- **Plots are small**: residential houseZone up to 23x16; commercial `SHOP_SIZE` kiosk 4x4 / store 6x5 / showroom 8x6 (`district.ts:60-64`); `plotFootprint()` hard-caps at 5x3 (`cityPlan.ts:80-100`).
- **Roads are procedural**: a 7x7 block frame routed by least-cost path (`build.ts:311-372`); stored as `roadSet: Set<string>` + `roads: RoadCell[]` + `roadKind` (data-driven storage already — just not painted).
- **Large buildings are feasible**: footprints are multi-cell, the house render is decoupled from the sim cell (renders into a `houseZone` rectangle), and the voxel compiler accepts variable `w x d` (`houseBuilder.ts:35-43`). Nothing big is built yet.
- **Businesses** (`commerce/businesses.ts`): 6 defined — `nearest_bar` (The Nearest, radar dish, has seating), `chef_market`, `sportifine_club` (ball/sports), `sprout_nursery`, plus generic `trading_post` / `corner_kiosk`. `assignBusinesses` puts the 4 marquee apps on the 4 largest plots — but the largest plot is only 8x6.
- **Click-to-cell already works**: `pickGround` raycasts terrain on click (`PlanetRenderer.ts:481-491`); a "paint" interaction has a clean seam.
- **Prior art**: VISION-open-world.md already calls to REPLACE the thin high street with a larger landmark district; the land-org research backlog (L1 suitability -> L2 least-cost roads -> L3 road-enclosed parcels -> L4 massing) is named "the priority spatial backlog"; the district concept shows Sportifine as a large sports venue and a radar dish for Nearest.

Conclusion: the codebase already wants this. We are turning a hidden formula into a **paintable data layer**, raising the plot caps, and adding **real venue massing**.

## The design — "Land Tools", three layers

### Layer A — Tile zoning as DATA + paint tools (the foundation)

- Add a persisted `zoneGrid: Uint8Array[608^2]` to ColonyState (deterministic data, saved with the world). Zone enum: `unzoned / road / commercial / residential / civic / recreation / park`.
- Replace the `cellZone()` formula with a lookup into `zoneGrid`. Seed `zoneGrid` once from the existing formula so nothing regresses, then make it paintable.
- Roads become paintable too: the `roadSet` already exists; allow authoring road cells directly instead of only deriving them from the block frame.
- Add a **"Plan" view mode + an RCT-style tool palette**: zone brush, road brush, plot stamp, bulldoze. Reuse `pickGround` for cell selection. Palette must be tasteful (deep-space + cyan hairlines, per the zoning-redesign research), not the old flat overlay.

### Layer B — Large, variable plots

- Raise the `plotFootprint` 5x3 cap and extend `SHOP_SIZE` into venue-scale kinds (data-driven, not hardcoded).
- A commercial zone enclosed by roads subdivides into **large plots** (the L3 idea), or a designer/player **stamps** a big plot rectangle directly.
- Marquee venues get big plots, e.g. bar ~12x10, sports ~20x16 (building + field), market ~12x8, nursery ~10x8 (tune in S3).

### Layer C — Real venue buildings (per business identity)

One venue per slice, marquee apps first:

- **The Nearest** — a **walk-in radar bar**: open frontage, interior counter + stools (seating is already a business flag), rooftop **radar dish**, cyan neon.
- **Sportifine** — a club building **plus an adjacent sports field** (pitch, goal, line markings, small stands), lime.
- **Chef Ott's Market** — market hall + stalls + crates, orange.
- **Sprout Greenhouse** — glasshouse with plant rows, green.
- Multi-cell footprints via the existing blueprint/voxel path. Day calm / night neon, night emissive floor.

## Slices (each: deterministic, isPublicSafe, docs-in-PR, vitest, day+night proof, PR off latest main, route to MoJoJo)

- **S1 (Jack/World)** — `zoneGrid` data layer in ColonyState; `cellZone()` reads it, seeded from the current formula; persisted; tests. Pure foundation, no visible change yet.
- **S2 (Joe/UI)** — "Plan" view mode + tool palette (zone brush + bulldoze first), raycast paint onto `zoneGrid`, tasteful tints, day+night.
- **S3 (Jack/World)** — large-plot survey: commercial zone -> large plots; raise caps; add venue plot kinds.
- **S4 (Jack/World)** — venue massing, **The Nearest radar walk-in bar FIRST**, then Sportifine club+field, Chef Ott market, Sprout greenhouse (one venue per slice).
- **S5 (Joe/UI)** — venue POI/signage realign on the large plots (de-cluttered, distinct) — folds in the current de-dup goal.
- **S6 (Joe/UI)** — road-paint tool + plot stamp.
- **Lead** — owns the ColonyState seam, slice sequencing, and the design council; keeps VISION + this spec current.

## Phasing

This is a **foundational "Land Tools" track (call it Phase 2.5)** that makes the Phase 2C landmark massing land properly. The current small-shop de-duplication goal is interim polish; **S3/S4 supersede it** with large, distinct venues. It does not block Phase-1/2 work and can run in parallel.

## Determinism + save

A painted grid is deterministic data; no Math.random/Date.now anywhere in the logic. The `zoneGrid` (and any authored road cells) persist with the save so a world replays identically.

## Decisions (locked by Irwin, 2026-06-26)

1. **Designer/team build tool.** The paint UI is a build-time/admin world-layout tool ("so WE build our land easily") behind a builder/admin gate (alongside the existing `/builder.html` house editor), NOT in the player flow. No player-economy or permission work needed for the tools themselves. Players still experience the RESULT (the laid-out world); they just do not paint it.
2. **Whole map at once.** The painted `zoneGrid` becomes the single source of the world layout for the entire 608^2 map, REPLACING the `cellZone()` formula and the procedural block-frame road derivation. We seed `zoneGrid` (and an authored road set) once from the current formula/derivation so nothing regresses, then the team re-paints from there. This makes the world AUTHORED, not derived.
3. **Mark zone, venues auto-fill.** You paint a large commercial zone and a deterministic surveyor places DISTINCT venues into it (marquee apps first, by identity), the same discipline as `makeCommercialDistrict` but driven by the painted zone footprint instead of the fixed reserve rectangle. No per-venue hand-stamping required.

### Remaining minor questions (proposed defaults; not blocking S1/S2)

4. **Sports field** — default: a generic multi-sport field (pitch + goal + line markings + small stands), ~16 cells long, tuned in S4. Confirm if it should be a specific sport.
5. **For-sale economy** — default: KEEP it. Bots still buy + build venues over time on the large plots (consistent with the current buy-and-build model); the auto-fill places the venue IDENTITY/plot, build happens through the economy. Confirm if marquee venues should instead be pre-built by the layout.
