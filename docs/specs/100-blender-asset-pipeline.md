# Spec 100 — Blender-to-glTF Asset Pipeline

## Status

Phase-1 proof slice. This PR proves a Blender-authored prop can be generated, committed as a GLB, registered as a public-safe CityLife asset, loaded through `GLTFLoader`, and rendered in-world as deterministic `THREE.InstancedMesh` instances.

## Goals

- Keep asset authoring and world placement separate.
- Commit both the deterministic Blender generator script and the proof GLB under `public/assets/citylife/props/`.
- Load GLB meshes once and stamp them as instances at CityLife-owned coordinates.
- Make rally venue props the first asset family, then expand to buildings/storefronts, characters, cars, and garage parts.
- Keep every committed asset public-safe: no brands, no private names, no real-person data, no secrets.

## Architecture

```text
public/assets/citylife/props/generate_rally_venue_bench.py
  └─ headless Blender export
public/assets/citylife/props/rally-venue-bench.glb
  └─ proof GLB served by Vite from /assets/citylife/props/rally-venue-bench.glb
src/colony/render/venuePropAssets.ts
  ├─ CityLifePropAsset registry: id, repo-relative url, instanceKind, publicSafe
  └─ deterministic rallyVenuePropPlacements(...)
src/colony/render/gltfPropLayer.ts
  └─ GLTFLoader → cloned geometry/materials → THREE.InstancedMesh
src/colony/render/PlanetRenderer.ts
  └─ adds the GLB prop layer beside existing render-only prop layers
```

Blender owns canonical mesh geometry, material names, and the GLB export. CityLife owns all placement: city cell, world-space conversion, terrain height, rotation, scale, public-safety gating, and instance count. A `.glb` must not encode gameplay placement.

## Proof asset

The proof asset is a public-safe rally venue bench:

- generator: `public/assets/citylife/props/generate_rally_venue_bench.py`
- GLB: `public/assets/citylife/props/rally-venue-bench.glb`
- registry id: `rally-venue-bench`
- instance kind: `rallyVenueBench`
- URL: `/assets/citylife/props/rally-venue-bench.glb`
- `publicSafe: true`

The model is intentionally low-poly and stylized. It includes a small emissive floor marker material (`public_safe_rally_bench_night_emissive_floor`) so lit venue props read at night without needing the Blender file to know where it will be placed.

## Deterministic placement rule

`rallyVenuePropPlacements()` finds the existing rally `SeedStructure` and places one bench at a stable offset from the rally city cell. The current preferred offset is `(rally.x + 2, rally.y + 1)` with a fixed `0.125` turn rotation. If that cell is out of bounds or water, the function tries a fixed fallback list and otherwise emits no placement.

No `Math.random`, `Date.now`, wall-clock, or loader timing affects placement. Loader timing only affects when already-defined instances become visible after the GLB resolves.

## Rendering rule

`buildGltfPropLayer()` groups placements by asset id, loads each public-safe asset with `GLTFLoader`, traverses the loaded scene meshes, clones geometry/materials, and creates `THREE.InstancedMesh` objects with deterministic matrices derived from city coordinates. Night updates adjust emissive material intensity from the sim daylight value.

## 5191 night check

The deterministic vitest uses a terrain stub with `worldY() = 5.191` to lock the rally placement proof against the requested 5191 night-height check. The GLB layer also has an explicit `update(daylight)` hook that increases emissive intensity as daylight approaches zero.

## Asset roadmap

1. **Rally venue props first** — benches, small stage lights, cones, barriers, signage shapes, safe crowd/meetup props, all public-safe and stylized.
2. **Buildings and storefronts** — canonical shell pieces, awnings, doors, signs, window modules, roof props, still placed by deterministic CityLife parcel/building code.
3. **Characters** — low-poly public-safe resident silhouettes and accessory packs. The sim owns identities and routes; GLBs only provide mesh variants.
4. **Cars** — vehicle bodies, wheels, lights, interiors. Car state and placement remain deterministic CityLife state.
5. **Garage parts** — rims, spoilers, bumpers, body kits, tools, shop props. Classifieds/garage models own inventory; GLBs provide renderable parts.

## Safety and CI requirements

- GLB URLs must remain repo-relative under `public/assets/citylife/`.
- Every asset registry entry must carry `publicSafe: true` only after verifying the generator and materials contain no private data or brand references.
- New placement logic must have a deterministic vitest.
- Typecheck and targeted vitest must stay green before push.
- PRs must be rolling per slice and never self-merged.
