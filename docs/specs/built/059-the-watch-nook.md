# Spec 059 — The Watch Nook: a rich colony keeps honest lamps burning

- status: built — slice 54 (mechanics/dev, PR #26). Petty theft bleeds a rich and populous colony, inert below dual floors (treasury 500, 25 colonists) and during any crisis; one staffed Watch Nook cuts the loss sharply, a second stops it. Engine in src/colony with five economy tests.
- proposed-by: Mara Venn, lamp-watch captain (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 025 (the levy / treasury), 040 (Prosperity), 034 (Cloudsea Fronts — theft hides during storms), 017 (brownout — and during shortages). The colony's first crime/security pillar.

## Why (the citizens' case)

Mara Venn walks the dark gantries behind the granaries with a lamp, and lately she has noticed what prosperity brought along with it. Landing One has grown rich — the treasury piles up, the markets bustle, the Census Hall reads a high Prosperity rank — and nobody checks the unlit corners. This is not rebellion; the colony is calm enough. It is the quiet kind of loss that always finds a wealthy, careless place: a few coins skimmed from the takings, a forged supply chit, a crate of tools that simply walks off. A poor or small colony has nothing worth taking and feels none of it. But a fat, unguarded one bleeds a little every season — and the only cure is the oldest one there is: keep an honest lamp burning and a watchkeeper on the round.

## Mechanic

- **Petty theft** begins only once the colony is **both rich and populous**: treasury above `theftTreasuryFloor` (suggest **500**) **and** at least `theftPopFloor` (suggest **25**) colonists. Below either line — a poor, small or young colony — there is **no theft at all**.
- When it applies, **unguarded treasury loses a small trickle** — on the order of **1-2 denarii per 100 held per season**, **capped** at `theftCapPerSeason` (suggest **25**) so even a vast hoard only ever loses a little.
- **It can never create debt (load-bearing):** theft is clamped so it can never push the treasury below 0 — at most it takes what coin is actually there above zero. A colony cannot be bankrupted or driven into arrears (039) by thieves.
- **Thieves lie low in a crisis:** **no theft during a storm** (an active/incoming Cloudsea Front, 034) **or a shortage** (a brownout, 017, or an empty larder) — the colony is watching the skies and the stores then, and the gantries are busy.
- **A Watch Nook ends it:** one **built and staffed** Watch Nook cuts the theft by ~**80%**; **two or more reduce it to zero**. Honest lamps and a keeper on the round are the whole answer.
- **Inert by default (load-bearing):** below either floor (and in every crisis), theft is **exactly zero**, so a young, small or modest colony — and every existing test, which rarely sits both rich and populous and never runs a wealthy colony for long — sees the treasury behave precisely as today. The mechanic only ever wakes in a fat, unguarded city.

## Rules & data

- New per-period (or per-day) **theft** drawn from the treasury, gated on `state.treasury > theftTreasuryFloor && state.colonists >= theftPopFloor`. Suggested implementation: a slow daily trickle so it does not need a season-boundary hook —
  - `theftPerDay = min(state.treasury * theftRatePerDay, theftCapPerDay)` with `theftRatePerDay ≈ 0.00017` (~1.5% of treasury per ~90-day season) and `theftCapPerDay ≈ 0.28` (~25/season),
  - times the **watch factor** `max(0, 1 - watchSuppressionPerPost * staffedWatchNooks)` (suggest `watchSuppressionPerPost = 0.8`, so 1 Nook → x0.2, 2 → x0),
  - **zeroed** when `inBrownout(state)`, a Cloudsea Front is active/incoming (034), or the colony is in a food shortage,
  - then `state.treasury = Math.max(0, state.treasury - theftPerDay)` so it can never go negative.
- New building **Watch Nook** (`watchnook`): a small staffed security post, **2 watchkeepers**, a tiny power load, built on labour + materials. Two staffed Nooks suppress theft entirely; a sensible auto-build gate raises one once the colony is wealthy, populous and unguarded.
- Expose a **security/theft** readout for the HUD: whether theft is active, the (small) loss rate, and the Watch Nook count.

## Cost — materials & labour

- **Build the Watch Nook:** Mara's timber, cloth and a tool map to a modest **materials + components** cost (suggest ~**12 materials + 2 components**), staffed by **2 free colonists** (the watchkeepers), paid normal wages (029). No new good, no upkeep beyond wages.
- **Runs on:** labour. Two keepers on the round are two fewer hands in the farms or workshops — a rich colony pays for its honesty in people, and a sprawling wealthy city may want a second Nook to stamp theft out entirely.
- The deeper, intended cost is a **gentle tax on carelessness**: the bigger the unguarded hoard, the more it bleeds, so prosperity finally has a soft predator that only vigilance answers — exactly the Caesar III tension between a fat treasury and the cost of keeping it.

## Acceptance

How Review & Build verifies it:

- `npm run typecheck` clean and `npm test` fully green. The mechanic must be **inert below the floors and in crises** — the treasury is unchanged, so every current test still passes (calibrate the floors/rate so no existing test, none of which runs a rich+populous colony long, ever loses coin). New tests covering:
  1. **Inert (poor or small):** a colony below the treasury floor, or below the population floor, loses **no** treasury to theft over a run.
  2. **Theft above the floors:** a rich, populous, **unguarded** colony's treasury falls a little over time with no Watch Nook.
  3. **Never debt:** theft never drives the treasury below 0 (set a small positive treasury just over the floor and confirm it never goes negative).
  4. **A Watch Nook suppresses it:** one staffed Watch Nook cuts the loss sharply; two (or more) stop it entirely.
  5. **Crisis pause:** during a brownout / storm / shortage, a rich unguarded colony loses **no** treasury to theft.
- On the live game (:5188): let a colony grow rich and populous with no watch and watch a small treasury bleed and a **Watch** HUD readout flag it; build and staff a Watch Nook and watch the bleed shrink, a second one end it.
