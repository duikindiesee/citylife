# The people ARE the citizens — living, named colonists

## The disconnect the operator saw

Two observations, one root cause:

1. _"How are there so many droids walking the road — shouldn't these be my actual Hermes bots?"_ The figures on
   the streets were **decorative droids**: a fixed pool (16) of anonymous capsules, renderer-only, with no sim
   meaning and **more of them than there are real colonists**. They are not the colony's people.
2. The colony has a city's _economy_ but its people have no _life_ — they don't start in a tent, don't walk to a
   lot, don't take up work, don't run a loop you can watch (fell trees → the forest thins → replant → need seeds).

These are the same problem. **The colony's people should be its real, named Hermes citizens, living visible
lives.** The very voices that _dream_ this world — Mara Venn, Saskia Vorster, Senna Coetzee, Pieter Lourens,
Wren Solano — should be the people you _see_ in it. That is the soul of "the city that builds itself."

## The research grounding (colony-sim canon)

- **Caesar III** — the economy travelled as _walkers_; you watched wealth, plague and trade move on the streets.
  CityLife now has this for goods (spec 073, Porter Sheds).
- **RimWorld / Dwarf Fortress** — each colonist is an _individual_ with **needs** (rest, food, joy) and a **job
  priority list**; they choose work, do it visibly, and the world reacts — a felled forest, a depleted vein.
  This is the model for _agency_.
- **Procedural identity** — a small roster plus a per-person seed gives unique, recognisable colonists (CityLife
  already does this for the KOOKER settler homes, spec 017).

## The vision

Every visible person is a real colonist with: an **identity** from the colony roster (the founders + the named
Hermes proposers + the registered settlers — never an anonymous extra); a **home** they start in — a **tent**
(the T0 dwelling) pitched on their lot before it grows to a house, with unique tent templates; **agency** — needs
and a job they walk to and do where you can watch it; and **persistence** — saved against the _user's_ account so
the world is theirs and endures.

## The plan (phased)

- **P1 — the crowd IS the colony (DONE this tick).** The visible figures now equal the real colonist count (was a
  fixed 16 droids), and each has a head so it reads as a person, not a pill.
- **P2 — name the people.** Bind each visible figure to a roster entry (founders + settlers + Hermes proposers),
  so figure N is _Mara Venn_, _Saskia Vorster_, … — a consistent colour/identity, clickable to their card. The
  people who design the world now live in it _by name_.
- **P3 — tents-first dwellings.** A new settler pitches a **tent** (T0) on their lot; it grows to a house as it is
  served. Unique tent templates (procedural variety, per the VISUAL-STANDARD). "Starting off in a tent."
- **P4 — agency + the first job loop.** Colonists walk to their lot, pitch the tent, then take up work. The
  opening loop: **fell trees → wood; the forest visibly thins (scarcity); replant → needs seeds** (the Seed Loft,
  spec 048). Needs (rest / food / joy) gate how much work gets done. Work you can _watch_, consequences you can
  _see_ — exactly the visual-first + living-economy rules.
- **P5 — per-user persistence.** Save the colony (its people, their homes, the forest, the stores) **against the
  user account** via the kooker backend, not just this browser's localStorage, so each operator's world endures
  and is theirs. (Connects the persistent-things + scarcity/duplication backlog.)

## Done this tick

- The visible crowd now tracks the real colonist count; each figure has a head and reads as a person.
- Logged P2–P5 in the README backlog as the priority people-system work.
