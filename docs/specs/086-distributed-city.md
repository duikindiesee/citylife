# Spec 086 — The distributed city

- status: building (P0 done 2026-06-13)
- proposed-by: irwin (operator directive 2026-06-13: stop cramming plots on one avenue — scatter
  neighbourhoods across the map, coast/hills/woods, with a road network between them; commercial
  apart, out by the lighthouse) + claude
- depends-on: 084 (World v2 + the neighbourhood generator), 079/085 (commerce + the land economy),
  the road system (build.ts roads/roadKind, mergeAvenue), the lighthouse lane (Codex, shore-render)

## Why

The world generated ONE coastal avenue with every homestead crammed along it, and the commercial
strip sat right beside the plots with no street — it read as a row of boxes, not a city. The operator
wants the map USED: plots scattered into clusters in distinct parts of the map (some by the coast,
some in the hills, some in the woods), stitched together by a real road network, with the commercial
district set apart near the lighthouse. The economy rails stay the same — every scattered plot is a
real, for-sale Parcel that Viw builds and the ledger tracks.

## Mechanic

1. THE PRIMARY stays coastal — makeNeighborhood on the landing, founders Joe (lot_1) + Viw (lot_2)
   on the shore as before. Nothing about the founders or the buy/build/ledger rails changes.
2. SATELLITE HAMLETS — makeNeighborhoodAt(anchor, { small }) lays a small 2-per-side COMPACT hamlet
   at chosen anchors. findSatelliteAnchors scans the map for buildable, spread-out blobs (a window
   density score + a woods/hills biome bias + a min separation), so hamlets fill the forest + hills.
   Each hamlet's lots are re-id'd under a cluster prefix (wood1*/hill2*/…) — unique, never clobbering
   lot_1/lot_2 — and merged into the single lot set the renderer + buy/build + ledger already drive.
3. NO OVERLAPS — a shared `taken` set (every placed parcel + road + the commercial reserve) is fed
   into each makeNeighborhoodAt (the corridor routes around it; parcels seed their claimed set with
   it), so scattered clusters never sit on each other, the coast, or the shop district.
4. TRUNK ROADS — a road is routed (leastCostPath, around homesteads) from the coastal avenue to each
   hamlet and merged into the network, so the whole map is one connected, drivable road graph —
   roads between neighbourhoods. Roads never cross water (the router blocks it by construction).
5. COMMERCE FIRST — the commercial reserve is claimed off the avenue BEFORE the satellites, so they
   leave it room (the bug that first hid the shop district: satellites ate the inland it needed).

## Order of operations (the council invariant)

primary neighbourhood -> reserve it (verge + footprints + avenue) -> claim the COMMERCIAL reserve
(avoiding the primary) -> scatter SATELLITES (avoiding everything in `taken`) -> TRUNK roads ->
survey the shop district + connect it. Reordering this is what broke/fixed the commercial district.

## Acceptance

On :5188, distinct plot clusters sit in different parts of the map (coast + woods/hills), each a
small hamlet, none overlapping; a connected road network links every cluster to the coast; the
commercial district keeps its own room and street; founders stay on the coast; no road crosses open
water; buy/build/for-sale + the live ledger work on every scattered plot. Deterministic per seed.

## Phased build plan

- P0 — scatter satellite hamlets across biomes + trunk roads between them, overlap-free, commerce
  preserved. (this slice)
- P1 — RELOCATE the commercial district out to the shore near the lighthouse (Codex's Rockery Beach
  lane), away from the residential, on its own street. Snap to the lighthouse once it lands.
- P2 — richer road network (hamlet-to-hamlet links, not just hub-and-spoke to the coast), and tune
  cluster density/sizes per the operator's eye.
- P3 — biome-flavoured hamlets (woodland vs hillside massing/foliage), pavement/plaza for commerce.

## Progress log

### 2026-06-13 — Slice P0: scatter + trunk roads

DONE

