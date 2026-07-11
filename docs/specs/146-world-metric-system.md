# Spec 146 — the world metric system (proper scale for the player and the crowd)

## The complaint

Walking the v3 world in first person, the operator stood eye-to-eaves with a two-storey
building and asked: shouldn't the first-person height be in proportion to the buildings and
trees? And: "I need proper metrics and scaling in the system." There was no system — sizes
were copy-pasted magic numbers with no shared anchor, so some subsystems were right and
others were badly wrong, with nothing to say which.

## The audit (measured)

A scale audit across every render subsystem (world config, first-person, houses, vegetation,
buildings, crowd) established the anchor and found the outliers:

- **The anchor is 1 world unit = 1 metre, 1 grid cell = 4 m.** This is the only metre size the
  code ever states (`roadPitch.ts`: "exactly one 4x4m grid cell"), and it is what MOST of the
  world already assumes correctly: terrain (608 cells → ~2.4 km region), trees (~8 m), houses
  after the spec-129 fix (~6–16 m eaves), and per-building commercial massing (~7 m). Choosing
  this anchor leaves the fewest things wrong.
- **The first-person player was the thing out of proportion — too TALL, not the buildings too
  big.** The Rapier capsule was `[halfHeight 0.5, radius 1.0]` → a **3.0 m** tall, 2.0 m wide
  barrel, with the camera eye at **2.1 m** (its own comment claimed 1.6 m — three disagreeing
  numbers). ~1.7× a real adult.
- **The citizens and pedestrians were ~2× too SHORT** (~1.0 m and ~0.8 m — toddlers among
  their own buildings), and the citizen torso was centred ON the ground so its lower half was
  buried and the head floated.

## The fix

`src/colony/scale.ts` is the single source of truth. Everything sizes off it:

- `METRES_PER_UNIT = 1`, `CELL_SIZE = 4`, `HALF_CELL = 2` — the anchor (the ~14 render layers
  that hardcode the literal `4` should migrate to `CELL_SIZE`; that mechanical sweep is a
  separate follow-up so this PR's diff stays about the visible proportion).
- `PLAYER_HEIGHT_M = 1.8`, `PLAYER_EYE_M = 1.6`, `PLAYER_RADIUS_M = 0.3`, and the DERIVED
  `PLAYER_HALF_HEIGHT` / `PLAYER_HALF_EXTENT` / `PLAYER_EYE_OFFSET`. `FirstPersonController`
  builds its collider, camera offset and respawn guardrail from these, so the three can never
  drift apart again.
- `CITIZEN_HEIGHT_M = 1.7` and `citizenFigure(height)`, which returns a feet-on-ground humanoid
  (torso capsule + head sphere) whose crown reaches the height and whose feet sit at y=0. Both
  `avatarLayer` (citizens) and `pedestrianLayer` (the ambient crowd) derive their figures from
  it, so the two crowds finally match each other and stand as real adults against the world.

Houses, trees, terrain and per-building commercial heights are the correct 1 m/unit reference
and are deliberately **not** touched.

## Not in this spec (surfaced by the audit, tracked separately)

- **The "giant red building" is a different bug**, not player scale: `CommercialBlock` is a
  ~100 m street SCENE instanced once per 4 m commercial cell, so ~25 copies fuse into one red
  wall. Fix is placement/instancing, not a scale constant.
- **The `CELL_SIZE` migration** of the ~14 hardcoded `4`s (pure refactor, behaviour-identical).
- **Commercial-district shell footprints** derive width/depth from cell counts used as world
  units (4× too small on their pads); mall/shop heights are sub-human.
- **Vertical relief anisotropy**: `heightScale` is applied to Y with no ×4 while X/Z get ×4, so
  the island renders ~4× flatter than its slope stats assume (mesh and collider agree, so it is
  a stylistic decision, not a bug).

## Verification

`tests/scale.test.ts` pins the anchor and the derived player/citizen geometry (capsule height,
eye height, feet-on-ground crown); `avatarLayer`/`pedestrianLayer` tests assert the 1.7 m adult
silhouette. Live GPU capture confirms the player now reads as a person beside the houses and
trees, and the citizens stand at his shoulder instead of his knee.
