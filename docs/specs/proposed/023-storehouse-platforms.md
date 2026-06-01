# Spec 023 — Storehouse Platforms: finite storage, or the surplus goes overboard
- status: proposed
- proposed-by: **Mara Venn, maintenance clerk on B-shift (Landing One)** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Mara's 11th spec; she has become the colony's infrastructure conscience — water, battery sheds, maintenance, and now storage. Opens a fresh dimension: storage / logistics capacity.
- date: 2026-06-02
- depends-on: 001, 003

## Why (the citizens' case)
Mara Venn: *"I'm tired of 'infinite stock' hiding bad planning. Right now the mines, workshops, farms and the
foundry can overproduce forever with no consequence — that makes shortages too sudden and surpluses
meaningless. Give us **Storehouse Platforms** with real limits. If Landing One makes more than it can store,
Landing One loses it — spilled overboard, spoiled, or written off as damaged stock. Then buffer space before a
crop dip, a reel-demand spike, an export run or a repair surge actually matters."*

## Mechanic
- Today every resource (materials, components, food, reels) sits in an **infinite global pool**. This spec
  gives each one a **storage capacity**: the founders' dropship hold, plus whatever **Storehouse Platforms**
  the colony raises.
- When production, trade or training would push a resource **above its cap**, the excess is **lost** — clamped
  to the cap each step. Overproduction is no longer free; you must build storage ahead of a surplus or watch it
  go overboard.
- Storage is **colony-wide capacity** (v1), not per-tile. It is a *logistics* mechanic, not another
  radius-coverage service — the first thing that makes "how much can we hold?" a real question.
- (Mara's fuller vision — player-set per-resource splits, and unstaffed stores that move stock slowly and lose
  more — is a future deepening; v1 is a flat per-resource cap that each platform raises.)

## Rules & data
- Each stockpiled resource has a cap = a generous **base hold** + `#storehouses × perStorehouse`:
  - materials: base ~120, +~80 per platform
  - components: base ~80, +~60 per platform
  - food: base ~80, +~60 per platform
  - reels: base ~40, +~30 per platform
- After each production / trade / training step, clamp every resource to its cap; the overflow is discarded.
- **The base hold must be generous enough that the founding economy is never strangled** — the cap should only
  bite once the colony is genuinely industrialising and running a real surplus. (Early-game production must be
  unaffected; existing behaviour and tests should not change until a stockpile is pushed near its cap.)
- Storehouse Platform: build ~18 materials + ~10 components + a build crew of 3; run 2 stock-keepers (to log,
  stack, guard and rotate); ~0.5 components/day in logistics upkeep. One platform raises every resource's cap.
- *(Mara asked for a 60-material, 12-worker, 400-unit platform; v1 uses the colony's standard service sizing —
  a bigger platform and player-set per-resource splits are later refinements.)*

## Cost — materials & labour
- To BUILD: treasury + ~18 materials + ~10 components + a 3-colonist build crew.
- To RUN: 2 colonists (stock-keepers) + ~0.5 components/day. Without storage, a colony that out-produces its
  hold loses the surplus — so growth in industry must be matched by growth in storage.

## Acceptance
- A colony producing past a resource's cap **stops gaining** that resource (it clamps and the surplus is lost);
  raising a Storehouse Platform increases the cap and lets the colony stockpile more.
- Overflow is genuinely discarded: a full stockpile that keeps producing stays at the cap and never exceeds it.
- The base hold is generous enough that the early/founding economy and the existing tests are unaffected.
- HUD shows storage fill (e.g. the most-full resource, or per-resource X / cap) and warns when a store is
  overflowing. Tests: a resource clamps at its cap; a Storehouse raises the cap; overflow is discarded; the
  founding economy stays under cap with no behaviour change.
