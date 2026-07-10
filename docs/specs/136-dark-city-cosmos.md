# Spec 136 — Dark City: the floating world, the stars, and the blue gas giant

Operator: "I miss this view... the stars and the floating world and the blue gas giant
that is part of the story." None of it existed in v3 — the entire legacy buildPlanet
(Dark City) block was unported, and three v3 defaults actively fought it.

## Ported (verbatim from legacy buildPlanet, ~542-672)

`darkCity.ts` (pure, node-tested) + `R3FDarkCity`: the tapered nine-sided rock slab the
island floats on, the cyan waterline rim + taller halo, two deterministic Fibonacci
starfield shells (2,800 dust + 380 bright, fog-disabled, beyond the orbit cap), and the
blue gas giant with its additive atmosphere at the legacy absolutes. Slab/rim dimensions
scale from the WORLD width (legacy was 1 unit/cell; v3 is 4).

## The three v3 fights, fixed

1. **Camera far plane 1000** culled everything cosmic → raised to 12,000 (near 0.5).
2. **The ocean had the house-scale bug**: a 602-unit ring under a 1,216-unit-radius
   island — it cut through mid-island terrain (the "water" seen around the commercial
   district) and bared the void at the coasts. Now reaches the slab waterline (0.72 ×
   world width) like legacy.
3. **The spec-131 daylight clamp covered world view**, making night unreachable from
   above — the exact vantage of the missed vista. Narrowed to the BUILDER only (the
   operator's actual request); world view follows the real clock again.

Plus: the drei `<Sky>` dome was removed — it had ALWAYS been far-plane-clipped into
invisibility (the sky look comes from the lerped background colour); the raised far plane
let a corner of its box in as a beige wall. The void + stars + giant ARE the sky. And the
waterline rim fades with daylight (additive cyan blows out white against the bright day
background — the legacy sky was void-dark even by day).

## Tests + evidence

`tests/darkCity.test.ts` — slab/rim/halo present and world-scaled, both star shells
beyond the orbit cap and deterministic across builds, giant + atmosphere co-located
beyond the cap and inside the far plane. GPU night screenshot: the giant over the dark
horizon, stars out, island silhouetted — the operator's remembered vista.
