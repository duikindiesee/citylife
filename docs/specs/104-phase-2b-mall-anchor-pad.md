# Spec 104 — Phase 2B: mall anchor pad reservation

**Status:** built in PR (one bounded Jack slice).
**Lane:** World & Build (Jack).
**Phase:** PHASE 2B of the open-world roadmap (`docs/VISION-open-world.md`). This slice reserves only the deterministic mall anchor pad. Mall massing/render, garage placement, garage GLB, signage, and POI work are later slices.
**Touches:** `src/colony/commerce/district.ts`, the commercial connector block in `src/colony/runtime.ts`, `src/colony/config.ts`, `tests/districtDeterminism.test.ts`, `tests/commerceDistrict.test.ts`, this spec, `docs/VISION-open-world.md`, and `docs/README.md`.

## Why

Phase 2A gave the commercial district its larger reserve, cross-street, and core intersection. Phase 2B starts giving that block an identity without rendering any mass yet: the mall becomes the always-present gravity-well anchor, but this first slice reserves only the pad so later massing can land without shifting streets or shop footprints.

The pad must be deterministic and additive. It must not change the commercial reserve search, street/cross-street contract, parcel survey, race seam, garage lane, or GLB pipeline.

## Mechanic

- Add `COLONY.commerce.mallPadW = 14` and `COLONY.commerce.mallPadH = 10`.
- Add `mallPad: Reserve` to `CommercialDistrict`.
- After parcels and the cross-street are surveyed, choose a valid 14x10 rectangle:
  - inside the commercial reserve;
  - every cell `cellOk`;
  - not overlapping high-street centreline cells;
  - not overlapping cross-street centreline cells;
  - not overlapping any shop footprint;
  - constrained to a district end beyond the shop ribbon, then ranked by nearest rectangle centre to `commercialDistrict.intersection`;
  - deterministic tie-break: smaller `x`, then smaller `y`.
- In the runtime commercial connector/widen block, treat `mallPad` cells as reserved cells alongside shop footprints so no connector or widened carriageway is paved through the future anchor.

## Rules and data

- No `Math.random`, `Date.now`, `performance.now`, or `new Date` in the district/runtime commercial path.
- No new shown strings in this slice. If a future mall name is added, it must carry/pass `isPublicSafe`.
- No new render meshes, lit materials, GLB, garage site, `findGarageSite`, car-lane code, or massing.
- The mall pad is a reservation only. Phase 2C owns landmark massing/rendering.

## Acceptance

- Seeds `4242`, `42`, and `7` all expose `commercialDistrict.mallPad`.
- Each pad is exactly `14x10`, inside the reserve, cell-ok, and disjoint from street, cross-street, and shop footprint cells.
- The mall pad replays identically across two fresh boots for each seed.
- Golden pad coordinates and pad-cell hashes are pinned in `tests/districtDeterminism.test.ts` for seeds `4242`, `42`, and `7`.
- Existing Phase 2A checks still pass: reserve/intersection/cross-street goldens, reference picker, roadKind coverage, racing seam, typecheck, build, and full Vitest.
