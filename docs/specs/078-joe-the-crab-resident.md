# Spec 078 — Joe the Crab, Founding Resident of Landing One

- status: proposed
- proposed-by: irwin (operator directive) + claude (architect, from the spec-078 design workflow)
- date: 2026-06-10
- depends-on: 074 (citizen avatars), 076 (homesteads + first-person), 077 (bot house builder / blueprint compile + persist)

## Why

Joe — the standalone Hermes narrator who posts a daily story of the colony — should stop being a
disembodied voice and become a **citizen who actually lives in Landing One**. He gets a permanent
reserved homestead on the shore by the lighthouse he narrates from, an authored 077 brick house (he
"reads" the 077 builder rather than spawning a generic cottage), and a **distinct crab avatar** that
roams the streets like any other citizen and can be stepped into in first-person, found by nameplate,
and watched across reloads.

This closes a loop the operator wants: because Joe's daily Hermes story already reads city progress
through `firstPersonView`, once he physically lives there his **own house can show up in his
paintings** — the narrator paints the place he lives.

The hard constraints: the crab must match Joe's canonical portrait **exactly** — an orange/red crab
with visible eyes, claws and legs, wearing a blue-white headset whose **only** accent is a single
yellow lightning bolt **on one earcup**. The whole feature is deterministic and seeded (no wall-clock,
no random in the build path), reuses the existing avatar-movement + 077 compile/persist paths, stays
tasteful low-poly, and ships in small slices on `mechanics/dev`, each passing typecheck + vitest + a
live `:5188` visual check. It is **not** a big map change — one reserved plot, one optional shore
structure, one new avatar kind.

## Mechanic

1. On colony boot, Joe is seeded **deterministically and idempotently** as a permanent citizen
   (`citizen_joe`) — he exists even with empty localStorage, and re-seeding on hot reload is a no-op.
2. A **reserved founder parcel** is sited on the shore (nearest dry ground to the ocean along the
   existing spine), marked `reservedFor: 'citizen_joe'` so no random newcomer can ever take it.
3. The parcel is pre-built from a **fixed authored 077 blueprint** (a hand-written, validated DSL
   string — Joe "reads" the 077 builder), compiled and persisted through the existing 077 path.
4. Joe's default/fallback avatar renders as a **crab** (a new `kind: 'crab'`), distinct from the humanoid capsule:
   orange/red shell, eyes on stalks, two claws, legs, and the blue-white headset with one yellow
   lightning earcup accent — built procedurally from primitives, merged into one geometry.
5. v3 named-citizen avatars can opt into an animated GLB with `avatarKind: 'human' | 'crab' | 'spider'`
   plus `glbUrl`. Joe currently points at `/assets/citylife/avatars/joe-crab.glb`. When present, the
   renderer removes that named citizen from the instanced human/crab crowd meshes and loads the GLB as
   an individual `THREE.Group` with an `AnimationMixer`; unnamed citizens stay instanced.
6. Joe **roams** using the existing avatar loop (`stepAvatars` + `wanderIdleCitizens`) with an
   optional sideways "scuttle" gait offset; he can be **stepped into** in first-person at a crab eye
   height; his nameplate makes him findable.
7. Joe **persists** across reloads: the founder citizen + reserved parcel re-derive identically from
   the seed every boot, and the `kind` / `avatarKind` / `glbUrl` survive because they are re-applied at seed time.
8. (Bonus loop) Because Joe now has `homeXY` on a real built parcel, his daily-story `firstPersonView`
   includes his own house among `nearestBuildings`, so it can appear in his paintings.

## Rules and data

- **Determinism**: every new value derives from a fixed seed (`JOE_SEED`, a high out-of-range
  constant so it never collides with settler ids) or from the pure terrain functions. The fixed
  blueprint is a literal string. No `Date.now()` except the `bornAtMs` stamp passed in from the
  caller (already the existing pattern — tests pass a fixed value). No `Math.random()` in any of the
  Joe build path.
- **Idempotence**: seeding checks for an existing `citizen_joe` / reserved parcel before adding, so
  hot reload and repeated `restoreColony` calls never duplicate Joe or double-post a ledger entry.
- **Reuse, do not fork**: the crab is a new _kind_ threaded through the _existing_ avatar pipeline
  (`Citizen` → `AvatarView` → `updateAvatars`), and the house is compiled through the _existing_ 077
  `compileBlueprint` / merged-mesh render path. Joe's roam + first-person inherit the kind-agnostic
  movement system untouched except for the eye-height and gait lookups.
- **Avatar kind**: legacy `Citizen.kind: 'human' | 'crab'` remains for first-person eye height and
  fallback instancing. v3 adds `avatarKind: 'human' | 'crab' | 'spider'` and optional `glbUrl`; a
  present GLB URL means the named citizen is drawn as an individual animated GLB, while citizens
  without GLBs remain in `avatarMesh` / `avatarHeadMesh` / `crabMesh` instancing.
