# Spec 081 — Ad boards

- status: proposed
- proposed-by: irwin (operator directive) + claude (architect, commerce + bot-computers design workflow)
- date: 2026-06-10
- depends-on: 079 (shops, listings, storefront sites); uses the kooker image-generation path
- siblings: 080 (bot workstations)

## Why

Commerce should be SEEN. The 079 shops give the city an economy; ad boards give it a face — real
billboards at the commercial zone edges advertising the city's actual shops, with GENERATED poster
images produced through the kooker image-generation path, and a touch-screen mode: click a board
and the advertised shop's storefront opens. The boards tie three layers together without letting
them contaminate each other: the deterministic 3D city (placement and geometry), the runtime ad
pipeline (async image fetches — runtime data, never sim state), and the storefront sites of 079.
For a bot-owned shop this is the full arc: a bot designs a shop, stocks a listing, and the city
itself starts showing its ads to passers-by.

## Mechanic

1. Placement. Board sites are surveyed at the commercial zone edge (the cellZone boundary band near
   the high street), facing the street — a pure deterministic function of terrain + seed, exactly
   like every other surveyed structure.
2. Each board is a framed plane mesh (post + frame + screen). Every board shows an AD for one shop,
   assigned by a deterministic rotation over the built shops that have listings.
3. The screen texture starts as a deterministic canvas-drawn poster (shop name, top item, price,
   zone colours) — instant, offline-safe, token-free, and itself free of wall-clock and randomness.
4. adClient asks the kooker image-generation path (best-effort, via the /kooker proxy as the
   signed-in player) for a generated poster from the screened listing text. When an image arrives
   the renderer swaps the screen texture (CanvasTexture / texture map + needsUpdate). Results are
   cached by prompt hash so reloads repaint from cache without spending tokens.
5. Refresh is deterministic by construction: the ad ROTATION INDEX lives in colony state and
   advances on shop EVENTS (a new listing, every Nth sale) — never on wall-clock. No Date.now, no
   Math.random anywhere in the placement, compile, or mesh-build paths. The async arrival of an
   image is runtime data, like any network response, and never feeds back into sim state.
6. Touch-screen mode. Pointer raycast against board meshes: hover highlights the screen, click
   opens the advertised shop's storefront page (the openBuilder popup pattern — same-origin
   shop.html?plot=..., never an intranet or cluster URL).

## Rules and data

- Board sites: config adBoardCount default 3, minimum spacing adBoardSpacing 6 cells, dry land
  only, oriented to face the nearest street cell. Survey is collision-checked against parcels,
  roads and water.
- Ad assignment: shops ordered by parcelId; the board at index b shows shop (rotationCounter + b)
  mod shopCount. rotationCounter is part of saved colony state, incremented by listing changes and
  every adRotateSalesN sales (default 3), restored on reload — so two clients with the same state
  show the same ads.
- No shops yet: boards show a deterministic colony PSA card (welcome poster) so the zone edge never
  renders blank.
- Prompt construction: built ONLY from isPublicSafe-screened listing fields (shop name, item
  labels) plus a fixed style vocabulary. No player free text, no identities, no internal names.
  Prompts and cached images (data URLs) stay client-side in localStorage, size-capped
  (adCacheMaxEntries 12, oldest evicted).
- Budget: image generation is metered to the player through the kooker choke point. Hard cap
  adImagesPerSession default 6; past the cap (or signed out, or endpoint missing) the canvas poster
  carries the board — best-effort, never-block, the spawnCitizenSubUser pattern.
- Determinism contract: src/colony/commerce/billboards.ts and adCanvas.ts join the 077 forbidden
  list — no Date.now, no Math.random, no wall-clock; a vitest guard pins it. The renderer applies
  arriving textures as side-effects only.

## Cost — materials plus inference

- Build: each board costs matAdBoard 6 materials and briefly reserves one labour hand (the Caesar
  III rule). Boards are colony infrastructure, raised by the colony when the first shop is built.
- Run: a generated poster spends real image-generation budget metered to the requesting player; the
  canvas fallback is free. Token-thrift applies — the fewest-token ad that reads well is the
  virtuous one, and the cache makes every generation a one-time spend per listing version.

## Acceptance

On :5188: boards stand at the commercial zone edge facing the street, each instantly showing a
readable canvas poster for a real shop (or the PSA card when no shops exist). With the image
endpoint live and a signed-in player, boards repaint with generated posters, and a reload reuses
the cache with zero new requests (network tab proves it). Clicking a board opens that exact shop's
storefront page; hovering highlights the screen. Changing a listing or completing sales visibly
advances the rotation. Determinism tests stay green: placement, rotation and the canvas poster are
identical across reloads with the same state, and the sim digest is unchanged by anything ads do.
Offline, everything still works on canvas posters and the game never blocks.

## Architecture

- src/colony/commerce/billboards.ts — pure placement survey + board geometry spec; node-tested for
  determinism, spacing, dry land, street facing.
- src/colony/commerce/adCanvas.ts — the deterministic poster painter (canvas 2D from a
  ParsedListing + zone palette); pure given its inputs, no clock, no random.
- src/colony/commerce/adClient.ts — best-effort generated-image fetches via the /kooker proxy as
  the player (authClient JWT), prompt-hash cache in localStorage, session cap, never throws into
  the render loop.
- Renderer wiring — PlanetRenderer builds board meshes at survey sites, applies the canvas texture
  immediately, swaps in generated textures when adClient resolves, and registers board meshes with
  the pointer raycaster for hover + click (click calls runtime.openStorefront(parcelId)).
- Image source (OPERATOR STEER 2026-06-10): kooker-service-ai ALREADY exposes two generic
  image-generation APIs and the boards consume those — no new endpoint is required. Primary: the
  choke-point route POST /api/v1/ai/inference/generate/image (Codex gpt-image-2; JWT/PAT gated,
  rate-limited and metered per owner; proven end to end). Secondary: the Gemini route
  (/gemini/generate/image, Imagen) — adClient takes a provider field per board so different shops
  can advertise through different image houses (thematically: competing ad agencies). A future
  ComfyUI IMAGE_WORKER can join as a third provider through the same choke point, but it is a
  bonus, not a dependency.
- Honest scope split. Everything ships in the citylife repo and works TODAY: canvas posters are
  the instant deterministic layer, and generated posters arrive whenever the gateway route to the
  existing image APIs answers for the player JWT. The only possible kooker-side item is exposing
  those routes through APISIX for browser calls if they are not already reachable via the /kooker
  proxy — a routing check, not a new service (verify before building P3; if reachable, P3 is a
  no-op).

## Phased build plan

- P0 — Survey + canvas ads: billboards.ts + adCanvas.ts + renderer meshes; instant deterministic
  posters on :5188.
- P1 — Touch screen: raycast hover + click opens the storefront; data attributes for bot driving.
- P2 — adClient: best-effort generated images via the EXISTING kooker image APIs (gpt-image-2
  choke-point route primary, Gemini/Imagen secondary, provider per board), prompt-hash cache,
  session cap, 404-tolerant.
- P3 — routing check (small): confirm the two existing image routes are reachable through the
  /kooker proxy with the player JWT; only if not, a kooker-side APISIX route PR exposes them.
- P4 — Polish: night emissive glow on screens, rotation events surfaced in the radio ticker.

Each citylife slice ships on mechanics/dev, passes typecheck plus vitest, and is visible on :5188.
