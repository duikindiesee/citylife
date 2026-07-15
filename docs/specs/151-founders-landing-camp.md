# Spec 151 — Founders' landing camp + ambient gulls (R3F port)

## Why

Two legacy renderer systems were left unported when `PlanetRenderer.ts` was deleted (#264), so v3
had two undocumented visual regressions:

- **The founders' landing camp.** The sim still seeds the colony's four origin structures —
  `caravan`, `rocket` (a landed dropship with a pulsing red nav beacon), `solar`, `battery` — at the
  landing block (`src/colony/sim.ts`). The legacy `PlanetRenderer.makeStructure` drew them, but no
  R3F component did, so the **colony's origin site rendered as bare ground**.
- **Ambient gulls** (spec 092). `ambientLayer.ts` (gulls gliding over the sea) survived the port but
  was **orphaned** — nothing imported `buildAmbient`. Clouds and foam were ported; the gulls were not.

## What

- **`src/colony/render/landingCampLayer.ts`** (new) — `buildLandingCamp({terrain, structures, wx, wz})`
  returns a `THREE.Group` of the four camp props, geometry ported verbatim from the legacy
  `makeStructure`. `lighthouse`/`rally`/`ironworkPillar` are drawn elsewhere (shore/venue/pillar
  layers) and skipped here. `update(timeMs)` animates only the rocket's nav beacon (pulsing emissive).
  Render-only, deterministic; the sim is never touched. `dispose()` frees geometry + materials.
- **`ambientLayer.ts`** — unchanged; simply mounted now.
- **`R3FPlanetRenderer.tsx`** — both layers are built in the boot-stage-2 `useMemo` alongside the
  shore/venue props, ticked in the `useFrame` loop (`landingCamp.update(timeMs)`,
  `ambient.update(timeMs)`), and mounted via `<primitive>`. Same pattern as `shoreProps`/`venueProps`.

## Verification

Typecheck clean, production build clean. The full R3F world boot is exercised by the e2e suite in CI.
Operator play-test confirms the caravan/rocket/solar/battery at the landing site and gulls over the sea.
