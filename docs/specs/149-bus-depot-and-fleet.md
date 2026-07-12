# Spec 149 — the Bus Depot: a real fleet with a home, hours, and a door for the player

Operator ask (2026-07-11): give the town bus a DEPOT it parks at overnight, operating
hours on the sim clock (first departures 08:00, service until 23:00), breaks at the
depot between shifts, STAGGERED dispatch (no bus leaves until the previous one reached
its first stop), boarding at the depot, and first-person boarding for the player. Also
fix the bus's physical presence: it is far too small and floats above the road instead
of riding on its tires.

Numbering: this shipped first as spec 149, but by the time it merged the sibling v3
branches had landed `140-no-roads-on-beaches.md` on the same number, so it was renumbered
to 149 (the next free slot after 148) in a follow-up. Code comments and tests were updated
to match; the base's spec-140 (no-roads-on-beaches / `forbidBeach`) references are a
different spec and stay 140.

Status: **built in the same PR** (Phase 1, primitive depot). Jack's `bus-depot.glb`
(work order §6) swaps in later without code changes beyond the loader gate.

## 0. Design thesis

The spec-088/122 bus is a screensaver: one toy-sized coach, conjured onto the loop at
boot, driving forever, touchable by nobody. This spec turns it into a SYSTEM the player
can stand inside: five real buses that live somewhere, wake up at 08:00, pull out one
at a time, take breaks, come home at 23:00 — and stop long enough for you to get on.

Three principles:

- **The schedule is a pure state machine** (`src/colony/transit/busFleet.ts`), stepped
  in SIM-MINUTES, blind to three.js and the DOM. Dispatch gating, operating hours and
  break rotation are unit-tested in node exactly like `busRoute`. The renderer only
  asks "where is bus i right now" and draws it.
- **The depot is land, not a decal.** A surveyed pad reserved out of the buildable land
  (the commercial-reserve discipline from `src/colony/commerce/district.ts`), connected
  to the bus loop by a REAL spur road (the rally-spur precedent, runtime.ts), so buses
  physically ride into the plot. Houses can never spawn on it.
- **The bus obeys the world metric system** (1 unit = 1 m, 1 cell = 4 m — the sibling
  metric-scale spec): a city bus is 12 m long and 3 m tall with 0.5 m-radius wheels
  whose tires touch the road surface. No more 2.55 m toy hovering 0.2 m in the air.

## 1. The depot plot

**Siting** (`src/colony/transit/busDepot.ts`, pure + deterministic in (terrain,
roadKind, busRoute.loop, blocked)):

- Pad size `COLONY.transit.depotLongCells x depotDeepCells` remains **12 x 7 cells**
  (48 x 28 m), but the active bay row is sized to the five owned coaches rather than ten
  speculative purchases.
- Scan the bus-route loop cells in order; for each, try pad placements adjacent to
  that cell in the four cardinal orientations. A candidate must be in-bounds, dry,
  unclaimed **and flat enough**: the maximum minus minimum raw `terrain.worldY` over
  every footprint cell may not exceed `depotMaxHeightSpreadM` = **1.5 m**. A steep
  candidate is rejected and scanning continues through gaps, loop cells and orientations.
- `roadKind` centre cells are not enough: smoothed four-cell `roadWays` ribbons can cover
  nearby cells that are absent from the logical road set. The shared
  `placementValidation.ts` contract computes a conservative blocked-cell approximation from
  `ribbonCoverage` smoothing/width samples; `plotRoadOverlapCells` rejects every rectangular
  plot/pad with a non-empty result. Runtime feeds that footprint into the forbidden depot set
  before scanning. The depot footprint must be disjoint from every pre-existing conservatively
  sampled ribbon cell; the separately tagged `depot-spur`, created only after a site wins, is the
  single named access exception. Seed 4242 permanently checks this after the old cell-only guard
  allowed **18 road-covered cells beneath the apron**.
