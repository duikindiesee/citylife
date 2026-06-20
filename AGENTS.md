# AGENTS.md — rules for coding agents working on CityLife

Read [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) first. It is the source of truth for direction.

## Architecture rules (do not break these)

- **`src/engine/` is framework-agnostic.** No React, no three.js, no DOM imports. It must run in tests (node) and, later, in a Web Worker. The renderer and UI depend on the engine, never the reverse.
- **The Game API (`src/engine/api.ts`) is the contract.** The UI, the AI governor, and the test harness all mutate the city _only_ through `GameAPI`. Change its shape deliberately.
- **All tunable numbers live in `src/engine/config.ts`.** No magic numbers in logic. Balance the sim by editing config alone.
- **Sim and render are decoupled.** The engine steps in fixed timesteps and knows nothing about frames; `CityRenderer` reads `sim.state` and never mutates it.
- **The GPU renders; the LLM runs on CPU.** Never load the model onto the GPU (it shares a 4 GB card with the renderer).
- **Round every number shown in the UI.**
- **Layer 1 before Layer 2.** The city must be watchable and self-sustaining with zero AI before adding any governance behaviour.

## AI / small-model rules

- The governor accepts **schema-validated JSON actions only** (`src/ai/schema.ts`) — never executes model-authored code. Anything a provider returns is coerced/filtered before it touches `GameAPI`.
- Keep the governor's input a **small curated digest** (`Simulation.getDigest()`), never the full grid. Small models reason far better over a digest.
- New brains implement `LLMProvider` (`src/ai/LLMProvider.ts`). The heuristic provider is the always-available fallback.

## Conventions

- TypeScript, strict mode. `npm run typecheck` must stay clean.
- Determinism: all randomness goes through the seeded `RNG`. Tests rely on it.
- Add engine/governor behaviour with a matching test in `tests/`.
- Don't introduce React-Three-Fiber/drei unless you deliberately accept the three/fiber/drei version-matrix; the renderer is intentionally plain three.js for now.

## Multi-agent lanes (Claude + Antigravity)

Two coding agents work this repo on a schedule. Read your lane before touching anything; the full
Antigravity task queue, acceptance criteria and merge flow live in
[`docs/agents/ANTIGRAVITY.md`](docs/agents/ANTIGRAVITY.md).

- **Claude** (the operator's session loop) owns branch `mechanics/dev` and the spec-077 core line.
- **Antigravity** works ONLY the queued AG tasks, each on its own branch
  `antigravity/<task-id>-<slug>` cut from the latest `origin/mechanics/dev`, pushed to origin.
  Never commit to `mechanics/dev`. `main` is PROTECTED for everyone (PRs + review only).
- Claude reviews `origin/antigravity/*` branches each loop iteration and merges green slices into
  `mechanics/dev`.

### Run + test

- Dev server: `npm run dev` → http://localhost:5188 — **5188 belongs to Claude's loop**. Antigravity
  runs its own on **5189**: `npm run dev -- --port 5189`.
- Auth bypass (dev builds only, no-op deployed): `http://localhost:5189/?skipauth=1` or
  `VITE_LOCAL_TEST=1` in `.env.local`. Never commit `.env.local`; never echo its values.
- Typecheck `npx tsc --noEmit` · tests `npx vitest run` — both must be green before every push.
- House Builder: `/builder.html?citizenId=<id>&lotId=<id>&w=<int>&d=<int>&seed=<int>[&bp=<encoded DSL>]`
  — every control carries a `data-build-action` selector; Accept posts
  `{type:'blueprint_saved', citizenId, lotId, script}` to `window.opener` (same-origin).
- Live probe: `window.__colony` (`.sim.state`, `.renderer`, `.lots()`, `.citizens`,
  `.applyBlueprint(lotId, script)`, `.builderUrl(lotId)`).

### Hard rules (both agents)

- Commit messages must be CI-SAFE: no double quotes, no brackets, no colon-bullet lines — kooker CI
  shell-interpolates the head commit message. Write the message to a temp file and `git commit -F` it.
- The blueprint compile path stays DETERMINISTIC: no Date.now, no Math.random, no wall-clock in
  `blueprintScript.ts`, `houseBuilder.ts`, `render/voxelMesh.ts` or anything they call.
- `KOOKER_GATEWAY` (the `/kooker` Vite proxy target) keeps its configured value — dev reads it from
  `.env.local`, the deploy image carries its own default. Never point it at localhost and never
  write credentials or internal cluster hostnames anywhere in this repo.

### File ownership (conflict avoidance)

- Claude-owned (Antigravity must not edit): `src/colony/runtime.ts`, `src/colony/houseBuilder.ts`,
  `src/colony/blueprintScript.ts`, `src/colony/neighborhood.ts`, `src/colony/render/*`,
  `src/colony/builder/BuilderApp.tsx`, `src/colony/builder/main.tsx`, `src/colony/bot/*`,
  `src/colony/ui/*`, `docs/specs/077-bot-house-builder.md`, `vite.config.ts` (exception: AG-2 may add
  ONE line to the rollup `input` map).
- Antigravity-owned: `tools/`, `src/gallery/`, `src/colony/builder/history.ts`, `tests/antigravity/`,
  `gallery.html`, `docs/agents/`.

## Public repository safety

- This repository is public-facing. Never commit secrets, tokens, private namespaces, internal hostnames, private preview URLs, or real personal data.
- Newcomer/household identities must be fictional, generated, and redaction-checked before being persisted or displayed.
- Store only public aliases and opaque backend references in CityLife. Internal Hermes profile names, raw SessionDB paths, and credentials stay server-side/operator-side.
- Bot communication for Phase 1 must support no-Telegram profiles; web/CLI observation should use sanitized chat/session events.
- All game-to-backend APIs must stay behind Basic Auth login plus JWT authorization; the public repo may document config keys and scopes, but never actual credentials, signing secrets, or private backend URLs.
- Keep bot lifecycle and migration mechanics behind a forkable `citylife-backend` boundary so future games can copy the pattern without copying private operator state.
