# Spec 140 — no roads on beaches; a boat launch is a plot, not a road

Operator rule (2026-07-11): **"roads should not be on beaches, ever! we can have a place to
put boats in yes."** Before this spec the coastal trunk roads ran along the sand — flat beach
was the cheapest ground the router could see, so the shore was exactly where it wanted to be
(see the shore junctions in spec 137's screenshots, world (500,-738) and (520,-738), seed
4242). Measured at boot before the fix: seed 4242 carried **138 road cells on Biome.Beach**
(plus 195 ribbon-covered sand cells), seed 7 carried 68, seed 42 carried 17.

## The rule

`Biome.Beach` is forbidden ground for ROADS, exactly as water is — in the ROUTE PLANNER, not
just the renderer. Roads bend inland and follow the grass line. The ban is on pavement only:

- **Beach stays legal for parcels, houses and walking.** The Beach Cove plots (spec 084's
  waterfront tier), shore props, and citizens strolling the sand are untouched — `cellOk`,
  the shared land gate, is deliberately NOT changed. A new `roadCellOk` (= `cellOk` and not
  Beach) sits beside it in `src/colony/pathfind.ts`, and `leastCostPath` gains a
  `forbidBeach` option that road routing opts into (composed into `blocked`, so endpoints,
  neighbour steps and diagonal corner-cuts all get the guard). First-person / citizen
  pathfinding does not opt in, so walking still crosses the sand.
- **Spec 133 gains its documented second exception.** Spec 133 set the render guard to
  water-ONLY so roads may pave rough land; beach now joins water as the only other forbidden
  ground. Rough land: paveable. Water: never. Beach: never (this spec).

## Where the guard bites (every boot-road producer)

1. **Corridor spines + carriageways** (`src/colony/neighborhood.ts`): `buildCorridor` routes
   the spine with `forbidBeach`, its anchors slide to road-legal land (an endpoint on sand
   would fail the whole route instead of bending it), and the spine→carriage dilation runs
   through `roadCellOk` in both `buildCorridor` and `trimCorridor` — the carriage can never
   widen one cell onto the sand the spine just avoided. The verge (unpaved keep-clear ring)
   keeps plain `cellOk`.
2. **Trunk links, the commercial connector, the rally spur, and the stroked band**
   (`src/colony/runtime.ts`): every `leastCostPath` that becomes pavement passes
   `forbidBeach`, and `layRoad`'s string-pull + perpendicular stroke gate through
   `roadCellOk`, so a centre-line brushing the grass line cannot stroke its width onto sand.
   The widened high street + cross street rows gate the same way.
3. **The commercial district survey** (`src/colony/commerce/district.ts`): the high-street
   and cross-street rows skip beach cells. The RESERVE itself may still reach the shore —
   shop pads and the future boat launch may sit by the water; only the street row moved.
4. **The landing block frames** (`src/colony/build.ts`): `developBlock`'s `lay` refuses sand
   like it refuses water, and frame edges route with `forbidBeach` (beach corner → the
   straight fallback, which now also skips sand — the same fail-soft water corners get).
   **The colony's FIRST frame had to move inland**: `pickLanding` loves lowland shore, so the
   caravan lands ON `Biome.Beach` in every pinned seed (42/7/1234's block (0,0) frames are
   beach+water with ZERO legal road cells — the old frame simply paved the sand). `initColony`
   now seeds growth at the nearest block whose perimeter is ≥75% legal road ground (a fixed
   ring-by-ring spiral from the landing block; `frameRoom` counts the same guard `lay`
   enforces), falling back to the landing block on a sliver island. The caravan and base
   structures stay on the headland — the rule bans pavement, not landings — and `nextBlock`
   growth expands from wherever the first frame stood.
5. **The render guard — WATER-ONLY, not beach** (`src/colony/render/roadRibbon.ts` `cellOkOn`,
   `src/colony/render/junctionCap.ts` `cellOk`/`drapeCap`). This was briefly beach-aware and it
   was a **mistake, since reverted**. A rendered ribbon is ~half-a-carriageway wider than its
   centre-line, so a road running the grass line right beside the beach has its outer edge graze
   a beach cell — and rejecting beach in the render guard dropped the ENTIRE cross-section there,
   shattering the ribbon (and the junction caps) into ragged holes. The operator's report: *"looks
   like the beach is breaking the roads."* Measured on seed 4242: **254 of 2,375 ribbon stations
   were dropped, 254 of them for beach**, the centre-lines mostly on grass. The render guard is
   back to water-only (spec 133): a ribbon that grazes the shore renders **continuously**; the
   road NETWORK (`state.roads` cells) stays off the sand by ROUTING, which is the guarantee that
   actually matters. Water still shatters the ribbon — correctly, no asphalt over the sea.
