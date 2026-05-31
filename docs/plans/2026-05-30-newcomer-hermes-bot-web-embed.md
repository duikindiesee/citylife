# CityLife Newcomer Hermes Bot + Web Embed Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a gated Phase 1 CityLife flow where an authenticated operator can add a safe fictional newcomer household, bootstrap a low-cost Hermes bot without Telegram, inspect its chat/task trail inside the web UI, and manually progress the newcomer until a house is built; after the house is built, the household can drive commercial/industrial growth and migration requests through an operator-approved queue.

**Architecture:** CityLife remains an outside observation surface over the ecosystem. The browser talks only to a forkable `citylife-backend` over Basic Auth + JWT-protected APIs; the backend creates a generated household identity, starts a Hermes profile/bot with no Telegram platform, creates an initial triage task, and exposes read-only chat/task history to the UI. Simulation state changes still enter through explicit game APIs and schema-validated actions, not arbitrary model-authored code.

**Tech Stack:** TypeScript/Vite/React/three.js for CityLife, a forkable `citylife-backend` API service, Basic Auth login bootstrap + short-lived JWT API sessions, Hermes Agent profiles + SessionDB/Kanban for bot state, a backend adapter/API for bot lifecycle and chat/session retrieval, GitHub branch protection and public-repo safety rules.

---

## Non-negotiable safety rules

- **No secrets, private namespaces, internal hostnames, tokens, or real personal identifiers may be committed to this public repository.**
- Newcomer names and biographies must be fictional, generated, and checked against a denylist/redaction filter before display or persistence.
- A CityLife user represents one **household**, not an internal operator account.
- Phase 1 bots are created **without Telegram**. Communication happens through CLI/admin tooling and later through a web UI chat/session viewer.
- Bot identities use the cheapest/high-throughput configured Codex-compatible profile tier available in the operator environment. The repo stores only capability labels and config keys, never credentials.
- Every newcomer starts with an initial **triage task** so lifecycle, communication, and audit have a durable anchor from the first run.
- All interactions must be retrievable: generated background, bootstrap prompt, triage task, chat/session messages, operator decisions, and game-state milestones.
- Manual operator gates are required before the household becomes active in the city and before a house is considered built.
- Every backend API used by the game UI must require Basic Auth login plus JWT authorization. No unauthenticated game/backend endpoints.
- Keep bot lifecycle, chat retrieval, migration queues, and simulation mutation APIs in a reusable/forkable `citylife-backend` boundary so the whole mechanic can be copied into future games.
- New migration candidates are queued messages/requests that an operator can accept or decline; generation is allowed, automatic admission is not.

---

## Phase 1 product flow

1. Operator opens CityLife "Border Control" / "Add Newcomer" screen.
2. Operator clicks **Add newcomer**.
3. Backend generates a fictional household lead profile:
   - display name
   - age band
   - education
   - job history
   - origin location on Earth
   - household composition summary
   - migration motivation for the new planet
   - safety metadata: generated=true, public-safe=true, no-internal-name-match=true
4. Backend creates a Hermes profile/bot with:
   - Telegram disabled/not configured
   - low-cost/high-throughput Codex-compatible model tier
   - profile memory seeded so the bot understands it is the household lead/contact
   - no public secrets or internal environment values in prompts
5. Backend creates an initial triage task for the newcomer bot:
   - title: `TRIAGE: Newcomer household intake - <public display name>`
   - body: generated background, first goals, manual gate checklist, and retrieval links
6. CityLife shows the newcomer at the gated border-control state:
   - generated profile card
   - triage task status
   - chat/session preview
   - operator buttons: approve, hold, reject, request revision
7. Operator manually progresses milestones:
   - identity generated
   - bot booted
   - first chat complete
   - plot selected
   - plot purchased
   - house planned
   - house built
8. Once a household reaches `house built`, the backend can unlock requests to develop commercial or industrial activity:
   - commercial requests need population/foot-traffic justification
   - industrial requests need zoning/distance/happiness checks
   - approved businesses add jobs and can generate further migration demand
