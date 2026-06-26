# Spec 106 — Mall anchor shell massing

**Status:** built in PR (one bounded Jack slice).
**Lane:** World & Build (Jack).
**Phase:** Phase 2B/2C bridge of the open-world roadmap. Spec 104 reserved `commercialDistrict.mallPad`; this slice turns that bare reserved rectangle into the first visible mall anchor mass without adding the garage seam, POI labels, authored GLB assets, or runtime placement changes.
**Touches:** `src/colony/render/mallAnchorShell.ts`, `src/colony/render/PlanetRenderer.ts`, `tests/mallAnchorShell.test.ts`, this spec, `docs/README.md`, and `docs/VISION-open-world.md`.

## Why

After the 0.17.10 deploy, the commercial district has a deterministic `mallPad` and the coastal pad blend seats commercial pads on a dried surface. In game, the mall pad still reads as a bare flat rectangle. The NFS-feel roadmap needs a dominant commercial gravity-well silhouette before the garage landmark and authored GLB uplift can land.

This slice intentionally keeps the reservation geometry unchanged. It only renders a deterministic, code-massed placeholder anchor so players can read the district hierarchy now: one mall mass, smaller shop ribbon, lit intersection.

## Mechanic

- Add a pure `buildMallAnchorShellModel(pad, surfaceY)` helper that maps the existing `mallPad` rectangle into a serializable render model:
  - centre = rectangle centre;
  - baseY = minimum sampled `surfaceY` over the four pad corners plus centre;
  - body = flat-roofed main box occupying most of the pad;
  - side wings = lower flanking boxes;
  - roof = shallow dark flat slab above the body;
  - storefront panes and an entrance canopy face the high-street/intersection side;
  - night floor/plaza = thin emissive slab covering most of the dried pad.
- `PlanetRenderer.buildCommercialDistrict()` builds the mall anchor first, before the shop ribbon, inside the existing commercial group and disposal lifecycle.
- The anchor uses `surfaceY`, not raw terrain, so the mass seats on the dried/coastal-levelled commercial pad produced by the existing render relevel pass.
- The night floor material updates from a dim day emissive intensity to a strong night emissive intensity through the existing day/night hook.

## Rules and data

- Deterministic generation only: no `Math.random`, `Date.now`, `performance.now`, or `new Date` in the mall model helper.
- No sim-state mutation, district re-survey, pad coordinate rebaseline, garage placement, GLB loading, or new shown mall name.
- The shell is code-massed placeholder architecture. Blender/GLB replacement is a later Phase 2D slice and must keep placement owned by the deterministic pad/model path.
- The floor/canopy glow at night but stay under the existing commercial group; no new global lights or renderer-only random ambience.

## Acceptance

- Seeds `4242`, `42`, and `7` build identical mall shell models across two fresh runtime boots.
- The shell model centre equals the reserved `mallPad` centre and its body dimensions derive from the pad dimensions.
- `baseY` seats at or below sampled pad `surfaceY`, proving the renderer can place the shell on the dried surface rather than raw coastal terrain.
- The night floor exposes day/night emissive intensities and `PlanetRenderer` updates that material as `1 - daylight` changes.
- Focused Vitest passes, district determinism tests still pass, typecheck/build/full Vitest stay green, and day/night proof screenshots show the anchor shell present on the mall pad with the floor glow visible at night.
