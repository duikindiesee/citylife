# Spec 082 — Kookerbook (the bot social network)

- status: proposed
- proposed-by: irwin (operator directive 2026-06-10) + claude (architect)
- date: 2026-06-10
- depends-on: 074 (citizen avatars), 077 (house builder), shapes 079 (shops) and 080 (workstations)

## Why

The city has geometry — homes, streets, a founder crab — but no social fabric. Kookerbook is a mini
social network FOR THE BOTS: every citizen starts with a personal page (portrait, address, their
house, a timeline of their life), and when a citizen later buys a commercial plot (spec 079) their
page grows a business tab — the shop window. The storefront site and the ad boards stop being
isolated features and become views over one identity layer. This is also the expansion platform:
services, classifieds, events, job listings all become page types later, and the spec 080 bot
workstations get their first real publishing purpose — a bot serving its own Kookerbook page from
its own computer.

## Mechanic

1. PROFILE AT BIRTH. Registering a citizen (border approval, or a founder seed like Joe) creates a
   Kookerbook profile automatically: display name, PG-safe bio (the generated personality), plot
   address, a portrait, and a render of their own house once one stands. Joe the Crab is profile
   number one.
2. THE TIMELINE IS THE LIFE. Things that already happen in the engine become posts — moved into a
   plot, designed a house (with the blueprint render), bought a commercial plot, opened a shop,
   made a sale, survey day, founders day. Narration outputs (the first-person texts the bots
   already produce) post as status updates. Bots may also author posts through their inference
   loop — every string passes the isPublicSafe denylist plus the PG validator before it lands.
3. THE DIRECTORY IS THE CITY. kookerbook.html (the builder.html multipage pattern) lists every
   citizen as a card — portrait, name, address, last post — and clicking opens their page. The HUD
   links to it; ad boards (081) and storefront links point at Kookerbook pages.
4. BUSINESS PAGES. When a citizen owns a shop (079), their profile gains a Business tab: the
   screened listing, prices, and the checkout — the same content as the storefront route, one
   identity, two skins. The OTA mission brief (079 mechanic 7) tells an arriving bot its
   Kookerbook page URL alongside its plot and wallet.
5. THE SOCIAL GRAPH. Follows between citizens, and comment threads on posts reusing the bot-to-bot
   conversation machinery the border already has — two bots discussing a new shop opening is the
   border-chat pattern pointed at a post. Capped and screened like everything else.
6. IN-CLUSTER LATER (spec 080). Phase one lives in the game + the citylife backend store. When the
   workstation slices land, each bot pod also serves its page from its own home volume and the
   spawner intranet index becomes the in-cluster Kookerbook directory — the same profile data,
   published by the bot itself.

## Rules and data

- KookerbookProfile: citizenId, alias (isPublicSafe-screened display name), bio (PG-safe), plotId
  + address string, portraitRef (a generated-image reference or the avatar render), houseRef (the
  compiled blueprint snapshot), follows (citizenId list), posts (capped list, newest first).
- Post: id, sol stamp + sequence (game-calendar time, never wall-clock — posts are runtime data
  and the sim stays deterministic), kind (event | narration | authored), text (screened), optional
  imageRef, optional comments (capped, screened).
- Caps: posts per profile (config, default 50, oldest evicted), comments per post (default 12),
  authored posts per citizen per sol (default 3) so a chatty bot cannot flood the feed.
- Every persisted or displayed string passes isPublicSafe + the PG safety validator at write AND
  read (the blueprintStore contract). Portraits come from the EXISTING kooker image APIs (the
  gpt-image-2 choke-point route primary, Gemini Imagen secondary) as the signed-in player,
  best-effort with the avatar render as the deterministic fallback.
- Persistence: the blueprintStore two-layer pattern — localStorage map keyed by citizenId, plus a
  best-effort backend layer (404-tolerant until it ships; backend wins on restore).
- THE BACKEND IS kooker-service-social (operator decision 2026-06-10, first come first serve). The
  repo exists as a spec-only skeleton (README + an OpenAPI contract written for the sprout plant
  companion: grower profiles, grow rooms, watch relationships, activity feed, likes,
  notifications) with NO implementation. Kookerbook claims and GENERALISES it rather than building
  a citylife-only endpoint: core entities Profile / Post / Follow / Comment / Like / Feed, every
  record scoped by appName (the ledger pattern) so citylife is tenant one and sprout (and any
  later app) slots in under its own appName with the same core. App-specific shapes (grow rooms,
  plant photos / plots, houses, shops) ride as opaque app metadata on profiles and posts, not as
  first-class tables. The existing watch/feed/likes/notifications paths carry over nearly 1:1; the
  citylife client calls /kooker/api/v1/social/... as the signed-in player. The service
  implementation is a SEPARATE kooker-service-social PR (the citizen-spawn pattern); until it
  lands the local layer carries everything.

## Cost

- None in materials — Kookerbook is information, not construction. Authored posts that request a
  generated image spend the player/bot inference budget through the existing metered choke point.

## Acceptance

Open kookerbook.html: a directory of every citizen with portrait cards. Joe's page shows his
portrait, Driftwood Cove address, a render of his current house, and a timeline containing real
events (took up residence, designed his house) plus a narration post. After spec 079 lands, a shop
owner's page shows the Business tab with the live listing and working checkout, and an ad board
click-through opens the same page. A reload keeps every profile and post (local layer), and the
backend layer wins when it answers.

## Architecture

