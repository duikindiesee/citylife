# Spec 099 — Street Rod: the CityLife North-Star

> This is the WHY behind CityLife. Every other spec is a means to this end.
> Both lanes (the claude2 "Streed Rod" car/garage lane and the team-lead Joe/Jack world lane)
> and every bot should read this and ask: "does my slice ladder toward the night meetup and the race?"

## One line

CityLife exists so two brothers — and their friends — can meet in the world **at night**, drive out to a spot, hang out, and **race**, building and tuning their cars Street-Rod style.

## The fantasy (what it should feel like)

It's night in CityLife. You get a ping from your brother. You both roll your cars out of your garages, headlights on, and drive across the city to a spot you both know — a quiet lot, or the hilltop overlooking the lights. You park, get out, talk for a bit. Then you line up at the start, someone counts it down, and you race — down the strip, over the crest, settling whose build is faster. Afterward you cruise back, and check the classifieds to see what parts came up tonight.

## Street Rod DNA

From the classic Street Rod game, the parts that matter:

- You don't buy a finished car — you **build** it. Buy a body, drop in an engine, upgrade it.
- **Engines matter most.** Swap blocks, carbs, cams; horsepower you can feel in a race.
- **Classifieds.** A newspaper-style marketplace where cars, engines, and parts come up for sale — you scan it, weigh it, buy, sometimes sell.
- It's personal, mechanical, and competitive — between friends.

## The personal anchor

Irwin's brother is **building a real car right now**. CityLife should echo that — the in-game car you tune is a nod to the one in his driveway, and the first two characters in the world are the two brothers.

## The core loop (spelled out)

1. **Meet** — the night ping; leave the garage.
2. **Drive** — cross the city to the spot (free-roam, first-person or chase cam).
3. **Hang** — park, step out, chat (presence + light social).
4. **Race** — line up, count down, run the route; the winner is decided by the build *and* the driving.
5. **Tune** — back at the garage, spend the winnings; scan the **classifieds** for the next part or engine.
6. **Repeat** — each loop, your car (and your brother's) gets a little faster and a little more *yours*.

## Systems map — two lanes, one vision

| Lane | Builds | The part of the vision it serves |
|---|---|---|
| **Brother's lane** (claude2 / Streed Rod, `D:\infra\claude2`) | cars, garage, car build + **engine upgrades**, racing / rally, roads + grading, vehicles-ride-the-road + **ramp**, the night/social side | the *driving, tuning, and racing* |
| **Team-lead lane** (Joe / Jack) | the world + the **PlacedArtifact catalog / Kookerbook**, in-world **characters**, houses, plots, first-person / mobile / UI | the *classifieds spine, the world, and who shows up* |

**The seam (where the lanes meet):**

- The **catalog / Kookerbook + the KCO ledger IS the classifieds** — car parts and engines are artifacts listed, bought, and sold there. (This is why the everything-is-an-artifact + DB-backed epic matters.)
- The **rally point overlooking the city** (spec 097) is the **night-meetup spot**.
- The **in-world characters** are **the brothers as players** — not Joe and Jack.
- **Night** is the time it happens.

Lanes stay in their seams: the team-lead bots never touch roads / `gradeRoadsInto` / cars / garage / rally; the car lane never touches furniture / the artifact catalog / houses. The #89/#98 road collision is the lesson.

## Feature pillars

1. **The car** — buildable, with an engine you upgrade; stats that change the race.
2. **The garage** — your home base; where you tune.
3. **Classifieds** — browse / buy / sell parts + engines (the artifact catalog + ledger).
4. **The meetup** — a night-time spot you drive to (the rally point).
5. **The race** — a route, a countdown, a winner.
6. **Presence** — you and your brother in the world, together.

## Milestone ladder (rough, to sequence by)

- **M0 — foundation (now):** the artifact catalog (classifieds spine), in-world characters (the brothers), roads sitting flush, the rally point.
- **M1 — a car + a garage:** one drivable car; the garage as a home base; the catalog lists a few parts/engines.
- **M2 — economy:** classifieds buy/sell wired to the KCO ledger; an engine upgrade actually changes a stat.
- **M3 — the meetup + a race:** night meetup at the rally point; a simple two-player race on a route.
- **M4 — the loop closes:** race winnings → classifieds → a better engine → a faster next race.

## North-star guardrails

- If a feature doesn't ladder toward "the brothers meet at night and race," it's a side quest — note it, don't let it crowd the spine.
- Determinism (no `Math.random` / `Date.now` in the sim tick), `isPublicSafe`, and small/tested PRs still hold.
- Lanes stay in their seams (no cross-edits across the roads/cars vs catalog/world boundary).

## Open questions (for Irwin)

- **Engine depth:** arcade stats, or a deeper real-ish parts model (block / carb / cam)?
- **Classifieds source:** AI-seeded listings, player-listed, or both?
- **The race:** time-trial vs. head-to-head; stakes (KCO? pink slips?)?
- **Multiplayer:** real-time both-online, or async "ghosts" to start with?
