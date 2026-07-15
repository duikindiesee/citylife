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
terrainLevel?.get(y * terrain.size + x) ?? terrain.worldY(x, y);
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

## Follow-up (2026-07-10) — the heightfield collider was TRANSPOSED

The guardrail above masked a deeper bug: rapier reads a heightfield's `heights` array
COLUMN-MAJOR (`j*(nrows+1)+i`, columns along local X, rows along local Z — verified
empirically with a probe world: a high block written row-major lands on the +X edge), but
`R3FTerrain` filled it row-major (`h[x + y*N]`). The physics island was the visual island
MIRRORED across the X/Z diagonal: 85% of land cells carried >1 m of collider/ground
mismatch (worst ~20 m). Wherever the transposed collider sat low, the walker fell through
the visible hill and the guardrail teleported it back up in a loop — the operator's
"falling into the world at the top of the hill, bouncy effect" (the guardrail made the
mismatch survivable, which is why it shipped unnoticed). Wherever it sat high, the walker
walked on invisible ground above the mesh — the guardrail only corrects downward.

Fix in `src/colony/render/terrainCollider.ts` (pure, extracted so the parity test drives
the exact production array): `computeColliderHeights` fills column-major (`h[x*N + y]`,
terrainLevel stays keyed row-major like every other consumer), `colliderScale` sizes the
field `(N-1)*4` — N samples span N-1 cells; the old `N*4` stretched the far edges ~2 units
— and the collider's fixed body sits at `COLLIDER_CENTER = [-2, 0, -2]` so sample points
land exactly on mesh vertices.

## Tests

- `tests/terrainLeveling.test.ts` — `leveledWorldY` (5): override wins, raw fallback,
  row-major indexing never transposes x/y, absent map reads raw, zero-height override is not
  treated as missing.
- `tests/terrainColliderParity.test.ts` (4) — stands rapier up in node, mounts the collider
  exactly as the component does, and raycasts straight down: the physics ground equals the
  rendered ground on the 12 most transpose-sensitive cells, across an island-wide sweep, on
  the column-major fill directly, and through a terrainLevel override.

## Notes

Pre-existing on every branch with the R3F walker; surfaced by spec 127's road grading because
ribbon roads move the rendered surface further from the raw heights than the old flat roads
did. Complements spec 130 (road ground grading): that reshapes the leveling map so the ground
meets the ribbon; this fix makes the walker read that map wherever it stands.
