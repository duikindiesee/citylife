# Spec 134 — the walker stands on the leveled ground

Operator report: "it is jumping up and down ever since I came out of the water."

## Root cause

The first-person guardrail clamped against RAW `terrain.worldY`, while the physics
heightfield collider carries the LEVELED heights (pads, dry-blend, and since spec 130 the
road grading, which both fills AND CUTS). Wherever the grading cut the ground below
natural height — road cuttings, shore banks, exactly where a swimmer climbs out — the
capsule stood on the graded floor, the clamp read raw terrain half a metre or more above,
teleported the walker up to raw+1.5, gravity dropped them back to the collider, and the
loop repeated: the endless bounce. (Flagged as latent by the spec-127 adversarial verify,
P1; spec 130 made it commonplace.)

## Fix

`leveledWorldY(terrainLevel, terrain, x, y)` (exported from useTerrainLeveling) — override
when the leveling reshaped the cell, raw otherwise. The FirstPersonController takes the
`terrainLevel` map and clamps against the leveled surface; the spawn point uses it too.
One surface of truth: what the collider stands you on is what the guardrail protects.

## Tests

`tests/leveledWorldY.test.ts` — override wins, raw fallback, and a zero-height override
(a cut to sea level) is honoured despite being falsy.
