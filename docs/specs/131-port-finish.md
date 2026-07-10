# Spec 131 — the port finish: porters, parked car, nameplates, cameras, snapshot, toggles

The remaining legacy `PlanetRenderer` features with LIVE product surface, ported in one
slice — plus the honest list of what was retired. This completes the Phase 3/4 renderer
port (spec 114 lineage): every legacy method is now either ported or documented obsolete.

## Ported (had live callers or visible product surface)

- **Porters (legacy spec 073)** — `R3FPorters` + pure `porterLayer.ts`: crates of materials
  (brown, left) and sacks of food (tan, right) pile at each Porter Shed, quantised to live
  stock (grow AND shrink; re-laid only when the quantised signature changes); porter
  handcarts wander the roads while sheds are staffed (`porterStatus`), cap 28, road-cell
  wander targets only. Render-side ambience — sim state untouched.
- **Parked operator car** — `setOperatorCar` attaches `sim.state.operatorCar` (raceState
  precedent); `R3FOperatorCar` builds the shared `buildCarMesh`, seats it on the ribbon
  surface when parked on a road cell, else on the ground; spec-119 disposal on swap.
- **Rally nameplates (legacy S3/spec 097)** — `setRallyPresentCitizens` (called live from
  ColonyApp, previously a silent no-op via optional chaining) attaches public-safe-filtered
  presence; `R3FRallyNameplates` draws the legacy-verbatim glowing name card + gold floor
  circle over each present citizen, positions tracked per frame from the live avatar
  source, brighter after dark, never labelling the first-person citizen.
- **Race chase camera (legacy updateRaceCamera)** + **cinematic orbit (legacy
  updateCinematic)** — `R3FCameraDirector`: the aerial camera glides behind the race car
  while a rally race runs (aerial modes only; first-person keeps its own eyes), and the
  login-screen backdrop (`setCinematic` → `sim.state.cinematic`) orbits the landing with
  the ~40s wide establishing-shot envelope.
- **capturePNG** — the HUD snapshot button returned null; SceneProbe now bridges the live
  renderer/scene/camera to the class, which renders one clean frame (no postprocessing)
  and reads out a PNG data URL.
- **Zones toggle** — `setZonesVisible`/`setZoningVisible` set `sim.state.zonesVisible`;
  ZoneManager gates the unbuilt-lot overlays behind a named group (`zone-overlays`).
- **Ask Kooker entry point** — the board link (PR #240) was a hardcoded fixed pill in
  `index.html` at the viewport's top-right, `z-index` 9999, which sat ON TOP of the
  topbar's Log out button and blocked it. It is now a `.linkbtn` anchor inside the
  topbar's trailing group beside Log out (`ColonyApp.tsx`), styled like a `.group`
  button; the login screen keeps its own `login-link` to the board, so the pre-login
  path is unchanged.

## Retired as obsolete in v3 (no callers, or replaced by v3 systems)

- `setBarState` — no callers anywhere; the bar scene never landed as product.
- `setView`/`setViewMode` (biome/buildable/elevation) — no UI surface in v3.
- `setCameraPreset` (street/district/planet) — replaced by World View + first-person and
  MapControls.
- `setAvatarView` — replaced by the live `setAvatarSource` closure (spec 120).
- `setNeighborhood`/`setCommercialDistrict`/`setBusRoute`/`setRaceState` — replaced by the
  runtime's direct `sim.state` attaches (specs 116/121/124/127 lineage).
- `firstPersonPNG` (the governor's citizen-vision snapshot) — the bot loop consuming it is
  not wired in v3; revisit with the bot lane if the governor returns.

## Tests

- `tests/porterLayer.test.ts` (5): pile quantisation (floor/cap/negative), legacy-verbatim
  pile layout (offsets, colors, rows, ground seat), the 320 budget, road-only wander
  targets, cart movement + retarget.
- `e2e/portFinish.spec.ts`: porter + nameplate layers mount in the scene; piles render
  whenever the world has sheds + stock; `runtime.snapshot()` returns a real PNG data URL.

## Auth gate restored (last port scaffolding reverted)

The very first R3F setup commit on this lineage (`4374ada`, 2026-06-29) slipped an
unconditional `return <>{children}</>;` into the top of `AuthGate`. It was never
documented or guarded, and it disabled the ENTIRE gate — operator login, visitor signup,
and the DEV+localhost+`VITE_LOCAL_TEST` belt-and-suspenders bypass — in every build,
including a production `vite build` for the cluster. Lane history traces it to a
temporary route-patch made to film the PRODUCTION site in TV/cinematic mode
(`?skipauth=1&tv=1&…` on citylife.kooker.co.za): the dev-only skipauth guard correctly
refuses to fire on the cluster domain, so the gate was hard-bypassed instead of building
a sanctioned capture path. A deliberate temporary hack, never meant to land — and the
sanctioned local-test bypass (`?skipauth=1` / `VITE_LOCAL_TEST`, dev builds on local
hosts only) already covers local development. If cinematic capture on the deployed site
is needed again, that must be its own reviewed mechanism (e.g. a read-only spectator
token), not an auth bypass.

Outcome: the early return is removed and `AuthGate.tsx` is byte-identical to `main`'s
again (login gate + guarded dev bypass stand). The e2e suites, which had been mounting the
colony through the hole, now navigate to `/?skipauth=1` explicitly — the sanctioned
dev-only path. Verified: unauthenticated `/` renders the LoginScreen (colony
does not mount), `.env.local` dev auto-login still signs in, `?skipauth=1` mounts the
colony in dev, and a production build ignores `?skipauth=1` and still demands login.
