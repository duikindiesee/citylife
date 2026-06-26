# Spec 110 — Corner garage: two-street L-lot, glass showroom + drive-in bays + corner island pylon

Status: DESIGN · Date: 2026-06-26 · Owner: lead (design) · Source: Irwin brief + NFS corner-garage reference

## Why

The current garage (#180 + the spec-110 visual upgrade) is a single rectangular pad scored to sit NEAR the intersection but with street cells EXCLUDED (`findGarageSite`, district.ts:290-370, `garagePadFits` rejects street/cross cells). Result: an awkward square shoved *beside* the junction — Irwin: "you tried to bastardise the square to be shifted so it is in between two streets." A real auto landmark on a crossroads is a **corner LOT**: an L-shaped building that wraps the intersection with a frontage on EACH street, a glass showroom gallery on the primary street, drive-in workshop bays on the secondary, and a landscaped **corner island with a sky-high pylon** right at the junction.

## The corner-lot model (target)

Top-down, at the intersection of the high `street` and the `crossStreet`:

```
            high street (primary)
   ════════════════╤════════════════
                    │ cross
   ┌──────────────┐ │ street
   │  GLASS       │ │ (secondary)
   │  SHOWROOM    │ │
   │  (cars on    │ │
   │   display)   ●─┘   ● = corner ISLAND + sky-high PYLON
   │              │     (at the junction corner)
   │   ┌──────────┘
   │   │ DRIVE-IN BAYS (open roller doors)
   └───┴──────────────  ← cars drive in off the cross street
```

- The garage occupies ONE quadrant of the intersection, set back 1 cell from each carriageway.
- **Showroom wing** runs ALONG the high-street frontage (the busy face): full glass curtain wall, cars on display inside, visible to the street.
- **Workshop/drive-in wing** runs ALONG the cross-street frontage: open roller-door bays you drive into (drive-through), kept off the primary face for a clean showroom front.
- The two wings meet at the inner corner -> an **L footprint** that hugs the junction.
- A small **corner island** sits in the diagonal cell at the junction (between the two setbacks); the **sky-high pylon sign** stands on it, illuminated, readable from BOTH streets.

## Placement redesign (`findGarageSite`, district.ts)

Replace "nearest non-street rectangle" with "best CORNER quadrant":
1. Take the `intersection` (already from `pickMajorIntersection`).
2. For each of the 4 quadrants (±x, ±y off the intersection), test an L-or-rect footprint seated 1 cell back from both the `street` line and the `crossStreet` line, inside the reserve, not over shops/mall/water.
3. Score by: both frontages actually adjoin their road (a real two-street lot) + hard-corner bias + determinism tiebreak (smaller x then y). Pick the best quadrant.
4. Emit an extended `GaragePad`: add `streetFrontDir` (unit vec toward the high street) and `crossFrontDir` (toward the cross street) and `islandCell` (the junction-corner cell for the pylon). `facingAngle` aims the showroom at the high street; the bays derive from `crossFrontDir`.
5. Grow the pad: corner lots read bigger — bump `garagePadW/H` (config.ts) so the L has room for a showroom wing + a 3-bay workshop wing (e.g. ~16x12, tune in impl).

## Massing redesign (`garageAnchorShell.ts` + PlanetRenderer garage build)

Keep all existing named children (additive contract), but re-place them onto the two wings + island:
- **Showroom wing (high-street face):** the `garageAnchorGlassShowroom` becomes a LONG glass curtain along the street frontage (cool glazing + dark lit interior already in the visual upgrade), with `garageAnchorDisplayCar.*` INSIDE the glass (cars on display in the gallery), a slim `garageAnchorShowroomHeaderSign` fascia, and a cantilevered canopy.
- **Workshop wing (cross-street face):** the `garageAnchorServiceBayBlock` + the 3 `garageAnchorRollupDoor.*` move to the cross-street frontage; the middle bay is the OPEN drive-in (recessed `garageAnchorOpenBayInterior` + `garageAnchorDriveInApronRamp`) facing the cross street so a car cruises in off the secondary road. Mono-slope industrial roof.
- **Corner island + pylon:** a small raised `garageAnchorCornerIsland` (planter/kerb) at `islandCell`; the `garageAnchorCornerPylonSign` stands on it, taller (sky-high), illuminated, with a `garageAnchorPylonWordmark` readable from both streets. Fuel/charge island optional beside it.
- **NFS aesthetic / day-calm-night-neon:** dark industrial workshop + bright cool glass showroom + warm neon pylon + polished emissive forecourt; night emissive ramps via `garageAnchorNightFloorEmissive` (locked helper). Accent guide-chevrons on the drive-in apron.

## Drive-in (corner-aligned)

The open bay faces the CROSS street (the secondary intake), apron + guide chevrons run from the bay mouth to the cross-street carriageway, aligned to `crossFrontDir`. Visually drive-into-able now; the actual car drive-through is gated on the free-roam `carSpec` hook (Codex lane) — this lays the corner geometry + approach.

## Determinism + scope

All pure over (terrain, reserve, street, crossStreet) — no Math.random/Date.now. Render-only massing. The placement change touches `findGarageSite`/`GaragePad`/`garagePadFits` (sim-deterministic) + config sizes; massing touches `garageAnchorShell.ts` + the PlanetRenderer garage build. Extend `garageLandmark.test.ts`: two frontages adjoin their roads, island cell at the junction, open bay on the cross face, deterministic quadrant pick. Verify day+night, both street views.

## Open question for Irwin

Footprint scale: a compact L (~14x10) that tucks into one quadrant, or a bigger statement lot (~18x14) that dominates the corner like an NFS dealership? (I'll default to the bigger statement lot unless you say compact.)
