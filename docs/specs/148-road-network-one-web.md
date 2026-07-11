# Spec 148 — the road network is ONE connected web

- status: built
- proposed-by: claude (operator-reported)
- date: 2026-07-11
- depends-on: 086 (distributed city), 135/139 (commercial district), 097 (rally spur), 140 (no roads on beaches), 123/133 (road-on-water guard / rough-land — the water-barrier lineage)

Operator rule (2026-07-11): **in World View the road network has visible gaps — "missing road" —
where road segments do not connect. Fix the connectivity so every settlement's roads join the main
network.**

## Why (the citizens' case)

A city's roads are useless as a network if the pieces do not touch. World View showed exactly that:
road segments floating a few cells apart, a shop street that led nowhere. The bus can only loop a
network it can reach; a citizen driving to the shops needs the shops to be ON the road graph. "Every
road reaches every other road" is the contract the distributed city (spec 086) always implied but
never enforced.

## The diagnosis — it was NOT the beach ban

Spec 140 (no roads on beaches) was suspected, but measured it did the OPPOSITE: banning beach
pavement **improved** connectivity from ~90% to ~97% of cells in the main web, because the old
shore-hugging trunk was itself a fragile thread. The real defect is older and structural: **every
boot road source merges its cells straight into `state.roads` with nothing guaranteeing the pieces
touch.** On seed 4242 the network flood-fills into **4 components** (4-neighbour):

| cells | grid centroid | what it actually is |
|------:|---------------|---------------------|
| 3919  | (335, 338)    | the main web — founders' avenue + all 3 satellite hamlets + the commercial high street |
| 75    | (125, 284)    | the commercial **cross street** (lower half), severed |
| 29    | (125, 250)    | the commercial **cross street** (upper half), severed |
| 18    | (309, 310)    | the **rally spur** stub (spec 097 fail-soft) |

The first hypothesis — that the two western fragments were a stranded *hamlet* whose only path
crossed a now-forbidden beach — was **wrong**, and the investigation is worth recording so the next
reader does not re-chase it. All three satellite hamlets connect fine (one hamlet's spoke-to-coast
fails on the beach ban, but its mesh cross-link rescues it). The two "western" fragments are the
commercial district's **cross street**: a vertical road at `crossStreetX` that the mall pad and shop
footprints occupy across the intersection row, splitting it into two islands that never rejoin their
own high street. Each island sits a **clean 6–7 cells** from the main web — no water, no beach, no
setback between them — so nothing *blocked* the connection; it was simply never routed. The 18-cell
piece is the rally spur, which by design (spec 097) paves only the clean knoll suffix and fails soft
when a homestead setback walls it off.

## Mechanic — the connectivity-repair pass

A new pass at the end of `ColonyRuntime` boot (`src/colony/runtime.ts`), after the spec-114
fence-setback prune, closes the gaps deterministically:

1. Flood-fill `state.roads` into 4-connected components (the shared, pure
   `src/colony/roadConnectivity.ts` — largest first, tie-broken by lowest cell index, so the "main"
   web is always the same one run-to-run).
2. For each ORPHAN (every component but the largest), route a short connector to the main web:
   candidate anchors are each orphan cell paired with its nearest main cell, tried best-distance
   first (the single nearest can be un-routable), through `leastCostPath` with `forbidBeach` (spec
   140 — the connector bends inland, never onto sand/water), a homestead-setback `blocked` gate (spec
   114 — never touches a fence border), a slope weight, and a search margin scaled to the pair's
   distance. The found path is laid through the same string-pulled `layRoad` as every other trunk, so
   it reads as a real road, and `mergeAvenue`d into the network.
3. Iterate to a fixed point (bounded to 8 passes): connecting one orphan grows the main web, which may
   then be the nearest anchor for the next.

**Prefer connecting over deleting.** The pass never strands and never deletes — it only adds the road
a legal route can lay. An orphan a legal road CANNOT reach is left in place (see exceptions).

## Rules & data — the invariant and its exceptions

After the repair the network is a **single connected component** on the seed suite (4242 / 7 / 42:
each goes from ~97% to **100%**, one web). A determinism-safe invariant reads the same flood-fill and
`console.warn`s (never throws — a boot must always complete) if any orphan survives. Two survivals are
LEGITIMATE and expected on other seeds, both verified by routing analysis:

- **Water-locked (a future bridge, spec 123/133 water-barrier lineage).** Seed 16's residual is a commercial piece
  across an inlet: the gap is 31 beach + 37 water cells, and NO route exists even with every guard
  off (water is impassable by construction). It needs a bridge, out of scope here.
- **Setback-walled (an embedded rally overlook, spec 097 fail-soft).** Seed 12's residual is walled on
  all sides by homestead setbacks; a route exists only if allowed to cross a fence border, which spec
  114 forbids and the final prune would strip anyway. It stays reachable on foot.

The connectivity test pins the general floor at **≥99% of cells in one web**, with these two as the
only documented exceptions.

## Cost — materials & labour

None. This is boot-time layout geometry (the road-planning pass), not a built structure. It adds a
handful of connector road cells per seed (seed 4242: 4041 → 4128 cells), which carry the ordinary
per-cell road upkeep already modelled by `roadUpkeepPerDay`.

## Determinism

Rerouting is by design, but the repair is a pure function of the seeded world: components are ordered
canonically (size, then lowest cell index), anchor pairs are ordered by distance then cell index, and
`leastCostPath` / `layRoad` / `mergeAvenue` are all deterministic. The seed suite was re-run: the
existing golden tests (`districtDeterminism`, `roadsPlan`, `commerceDistrict`, `rallySpur`) stay green
UNCHANGED — the pass only ADDS connector cells, it never moves a parcel, district or existing road, so
no pinned path shifted. The full suite (150 files / 1277 tests) is green.

## Acceptance

- `tests/roadConnectivity.test.ts` — NEW. For seeds 4242/7/42: exactly one road component; largest
  component share == 1; no floating single cells; the repair is deterministic (identical network
  run-to-run); and the ≥99% floor holds. Uses the shared `roadComponents` / `largestComponentShare`.
- Full `vitest` suite + `tsc --noEmit` green.
- Playwright World View (seed 4242, aerial camera) before/after: the western commercial cross street,
  two floating islands before, is one connected web after; and a data-accurate top-down component map
  (before: 4 components / 96.98%, after: 1 / 100%).

## Known adjacent issue (out of scope, flagged separately)

Booting some other seeds (e.g. seed 4) throws in the PRE-EXISTING commercial connector
(`nearestPair` on an empty founders `carriage` → `leastCostPath` on `undefined`), before this pass
runs. It is unrelated to connectivity repair and left for its own fix.
