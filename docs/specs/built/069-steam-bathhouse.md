# Spec 069 — The Steam Bathhouse: hygiene the colony can wash in

- status: built — slice 64 (mechanics/dev, PR #26); a staffed Steam Bathhouse draws stored water for a colony hygiene level that slows fever-risk buildup up to 40 percent, inert with no bathhouse, a real water demand sink; 439 tests pass, verified live on 5188
- proposed-by: Saskia Vorster, pipe-fitter and bath-keeper on the cistern lines (claude — council fallback; the kooker inference daily token quota was exhausted this tick, so the council wrote in-character)
- date: 2026-06-02
- depends-on: 046 (Stored Water — the baths draw on the cisterns), 026 (Fever Watch — hygiene is what keeps the fever from catching), 066 (Greywater Reclaimer — recycled water helps feed the baths), 006 (Housing Evolution — a washed colony is a colony that wants to better itself)

## Why (the citizens' case)

Saskia Vorster runs the pipe wrenches on the cistern lines, and she will put it plainly: the colony drinks its water and grows its food with it, but nobody washes. On old Earth a town that did not wash got sick, and that was the end of it. Landing One has a Fever Watch that chases an outbreak once it is already running through the decks, but it has nothing that keeps folk clean BEFORE the fever ever catches. A tired deckhand comes off a double shift in the mine grit and the fish slime and goes straight home to the family with no place to scrub it off. Saskia wants a steam bathhouse on the cistern line: hot water, a few attendants, and a room where the colony can wash the day off. Clean people take fewer fevers. And it gives the cisterns and the new greywater reclaimer a real daily customer instead of water that only ever goes to the greenhouses. It is the first thing the colony would build purely to STAY well rather than to get well after the fact.

## Mechanic

A new staffed **Steam Bathhouse** draws stored water each day and gives the colony a **hygiene** level between 0 and 1. Hygiene rises with how many baths the colony has against its head-count (coverage), how well the baths are staffed, whether they actually have water, and a light power load to heat it. Hygiene is **preventive**: it slows the rate at which fever risk builds up, by up to 40 percent at full hygiene, so a clean colony has fewer and milder fevers than a grimy one. It does not cure a fever already running (that is still the Fever Watch and the clinic's job) — it stops so many from starting.

The mechanic is **inert by default**. A colony that never builds a bathhouse has hygiene 0, the fever-risk buildup is multiplied by exactly 1, and the fever math is precisely what it is today. The baths are above all a **water-demand sink**: they finally give the cisterns (046) and the greywater reclaimer (066) a customer that is not a greenhouse, so a colony that wants clean people has to keep its water flowing.

To keep the slice small this spec ships ONLY the colony-wide fever-relief core. The gentle settler-confidence and housing-desirability lift a clean colony would earn, and any per-district hygiene coverage, are deferred to a later spec.

## Rules & data

- New build kind **bathhouse** (sector: health/services). Colour a warm steam-blue.
- **Hygiene level**, recomputed each day, clamped to 0..1:
  - `coverage = min(1, (bathhouses * bathServes) / max(1, colonists))`, with `bathServes = 50` colonists served per bathhouse.
  - `staffing` = the usual sector staffing fraction (free colonists against the baths' jobs).
  - `watered = water > 0 ? 1 : bathDryFloor`, with `bathDryFloor = 0.25` (a dry bathhouse is barely better than nothing).
  - `power = max(bathPowerFloor, powerFactor)`, with `bathPowerFloor = 0.5` (the boilers still throw some heat in a brownout).
  - `hygiene = coverage * staffing * watered * power` (so any one of: no coverage, no crew, no water, or no power drives hygiene toward 0).
- **Effect**: the fever-risk buildup rate is multiplied by `(1 - bathHygieneRelief * hygiene)`, with `bathHygieneRelief = 0.4`. At full hygiene (1.0) fever risk accrues 40 percent slower; at hygiene 0 the multiplier is 1 and nothing changes.
- **Water draw**: each staffed bathhouse draws `bathWaterPerDay = 3` water per day from stored water, charged the same way the greenhouses and the cellar already draw. If stored water cannot cover it, the draw takes what is there and `watered` falls to the dry-floor next day.
- Hygiene never goes below 0 or above 1. With no bathhouse it is exactly 0.

## Cost — materials & labour

- **To build**: `matBath = 35` materials, `compBath = 8` components, `toolBath = 1` tool-kit, raised by a build crew of `crewBath = 4` free colonists. Build cost in coin `bathCost = 720`.
- **To run**: `bathWorkers = 3` free colonists per bathhouse (the attendants and the boiler-hand). Draws `bathWaterPerDay = 3` stored water per day and a `bathPowerLoad = 0.3` power load. No food or goods consumed.
- Auto-build gate (same shape as the cellar and the reclaimer): only once the colony is past a small size and has water stored and a cistern, build a bathhouse when materials, components and a tool-kit are on hand and there are fewer baths than `ceil(colonists / 50)`.

## Acceptance

- **Inert without a bathhouse**: with zero baths, hygiene reads 0 and a colony's fever-risk buildup over N days is identical to the same colony before this spec (the multiplier is exactly 1). All existing tests stay green.
- **A staffed, watered bathhouse raises hygiene** and measurably **slows fever-risk buildup** versus an identical colony with no bathhouse over the same run.
- **Water gates it**: when stored water is driven to 0, hygiene falls toward the dry-floor (0.25) rather than staying high, and the bath's water draw reduces stored water each day.
- **Bounded**: hygiene is clamped to 0..1 and never negative; the relief multiplier never makes fever risk go negative.
- **HUD**: a Hygiene / Baths row appears only when at least one bathhouse exists, showing the hygiene level and the bath count; a fresh real colony shows no such row.
- **Verify**: `npm run typecheck` clean and `npm test` green with new economy tests for the cases above; live on :5188 a real colony reads no Baths row, and an injected staffed, watered bathhouse shows hygiene rising and the readout appearing, with no console errors.
