# Spec 169 — West Coast Long Beach (WORLD.LONGBEACH.1)

- **Status:** proposed for review — design only, no source files touched.
- **Depends on:** spec 084 (WORLD v2 sizing), spec 140 (no roads on beaches), spec 148 (road network one web), spec 149 (bus depot + fleet), spec 152 (authoritative spatial registry — the frame model this leans on), spec 168 (desert island retheme), ROAD.PLACEMENT.DECOUPLE.1.
- **Design provenance:** operator, verbatim — _"i want our placement of plots and our roads reworked. Maybe we could generate a much larger desert that is suited for hundreds of smaller neighborhoods and can be expanded on... call it a west coast long beach... with our blue gas giant still in the distance. i want amazing racing roads for the cars as critical."_ Developed by a Fable concept panel against the live source.
- **Standing context:** desert island (Namaqualand read), kokerboom is the signature plant, the blue gas giant hangs on the horizon, and everything new ships behind a feature gate.

## 0. What is true today, measured before designing anything

| fact | where measured |
| --- | --- |
| World is 608×608 cells, `CELL_SIZE = 4 m` → ~2.43 km square; `heightScale: 54`, `seaLevel: 0.34` | `config.ts` (`COLONY.world`) |
| The island mask is **radial**: `1 - smoothstep(0.55, 1.02, d)` about the map centre — sea on every side, never a coast with a direction | `terrain.ts` `generateElevation` |
| `Terrain` is **square by construction**: one `size`, `idx = y*size + x`, every loop `n×n` | `terrain.ts` |
| Terrain generation costs **104–143 ms at size 608** | spec 168, measured |
| Seed 314 generates **no Plains at all** — dry land is Beach + Forest + Highland only. One seed in five sampled | prior measured finding |
| `cellZone()` is single-centre: CIVIC at `d < 4` from the landing, compass arcs to `d ≤ 38`, **null beyond 38** | `cityPlan.ts:38-53` |
| Colony growth is single-centre: `growRadius: 48`, `block: 7`, `maxBlockRadius: 10` | `config.ts` |
| `RoadKind` is `avenue \| street \| path`; ways carry an explicit width in cells — builder streets `width: 1`, commercial ways `width: 4` | `build.ts:135`, `useRoadNetwork.ts:222` |
| Race top speed: avenue **8.8**, street **7.2**, path **4.8 cells/s** → **127 / 104 / 69 km/h** | `race.ts:224` |
| Acceleration 13.5 cells/s², braking 16. **0 → avenue top speed takes ~0.65 s, under 3 cells** | `race.ts` `driveCar` |
| Steering yaw caps at **2.85 rad/s**. Minimum turn radius at avenue top speed: **3.1 cells (12.4 m), taken flat-out** | computed from `race.ts:242-254` |
| Off-track is `distance > 0.9` cells from the **centreline regardless of way width** | `race.ts:219` |
| Bus route sorts stops **by angle about the centroid**; snap search caps at radius 18 | `transit/busRoute.ts` |
| Placement reserves the **routed** footprint; before ROAD.PLACEMENT.DECOUPLE.1 a road-geometry change moved the depot **310 cells** | `placementValidation.ts` |
| `surveyVenuePlacements` **gives up and leaves a parcel open** when no footprint fits | `render/venuePlacement.ts` |
| The gas giant is a mesh at a **fixed absolute world position** `(-1400, -100, -3400)` | `render/darkCity.ts:126-156` |
| Biome IDs are load-bearing for LAYOUT: reclassifying moisture moved the towns and broke three seed-pinned suites | spec 168 |

**Two consequences fall straight out:**

1. **The founding island cannot be stretched into Long Beach.** Its radial mask has no west; its biome layout is pinned by three seed-locked suites; spec 152 declares it immutable. Long Beach must be a **new region frame** beside it.
2. **The current handling model cannot reward braking.** A 3.1-cell flat-out radius means no corner ever forces a lift. "Corners that reward braking and grip" needs one new physics term (§3.2).

## 1. World shape — a coastal strip, not a bigger blob