- **Named animation**: the renderer chooses `<DisplayFirstToken>_idle` or `<DisplayFirstToken>_walk`
  from presentation-only movement deltas and advances a `THREE.AnimationMixer` on the render clock.
  No sim state, positions, needs, economy, or deterministic hashes are mutated by animation.
- **Founder parcel**: `Parcel.reservedFor?: string`. A reserved parcel is excluded from
  auto-assignment to newcomers and pre-owned by `citizen_joe`.
- **Crab eye height**: a low value (~0.35) so first-person reads as a crab at ground level, not a
  floating human head. Stored as a per-kind constant, not the hardcoded 1.6.

## The crab avatar — construction (procedural primitives, merged geometry)

Built once in `buildColonyLayer()` as a single merged `BufferGeometry` (same merge approach as the
existing building mesh at PlanetRenderer.ts:560-564), instanced so all of Joe's frames share it.
Vertex colours carry the palette so one material draws the whole crab. Local origin at the ground
plane, facing +x (heading rotation applied by `updateAvatars` exactly as for humans).

Palette (locked to the portrait):

- shell / claws / legs: orange-red `0xe2562f` (with a slightly darker `0xc23f1f` underside band)
- eye stalks: shell colour; eyeballs white `0xf5f5f0` with black pupils `0x101010`
- headset band + earcups: blue-white — band `0xdfe7f2`, earcups `0x2f6fd0`
- lightning accent: yellow `0xf4c020`, **only on the left earcup**

Primitives:

1. **Shell** — a flattened dome: `SphereGeometry(0.30, 12, 8)` scaled `(1.25, 0.62, 1.0)`, raised so
   it sits ~0.22 above ground. Underside rim a thin `CylinderGeometry` torus-substitute (a low scaled
   cylinder) in the darker band colour.
2. **Eyes** — two stalks: short `CylinderGeometry(0.025, 0.025, 0.14)` angled up-forward from the
   front of the shell, each capped with a small `SphereGeometry(0.05)` white eyeball + a tiny dark
   `SphereGeometry(0.02)` pupil. Mirrored left/right.
3. **Claws** — two: each an upper-arm `BoxGeometry(0.16, 0.07, 0.07)` reaching forward-out, ending in
   a `BoxGeometry(0.12, 0.10, 0.07)` pincer split into two prongs (two thin boxes with a gap).
   Mirrored.
4. **Legs** — three per side (six total): thin angled `CylinderGeometry(0.02, 0.02, 0.18)` splayed
   down-out from the shell underside, tips at ground level. Mirrored.
5. **Headset** — a band arching over the shell: a half-torus approximated by a thin scaled+bent
   `TorusGeometry(0.26, 0.025, 6, 12, Math.PI)` in band colour, plus two earcup `CylinderGeometry`
   discs (`0.07` radius, `0.04` thick) on the sides in earcup blue.
6. **Lightning accent** — a small flat yellow bolt on the **left** earcup only: a thin extruded /
   two-triangle zig-zag (a tiny custom `BufferGeometry` of ~4 triangles, or a scaled flattened
   `BoxGeometry` chevron) seated proud of the left earcup face. One accent, one earcup — matches the
   portrait exactly.

All parts merged with `mergeGeometries([...])` into one geometry with a vertex-colour attribute, fed
to one `THREE.InstancedMesh(crabGeo, crabMat, AV_CAP)` where `crabMat` is `MeshStandardMaterial({
vertexColors: true, flatShading: true })`. No separate head mesh for crabs (eyes are part of the
shell). The crab is sized to read at the same on-screen scale as the human capsule (~0.6 units tall
including stalks) so it sits naturally in the street crowd.

### Reusing the roam loop

The crab inherits the avatar movement system with **zero** changes to `stepAvatars`,
`wanderIdleCitizens`, `pickPedTarget`, or `setTarget` — they are position+speed only and kind-blind.
The only kind-aware touches:

- `updateAvatars()` routes Joe's frame into the crab `InstancedMesh` instead of the human capsule +
  head pair, and skips him when he is the first-person citizen (existing `a.id === fpCitizenId`
  guard).
- An **optional** scuttle gait: in `updateAvatars`, for `kind === 'crab'`, add a sideways rotation
  offset to the facing (face heading ± 90° so the crab walks sideways), or leave him facing travel —
  this is a creative choice (see Open choices). Determinism preserved either way (pure function of
  heading).
- First-person eye height + look use the crab constant (~0.35) instead of 1.6 in `frame()` and
  `firstPersonPNG()`.

## Persistence

- **Citizen**: the roster is in-memory only, but Joe is re-seeded every boot from a fixed seed in the
  runtime constructor (after `makeNeighborhood`), so he always reappears identically. The seed is
  idempotent (`byId('citizen_joe')` guard).
- **Reserved parcel**: `makeNeighborhood` is pure from terrain, so the founder parcel re-derives to
  the same cells every load. We do **not** add a new localStorage format — the determinism of
  `makeNeighborhood` + the fixed seed is the persistence.
- **Blueprint**: the fixed authored DSL string is assigned to `parcel.blueprint` at seed time and
  compiled through the existing 077 path — identical house every load.
