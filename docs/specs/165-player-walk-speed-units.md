# Spec 165 — Player walk speed: one anchor, in metres (FP.SPEED.1)

- **Status:** proposed for review.
- **Depends on:** spec 146 (the world metric system — 1 world unit = 1 m, 1 cell = 4 m),
  spec 104 (first-person walk tuning), spec 149 (the walker capsule + bus ride pinning).
- **Supersedes the transit half of:** spec 164 (BUS.SPEED.1) — see "Relationship to spec 164 (BUS.SPEED.1)".
- **Design provenance:** operator report, "the bus is slower than I can walk", re-diagnosed.

## The defect, measured

The first-person player had **two movement integrators**, and they disagreed by **36%** because one
config number was read as **metres** in one place and **cells** in the other.

| Path                                              | Speed source                            | Walk         | Sprint (road) |
| ------------------------------------------------- | --------------------------------------- | ------------ | ------------- |
| `FirstPersonController.tsx` (the camera capsule)  | private literal `MOVEMENT_SPEED = 10`   | **10.0 m/s** | 14.5 m/s      |
| `runtime.ts` `driveFirstPerson` (the roster twin) | `COLONY.firstPerson.maxWalkSpeed` = 3.4 | **13.6 m/s** | 24.65 m/s     |

The capsule sets `10` straight onto a Rapier body as a **linear velocity**, and world units are
metres (spec 146), so it is 10 m/s. The twin ramps `3.4` — whose config comment claimed "world
units/sec" — and adds it to `citizen.pos`, which `citizenRoster.ts` (lines 40–47) documents as
**cells**. At `CELL_SIZE = 4` that is 13.6 m/s, and 3.4 × 1.25 (road) × 1.45 (sprint) = 6.1625
**cells**/s = **24.65 m/s** sprinting.

Neither path honoured the other's features: the capsule ignored `walkAcceleration`,
`roadWalkSpeedMultiplier` and `sprintChargeSeconds` **entirely**.

### The second defect the units gap hid

`runtime.fpCameraCell` is set from the capsule and is authoritative over the twin's `pos` wherever it
exists (`runtime.ts` ~line 2638), so **the capsule is what a player feels** — and it was moving a
1.8 m adult at **10 m/s = 36 km/h**, faster than Usain Bolt, through a world spec 146 deliberately
anchored at 1 unit = 1 metre.

## The decision: metres are authoritative

Spec 146 anchors 1 world unit = 1 metre and makes `src/colony/scale.ts` the single source of truth
for world size. A **cell is a grid index unit** (4 m of it); a speed the player feels belongs in the
world's base unit. So the **capsule keeps metres**, and the **roster twin — the path whose position
is in cells — is the one that converts**, through `mpsToCellsPerSec`.

### The value: 3.4 is metres, and always was

`maxWalkSpeed: 3.4` is the number its own comment always claimed. Three independent measures agree
it was meant as metres per second, and that reading it as cells is what broke:

1. **The NPC crowd walks at `spd` 0.5–0.9 cells/s** (`citizenRoster.ts:135,176`,
   `runtime.ts:4739–4848`). 3.4 m/s is **0.85 cells/s** — inside that band. 3.4 **cells**/s would be
   **4× the entire crowd**, a player sprinting past every pedestrian at all times.
2. **Guided auto-walk already moves the same avatar** at `c.spd` ≈ 0.8 cells/s = 3.2 m/s. Manual and
   guided walking now agree instead of differing 4×.
3. **`METRES_PER_UNIT = 1`**, so "world units/sec" and "m/s" are the same statement. The comment was
   right; the integration was wrong.

3.4 m/s (12 km/h) is a brisk human jog — fast enough to cross the ~2.4 km region, slow enough to read
as a person.

## What ships

**One anchor, one model:**

- `src/colony/scale.ts` — `PLAYER_WALK_SPEED_MPS = 3.4`, plus `mpsToCellsPerSec` /
  `cellsPerSecToMps`. The anchor lives beside `CELL_SIZE` because the defect was a units defect.
- `src/colony/playerSpeed.ts` (**new**) — THE locomotion speed model, pure and unit-labelled:
  `rampedGroundSpeedMps`, `rampedGroundSpeedCellsPerSec`, `playerTopSpeedMps`,
  `advanceWalkRampMps`, `advanceSprintCharge`, `isSprinting`. Both movers import it, so the ramp,
  the surface multiplier and the sprint budget have exactly one implementation.
- `src/colony/config.ts` — `maxWalkSpeed: PLAYER_WALK_SPEED_MPS`, no longer a second copy of the
  number. `walkAcceleration`/`walkDeceleration` re-labelled m/s² (they were being applied to a
  cell-space ramp, i.e. effectively 40 m/s² — instant).
- `src/colony/runtime.ts` — `fpWalkSpeed` is now **metres** per real second; the metres→cells
  conversion happens at the single point where the result reaches `c.pos`.
- `src/render/components/FirstPersonController.tsx` — the private literal is **gone**. The capsule
  now honours the acceleration ramp, the road multiplier and the sprint comfort budget.

