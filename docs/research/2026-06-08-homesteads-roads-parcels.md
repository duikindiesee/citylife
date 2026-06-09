# Homesteads — large household parcels served by terrain-aware streets

- date: 2026-06-08
- author: claude (architect), synthesising four research findings for the spec-076 rework
- supersedes the spec-075 neighbourhood (cramped 4x4 lots + broken road strips)
- related: `docs/research/2026-06-02-land-organisation-and-roads.md` (L1–L4 roads-first plan)

## 1. The problem on screen

The operator's screenshot shows two defects that both come straight from the spec-075 geometry, not from the art:

1. **Wall-to-wall houses.** `neighborhood.ts` uses `LOT = 4` and packs lots at stride `LOT+1 = 5` (a *single* verge cell between 4-wide lots), placed just 1 cell off the street. `voxelHouse.ts` then sizes the house at `w,d in {3,4,4}`, so the cottage **fills the entire lot** — zero in-lot setback, no yard, no garden. A 4-wide house plus one gap, repeated, reads as a continuous barracks wall.
2. **Broken-looking roads.** The neighbourhood street is a single 1-cell row dumped wholesale into `state.roads` (`runtime.ts` constructor). `rebuildRoads()` drapes a generic asphalt quad per cell and only paints a centre dash on cells lying exactly on the 7-cell block grid (`onV xor onH`, `B = COLONY.build.block`). The injected street almost never aligns with that grid, so it gets no centre line and reads as a flat black gash with no width, kerb, verge, or junction.

The structural root cause: **the unit of land is a tiny fixed lot the house fills, and the road has no hierarchy.** There is no notion of a *parcel* (house zone + garden + farm + border) and no terrain-aware street.

## 2. What the research says

### 2.1 Roads are a connected, hierarchical, least-cost graph — not painted strips

Good procedural road networks are *grown as a connected graph*, not painted as independent cells. The canonical pattern (Parish & Müller 2001, CityEngine, Galin et al. 2010, the tmwhere implementation) is two-tier and hierarchical: grow a small set of **major streets** that enclose blocks, then subdivide each block with minor streets and short **driveway spurs** to each parcel. Routing follows a **least-cost / anisotropic shortest path** over the terrain so the road bends around water and steep slopes instead of charging through them — a cost transfer function returns infinity for impassable water and over-steep faces, and direction-dependent cost keeps the road draped along the contour rather than climbing the fall line. The single rule that makes a network *read as connected* rather than as floating strips is **local-constraint snapping**: before committing any segment, snap its endpoint to a nearby existing road node (forming a T- or X-junction) within a snap radius.

A street only *reads* as a street when it has real **width** (2–3 cells of carriageway, not 1), a **verge/kerb** strip, a building **setback** (the front garden), and a distinct **path from kerb to door**. Real-world analogues: ~10–18 ft (3–5.5 m) front setback, 25–50 ft lot frontage.

### 2.2 Large multi-zone parcels with internal zoning (the burgage-plot pattern)

The cure for cramped lots is a **large parcel** (homestead) carved by a deterministic subdivision pass, then **zoned internally** front-to-back: a small front setback at the road, then the **house** build-zone, then the **garden/yard**, then the **farm field** at the rear. This is exactly Manor Lords' burgage plot — a small house footprint on the street with a much larger productive **backyard extension** (vegetable garden, orchard, or pen) behind. The parcel — not the house — is the unit assigned to a household. Real zoning setbacks translate the spacing: front ~20–35 ft, side ~5–15 ft, rear ~20–40 ft on a ~70×155 ft quarter-acre lot.

Subdivision is best done by **OBB recursive splitting** (fit an oriented bounding box to the buildable strip beside the street, slice along the shorter axis, recurse until each child hits a target area, still has road frontage, and stays under an aspect cap). It is deterministic, cheap, and ideal for the near-rectangular strips a street produces. The heavier **straight-skeleton** subdivision is only worth it for winding/irregular blocks (O(N^3 log N)) — overkill here.

Two **hard rules** keep the layout believable: the **frontage rule** (every parcel must keep >=1 cell edge touching the street) and the **access rule** (reject any parcel walled in behind others). Field sizing is **walk-distance-bounded** — Manor Lords caps the harvester walk; Farthest Frontier fields are best at 5x5, max ~10x12 — so the field stays a modest rectangle near the house rather than a sprawling block.

### 2.3 Roominess is *filled* space, legible ownership, and aligned-with-variation placement

The cozy-game canon (Stardew, Animal Crossing, Manor Lords, Townscaper, Dorfromantik) agrees a small settlement reads as believable because of the **space around** the buildings, achieved by three moves: (1) the house **faces and is offset** from the street with a front verge — never flush on the road; (2) property is **legible** — fences/hedges trace each parcel edge so the eye groups "house + its land" as one unit; (3) the ground between buildings is **filled** with cheap repeated detail (crop rows, fruit trees, veg beds, a well) so roominess never reads as emptiness. A short **path from street to door** makes each home read as inhabited and ties it to the public road.

