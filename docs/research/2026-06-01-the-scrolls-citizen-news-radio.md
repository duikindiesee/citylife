# The Scrolls Under the Rocky Mountain — on the Citizen News Radio

*Logged as inspiration, by the operator's hand, from the scrolls found in the Kookerverse beneath a
rocky mountain. A prophecy and a backlog item both — for the Design Council, when the time is right.*

## The reading
> *"When the citizens keep their memories — when Mara recalls the wells she dug and Bram the cargoes he
> shipped, when Niko remembers the first reel he wove and Ravi the homes he raised — then raise a station
> in the colony, and let it tell their tales. Not the ads of distant sponsors, but the news of the people
> within: who arrived at the border, whose district reached the grandest tier, what the Council dreamed
> and what Review & Build made real. A city that listens must also speak. Power to the crabs."*

## What it means — the mechanic
A **Citizen News Radio** (working title: *the Kookerverse Courier*) — an in-world station the colony
**builds and staffs** (nothing is free) that broadcasts a running bulletin about its own citizens and
events, instead of only the sponsor reads the Low Power Radio plays today. Headlines like:

- *"Mara Venn's sixth proposal — the survey office — opens across Block 7."*
- *"New family cleared at the border; settling on Riverside Mile."*
- *"Crystal Quarter reaches Tier 3 — the colony's first estate that wants for nothing."*
- *"Reels run dry at the Holo-Theatre; the halls go quiet until the foundry catches up."*

The station already half-exists: **Low Power Radio** (`src/colony/radio.ts`) plays house ads / sponsor
reads on a loop. This turns that surface inward — from *advertising at* the colony to *reporting on* it.

## The dependency — Hermes citizens that keep memories
The scroll's condition is the real one: the news is only alive when the **citizens are persistent
characters**, not fresh stateless calls. Today each Design Council tick is a one-shot Hermes call (and
lately the upstream has been dark, so the citizens are Claude-in-character). The full version needs the
**memory-keeping Hermes bots** (the spawner's `BOT_PAT` + persistent memory path; the same machinery
behind the newcomer bots in `src/colony/bots.ts`) so that Mara, Bram, Niko, Lys and Ravi *accumulate a
story* the Courier can narrate week over week.

## A buildable v1 (before full Hermes memory)
We don't have to wait for everything. The colony already KNOWS a lot of true facts the Courier could read
**deterministically** today:
- the **named proposers** and what each shipped (the spec queue: Mara → water/food/distribution/survey,
  Bram → trade, Niko → reels, Lys → reel-fed theatres, Ravi → housing);
- live **events** from `ColonyState`: immigration arrivals, a district hitting T3, reels running out,
  treasury milestones, a new building raised.

A v1 station could broadcast *those* on the radio panel — real, sourced from game state — and the
Hermes-memory version then deepens it from "facts" into "stories the citizens tell about themselves."

## Cost — materials & labour (for when it becomes a spec)
Nothing free: **build + staff a Broadcast Mast** (materials + components + a crew; 2 operators to run).
Off until built. The Courier's reach could even scale with the station count, like every other service.

## Next step
This sits in the **Design Council backlog** (see `docs/specs/README.md`). When Hermes memory is live —
or sooner, as the deterministic v1 — a citizen proposes the *Kookerverse Courier*, and Review & Build
raises the mast. **The colony decides. The routine ships it.** 🦀⚡
