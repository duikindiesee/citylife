# Research — Tuner-culture (NFS Underground + Street Rod) features for CityLife

Source: Gemini Deep Research (Ultra), 2026-06-26, kicked off by the lead at Irwin's direction. Full verbatim report saved to Drive: "Tuner Culture Game Design" (docs.google.com/document/d/1TxiydrPdmN7gr4GGzi5TCFKbCPk5Ws0ZMJm244gcwz8). This doc = the organised, CityLife-scoped version (the citylife way: dated research doc -> scoped slices).

## TL;DR

The research synthesises **Street Rod (1989)** (buy a junker via classifieds for $750, bolt-by-bolt customise over a summer, beat "The King" who races only at night) and **NFS Underground 1/2** (neon-night cruise, crews, Outruns, drift/drag/sprint, reputation + style). It maps cleanly onto CityLife's existing spine: a deterministic, tile-based, day-calm/night-neon city built around a **drive-between-landmarks** loop. Most of it is achievable as render + sim slices; the heavy parts (real driving physics, P2P multiplayer) are gated on the Codex free-roam `carSpec` hook and a future netcode track.

## The landmark network (THE spine — ties straight to the operator's vision)

Three repeatable landmark types on the tile grid, one network the whole map hangs off:

| Landmark | Size | Mechanics | Placement rule |
|---|---|---|---|
| **Drive-through Garage** | ~2x2+ | Workshop / customiser, parts storage, **site-curated classifieds**, local trade hub | **One per neighbourhood district** (Suburbs / Industrial / Downtown) |
| **Filling station** | ~1x1 | Refuel mini-game, nitrous refill, octane boosters (a *can't-pop-in* filler) | Along high-speed corridors / near highway exits |
| **Social meetup spot** | ~3x3 | Multiplayer lobby, crew forming, Outrun matchmaking, leaderboard, **chat** | Scenic points (Oceanside, Downtown core, Railway yards) |

Crossing a landmark boundary swaps the client between driving and a UI overlay; identical tiles batch via InstancedMesh. **This is exactly the operator's "drive-through spots that double as meetup/hook-up + chat, with curated parts per site" — the network is the organising idea.**

## Mechanics worth lifting (by system)

- **Site-curated classifieds / parts economy** — each district runs its own deterministic, seeded classifieds DB (engines, transmissions, customiser parts differ by Suburb / Industrial / Downtown). Dynamic resale valued on *raw components* (strip a car -> value drops) to block infinite-credit strip-and-sell exploits. Ties to the **Kookerbook classifieds spine + KCO ledger**.
- **Bolt-by-bolt customiser** — the garage workshop overlay: a "wrench" cursor unscrews fasteners in a real dependency order (carburettor -> intake -> fuel lines -> manifold bolts -> lift). Body mods (debumper/chop) trade weight/drag for fragility. Parts wear with high-RPM/aggressive launches, can fail mid-race. (Big; the garage *building* is built — this is the interior UI later.)
- **Filling station** — drag-the-nozzle refuel mini-game, overspill penalty; sells octane (+5% temp HP) and nitrous; nitrous is multi-stage and refills via skill (drifts / near-misses).
- **Meetups + Outruns** — meetup zones disable collision so players gather/inspect builds/chat; flash headlights behind a rival to start a P2P **Outrun** (first to a 300m lead wins a unique part). Crews, pink-slip wagers at top rep.
- **Day/night** — dual baked lightmap blend (day vs night) interpolated by the global clock, emissive boost + underglow at night. **CityLife already does day-calm/night-neon emissive** — this formalises it.
- **Racing typologies** — Sprint / Circuit / Drift / Drag / Downhill-drift; **Reputation** (campaign gating, premium classifieds, meetup invites) + **Style points** (cosmetic unlocks). CityLife already has the Road Rally (Sprint-like).
- **Determinism architecture** — the report proposes WASM Rapier + Q16.16 fixed-point + Web-Worker fixed-step + WebRTC/WebSocket/lockstep. NOTE: heavy and largely BEYOND CityLife's current render-deterministic approach; treat as reference for the eventual free-roam/netcode track, NOT a near-term adoption. Our determinism today is seed-driven render + sim with no Math.random/Date.now.

## Scoped work for CityLife (prioritised, mapped to our reality)

NEAR-TERM (render + sim, no new heavy deps; fits the current budget-safe lanes):
- **S1 — Landmark network foundation (lead/Jack):** generalise the garage placement (spec 110 corner lot) into a repeatable **per-neighbourhood landmark** survey + add the **filling-station** filler type (small, can't-enter) and **meetup-spot** type. Deterministic placement on the (now scaled-up) map. This is the keystone and folds into spec 108 land-tools.
- **S2 — Site-curated classifieds data (lead/Jack + ledger):** per-district seeded parts/engine catalog surfaced at each garage; read-only first, then buy via the KCO ledger (Kookerbook spine). No exploit-able strip-and-sell (raw-component valuation).
- **S3 — Day/night + neon formalised (Jack):** confirm the emissive/underglow night treatment as a shared helper across landmarks (already partly there via the garage night-floor work).
- **S4 — Meetup spot as a social/chat hub (Joe/UI):** the meetup landmark as a "who's here" + chat surface (read-only presence first; ties the existing rally-presence seam).

GATED (need the Codex free-roam `carSpec` hook / a netcode track — design now, build when unblocked):
- Real **drive-into-garage** + Outrun distance races (needs a free-roam drivable car beyond the rally track).
- **Bolt-by-bolt customiser** interior UI (big; after the garage interiors exist).
- **P2P multiplayer / crews / pink-slips** (WebRTC + server — a whole track; not near-term).
- Fill-station **nitrous/refuel mini-games** (need the car/fuel sim).

REFERENCE-ONLY (do NOT adopt wholesale): the WASM Rapier / Q16.16 / Web-Worker physics stack — keep our seed-driven render-deterministic model; revisit only if/when real driving physics is greenlit.

## Next

Lead to turn S1 (landmark network) + S2 (curated classifieds) into proper specs (111+) once the map scale-up + corner garage land. The free-roam-gated items wait on Codex. The full verbatim report (with code samples + the racing/drift math + the netcode topology) lives in the Drive doc for when those tracks open.
