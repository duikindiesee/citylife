# Spec 111 — Commercial reserve scale-up + corner drive-in garage

Status: BUILT · Date: 2026-06-26 · Owner: Jack / World+Build lane

## Why

The commercial district needed enough room to read as a real coastal high street after the mall and standalone garage landed. The older `64x48` reserve and `12x8` garage pad made the auto landmark feel like a box beside the junction instead of a drive-in corner lot.

## Mechanic

- Commercial reserves now survey at `88x64` cells.
- The standalone garage pad now surveys at `16x11` cells.
- `findGarageSite` scores the four deterministic quadrants around the district intersection and chooses the valid corner nearest a reserve corner, with stable x/y tie-breaks.
- `GaragePad` now carries `streetFrontDir`, `crossFrontDir`, and `islandCell` so the renderer and later drive-in interactions know which street face is the showroom face, which face is the service-bay intake, and where the pylon island belongs.
- The garage render shell stays square to the surveyed cross-street frontage instead of rotating diagonally toward the junction centre; its pylon mesh is derived from `islandCell` so the visual sign lands on the surveyed corner island.
- Shop parcels that would overlap the selected corner garage/pylon cell are dropped before business assignment; this preserves the garage corner without relaxing shop variety tests.
- The ad-board survey keeps its normal street-approach placement, then falls back to a deterministic reserve-edge scan so the larger live seed `4242` still gets at least one public board.

## Rules and data

- Deterministic only: no `Math.random`, `Date.now`, `performance.now`, or wall-clock inputs in the district, business assignment, or ad-board survey paths.
- Terrain gates remain `cellOk`: garage pads, shops, and boards must be dry/buildable/not rock.
- Business variety is fixed with additional authored, public-safe business identities, not by lowering the neighbour-repeat threshold.
- The golden district layout is pinned for seeds `4242`, `42`, and `7`.

## Acceptance

- `districtDeterminism` is re-pinned to the new `88x64` reserve layout.
- Dev seed `4242` places at least one ad board.
- The high-street business assignment has no immediate neighbour repeats and every visible name appears at most twice by adding identities.
- `garageLandmark` and `commerceDistrict` tests assert `16x11` corner anchoring and `islandCell` metadata.
- Full local test, typecheck, build, and day/night in-world browser proof are required before merge.