Placement should be **aligned-with-variation**: keep house *fronts* on a constant setback line so the street reads as intentional, but jitter each house's lateral position/size and garden split deterministically from the seed. Perfect uniformity reads as institutional; pure randomness reads as noise; alignment plus small per-parcel variation reads as a real hamlet (the Townscaper/Dorfromantik trick). Leave a **generous inter-parcel gap** (>=2–3 cells) beyond each parcel's own border, scattered with a tree or rock.

### 2.4 Determinism, the water barrier, and instanced rendering (the citylife constraints)

Every cell of every parcel — house, garden, field, border, path — and every road cell must pass the existing dry-buildable test (`buildable[i]!=0`, `!isWater`, biome not Mountain/Peak/Ocean/Shallows), exactly as `cellOk`/`footprintOk` already do. Layout must be a **pure function of the terrain** (no `Math.random`; seeds derived from cell coords, as `houseSeed` already is) so the same seed reproduces the same homestead and Vitest can assert it. All new geometry (houses, fences, crop rows, paths, pads) must be drawn through **InstancedMesh** with the existing `dummy` matrix + `instanceColor` pattern, with the capacities raised to cover the bigger footprints.

## 3. The synthesis (the rework in one paragraph)

Replace the 4x4 lot and the single flush street with a **spine-and-homestead** model on the existing 1-cell grid. A terrain-aware **main street** (3-cell carriageway + 1-cell verge each side) is routed as a least-cost path over the heightfield from anchors near the landing, bending around water and slope. **Large homestead parcels** (~14 wide x 18 deep) flank the spine in a band, set back behind the verge, separated from each other by a multi-cell border, each zoned front-to-back into front setback -> house -> garden -> farm field and ringed by a fence/hedge with one gate gap. A short **driveway path** connects each parcel's gate to the spine. Each parcel is one household; the house, fences, crops, trees and path all render as instanced geometry; everything is deterministic and stays off water.

## 4. Pitfalls to avoid (carried from the findings)

- Painting road cells independently with no graph/snapping (the cause of disconnected strips).
- 1-cell roads with buildings flush against them (no kerb/verge -> black gash).
- Single-cell verge / zero setback (the wall-to-wall cause).
- Straight lines that ignore the heightfield (roads over cliffs/water). Gate every cell on `isWater`/`buildable`.
- No hierarchy — make the spine visibly wider than the spurs.
- Parcels with no road frontage; enforce the frontage/access rule.
- Non-deterministic generation (unsorted iteration, `Math.random`). Fixed scan order + seeded RNG.
- Over-large or over-dense farm fields and too-tall crops (visual mush at low-poly scale).

## 5. Cited sources

Roads & networks:
- Parish & Müller / tmwhere city generation — https://www.tmwhere.com/city_generation.html
- CityEngine "grow a street" — https://doc.arcgis.com/en/cityengine/latest/help/help-grow-a-street.htm
- Galin et al., procedural roads (HAL) — https://hal.science/hal-01381447/document
- Procedural Generation of Roads — https://www.researchgate.net/publication/229707505_Procedural_Generation_of_Roads
- Space Colonisation for Procedural Road Generation — https://www.researchgate.net/publication/330256216_Space_Colonisation_for_Procedural_Road_Generation

Parcels & subdivision:
- Procedural Generation for Dummies: Lots (OBB subdivision) — https://martindevans.me/game-development/2015/12/27/Procedural-Generation-For-Dummies-Lots/
- Procedural Generation of Parcels in Urban Modeling — https://www.researchgate.net/publication/262347527_Procedural_Generation_of_Parcels_in_Urban_Modeling
- Vanegas et al. parcels (Purdue CGVLAB) — https://www.cs.purdue.edu/cgvlab/papers/aliaga/eg2012.pdf
- Straight-skeleton subdivision (Kelly) — https://twak.org/project/phd/

Settlement realism & homestead zoning:
- Manor Lords burgage plot (wiki) — https://wiki.hoodedhorse.com/Manor_Lords/Burgage_plot
- Farthest Frontier farming/field sizes — https://farthestfrontier.wiki/wiki/Farming
- Stardew / ACNH cozy layout (fences delineate property; paths guide to the door) — https://www.thegamer.com/stardew-valley-best-farm-layouts-optimized-farm/
- Traditional-neighborhood setbacks & scale — https://www.stevens-assoc.com/traditional-neighborhood-design-setbacks-and-scale/
- Townscaper (alignment-with-variation) — https://www.townscapergame.com/
- Minecraft structure spacing/separation — https://minecraft.wiki/w/Structure_set
