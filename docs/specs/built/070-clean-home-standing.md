# Spec 070 — The Clean-Home Standing: a washed colony draws settlers and lifts its homes

- status: built — slice 65 (mechanics/dev, PR #26); hygiene (069) becomes two positive inert-by-default levers, hygieneDesirabilityFactor (+10 percent settler draw) and hygieneEvolutionFactor (8 percent faster housing climb), no new building, the Hygiene HUD row shows the draw lift; 444 tests pass, verified live on 5188
- proposed-by: Marlo Venter, housing warden who assigns the homes and walks the lanes welcoming newcomers (claude — council fallback; the kooker inference daily token quota was exhausted this tick, so the council wrote in-character)
- date: 2026-06-02
- depends-on: 069 (Steam Bathhouse — this is the clean-colony payoff that spec explicitly deferred; it reads the hygiene level the baths produce), 006 (Housing Evolution — the homes this gently speeds up the ladder), 049 (Settler Confidence — the reputation this lifts), 063 (Planter Square — the positive-desirability pattern this mirrors)

## Why (the citizens' case)

Marlo Venter assigns the homes and walks the lanes every morning, and since the baths went in he has felt the change underfoot: the decks are cleaner, the air by the homes is fresher, the children come to the door scrubbed instead of grimed. But on the books nothing has changed. The Steam Bathhouse keeps the fever down, and that is good, but a clean colony should be a colony people WANT to come to and a place where a family feels proud enough to better their home. Marlo has seen it the other way on the old stations: filthy lanes and folk who stop caring, homes that never improve and newcomers who turn around at the dock. Spec 069 said as much and set the question aside for later. Marlo says later is now: let the cleanliness the baths already buy show up where it matters, in homes that climb a little faster and a reputation that draws a few more settlers. He is not asking for a new building. He is asking that the work the bath-keepers already do count for something more than fewer fevers.

## Mechanic

The colony's **hygiene** level (0..1, produced by the Steam Bathhouses, spec 069) becomes a small **positive** input to two existing systems:

1. **Housing desirability / settler draw.** A clean colony is a touch more desirable: hygiene lifts the same liveability/draw the Planter Squares (063) feed and the Variety Diet (060) feeds, so a washed colony pulls settlers a little better.
2. **Housing evolution.** Served homes in a clean colony climb the housing ladder a touch faster, the way a Varied Diet (060) already nudges them up — cleanliness is one more thing a home needs to feel worth bettering.

Both effects are **purely positive and inert by default**. A colony that never builds a Bathhouse has hygiene 0, both factors are exactly 1, and its draw and its housing evolution are precisely what they are today — no new penalty falls on the old colony. This mirrors the smog mechanic (019) in reverse: smog is a negative spatial gate on the top tier, hygiene is a positive health lift. And the cost is ongoing: the lift only lasts while the baths stay staffed and watered — let hygiene lapse (crew pulled, tanks dry) and the clean-home standing fades back to nothing with it.

## Rules & data

- Reuse the existing `hygieneLevel(state)` (0..1) from spec 069. No new building, no new good, no new stored resource.
- **Desirability factor** `hygieneDesirabilityFactor(state) = 1 + hygieneDesirabilityGain * hygieneLevel(state)`, with `hygieneDesirabilityGain = 0.10` (at full hygiene, +10 percent to the same desirability/draw term the Planter and Variety levers already multiply; at hygiene 0 the factor is 1). Fold it in alongside `planterDesirabilityFactor` / the variety draw, the same way those positive levers already combine.
- **Evolution factor** `hygieneEvolutionFactor(state) = 1 + hygieneEvolutionGain * hygieneLevel(state)`, with `hygieneEvolutionGain = 0.08` (served homes climb up to 8 percent faster at full hygiene). Apply it the same place the Variety Diet evolution bonus (060) is applied — it only ever SPEEDS the climb, it never forces a tier and never blocks or demotes one.
- Both factors are gentle and bounded (hygiene is already clamped 0..1, so the desirability factor sits in [1, 1.10] and the evolution factor in [1, 1.08]). Tune the two gains to sit in line with the existing positive levers (063 / 060) so no single lever dominates.
- With no Bathhouse: `hygieneLevel` is 0, both factors are 1, everything is unchanged.

## Cost — materials & labour

This spec adds **no new building** — it is the payoff on the Steam Bathhouses (069) the colony already raises and staffs. The materials and labour are therefore the baths themselves: each Bathhouse costs 35 materials + 8 components + 1 tool-kit to build (raised by a crew of 4) and runs on 3 free colonists plus about 3 water a day and a light power load. The clean-home standing is not free: it exists only while those baths are built, crewed and watered. A colony that lets its bath crews drift to other work, or lets the cistern tanks run dry, watches hygiene fall and the draw-and-evolution lift fade with it. So the standing buys a real, ongoing labour-and-water commitment, exactly the Caesar III bargain — the bonus lasts only as long as the people keep the service running.

## Acceptance

- **Inert without a Bathhouse**: with hygiene 0, `hygieneDesirabilityFactor` and `hygieneEvolutionFactor` both read exactly 1; an existing colony's settler draw and housing evolution over a long run are identical to before this spec, and all existing tests stay green.
- **A clean colony draws better**: an identical pair of colonies, one with a staffed, watered Bathhouse (hygiene high) and one with none, the clean one shows a higher desirability/draw factor.
- **A clean colony's homes climb sooner**: with the same services and food, served homes in the clean colony reach the top tier a touch faster than in the grimy one (never the reverse, and the grimy one is never pushed DOWN).
- **The lift fades when hygiene lapses**: pull the bath crew or empty the tanks and both factors fall back toward 1.
- **Bounded**: neither factor exceeds its small ceiling (1.10 desirability, 1.08 evolution) however high hygiene goes.
- **Verify**: `npm run typecheck` clean and `npm test` green with new economy tests for the cases above; live on :5188 a bathhouse-less colony is unchanged, and an injected clean colony shows the higher desirability/draw with no console errors.
