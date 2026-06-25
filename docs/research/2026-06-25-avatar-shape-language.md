# Avatar shape language — making citizens readable in the world

Date: 2026-06-25
Status: research proposal / discussion space
Owner lane: Player & UI, with World & Build and Car/Garage review before implementation

## Why this exists

The Phase-1 S3 night-rally verification proved the data path works: `uiState.rally.presentCitizens`
contains Cole, the who-is-here panel names him, and the nameplate path can draw his public-safe name.
But the demo screenshot exposed the next visual problem: **the thing standing in front of Joe is hard
to read as Cole the Racer from shape alone**. At night, close to the emissive rally floor, a blocky
humanoid/vehicle-like form becomes a purple mass unless the UI label explains it.

This research page is the repo-owned discussion space for avatar form, silhouette, and in-world
readability. It deliberately does not ship a new avatar implementation yet. It records the proposal so
future PRs can discuss the same target instead of scattering avatar opinions across chat.

## Current evidence from the repo

- `AvatarView` already carries the minimum identity needed by the renderer: `id`, `displayName`,
  `x`, `y`, `heading`, `lookPitch`, `kind`, and `isOperator`.
- `kind` is currently only `"human" | "crab"`, so Joe can be routed to the canonical crab mesh while
  humans share the capsule/head route.
- `PlanetRenderer.setRallyPresentCitizens()` is already public-safe and read-only: it filters ids and
  display names with `isPublicSafe` before nameplate creation.
- Spec 078 gives one strong precedent: Joe is readable because his mesh has a locked silhouette and
  palette, not because the UI says he is Joe.
- The old `src/render/CityRenderer.ts` path still shows the legacy baseline: citizens as simple boxes.
  That baseline is cheap and deterministic, but it does not carry enough character identity for a
  first-person open-world car-game camera.

## Design target

Avatars should read in three layers, from farthest to nearest:

1. **Silhouette first** — at a distance or in low light, a player should know whether they are looking
   at Joe, Cole, a generic human, a racer, a vendor, or a service worker from the outline alone.
2. **Palette second** — each avatar class gets a stable colour family that holds under the day/night
   lighting model and does not fight the neon district/rally palette.
3. **Nameplate last** — labels confirm identity, but they should not be the only way to understand
   what is in front of the player.

For Phase-1/Phase-2, the goal is not a character creator. The goal is a small, deterministic avatar
language that makes the people in the world legible while staying cheap enough for the 4 GB GPU budget.

## Proposal: avatar silhouette cards

Create a small design registry called an **avatar silhouette card**. Each card is public-safe,
deterministic, and references primitive geometry first; GLB assets can replace card geometry later.

A card answers:

- `kind`: the high-level renderer route, e.g. `human`, `crab`, `racer`, `vendor`, `worker`.
- `bodyProfile`: height, shoulder width, stance width, and eye height.
- `signatureShape`: one or two shapes that make the avatar readable, e.g. crab claws, racer helmet,
  vendor apron, worker hard-hat, mechanic headset.
- `palette`: stable base/accent colours that still read at night.
- `firstPersonProfile`: eye height and near-camera occlusion rules so the player does not clip into a
  body blob when standing close.
- `publicLabelPolicy`: every rendered name/display string must pass `isPublicSafe`; no internal bot
  handles, profile names, private hosts, or real PII.

The card should live as data first, not as scattered renderer conditionals. The renderer consumes a
card and draws either procedural primitives or a loaded authored shell.

## Initial cards to discuss

### Joe the Crab

Already defined by spec 078. Keep it canonical: orange crab body and legs, blue/white headset, one
yellow lightning-bolt earcup accent. Joe is the proof that a strong silhouette works.

### Cole the Racer

Cole needs the first non-Joe readable upgrade because he is the night-rally friend the player meets.
Suggested card:

- Body: short, athletic racer stance rather than a vertical capsule.
- Head: oversized low-poly racing helmet or cap shape that reads from first person.
- Accent: one bright jacket stripe or helmet stripe, warm enough to survive the blue/purple night.
- Rally context: optional small floor contact glow or shadow blob so he separates from the emissive
  floor, but keep the nameplate as confirmation, not the primary read.
- Avoid: making Cole look like a car, prop, or blocky building fragment when viewed close-up.

### Generic human citizen

A cheap default that is still better than a box:

- Capsule/torso with head, shoulders, and feet markers.
- Per-person deterministic tint from id seed.
- No large accessories unless the role card says so.

### Role cards for later phases

- Vendor: apron/front panel + small shoulder silhouette.
- Mechanic/garage worker: cap/headset + tool-belt stripe.
- Racer crowd member: helmet/cap + jacket stripe.
- Service worker: hard-hat/vest silhouette.

These should stay as roles, not permanent personality labels, until the simulation owns jobs/roles
more deeply.

## Implementation shape, proposed only

A future implementation PR should be sliced like this:

1. **Data model only**
   - Add a pure `avatarSilhouettes.ts` registry under the Player & UI/render boundary.
   - Thread only the smallest new field needed through `AvatarView`, likely `avatarRole?: string` or a
     widened `kind` union.
   - Tests prove stable card selection from public ids and role hints.

2. **Cole card proof**
   - Add a deterministic procedural Cole racer mesh or a renderer group built from primitives.
   - Keep it behind the existing avatar source and rally presence path.
   - Tests assert the Cole card is selected for `citizen_rally_friend` and that unsafe labels are not
     rendered.

3. **First-person readability check**
   - Live-probe Joe standing near Cole at night.
   - Capture before/after screenshots from Joe's eye height.
   - Acceptance is visual: the object in front must read as a person/racer before reading the UI text.

4. **Optional authored asset bridge**
   - If primitives are not enough, map silhouette cards to Blender/glTF shells per spec 100.
   - Keep geometry authored in Blender and placement/selection deterministic in code.

## Acceptance criteria for the eventual build

- Night rally close-up: Cole reads as a racer/person without relying solely on the label.
- The who-is-here panel, friend-present banner, and nameplate still use `presentCitizens` read-only.
- All shown strings pass `isPublicSafe`.
- No `Math.random` or `Date.now` in avatar selection or geometry setup.
- Typecheck and focused vitest pass.
- A PR includes screenshot evidence at night, not only a daytime render.

## Open questions for PR discussion

1. Should `AvatarView.kind` become a wider union, or should `kind` stay physical-species only while a
   new `role`/`silhouette` field carries racer/vendor/worker identity?
2. Is Cole a procedural primitive card first, or should he be the first tiny authored GLB character
   once the Blender pipeline is ready?
3. How much individuality belongs in Phase-1? A readable Cole card may be enough; full citizen
   wardrobe/customisation should probably wait until the city has more roles and free-roam driving.
4. What is the near-camera rule when Joe stands too close to another avatar? Fade body, push camera, or
   rely on collision spacing?
5. Do avatar cards belong in Player & UI only, or should World & Build own role silhouettes once jobs
   and district crowds arrive?

## Recommendation

Use this PR as the discussion room. If accepted, the next bounded Player & UI slice should be **Cole
racer silhouette proof at the night rally**, not a full avatar system. That slice keeps the game moving
toward the open-world car-game target while respecting the current phase gates and lane boundaries.
