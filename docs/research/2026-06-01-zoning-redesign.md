# Investigation — retire or redesign the zoning overlay

**Status:** open · feeds the Design Council / Review & Build routines
**Raised by:** the operator (2026-06-01)

## The problem

The old **city-plan zoning overlay** (the coloured `ZONE_COLOR` tints + plot flags, from the early
"named plots derived from terrain" work) is:

- **ugly** — the flat zone colours wash over the island and fight the biome art;
- **useless for planning** — it never actually guided where things get built;
- **superseded** — the Caesar III economy (specs 001–010: extraction → workshops → water → food →
  delivery → housing tiers → health → culture) now decides how the city evolves. Districts should
  **emerge from what the colony builds and needs**, not from a pre-painted static plan.

## Done now

- The overlay is **OFF by default** (`zonesVisible = false`); the clean biome island shows at startup.
- It remains an **opt-in HUD toggle** so nothing is lost while we decide its future.

## Direction (for the routines to enhance over time)

The operator's words: _"your research now supersedes how the city will evolve."_ So zoning should follow
the same spec pipeline as every other mechanic. Options, foundational-first:

1. **Emergent districts** — derive zones from the _actual built economy_, not the terrain plan: tint by
   building function + density (industry clustered round mines, housing clusters, a civic core round the
   services). Recomputed as the colony grows. This is the Caesar-III-faithful version.
2. **Desirability / liveability heatmap** — reuse the new per-home signals (watered / fed / healthy /
   cultured / tier) as a gentle overlay so the operator can _see_ where the colony is thriving or
   struggling. Directly actionable, and it visualises the economy we just built.
3. **Retire it** — if neither earns its keep, delete the `zoneTintMesh` + plot-flag code and keep the
   view modes (Biome / Buildable / Elevation) only.

Whatever wins, the **palette must be tasteful and toned** (match the Dark City house style — deep
space, cyan hairlines), and it must stay **off by default**.

## Suggested next step

A Design Council spec — e.g. _"Liveability overlay: districts emerge from the economy"_ — that picks
option 1 or 2, with the usual materials/labour-free (UI-only) cost note and acceptance tests on the
derived tint data (not the pixels).
