# Spec 103 — Phase 2A: district scale-up (grow the reserve, cross-street, major intersection)

**Status:** planned (one bounded Jack slice).
**Lane:** World & Build (Jack). Read-only seam to the car lane (race start consumes one new cell).
**Phase:** PHASE 2A of the open-world roadmap (`docs/VISION-open-world.md`, line 55). Gated behind
phase-1 S2 (shipped). Mall anchor, garage landmark, authored GLB shells are LATER slices (2B/2C/2D)
and are explicitly OUT of this spec.
**Touches (exactly 8 files):** `src/colony/commerce/district.ts` (survey + new fields + the
intersection picker), the commercial block in `src/colony/runtime.ts` (reserve size, cross-street
widen + road-way, race-center read), `src/colony/config.ts` (promote reserve size + thresholds to
constants), `tests/districtDeterminism.test.ts` (new), `tests/commerceDistrict.test.ts` (one new
crossStreet/intersection case), `tests/racing.test.ts` (mirror the new race seam), the spec file
itself, and `docs/VISION-open-world.md` (tick PHASE 2A). No render, no `sim.ts`, no
car/garage/rally/race-internal files.

## Why

CityLife is becoming a Need-for-Speed-feel open-world car game by SCALING what already exists, not by
bolting on new tech (`docs/VISION-open-world.md`). The first move is the commercial heart: today the
reserve is a thin 40x30 high street — a single horizontal midline of small co-equal plots. A car game
reads as a car game because you converge on a lit commercial core and the garage sits on a big
intersection you cruise past. Phase 2A REPLACES the thin high street with a deeper district BLOCK and
gives it the one feature the whole NFS loop hangs on: a real crossing — a high street PLUS a
perpendicular cross-street that meet at a widened carriageway intersection. That crossing cell becomes
the deterministic major intersection (the race start/checkpoint the track graph already prefers).

This slice ships ONLY the grown district SHAPE: the bigger reserve, the cross-street, the picked
intersection cell, and the widened carriageways. The mall anchor (2B), the garage landmark via
`findGarageSite` (2B/2C, car-lane-owned), the landmark massing (2C), and the GLB shells (2D) are
deliberately deferred so this slice stays bounded, in-lane, and re-baselinable in one PR.

## Mechanic

1. GROW THE RESERVE. The reserve becomes a deeper block — `reserveW=64`, `reserveH=48` (was 40x30) —
   placed by the SAME deterministic coastal/inland search that exists today. A deeper reserve gives
   ~24 cells each side of the high street midline instead of ~15: room for the cross-street and, later,
   the mall/garage. Replacement, not augmentation — there is one reserve, now bigger.

2. ADD A PERPENDICULAR CROSS-STREET. After the existing high-street + shop survey runs unchanged, lay a
   single VERTICAL cross-street column at a deterministic `crossStreetX = reserve.x + floor(reserve.w/2)`
   so the two streets CROSS at the core. `crossStreet: Cell[]` is the set of CLEAR cells on that column,
   surveyed in ascending y over `[reserve.y, reserve.y + reserve.h)`, where a cell is included iff
   `cellOk(t,x,y)` AND inside the reserve AND NOT a shop footprint cell AND NOT a residential/homestead
   cell. **It is NOT minus the road set** — the column deliberately crosses the already-laid high
   street, so the high-street row at `streetY` is NOT treated as blocking; if it were, the crossing
   cell would be punched out and the intersection contract would fail on every seed.
   **The cross-street is a FRAGMENTED column, not a contiguous carriageway:** the shop survey marches
   `cursorX` across the FULL reserve width on both flanks (district.ts:95-130), so any shop whose
   footprint spans `crossStreetX` interrupts the column. Only the near-street band — rows
   `streetY-1, streetY, streetY+1` — is GUARANTEED clear of shops (SETBACK=1 pushes shop front rows to
   `streetY±2`), hence guaranteed paved and contiguous through the crossing. This slice ACCEPTS the
   fragmented column (option a): we do not reserve a shop-free gutter (that would shift parcel ids and
   is a deliberate 2B decision). `crossStreet` is appended as a new field; the existing `street`,
   `parcels`, `reserve` are untouched so no parcel id/position/door shifts.

