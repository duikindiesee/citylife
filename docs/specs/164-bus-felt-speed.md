# Spec 164 — Bus felt speed: the fleet must beat a walking player (BUS.SPEED.1)

- **Status:** proposed for review.
- **Depends on:** spec 149 (bus depot + fleet), spec 150 PR2 (the fleet on canonical sol time),
  spec 146 (the world metric system — 1 world unit = 1 m, 1 cell = 4 m).
- **Design provenance:** operator report from the live world, "the bus is slower than I can walk".

## The defect, measured

The fleet is tuned in **cells per in-sol minute**. A player is tuned in **metres per real second**.
An in-sol minute is **15 real seconds** (`MS_PER_SOL / MINUTES_PER_SOL`), and a cell is 4 m. Nothing
in the codebase converted between the two units, so the two numbers were never comparable and the
mismatch shipped.

Measured on the live route (`ColonyRuntime` boot, real `fleetGeom`; loop 1728.3 cells = 6913 m,
5 route stops, legs 206–706 cells):

| Thing                                              | Rate as configured                    | **Metres per REAL second** |
| -------------------------------------------------- | ------------------------------------- | -------------------------- |
| Bus cruise (before)                                | `busSpeedCellsPerMin: 28`             | **7.47**                   |
| Bus door-to-door, avg leg incl. one dwell (before) | —                                     | **6.63**                   |
| Bus door-to-door, best leg (before)                | —                                     | 7.05                       |
| Player walk                                        | `MOVEMENT_SPEED = 10` (Rapier linvel) | **10.0**                   |
| Player sprint                                      | `× sprintWalkSpeedMultiplier 1.45`    | **14.5**                   |

**The bus lost to a walking player by 25% before a single dwell was paid.** The operator report is
exact and the cause is the unit gap, not the schedule: `shiftMinutes` and the 05:00–23:30 window were
correct the whole time.

### Speed, dwell, or both?

**Primarily speed.** Cruise alone (zero dwell) was already below walking pace, so no dwell change
could have fixed it. Dwell is a real but secondary drag: `stopDwellMin: 1.5` is **22.5 real seconds**
standing still, which cost ~11% of the effective speed before this change and costs ~27% after it.

The dwell is **deliberately not cut here**. That same number is the boarding window a player needs to
walk up to a stopped bus and press E, and it is owned by the boarding work (BUS.BOARD.1). Speed alone
clears "meaningfully faster than walking" on every real leg, so shortening the dwell is a
boarding-side decision to be made against boarding evidence, not a speed-side one.

## What ships

**Units, made explicit** — the root cause was that no shared anchor existed:

- `src/colony/sol.ts` — `REAL_SECONDS_PER_SOL_MINUTE` (15).
- `src/colony/scale.ts` — `PLAYER_WALK_SPEED_MPS` (10), beside `CELL_SIZE`. It was a private literal
  inside `FirstPersonController.tsx` that only that file knew about; the controller now imports it.
- `src/colony/transit/busFleet.ts` — `busCruiseSpeedMps(cfg)` and `busLegSpeedMps(cfg, cells)`. The
  comparison is now a function the tests can assert rather than arithmetic in a reviewer's head.

**The tuning** — `busSpeedCellsPerMin: 28 → 84` (22.4 m/s cruise). The value is bounded on BOTH sides
by measured constraints rather than picked:

- **Lower bound 54.4** — below it the bus does not beat a sprinting player (14.5 m/s).
- **Upper bound 93.75** — above it a 16 ms frame advances a bus more than 0.1 cells, breaking the
  sub-frame continuity contract of `busSolContinuousMotion.test.ts`.

Result: cruise 2.24× walk / 1.54× sprint; door-to-door 13.9–19.0 m/s per leg (1.39–1.90× walk) once
the 22.5 s dwell is paid.

## Invariants preserved

- **A whole shift still fits before `lastServiceMin`.** Raising cruise speed _shortens_
  `shiftMinutes` (74.0 → 32.3 min on the real geometry), so the dispatch gatekeeper gets slacker, not
  tighter. `300 + 32.3 < 1410`, and the dispatch window (1077.7 min) still exceeds
  `busesOwned × breakMin` (90).
- **The deterministic sol-replay contract.** Nothing about the driver changed: `transitTick` still
  reads only `solMinutesFracSinceEpoch(solNowMs())`, so the same sol minute reproduces the same fleet
  and sim speed still does not move it (`transitSolDriver.test.ts` unchanged and green).
- **Overnight parking / in-hours service.** A faster bus finishes sooner; it must not therefore be
  caught out after close nor vanish during service. Asserted at 01:00 and 12:00.

## A repaired test, not a relaxed one

`busSolContinuousMotion.test.ts`'s first lock bounded the two-frame chord by an absolute `< 0.1`
cells. That bound was **wall-clock contaminated**: `setSolDebugOffsetMs(offset + 16)` advances the sol
clock by 16 ms _plus_ however long the runner took between the two samples, so the assertion only held
while the bus was slow enough to absorb tens of milliseconds of runner jitter. It is now:

1. **Rate-derived and drift-immune** — the chord is bounded by the arc the bus could physically have
   covered in the window that actually elapsed (`chord ≤ arc ≤ cruise × dt`), with the window
   bracketed around _both_ driver reads. This is the real no-teleport contract and it is strictly
   stronger than the magic constant.
2. **Plus a clock-free design bound** — the _designed_ per-16 ms advance stays sub-cell (`< 0.1`),
   which is what "no coarse cell jumping" actually meant.

Verified to discriminate: injecting a 10× advance into `stepFleet` fails it (215–257 cells against a
0.095 bound).

## Tests

`tests/busFeltSpeed.test.ts`, driven by the **real** booted route geometry, not a hand-written
fixture that can drift from it. Each lock re-evaluates its own predicate against the pre-fix value:

| Lock                                                          | Discriminates?                                                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cruise beats walk × 1.5 and beats sprint                      | **Yes** — pre-fix 7.47 < 15                                                                                                                                          |
| Every real leg beats walk × 1.25 door-to-door, dwell included | **Yes** — pre-fix worst leg 7.05 < 12.5                                                                                                                              |
| A whole shift still fits before `lastServiceMin`              | **No — invariant guard, stated as such in the test.** It passes at both values, because raising speed only shortens a shift. It exists to catch a future _lowering_. |
| A 60 Hz frame's travel stays sub-cell                         | **No — invariant guard, stated as such.** The slower pre-fix bus also satisfied it. It pins the upper bound on any future raise.                                     |
| Fleet parked at 01:00, running at 12:00                       | **No — regression guard** against a faster shift finishing outside the window.                                                                                       |

## Known adjacent defect, NOT fixed here

`ColonyRuntime.driveFirstPerson` moves the roster twin at `COLONY.firstPerson.maxWalkSpeed = 3.4`
per second, added directly to `citizen.pos`, which `citizenRoster.ts` documents as **cells** — so the
headless twin walks 13.6 m/s (24.65 m/s sprinting on a road) while the capsule the camera rides does
10 m/s. The comment on `maxWalkSpeed` says "world units/sec", so one of the two is wrong. It does not
affect this fix (`fpCameraCell` from the capsule is authoritative wherever it exists, and the twin is
_faster_, so the bus still wins against either), and correcting it changes walk feel across the whole
game. Filed separately.