- neighborhood.ts: makeNeighborhood now wraps makeNeighborhoodAt(t, landing); makeNeighborhoodAt
  takes an anchor + opts { small, blocked }. small = a 2-per-side COMPACT hamlet on a short strip;
  blocked = cells already taken (threaded into buildCorridor's spine routing + the carriage/verge
  filter + layParcels' claimed seed) so a cluster never overlaps anything. findSatelliteAnchors
  scores a buildable-area window + a woods/hills bias + coast separation, greedy-spread picks N.
- runtime: the order-of-operations above. A shared `taken` set + `residentialKeys`; commercial
  reserved before satellites; satellites merged into the one lot set + their streets + trunk roads
  (leastCostPath around homesteads) merged into the network; the shop survey avoids all homes + roads.
- LIVE on :5188 (seed 4242): 4 clusters (coast 11 + 3 woods), 21 lots, 10 shop plots, 0 plot-on-plot
  overlaps, 0 shops-on-homes, every cluster road-connected to the coast (BFS), founders intact. Seeds
  42/7 scatter to 7/6 clusters. Verified by screenshot + scene introspection.
  NEXT
- P1: move commerce to the shore/lighthouse (deferred — Codex is actively placing the lighthouse on
  branch codex/founders-lighthouse-rockery; anchor commerce to it once it lands, to avoid a shore clash).

### 2026-06-13 — Slice P2: the road network grows up (mesh + widened trunks)

DONE

- runtime: the trunk roads are no longer just hub-and-spoke. paveLink(a,b) routes the nearest-cell
  leastCostPath between two clusters (around homesteads) and WIDENS it to a ~3-cell carriageway (a
  1-cell dilation gated on dry, non-homestead ground) before merging. Each hamlet still spokes to the
  coast (connectivity guaranteed) AND cross-links to its nearest other hamlet (deduped), so the map
  reads as a connected web, not a star.
- LIVE on :5188 (seed 4242): every cluster road-connected (BFS), roads grew 1456 -> 4524 cells (the
  widening + cross-links), no road on a homestead, none over water (the router + the dry-cell gate
  forbid it). 706 tests green across two runs (the 20s testTimeout absorbs the heavier boot), tsc clean.
- Done while Codex builds the shore lighthouse on his own branch — runtime-only, zero PlanetRenderer
  overlap with his shoreProps module, so the two lanes stay merge-clean.
  NEXT
- P1 (commerce -> shore, once the lighthouse lands); density/biome-flavour tuning per the operator's eye.

### 2026-06-13 — Slice P1: commerce moves to the shore beside the Founders Lighthouse

DONE

- The COMMERCIAL RESERVE no longer searches inland off the avenue terminus. With Codex's lighthouse
  now merged (state.structures kind 'lighthouse'), runtime first blocks the tower + a 4-cell buffer,
  then searches candidate 40x30 rects on the shore beside it — offsets stepped along the coast toward
  the founders' landing (so the connector is the shortest coast road) and spread N/S — scoring by
  clear COASTAL cells (cellOk, distToWater in [2,16], unclaimed), weighted 2x over plain clear ground
  so the district hugs the waterline by the landmark. Falls back to the old inland search when there
  is no lighthouse or no open shore (graceful, deterministic, no RNG).
- The connector spur now routes from the founders' carriage cell NEAREST the district (nearestPair),
  not the inland-most terminus, so the ~200-cell coast road is the shortest land route, not a backtrack.
  The lighthouse buffer is also added to blockedForShops so no shop ever lands on the tower.
- LIVE on :5188 (seed 4242): reserve relocated to (117,234), district street centre (137,249) — 52
  cells from the lighthouse (85,249); 10 plots; BFS over roads from the founders REACHES the district
  (connectedToFounders = true) over the long coastal spur; no shop on the tower; no console errors.
  Screenshot shows the cyan Nearest + neon shops sitting on the coast right beside the lighthouse,
  fronting the sea — the scenic seaside commercial promenade the operator asked for. tsc clean.
  NEXT
- density/biome-flavour tuning per the operator's eye; commerce signage/lighting polish for the new
  coastal setting.