9. Migration demand creates a queue of generated candidate household messages:
   - operator can accept, hold, or decline each candidate
   - accepted candidates enter the same Border Control flow
   - declined candidates stay logged but do not create bots or plots
10. Later phases allow bots/households/businesses to communicate with each other through controlled, logged interfaces.

---

## Domain model additions

### Household

Fields:
- `id`: public UUID/slug, not an internal profile name
- `displayName`: generated public-safe name
- `leadPersona`: generated background object
- `membersSummary`: short generated household summary
- `originLocation`: public Earth location string
- `status`: `draft | triage | approved | active | held | rejected`
- `botHandle`: public alias only; internal profile ID is stored server-side
- `triageTaskId`: Kanban task id
- `chatSessionRefs`: opaque backend references, not raw file paths
- `createdAt`, `updatedAt`

### Land parcel / plot

Fields:
- `id`
- `zone`: `residential | commercial | industrial | park | civic`
- `size`
- `baseCost`
- `developmentCost`
- `ownerHouseholdId?`
- `happinessInfluenceRadius`
- `pollutionInfluenceRadius`
- `availableForPurchase`

### Zoning constraints

- Industrial should be further from residential where possible.
- Industrial proximity lowers nearby household happiness.
- Commercial growth depends on population and foot traffic.
- Businesses can be planned by household/bot later, with a small generated mini-site/app concept only after operator approval.

### Migration request

Fields:
- `id`
- `source`: `commercial_jobs | industrial_jobs | operator_generated | story_event`
- `candidateHousehold`: generated preview profile, not yet an active bot
- `reason`: public-safe message explaining why this household wants to migrate
- `status`: `queued | accepted | held | declined | expired`
- `linkedBusinessId?`
- `createdAt`, `decidedAt?`

### Backend auth/session

Fields:
- `operatorId`: public operator alias only
- `basicAuthRealm`: configured realm name; no credentials in repo
- `jwtSubject`: operator alias or service account alias
- `jwtExpiresAt`
- `scopes`: e.g. `newcomer:create`, `chat:read`, `migration:decide`, `simulation:mutate`

### citylife-backend forkability boundary

The backend owns:
- Basic Auth credential verification and JWT issuing
- Hermes profile/bot lifecycle
- Kanban triage task creation
- sanitized chat/session retrieval
- migration request queues
- operator audit logs
- all secret-bearing configuration

The browser/game repo owns:
- login screen and token storage policy
- API client interfaces
- CityLife rendering and simulation UI
- public-safe type definitions and mocks

---

## Backend/API contracts

All endpoints below require an authenticated JWT. The login endpoint itself is protected by Basic Auth and returns a short-lived JWT for subsequent UI API calls.

### `POST /api/auth/login`

Authenticates an operator via Basic Auth and returns a JWT. The frontend shows a login screen before loading operator controls.

Request headers:
```http
Authorization: Basic <base64 operator-login>
```

Response:
```json
{
  "token": "jwt-redacted",
  "expiresAt": "ISO timestamp",
  "operator": { "id": "operator-public-alias", "scopes": ["newcomer:create"] }
}
```

Rules:
- Credentials are never stored in this repo.
- JWT signing secret is backend-only environment config.
- UI stores JWT only for the current operator session and clears it on logout/expiry.

### `POST /api/citylife/newcomers`

Creates a generated household and starts triage. Requires JWT scope `newcomer:create`.

Request:
```json
{
  "seed": "optional-public-seed",
  "mode": "phase1-manual"
}
```

Response:
```json
{
  "household": {
    "id": "household_...",
    "displayName": "fictional public name",
    "status": "triage",
    "originLocation": "public Earth location"
  },
  "triageTaskId": "t_...",
  "previewUrl": "operator-only preview path or null"
}
```

### `GET /api/citylife/newcomers/:id`

Returns the safe public household view plus operator-visible audit state. Requires JWT scope `newcomer:read`.

### `GET /api/citylife/newcomers/:id/chat`