3. PICK THE MAJOR INTERSECTION as a fully-pinned pure function (no Set/Map iteration-order dependence):

   - **Domain** = the deduped UNION of `street[]` and `crossStreet[]` cells — **centrelines only, NOT
     the widened carriageway cells.** The widen runs later in `runtime.ts`; at the time
     `makeCommercialDistrict` computes the intersection the widened cells do not exist yet.
   - **degree(cell)** = the number of the FOUR von-Neumann (orthogonal N,S,E,W) neighbours of `cell`
     that are also members of that union set. **Diagonal neighbours are NOT counted.** Degree is
     counted within the union, NOT within `state.roadSet`/`roadKind`.
   - **Candidate iteration order** = iterate the union in fixed insertion order: `street` in ascending
     x first, then `crossStreet` in ascending y, deduping; compute degree for each.
   - **argmax comparator** = higher degree wins; tie → smaller x; tie → smaller y. Bake this comparator
     into the picker.
   - For the single-high-street × single-cross-street geometry the crossing cell `(crossStreetX,
streetY)` has degree 4 (its E/W neighbours are high-street cells, its N/S neighbours are the
     `streetY±1` cross-street cells, all shop-clear) while every plain street or cross-street cell has
     degree ≤ 2 — so the crossing is the UNIQUE argmax and the tie-break is never exercised here. The
     degree-argmax form is the contract that generalizes unambiguously when a second cross-street or a
     T-junction is added later (Phase 4).
   - **Degenerate fallback:** if `(crossStreetX, streetY)` is NOT `cellOk` on some future seed (water/
     rock at the core) it is simply absent from both `street` and `crossStreet`, so the argmax runs over
     whatever clear union cells DO exist and returns the highest-degree survivor. If the union is empty
     (no high street surveyed) `intersection` is undefined and the district is still laid; the race seam
     degrades to the street centroid / reserve centre exactly as today. The picker MUST NOT throw.

4. WIDEN BOTH TO CARRIAGEWAY. The high street already widens vertically (`dy in [-1,0,1]`) into the road
   network. The cross-street widens PERPENDICULARLY: iterate `crossStreet` in ASCENDING y, and for each
   cell apply `dx in [-1,0,1]` IN THAT FIXED ORDER, skipping `residentialKeys` and `shopCells` exactly
   like the existing high-street widen, then `mergeAvenue` the widened cells (which adds them to BOTH
   `roadSet` AND `roadKind` — build.ts:403-421). The cross-street road-way is pushed onto `roadWays` at
   the END, AFTER the existing high-street way, so existing way indices are stable. This fixed
   `(ascending-y, dx∈[-1,0,1])` ordering makes the widened-cell insertion order — hence `roads[]` append
   order and any downstream ribbon/grader read of `roads[]` in order — byte-stable. The render junction
   detector (roadRibbon cellWays) auto-registers the crossing and the road grader auto-regrades the new
   ribbon cells — no render wiring in this slice.

5. RACE START READS THE INTERSECTION. The ONLY runtime behaviour change beyond geometry:
   `raceCommercialCenter()` returns `commercialDistrict.intersection` (an INTEGER cell) when present,
   else the current street centroid (a float), else the reserve centre. `track.ts` is consumed
   UNCHANGED — `findStart` snaps any passed point to the nearest road graph NODE, and `checkpoints[0]`
   is always the start. Because the cross-street is `mergeAvenue`'d, the crossing cell is in `roadKind`
   and is therefore a node in the race graph (which is built from `roadKind.entries()`, track.ts:248),
   so `findStart` snaps the start ONTO the intersection node (distance 0). The wording is precise: the
   start snaps to the nearest road node, which IS the intersection node when the intersection survives
   the frontage exclusion (see Land/collision contract).

## Rules and data

### Determinism (binding)

