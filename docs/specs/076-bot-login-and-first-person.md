# Spec 076 — Bot login, dual-credential identity, and first-person embodiment

Status: proposed
Builds on Spec 074 (Citizen Avatar Bot), Spec 075 (Citizen accounts and owned Hermes), and the
Stage-1 change where CityLife bots already call the kooker inference choke point with the logged-in
**player's own session JWT** (no shared PAT).

## Goal

A spawned citizen is a **real kooker sub-user you own**. You can **log in as that citizen** and
**embody it in first-person** — walk the world through its eyes (Spec 074 / PR #34). The same citizen
can also play **autonomously** (a container bot driving itself via APIs + world telemetry). Either way
it authenticates to the **metered** inference choke point with a valid kooker JWT, so metering /
moderation / rate-limit never break.

The arc:

> kooker login (you, the parent) → spawn a citizen → that citizen is a kooker **sub-user**
> (`parentUserId = you`) → click into it and **log in as that citizen** → first-person. Or the
> citizen's **container** holds its own credential and plays 24/7. Inference is metered per citizen.

## Refinement of Spec 075 D1 — one sub-user identity, two credential paths

Spec 075 D1 said the bot authenticates as itself (sub-user) and rejected the *parent's* JWT for bot
calls. This spec keeps "bot = sub-user that acts as itself" and makes the **credential path explicit**:
the bot is a single kooker sub-user, reachable by **either** of two credentials, both yielding a JWT
the choke point accepts.

| Path | Credential | Who uses it | Where it lives |
|---|---|---|---|
| **UI embodiment** | the bot's **username + password** → `/auth/basic` → JWT | a human "logging in as" their citizen (click-into, or direct login) | the human's session (sessionStorage), like any login |
| **Autonomous** | the bot's **BOT_PAT** → exchange for short-lived JWT | the citizen's container playing itself (API moves, telemetry of where its figure is) | server-side, in the bot's container — never in a browser |

Both credentials belong to the **same** sub-user, so both JWTs carry the same `userId` → the choke
point meters them identically. If a deployment only ever uses UI embodiment, the BOT_PAT is optional
(username/password alone is sufficient). The BOT_PAT exists for the headless/daemon case.

> Note on Stage 1: the current **border-flow** bots (newcomer + patrol) are transient, player-driven,
> and keep using the player's own JWT — they are not owned citizens and need no sub-user. This spec is
> about the **owned citizen avatars** (Spec 074), which become real sub-users.

## Identity model

```
User (kooker-service-user)
  + parentUserId: long?     # set on citizen sub-users -> the human owner (null for humans)
  + botUser: bool           # true for citizen sub-users; blocks human kooker-web operator login
  role = CITYLIFE_CITIZEN_BOT   # least-privilege; never admin; allow-listed PAT scope (Spec 075)

Citizen (citylife)
  citizenId, displayName, plotName, homeXY ...
  ownerUserId: long         # the human owner (== sub-user.parentUserId)
  botUserId:   long         # the citizen's own kooker sub-user id
```

- A human is a `CITYLIFE_CITIZEN` (Spec 075). A citizen avatar is a `CITYLIFE_CITIZEN_BOT` sub-user.
- `botUser = true` blocks the sub-user from logging into kooker-web as an operator (no shadow admins).
- Ownership is the native `parentUserId` link, not an ad-hoc field — the citizen can hold a wallet and
  own its plot (Spec 075 economy).

## The two UX flows (both end in first-person)

```
A) Parent-then-embody
   log in as you (parent JWT) → world view → click a citizen you OWN
   → "Enter as <citizen>" → log in as the bot sub-user (its credential) → session switches
   → first-person walk (PR #34) as that citizen

B) Direct bot login
   log into CityLife with the citizen's credential from the start → first-person from the start
```

Both are the **same** identity switch: the browser ends up holding the **bot sub-user's** JWT, and
inference runs as the bot → metered per citizen. (A) is a convenience that mints/uses the bot session
from within the parent's session after asserting `parentUserId == parent`.

## Authorization (who may embody / drive which citizen)

- **Spawn / list / enter** a citizen requires `citizen.ownerUserId == caller` (Spec 075 D2 owner-scope,
  default-deny cross-tenant). You can only enter citizens you own.
- A citizen's **own** JWT (once embodied) authorizes only that citizen's actions — never the parent's,
  never another tenant's.
- Cross-tenant view (watch someone else's citizen) requires an explicit **ShareGrant** (Spec 075 D2),
  out of scope here.

## Inference stays metered (the hard constraint)

Every path produces a JWT with the citizen's `userId` and the `key` claim. It passes:
1. APISIX `jwt-auth` on `/api/v1/ai/*` (valid signed kooker JWT), and
2. kooker-service-ai `/api/v1/ai/** → .authenticated()`.

The choke point's Redis limiter + interceptors meter per `userId` (the citizen). No path bypasses the
choke point; no path carries admin.

## Backend changes (kooker-service-user) — the spec-first deliverable

1. **Flyway migration**: add `parent_user_id BIGINT NULL` (FK `users.id`) and
   `bot_user BOOLEAN NOT NULL DEFAULT false` to the users table. (Update the digest-pinned migrator
   image — see kooker-infra migrator-job.)
2. **Entity + DTO**: add `parentUserId`, `botUser` to `UserDTO` and the client lib
   (`kooker-client-service-user`) so the auth service and CityLife can read them.
3. **Sub-user creation**: `POST /api/users` accepts `parentUserId` + `botUser` + role
   `CITYLIFE_CITIZEN_BOT`. Gated: caller must be the parent (or admin). Sets a password (UI path)
   and/or mints a BOT_PAT (autonomous path) via the existing `generatePat` (Spec 075 down-scoped).
4. **Role**: add `CITYLIFE_CITIZEN_BOT` to the allow-listed PAT scopes (`SCOPED_PAT_ROLES`) and the
   login app-access checks so the sub-user can sign into `citylife` but not `kooker-web`.
5. **Owner-scope** the inference metrics endpoint (Spec 075 phase 1) so a parent sees only their own
   citizens' usage.

## Phased delivery

1. **Backend foundation** — the migration + DTO + sub-user creation endpoint + `CITYLIFE_CITIZEN_BOT`
   role + `botUser` login gate. (This spec; build after review.)
2. **Provision on spawn** — when a player spawns a citizen, CityLife creates the sub-user
   (`parentUserId = player`), stores `botUserId` on the citizen.
3. **Embody** — "Enter as <citizen>" (parent → bot session switch) and direct bot login → first-person.
4. **Autonomous** — BOT_PAT in the citizen's container; API moves + world telemetry (where the figure
   is); the container plays itself, metered as the citizen.
5. **Share-ACL + tiers** — defer to Spec 075 phase 5.

## BOT_PAT storage — RESOLVED (research, 2026-06-06)

There is **no `auth.json`** anywhere in the stack and no NousResearch/Hermes upstream `auth.json`
convention. The existing, working secret-injection spine is what we reuse — **do not invent a new
file format**:

```
register (kooker-service-ai) ── mints BOT_PAT (365d HS256 JWT) ──> BotNode.patToken (Neo4j)
spawner POST /bots/provision ── botPat in body ──> k8s Secret bot-<label> (ns kooker), key BOT_PAT
Deployment ── envFrom: secretRef ──> BOT_PAT env in the pod
entrypoint-hermes.sh ── writes ~/.hermes/.env: OPENAI_API_KEY=$BOT_PAT, OPENAI_BASE_URL=<router>
Hermes runtime ── Authorization: Bearer <BOT_PAT> ──> kooker-service-ai /api/v1/ai/route/chat
choke point ── KookerJwtAuthenticationFilter + OwnerResolver ── meters usage to BotNode.ownerEmail
```

For a CityLife citizen bot: mint via `POST /api/swarm/fleet/register` with
**`ownerEmail = the citizen sub-user's email`** so metering/rate-limit land on the citizen. The PAT is
stored in the per-bot k8s Secret `bot-<label>` (key `BOT_PAT`), reaches the pod via `envFrom`, and the
**existing** `entrypoint-hermes.sh` already does `OPENAI_API_KEY=$BOT_PAT` → Bearer to the choke
point. No read-path code change. (Canonical spawner: `_spawner-fresh/server.js` — it injects `BOT_PAT`;
the stale `kooker-bot-spawner/server.js` is JWT-only and should be deprecated.)

This is also the "username/password vs BOT_PAT" answer: the autonomous container uses the **BOT_PAT**
(stored in its k8s Secret, sent as the OpenAI Bearer); the UI login-as-bot uses the sub-user's
**password** → `/auth/basic` → JWT. Both authenticate the same sub-user; both metered identically.

### Security hardening to do alongside (research-flagged)

1. **No real revocation**: the 365-day JWT PAT is accepted by the filter *before* the string lookup,
   so a leaked PAT lives a full year even after `rotate-pat`. Mint **shorter-TTL** PATs for citizens
   and add a `jti` denylist for true revocation.
2. **`rotate-pat` mints an opaque UUID** (not a JWT) — format-inconsistent and breaks the daemon
   heartbeat. Make it call `generateBotAccessToken`.
3. **PAT cleartext in Neo4j** (`BotNode.patToken`) and pullable via `/{botId}/env` — hash-at-rest or
   shorten TTL.
4. **Omit the shared `GEMINI_API_KEY`** from citizen-bot Secrets (one leak = org-wide key); citizens
   route through the kooker router and don't need it.
5. **Lock down the in-pod surface** for citizen bots (Hermes dashboard `--insecure 0.0.0.0:18789`,
   VNC/noVNC, sshd) — bind to loopback or drop.

## Open questions (resolve in review)

- **Password for UI login-as-bot**: auto-generate per citizen (stored where?), or let the parent set
  it, or support a parent-asserted "enter" that mints a bot session without a typed password (the
  parent's ownership is the proof)? Leaning: parent-asserted enter for flow (A); explicit credential
  for flow (B); BOT_PAT for autonomous.
- **Migrator image digest** bump coordination (kooker-infra) for the schema change.

## Non-goals

- No admin roles anywhere in the citizen path. Moderation is the choke point's interceptor.
- The parent's JWT is never used as a citizen's identity for autonomous play.
- No PAT in the browser for the deployed app; BOT_PATs live server-side / in the bot container.