- Returns `DepotSite { x, y, w, h, gate: Cell, roadCell: Cell, facing: 0|1|2|3 }` —
  `gate` is the pad-edge cell the buses drive through, `roadCell` the loop cell the
  spur meets. Null when no site fits (that seed keeps the legacy single cosmetic bus;
  fail-soft like the rally spur).

**Runtime boot** (after `makeBusRoute`, after the rally spur, so the loop is
unchanged): reserve the pad cells with `reserveParcelLand`, lay the spur
`gate -> roadCell` with the existing `layRoad(half=1)` + `mergeAvenue` (a real,
ribbon-rendered, drivable road), and record `DepotPlan { site, spurPath }` on the
runtime as `busDepot`. It also publishes the pad AABB to `state.busDepotPad`
(`{x, y, w, h}`, origin-anchored) — the ONE rect the renderers key off.

**The pad rect grades AND clears** (spec 128/137 discipline applied to transit land).
`state.busDepotPad` is consumed by two render passes that must agree on one footprint,
or the pad drifts from what stands on it:

- **Grading** (`useTerrainLeveling.ts` §2b) is balanced cut-and-fill. The drive plane
  is the midpoint of the footprint's natural minimum and maximum (dry-floor clamped),
  so the uphill half is cut and the downhill half is filled instead of seating from one
  arbitrary centre sample. A separate `Depot_Foundation` retaining volume extends from
  beneath the thin `Depot_Apron` course to below the lowest natural pad edge. Their small
  overlap and the foundation's wider footprint prevent floating downhill edges, sand
  breakthrough, torn asphalt shards and full-seam z-fighting.
- **Driveway seam.** Every `state.busDepotSpurCells` terrain cell is seated exactly to its
  road-ribbon surface. The generic shallow-fill deadzone is deliberately disabled for
  this bus-owned spur, so even a sub-0.6 m hollow cannot open a visible gap at the gate.
  The tagged spur remains in simulation and minimap topology but is not drawn as a second
  generic marked ribbon. One named `Depot_Driveway` mesh supplies the visible connection:
  a shallow flared throat meeting the apron boundary and overlapping the carriageway while public
  edge paint is suppressed at its mouth. This avoids the old doubled asphalt, zebra paint and
  square seam.
- **Foliage clearing** (`R3FFoliage.tsx`): pushes the pad onto the same tree-exclusion
  `rects` array the neighborhood lots, commercial parcels and junction zones already
  use, so `calculateFoliagePositions` culls every tree in the pad + a 1-cell canopy
  margin. Without this, conifers grew straight across the apron and parking bays and
  half-buried the parked fleet (the operator bug, 2026-07-11) — the exact class of
  "trees on houses is a big no" defect spec 128 fixed for lots. The gate spur is a real
  road and is cleared by the roads pass; the whole depot GLB + bays sit inside the pad
  AABB, so the one rect covers the whole footprint. `foliageSignature` tracks the pad so
  the trees rebuild if it ever appears/moves, matching `levelingSignature`.

**Layout inside the pad** (`depotLayout(site)`, pure): a centred row of **5 bays**,
one per owned coach. Their centres span the long edge at a 2-cell / 8 m pitch (with a
one-cell end margin), so adjacent 2.5 m-wide coach bodies retain a plainly visible gap
from oblique ground views instead of fusing into one yellow block. The apron lane,
boarding shelter + sign and office remain inside the shared pad AABB.

## 2. The fleet state machine

`src/colony/transit/busFleet.ts` — pure. Geometry contract (grid-space lengths only,
computed once at boot from the smoothed loop + spur + bay paths):

```ts
interface FleetGeometry {
  loopLen: number;      // length of the SMOOTHED loop (what buses drive)
  joinT: number;        // loop distance where the spur meets it
  spurLen: number;
  bayLen: number[];     // per-bay path length, gate -> bay
  stopsT: number[];     // stop positions as loop distances, ascending
}
```

Per-bus state: `mode` is one of `parked | bay-out | depot-stop | spur-out | service |
spur-in | bay-in`, plus `t` (distance along the current path), `lapT` (loop distance
travelled since joining), `dwell` (sim-minutes left standing at a stop, doors open)
and `breakUntil` (sim-minute-of-day the bay break ends).

