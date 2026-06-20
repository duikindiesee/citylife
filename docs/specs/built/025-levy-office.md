# Spec 025 — The Levy Office: money finally gets a lever

- status: proposed
- proposed-by: **Jory Pell, junior ledger-clerk at Storehouse Platform C, second shift (Landing One)** — **LIVE Hermes** (model hermes-codex-gpt-5.5). A NEW citizen voice — the council's 9th — and fittingly one who works _at_ Mara Venn's storehouses (023). Opens a fresh dimension: fiscal policy, and the colony's first settable rate.
- date: 2026-06-02
- depends-on: 001, 004

## Why (the citizens' case)

Jory Pell: _"Right now the treasury feels like weather — it happens to us. A levy makes it a choice. Do we squeeze
Landing One to build fast, or keep the dues gentle so people keep coming? But please — if the council is going to
take money from our kitchens, make them hire someone to count it properly."_

## Mechanic

- A new building, the **Levy Office** — a staffed civic desk. Once it is built and staffed, the council can set a
  colony-wide **levy rate**: **low**, **normal**, or **high**. Without an office there is no levy, and the colony
  runs on today's flat income.
- The rate is a genuine tradeoff:
  - **Low** — gentle dues: the treasury grows slowly, but settlers like Landing One more (immigration rises, homes
    climb their tiers more readily).
  - **Normal** — steady: today's income, no mood change.
  - **High** — squeeze: a much fatter treasury for big works (bridges, clinics, scrubbers, repairs), but the colony
    grows less attractive and settlers slow to a trickle (and the unhappiest families may drift away).
- This is the colony's **first settable policy** — money stops being weather and becomes a lever the council pulls.

## Rules & data

- `levyRate` ∈ {low, normal, high}, default **normal**. It only takes effect while a **staffed Levy Office** stands.
- Daily income is scaled by a **levy income factor**: low ≈ 0.65×, normal 1.0×, high ≈ 1.5×.
- Immigration desirability is scaled by a **levy desirability factor**: low ≈ 1.25×, normal 1.0×, high ≈ 0.7×
  (a high levy makes the colony less attractive; a gentle one more).
- (Jory's fuller vision — a high levy stalling poorer homes and prompting unhappy families to emigrate, and one
  office per district vs a single central office at reduced efficiency — is a future deepening; v1 is a single
  colony-wide rate gated on one staffed office.)
- Levy Office: build ~14 materials + ~10 components + ~2 reels + a build crew of 3; run 2 clerks; a trickle of
  components for ledgers. _(Jory asked for 6 clerks including 2 academy-trained administrators; v1 uses the colony's
  standard 2-clerk service sizing — skilled administrators are a later refinement.)_

## Cost — materials & labour

- To BUILD: treasury + ~14 materials + ~10 components + ~2 reels + a 3-colonist build crew.
- To RUN: 2 colonists (clerks) + a trickle of components (ledger supply). Without a Levy Office the council cannot
  levy at all — money stays weather.

## Acceptance

- With a staffed Levy Office and the rate set **high**, the colony earns more treasury per day but immigration slows;
  set **low**, it earns less but settlers arrive faster; **normal** matches today's economy.
- Without a Levy Office, the rate has no effect — income and immigration are exactly as before.
- The rate is settable at runtime (e.g. `window.__colony.setLevy('low'|'normal'|'high')`) and shown in the HUD with
  the current setting.
- The founding economy is unchanged at the default (normal rate / no office), so existing behaviour and tests stay
  green. Tests: a high levy raises daily treasury income vs a low one (with an office); the levy desirability factor
  moves immigration the opposite way; with no office the rate is inert.