- DETERMINISM GATE — primarily a SOURCE-SCAN, secondarily a golden + reference-picker check; the
  two-run identical-cells assertion is a weak supporting check ONLY. Two fresh `ColonyRuntime(seed)`
  boots run in the same process / same V8 / back-to-back, so insertion order is itself a deterministic
  function of the seed; the two-run test therefore CANNOT catch Set/Map-insertion-order dependence,
  Record-key iteration order, a fast-twice `Date.now`, or cross-platform float drift. It proves
  "reproducible within one process today", not "deterministic by construction". The real gates are:
  - **(a) SOURCE-SCAN** asserting no `Math.random`, `Date.now`, `performance.now`, or `new Date` in:
    `src/colony/commerce/district.ts` (all of it, including the new picker), `src/colony/commerce/
businesses.ts`, AND the runtime commercial path — specifically the reserve-search IIFE
    (runtime.ts ~881-968), the cross-street widen block (runtime.ts ~1133-1168), and the
    `raceCommercialCenter` read (runtime.ts ~2076-2089). The scan MUST cover the reserve IIFE and the
    widen block, which are exactly where new nondeterminism would land.
  - **(b) GOLDEN snapshot** for seeds 4242/42/7: assert the EXACT `(x,y)` of the chosen intersection
    and a stable hash (e.g. sorted-cell-string join) of the `crossStreet` cell set and of the parcel
    footprint cell set against committed expected values, so a self-consistent logic change is still
    caught.
  - **(c) REFERENCE-PICKER cross-check:** in the test, re-implement the specified argmax
    (degree over `union(d.street, d.crossStreet)` with the von-Neumann count and the
    higher-degree/smaller-x/smaller-y comparator) and assert `d.intersection` equals exactly that
    cell AND equals exactly `(crossStreetX, streetY)` AND has degree 4 — so a per-axis degree
    miscompute (which would give the crossing only degree 2 and a 4-way tie) is caught.
- `makeCommercialDistrict` stays a pure function of `(terrain, reserve, blocked)`; the reserve search
  stays a pure argmax over fixed candidate arrays.
- FIXED orderings preserved byte-for-byte: (a) the high-street loop ascending x and the shop-flank
  loops (`side in [-1,1]`, `KIND_CYCLE`, side-1 stagger `k=3`, monotonic cursor) run FIRST and unchanged
  — the cross-street is appended AFTER them so every existing `shop_N` id/position/door/business is
  identical; (b) the reserve candidate arrays (primary `along=[16,28,40,52,8]` × `off=[0,-16,16,-32,32]`,
  fallback `step=[12,20,28,36,44,52]` × `perp=[0,-14,14,-28,28]`) stay in order; (c) the cross-street
  cells are surveyed in ascending y; (d) the cross-street widen iterates `crossStreet` in ascending y
  with `dx in [-1,0,1]`; (e) the cross-street road-way is appended at the END of `roadWays` so existing
  way indices are stable.

### Threshold scaling (EXACT constants, not a range)

- The reserve accept thresholds were tuned for 40×30 = 1200 cells: `free >= 140` (primary accept) and
  `bestFree < 80 -> null` (fallback floor). A 64×48 = 3072-cell rect needs them scaled. Use the EXACT
  rule `scaled = round(old * (reserveW * reserveH) / (40 * 30))`:
  - `reserveFreePrimary = round(140 * 3072 / 1200) = 358`
  - `reserveFreeFallback = round(80 * 3072 / 1200) = 205`
    Promote BOTH to named constants under `COLONY.commerce` and use those names in the runtime IIFE.
    Do NOT leave a "~360"/"~205" range — the exact value selects which reserve candidate clears the bar
    on a given seed, so it is a deterministic golden-affecting input. Changing these constants later is a
    DELIBERATE, golden-re-baselining decision, noted as such in Acceptance.
- EMPIRICAL CHECK (build-time, by the implementer): confirm `commercialReserve` is non-null on
  4242/42/7 with `free >= 358` via the COASTAL path. A bigger rect near a coast clips more water/rock
  than the old 40×30 did, so the achievable free fraction can fall below the bar and silently drop to
  the inland fallback or return null → empty district. If any seed falls back or returns null, retune
  (the candidate offsets `±16/±32` were tuned for a 40-wide rect's centre offsets; widen them or adjust
  the constants) and re-pin the golden. The determinism test additionally asserts the dev seed 4242
  reserve was found via the COASTAL path, so a silent inland fallback is caught.

### Data model (new fields, additive)

- `CommercialDistrict` (`district.ts:36-43`) gains two pure fields: `crossStreet: Cell[]` and
  `intersection?: Cell` (optional, to allow the empty-union degenerate fallback). The existing
  `street`, `parcels`, `reserve` are unchanged.
- `COLONY.commerce` (`config.ts:1051-1054`) gains `reserveW: 64`, `reserveH: 48`,
  `reserveFreePrimary: 358`, `reserveFreeFallback: 205` so the magic numbers stop being inline locals
  in the runtime IIFE.