`stepFleet(fleet, dtMin, clockMin, geom, cfg)` advances every bus by
`dtMin * cfg.busSpeedCellsPerMin` along its current path and applies the rules:

- **Hours.** Departures only in `[firstDepartureMin, lastServiceMin)` = 08:00–23:00.
  At/after 23:00 (or when a break is due) a bus in service finishes its current run to
  `joinT`, rides the spur home, backs into ITS bay (bus i owns bay i) and parks.
  Overnight all owned buses are `parked`.
- **Staggered dispatch.** One global gate: a newly dispatched bus HOLDS it from bay-out
  until its `lapT` passes the first stop after `joinT`. While held, no other bus may
  leave its bay. Released the moment the first stop is reached (dwell there included).
- **Depot boarding stop.** Every departure pauses `depotBoardMin` at the shelter
  (mode `depot-stop`, doors open) before taking the spur — the depot is a boarding
  location. Returning buses pause there too, so riders can alight at the depot.
- **Stops.** In service, a bus dwells `stopDwellMin` (doors open) at each `stopsT`
  crossing; passing `joinT` after `lapsPerShift` full laps (or after hours) exits to
  the spur.
- **Breaks.** Parking after a shift sets `breakUntil = clockMin + breakMin`. A bus is
  dispatch-eligible only when parked, past `breakUntil`, inside hours, and the gate is
  free — so buses rotate: out, one lap, home for a break, out again.
- **Fleet size.** `busesOwned` = `baysTotal` = 5. The visual depot is sized to the
  fleet that actually exists; a future purchase spec must expand the layout deliberately
  rather than reserving five dark, permanently empty bays today.

**Time coupling.** The runtime steps the fleet from its rAF loop with
`dtMin = dtReal * speed * stepsPerSec * simMinPerStep` (= 9 sim-min/s at 1x), zero
while paused — buses freeze with the sim and their clock-gated schedule stays honest
at any speed. This deliberately diverges from the old wall-clock cosmetic bus: hours
are meaningless on a clock the bus ignores.

**The speed tradeoff (learned the hard way).** The live loop measured ~1356 cells
(5.4 km) — buses cannot be BOTH eye-realistic on screen AND clock-realistic on the
540x-compressed sim day. A first cut at 0.6 cells/min looked right per frame but made
a lap 38 sim-hours, so the fits-before-close rule collapsed the dispatch window to
one minute and exactly one bus ever left. The schedule is the operator's ask, so the
clock wins: at `busSpeedCellsPerMin` = 3.5 a lap + dwells is ~9 sim-hours, the
dispatch window runs 08:00→~14:00, all five buses are out (staggered) by ~13:00 and
the last is parked again before 23:00. On screen that is ~31 cells/s at 1x — brisk
time-lapse traffic, same aesthetic family as the ambient cars against a 160 s day.

## 3. The player rides the bus

Boarding builds on the EXISTING first-person affordance — the
`FirstPersonView.interactionPrompt` + `activateFirstPersonInteraction()` (E key / the
"Use E" button) path — not a new UI:

- The prompt union gains kind **`bus`**. The pure `firstPersonView()` still knows
  nothing about buses; the runtime OVERRIDES the prompt in its ui-state assembly (the
  same layer that injects mood extras) whenever a fleet bus is DWELLING with doors
  open within `interactionPromptMaxDistance.bus` = 3 cells of the walker: label
  `Board bus {i+1}`. While riding, the prompt is `Exit bus` whenever the bus is
  dwelling (any stop, or the depot shelter) — you can ride as long as you like and
  step off at any stop.
- `activateFirstPersonInteraction()` handles the bus branch first: board pins the
  citizen to the bus (`fpRidingBusId`); each frame the runtime sets the rider's
  roster pos/target/heading to the bus pose, so `stepAvatars`/wander can never fight
  the pin. WASD is ignored while riding. Alight clears the pin and places the walker
  one cell to the bus's door side.
