# Spec 016 — The Kookerverse Courier: the colony speaks

- status: built
- proposed-by: **Echo Marlow, signal-herald** — live Hermes returned empty (upstream still dark), written in-character. Straight from the scrolls under the rocky mountain (`docs/research/2026-06-01-the-scrolls-citizen-news-radio.md`), logged by the operator.
- date: 2026-06-01
- depends-on: 011

## Why (the citizens' case)

Echo Marlow: _"The scrolls under the mountain said it plain — a city that listens must also speak. We
built the survey office to SEE ourselves; now give me a **Broadcast Mast** and I'll TELL the colony its
own story. Who came through the border, whose district reached the grand tier, when the reels ran dry at
the theatres. Not sponsors shouting from far-off rocks — our own news, read aloud. And when the citizens
keep their memories, the tales will only get richer."_

## Mechanic

- New building **Broadcast Mast** (the _Kookerverse Courier_). Once **built and staffed**, it broadcasts a
  rotating bulletin of **headlines about the colony itself** — turning the Low Power Radio (`radio.ts`)
  from sponsor ads into _our own news_.
- **v1 headlines are deterministic**, generated from live `ColonyState` + the built-spec roster — no
  Hermes memory needed yet:
  - **events**: a district reaching Tier 3, reels running dry while theatres stand, a treasury milestone,
    population crossing a round number, a new building raised, a settler cleared at the border;
  - **citizens**: the named proposers and what they shipped — _"Mara Venn's Water Hub opens across the
    flats," "Bram Teel's Exchange ships the first surplus," "Niko's foundry weaves its first reel."_
- The Courier is **off until the mast is built**, and **silent unless staffed** (no operators, no news).
- **Future deepening (the scroll's true promise):** when the Hermes citizens keep their memories, the
  headlines grow from facts into the citizens' own evolving stories.

## Rules & data

- Build cost: treasury + **~16 materials + ~12 components** + a build crew of 3.
- Run: **2 operators** (an unstaffed mast is silent).
- Headlines rotate on a timer (reuse the Low Power Radio's ~90 s ad cadence); pick from the set of
  _currently-true_ headlines for the colony's live state. No new resource.

## Cost — materials & labour

- To BUILD: treasury + ~16 materials + ~12 components + a 3-colonist build crew.
- To RUN: 2 colonists (an unstaffed mast broadcasts nothing).

## Acceptance

- Building + staffing a Broadcast Mast turns on the Courier: the radio surface shows rotating headlines
  about the colony's own citizens and events, not only sponsor ads. No mast → no Courier.
- Headlines reflect **real game state** — a T3 district when one exists, "reels out" when reels = 0 and
  theatres stand, a named proposer and what they built.
- Tests: the headline generator produces colony-true lines from state (includes a T3 district when there
  is one; names a proposer; reports reels-out only when reels = 0 and a theatre exists); the Courier is
  unavailable without a built, staffed mast.