**A west coast is a direction, not a shoreline.** The sea owns the **west edge**, the beach runs the whole north–south length, land climbs eastward: beach → sand flat → scrub hollow → dune shoulder → rock. Face west anywhere and you see water and the gas giant.

| constant | value | meaning |
| --- | --- | --- |
| `LB_WIDTH` | **1024 cells** (4.10 km) | east–west extent. **Constitutional — never changes**, so `idx = y*1024 + x` is stable forever |
| `LB_REACH` | **512 cells** (2.05 km) | one expansion unit appended at the southern end |
| Reach 1 | 1024×512 = 524,288 cells | 1.42× the founding island |
| Sea band | west `x < ~180`, coastline meandering **±48 cells** via 1-D noise over y | no land cell touches the west border |
| Dune wall | east `x > ~880`, Highland/Mountain to the map edge | the visual backstop |

Terrain cost **~150–200 ms per reach** (extrapolated, *not measured* — measure before committing to synchronous generation).

**Expansion without invalidating saves — three rules:**

1. Long Beach is a **new spatial frame** (`region: long-beach`) under spec 152. The founding island's addresses are byte-untouched — 152's "adding a second island leaves all original addresses unchanged" lock already exists as the test.
2. Reaches append **south only**, noise sampled in absolute strip coordinates, so reach *k* is a pure function of `(lbSeed, x, y_global)`. This needs the one real engine change: **`Terrain` must support rectangular `(width, height)`** — mechanical but wide, hence behind the gate.
3. Coastline noise is **1-D in y**, so an existing reach's shoreline cannot shift when a new reach generates below it.