- **Optional ledger**: if Joe is posted to the colony ledger (founder holdings), the post is guarded
  by an existing-account check (idempotent) per the 077 P2 map's restoreColony gotcha.

## Acceptance

After boot (with **empty** localStorage), Joe exists as `citizen_joe` on a reserved shore parcel near
the lighthouse, his fixed-blueprint brick house stands (compiled via the 077 merged-mesh path), and
his avatar renders as the **crab** described above — orange/red shell, eyes/claws/legs, blue-white
headset with exactly one yellow lightning earcup accent. He roams the streets via the existing loop,
shows a findable nameplate, and can be stepped into in first-person at crab eye height. Reloading the
page reproduces the identical Joe, parcel, and house. No newcomer is ever assigned Joe's reserved
parcel. Typecheck + vitest pass; a committed Playwright Chromium test boots the real Vite app, waits
for `/assets/citylife/avatars/joe-crab.glb`, asserts Joe is a visible `named-avatar:citizen_joe`
playing `Joe_idle`, and proves every non-GLB citizen still occupies the matching instanced human/crab
crowd mesh. The same browser test runs in CI via `npm run test:e2e`. As a bonus, `firstPersonView`
for `citizen_joe` lists his own house among nearby buildings (enabling the painting loop).

## Architecture / touch points (drawn from the system maps)

- **Avatar kind** — `Citizen.kind` (citizenRoster.ts:15-46), threaded through `register()` (79-108),
  `avatars()` export (172-174), `AvatarView` (PlanetRenderer.ts:28-37), and `setAvatarSource`
  (runtime.ts:589-592).
- **Crab mesh** — built in `buildColonyLayer()` (PlanetRenderer.ts:595-610) as a merged geometry;
  new fields `crabMesh` (and no head mesh); drawn in `updateAvatars()` (1479-1505) by kind.
- **Crab first-person** — eye height lookup in `frame()` (1157-1174) and `firstPersonPNG()`
  (1196-1214); `driveFirstPerson()` (runtime.ts:278-295) is unchanged (position only).
- **Founder parcel** — `Parcel.reservedFor` (neighborhood.ts:25-59); placed in `makeNeighborhood`
  (324-340) by sliding to the shore cell nearest the ocean via `slideToLand` + `tryParcel`; fixed
  blueprint via the authored string (not `defaultBlueprint`).
- **Block auto-assign** — newcomer flow in runtime.ts:170 changes
  `find((l) => !l.ownerCitizenId)` → `find((l) => !l.ownerCitizenId && !l.reservedFor)`.
- **Seed Joe** — runtime constructor (runtime.ts:104-119) after `makeNeighborhood`: register
  `citizen_joe` (kind `'crab'`), assign the reserved parcel, set `built` + the fixed blueprint.
- **Optional lighthouse** — a new `StructureKind 'lighthouse'` in sim.ts (13, 134-139) +
  `makeStructure` (PlanetRenderer.ts:459-503), sited on the shore so Joe's plot sits beside it.

## Phased build plan

- **P0 — Avatar kind plumbing (no visual change).** Add `kind` to `Citizen` + `AvatarView`, default
  `'human'`, thread through register/avatars/setAvatarSource. Vitest: a `kind:'crab'` citizen exports
  `kind:'crab'`; existing citizens default to `'human'`.
- **P1 — Crab mesh + kind-aware render + first-person.** Build the procedural merged crab geometry,
  route by kind in `updateAvatars`, crab eye height in first-person. Seed a throwaway crab in dev to
  eyeball it on `:5188`.
- **P2 — Founder parcel + permanent Joe + fixed 077 house.** `reservedFor`, shore siting in
  `makeNeighborhood`, block auto-assign, seed `citizen_joe` as a crab on the reserved parcel with the
  fixed blueprint, persist-by-determinism. Vitest: Joe + reserved parcel reproduce across two boots;
  no newcomer takes the reserved lot.
- **P3 — Polish + bonus loop (optional).** Optional lighthouse structure beside Joe's plot; optional
  scuttle gait; confirm `firstPersonView('citizen_joe')` lists his own house (painting loop). Nameplate
  styling check.

Each slice ships on `mechanics/dev`, passes typecheck + vitest, and is verified live on `:5188`.

## Open choices (operator picks)

- **Exact plot location**: nearest-to-ocean spine cell (automatic, "by the lighthouse") vs a
  hand-tuned hero cell with the best sea view.
- **House style**: cosy single-storey shore cottage vs a 2-storey "founder's house" (wallH in the
  fixed blueprint); whether to add a patio/deck facing the sea.
- **Scuttle gait**: face travel direction (simple, reads clearly) vs true sideways scuttle (charming,
  matches real crabs but the headset/eyes then face sideways).
- **Lighthouse**: ship the optional lighthouse structure now (P3) or treat it as pure narrative and
  defer.
- **Nameplate**: "Joe" vs "Joe the Crab" vs "Joe — Founder of Landing One".
