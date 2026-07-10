# Spec 134 — the walker stands on the leveled ground

Latent-bug fix from the spec-127 adversarial verify (PR #252, verdict P1). The first-person
walker's spawn (`R3FPlanetRenderer`'s `startPos` memo) and its ground guardrail
(`FirstPersonController`) both read RAW sim heights via `terrain.worldY`, blind to the
render-side leveling overrides that `useTerrainLeveling` applies for pads, graded roads and
terraforming. Where leveling raises the rendered mesh more than ~2 m above the raw height, the
walker spawns beneath the visible surface and the guardrail teleports it back to `rawY + 1.5`
— still underground — in a jitter loop; over lowered terrain the guardrail fights gravity and
the walker floats.

## Design

One pure resolver, `leveledWorldY(terrain, terrainLevel, x, y)` in
`src/colony/render/terrainLeveling.ts`:

```ts
terrainLevel?.get(y * terrain.size + x) ?? terrain.worldY(x, y)
```

Anything that stands ON the rendered surface resolves heights through it. Both walker call
sites now do:

- **Spawn** — the `startPos` memo resolves the first road cell's height through
  `leveledWorldY` with `debouncedTerrainLevel`, which joins the memo's deps (it is a
  React-managed map, so it rides the deps directly; `spawnSignature` still covers the mutable
  sim side).
- **Guardrail** — `R3FWorld` passes `debouncedTerrainLevel` to `FirstPersonController` as a
  new optional `terrainLevel` prop; the per-frame ground check compares against the leveled
  height, so the below-ground teleport lands ON the visible mesh and stops fighting gravity
  over lowered terrain. `R3FCityRenderer` (v1 town) passes no map and keeps raw behaviour.

The `findDrySpawn` fallback (no roads yet) still reads raw terrain: with no roads there are no
pads or gradings, and a pre-road landscape edit at the exact spawn cell is now corrected by the
guardrail on the first frame anyway.

## Tests

- `tests/terrainLeveling.test.ts` — `leveledWorldY` (5): override wins, raw fallback,
  row-major indexing never transposes x/y, absent map reads raw, zero-height override is not
  treated as missing.

## Notes

Pre-existing on every branch with the R3F walker; surfaced by spec 127's road grading because
ribbon roads move the rendered surface further from the raw heights than the old flat roads
did. Complements spec 130 (road ground grading): that reshapes the leveling map so the ground
meets the ribbon; this fix makes the walker read that map wherever it stands.
