# Spec 072 — The Skydeck Gallery: the colony's renown becomes coin

- status: proposed
- proposed-by: Pieter Lourens, mooring-hand who waves the Kookerverse skiffs in and watches the travellers gawk at the colony (claude — council fallback; the kooker inference daily token quota was exhausted this tick, so the council wrote in-character)
- date: 2026-06-02
- depends-on: 011 (the liveability map — the colony's beauty this finally sells), 063 (Planter Square — the gardens visitors come to see), 033 (Horizon Spire — a finished monument is the marquee draw), 040 (Census Hall / Prosperity — a renowned colony draws more), 064 (Market Stall — the domestic-coin pattern this mirrors)

## Why (the citizens' case)
Pieter Lourens minds the visitors' mooring, and every week he waves in another Kookerverse skiff of travellers who came a long way just to stand on the deck and stare — at the gardens, at the great Spire, at the lantern-lit homes climbing their tiers. They take their pictures, they marvel, and then they leave, and the colony never earns a coin from any of it. Pieter's point to the council is simple: the colony has spent years making itself beautiful — the Planter Squares, the clean homes, the monument, the liveability the Survey Office measures — and all of it pulls people in, but none of it pays. Landing One sells its folios and its linen abroad, it taxes its own people, but it has never once charged for the one thing it is most famous for: being a place worth seeing. He wants a proper gallery on the mooring deck — a viewing hall with guides — so the travellers who already come can pay to come, and the colony's good name finally turns into coin in the treasury.

## Mechanic
A new staffed **Skydeck Gallery** earns the colony **visitor coin** each day, drawn from Kookerverse travellers who come to see a renowned colony. The takings scale with how worth-seeing the colony actually is: its **liveability** (spec 011) is the core draw, lifted further if the **Horizon Spire** stands finished (a marquee attraction) and gently by the colony's **Prosperity** standing (renown brings more skiffs). A drab, smoggy, low-liveability colony draws almost no one and earns almost nothing; a beautiful, renowned one with a finished monument earns well. The Gallery must be **staffed** to open — unguided halls take no fares — so the income is real labour for real coin, like the Market Stall (064) but paid by visitors for the *experience* of the colony rather than by selling any good.

It is the first income the colony earns purely for being a good place to live, and it closes a loop the world has been missing: every coin spent on Planter Squares, on clean homes, on the Spire, on keeping the smog down has so far only ever drawn settlers — now it also pays its own way.

The mechanic is **inert by default**: a colony that never builds a Gallery earns no visitor coin and its treasury is exactly as today. Nothing about the existing economy changes until a Gallery stands.

## Rules & data
- New build kind **gallery** (sector: trade — it is an earner, like the Exchange and the Market Stall). Colour a warm lookout-amber.
- **Visitor coin per day** = `galleryVisitorCoin * appeal * staffing * galleries`, where:
  - `galleryVisitorCoin = 30` coin/day is a single full-house Gallery's take at full appeal.
  - `appeal = clamp01(colonyLiveability(state))` — the core draw (0 when the colony is grim, 1 when it is lovely), lifted by `+ (spireComplete ? gallerySpireBonus : 0)` with `gallerySpireBonus = 0.25`, and by `+ galleryProsperityBonus * prosperityScore01` with `galleryProsperityBonus = 0.15` (renown), then clamped to a sane ceiling of about 1.4.
  - `staffing` = the usual sector-staffing fraction (an unstaffed Gallery earns nothing).
- The coin is added to the treasury each day the same way the Market Stall's takings are. No good is consumed.
- **Inert by default**: with no Gallery, no visitor coin is earned and the treasury math is unchanged.

## Cost — materials & labour
- **To build**: `matGallery = 40` materials, `compGallery = 12` components, `toolGallery = 1` tool-kit (the viewing rails, the display cases), raised by a build crew of `crewGallery = 5` free colonists. Treasury cost `galleryCost = 900`.
- **To run**: `galleryWorkers = 4` free colonists (the guides and the curator) and a `galleryPowerLoad = 0.4` grid load for the lights and the lifts. No water, no food, no goods drawn — the Gallery sells the view, not a thing.
- The ongoing cost is the labour: four colonists minding the Gallery are four not mining, farming or weaving, so a colony leans on visitor coin only when it can spare the hands.

## Acceptance
- **Inert without a Gallery**: a colony with no Gallery earns no visitor coin and its treasury over a long run is identical to before this spec; all existing tests stay green.
- **A renowned colony earns**: a staffed Gallery in a high-liveability colony adds coin to the treasury each day, and a staffed Gallery in a grim, low-liveability colony earns far less (the take scales with the colony's appeal).
- **A finished Spire lifts the take**: the same colony earns more visitor coin with the Horizon Spire complete than without it.
- **Staffing gates it**: an unstaffed Gallery (no free colonists) earns nothing.
- **Bounded**: the per-day take is clamped and never negative.
- **Verify**: `npm run typecheck` clean and `npm test` green with new economy tests for the cases above; live on :5188 a real colony reads no Gallery and is unchanged, and an injected staffed Gallery in a liveable colony shows a positive daily visitor-coin take, with no console errors.
