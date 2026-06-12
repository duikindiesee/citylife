# Antigravity work queue — CityLife

Antigravity runs scheduled work on this game in its OWN lane, parallel to Claude's spec-077 loop on
`mechanics/dev`. This file is the contract: what to build, where to commit, and how it gets merged.
Read the root `AGENTS.md` first (architecture rules, CI-safe commit messages, determinism, secrets).

## Where things are

- Make YOUR OWN clone: `git clone https://github.com/duikland/citylife D:\infra\projects\citylife-antigravity`
  and work only there. `D:\infra\projects\citylife-visual` is Claude's live working tree (its loop
  edits files there continuously) and `D:\infra\projects\citylife` belongs to other routines — do
  not open or modify either.
- Game dev server: `npm run dev -- --port 5189` → http://localhost:5189 (5188 is Claude's; do not
  take it). Auth bypass for local testing, dev builds only: `http://localhost:5189/?skipauth=1`.
- Builder page: `/builder.html?citizenId=dev&lotId=dev&w=9&d=6&seed=12345` (+ optional
  `bp=<urlencoded blueprint DSL>` to load a design). All controls carry `data-build-action`.
- Verify: `npx tsc --noEmit` and `npx vitest run` — green before every push, no exceptions.

## Branch + merge contract

1. Start every task from the freshest core line: `git fetch origin` then branch from
   `origin/mechanics/dev` as `antigravity/<task-id>-<slug>` (example `antigravity/ag1-blueprint-service`).
2. Commit only files in the Antigravity-owned lane (see AGENTS.md ownership list). One task per
   branch; small honest commits; CI-safe messages (no double quotes, brackets, or colon-bullet lines —
   use a temp file + `git commit -F`).
