# CityLife Newcomer Hermes Bot + Web Embed Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a gated Phase 1 CityLife flow where an operator can add a safe fictional newcomer household, bootstrap a low-cost Hermes bot without Telegram, inspect its chat/task trail inside the web UI, and manually progress the newcomer until a house is built.

**Architecture:** CityLife remains an outside observation surface over the ecosystem. The game UI requests newcomer creation through a narrow backend API; the backend creates a generated household identity, starts a Hermes profile/bot with no Telegram platform, creates an initial triage task, and exposes read-only chat/task history to the UI. Simulation state changes still enter through explicit game APIs and schema-validated actions, not arbitrary model-authored code.

**Tech Stack:** TypeScript/Vite/React/three.js for CityLife, Hermes Agent profiles + SessionDB/Kanban for bot state, a small backend adapter/API for bot lifecycle and chat/session retrieval, GitHub branch protection and public-repo safety rules.

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
8. Later phases allow bots/households/businesses to communicate with each other through controlled, logged interfaces.

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

---

## Backend/API contracts

### `POST /api/citylife/newcomers`

Creates a generated household and starts triage.

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

Returns the safe public household view plus operator-visible audit state.

### `GET /api/citylife/newcomers/:id/chat`

Returns sanitized chat/session events for display in the CityLife UI.

Rules:
- Redact secrets and internal paths.
- Show model/source/cost metadata only if safe.
- Preserve enough context for operator review.

### `POST /api/citylife/newcomers/:id/milestones`

Operator advances a manual milestone. The backend appends an audit event and, where needed, creates/updates Kanban tasks.

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

### Slice 2: Newcomer domain model and deterministic generator

**Objective:** Generate safe fictional household profiles without touching Hermes yet.

**Files:**
- Create: `src/colony/newcomers.ts`
- Create: `tests/newcomers.test.ts`

**Steps:**
1. Write tests for deterministic generation by seed.
2. Write tests rejecting denylisted/internal-looking names and raw secret-like strings.
3. Implement generator using existing seeded RNG patterns.
4. Expose household draft objects with `generated=true` and `publicSafe=true` metadata.

### Slice 3: Border Control UI shell

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

### Slice 4: Backend adapter contract for Hermes-without-Telegram bot bootstrap

**Objective:** Define the safe adapter boundary CityLife calls.

**Files:**
- Create: `src/colony/hermesNewcomerAdapter.ts`
- Create: `tests/hermes-newcomer-adapter.test.ts`

**Steps:**
1. Define `NewcomerBotAdapter` interface: `createBot`, `createTriageTask`, `getChatEvents`, `advanceMilestone`.
2. Add a mock adapter for browser/local development.
3. Add validation that adapter never exposes internal profile names, secrets, or raw file paths.
4. Document real backend implementation expectations.

### Slice 5: Kanban triage task creation

**Objective:** Make every newcomer begin with a durable task.

**Files:**
- Extend adapter tests and docs.

**Steps:**
1. Ensure `createBot` returns public alias and opaque backend ref.
2. Ensure `createTriageTask` receives the household background and manual gate checklist.
3. Store `triageTaskId` on household state.
4. Show triage state in UI.

### Slice 6: Chat/session embed viewer

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

### Slice 7: Land surveyor zoning + plot purchase planning

**Objective:** Encode the land-surveyor story into testable zoning/plot mechanics.

**Files:**
- Create/modify: `src/colony/land.ts`
- Create: `tests/land-zoning.test.ts`

**Steps:**
1. Divide land into parcels with zone, size, base cost, development cost.
2. Add industrial distance/happiness penalties.
3. Gate commercial growth by population.
4. Add plot purchase + house planned/built milestone hooks.

### Slice 8: Operator preview/deploy proof

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
- Tests cover generation safety, redaction, adapter contract, zoning constraints, and milestone progression.