Returns sanitized chat/session events for display in the CityLife UI. Requires JWT scope `chat:read`.

Rules:
- Redact secrets and internal paths.
- Show model/source/cost metadata only if safe.
- Preserve enough context for operator review.

### `POST /api/citylife/newcomers/:id/milestones`

Operator advances a manual milestone. The backend appends an audit event and, where needed, creates/updates Kanban tasks. Requires JWT scope `simulation:mutate`.


### `GET /api/citylife/migration-requests`

Returns queued generated migration candidates and their public-safe messages. Requires JWT scope `migration:read`.

### `POST /api/citylife/migration-requests/:id/decision`

Operator accepts, holds, or declines a migration request. Accepted requests enter the normal newcomer flow; declined requests are logged only. Requires JWT scope `migration:decide`.

Request:
```json
{
  "decision": "accepted | held | declined",
  "operatorNote": "optional public-safe note"
}
```

### `POST /api/citylife/development-requests`

Creates a commercial or industrial development request after at least one household has a built house. Requires JWT scope `development:create`.

Rules:
- Commercial development must reference current population/foot traffic.
- Industrial development must pass zoning distance/happiness checks or be held for operator review.
- Approved development can create jobs, which can create migration requests.

---

## Implementation slices

### Slice 1: Repository guardrails

**Objective:** Keep public repo safe before building features.

**Files:**
- Create: `.github/CODEOWNERS`
- Create/modify: `.github/workflows/ci.yml`
- Modify: `AGENTS.md`

**Steps:**
1. Add CODEOWNERS requiring the public maintainer handle for all files.
2. Add CI running `npm test`, `npm run typecheck`, and `npm run build`.
3. Add an AGENTS.md section: no secrets/internal namespaces/real PII in public commits.
4. Verify with `npm test`, `npm run typecheck`, `npm run build`.

### Slice 2: Auth shell and API client contract

**Objective:** Require login before any CityLife backend interaction.

**Files:**
- Create: `src/colony/authClient.ts`
- Create: `tests/auth-client.test.ts`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/styles.css`

**Steps:**
1. Write tests for Basic Auth login request construction without logging credentials.
2. Write tests for JWT expiry/logout behavior.
3. Implement an API client that attaches a redacted `Authorization: Bearer <jwt>` header to backend calls.
4. Add a login screen that gates Border Control/operator controls until authenticated.
5. Verify no credentials, JWTs, or private URLs are rendered in snapshots or console output.

### Slice 3: Forkable `citylife-backend` contract package/runbook

**Objective:** Keep bot maintenance and API state behind a reusable backend boundary.

**Files:**
- Create: `docs/plans/citylife-backend-contract.md`
- Create: `src/colony/backendTypes.ts`
- Create: `tests/backend-types.test.ts`

**Steps:**
1. Define public DTOs shared between UI and backend.
2. Document backend-owned responsibilities: auth, JWT, Hermes profiles, Kanban, chat/session retrieval, migration queue, audit logs, secrets.
3. Document forkability requirements so the backend can be copied into new game mechanics.
4. Add tests ensuring DTOs expose only public aliases and opaque references.

### Slice 4: Newcomer domain model and deterministic generator

**Objective:** Generate safe fictional household profiles without touching Hermes yet.

**Files:**
- Create: `src/colony/newcomers.ts`
- Create: `tests/newcomers.test.ts`

**Steps:**
1. Write tests for deterministic generation by seed.
2. Write tests rejecting denylisted/internal-looking names and raw secret-like strings.
3. Implement generator using existing seeded RNG patterns.
4. Expose household draft objects with `generated=true` and `publicSafe=true` metadata.

### Slice 5: Border Control UI shell

**Objective:** Add the operator-facing gated flow without backend side effects.

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/styles.css`
- Test: add UI/render tests if the repo test harness supports them; otherwise keep logic in testable helpers.

**Steps:**
1. Add an **Add newcomer** panel.
2. Render generated household preview.
3. Show manual milestone checklist.
4. Keep all data local/mock until Slice 4.

