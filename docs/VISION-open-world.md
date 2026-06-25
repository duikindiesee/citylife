# CityLife — VISION: open-world car game

> This is a LIVING DOCUMENT. It is the single place that says what CityLife is becoming and where it is going as a Need-for-Speed-feel open-world car game. It sits ABOVE the epic and the phase plan and is updated in the SAME PR as any slice that changes the direction (the always-documented rule). If you change where the game is heading, you change this file.

- North-star epic: [EPIC-street-rod.md](EPIC-street-rod.md) (mirrors GitHub issue duikindiesee/citylife#125)
- Active phase: [PHASE-1-street-rod.md](PHASE-1-street-rod.md) — garage -> car -> meet -> race; ships FIRST
- Lanes + way of work: [TEAM-LANES.md](TEAM-LANES.md)
- Visual north-star: [research/2026-06-13-district-concept.md](research/2026-06-13-district-concept.md) (neon night-market commercial vs calm residential teal)
- Asset pipeline: [specs/100-blender-asset-pipeline.md](specs/100-blender-asset-pipeline.md) (Blender -> glTF authored shells; geometry in Blender, placement in code)
- District spec (to author): docs/specs/101-commercial-district-and-garage-landmark.md

## Direction locked (2026-06-25, Irwin)

Three steers now fixed:

1. **Go as far toward NFS as we can.** The endgame is a FULL open-world car game — free-roam cruising between landmarks, a real drivable road network, a city that lives around you — not just a tight stage. We get there in staged PARTS, and THIS document evolves into those parts as each one is scoped and ships (see the roadmap).
2. **REPLACE the current commerce.** The new larger district replaces today's thin 40x30 high street; it does not sit beside it.
3. **The garage is a first-class LANDMARK STRUCTURE** — like the rally point, placed deterministically by a `findGarageSite` (more car-lane-owned), not a mere corner shop-parcel. It anchors the intersection as a true landmark.

## What CityLife is becoming

A deterministic 3D voxel city that FEELS like a car game. The whole game exists so two brothers meet at night, drive to a spot, hang out, race, and tune their cars (Street Rod, spec 099). The NFS feel is not the cars — it is the SHAPE OF THE WORLD around that loop. We are extending the Street Rod loop, not replacing it.

A car game's CITY reads as a car game because of how the world is shaped: you drive between legible landmarks, you converge on a commercial heart lit hot at night, and the garage sits on a big lit intersection you cruise past. CityLife already encodes NFS Heat's calm-day / neon-night design language (calm residential teal vs neon night-market commercial). So the upgrade reuses existing infrastructure — the deterministic reserve search, the OBB parcel survey, the least-cost road grader, the night-emissive-floor — it is SCALING, not new tech.

## The five NFS-feel pillars

1. DRIVE BETWEEN LEGIBLE LANDMARKS — home -> garage -> commercial district/mall -> rally overlook is a chain of waypoints read by silhouette.
2. A COMMERCIAL HEART — a real district with a MALL gravity-well, brightest at night, where the world converges and meets happen.
3. NEON-NIGHT vs CALM-DAY MOOD SPLIT — day = browse for-sale plots / tune (calm teal); night = meet / race (hot neon). No clock change; we lean the existing day/night into NFS Heat's structure.
4. THE GARAGE IS A NAMED LANDMARK on a major intersection — the auto-retail triad (glassy showroom + open service bays + tall corner pylon sign), not a HUD menu.
5. BIG LIT INTERSECTIONS AS STAGES — the high street crossing a trunk road is the race start/checkpoint the track graph already prefers.

The loop NFS calls build -> meet -> race -> scan-classifieds is CityLife's tune (garage) -> meet (night rally) -> race (road rally) -> classifieds (car parts / Kookerbook). The race ALREADY starts at the commercial centre, so a bigger district + mall + garage-on-the-intersection upgrades the NFS home strip you roll out of.

## The commercial-area direction

A real DISTRICT that REPLACES the single thin high street of small co-equal plots in today's 40x30 reserve.

- THE INTERSECTION AS THE STAGE — grow the reserve to ~64x48, survey it as a BLOCK with a high street PLUS a perpendicular cross-street that CROSS at the core; route the commercial connector to meet at a right angle and widen both to carriageway, forming a true 4-way/strong-T crossing. The crossing cell is the deterministic major intersection (argmax road-degree, x-then-y tie-break). It doubles as the race start/checkpoint.
- THE MALL AS GRAVITY-WELL ANCHOR — one large singular mass (ANCHOR pad ~14x10, wallH ~2.6) reserved FIRST at the district end nearest the intersection: an oversailing emissive entry canopy, a stepped parapet/sign tower, 2-3 glowing entry bays. The mall is the ONE always-present civic anchor; the for-sale storefronts (Nearest bar, Sprout, Sportifine, Chef Ott) plug into its frontage and stay buy-and-build — preserving the for-sale economy while giving a landmark silhouette.
- THE GARAGE AS A FIRST-CLASS LANDMARK STRUCTURE — placed deterministically by a `findGarageSite` on the crossing corner hardest against the intersection (a SeedStructure like the rally point, car-lane-owned), with the commercial district built AROUND it: a glassy warm-lit showroom cube, a lower service-bay shed with roll-up doors + forecourt lane, a tall corner pylon sign (tallest vertical in the district), and forecourt display cars. This finally gives the garage an in-world building (today: HUD only) on the NFS main drag. The garage door opens the existing tuning UI.
- HIERARCHY is the 'reads as a district' lever — ONE dominant mass (mall) + ONE secondary landmark (garage) + a tertiary ribbon of in-line for-sale shops, with a non-buildable forecourt/parking apron giving a clear street wall.
- NIGHT — hot neon at the intersection (district-palette signage, mall sign tower, garage pylon, warm showroom glass), every lit mesh on the 1-daylight emissive floor; DAY — calm.

## Where it sits above the epic and phases

This vision sits ABOVE the epic and the phase plan. The epic is the Street Rod north-star and status; phase-1 is the spine that ships first; this doc is the open-world map that says where the world is going AROUND that spine. The district/mall/garage arc is WORLD DRESSING that makes the drive feel like a car game — it must never displace the phase-1 spine.

## Roadmap — where we are going (strict ordering)

Gate per district slice: does this ladder toward the night meetup and the race? If not, it waits.

1. FINISH PHASE-1 (car lane) — one-button meetup + presence (S2), nameplates (S3, Joe), rally venue + classifieds (S4-S5, Jack). NO district work starts until S2 is merged.
2. PHASE 2A — DISTRICT SCALE-UP (Jack) — grow the reserve, add the cross-street + intersection, widen carriageways.
3. PHASE 2B — MALL + GARAGE IDENTITIES (Jack data + car-lane seam) — mall_anchor + car_garage businesses, pad ranking.
4. PHASE 2C — LANDMARK MASSING (Jack render + Joe signage) — mall + garage massing, pylon signage, POI markers.
5. PHASE 2D — AUTHORED GLB SHELLS (Jack, optional uplift) — replace code-massed boxes with Blender-authored shells per spec 100.
6. PHASE-2 RACE (car lane, blocked) — own-car rally race on the Codex carSpec hook; the new intersection is its start/checkpoint.

Beyond the spine + the commercial district lies the FULL open-world arc (Irwin: as far as we can). These are the PARTS this document grows into; each is scoped into its own slices + spec when it starts, and the phase-1-first gate + determinism + lanes hold throughout:

7. PHASE 3 — FREE-ROAM DRIVING (car lane) — drive your tuned car anywhere on the road network, not only guided walks or the race track; the car becomes the primary way you move through the world.
8. PHASE 4 — A REAL ROAD NETWORK YOU CRUISE (Jack + car lane) — multiple intersections, loops and shortcuts (not one hero crossing), so the map reads as a legible open-world you navigate by landmark.
9. PHASE 5 — THE CITY LIVES AROUND YOU (Jack + Joe) — ambient traffic + citizens on the streets, the day-browse / night-cruise rhythm made real, more districts and landmarks to drive between.
10. ONGOING — this document is the live breakdown: it is updated as the direction evolves into each part, and each part earns its own spec as it begins.

## Lane ownership

- World & Build (Jack) — the district shape, the mall anchor, business identities, the massing, the GLB shells. Files: commerce/district.ts, commerce/businesses.ts, the commercial block in runtime.ts, PlanetRenderer rebuildCommercial, venuePropAssets.ts, billboards.ts.
- Car / Garage (me) — the garage LANDMARK STRUCTURE itself (a SeedStructure placed by `findGarageSite`, mirroring the rally point), goToGarage(), and the garage-door -> tuning-UI link. Jack builds the commercial district AROUND it; the storefront identity is the read-only seam. The car lane never edits rally proximity logic. Later, free-roam driving (phase 3) is also car-lane.
- Player & UI (Joe) — mall/garage/intersection nameplates + POI markers, signage iconography polish, first-person framing of the intersection stage. Read-only from the world model.

## Hard rules (carried from TEAM-LANES.md)

- Deterministic placement — no Math.random/Date.now in the sim; intersection = argmax road-degree, x-then-y tie-break; pads reserved in fixed order before the satellite scatter; businesses assigned by fixed pad rank. A node test asserts identical district+mall+garage+intersection cells across two runs.
- isPublicSafe on every shown string (mall name, garage name, tenant names).
- Night emissive floor on every lit mesh, nameplate, UI element; verify at low light, never only at noon.
- Protected main, PR-only, CI-safe commit bodies, docs in the same PR.
- Stay in your lane — the garage storefront is the only cross-lane seam (read-only/additive).

## Decisions + open questions

RESOLVED (Irwin, 2026-06-25):

- HOW FAR TOWARD NFS -> as far as we can: the FULL open-world car game endgame, reached in staged parts (see Direction locked + the roadmap).
- REPLACE vs AUGMENT -> REPLACE the current high street with the larger district.
- GARAGE MODEL -> a first-class LANDMARK STRUCTURE (a SeedStructure placed by findGarageSite, like the rally), not a corner shop-parcel.
- INTERSECTION AMBITION -> one hero intersection for the commercial district NOW; a real road mesh with loops/shortcuts arrives in the full-open-world arc (phase 4).

STILL OPEN (Irwin to steer):

- MALL SCOPE — one always-present civic anchor, or a fully buildable mega-anchor bots raise over time? (Plan: the former.)
- REAL-KOOKER-APP FRONTS — should the mall front a real kooker hub app; should the garage front an app or stay a pure landmark? (Undecided.)
- DAY/NIGHT MOOD — how explicit should the in-world signalling of day-browse / night-cruise / night-race be?
- DISTRICT SIZE — replacing the high street gives room; how big should the district be relative to world.size=608 before it crowds residential/satellites?

---

This document is updated as the game evolves. Last direction set (2026-06-25): go as far toward a FULL open-world car game as we can (staged into the roadmap parts); REPLACE the current high street with the larger commercial district; make the garage a first-class landmark structure. All of it stays subordinate to, and gated behind, the phase-1 garage -> car -> meet -> race spine.
