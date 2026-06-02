# Spec 034 — The Stormwatch Shelter: when the sky throws a blow
- status: proposed
- proposed-by: **Mara Venn, east-shift signal hand at the Horizon Spire (Landing One)** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Mara Venn yet again — now reading the sky from the very monument she proposed last tick; the colony's legendary everywoman, present at every great work and every watch. Opens the last unbuilt pillar: external danger — a hazard from the cloudsea the colony must brace for and weather.
- date: 2026-06-02
- depends-on: 022, 033

## Why (the citizens' case)
Mara Venn: *"Right now every disaster is our own fault. That makes the sky feel tame. Landing One should sometimes
survive something it did not cause. That is not conquest — that is respecting the sky."*

## Mechanic
- Every so often a **Cloudsea Front** rolls in from beyond the island — high wind, stone chips, broken sky-ice, a
  pressure shock. It is the colony's first **external** danger: nothing the colony did brings it; it comes from the sky.
- A new building, the **Stormwatch Shelter**, raised on the island rim — both lookout post and hardened refuge. While
  staffed, it **watches the cloudsea** and, on warning, sounds a **Brace Order**: citizens go indoors, outdoor work
  pauses, and the colony rides the blow with far less harm.
- The **Horizon Spire's Sky Beacon (033)**, if it stands, spots a front **earlier** — turning a sighting into more time
  to shelter.
- **When a front hits:**
  - **Braced** (a staffed Stormwatch sounded the order): the colony shelters — minor goods spoilage and a little extra
    wear, but people and production come through.
  - **Caught unprepared** (no shelter, or none staffed): the front bites hard — stored goods spoil, exposed buildings
    take heavy wear (the Maintenance Sheds, 022, matter more than ever), and in the worst hits production stalls.
- The point is **survival**: the colony must keep a Stormwatch crewed and its maintenance and shelter ready, because the
  sky will test it whether or not it is looking.

## Rules & data
- A **Cloudsea Front** arrives on a long interval (`frontIntervalDays`, ~several days), only once the colony is
  **established** (a real settlement, not the founding crew) — so the early game is calm. Each front has a **warning
  window** before it strikes.
- A built + **staffed Stormwatch Shelter** uses the warning window to **Brace** (automatically; the warden rings the
  alarm). A complete **Sky Beacon** lengthens the warning. Without a Stormwatch, the colony cannot organise — it takes
  the front unbraced.
- **Impact** scales with how ready the colony is. Damage = a base severity × (braced → much smaller) × (a Stormwatch
  present → smaller). It applies as a fraction of **stored goods spoiled** (materials + components) and a spike of
  **building wear** across working buildings (recovered over time by the Maintenance Sheds). Severe, unbraced hits also
  briefly stall production.
- Stormwatch Shelter: build ~14 materials + ~10 components + a build crew of 3; run 2 watchkeepers (and a warden during a
  front). *(Mara asked for timber / stone / canvas / lamps / medical kits and a 3-shift crew; v1 maps the build onto the
  colony's materials + components and standard 2-staff sizing — a richer kit is a later refinement.)*
- **Testability / safety:** fronts only begin once the colony is established and arrive on a long interval, so the
  founding economy and the **existing tests see no front** in normal short play. A front must be drivable
  deterministically (inject an incoming front, or advance to its impact) so bracing, the shelter's mitigation, and the
  unprepared damage are all verifiable.

## Cost — materials & labour
- To BUILD: treasury + ~14 materials + ~10 components + a 3-colonist build crew.
- To RUN: 2 colonists (watchkeepers) to scan and ring warnings. During a **Brace Order** outdoor work pauses and
  production dips for the duration — the price of sheltering. Without a Stormwatch, fronts hit unbraced: spoiled goods,
  battered buildings, and lives at risk.

## Acceptance
- A Cloudsea Front periodically strikes an established colony; a **braced** colony (staffed Stormwatch) takes far less
  damage than an **unprepared** one (goods spoilage + building wear, much higher when caught out).
- A staffed Stormwatch braces automatically in the warning window; the Spire's Sky Beacon lengthens that window.
- No front strikes in early / short play, and with no front active the mechanic is inert — the founding economy and
  existing tests are unchanged.
- HUD shows the cloudsea watch (next front / incoming / bracing) and the Stormwatch's readiness. Tests: a front damages
  an unbraced colony (goods + wear); a staffed Stormwatch braces and cuts the damage sharply; an injected front is the
  test hook; early play sees none.