### Land / collision contract (unchanged invariants)

- Every district cell (street, cross-street, shop footprint) stays `cellOk` and inside the reserve.
- The cross-street survey skips `shopCells` + `residentialKeys` (NOT the road set) so the crossing cell
  survives; the cross-street widen skips `residentialKeys` and `shopCells` exactly like the high-street
  widen, so it never paves over a home or a shopfront.
- The reserve is still claimed BEFORE the satellite hamlets (the council invariant, runtime.ts ~826-829,
  889-896) so a bigger footprint cannot be eaten by the scatter. clampX/clampY already pin a 64×48 rect
  on-map: `t.size - 64 = 544`, `t.size - 48 = 560` → `[0,544] × [0,560]` for world size 608.
- DRIVABILITY PROOF: the intersection must be a member of `state.roadKind` (the drivable map the race
  graph is built from, track.ts:248), NOT merely of `state.roadSet` — `roadSet` also holds
  reserved-but-undrivable verge cells (sim.ts:391). Because the cross-street is `mergeAvenue`'d (which
  sets `roadKind`), the crossing cell is drivable. The test asserts `roadKind` membership.
- FRONTAGE-EXCLUSION INVARIANT (guarded, not deferred): `commercialFrontageExclusion`
  (track.ts:67-81) removes the `nearest_bar` footprint + its one frontage row from the race graph
  (passed as `excludeCells`, runtime.ts:2032). If the bar plot ever straddles `crossStreetX` the
  widened intersection nodes could be excluded and `findStart` would snap the start AWAY from the
  crossing — silently defeating mechanic #5. The test converts this open question into a guarded
  invariant: build the track with `excludeCells = commercialFrontageExclusion(district)` on all three
  seeds and assert the node `findStart` chooses sits within ~2 cells of `commercialDistrict.intersection`
  (i.e. the intersection node is NOT excluded). No `track.ts` edit.

### isPublicSafe + night

- No NEW shown strings in this slice (mall/garage/tenant names are 2B+). If any display string is added,
  it passes `isPublicSafe`.
- No new lit meshes in this slice (render massing is 2C). The widened carriageways render through the
  existing road ribbon/grader, which already carries the night treatment. Any future lit mesh added in a
  later slice carries the `1 - daylight` emissive floor.

## Cost

- Materials/labour: none new. This is world-survey geometry, not a constructed building. Plot pricing
  (`plotPriceK`) and shop materials (`matByKind`) are unchanged; the for-sale storefront economy is
  preserved. A longer high street + a cross-street simply lay more road cells (already free, the road
  network is procedural) and may survey a few more shop parcels (priced by the existing economy).
- Perf: negligible — one bigger rect + one extra road-way + a few more ribbon/grade cells; no new
  geometry tier, no per-frame cost. Mac-Mini headroom unaffected.
- Engineering: one bounded Jack slice + a re-baseline of the seed-4242/42/7 golden expectations (the
  grown reserve relocates and changes plot count/positions — expected, re-pin against the EXACT scaled
  thresholds; do not assume the old (376,363)/(117,234) anchors hold).

## Acceptance

- `reserveW=64`, `reserveH=48`, `reserveFreePrimary=358`, `reserveFreeFallback=205` read from
  `COLONY.commerce`; the reserve places (non-null) on seeds 4242/42/7 via the COASTAL path with the
  scaled thresholds; `commercialDistrict` is non-null on all three.
- `CommercialDistrict` exposes `crossStreet: Cell[]` (every cell `cellOk`, inside reserve, on the single
  `crossStreetX` column, not on a shop footprint, not on a homestead — and KNOWN-fragmented where shops
  span the column) and `intersection?: Cell`. On 4242/42/7 the intersection is present and equals
  `(crossStreetX, streetY)`; `intersection.y === streetY` and `intersection.x === crossStreetX`; the
  cell `(crossStreetX, streetY)` is a member of BOTH `d.street` and `d.crossStreet`; and its immediate
  `streetY±1` cross-street neighbours are present (the near-street band is contiguous).
- DRIVABILITY: after the cross-street is merged, the intersection cell is in `state.roadKind` (drivable),
  and it is present as a NODE in the race `RoadGraph` built the way `makeRaceTrack` builds it, with
  `excludeCells = commercialFrontageExclusion(district)` applied — `findStart`'s chosen node is within
  ~2 cells of the intersection on all three seeds.