- **The camera is a capsule, and it rides too.** The v3 first-person camera is NOT
  the roster citizen — it is an independent Rapier capsule
  (`FirstPersonController`). Three bridges keep player and data coherent: (1) while
  riding, the controller pins the capsule (and camera, at seated eye height 2.4 m)
  to the live bus pose each frame — mouse look stays free; (2) the controller
  reports `runtime.fpCameraCell` every frame, and bus prompts measure from THERE,
  so "Board bus" appears when the PLAYER stands at the shelter, wherever the roster
  twin is; (3) one-shot `fpTeleportRequest` orders (issued by alighting and by
  `debugPlaceFirstPerson`) land the capsule, so stepping off drops your eyes on the
  kerb facing the departing coach.
- Works identically at a route stop or at the depot shelter — requirement "the depot
  is also a boarding location" falls out of the same dwell rule.

Non-goal (v1): NPC passengers riding visibly. Citizens keep their stroll AI; the
boarding affordance is player-first. A future spec can seat pedestrians during dwells.

## 4. The bus body — metric, grounded, alive

`buildBus()` (busLayer.ts) is rebuilt against the metric anchor, keeping every node
name the visual test asserts:

| thing | old | new |
| --- | --- | --- |
| body length | 2.55 m | **12.0 m** (three 4 m cells) |
| body width | 0.86 m | **2.5 m** |
| roof height | ~1.05 m | **3.0 m** |
| wheels | r 0.18 m, floating 0.2 m up | **r 0.5 m**, tire bottom at local y=0 |
| axles | x ±0.82 | x **±3.6** (7.2 m wheelbase) |

The group origin IS the road contact plane: `place()` sets
`y = max(0, getSmoothRoadY(x,y)) + ROAD_RIBBON_LIFT` — the top of the rendered road
ribbon (`roadSurface.ts` / `roadRibbon.ts` contracts) — so tires meet asphalt exactly.

Riding on the road, not through it:

- **Slope pitch.** Sample the road surface a half-wheelbase ahead and behind along
  the heading; pitch the body by `atan2(dy, wheelbase)` (rotation order `YZX`: yaw
  then pitch) so the bus climbs spec-130-graded roads nose-up instead of knifing
  through the grade.
- **Wheel spin.** Wheels rotate by `distanceTravelled / wheelRadius` each frame —
  stopped at stops, rolling between them.
- **Body sway.** A small speed-scaled roll (`swayAmp` = 0.015 rad, sinusoidal in
  distance) on the BODY group only (wheels stay planted), plus a gentle idle
  compression at stops. Cheap, per-frame, no physics.

All tunables live in `COLONY.transit` (config.ts, AGENTS rule — no magic numbers).

## 5. Rendering

`R3FBus.tsx` keeps its mount point and `bus` group name but now renders the FLEET:
when `runtime.busDepot` exists it draws `busesOwned` coaches at the poses the runtime
computed this frame (grid pose -> world via wx/wz + road clamp above), the stop
markers, and the depot; when there is no depot site (or no route) it falls back to
the legacy single self-driving coach, so old seeds and the existing `bus.spec.ts`
behaviour survive.

**Depot placeholder (Phase 1, primitives)** `busDepotLayer.ts`: a deep cut-and-fill
apron surface plus `Depot_Foundation`, 5 painted owned-fleet bay boxes, office, boarding
shelter and emissive `BUS` sign. Runtime node names are `Depot_Apron`,
`Depot_Foundation`, `Depot_Bay_00..04`, `Depot_Office`, `Depot_Shelter`, `Depot_Sign`.
The authored GLB may retain spare bay nodes, but a loader must only expose the active
fleet-sized row.

## 6. Jack's work order — `bus-depot.glb`

Precedent: joe-crab.glb (spec 078: committed GLB + raw-import test + renderer gate)
and the 138 §5 order format. Branch `jack/bus-depot`, PR to `r3f-colony-migration`.
File: `public/assets/citylife/props/bus-depot.glb`.

**Content & conventions**