6. **The hand builder** (`src/colony/render/R3FRoadBuilder.tsx` +
   `src/colony/stores/useRoadNetwork.ts`): the drag preview turns red on beach exactly as it
   does on water and the stroke is blocked on release; `plotRoad` re-checks the whole stroke
   in the store (rejecting it with a console warning), so a scripted `window.__colony` call
   cannot slip pavement onto the sand behind the UI's back. The store guard is BEACH-only by
   decision: water stays a UI-level gate, because the pre-existing store contract (pinned by
   `tests/roadRibbonsState.test.ts` and `e2e/roadRibbons.spec.ts`) lets scripted strokes lay
   anywhere, and the ribbon's `cellOkOn` already refuses to render asphalt over water. Beach
   is the one ground scripted pavement may never touch — that is this spec's operator rule.

## Determinism

Rerouting changes the seeded worlds by design (the trunk roads move inland). Inland routes
are byte-identical — `forbidBeach` only composes a predicate into `blocked`, and costs, scan
order and tie-breaks are unchanged, so a route that never touched beach never changes. The
seed suite (4242 / 42 / 7) was re-run and re-pinned; post-fix road networks stay the same
scale (seed 4242: 4,030 road cells vs 3,954 before, 12 ribbon ways vs 11).

## A place to put boats — the future BOAT-LAUNCH PLOT (reserved concept, not built)

The beach ban's documented exception is a PLOT, not a road: a **boat launch / small harbour**
as a surveyed, beach-adjacent PAD — the commercial-reserve pattern
(`src/colony/commerce/district.ts`), not a road exception:

- A rectangular reserve surveyed on the shore like the mall/garage pads: its landward rows on
  grass (`cellOk` + near-flat), its seaward rows allowed to touch `Biome.Beach`, fronting
  open `Shallows` (so a slipway can reach real water).
- **The road ends at its landward edge.** A connector routes from the network to the pad's
  landward frontage with `forbidBeach` — the pad's own apron, slipway and jetty are pad
  geometry (like a shop's forecourt), never `state.roads` cells. The road-on-beach guards in
  this spec stay inviolate.
- Deterministic placement (seeded scoring like `findFoundersLighthouseSite`: shore exposure,
  flatness, distance to the founders' bay), one per seed at most, `blocked`-aware so it never
  eats the lighthouse, commerce, or homesteads.
- Out of scope here — this section reserves the concept and its shape so the next spec that
  builds boats has its contract: **boats get a plot; the beach never gets a road.**

## Tests + evidence

- `tests/roadBeachGuard.test.ts` — pins the ROUTING contract across seeds 4242/42/7: zero
  `state.roads` (drivable network) cells on Beach; plus `roadCellOk` rejecting beach cells
  that `cellOk` accepts (the parcels/walking carve-out stays open). The earlier
  ribbon/coverage/cap-pixel assertions were removed with the render-guard revert — the ribbon
  now grazes the shore by design (see the render-guard note above).
- `tests/roadWaterGuard.test.ts` — unchanged and still green (the spec-133 water contract).
- Re-pinned for the rerouted worlds: `districtDeterminism` crossStreetHash (seeds 4242 + 7 —
  the cross street's on-sand cells are gone; every other golden byte-identical),
  `roadKind` traffic routing (largest street component — the inland frame shares ground with
  the homestead survey, so the parcel purge can split it in the no-trunk test harness), and
  `firstPersonDogfood` detour (both sides of the blocker are correct detours).
- Playwright screenshots at the two former shore junctions (seed 4242, world (500,-738) and
  (520,-738)): the coastal trunk now hugs the grass line with a clean S-bend; the sand
  carries no asphalt; live audit of the booted world confirms 0 beach road cells.

## Junction caps (spec 137) — render with the ribbon, off the road-cell ban

Briefly the caps' `cellOk` was made beach-aware (to keep cap grading + drape off the sand),
the same well-intentioned mistake as the ribbon guard: it shattered coastal caps. **Reverted**
together with the ribbon — the caps hull the carriageways, which are beach-free by ROUTING, and
a cap that grazes the shore edge renders continuously rather than dropping triangles. The
render guard is water-only; the "no roads on the beach" guarantee is the routed road network,
not the cap's every graded pixel.
