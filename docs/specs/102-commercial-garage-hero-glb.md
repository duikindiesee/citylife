# Spec 102 — Commercial Garage Hero GLB

- status: building
- proposed-by: Irwin / Jack World & Build lane
- date: 2026-06-25
- depends-on: Spec 100, Phase-1 S2 for any future in-world commercial-district placement

## Why

CityLife is becoming a Need-for-Speed-feel open-world car game. The garage must read as a hero landmark in that world: the place you remember, cruise past, tune at, and use as the visual anchor for the future commercial district.

This spec deliberately shipped only the authored asset shell. The in-world runtime placement is owned by Spec 109: the garage is now a standalone deterministic landmark pad + render-only massing, not the small `Gearbox Garage` shop identity from Spec 107 and not superseded by Spec 108's future large-venue redesign.

## Mechanic

Author one public-safe, low-poly Blender GLB hero asset for the future auto-retail garage landmark using the Spec 100 pipeline:

- deterministic generator script under `public/assets/citylife/props/`;
- generated GLB under `public/assets/citylife/props/`;
- no world placement, no runtime registration, no commercial-district reserve changes in this slice;
- named meshes/materials that make the asset reviewable and future-loadable by CityLife code-owned transforms.

## Visual identity

The asset is the auto-retail triad:

1. **Warm glass showroom cube** — a transparent, warm-lit display volume with a glowing low-poly car inside.
2. **Lower service-bay shed** — darker/shorter workshop mass with two roll-up doors, ribbed door slats, a lit threshold, and a forecourt lane.
3. **Tall corner pylon sign** — the dominant vertical silhouette, visible across the future district, using abstract light panels only.

Supporting details:

- two angled forecourt display cars facing the road;
- warm lane and under-car night-emissive strips;
- rooftop wrench/tool emblem for garage/service identity;
- stylized graphite trim, warm amber glow, and small cyan edge accents to match the calm-day / neon-night CityLife visual language;
- public-safe by construction: no brands, no text, no private names, no real-world marks.

## Rules & data

- Blender owns geometry, mesh names, material names, and the exported GLB only.
- CityLife code owns all future placement, rotations, scales, district association, and interaction seams.
- The generator must be deterministic: fixed dimensions, transforms, names, materials, and output path; no random or wall-clock input.
- The asset must stay low-poly and game-ready, suitable for later instancing or landmark loading.
- The GLB output is `commercial-garage-hero.glb`.
- The generator is `generate_commercial_garage_hero.py`.

## Cost — materials & labour

This is an art/asset pipeline slice, not an in-world buildable mechanic yet. Future placement and construction costs belong to the commercial district / garage landmark placement spec after the Phase-1 gate.

## Acceptance

- Generator source includes the required named geometry contract:
  - `commercial_garage_hero_showroom_glass_cube`
  - `commercial_garage_hero_showroom_car_glow`
  - `commercial_garage_hero_service_bay_shed`
  - `commercial_garage_hero_rollup_door_left`
  - `commercial_garage_hero_forecourt_lane`
  - `commercial_garage_hero_corner_pylon_sign`
  - `commercial_garage_hero_display_car_angle_left`
  - `commercial_garage_hero_rooftop_wrench_emblem`
  - `commercial_garage_hero_warm_night_emissive`
- Vitest source-contract test passes and asserts no random/wall-clock or unsafe literal markings.
- Headless Blender generates the GLB successfully.
- Blender import/render proof views show the showroom, service bay, pylon, display cars, rooftop emblem, and night glow clearly enough for Irwin review.
- No world placement/runtime commercial-district changes are included before the S2 gate.
