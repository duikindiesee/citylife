# Spec 126 — the civic-art artifacts (R3F)

Phase 3 ambient-life porting item (`updateArtifacts` from the legacy `PlanetRenderer.ts`,
slice 12b of 3). The seeded civic-art catalog — bench, lamppost, planter, fountain,
shade_tree, notice_board, wayfinder — did not render in v3.

## Design

The catalog is deterministic ColonySim state (`sim.state.artifacts`, from
`createVisualArtifacts`), so `R3FArtifacts` reads it directly and syncs ONE fixed-capacity
instanced mesh per kind (7), placing each item and setting per-kind counts via the existing
`summarizeRenderableArtifacts` (which also drops unknown kinds / over-cap items). Cap is
`ARTIFACT_CATALOG_SIZE`. Mount-once / vary-`mesh.count` idiom.

`artifactLayer.ts` holds:
- `artifactTransform` (pure, node-tested): 4m grid, a 0.015 lift above the ground, `-rot`
  yaw, and the per-item footprint scale (`w`/`h`), matching the legacy `placeArtifact`.
- `buildArtifactAssets`: the 7 legacy-verbatim geometries (each a `mergeGeometries` of
  low-poly primitives) + materials. Disposed on unmount (spec 119).

Artifacts ride the terrain surface. Mounts at boot stage 1 (spec 117).

## Tests

- `tests/artifactLayer.test.ts` (3): the placement transform (grid + lift + yaw + footprint
  scale + sea-level floor) and a geometry-builder smoke test (all 7 kinds build non-empty
  geometry + material — three runs in the node env).
- `e2e/artifacts.spec.ts`: probes the scene and asserts all 7 per-kind meshes render with
  their instance counts summing to the live roster (first run: 1 of each = 7).

## Notes

Ambient-life group sibling to the tarentaal flock (spec 125). The goods/porter carts and the
parked operator car are slice 12c.
