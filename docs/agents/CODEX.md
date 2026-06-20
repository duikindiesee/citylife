# Codex work queue — the kooker backend lane

Codex is the backend specialist for the CityLife programme: it implements the kooker-side service
endpoints that the citylife client already calls best-effort (404-tolerant), so each delivery
lights up a feature that is dark today. This lane never touches the citylife game repo's source
(Claude's rail) nor Antigravity's lane (tools/, gallery, tests/antigravity/, kooker-service-social).
Read the root AGENTS.md of the citylife repo for the shared hard rules (CI-safe commit messages,
no secrets, protected main branches).

## Setup

- Make YOUR OWN clones under D:\infra\codex\ — never edit the existing working checkouts under
  D:\infra (other agents and the operator use those):
  - git clone https://github.com/duikindiesee/kooker-service-user D:\infra\codex\kooker-service-user
  - git clone https://github.com/duikindiesee/kooker-service-ledger D:\infra\codex\kooker-service-ledger
- Branch per task: codex/<task-id>-<slug>, cut from the repo's default branch. Push the branch and
  open a PR with a clear description. NEVER merge your own PRs — the operator reviews.
- Commit messages must be CI-SAFE: no double quotes, no brackets, no colon-bullet lines (kooker CI
  shell-interpolates the head commit message). Write the message to a temp file, git commit -F.
- All endpoints sit behind the kooker APISIX gateway with jwt-auth — follow the existing
  per-service security config; never weaken an auth filter.

## CX-1 — citylife blueprints endpoint (kooker-service-user) · codex/cx1-citylife-blueprints

The citylife client (src/colony/bot/blueprintStore.ts in duikland/citylife) ALREADY calls this
contract and tolerates its absence. Implement exactly:

- PUT /api/v1/citylife/blueprints — auth: a kooker player JWT (the existing filter chain). Body
  {lotId string, citizenId string, script string}. Upserts one record per (authenticated user,
  lotId). Server-side validation before storing: script max 4096 chars, single line, must contain
  a house{...} header; reject anything matching a denylist of secret-looking/internal tokens
  (mirror the PgSafety/denylist style already in this service). 200 on success, 400 on invalid.
- GET /api/v1/citylife/blueprints — returns a JSON object map for the calling user:
  { "<lotId>": { "citizenId": "...", "script": "..." }, ... }
- Storage: a new Flyway migration (next V number) creating citylife_blueprint (user id FK, lot_id,
  citizen_id, script text, updated_at; unique on user+lot). Follow the V16
  citylife_bot_profile migration + CitylifeBotProfileService.java as the house-style reference.
- Tests: upsert + readback round-trip, per-user isolation (user A cannot read user B), invalid
  script rejected, oversized script rejected.
- Acceptance: full service test suite green; PR describes the contract and cites the citylife
  client file that consumes it.

## CX-2 — citylife commercial + kookerbook persistence (kooker-service-user) · codex/cx2-citylife-commercial

Same pattern as CX-1, two more per-user keyed stores the citylife client will call (contracts in
duikland/citylife docs/specs/079-commercial-plots-and-shops.md and 082-kookerbook.md):

- PUT/GET /api/v1/citylife/commercial — map keyed by parcelId: { ownerCitizenId, shopKind,
  listing } (listing is a screened single-line DSL string, same validation approach as CX-1).
- PUT/GET /api/v1/citylife/kookerbook — map keyed by citizenId: a profile JSON blob (alias, bio,
  plotId, posts array). Enforce server-side caps: posts max 50 per profile, each text max 1000
  chars, every string denylist-screened. NOTE: this is a stopgap until kooker-service-social
  (Antigravity's AG-5) is live — keep the handler thin and the storage schema simple so migration
  to the social service is easy; say so in the PR.
- One migration, tests as in CX-1 including the caps.

## CX-3 — ledger hardening for shop checkout (kooker-service-ledger) · codex/cx3-ledger-checkout

Spec 079-P5 (duikland/citylife docs/specs/079) posts shop sales as double-entry transactions.
Verify and harden:

- Confirm POST /api/ledger/transactions and GET /api/ledger/wallets/{ownerId}/balances are
  jwt-auth gated at the gateway AND the service. If any citylife-needed route is missing from the
  APISIX config, note it in the PR description for the operator (kooker-infra changes are NOT
  yours to push).
- IDEMPOTENT references: if a transaction with the same reference + appName already exists,
  return the existing transaction (200) instead of double-posting — the citylife checkout sends
  reference sale*<parcelId>*<n> and relies on this.
- Tests: duplicate reference returns the original and does not change balances; balanced-entry
  validation rejects one-sided transactions.

## CX-4 (stretch) — bot workstation serving (kooker-agents + kooker-bot-spawner) · codex/cx4-workstations

Spec 080 (duikland/citylife docs/specs/080-bot-workstations.md): give each spawned bot pod a
static web server over a www directory on its home volume (in the kooker-agents hermes image),
expose it on the per-bot Service via the spawner, and document (do not apply) the NetworkPolicy
change needed in kooker-infra. Only start this after CX-1..CX-3 are in PR. Two repos, one branch
each, same rules.

## Status board (Codex updates per branch)

| Task | Branch | Status      | PR  |
| ---- | ------ | ----------- | --- |
| CX-1 | —      | not started | —   |
| CX-2 | —      | not started | —   |
| CX-3 | —      | not started | —   |
| CX-4 | —      | not started | —   |
