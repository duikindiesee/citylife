# Spec 032 — The Kookerverse Liaison Office: the colony answers when the world calls

- status: proposed
- proposed-by: **Mara Venn, second-shift clerk at Border Control, ledger desk 2 (Landing One)** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Mara Venn again — by now Landing One's omnipresent founder-citizen, this time at the border ledger. Opens a fresh dimension: the colony's first EXTERNAL relationship — standing and obligation with the wider Kookerverse.
- date: 2026-06-02
- depends-on: 004, 012

## Why (the citizens' case)

Mara Venn: _"Landing One should feel like a colony inside a living Kookerverse, not a sealed machine with visitors
leaking in. This is not trade for profit — it is obligation and recognition. If we want the Kookerverse to respect
Landing One, we need someone officially answering when it calls."_

## Mechanic

- A new building, the **Kookerverse Liaison Office**, raised beside Border Control or the Bank. Once built and staffed,
  the colony has a channel to the wider world — and the wider world starts to expect things of it.
- The colony gains a **Kookerverse Standing** (starts neutral). It rises and falls with how the colony answers the world.
- Every few cycles, while a Liaison Office stands, the Kookerverse issues a **Civic Request**: send a quantity of a good
  the colony makes — **linen, components, luxury reels, or food** — by a **deadline**.
  - **Fulfil** it (the goods are dispatched through the Bank) and **Standing rises**.
  - **Ignore or miss** it and **Standing falls**.
- **Standing has teeth.** High Standing is recognition: the Kookerverse sends better, more eager newcomers (immigration
  rises). Low Standing is disrepute: settlers stay away, and citizens grow restless knowing the wider world thinks
  Landing One unreliable. (The fuller vision — priority bank credit, relief shipments, reduced import fees, stricter
  border intake — is a future deepening; v1 is standing → immigration + a little reputational unrest.)
- This is the colony's first **external** stake: every other system is internal; this one ties Landing One to the
  Kookerverse it belongs to — obligation in one direction, recognition in the other.

## Rules & data

- `standing` runs 0..1, starting neutral (~0.5). A **Liaison Office** must be built + staffed for requests to arrive and
  for standing to move; without one, the colony is unranked and nothing changes (inert).
- A **Civic Request** = { good, amount, deadline }. While a staffed Liaison Office stands and no request is open, the
  Kookerverse issues one every `requestIntervalDays`; the good is one the colony produces, the amount a modest quota, the
  deadline a few days.
- **Fulfil** (a council action, and auto-fulfilled at the deadline if the colony holds the goods): deduct the requested
  good, raise `standing` by `standingReward`, clear the request. **Miss** (deadline passes unfulfilled): lower `standing`
  by `standingPenalty`, clear the request.
- **Effects (v1):** immigration desirability scales with standing (≈0.8× at zero standing → ≈1.2× at full standing); very
  low standing also feeds a little **unrest** (reputational). Standing drifts slowly back toward neutral when no Liaison
  Office stands.
- Kookerverse Liaison Office: build ~14 materials + ~12 components + ~4 reels + a build crew of 3; run 2 liaison clerks.
  _(Mara asked for a larger 8-strong office consuming linen + reels and reserving power/storage; v1 uses the colony's
  standard sizing — the bigger office and the import-fee / bank-credit favours are later refinements.)_
- **Testability / safety:** with no Liaison Office, no requests arrive and standing stays neutral, so every standing
  effect is 1.0 / zero and the founding economy and existing tests are unaffected. A request must be drivable
  deterministically (inject one, or build the office and run) so fulfilling and missing are verifiable.

## Cost — materials & labour

- To BUILD: treasury + ~14 materials + ~12 components + ~4 reels + a 3-colonist build crew.
- To RUN: 2 colonists (liaison clerks); and each **fulfilled request** dispatches a quota of goods (linen / components /
  reels / food) to the Kookerverse — real production spent on standing, not profit. Without a Liaison Office, the colony
  earns no standing and the Kookerverse asks nothing of it.

## Acceptance

- With a staffed Liaison Office, the Kookerverse issues Civic Requests on an interval; fulfilling one **spends the
  requested good and raises Standing**, missing one **lowers Standing**.
- Standing scales immigration (high draws settlers, low repels them); very low standing adds a little unrest.
- Without a Liaison Office, no requests arrive and standing stays neutral — the founding economy and existing tests are
  unchanged.
- HUD shows the Standing and any open request (good, amount, days left), with a way to fulfil it. Tests: a request can be
  fulfilled (good spent, standing up) or missed (standing down); standing scales immigration; no office → inert.