**One latent bug fixed in passing:** the twin sampled the road multiplier at _its own_ cell, but
`fpCameraCell` (the capsule) is authoritative for where the player stands. It now samples at
`fpCameraCell ?? c.pos`, so the road bonus engages on the cell the player is actually on.

### Resulting speeds — identical on both paths

| State                    | m/s        | cells/s (twin) | km/h |
| ------------------------ | ---------- | -------------- | ---- |
| Walk, off-road           | **3.4**    | 0.85           | 12.2 |
| Walk, on road (×1.25)    | 4.25       | 1.0625         | 15.3 |
| Sprint, off-road (×1.45) | 4.93       | 1.2325         | 17.7 |
| **Top** (road + sprint)  | **6.1625** | 1.5406         | 22.2 |

## The transit consequence

The bus fleet is tuned in **cells per in-sol minute**, and an in-sol minute is 15 real seconds
(`REAL_SECONDS_PER_SOL_MINUTE`, added to `sol.ts`). At the shipped `busSpeedCellsPerMin: 28` the
fleet cruises 7.47 m/s. Measured on the real booted route (loop 1728.3 cells, 5 stops, legs
705.6 / 269.9 / 233.3 / 206.0 / 238.2 cells):

- Against the **old** 10 m/s capsule the bus lost to a **walking** player — the operator's report.
- Against the **corrected** player it still only **tied** a road-sprinting one door-to-door on the
  worst leg: **6.20 m/s against a 6.1625 m/s top speed = 1.01×**. Not a reason to board.

**`busSpeedCellsPerMin: 28 → 46`**, bounded on both sides by measurement rather than picked:

- **Lower bound ~40** — below it the worst real leg drops under 1.35× the player's top speed.
- **Upper bound 93.75** — above it a 16 ms frame advances a bus more than 0.1 cells, breaking the
  sub-frame continuity contract in `busSolContinuousMotion.test.ts`.
- **Realism ceiling** — a city bus is not a missile; 46 cruises **44.2 km/h**.

| Measure                           | Before (28)          | After (46)                |
| --------------------------------- | -------------------- | ------------------------- |
| Cruise                            | 7.47 m/s (26.9 km/h) | **12.27 m/s (44.2 km/h)** |
| Cruise vs player top speed        | 1.21×                | **1.99×**                 |
| Worst leg door-to-door (dwell in) | 6.20 m/s (1.01×)     | **9.19 m/s (1.49×)**      |
| Best leg door-to-door             | 7.05 m/s             | 11.17 m/s                 |
| `shiftMinutes` on real geometry   | 74.0                 | 49.5                      |
| Dispatch window                   | 1036 min             | 1060 min                  |
| Cells per 16 ms frame             | 0.0299               | 0.0491 (bound 0.1)        |

The dwell (`stopDwellMin: 1.5` = 22.5 real seconds) is **deliberately not cut**: it is the boarding
window a player needs to walk up and press E, and it is owned by the boarding work (BUS.BOARD.1).

## Relationship to spec 164 (BUS.SPEED.1)

Spec 164 (BUS.SPEED.1) diagnosed the same operator report as a **transit** defect and **merged**
`busSpeedCellsPerMin: 28 → 84` (22.4 m/s = **80 km/h**), sized entirely against the 10 m/s capsule.
It explicitly filed this units mismatch as a "Known adjacent defect, NOT fixed here… correcting it
changes walk feel across the whole game. Filed separately." **This is that follow-up, and it inverts
the diagnosis:** the bus was never the larger error. The player was moving at 36 km/h.

With the player corrected, that tuning would leave the bus **6.6× walking pace**. Its test
discriminations (`expect(preFix).toBeLessThan(WALK_MPS)`) also invert, because the pre-fix bus
(7.47 m/s) comfortably beats a 3.4 m/s walk. This spec therefore supersedes BUS.SPEED.1's transit
tuning and replaces `tests/busFeltSpeed.test.ts` with a version measured against the player's **top**
speed. Its genuinely orthogonal contributions — `REAL_SECONDS_PER_SOL_MINUTE`, the
`busCruiseSpeedMps`/`busLegSpeedMps` helpers, and its repair of the wall-clock-contaminated bound in
`busSolContinuousMotion.test.ts` — are kept and carried here.

