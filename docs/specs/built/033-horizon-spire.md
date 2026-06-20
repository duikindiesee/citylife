# Spec 033 — The Horizon Spire: a monument the colony builds toward

- status: proposed
- proposed-by: **Mara Venn, night-shift crane tallywoman at North Storage Gantry (Landing One)** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Mara Venn once more — by now the colony's legendary builder-voice, present at every great work. Opens a fresh dimension: the colony's first long-term ASPIRATION — a grand, multi-stage monument with a lasting payoff.
- date: 2026-06-02
- depends-on: 001, 032

## Why (the citizens' case)

Mara Venn: _"Right now we only build what keeps us breathing. The Spire gives the colony a future shape. Every citizen
can watch it rise and know their wages, taxes, and sore hands are becoming something larger than survival. It should be
expensive, slow, and proud. If Landing One means to last, let it cast a shadow."_

## Mechanic

- The **Horizon Spire** is the colony's first **grand, multi-stage project** — part monument, part signal tower, part
  public hall. Not a service that does one thing; a long work the colony funds over many cycles, that every ward can
  watch rise.
- It is built in **four stages**, each a large bundle of materials + goods + treasury and a reserved crew over a long build:
  1. **Foundation Ring** — anchors driven through the island rim.
  2. **Spire Frame** — the iron-and-rimwood skeleton, visible from every ward.
  3. **Lantern Hall** — a public interior for oaths, feasts, memorials and Liaison ceremonies.
  4. **Sky Beacon Crown** — a powered beacon and Kookerverse signal array.
- The colony funds the **next stage** only when it can afford the bundle AND spare the crew (gated on labour + materials
  like any build, but far larger and slower). Stages complete one at a time; the Spire's silhouette grows.
- **The lasting payoff (permanent, once all four stages stand):**
  - the Kookerverse takes notice — **standing earned per fulfilled request rises** (the Beacon is a signal array),
  - the landmark **draws settlers faster** (a permanent immigration bonus),
  - pride in the great work gives a **permanent unrest reduction**,
  - and the Lantern Hall makes the colony's **feasts stronger** (more culture / a Founding Day).
- This is the colony's first thing **bigger than survival** — a goal to point at and say _that is what Landing One will become._

## Rules & data

- The Spire tracks a **stage** (0..4) and the **progress** of the current stage. It is **opt-in**: the colony begins (and
  continues) the Spire only when it is wealthy and established enough to spare the resources without starving its needs —
  so a struggling colony never sinks itself into a monument.
- Each stage, when started, **reserves a crew** for its long build and consumes a large bundle (≈, adapted to the colony's goods):
  - Foundation Ring: ~160 materials + ~80 components + treasury.
  - Spire Frame: ~220 components + ~120 linen + ~60 reels + treasury.
  - Lantern Hall: ~140 linen + ~170 components + ~50 reels + treasury.
  - Sky Beacon Crown: ~160 components + ~100 reels + a large treasury sum.
    Each stage takes several cycles of build time — far longer than a normal building.
- **Payoff on full completion (permanent):** standing reward × ~1.5; immigration desirability × ~1.15; a flat unrest
  relief each day (like a standing Ward Post); and the Civic Feast's culture/relief boosted.
- _(Mara's fuller materials — stone, glass, power-cells, culture goods, fine/advanced components — map onto the colony's
  existing materials / components / reels / linen for v1; new monument-grade goods are a later refinement.)_
- **Testability / safety:** the Spire is inert until the colony actually starts funding it (opt-in, gated on real
  surplus), so with no Spire underway the founding economy and existing tests are unchanged. Progress and completion must
  be drivable deterministically (advance a stage, or complete it directly) so the stage costs and the permanent payoff
  are verifiable.

## Cost — materials & labour

- To BUILD: the full four-stage bundle above — hundreds of materials, components, reels and linen, plus a treasury levy
  at the Crown — spent across the stages, each reserving a sizeable crew for several cycles. It is meant to be
  **expensive, slow, and proud**.
- To RUN: nothing ongoing once it stands — the Spire is a finished monument, not a staffed service; its payoff is
  permanent. While building, each stage ties up a crew that cannot work elsewhere.

## Acceptance

- The Spire advances stage by stage only when the colony can afford each stage's bundle and spare the crew; a struggling
  colony never starts it.
- Each completed stage deducts its bundle; the Spire's stage count rises 0 → 4.
- On full completion, the permanent payoffs apply (higher standing gain, faster immigration, a standing unrest relief,
  stronger feasts) and they persist.
- With no Spire underway, the founding economy and existing tests are unchanged.
- HUD shows the Spire's stage and progress (e.g. "Horizon Spire — Stage 2/4, 60%") and its completion. Tests: a stage
  consumes its bundle and advances; full completion grants the permanent bonuses; an unstarted Spire is inert.
