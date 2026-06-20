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

The AI decides _what_ to build or change; the review routine decides _how_ and verifies it.

## Investigation backlog

Standing items the routines should fold into their work as the world matures (the Design Council can
turn any of these into a spec; Review & Build can implement it):

- **Zoning overlay — redesign or retire.** ✅ _Done_ — built as the Civic Pulse Survey Office +
  liveability map (spec 011). Kept here as the worked example: a viewer flagged it, it was logged here,
  the Council proposed it, Review & Build shipped it. See `docs/research/2026-06-01-zoning-redesign.md`.

- **Citizen News Radio (the "Kookerverse Courier").** ✅ _v1 built_ — spec 016: a Broadcast Mast lights a
  rotating news ticker of the colony's own headlines, read deterministically from live state + the citizen
  roster. The Hermes-memory deepening (facts → the citizens' own stories) remains, awaiting persistent
  bots. Original note below. From the scrolls under the rocky mountain
  (`docs/research/2026-06-01-the-scrolls-citizen-news-radio.md`): a station the colony **builds and
  staffs** that broadcasts _news about its own citizens and events_ — who proposed what, who arrived at
  the border, which district hit Tier 3, when the reels run dry — instead of only the sponsor ads the Low
  Power Radio plays today. Turns the existing radio surface from _advertising at_ the colony to
  _reporting on_ it. **Full version depends on the memory-keeping Hermes citizens** (persistent bots, so
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
  It ties the real cost of _imagining_ the world to the world's own economy, and turns the shared daily token
  quota into a finite colony resource the way materials and labour already are. Cost: read the quota endpoint
  with the PAT each tick; a small civic ledger that converts tokens-saved into a reward, gated like every
  mechanic. **Design Council: scope a small first slice** — e.g. a _Thrift Ledger_ that ranks the recent
  generations by token cost and pays a frugality bonus to the most sparing, leaving a profligate one nothing.

- **Persistent things — saved world objects, so they can be scarce or duplicated.** Today the colony's goods
  are aggregate counters that reset each session; nothing in the world is a _thing_ that endures. Make the
  world's objects **saved** — a persistent registry of what exists, keyed by id, with a count — building on
  the existing `saveColony` / `restoreColony`. Once a thing persists with a quantity, the economy can model
  real **scarcity** (only N of a thing exist; its value rises as it runs low) and **duplication** (spend
  materials, labour, or even inference tokens — see token-thrift above — to copy an existing thing into a
  second one). It is the foundation for a genuine item economy instead of fungible piles. Cost: a saved
  thing-registry; scarcity and duplication rules gated on materials + labour like every mechanic. **Design
  Council: scope a small first slice** — e.g. one named, finite, persistable artifact that survives a reload,
  grows scarce as it is consumed, and can be duplicated for a real materials cost.

- **VISUAL-FIRST — every thing is a seen thing.** Binding standing rule, not an optional nicety: every
  material, building, tool and object is a **visual component**, declared in the one agreed format at
  `docs/specs/VISUAL-STANDARD.md` and rendered on :5188 as part of "done". Animation is a bonus. The economy
  is deep but mostly invisible — a spreadsheet wearing a beautiful island — so the **standing visual debt**
  is the Council's priority backlog, in order: (1) make STOCKPILES visible (goods render as piles that grow
  and shrink at their building); (2) make GOODS + SERVICES MOVE (a truck on the roads for bulk, a person on
  the footpaths for a service — re-use the crew-truck + pedestrian systems); (3) give each building its
  declared composite **massing**, retiring the plain coloured box. **Every new mechanic must prefer the
  visible over the invisible**, and may not ship a new thing as a bare counter.

- **A living economy, not a ledger** (`docs/research/2026-06-02-living-economy.md`). CityLife has a city's
  _economy_ but not yet a city's _life_. Caesar III felt alive because nothing teleported — goods and
  services travelled as walkers. Ours is different and better: **people on foot** carry the human economy
  (a service round, a ration drop), **cars and trucks** carry the industrial economy (a cargo run of
  materials, folios, food) — a two-tier embodied logistics, feet for people, wheels for goods, both obeying
  the water barrier. Direction: embody the stockpiles, then the flows, then the people, so every counter has
  a body on the island. **Roads + agents never cross open water** (ground physics).

- **Land organisation + terrain-aware roads** (`docs/research/2026-06-02-land-organisation-and-roads.md`).
  The old scattered named-plot pads + straight spoke roads were the wrong paradigm (Caesar-III "settler walks
  to a human-marked far plot") and ran straight over hills and water — **retired**. The replacement, grounded
  in GIS land-suitability + procedural-city research, is **planner-driven and roads-first**, in order:
  **L1** a per-cell land-type METADATA layer (a weighted overlay of slope, distance-to-water, biome, elevation
  → a 0–1 `suitability` + a `bestUse` class); **L2** a compact, **least-cost** road skeleton grown from the
  core along the best land (water an obstacle, slope a cost — never a straight line, never over open water);
  **L3** parcels enclosed by roads, **subdivided into lots** (retire the wilderness "vibe" plots — a plot is a
  lot _inside_ the settlement, placed by the planner); **L4** building massing on the lots. **Only the City
  Planner organises land**, compactly, on good ground. This is the priority spatial backlog.

- **The people ARE the citizens** (`docs/research/2026-06-02-the-people-are-the-citizens.md`). The figures on
  the streets were anonymous decorative droids, and more of them than there were colonists. They should be the
  colony's real, named Hermes citizens, living visible lives — the same voices that _design_ the world. Done:
  the visible crowd now tracks the real colonist count and the figures have heads (read as people). Priority
  people-system backlog, in order: **P2** name each figure from the roster (founders + settlers + Hermes
  proposers) — figure N is _Mara Venn_, clickable to her card; **P3** new settlers pitch a **tent** (T0) on
  their lot that grows to a house, unique tent templates ("starting off in a tent"); **P4** agency — colonists
  walk to their lot, pitch the tent, take up work, with a first job loop (fell trees → forest thins (scarcity) →
  replant → needs seeds, spec 048) and needs (rest/food/joy) gating output, the RimWorld/Dwarf-Fortress model;
  **P5** per-USER persistence — save the colony (people, homes, forest, stores) against the user account via the
  kooker backend, not just localStorage, so each operator's world is theirs and endures.

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