**This spec REVISES merged work, and says so plainly.** Spec 164 merged as PR #430 while this branch
was in flight, so `main` now carries `PLAYER_WALK_SPEED_MPS = 10` and `busSpeedCellsPerMin: 84`. This
spec changes both. That is not a disagreement about transit: 84 is a correct answer to "beat a 10 m/s
player" and both numbers are downstream of the same units defect. Once the player is a human 3.4 m/s,
84 is an 80 km/h city bus at 6.6× walking pace, and 46 (44 km/h, 1.99× the player's top speed) is the
value measured against a real pedestrian. The felt-speed contract moved from
`WALK_MPS`-relative to **top-speed**-relative — full ramp, on a road, sprinting — because a rider who
could have sprinted there faster has no reason to board.

## Future consumers: vehicles, and the two things that will bite

Cars are next (grip, drift, tuning), and they hit this same seam. Recorded here so it is not
rediscovered inside a tyre model.

**Share the CONVERSION, not the player's speed.** The reusable parts are `mpsToCellsPerSec` /
`cellsPerSecToMps` (`scale.ts`) and `REAL_SECONDS_PER_SOL_MINUTE` (`sol.ts`). Walker
(`playerSpeed.ts`) and bus (`busFleet.ts`) both already derive from them; a car is the third
consumer, not a third definition. The first `carSpeedCellsPerMin` written without them reproduces
BUS.SPEED.1 exactly — a rate whose unit is invisible at the call site. But a car must **not** derive
from `PLAYER_WALK_SPEED_MPS`: that is a pedestrian's walking pace, not a world constant. The name
stays deliberately player-specific to prevent that coupling.

**Schedules run on sol time; physics runs on real time.** `transitTick` reconstructs fleet state from
`solMinutesSinceEpoch` and deliberately ignores sim speed _and_ pause — correct for a timetable,
which should be where the clock says it is regardless of how fast you are watching. It is wrong for
handling. Grip, weight transfer and tyre slip are integrations over **real** dt: driven off sol
minutes, pause or sim-speed would change how a car grips, and a single in-sol "minute" step is 15 real
seconds — meaningless for any integrator. Same metre anchor, different clocks. Do not reuse the
transit driver for vehicle physics to save code.

**The continuity bound cannot express a fast car.** `busSolContinuousMotion.test.ts` locks
"< 0.1 cells per 16 ms frame". In real units that is a ceiling of **25 m/s (90 km/h) for anything that
moves** — 0.1 × `CELL_SIZE` / 0.016. It is not a number to tune up: 93.75 cells/min _is_ 25 m/s, so
the bound and the bus's own upper limit are the same constraint. A racing car at 40 m/s is
0.160 cells/frame, **1.6× over**. The bound must be restated in real m/s and satisfied by
**substepping or swept/continuous collision**, not by capping speed — drifting into a kerb at 40 m/s
is exactly the case where discrete per-frame stepping tunnels through geometry.

**Sample the ground the way the road is drawn.** Anything reading surface height (suspension, grip)
must use the graded drape the ribbon actually renders — `leveledWorldYAt` / the shared road centre
line — not raw terrain and not a `Math.round` nearest-cell sample. Nearest-cell sampling is what
produced the 4 m plateau staircase that made walking bumpy (PR #410); a suspension reading it would
fight noise that is not in the world. Note the mesh is **triangulated, not bilinear** — the two
disagree inside a quad.

**On the numbering.** These two specs and this one all drafted against a moving target: BUS.SPEED.1
first claimed 162, then PR #427 (BUG.TRACK.1) landed 162 on `main`, so it moved to 164. This spec
first claimed 163, which PR #429 (BUS.BOARD.1,
`docs/specs/163-bus-route-stop-boarding-anchor.md`) had already taken, so it is 165. Current live
numbering: **162** bug-record lifecycle (merged), **163** bus route-stop boarding (#429), **164** bus
felt speed (#430, merged), **165** this.

## Tests

`tests/playerSpeedUnits.test.ts` — the parity lock. Both discriminations were **verified by
reintroducing the defect**, not asserted:

| Lock                                                                 | Discriminates?                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Config `maxWalkSpeed` IS the `scale.ts` anchor (no second copy)      | **Yes** — a re-forked literal fails it                                                                                    |
| Twin, driven through the real runtime, moves at the **metre** anchor | **Yes — verified.** Restoring the missing conversion makes it measure **13.6 m/s against 3.4** (and 17.0 vs 4.25 on road) |
| Road/sprint multipliers agree with the shared model on the twin      | **Yes — verified**, same run                                                                                              |
| Capsule speed comes from the shared model, in metres                 | **Yes — verified.** Re-adding `const MOVEMENT_SPEED = 10` fails the source lock                                           |
| Capsule honours ramp + road + sprint budget                          | **Yes** — dropping any of the three fails it                                                                              |
| Player stays human (top speed < 100 m world-record pace)             | **Yes** — the pre-fix twin sprinted at 24.65 m/s                                                                          |

`tests/busFeltSpeed.test.ts` — the fleet against the corrected player, driven by the **real** booted
route geometry. Cruise-beats-top-speed and every-leg-beats-top-speed discriminate against the shipped
28; the shift-fits and sub-cell-frame locks are stated in-file as **invariant guards, not proof**
(they pass at both values and exist to catch a future lowering / raise).

## Invariants preserved

- **`firstPersonDogfood.test.ts` "walks faster on roads than off-road"** still holds — the road
  multiplier moved into the shared model, it did not go away.
- **The deterministic sol-replay contract** — nothing about the transit driver changed; `transitTick`
  still reads only `solMinutesFracSinceEpoch(solNowMs())`.
- **Overnight parking / in-hours service** — asserted at 01:00 and 12:00 at the new speed.
