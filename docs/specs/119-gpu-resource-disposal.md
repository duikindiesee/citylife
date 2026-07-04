# Spec 119 — GPU resource disposal (foliage, ocean, terrain)

qa_report.md item 3, widened to the whole leak class. three.js never frees GPU buffers on
its own; the R3F port rebuilt object trees wholesale without disposing the old ones. This
was mostly latent while the world was a still photo — since spec 115 made the world
actually re-render on sim mutations, the leaks compound in real sessions.

## What leaked

- **R3FFoliage** rebuilt a `ConeGeometry` inside the data memo on EVERY roads/buildings
  change — the cone is identical every time, so it was pure waste AND a leak. The wind
  material was never disposed on unmount.
- **R3FOcean** left the superseded ring geometry alive on `size` change and the patched
  shader material alive on unmount.
- **R3FTerrain** rebuilds the full chunked terrain (370k+ vertices + material) on every
  terraform/leveling change — the biggest leak in the class, one whole terrain per
  rebuild.

## Design

- `disposeDeep(root)` (`src/colony/render/disposeDeep.ts`): traverse and dispose every
  geometry, material (arrays included) and material-owned texture below a built tree.
  Contract: callers own the whole subtree — only for imperatively-built groups, never for
  JSX-managed objects (R3F disposes those itself).
- Foliage: the cone gets ONE lifetime memo (`[]`) + unmount dispose; the data memo returns
  only matrices/colors. Material disposed on unmount.
- Ocean: geometry disposed when replaced or unmounted; material disposed on unmount.
- Terrain: `useEffect` cleanup runs `disposeDeep` on the superseded group whenever a new
  one replaces it, and on unmount.

## Tests

`tests/disposeDeep.test.ts` — three.js in the node env, observing `dispose` events:
nested geometries, multi-material arrays, material-owned textures, and tolerance for
non-mesh children.
