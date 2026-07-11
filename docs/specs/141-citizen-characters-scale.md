# Spec 141 — animated citizen characters + the world scale constitution (PLANNED)

Operator ask (2026-07-11, walking the v3 world in first person): "do we have midget
NPCs — plan their animated chars also … is that a door on the patio … i still feel like
a midget."

Status: **planned, not built**. Companion to spec 138 (Colony Slate). Asset work is
Jack's (§4). The scale findings below are measured from the code, not vibes.

## 0. Diagnosis — why everything feels the wrong size

The world is 4 units per cell, 1 unit = 1 metre (spec 118/129). Three families of
content never got the spec-129 rescale that houses got:

| thing               | today                                                            | reads as |
| ------------------- | ---------------------------------------------------------------- | -------- |
| citizen avatars     | capsule r 0.16, len 0.44 + head at 0.86 lift → **~1.0-1.1 m tall** ("kept verbatim" from the 1-unit legacy world, `avatarLayer.ts:12-15`) | toddler-sized "midget NPCs" |
| FP eye height       | capsule centre + 0.6 → **~2.1 m** (`FirstPersonController.tsx`)   | okay alone, but… |
| house doors         | `doorH = min(2n-1, n + floor(n/2))` micro-courses at 0.88 m/course (`houseBuilder.ts:405`) → **3.5-5.3 m openings** | you're a hobbit at a giant's door |

So the operator is simultaneously a giant among 1 m citizens and a midget under 4-5 m
doors. (The "door on the patio": that freestanding dark column with the light lintel
band and handle block IS the house front door — `placeDoor` runs LAST and "seats a
panelled door, overriding any wall/rail in the column"; when the blueprint puts an
OUTDOOR patio room behind the street edge, the walls retreat but the door still seats
on the street-edge door cell — a doorway standing alone on the patio. Fix in §3.)

## 1. The scale constitution (canonical metric chart)

All humanoid/architectural content measures against this table; every future asset PR
quotes it:

| metric                     | value        |
| -------------------------- | ------------ |
| adult citizen height       | **1.80 m**   |
| FP eye height              | **1.70 m**   |
| door opening               | **2.4-2.6 m** (3 micro-courses ≈ 2.64 incl. lintel) |
| storey (floor-to-floor)    | ~3.5 m (4 courses, unchanged) |
| kerb/step                  | ≤ 0.25 m     |
| signal pole / stop sign    | 5.8 m / 3.3 m (spec 137, already right) |

## 2. Animated citizens — tiered plan

- **Tier 1 — hero citizens (the roster, ≤ AVATAR_CAP 64):** Jack's skinned
  `citizen-base.glb` (§4), one clone per citizen, per-citizen material tint replacing
  today's identity colors (operator cyan / pod purple / lavender — keep the SAME hex
  language on the jumpsuit accent so identity survives the upgrade,
  `avatarColorHex`). One shared `AnimationMixer` clock; clip choice from the existing
  per-frame avatar source: speed > 0.2 → `Citizen_walk` (rate scaled to speed),
  else `Citizen_idle`; `Citizen_wave` fires when FirstPersonView lists them in
  `neighbours` within 6 m of the player (the wave the view already narrates).
  LOD: full skinned mesh within 60 m of the camera, today's capsule instancing beyond
  (the instanced path STAYS as the far tier — zero new draw pressure at distance).
- **Tier 2 — pedestrians (crowds, `pedestrianLayer.ts`):** stay instanced primitives
  in v1 but RESCALED to the chart (1.7-1.8 m) with the existing bob; skinned crowds
  are a non-goal until instanced-skinning is worth it.
- **Joe the Crab** keeps `joe-crab.glb` (spec 078) — already animated, already scaled.
- **Tarentaal, bus, cars** unaffected.

## 3. Scale repairs (code, no assets needed — Phase A)

1. Avatar/pedestrian primitives ×~1.7: body capsule r 0.26 len 0.78, head r 0.20 at
   lift 1.46 (keeps proportions; `AVATAR_BODY/AVATAR_HEAD` constants + pedestrian
   equivalents; update pinned constant tests).
2. Blueprint doors to 3 courses: change `doorH` formula to `n` clamped to ≥ 2.6 m
   equivalent (3 courses at n=3); lintel + handle courses follow (`houseBuilder.ts:405-407`).
   Re-run houseScale/blueprint tests; visual pass on 2-3 seeds.
3. FP eye to 1.70: retune the capsule (halfHeight 0.55, radius 0.35 → 1.8 m tall,
   0.7 m wide) and `camY = pos.y + 0.55`; this NARROWS the collider too (today's
   radius-1 capsule is 2 m wide — part of why doorways can't be entered). Must re-walk
   the spec-134 guardrail behaviour after (heightfield unchanged, capsule smaller).
4. Door-on-the-patio: `placeDoor` seats the door at the ENCLOSED-ROOM boundary when
   the street-edge cell is an outdoor room — walk inward along the door column until
   the first enclosed cell (fallback: keep street edge if none). Pinned test: a
   blueprint with a front patio gets its door on the inner wall, not the patio lip.

## 4. Jack's work order — `citizen-base.glb`

Branch `jack/citizen-base-glb`, PR to `r3f-colony-migration`. File:
`public/assets/citylife/avatars/citizen-base.glb`. Conventions as joe-crab (spec 078)
+ the spec-138 rules: metres, +Y up, faces **+Z** (matches `avatarTransform` yaw math),
origin at feet centre.

- One androgynous low-poly citizen, **1.80 m tall**, ≤ 8 k triangles, textures ≤ 256²,
  embedded, file ≤ 300 KB. Style-matched to the flat-shaded voxel world (no PBR
  texture detail — solid material slots).
- Material slots (exact names): `skin`, `jumpsuit` (the tintable identity surface),
  `boots`. No baked identity color — the renderer tints `jumpsuit`.
- Skeleton ≤ 18 bones (hips, spine, chest, head, 2×(shoulder/elbow/wrist),
  2×(hip/knee/ankle)). No fingers.
- Clips (exact names; loop flags in GLB): `Citizen_idle` 2.4 s loop (weight shift,
  slow look), `Citizen_walk` 0.8 s loop (full stride at 1.4 m/s reference speed),
  `Citizen_wave` 1.2 s once (right arm), `Citizen_talk` 2.0 s loop (gesturing),
  `Citizen_sit` 1-frame pose (bench-compatible: hips at 0.45 m).
- Acceptance tests in the same PR (`tests/citizenBaseGlb.test.ts`, joe pattern): raw
  import parses, height 1.80 ± 0.05 from bbox, slot + clip names exact, durations
  ± 0.05 s, tri budget.

Queue line: `/queue jack Build citizen-base.glb per docs/specs/141-citizen-characters-scale.md §4 — 1.8 m skinned citizen with 5 clips + acceptance tests, branch jack/citizen-base-glb.`

## 5. Order of work

Phase A (code-only scale repairs, §3) ships first and instantly fixes "midget NPCs /
midget me" — it needs no assets. Phase B lands Jack's hero citizens behind the LOD.
Phase C (pedestrian polish, sit/talk usage at benches and shops) rides later specs.
Spec 138's slate + sprint HUD are orthogonal and can land in any order.

## 6. Non-goals (v1)

Instanced skinned crowds, clothing variety, facial animation, per-citizen bodies,
ragdolls, child citizens (the colony's 1 m people were never children — they were a
scale bug).
