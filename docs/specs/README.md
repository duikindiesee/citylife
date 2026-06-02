# Kookerverse self-design pipeline

CityLife's **game mechanics** are now designed by the world's own AI citizens and built by a review
routine. Two goal-framed routines run every 20 minutes:

1. **Design Council** — Hermes citizens (via the kooker inference choke point) propose **one
   game-mechanic specification** they want added to the world, written to `proposed/`. Each spec must
   account for what it **costs in materials and labour** (the Caesar III model: nothing is free, and
   buildings need people). Prefer a live Hermes proposal; fall back to an in-character proposal when
   the inference is unavailable.

2. **Review & Build** — reads `proposed/`, picks the most **foundational, unbuilt** spec, implements
   it as real mechanics (engine code + tests) in the worktree, verifies (`typecheck` + `test` + a
   live screenshot on :5188), opens/updates a PR, and moves the spec to `built/`. It must **never
   break the build** and must keep construction gated on labour + materials (no random pop-ups).

The AI decides *what* to build or change; the review routine decides *how* and verifies it.

## Investigation backlog
Standing items the routines should fold into their work as the world matures (the Design Council can
turn any of these into a spec; Review & Build can implement it):

- **Zoning overlay — redesign or retire.** ✅ *Done* — built as the Civic Pulse Survey Office +
  liveability map (spec 011). Kept here as the worked example: a viewer flagged it, it was logged here,
  the Council proposed it, Review & Build shipped it. See `docs/research/2026-06-01-zoning-redesign.md`.

- **Citizen News Radio (the "Kookerverse Courier").** ✅ *v1 built* — spec 016: a Broadcast Mast lights a
  rotating news ticker of the colony's own headlines, read deterministically from live state + the citizen
  roster. The Hermes-memory deepening (facts → the citizens' own stories) remains, awaiting persistent
  bots. Original note below. From the scrolls under the rocky mountain
  (`docs/research/2026-06-01-the-scrolls-citizen-news-radio.md`): a station the colony **builds and
  staffs** that broadcasts *news about its own citizens and events* — who proposed what, who arrived at
  the border, which district hit Tier 3, when the reels run dry — instead of only the sponsor ads the Low
  Power Radio plays today. Turns the existing radio surface from *advertising at* the colony to
  *reporting on* it. **Full version depends on the memory-keeping Hermes citizens** (persistent bots, so
  Mara / Bram / Niko / Lys / Ravi accumulate a story to tell). A **deterministic v1** can ship sooner,
  read from the spec queue + live `ColonyState` events. Cost: build + staff a Broadcast Mast (materials +
  components + a crew). Off until built.

- **Token-thrift — the inference budget becomes an in-world value.** Every thing the world dreams up (a
  citizen's proposal, a spec, a daily card) is generated through the kooker inference choke point, which
  meters tokens per user — watchable at `GET /api/v1/ai/inference/quotas/borderpatrol@citylife.local` with
  the CityLife PAT (`tokensToday` vs the daily limit, lately raised from the 50k default to 1M/day). Make
  that meter an in-world economic signal: **reward the citizens and sellers who create or sell a thing for
  the FEWEST inference tokens.** Token-thrift becomes a colony virtue the council pays for — the colonist
  who proposes a mechanic in 200 tokens earns more standing (and coin) than one who burns 2000 for the same.
  It ties the real cost of *imagining* the world to the world's own economy, and turns the shared daily token
  quota into a finite colony resource the way materials and labour already are. Cost: read the quota endpoint
  with the PAT each tick; a small civic ledger that converts tokens-saved into a reward, gated like every
  mechanic. **Design Council: scope a small first slice** — e.g. a *Thrift Ledger* that ranks the recent
  generations by token cost and pays a frugality bonus to the most sparing, leaving a profligate one nothing.

- **Persistent things — saved world objects, so they can be scarce or duplicated.** Today the colony's goods
  are aggregate counters that reset each session; nothing in the world is a *thing* that endures. Make the
  world's objects **saved** — a persistent registry of what exists, keyed by id, with a count — building on
  the existing `saveColony` / `restoreColony`. Once a thing persists with a quantity, the economy can model
  real **scarcity** (only N of a thing exist; its value rises as it runs low) and **duplication** (spend
  materials, labour, or even inference tokens — see token-thrift above — to copy an existing thing into a
  second one). It is the foundation for a genuine item economy instead of fungible piles. Cost: a saved
  thing-registry; scarcity and duplication rules gated on materials + labour like every mechanic. **Design
  Council: scope a small first slice** — e.g. one named, finite, persistable artifact that survives a reload,
  grows scarce as it is consumed, and can be duplicated for a real materials cost.

## Spec queue location

The canonical queue lives **outside the repo** at `D:\infra\projects\citylife-specs\{proposed,built}\`
so it survives branch switches, and is mirrored here under `docs/specs/` for the version-controlled
record.

## Spec format

```md
# Spec NNN — <Title>
- status: proposed | building | built
- proposed-by: <Hermes citizen name / model, or "claude (fallback)">
- date: <ISO date>
- depends-on: <spec ids, or none>

## Why (the citizens' case)
What the citizens want and the in-world justification.

## Mechanic
The rule in plain language.

## Rules & data
Concrete numbers: rates, thresholds, capacities.

## Cost — materials & labour
What it consumes to build and to run (materials units, free colonists required).

## Acceptance
How the Review & Build routine verifies it works (tests + what to see on :5188).
```
