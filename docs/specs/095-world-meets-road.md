# Spec 095 — World Meets Road (terrain grades up to the road ribbon)

**Status:** built (render-only fix)
**Lane:** claude2 / car-and-garage foundation
**Touches:** `src/colony/render/PlanetRenderer.ts` only. Sim, water and pathfinding untouched.

## Problem

Roads render as a smooth **ribbon** draped over the terrain. The ribbon surface is
`smoothRoadY(x,y)` — the **max** bilinear terrain height over the ~4-wide carriageway
footprint — so the asphalt always rides _above_ the bumpy ground and never lets the
terrain poke through the carriageway.

Vehicles ride that ribbon top (`smoothRoadY + 0.12`, see the car loop in
`PlanetRenderer`), but the **terrain mesh underneath the ribbon stayed at raw
`worldY`**. On a slope that left two defects:

1. **Downhill / gap side** — the ground sat well below the asphalt, so you could see the
   world _under_ the road and a car looked like it was driving sunk into / below the road.
2. **Uphill bank** — the natural ground a few cells to the uphill side rose _above_ the
   road surface and visually swallowed the car: "on hills you don't see the car."

Measured on the steepest world road (cell `465,383`, slope ~2.0): the rendered ground was
`20.06` while the road surface (where the car rides) was `22.61` — a **2.5-unit** gap.

## Fix

Extend the existing **render-only height override** (spec 093, the `terrainLevel` map that
already cuts flat pads under houses) to grade the ground **up to the road**:

- For every road **ribbon** cell, set the render height to the road surface
  `smoothRoadY(x,y)`, so the earth meets the asphalt base (never pokes through it).
- Ramp a short **shoulder skirt** (3 cells) out to natural ground with a smoothstep —
  a cut on the uphill bank, a fill on the downhill side — so the road edge is never a cliff.

`Terrain.worldY` (sim physics, water, pathfinding, the economy) is **never touched** — only
the visible mesh is graded, exactly like the house-pad leveling. Determinism is preserved
(no `Math.random` / `Date.now`); the full sim test suite stays green.

### Implementation notes

- New `PlanetRenderer.gradeRoadsInto(next, N)` populates the road grades into the same
  `terrainLevel` map that `relevelTerrain()` builds for house pads. Road cells win on the
  carriageway; the skirt never lowers an existing house pad.
- `roadGradedCells` is tracked separately from house-pad levels so `colorFor` keeps the
  **natural biome colour** on graded shoulders (no grass repaint where a road crosses
  forest / beach / mountain).
- The `relevelTerrain` fingerprint now keys on `roadsVersion` **and** the ribbon-cell count,
  and `setRoadWays` triggers a regrade — so the grade follows the road network as it grows.

## Verification

- `npx tsc --noEmit` clean; `npx vitest run` → 892/892 pass (sim untouched).
- Live on a non-5188 dev port: after the fix, the rendered height on the steep hill road
  equals the road surface on every ribbon cell (`render === roadSurf`), and `roadGradedCells`
  covers ~16.7k cells. Before/after screenshots at the same camera pose show the floating
  road embedding into the graded hillside.

## Why this matters for the car lane

Cars must read as sitting **on** the road from any angle before garage / customization work
lands (spec 096). This is the visual foundation: the world now meets the road on every hill.