**Biome bands** reuse the unchanged `Biome` enum (spec 168's rule: IDs are load-bearing, never renumbered), classifying by east-west band + noise rather than the moisture split that produced the seed-314 no-Plains world. Plains — the sand flat — is **guaranteed present**. Rivers become dry-wash arroyos running west, water-flagged so bridges span them.

**The gas giant becomes sky-anchored** — fixed azimuth (due west, over the sea) and elevation (~12°) relative to the camera, at its legacy distance so apparent size is unchanged. A fixed world position would swing out of frame as you drive south. Render-layer change only.

## 2. Road hierarchy

**One web, four tiers, and the tier is decided by what the road connects — never by hand.**

| tier | name | `RoadKind` | width (cells / m) | ceiling (cells/s → km/h) | connects |
| --- | --- | --- | --- | --- | --- |
| 0 | Coastal Highway | **`highway` (new)** | 4 / 16 m | **11.5 → ~166** (proposed, untested) | reach ↔ reach; interchanges only |
| 1 | Arterial | `avenue` | 3 / 12 m | 8.8 → 127 (measured) | interchange ↔ district centre |
| 2 | Neighbourhood street | `street` | 2 / 8 m | 7.2 → 104 (measured) | district grid; parcel frontage |
| 3 | Service lane | `path` | 1 / 4 m | 4.8 → 69 (measured) | alleys, depot spurs, beach access |

**Connection rules:** a tier-*n* road junctions only with *n−1, n, n+1*. Highway access only at interchanges **≥ 96 cells (384 m)** apart — between them the highway is junction-free, which is what makes it a racing road. Highway routes on the first non-Beach band, **20–40 cells** from the mean shoreline. Commercial fronts arterials; residential fronts streets; **nothing fronts the highway**.

Adding a `RoadKind` member is additive — every existing `avenue` branch keeps its behaviour, and existing worlds contain no highway cells, so gate-off is inert.

## 3. Racing roads — the critical section

### 3.1 What "fun to drive" decomposes into

- **Straights** are about *holding* top speed with the giant on the horizon, not reaching it (acceleration takes <1 s). Signature straight ≥ **120 cells (480 m ≈ 10–14 s flat-out)**.
- **Corners must price speed.** Today they don't — see §3.2.
- **Rhythm:** BFS tracks produce staircase wiggle; a racing road must be an **authored way** — long segments, 45° snaps, Chaikin-smoothed.
- **Elevation:** crests every 60–100 cells; sustained grade ≤ **0.5 world-units/cell (12.5%)**, inside "flat" ground so it never fights the grader.
- **Blind-crest rule:** no corner tighter than class B hidden beyond a crest.

### 3.2 The one physics change: a lateral-grip cap (gated)

Active **only** when a track's ways carry a `racingProfile` — never on founding-island rally tracks:

```
ω_allowed = min(ω_current_formula, A_LAT / |v|)
A_LAT = 14 cells/s² × statScale(grip, GRIP_SPREAD)     // proposed, untested
```

At stock grip: flat-out at 11.5 cells/s the minimum radius becomes **9.4 cells (38 m)**; brake to 7 and it tightens to **3.5 cells**. Braking and grip now buy corner speed — the operator's ask. Off the racing profile, behaviour is bit-identical to main; `tests/raceCarStats.test.ts`'s stock-car-reproduces-main assertion is the guard.

Second change: the off-track threshold is hardcoded **0.9 cells from centreline regardless of way width** — on a 4-cell way you are "off-track" while still on asphalt. Racing tracks carry `halfWidth = width/2 − 0.35`; 0.9 is exactly the width-1 case, so non-racing tracks are unchanged.

### 3.3 Corner classes

| class | radius (cells) | stock behaviour under §3.2 | use |
| --- | --- | --- | --- |
| A — sweeper | ≥ 12 | flat-out even on highway | coastal curves |
| B — standard | 6–11 | lift or brush brake | arterial bends, arroyo approaches |
| C — hairpin | 3–5 | brake hard; handbrake pays (×1.45 yaw, measured) | dune pass switchbacks |

Never more than two class-C corners without a ≥ 40-cell breather; every class-C entry visible ≥ 30 cells out.

### 3.4 Three signature routes (reach 1)

| route | tier | length | character |
| --- | --- | --- | --- |
| **The Strand Run** | highway | ~600 cells / 2.4 km, **grows ~500 per reach** | the postcard: class-A sweepers tracing the shoreline, two 120+-cell straights, one arroyo bridge, gas giant dead ahead over the sea southbound |
| **Kokerboom Pass** | avenue | ~300 cells / 1.2 km | climbs the Highland band: 4 class-C hairpins, 3 crests, quiver trees lining the switchbacks — the operator's tree gets the hero placement |
| **Old Town Circuit** | street | ~200 cells / lap | 90°/45° rhythm at street speeds, `makeRaceTrack` loop mode |

### 3.5 Reconciling with the Road Rally

`makeRaceTrack`'s farthest-point BFS stays for improvised rallies. Signature routes are an **additive second constructor**, `makeSignatureTrack(routeId)`, producing the same `RaceTrack` shape. `stepRace`, checkpoints, car stats, the garage and Rally Point consume it unchanged.

## 4. Hundreds of neighbourhoods

**Replace one centre with a lattice of small centres.**

| unit | size | count in reach 1 |
| --- | --- | --- |
| **Neighbourhood** | 32×32 cells (128 m sq) | 512 gross; **~380–410 on land** (estimate) |
| **District** | 4×4 neighbourhoods (512 m sq) | 32 |
| **Reach** | 8×4 districts | 1 |

Four reaches ≈ **1,500+ neighbourhoods**.

**`zoneAt` replaces `cellZone`** — deterministic in `(lbSeed, x, y)`, no global centre: within 2 cells of arterial frontage → commercial; district centre neighbourhood → civic; most inland neighbourhood → light industrial (prevailing onshore wind blows west→east, so industry sits downwind, the same instinct as today's "industrial south"); everything else residential. `cellZone` keeps its exact behaviour on the founding island; callers switch on the cell's frame, which spec 152's registry already provides.

**Naming:** coast-parallel **Miles** (one per 256 cells southward) × a seeded vibe name — "Kokerboom Flats, Mile 3", "Shellsand Reach, Mile 7".

**Kooker HQ does not move.** It stands in the founding island's civic ring, immutable per spec 152. Long Beach gets **Old Town** as its ceremonial centre, with a **reserved 12×10 pad** recorded at survey time for a future campus — a reservation, not a building.

## 5. Migration and risk

| system | why it breaks | mitigation |
| --- | --- | --- |
| **Bus route** | stops sorted by **angle about the centroid** — on a 4-km strip near-collinear stops flatten the "loop" into a doubling-back line; snap radius 18 misses distant hoods | **per-district loops** (≤16 stops, the existing algorithm is fine at that scale) feeding a **Strand Line trunk** with one stop per interchange |
| **Depot siting** | deterministic in (terrain, loop, blocked) — a new loop composition re-sites depots by construction | one depot in Old Town in slice 1, sited by the existing survey. Every reservation reads **routed** footprints — the 310-cell depot jump is why |
| **Terrain squareness** | `n×n` by construction | rectangular refactor, behind the gate |
| **`cellZone` / growth** | single-centre, `d ≤ 38` | `zoneAt` per frame |
| **Venue placement at scale** | silently leaves a parcel open — invisible rot across 32 districts | emit **per-district open-parcel counters** into the survey map |
| **Determinism** | `roadWaterGuard` (4242), `roadTerrainClearance` (1234), `busFeltSpeed` are the tripwires | they test the founding island, untouched. **Gate OFF must be byte-identical to main** — the primary acceptance check |
| **Gas giant** | fixed world position | sky-anchoring, render-only |
| **Performance** | 1.42× cells per reach | chunked generation + staged mount (spec 117). Frame cost **unmeasured — a slice-1 exit criterion** |

**Gate:** `west-coast-long-beach-v1`, fail-closed, default OFF, the `kookerHq.ts` pattern. Gate OFF: no frame generated, no highway cell exists, the grip cap never activates, boot byte-identical to main.

## 6. Smallest first slice — "drive the Strand Run at sunset"

1. Rectangular-`Terrain` refactor (island still square; suites green with gate off).
2. Generate **reach 1** as a new frame: strip mask, west sea, biome bands, arroyos.
3. Route the **Coastal Highway** + Old Town arterial stub — enough to satisfy one-web.
4. Sky-anchor the **gas giant** due west.
5. **The Strand Run** + `makeSignatureTrack`, the highway speed row, the gated grip cap, width-aware off-track.
6. One teaser district: Old Town civic pocket, ~12 named neighbourhoods, the HQ-campus reservation.

**Not in slice 1:** the other 31 districts, Kokerboom Pass, Old Town Circuit, the Strand Line trunk, the depot, reach 2, banking grip effects. Exit measurements: terrain time per reach, frame cost with the strip mounted, and a recorded lap for operator UAT.

## 7. Acceptance

1. Gate OFF: boot byte-identical to main; the three seed-pinned suites and the full suite green.
2. Gate ON: founding-island addresses unchanged; two cold boots of reach 1 produce identical canonical layout hashes.
3. The Strand Run drivable start→finish in the existing Rally UI; a stock car on a founding-island track drives digit-for-digit as main.
4. From the Strand Run's southbound straights, the gas giant sits over the western sea. Screenshot in the PR.
5. Generating reach 2 changes no cell, address or hash in reach 1.

## 8. Deliberately not done here

- **No rework of the founding island** — ever, per specs 152/168.
- **No moisture-based aridity in `classify()`** — spec 168 measured that failure.
- No traffic-sim on the highway, no AI rivals, no multiplayer racing.
- No emissive flora (WORLD.GLOW.1), no archipelago (WORLD.ARCHIPELAGO.1).
- No banking physics in slice 1 — visual tilt only.
- **No relocation of Kooker HQ.**

---

**Measured vs guessed, in one place:** measured — everything in §0, the speed/radius/threshold arithmetic in §2–§3, the centroid-sort and snap-radius bus findings, the gate pattern, the gas-giant position. **Proposed and untested** — the 11.5 highway ceiling, `A_LAT = 14`, per-reach terrain time (~150–200 ms, extrapolated), land-tile counts (~380–410), all §3.3 corner tunings, and the frame cost of a mounted reach.
