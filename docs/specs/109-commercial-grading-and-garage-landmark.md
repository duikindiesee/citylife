# Spec 109 — Commercial pad grading + the missing garage landmark

Status: IN PROGRESS — P0 merged in #178; P1/P2 garage landmark implemented in current Jack/World slice · Date: 2026-06-26 · Source: operator screenshot + a multi-agent root-cause audit

## Why

The operator screenshotted the live commercial district (0.17.11) and flagged: shop pads still FLOAT with sheer BLACK undersides (on inland pads too, not just coastal), the "garage" is a flat black box that does not match the showroom concept Jack produced, and its front does not face the road. A multi-agent audit (4 defects, each adversarially verified) root-caused all of them.

## The through-line (verified)

Shops and the mall are seated on the LOWEST footprint corner with a dark foundation plinth (`foundH = hiY - loY + 0.7`, colour `0x2a2f38`, PlanetRenderer.ts ~3366-3387). Only COASTAL pads (`coastalDriedSeat = rawLoY < RENDER_DRY_FLOOR`) get terrain blending; INLAND parcels on a slope receive ZERO grading, so the plinth meets the hillside as a sheer black wall / floating-table silhouette. Homestead pads already avoid this with an UNCONDITIONAL smoothstep skirt (PlanetRenderer.ts ~1050-1060). And the "flat black building" is the ABSENT garage — there is no `garagePad`, no `findGarageSite`, and no garage massing anywhere (grep returns zero matches); what reads as a black box is the mall shell plus the dark plinths. Spec 102 left the garage asset-only.

## Prioritized fix plan

### P0 — Grade ALL commercial parcels (lead, DONE in this PR)

Port the unconditional homestead level-to-seat + smoothstep skirt to every commercial parcel + the mall pad, inside `relevelTerrain` (PlanetRenderer.ts, in the `if (cd)` block before the coastal blend). Each footprint is levelled to `max(groundY(centre), DRY)` and a 4-cell skirt ramps out with smoothstep into `max(worldY, DRY)` — identical to homesteads — so the dark plinth (`foundH` shrinks to ~0.7 once `hiY == loY`) is buried by graded terrain on EVERY pad, not just coastal ones. Render-only, deterministic (height-fn, no RNG), roads skipped (the ribbon bridges them). This is the cheapest, most-visible win and a prerequisite for seating the garage flush.

### P1 — Add the missing garage landmark (Jack/World, effort L)

The garage is the headline gap. (1) Add `garagePad?: GaragePad` to `CommercialDistrict` (commerce/district.ts, after `mallPad`). (2) Implement deterministic `findGarageSite(...)` modeled on `pickMallPad`, reserving a standalone pad on a hard corner near the intersection while excluding shop plots, the mall pad, and street/cross-street cells. (3) Call it from `makeCommercialDistrict` after `pickMallPad`; assign to the returned district. (4) Create `render/garageAnchorShell.ts` exporting `buildGarageAnchorShellModel(garagePad, surfaceYFn)` with distinct massing — glassy showroom cube, front glass/header, lower service-bay shed with three roll-up doors, compact facade-mounted blade sign, and forecourt display cars — matching Spec 102's asset triad and VISION-open-world.md. Seat it on `surfaceY` and include the garage pad in the Spec 109 P0 commercial grading pass so it lands flush with no dark plinth. (5) Call `this.buildGarageAnchorShell(d)` in `buildCommercialDistrict` right after `buildMallAnchorShell`, guarding optional `garagePad`. Deterministic-sim (site) + render-only (massing). NOTE: the garage is a standalone LANDMARK (not a shop kind), so it is NOT superseded by spec 108's large-venue track — ship it.

Implementation contract now used by the code:

- `GaragePad.kind === "garage_landmark"`, `publicName === "Gearbox Auto Hub"`, `isPublicSafe === true`.
- `GaragePad.facingAngle` is the Three.js Y rotation whose local `+z`/front points toward the district road/intersection.
- The render group is named `commercialDistrict.garagePad.garageAnchorShell` with public-safe `userData`.
- The night floor mesh is named `garageAnchorNightFloor`; `garageAnchorNightFloorEmissive(daylight)` clamps to `0.12` by day and `1.05` by night.
- The visible silhouette must include `garageAnchorGlassShowroom`, `garageAnchorGlassShowroomFront`, `garageAnchorShowroomHeaderSign`, `garageAnchorServiceBayBlock`, `garageAnchorRollupDoor.*`, `garageAnchorCornerPylonSign`, `garageAnchorRoadFacingForecourt`, and `garageAnchorDisplayCar.*` children.
- The garage sign, forecourt, display cars, and drive-in apron are visual footprint, not road furniture: the sign must be a low/wide facade-mounted fascia/blade sitting under the service-bay roofline, not a freestanding driveway/crossroad pole; commercial promenade lamp posts must be suppressed when their verge placement would land inside the garage pad/frontage; the rendered forecourt/apron samples must stay inside the garage pad so no post/apron reads as standing in the crossroad or blocking the roll-up doors.

### P2 — Orient the garage forecourt/showroom toward the road (folded into P1)

Today every shop front derives only from `side` (PlanetRenderer.ts ~3368, `front = -p.side`), so nothing reorients toward the intersection. Build the garage facing the road FROM THE START: add an optional `facingTurns`/`facingAngle` to the garage pad (or ShopParcel for showroom kind), compute the bearing to the intersection after it is chosen (district.ts ~151), and orient the garage massing from it. Do this inside the P1 garage work rather than as a separate pass.

### Flat-slab shops — DO NOT patch (superseded)

The near-identical shop aspect ratios + shared detail template are explicitly superseded by locked spec 108 (large-plot venue redesign: 12x10 bar / 20x16 sports / 12x8 market / 10x8 nursery + per-business massing). No interim massing patch — it wastes effort and risks lock-in. Jack's #176 high-street-variety is allowed to land as a free interim win (already built) but the real answer is spec 108 S3/S4. Tracked, not re-discovered.

## Verification

P0 verified in-world via `.flyby/verify-district.cjs` (HUD-free day+night oblique capture of the district). P1/P2 must be verified via Vitest plus day/night browser proof: the named garage group exists, the showroom/service-bay/fascia/forecourt children exist, `garageAnchorNightFloor` emissive maps from `0.12` day to `1.05` night, the garage pad is included in commercial grading, and screenshots include a Buildable/District placement-style aerial-front proof showing the distinct showroom+bays/fascia landmark facing the road rather than a rear/roof-only angle or a freestanding pole silhouette.
