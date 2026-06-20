# CityLife Visual Artifact Standard — the "thing" format

Every **material, building, tool and object** in the world is a **visual component**. Nothing ships as a
bare number. This is CityLife's modding-style contract: the way a game hands its players a tool to build
and extend it, every thing in CityLife is declared in **one agreed format**, so the world can be _seen_,
and later _saved, duplicated, and made scarce_ (see the persistent-things backlog), and so the autonomous
routines always produce things that are **rendered, not just counted**.

## The rule (binding on the Design Council + Review & Build)

> A spec that introduces a new thing — a building/worksite, a material/good, a tool, or a placed object —
> is **NOT complete until that thing renders on :5188** to the declaration below. **Visual is part of
> "done"**, verified in the same live screenshot as the mechanic. **Animation is a bonus, never required.**
> A mechanic the player cannot _see_ is not foundational.

## The format — `VisualSpec`

A thing is declared by a block (conceptually JSON/TS) alongside its economy contract:

```ts
{
  id: string,            // stable id — "gallery", "duskcap", "toolkit", "planter"
  kind: 'building' | 'material' | 'tool' | 'object',
  name: string,          // display name
  // ECONOMY (already the house standard): materials + labour to make, what it consumes/produces.
  // VISUAL (this standard): how it is drawn. One agreed shape language:
  visual: {
    form: 'box' | 'cylinder' | 'cone' | 'sphere' | 'pad' | 'composite',
    color: number,        // 0xRRGGBB
    emissive?: number,    // 0xRRGGBB glow (lamps, beacons)
    size: [number, number, number],   // [w, h, d] in world units (1 grid cell = 1 unit)
    parts?: VisualPart[], // composite massing — a roof on a body, a mast, a canopy
    pile?: { unit: 'crate' | 'sack' | 'barrel' | 'ingot' | 'bolt', per: number },
                          // MATERIALS ONLY: a stockpile renders as floor(stock / per) visible units,
                          // so a full larder looks full and a lean one looks bare — visible scarcity.
    icon?: string,        // a HUD glyph
  },
  anim?: { kind: 'pulse' | 'spin' | 'bob' | 'smoke' | 'flag' | 'flow', speed?: number }  // BONUS
}
```

A `VisualPart` is the same `{ form, color, size }` plus an `offset: [x,y,z]` and optional `anim`, so a
building is composed (body + roof + chimney) instead of a single coloured box.

## Worked examples

- **Building — Skydeck Gallery:** `form: composite` — an amber `box` body `[2,1.1,2]` + a glass `box`
  canopy part offset on top. No anim needed.
- **Material — duskcap (food):** `pile: { unit: 'sack', per: 20 }` drawn on the Fungus Cellar's pad — 100
  duskcap shows 5 sacks, a near-empty larder shows none. The counter becomes a visible store.
- **Tool — tool-kit:** a small `box` crate token stacked at the Tool Crib, count = stock / per.
- **Object — Planter Square in Bloom:** a `pad` with a `composite` of small green `cone` shrubs; `anim:
flow` (a gentle sway) as a bonus only.

## How the renderer consumes it (the build-out path)

The renderer today draws buildings as a coloured box scaled by `artifact.height`. The standard is the
direction to grow toward, in shippable slices:

1. **Stockpiles become visible.** Materials/goods render as `pile`-quantised units at their producing
   building, growing and shrinking with the count. The deep-but-invisible economy becomes a living
   warehouse — and scarcity/duplication (backlog) become literally visible.
2. **Goods + services move.** Trucks already drive construction crews on the roads; extend so a _delivered
   good_ (food to a depot, wares to a home) is a visible cargo run, and a _service_ (a clinic round, a
   ration drop) a visible figure on the footpaths. This is how CityLife answers Caesar III (see
   `docs/research/2026-06-02-living-economy.md`).
3. **Buildings get their declared massing**, retiring the plain box for `composite` forms.

## Physics of the world (non-negotiable, alongside visuals)

- **Roads never pave over open water** — they break at the shore (bridges are a future, explicit mechanic).
- **Ground agents keep to land** — people and cars obey the same water barrier; nothing floats.
- New placed things sit on **buildable, on-land** ground, fitted to slope (see the sized-plot work).
