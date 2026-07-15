# Ironwork Pillar (spec 144) - built render brief

## Intent

The Ironwork Pillar is a remote, ancient-looking mountain monument for IronworkAI. Its emotional
reference is the serene uncertainty of the constructed planet in _Stargate Universe: Faith_, but
the asset is an original CityLife design: a black faceted monolith, pale internal seams, a restrained
retune ring, and stone roots that disappear into the mountain.

The destination must be earned. It is not placed beside Landing One or connected by a drivable
avenue. A deterministic footpath leaves the nearest viable colony road, follows the land contours,
and reaches a walkable highland dais beside Mountain/Peak rock.

## Shipped form

- Asset: `public/assets/citylife/props/ironwork-pillar.glb`
- Generator: `scripts/generate_ironwork_pillar.mjs`
- Runtime component: `src/colony/render/R3FIronworkPillar.tsx`
- Placement and hike utilities: `src/colony/sim.ts`, `src/colony/ironworkPillar.ts`
- R3F mount: dressing stage in `src/colony/render/R3FPlanetRenderer.tsx`
- Visual height: 622 world metres (about 2,040 feet) from buried dais to sky needle
- Playable height: the original lower 64 metres retain the summit, mechanism, and collision contract
- Footprint: walkable 3x3 highland dais with a reserved two-cell halo
- Runtime budget: one cached GLB, two trail ribbons, three instanced trail meshes, no textures

The committed GLB is about 271 KB and has 86 mesh resources across 93 mesh nodes. It has no cameras,
lights, images, or texture
dependencies. The generator is deterministic and uses the repository's installed Three.js
`GLTFExporter`; Blender is not required to reproduce it.

## Three visual stages

### Stage 1 - buried foundation

`Pillar_Stage_1` contains a broad 34.8 metre twelve-sided mountain apron, a second 29.2 metre terrace,
an obsidian table, eight restrained floor runes, seven uneven sentinel stones, a 17.2 metre iron
foundation collar, undercroft core, six fractured stone roots, and five asymmetrical outcrop masses
on the mountain side. The wider roots and collar give the 622 metre shaft credible visual weight.
The roots sit below grade and the outcrop rises behind the shaft, making the structure continue into
the mountain rather than stand on a decorative plinth; the hiking approach remains open on the
colony side.

### Stage 2 - lower monolith

`Pillar_Stage_2` raises the solid lower shaft, four pale seams, four structural ribs, two brass bands,
and four braces around a pale inner retune ring. The shaft is faceted obsidian and black iron, not a
see-through gantry. `Pillar_Retune_Ring` is a single vertical old-brass ring with twelve named teeth;
it rests on the deterministic sim-clock tooth outside the retune hour.

### Stage 3 - skyline crown

`Pillar_Stage_3` raises the upper monolith, four upper ribs, and the 525 metre
`Pillar_Distant_Monolith` continuation before terminating in a narrow sky needle and broken crown
halo at 622 metres. Eight widely separated `Pillar_Sky_Glyph_*` marks interrupt the otherwise minimal
faceted surface. `Pillar_Crown_Iris`, `Pillar_Iris_Left`, `Pillar_Iris_Right`,
`Pillar_Crown_Halo`, and `Pillar_Crown_Core` remain runtime nodes. At midnight the iris parts, the
core and seams pulse, the broken aperture turns, and the retune ring completes its presentation-only
free run. At other hours it settles on `restingToothIndex(day, hour)`.

The extension is deliberately visual-only above the original construction. Normal gameplay keeps
the existing hike, summit footprint, lower collider, movement, and platformer-scale interactions.
The ordinary camera crops the upper shaft and lets distance fog consume it; dedicated proof requires
the base on-screen and the crown above the viewport rather than zooming out to display the whole prop.

Stage 0 remains genuinely invisible. While a stage is actively building, that stage grows vertically
with `pillarProgress`; completed sections remain at full scale.

## Mountain placement

`findIronworkPillarSite` searches much farther from Landing One than the original mechanics slice:
the default radius is roughly 30 percent of the terrain, capped at 190 cells, with a substantial
minimum hiking distance. A candidate must:

- be in the landing's traversable land component;
- keep its complete 3x3 dais dry, buildable, and off the colony road frame;
- remain clear of the lighthouse, rally, landing structures, and their wider landmark exclusion;
- fit within a 1.25 metre local height spread;
- favour Highland, high elevation, local prominence, and nearby Mountain/Peak or unbuildable rock;
- resolve ties by score, then lowest `y`, then lowest `x`.

This places the base on ground that first-person movement can reach while letting the authored roots
enter rough mountain geometry. The user can climb to it; the monument still reads as part of the
mountain.

## Hiking route

`buildIronworkHikePath` selects up to 32 nearby road candidates in deterministic distance order and
uses the shared `leastCostPath` router with diagonal movement and a strong slope cost. It forbids
beach, water, Mountain, Peak, and unbuildable cells. The first pass also avoids occupied land; a
terrain-only fallback preserves reachability for older saves whose later development encloses every
clean trailhead.

The renderer turns the cell path into terrain-following shoulder and worn-tread ribbons sampled from
a centripetal Catmull-Rom curve. It is deliberately narrow and non-drivable, with irregular centre
stones and paired waystones whose pale vertical slits become legible at night. `R3FFoliage` clears
the tread and summit so trees do not hide or intersect the route.

## Materials and night behavior

- `Pillar_Obsidian_Skin`: near-black faceted stone
- `Pillar_Black_Iron`: restrained structural metal
- `Pillar_Mountain_Rock`: matte root and dais stone
- `Pillar_Old_Brass`: retune ring and teeth
- `Pillar_Seam_Emissive`: pale green-white seams
- `Pillar_Core_Emissive`: crown and undercroft light

The palette avoids a saturated science-fiction glow. Daylight emphasizes the silhouette, faceting,
and mountain roots with a restrained local side light; darkness reveals a controlled pale internal
light in the summit runes, waystones, seams, and broken crown. Bloom comes from the world's existing
post-processing pass.

## Verification contract

- `tests/ironworkPillar.test.ts` proves deterministic placement, distance, elevation, rugged
  adjacency, occupied reservation, and a repeatable dry walkable hike from a real road cell.
- `tests/ironworkPillarGlb.test.ts` parses the committed GLB, checks the three stage groups and dynamic
  node names, verifies emissive materials, height, foundation width, size budget, deterministic hash,
  and public URL.
- `npm run typecheck`, focused Vitest, full Vitest, and `npm run build` must pass.
- Live browser verification must force stage 3 once in daylight and once during the 00:00 retune,
  inspect screenshots at desktop and mobile viewports, confirm the WebGL canvas is nonblank, and
  prove in camera space that the base is visible while the crown remains above the viewport.

## Ownership

Vesper owns the render lane on `codex/vesper-ironwork-monolith`. Mechanics remain the merged spec-144
contract. Review and merge stay with the CityLife fleet gate; the implementation does not self-merge.