- ALL existing `commerceDistrict.test.ts` invariants still pass on the grown block: every shop footprint
  `cellOk` + inside reserve, no shop on a homestead (seeds 4242/42/7), no shop overlap, door on the front
  row facing the street.
- DETERMINISM (`tests/districtDeterminism.test.ts`, new, scoped to the NEW surface only — see the
  existing `commerceDistrict.test.ts:112-119` for the parcel/reserve determinism, do not re-assert it):
  the SOURCE-SCAN (a) passes; the GOLDEN snapshot (b) of intersection `(x,y)` + crossStreet/footprint
  hashes matches committed expected values on 4242/42/7; the REFERENCE-PICKER cross-check (c) confirms
  `intersection` equals the spec-defined argmax AND equals `(crossStreetX, streetY)` AND has degree 4;
  the 4242 reserve was found via the COASTAL path; and the two-run boot produces identical
  crossStreet + intersection (weak supporting check).
- RACE SEAM (`tests/racing.test.ts` updated): the test's `commercialCenter` helper is updated to mirror
  the new `raceCommercialCenter()` (prefer `intersection` when present, else street centroid, else
  reserve centre) so the test validates PRODUCTION behaviour, and the `COMMERCIAL_START_MAX_DIST` (18)
  bound (racing.test.ts:244-260) is re-confirmed against the intersection. The two-player rendezvous
  `joinRallyRace` (passes its own startCell) is unaffected. `track.ts` is unchanged.
- WIDEN COVERAGE (in-slice assertion, not a deferred claim): the test asserts the widened cross-street
  cells (the `dx∈[-1,0,1]` band around `crossStreet`, minus shop/residential) entered `state.roadKind`
  after the runtime merge — so "the render junction detector auto-registers" and "the grader
  auto-regrades" rest on a tested fact (the cells are drivable road), not an untested assertion.
- `npx tsc --noEmit` clean; `npx vitest run` green (with re-baselined golden expectations); live on
  5191: the grown district shows a high street crossing a cross-street at a widened intersection, day
  and night.

## What this slice MUST NOT touch

- Car/garage lane: `car/*`, the rally/car block in runtime, `findRallyOverlookSite`, the rally append,
  rally consumers, the rally `SeedStructure`, rally proximity/presence. No `findGarageSite` here.
- Player & UI lane: `FirstPersonPanel`, nameplates, `firstPersonView`.
- Race internals: `racing/track.ts` `findStart`/`makeRaceTrack`/`commercialFrontageExclusion`/scoring
  signatures — the seam is the one `{x,y}` value from `raceCommercialCenter()` only. The race tests may
  CALL these (read-only) but the source is unchanged.
- `sim.ts` worldY/roadSet/roadKind membership rules, water, pathfinding; `cellOk`; `gradeRoadsInto`
  DEADZONE; the council invariant claim ORDER (reserve before satellites); the purity of the
  survey/assignment.
- Phase-1 follow-ups in flight: Jack S4 `venueProps.ts` (#139) and S5 classifieds — do not co-edit those
  files. #139 also touches `PlanetRenderer.ts`, `docs/README.md`, `docs/PHASE-1-street-rod.md` and is
  already CONFLICTING against main; 103 touches NONE of those, so it adds no new conflict — but do not
  edit `docs/README.md` or `docs/PHASE-1-street-rod.md` (those are #139's). 103's doc edits are this spec
  file and `docs/VISION-open-world.md` only.

## Open questions (deferred, not blocking 2A)

- Continuous cross-street: option (b) — reserving a shop-free gutter at `crossStreetX` so the whole
  column is drivable — is deferred to 2B because it shifts parcel ids. 2A ships the fragmented column
  with only the near-street band guaranteed.
- Cross-street column vs the bar plot: `crossStreetX = reserve.x + floor(reserve.w/2)`; the
  frontage-exclusion invariant test guards the crossing on 4242/42/7, but confirm it still holds when
  2B places the mall and may move the bar.
- District depth use: a 48-deep reserve leaves most depth empty with today's two-row survey; multi-row
  massing / the mall pad is 2B's job, not 2A's.
- Whether the mall pad (2B) reserves before the cross-street is laid (ordering decision for 2B).