- Units metres, +Y up. Origin at the PAD CENTRE, ground plane y=0. Footprint exactly
  **48 x 28 m** (12 x 7 cells); +X is the GATE edge (the renderer yaws the whole prop
  to the surveyed `facing`).
- Drive-in apron with painted lane arrows from the gate; **10 marked bays** along the
  -X edge, each **4 m wide x 13 m deep** (sized for the corrected 12 m bus, nose-in),
  numbered 1–10 on the slab; a small flat-roofed office (~6 x 4 x 3.5 m) at the
  gate-side corner; a boarding shelter (~6 x 2.5 m, bench + route board) beside the
  gate lane with a lit **BUS** totem sign.
- Nodes (exact names, they are code contracts): `Depot_Apron`, `Depot_Bay_00` ..
  `Depot_Bay_09` (separate meshes so the code can tint the five owned bays),
  `Depot_Office`, `Depot_Shelter`, `Depot_Sign` with material slot named exactly
  `sign` (emissive; the code drives night intensity like the shop signs).
- Keep the apron VISUALLY OPEN — no fences/kerbs across the gate edge or between
  bays and apron; the buses are separate live meshes that must read as parked inside
  your bays. Nothing taller than 0.05 m on bay floors or the apron drive path.
- Budgets: ≤ 25 k triangles, textures ≤ 1024² total, everything embedded, file
  ≤ 800 KB. No lights, no cameras in the export.

**Jack's acceptance tests (same PR)** `tests/busDepotGlb.test.ts`: raw import parses;
all 15 named nodes present; `sign` material slot exists; apron bounding box within
0.5 m of 48 x 28; bay meshes ≥ 4 m wide; triangle budget respected.

Queue line for the operator:
`/queue jack Build bus-depot.glb per docs/specs/149-bus-depot-and-fleet.md §6 — 48x28 m drive-in bus depot, 10 marked 4x13 m bays, office + boarding shelter + lit BUS sign, exact node names, on branch jack/bus-depot.`

## 7. Phases, tests, acceptance

**Phase 1 (this PR).** Everything above with the primitive depot. Tests:

- `tests/busFleet.test.ts` — pure machine: parked overnight; nothing before 08:00;
  first dispatch at 08:00; bus 2 stays in its bay until bus 1 passes its first stop;
  all five dispatch in order; dwells at stops; break rotation (home after
  `lapsPerShift`, waits `breakMin`, redispatches through the gate); everyone home
  and parked after 23:00; all five bays remain single-occupancy.
- `tests/busDepot.test.ts` — siting: pad adjacent to the loop, never on blocked/water
  cells, deterministic, rejects >1.5 m footprint relief and remains fail-soft; layout:
  five active bays inside the pad at >=1.5-cell pitch with distinct bay paths.
- `tests/busDepotLayer.visual.test.ts` — apron top equals the shared drive plane,
  foundation bottom reaches below the lowest natural edge, and exactly five separated
  bay meshes render.
- `tests/busDepotFoliage.test.ts` — the pad clears its trees: on the live seed 4242
  (pad ≈ world (768, -422)) the depot footprint grows 177 conifers without the
  exclusion and ZERO with it (non-vacuous guard proves the exclusion, not the biome,
  clears them).
- `tests/busLayer.visual.test.ts` (extended) — metric dims (length 12 ±0.1, roof
  3.0 ±0.1), wheel radius 0.5 with tire bottom at local y ≤ 0.01, node names intact.
- e2e `e2e/busDepot.spec.ts` (WebGL — judge with `--workers=1`): at 02:00 all five
  buses are parked with poses inside the depot pad; set 07:58 and watch the first
  departure land at/after 08:00; assert bus 2 holds until bus 1's `lapT` passes the
  first stop; board: step into a citizen, place them at the depot shelter, wait for
  a dwelling bus, fire the `Board bus` prompt via
  `activateFirstPersonInteraction()`, assert the rider's position tracks the bus,
  then `Exit bus` at the next stop. Runtime exposes `debugSetClock(h, m)` and
  `debugPlaceFirstPerson(x, y)` (dev/e2e helpers, same family as the dogfood
  driver) to make this deterministic.