### Slice 6: Backend adapter contract for Hermes-without-Telegram bot bootstrap

**Objective:** Define the safe adapter boundary CityLife calls.

**Files:**
- Create: `src/colony/hermesNewcomerAdapter.ts`
- Create: `tests/hermes-newcomer-adapter.test.ts`

**Steps:**
1. Define `NewcomerBotAdapter` interface: `createBot`, `createTriageTask`, `getChatEvents`, `advanceMilestone`.
2. Add a mock adapter for browser/local development.
3. Add validation that adapter never exposes internal profile names, secrets, or raw file paths.
4. Document real backend implementation expectations.

### Slice 7: Kanban triage task creation

**Objective:** Make every newcomer begin with a durable task.

**Files:**
- Extend adapter tests and docs.

**Steps:**
1. Ensure `createBot` returns public alias and opaque backend ref.
2. Ensure `createTriageTask` receives the household background and manual gate checklist.
3. Store `triageTaskId` on household state.
4. Show triage state in UI.

### Slice 8: Chat/session embed viewer

**Objective:** Let the web UI observe bot conversations without Telegram.

**Files:**
- Create: `src/ui/NewcomerChatPanel.tsx`
- Create: `src/colony/chatEvents.ts`
- Tests for redaction and ordering.

**Steps:**
1. Define sanitized event shape.
2. Render chronological chat/task events.
3. Add empty/loading/error states.
4. Verify no raw internal paths or secrets render.

### Slice 9: Land surveyor zoning + plot purchase planning

**Objective:** Encode the land-surveyor story into testable zoning/plot mechanics.

**Files:**
- Create/modify: `src/colony/land.ts`
- Create: `tests/land-zoning.test.ts`

**Steps:**
1. Divide land into parcels with zone, size, base cost, development cost.
2. Add industrial distance/happiness penalties.
3. Gate commercial growth by population.
4. Add plot purchase + house planned/built milestone hooks.

### Slice 10: Post-house development and migration request queue

**Objective:** Unlock commercial/industrial development and controlled migration after a house is built.

**Files:**
- Create: `src/colony/migrationQueue.ts`
- Create: `tests/migration-queue.test.ts`
- Modify: `src/colony/land.ts`
- Modify: `src/ui/App.tsx`

**Steps:**
1. Write tests that no development request can be approved before at least one household has `houseBuilt`.
2. Write tests that commercial requests require population/foot-traffic thresholds.
3. Write tests that industrial requests calculate nearby happiness impact and can be held.
4. Implement migration candidate generation as queued messages, not automatic admission.
5. Add accept/hold/decline decisions and audit events.
6. Render the queue in the operator UI.

### Slice 11: Operator preview/deploy proof

**Objective:** Make review quick without leaking private hostnames in public docs.

**Files:**
- Create: `docs/plans/operator-preview.md`

**Steps:**
1. Add a script or runbook for local screenshot capture.
2. Add a runbook field for an operator-only private preview URI.
3. Do not commit the actual private URI.
4. Attach screenshot or preview link only in private operator channels/PR comments when needed.

---

## Acceptance criteria

- Main branch is protected and changes land via PR review.
- Public repo contains no secrets, private namespaces, internal hostnames, or real-person generated identities.
- "Add newcomer" creates a fictional household record and initial triage task through a backend adapter.
- Bot bootstrap supports no-Telegram profiles and CLI/web chat observation.
- CityLife can show sanitized chat/session history in the web UI.
- Operator can manually progress a newcomer until a house is built.
- Land/zoning mechanics represent industrial distance, residential happiness, commercial population dependency, land cost, and development cost.
- Tests cover generation safety, auth/JWT client behavior, redaction, adapter contract, zoning constraints, migration queue decisions, and milestone progression.
- Every UI-to-backend API is behind Basic Auth login plus JWT authorization.
- `citylife-backend` responsibilities are documented as a forkable boundary for future game mechanics.
- After house-built, commercial/industrial development can create jobs and queued migration requests; operators can accept or decline generated candidates.

