# Spec 041 — Departure Pressure: the colony can lose people, not just gain them
- status: proposed
- proposed-by: **Oren Pell, returning founder and quay tallyman of Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Oren Pell joins the roster of system-authors and names the missing half of the population loop: the colony knows how to welcome people, but not how to lose their trust.
- date: 2026-06-02
- depends-on: 004, 006, 028

## Why (the citizens' case)
Oren Pell: *"We have built a colony that knows how to welcome people, but not how to lose their trust. If a household is left hungry, sick, idle, unsafe, or unpaid long enough, they should not wait forever — they should pack what they can and take the next mooring out."*

Today population only ever **plateaus**: it climbs to housing capacity and sits there. There are a hundred reasons settlers *arrive* and almost none for them to *leave*. A colony that fails its people should feel it — homes should empty, not freeze. This is the flip side of immigration, and the core loop is half-built without it.

## Mechanic
- A pure population **dynamic** — no new building. Each **occupied home** tracks a hidden **Departure Pressure** (0..1) that reads conditions the colony already produces.
- Pressure **rises only when a home is failed for a sustained stretch** (several days): no water or food reaching it, an untreated fever, heavy unrest nearby, no work for its people, or Treasury Arrears (039) causing missed wages.
- When a home is restored to decent service, its pressure **drains back down** — so a brief storm, a one-day shortage, or a passing fever does not punish the player. Only *sustained* neglect bites.
- When a home's pressure crosses its **threshold**, that household **leaves Landing One**: the home empties (its residents are removed, population falls), and if many depart in a short window, Kookerverse **standing** (032) dips briefly (the wider world notices an exodus).
- The **Kookerverse Courier (016)** reports departures in plain language — *"Seven linen-workers left the north decks: hunger and unpaid wages"* — so the player can see *why* the colony is bleeding people.
- **Inert while homes are basically served:** a watered, fed, worked, orderly colony never builds pressure, so existing growth and its plateau are unchanged. It bites only when the colony fails its people for a real, sustained stretch.

## Rules & data
- Per-home `departure` value 0..1 (a field on the habitat, like its tier/wear), advanced each step:
  - **Rises** by `departureRisePerDay × distress` where `distress` is how badly the home is currently failed (unwatered, unfed, unhealthy/feverish, no nearby work, high unrest, or arrears strain) — summed/clamped to 0..1.
  - **Drains** by `departureDrainPerDay` whenever the home is decently served (distress below a small floor), so recovery is the default.
  - The rise must be slow enough that a home must be failed for **several days** before anyone leaves (suggest `departureRisePerDay ≈ 0.15`, threshold `1.0`, drain `≈ 0.4/day` — sustained neglect, not a bad afternoon).
- **Departure:** when `departure >= 1`, the household leaves — remove the home's residents from population, reset/empty the home, and add to a short-window departure tally; if the tally is high, apply a small one-off `exodusStandingHit` to standing.
- **Legibility:** the Courier draws a departure headline naming a plausible cause (the dominant distress term) and a rough count.
- **Test-safety:** with homes watered + fed + worked (the state existing tests set up, or short runs), `distress ≈ 0`, pressure stays at 0, and **nobody leaves** — so the suite and today's plateau behaviour are unchanged. Only a colony left failing for days emigrates.

## Cost — materials & labour
- **The dynamic itself is a rule of the world, not a structure** — like the Cloudsea Fronts (034) or smog drift (019), it has no build cost. (Per the README's spirit: it adds no free *building*; it adds a *consequence*.)
- **AVOIDING it costs materials and labour** — the water hubs, greenhouses, ration depots, clinics, markets, wards and wages (and the free colonists to staff them) that keep every home served and pressure at zero. Neglect is what is free; keeping people is what costs. The price of a failed colony is paid in lost population, idle homes, and a dip in standing.

## Acceptance
- A colony whose homes are watered, fed, worked and orderly builds **no** departure pressure and never loses people to it (inert) — existing growth and plateau behaviour, and the suite, stay green.
- A colony left **failed for several sim-days** (no food/water, or untreated fever, or deep arrears with missed wages) builds pressure and then **loses households**: population falls, homes empty, and a large exodus nicks standing.
- **Recovery works:** restoring service before the threshold drains the pressure and keeps the household — brief shortages do not punish.
- The Courier carries departure headlines naming the cause; the HUD surfaces a departures/at-risk readout.
- Tests: pressure stays 0 and nobody leaves for a served colony (inert); sustained neglect crosses the threshold and reduces population; restoring service drains pressure and prevents the departure.
