# Spec 142 — the crowd stands on the road, not under it

## The complaint

The operator watched Joe the crab (and the citizens/pedestrians) walk **into the ground** wherever
they crossed a road — only the top of Joe's head and headset poked above the tarmac.

## Root cause

The road **ribbon** (spec 127) renders as a raised carriageway at `getSmoothRoadY + ROAD_RIBBON_LIFT`.
But the moving figures grounded on `leveledWorldY` — the terrain *under* the ribbon:

- citizens + Joe: `R3FAvatars` `groundY`
- ambient pedestrians: `R3FPedestrians` `groundY`
- porters' carts: `R3FPorters`

On a road cell the ribbon sits above the leveled ground (measured ~0.24 m on a gentle grade, up to
~1 m where the grading doesn't fully reach the ribbon), so every figure sank by that gap. The parked
operator car already did the right thing — it rides `getSmoothRoadY + ROAD_RIBBON_LIFT` on road cells
— the crowd just never got the same treatment.

## The fix

`src/colony/render/crowdGround.ts` — one shared `crowdGroundY(terrain, terrainLevel, roadSet, gx, gy)`
that returns the **ribbon top** on a road cell and the **leveled ground** everywhere else. The three
crowd layers call it instead of `leveledWorldY`. Figures now stand exactly where the ribbon renders.

**The first-person player is deliberately left alone.** The player is a Rapier physics body on the
terrain heightfield collider (the leveled ground); lifting it onto the ribbon would re-open the
guardrail-vs-collider bounce (spec 134). The crowd figures are placed directly each frame with no
physics, so riding the ribbon is safe for them. (If the ribbon floats far above the collider on a
graded section, that is a *leveling* gap to close separately, so the player collider and the ribbon
agree — tracked, not fixed here.)

## Verification

`tests/crowdGround.test.ts` pins the surface choice (ribbon on road cells incl. ignoring an off-road
leveling override; leveled ground otherwise; null-roadSet fallback). Live: a citizen on a road cell
measured `atRibbon` (within 0.05 m of `getSmoothRoadY + lift`), 0.24 m above the ground it used to
sink to.