- e2e `e2e/busDepotFoliage.spec.ts` (WebGL — `--workers=1`): asserts on what is
  RENDERED — queries the `foliage` InstancedMesh and proves zero instances fall inside
  the depot pad AABB with the fleet parked, then frames World View on the pad and
  screenshots the apron + bays + shelter clear of trees.
- e2e `e2e/busNetworkMiniMap.spec.ts` (WebGL — `--workers=1`): proves the compact
  map remains visible in street and World View, contains every road way, every route stop,
  the depot and all five coaches, and observes a live coach marker move during service.

**Phase 2 (Jack's GLB).** Loader gate swaps the primitives for `bus-depot.glb` by
node-name contract; `busDepotGlb.test.ts` lands with the asset PR; screenshot pass.

**Phase 3 (future specs).** Buying buses 6–10 (bays already exist); NPC passengers
seated during dwells; route timetable on the shelter board; the slate (spec 138)
showing next-bus ETA.

**Acceptance (operator walk-test):** at night the depot holds five visibly separated
parked buses in five marked bays on a flush, grounded apron; at 08:00 the first bus
pulls out of its bay, pauses at the shelter,
rides the driveway onto the loop; the second leaves only after the first reaches its
second stop; a bus next to the walker is a real 12 m, 3 m-tall vehicle with turning
wheels sitting ON the asphalt; E at a dwelling bus boards, the camera rides, E at any
later stop steps off; at 23:00 the streets drain and the bays refill; suite +
typecheck + e2e green.

## 8. Non-goals (v1)

Fares, capacity limits, NPC riders, multiple routes, articulated/double-decker
variants, depot fuel/maintenance sim, bus purchase UI (a future purchase spec expands
the physical depot and bay row together).

## 9. Collision-free operations (operator hardening, 2026-07-11)

Operator ask: buses must drive into the depot, park, and pull out WITHOUT bumping other
buses or cars — "no collision in the depot" — with lanes, a random parking bay, and a
new bus rolling out each time one reaches its second stop while the depot is not empty.
This SUPERSEDES the §2 sketch on three points (bus-i-owns-bay-i, first-stop gate):

- **Single-occupancy depot corridor (the collision fix).** The spur + gate + apron is one
  shared lane, so `busFleet.ts` now holds a `corridorBusyBy` mutex: at most ONE bus is ever
  inside the depot approach. A departing bus grabs it at bay-out and releases it on reaching
  the loop (service); a returning bus grabs it only when the corridor is clear, else keeps
  lapping and retries at the next join crossing. A departure and a return can never meet
  head-on on the single spur. Unit-tested as an invariant across a full sim day
  (`tests/busFleet.test.ts`: `corridorCount <= 1` at every step).
- **Random free-bay parking.** Bays are no longer owned by bus id. `BusState.bay` is the bay a
  bus currently holds (or -1 while on the loop); a returning bus parks in a random FREE bay
  drawn from a seeded LCG (`makeFleet(cfg, worldSeed)`), so parking is deterministic yet
  varied and two buses never target the same bay. Bay geometry/poses index by `b.bay`.
- **2nd-stop continuous dispatch + fair rotation.** The spacing gate releases when the running
  bus clears its SECOND route stop (not the first), and the depot keeps dispatching while any
  bus is parked and in hours — buses trickle out, evenly spaced, until the depot is empty.
  Dispatch picks the LONGEST-rested bus (smallest `breakUntil`, tie-broken by id) so no low-id
  bus monopolises the gate and every bus gets a turn.
- **Cars off the spur.** The depot spur is a real drivable road, so ambient traffic would drive
  the dead-end into a maneuvering bus. The runtime records the spur cells in
  `state.busDepotSpurCells` and `traffic.ts` excludes them from the car graph (as nodes and
  neighbours), so cars stay on the loop and the buses own the spur. Pinned by
  `tests/busDepotBoot.test.ts` (no car ever occupies a spur cell over a long traffic run).
