# Spec 135 — the commercial district in v3

Operator: "what happened with the road to the commercial buildings?" — the road (spec 127
ribbon) was fine; the BUILDINGS did not exist. Nothing in v3 rendered
`sim.state.commercialDistrict` (only the foliage culler consumed it): the neon strip, the
mall anchor, the garage anchor and the business labels were legacy-private — the port-131
audit swept the renderer's public method surface and never saw them.

## Design

- **`commercialDistrictLayer.ts`** — the legacy pipeline (PlanetRenderer ~3263-5129:
  buildMallAnchorShell, buildGarageAnchorShell, buildCommercialDistrict, business labels,
  props, roofs, emblems, billboards, promenade lamps) extracted VERBATIM by a mechanical
  script: `this.*` context rewritten onto a `CommercialCtx` object (named `C` — the sign
  painters use canvas 2D contexts named `ctx`), `PlanetRenderer.NEON` → module const, the
  crab emblem re-pointed at the shared `crabGeometry` module (spec 132). 2,010 lines,
  tsc-clean on the first generated pass. Headless guards skip canvas painting where no DOM
  exists (node tests).
- **`buildCommercialDistrictLayer(opts)`** returns `{ group, update, dispose }` — the
  shoreProps shape. `update(daylight, camera, scene, canvas)` carries the legacy frame
  block: signage flaring after dark, the three night-floor curves, label projection +
  occlusion fade.
- **`R3FCommercialDistrict`** builds on `commercialSignature` (parcels + business
  assignments + pads), seats shops on the LEVELED surface (spec 134), drives update() in
  useFrame, disposes on rebuild/unmount (spec 119).

## Evidence

Live scene: 595 meshes, 21 parcels, 21 floating business labels, dusk glow verified by GPU
screenshot (the strip at 19:30). Node smoke: `tests/commercialDistrictLayer.test.ts` —
mass built, parcel groups named with business ids, night update, clean dispose.

Known follow-up: the coastal ground around the district renders shallow-blue in fresh
worlds (the dry-blend recolor path) — pre-existing, now visible because buildings stand
there; track separately.
