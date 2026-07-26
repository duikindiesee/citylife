# Spec 157 — Kooker Gamehouse venue and Commons_Arcade cabinet (ARCADE.1)

- **Status:** proposed for review, not yet wired into the live survey
- **Depends on:** spec 152 (authoritative spatial registry; building frame,
  room and door portals), the Gearbox showroom pattern
  (`src/colony/spatial/garageShowroomInterior.ts`) and the Kooker HQ reception
  (`src/colony/spatial/kookerHqInterior.ts`)
- **Relates to:** the 2026-07-26 operator decision
  (`ARCADE.0 score-and-asset acceptance`), spec 153 (`hq-commons-pack.glb`,
  which authors the reusable `Commons_Arcade` prop), spec 143 (commercial venue
  plots / massing)
- **Design provenance:** the accepted ARCADE.0 boundary — authenticated CityLife
  players enter a CityLife-owned commercial Gamehouse through the existing portal
  and spatial-frame patterns; a cabinet is the future launch point for a
  same-origin, JWT-backed game surface. This slice ships ONLY the venue shell
  (business identity, interior frame, cabinet placement, auth gate). The game
  overlay, score service, PAT/KCO, deployment and public iframe are explicitly
  out of scope and retain their own tasks.

## 1. Why

CityLife needs a player-facing, CityLife-owned arcade venue so a later slice can
attach a same-origin game surface whose score is derived only from a validated
CityLife JWT. The public `alice.kooker.co.za` demo stays a separate public site
and is never embedded with CityLife credentials.

## 2. Mechanic

- **Business identity.** A new commercial storefront `kooker_gamehouse` joins
  the commerce roster (`src/colony/commerce/businesses.ts`) with the public-safe
  sign **"The Gamehouse"** (the sign never shows a kooker/token/secret
  brand-word) and a matching massing flavour
  (`src/colony/render/commercialShopMassing.ts`).
- **Interior frame.** `src/colony/spatial/gamehouseInterior.ts` authors, at the
  canonical `WorldLayoutDocument` layer, one exterior building frame anchored on
  a surveyed surface entrance cell, one nested **8 m × 8 m** arcade-floor room
  frame, and a deterministic enter/exit door portal pair that are **exact
  inverses**. Entering is a streaming boundary, never a coordinate or identity
  reset. The floor-local door point maps exactly back onto the surface entrance
  point for any facing, so the entrance/exit landing is a safe, in-bounds cell
  edge at the room's near wall.
- **Cabinet placement.** `src/colony/spatial/gamehouseCabinet.ts` places the
  reusable, public-safe `Commons_Arcade` cabinet
  (`0.7 m × 1.8 m × 0.8 m`, floor-centre pivot) on a single 1 m interior cell at
  the back-centre of the floor, clear of the door landing and the back wall, with
  an approach point one cell in front. No cabinet mesh ships in this slice, so the
  accepted **procedural box** is the visual fallback
  (`resolveCommonsArcadeCabinetVisual`).
- **Auth gate.** `resolveCabinetInteraction(session)` requires an authenticated
  CityLife player — a non-empty `userId` decoded from a validated CityLife JWT
  (structurally the authenticated `OperatorSession["operator"]`). Authenticated
  players get the clear prompt **"Press E — Play the arcade cabinet"**;
  unauthenticated visitors get **"Sign in to play the arcade cabinet"** and are
  not allowed to play. The gate authorizes nothing itself and stores no score.

## 3. Rules & data (binding)

- The interior fragment is pure and deterministic: the same surface frame +
  options yield byte-identical frames, portals and the cabinet placement.
- `withGamehouseInterior` carries every existing frame, portal and placement
  through untouched and in order, and throws `ALREADY_PRESENT` rather than ever
  duplicating one — no original island id or coordinate changes.
- The cabinet placement satisfies the `WorldLayoutDocument` contract: tight
  bounds over its single in-bounds cell, an anchor that belongs to those cells,
  and a `interior` layer on the arcade-floor frame.
- Identity is derived ONLY from the JWT `userId`. A null session or null userId
  is an unauthenticated visitor.

## 4. Cost

Small, additive world-authoring + one storefront identity. No runtime survey
wiring, renderer scene, network call or Task API change ships with this slice.

## 5. Acceptance

- `tests/gamehouseInterior.test.ts` — 8×8 frame graph, exact-inverse portals,
  determinism, serialize/parse replay, existing records preserved, out-of-bounds
  - duplicate rejection.
- `tests/gamehouseCabinet.test.ts` — cabinet dimensions, in-bounds tight-bounds
  placement, public-safe ids, procedural fallback, and the auth gate
  (authenticated → play prompt; unauthenticated → sign-in prompt).
- `tests/commerceBusinesses.test.ts` — the Gamehouse is registered, public-safe,
  seating-free and reachable by the assignment roster.
- `npm run typecheck` and `npm run build` stay green.

## 6. Not in this slice (retain their own tasks)

The same-origin game surface + score integration (`ARCADE.2`), the
authenticated/versioned/idempotent score authority (`ARCADE.SCORE.1`), content
authority (`ARCADE.AUTH.1`/`ARCADE.CONTENT.1`), Alice's short-lived content
credential (`ARCADE.PAT.2`), any KCO reward, public score route, deployment,
merge and production UAT (`ARCADE.UAT.1`). Runtime survey wiring that seats the
Gamehouse on the live island is a follow-on, exactly as the Gearbox showroom
fragment remains authored-and-tested ahead of its own wiring slice.
