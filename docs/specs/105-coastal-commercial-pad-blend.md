# Spec 105 — Coastal Commercial Pad Blend

## Problem

After Spec 103 and PR #164, coastal commercial shop seats are kept dry and shops sit on `surfaceY`.
That fixes the submerged-shop case, but steep shoreline frontages can still read as flat green tables:
the dry seat meets lower sea-floor/shore cells in a hard vertical face, which becomes a sheer black side
face and floating-pad silhouette at night.

## Rule

Commercial seat dry height stays owned by the existing `DRY` pass. This spec adds only a render-time
blend around commercial seat rectangles:

- keep every below-dry commercial shop/mall seat cell at the dry floor;
- for adjacent shoreline/sea-floor cells below the ordinary land band, raise a bounded apron toward the
dry seat using deterministic smoothstep falloff;
- skip road-ribbon cells so road bridges keep their own grade;
- leave high-ground cells natural so inland shops and homestead pads retain their current read;
- keep coastal dried-seat shop plinth/body side material in an earthier non-black band so night views do
  not turn the dry seat into a black tabletop silhouette;
- do not change simulation terrain, water logic, pathing, zoning, or deterministic placement.

## Visual acceptance

From the seaward side of the seed-4242 coastal commercial reserve (`{x:81,y:241,w:64,h:48}`), the
coastal-most shop pads should blend down toward the shoreline in day and night views. The proof target is
no obvious floating-table pad and no one-cell sheer black vertical side face where the dry seat meets the
water/shoreline.

## Test coverage

`tests/terrainLeveling.test.ts` covers the pure deterministic helper: it dries the seat, lifts only the
shoreline apron, skips road-ribbon cells, and does not disturb inland/high ground.
