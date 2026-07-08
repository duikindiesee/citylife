# Spec 125 — the tarentaal flock (R3F)

Phase 3 porting item (`updateTarentaal` from the legacy `PlanetRenderer.ts`). The guineafowl
flock that wanders the world did not render in v3.

## Design

The flock is NOT renderer ambience — positions come from the deterministic ColonySim tick
(`sim.state.tarentaal`, advanced by `stepTarentaalFlock` inside `sim.step()`). So
`R3FTarentaal` reads `sim.state.tarentaal` directly (like the foliage) and syncs two
fixed-capacity instanced meshes: adults (cap `COLONY.tarentaal.adults` = 4) and chicks (cap
`COLONY.tarentaal.chicks` = 6). The mount-once / vary-`mesh.count` idiom.

`tarentaalLayer.ts` holds the pure, node-testable placement math and legacy-verbatim specs:
adult body (sphere 0.22 scaled 1.25/0.72/0.82, base-lifted, colour `0x32343a`), chick (sphere
0.12 scaled 1.15/0.78/0.82, colour `0x8c7444`), the `-heading` yaw, and the behaviour
flourishes — a chasing bird bobs higher (0.035 vs 0.01) and strides longer (1.18 vs 1.0).
Birds ride the terrain surface (`terrain.worldY`, floored at sea level). Mounts at boot stage
1 (spec 117); geometry/materials disposed on unmount (spec 119).

## Tests

- `tests/tarentaalLayer.test.ts` (4): legacy specs pinned, behaviour bob/stride, grid→world
  transform with the bob, `-heading` yaw + sea-level floor.
- `e2e/tarentaal.spec.ts`: probes the scene and asserts the two flock meshes render with
  their instance counts summing to the live roster (first run: 4 adults + 6 chicks = 10).

## Notes

Part of the ambient-life group (slice 12). Siblings — the civic-art artifacts (7 prop
kinds), the goods/porter carts, and the parked operator car — are their own slices.
