# Spec 168 — The desert island world (WORLD.DESERT.1)

- **Status:** proposed for review.
- **Depends on:** spec 084 (WORLD v2 sizing), spec 140 (no roads on beaches).
- **Design provenance:** operator — _"it was always a desert… we need to adjust the landscape into a
  city evolving in space in a desert island"_, with a Namib reference (golden dunes meeting a
  turquoise sea, mountains on the far horizon, glowing flora in the rock pockets) and the note that
  a desert _"gets very little rain, has few plants"_ and that **only a small part is covered in
  sand** — the rest is rock and gravel.

## What was already true, measured before changing anything

**The world is already an island.** Across seeds 4242/314/12/77, the number of land cells touching
the map edge is **zero on every seed**; ocean is 53–71% of the map. Nothing needed to be done to
make it an island — it needed to become a _desert_ one.

Terrain generation costs **104–143 ms** at size 608. The heightfield is not the expensive part of
boot, which matters for the archipelago work tracked separately as WORLD.ARCHIPELAGO.1.

## The rule this spec is built around

**Biome IDs are load-bearing for LAYOUT, not just colour.**

- `cityPlan.ts` scores settlement sites off `Biome.Forest` and `Biome.Plains` (30 points each).
- `neighborhood.ts` names hamlets from Forest/Highland ("wood1", "hill1", "vale1").
- `foliageLogic.ts` keys plant density off Forest/Plains/Mountain.
- `build.ts` and `pathfind.ts` treat `Biome.Beach` as impassable for roads (spec 140).

So a retheme may change **what a band looks like** and **what grows on it**, but must not change
**what a cell is classified as** — or it moves the city.

This was not assumed. Aridity was first implemented in `Terrain.classify()` as a per-world moisture
quantile, and it worked as designed: scrub fell from an inconsistent 1.0–15.9% to a tight 1.2–1.8%
on every seed. It also **broke three suites** — `roadWaterGuard` (the seed 4242 "Woods1" connector),
`roadTerrainClearance` (seed 1234) and `busFeltSpeed` — because the towns had moved. That approach
was reverted; all three pass again. The measurement is kept in the comments so nobody re-walks it.

**Consequence:** every world layout is byte-identical to `main`. This spec changes appearance only.

## What changed

### 1. Palette — `BIOME_COLOR` in `terrain.ts`

| biome            | reads as                                                         |
| ---------------- | ---------------------------------------------------------------- |
| Plains           | stony tan — the **rock and gravel** that is most of a hot desert |
| Highland         | rust dune shoulder                                               |
| Beach            | bright coastal sand                                              |
| Mountain         | dark exposed rock                                                |
| Peak             | wind-scoured pale crest                                          |
| Forest           | dry scrub                                                        |
| Ocean / Shallows | deep teal / turquoise — kept vivid **on purpose**                |

The sea stays turquoise deliberately: the whole Namib read is the contrast between a dead-dry coast
and a vivid ocean. Sand tones are reserved for the coast and the dune shoulders, so sand is the
exception rather than the whole surface.

### 2. Flora — `foliageLogic.ts`

Density, on the **unchanged** classification:

| biome    | before                    | after                      | why                                         |
| -------- | ------------------------- | -------------------------- | ------------------------------------------- |
| Forest   | `2 + h1*3` (2–4 per cell) | `h1 > 0.66` (≈34% get one) | the damp hollow: a scattering, not a canopy |
| Plains   | `h1 > 0.8` (20%)          | `h1 > 0.97` (≈3%)          | open desert should read as empty            |
| Mountain | `h1 > 0.9` (10%)          | `h1 > 0.98` (2%)           | bare rock                                   |

On seed 4242 that is roughly 87,000 plants before and ~10,000 after. Forest is 6.5% of the map on
seed 4242 and 15.9% on seed 314, so leaving it at 2–4 per cell would simply have produced a _neon
forest_ instead of a green one.

Colour: the six temperate greens became six bioluminescent hues — cyan, magenta, lime, violet,
amber, ice-blue — and the brightness jitter floor was raised from 0.7 to 0.9, because dimming a neon
hue to 0.7 just makes it muddy. Against pale sand these read as light rather than shrubbery.

**They do not yet actually glow** — they are bright vertex colours, lit like any other surface, so
they go dark at night. Making them emissive is tracked separately as WORLD.GLOW.1 rather than
smuggled in here.

## Acceptance

1. The world reads as a desert island: golden ground meeting a turquoise sea, sparse flora.
2. **No world layout changes.** `roadWaterGuard`, `roadTerrainClearance` and `busFeltSpeed` — the
   seed-pinned layout suites — stay green, which is the discriminating evidence, since those are
   exactly the three that failed when classification was touched.
3. The full unit suite stays green.
4. Screenshots from World View, before and after.

## Deliberately not done here

- No change to biome classification, sea level, elevation or river carving.
- No emissive/bloom work (WORLD.GLOW.1).
- No world expansion or extra islands (WORLD.ARCHIPELAGO.1).