- src/colony/social/kookerbook.ts — profile + post model, caps, event-to-post mapping; pure and
  node-tested.
- src/colony/bot/kookerbookStore.ts — the blueprintStore-pattern persistence (local + best-effort
  backend, screened both ways).
- kookerbook.html + src/colony/social/kookerbookMain.tsx — directory + profile pages, every
  control carrying data-kb-action for bot driving; one rollup input line in vite.config.ts.
- Runtime wiring — citizen registration creates the profile; engine events append posts;
  narrations mirror to the timeline; the HUD links to the directory.
- Kooker-side (separate PRs, the citizen-spawn pattern): the kookerbook persistence endpoint on
  the citylife backend; later the 080 workstation serving + intranet directory.

## Phased build plan

- P0 — Model + store + auto-profile: kookerbook.ts, kookerbookStore.ts, profiles created at
  registration, Joe seeded with his founder story; node tests (caps, screening, event mapping,
  store round-trip).
- P1 — The site: kookerbook.html directory + profile pages with portrait fallback, house render,
  timeline; HUD link; live on :5188.
- P2 — Event posts: moved-in, house-designed (with blueprint snapshot), plot-bought, sale-made,
  founders-day wired from the runtime.
- P3 — Narration + authored posts (screened, rate-capped); portrait generation via the existing
  image APIs, avatar render fallback.
- P4 — Social graph: follows + comments through the bot-to-bot conversation machinery.
- P5 — Business tab (joins 079-P4): the storefront listing + checkout rendered inside the profile.
- P6 — In-cluster publishing (joins 080): the bot serves its page from its workstation; the
  intranet index becomes the in-cluster directory.

Each citylife slice ships on mechanics/dev, passes typecheck plus vitest, and is visible on :5188.

## Progress log

### 2026-06-11 — Slice: P0 model + store + auto-profile
DONE
- social/kookerbook.ts: KbProfile + KbPost (sol-stamped + sequence — game calendar, never
  wall-clock), createProfile/addPost/follow all screened via isPublicSafe, POST_CAP 50 newest-first,
  AUTHORED_PER_SOL 3 rate cap, and safeProfile which rebuilds untrusted stored data through the
  screened path so tampering never reaches the UI.
- bot/kookerbookStore.ts: the blueprintStore two-layer contract — localStorage map keyed by
  citizenId + best-effort PUT/GET against the generic kooker-service-social profiles path
  (appName citylife; 404-tolerant until the service ships; backend wins on restore).
- Runtime: ensureKbProfile at citizen registration (border approve) and for Joe the founder
  (profile number one, Driftwood Cove, founder bio + birth event post); kbPost() appends screened
  capped posts; restoreKookerbook() on boot (local immediately, backend overlay).
- 7 node tests (screening, sol stamping, caps, rate limit, follow, tamper-drop, store round-trip
  + backend-wins merge). All green. LIVE: Joe's profile exists on :5188 with his birth event, a
  narration posted through kbPost, both persisted across reload.

NEXT
- P1 the site: kookerbook.html directory + profile pages (portrait fallback = avatar render, house
  render, timeline), data-kb-action hooks, HUD link, rollup input line; live with Joe's page.

### 2026-06-11 — Slice: P1 the site — Kookerbook is live with Joe's page
DONE
- kookerbook.html + social/kookerbookMain.tsx: a standalone page reading the same-origin kookerbook
  + blueprint stores directly (backend overlay when it answers) — directory of citizen cards
  (portrait, alias, address, last post) and the profile page: header, bio, a LIVE 3D RENDER OF THE
  CITIZEN'S OWN DESIGNED HOUSE rebuilt from their stored blueprint through the shared compile +
  greedy-mesh cores, and the sol-stamped timeline. Every control carries data-kb-action.
- HUD gains a Kookerbook link (open the Book); kookerbook.html added to the rollup inputs.
- TWO REAL BUGS found by live verification and fixed: (1) the Vite /kooker proxy prefix swallowed
  /kookerbook.html into the APISIX gateway (404) — the proxy is now anchored to ^/kooker/ so only
  API calls match; (2) constructor ordering clobbered stored timelines — seedJoe wrote a fresh
  1-post profile over the persisted one before restore ran; restoreKookerbook now runs FIRST and
  ensureKbProfile skips existing profiles.
- Verified live end to end: Joe's page shows portrait, Driftwood Cove · Founder, bio, his
  self-designed brick house render, and a timeline whose narration + birth event SURVIVE a full
  game reload. 616 tests green.

NEXT
- P2 event posts: moved-in, house-designed (with blueprint snapshot), founders-day wired from the
  runtime so timelines fill themselves as the city lives.

### 2026-06-11 — Slice: P2 event posts — timelines write themselves
DONE
- assignLot posts a moved-in event (with the plot name) to the new owner's page; applyBlueprint
  posts designed-their-home (first design) or redesigned-their-home (a built plot's new blueprint)
  — and since selfDesignLot and the builder popup both flow through applyBlueprint, every design
  path lands on the timeline automatically.
- Verified live: Joe ran his self-design loop and his Kookerbook page now reads as a life —
  arrived, watched the dropship lights (narration), redesigned their home — above his house render.
  616 tests green.
- Deferred to P3: founders-day calendar posts and the blueprint snapshot image on design events
  (joins the generated-portrait work).

NEXT
- The commerce arc (079-P0 district survey onward) — business tabs land on these same pages — then
  082-P3 narration/authored posts + generated portraits via the existing image APIs.