3. Push the branch to origin when the task's acceptance criteria pass locally. Do NOT open a PR to
   `main` and do NOT touch `mechanics/dev` — Claude's loop polls `origin/antigravity/*` every
   iteration, reviews the diff, runs the suite, and merges green slices into `mechanics/dev` (which
   rides the rolling PR #40 into protected `main`).
4. If a task needs a Claude-owned file changed, write the needed change as a note in the task's
   `NOTES.md` on the branch instead of editing the file — Claude applies it on merge.
5. Rebase your branch onto the latest `origin/mechanics/dev` if it falls behind before pushing.

## Task queue (work top to bottom; one branch each)

### AG-1 — Headless blueprint service (spec 077 P7) · `antigravity/ag1-blueprint-service`
A small Node service + CLI under `tools/blueprint-service/` exposing the SHARED house cores headlessly
so a Hermes bot container can design without a browser.
- Import the existing pure cores via relative paths: `src/colony/blueprintScript.ts` (parse /
  serialise / validate) and `src/colony/houseBuilder.ts` (compileBlueprint).
- CLI: `node tools/blueprint-service/cli.mjs validate "<script>"` → JSON ValidationResult;
  `... compile "<script>" --w 9 --d 6 --seed 12345` → JSON {gw, gd, gh, storeys, blockCount, kinds}.
- HTTP: `node tools/blueprint-service/serve.mjs --port 8077` with POST /validate and POST /compile
  (same JSON in/out). No external deps beyond node + esbuild/tsx-style TS loading; pick the lightest
  approach that runs on node 20.
- Tests in `tests/antigravity/blueprintService.test.ts` (spawn the CLI, assert JSON shapes; the
  canonical example script from docs/specs/077 must validate ok and compile deterministically —
  same blockCount across two runs).
- Acceptance: CLI + HTTP return correct JSON for valid, invalid, and malformed scripts; suite green.

### AG-2 — Street gallery page · `antigravity/ag2-street-gallery`
A standalone `/gallery.html` that renders MANY compiled houses side by side — the visual proof page
for the no-two-houses-alike goal.
- New files only: `gallery.html` + `src/gallery/main.tsx` (+ helpers). ONE line added to
  `vite.config.ts` rollup `input` (the single permitted Claude-file touch).
- Reads `?seeds=1,2,3,...` (default: 12 spread seeds) and `?w=9&d=6`; for each seed compiles
  `defaultBlueprint(seed, 's')` from `src/colony/neighborhood.ts` via `compileBlueprint` +
  `greedyMesh`, and lays the meshes out in a grid in ONE three.js scene with orbit controls.
- Label each house with its seed (DOM overlay or sprite). Daylight lighting like the builder preview.
- Acceptance: `http://localhost:5189/gallery.html?seeds=1,2,3,4,5,6,7,8,9,10,11,12` shows 12 houses
  in a navigable scene; typecheck + tests green. (When Claude lands the P5 variety generator it will
  swap defaultBlueprint for the per-citizen generator here — keep the compile call in one helper.)

### AG-3 — Parser fuzz + compiler golden tests · `antigravity/ag3-fuzz-goldens`
Harden the DSL against bot-authored garbage. New files only under `tests/antigravity/`.
- Fuzz: a seeded deterministic generator (no Math.random — use a tiny LCG) producing mutated/corrupt
  scripts (truncations, swapped tokens, huge ints, negative dims, unknown kinds, duplicate fields);
  `validateBlueprint` must never throw and must return ok=false with at least one error for each.
- Property: every VALID generated design round-trips `parseBlueprint -> blueprintToScript ->
  parseBlueprint` losslessly (deep-equal).
- Goldens: for 5 fixed scripts, snapshot {blockCount, kinds histogram, gw, gd, gh, storeys} of
  compileBlueprint output into committed JSON fixtures; test compares exactly. These pin the
  deterministic compile contract — if Claude's compiler change breaks a golden intentionally, the
  fixture update happens in Claude's merge, so keep fixtures small and readable.
- Acceptance: ≥200 fuzz cases run in <5s, all assertions green.

### AG-4 — Builder undo/redo core · `antigravity/ag4-undo-history`
A PURE history module the builder UI will adopt: `src/colony/builder/history.ts` (new file — do NOT
edit BuilderApp.tsx; Claude wires it in on merge).
- `createHistory<T>(initial: T, cap = 100)` returning {present, canUndo, canRedo} with pure
  `push(state)`, `undo()`, `redo()` transitions (immutable, generic, no DOM).
- Tests in `tests/antigravity/history.test.ts`: push/undo/redo sequences, cap eviction, redo stack
  clearing on a new push, immutability of returned states.
- Add `NOTES.md` on the branch describing the one-line integration points for BuilderApp (where
  `apply()` should push and which two buttons to add with data-build-action undo / redo).
- Acceptance: module + tests green; zero Claude-owned files touched.

### AG-5 — kooker-service-social implementation (SEPARATE REPO, the flagship side-quest)
Implement the generic bot/app social service that spec 082 (Kookerbook) and the sprout app will
share. Repo: `D:\infra\kooker-service-social` (github duikindiesee/kooker-service-social) — today a
spec-only skeleton (README + `postman/specs/openapi.yaml`, written for the sprout plant app). Work
on branch `antigravity/ag5-social-core` in that repo; PR when green; NEVER merge yourself.
- GENERALISE, do not fork: core entities Profile / Post / Follow / Comment / Like / Feed, every
  record scoped by `appName` (the kooker-service-ledger pattern). App-specific shapes (grow rooms,
  plant photos, citylife plots/houses/shops) ride as an opaque `metadata` JSON field on profiles
  and posts — no app-specific tables.
- Match the kooker house style: Spring Boot like the sibling kooker-service-* repos (copy the
  kooker-service-user project layout: Flyway migrations, JWT auth filter accepting kooker JWTs and
  bot PATs, `/api/v1/social/...` routes), or if the sibling pattern is impractical, a clean Node +
  SQLite service mirroring the citylife-backend boundary — state your choice in the PR.
- Keep the existing OpenAPI paths where they map (profiles, watching, feed, likes, notifications);
  add posts + comments; mark sprout-only paths (grow rooms, invitations) as a later appName module.
- Tests required: profile CRUD, appName isolation (citylife cannot read sprout records), post
  caps, screened-string rejection hooks (a `denylist` config), follow/feed correctness.
- Acceptance: service boots locally, OpenAPI updated to match reality, full test suite green, a
  README quickstart, and a PR describing the appName multi-tenancy for the operator to review.

## Status board (Antigravity updates this section on each branch)

| Task | Branch | Status | Last commit |
|------|--------|--------|-------------|
| AG-1 | — | not started | — |
| AG-2 | — | not started | — |
| AG-3 | — | not started | — |
| AG-4 | — | not started | — |
| AG-5 | — | not started | — |

## How the whole loop works (for humans)

- Claude's session loop ships spec-077 core slices straight onto `mechanics/dev` (builder, backend
  persistence, per-citizen variety, the bot self-design loop), verifying each slice live on :5188 and
  logging progress in `docs/specs/077-bot-house-builder.md`.
- Antigravity ships the queue above on `antigravity/*` branches, verified on :5189.
- Each Claude loop iteration runs `git fetch origin` and inspects `origin/antigravity/*`; a branch
  whose diff stays in-lane and whose suite is green gets merged into `mechanics/dev` and noted in the
  spec progress log. Conflicts or out-of-lane edits get a `NOTES.md` review comment commit on the
  branch instead of a merge.
- Everything reaches protected `main` only via the rolling PR, reviewed and merged by joekookerbot.
