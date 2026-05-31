# AGENTS.md — rules for coding agents working on CityLife

Read [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) first. It is the source of truth for direction.

## Architecture rules (do not break these)
- **`src/engine/` is framework-agnostic.** No React, no three.js, no DOM imports. It must run in tests (node) and, later, in a Web Worker. The renderer and UI depend on the engine, never the reverse.
- **The Game API (`src/engine/api.ts`) is the contract.** The UI, the AI governor, and the test harness all mutate the city *only* through `GameAPI`. Change its shape deliberately.
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

## Public repository safety
- This repository is public-facing. Never commit secrets, tokens, private namespaces, internal hostnames, private preview URLs, or real personal data.
- Newcomer/household identities must be fictional, generated, and redaction-checked before being persisted or displayed.
- Store only public aliases and opaque backend references in CityLife. Internal Hermes profile names, raw SessionDB paths, and credentials stay server-side/operator-side.
- Bot communication for Phase 1 must support no-Telegram profiles; web/CLI observation should use sanitized chat/session events.
- All game-to-backend APIs must stay behind Basic Auth login plus JWT authorization; the public repo may document config keys and scopes, but never actual credentials, signing secrets, or private backend URLs.
- Keep bot lifecycle and migration mechanics behind a forkable `citylife-backend` boundary so future games can copy the pattern without copying private operator state.
