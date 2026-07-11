# Spec 117 — Animated Tarentaal GLB Flocks

**Status:** proposed
**Lane:** World & Build

## Why

The deterministic tarentaal flock already exists in simulation, but adults and chicks render as plain sphere instances. The flock should read as recognizable guinea fowl with visible gait and chase behavior while retaining deterministic sim-owned placement.

## Mechanic

- Adult and chick meshes are authored as separate deterministic GLB assets.
- Each asset exposes three clips: idle, walk, and chase.
- The renderer loads both templates once, clones one lightweight scene per sim bird, and owns presentation-only `AnimationMixer` state.
- Position, heading, age, and behavior continue to come exclusively from `ColonySim.state.tarentaal`.
- Adults and chicks select walk during forage/follow and chase during chase bursts.
- Existing primitive instancing remains visible until both GLBs load and remains the fallback if loading fails.

## Visual identity

- Adults: charcoal/slate body, blue head and neck, red wattle, golden beak and legs.
- Chicks: smaller warm-brown body, softer proportions, no adult wattle.
- Both have articulated heads, wings, and alternating legs.

## Determinism and safety

- No `Math.random()` or `Date.now()` in generation, simulation, or placement.
- GLBs contain geometry and presentation clips only; they do not choose world positions.
- Existing public-safe flock records and land constraints remain unchanged.

## Assets

- `/assets/citylife/wildlife/tarentaal-adult.glb`
- `/assets/citylife/wildlife/tarentaal-chick.glb`
- Rebuild with `node scripts/generate_tarentaal_flocks.mjs`.

## Acceptance

- [ ] Generator deterministically emits valid adult and chick GLB v2 files.
- [ ] Both files contain idle, walk, and chase clips.
- [ ] Seed 4242 still exposes four adults and six chicks from sim state.
- [ ] Browser proof shows ten individual GLB birds and zero primitive fallback instances after load.
- [ ] Each live bird reports a walk or chase action matching sim behavior.
- [ ] Focused Vitest, typecheck, Playwright, build, and full test suite pass.
