# Spec 024 — Emergency Bellhouse: when something finally goes wrong
- status: proposed
- proposed-by: **Mara Venn, night-shift dispatcher at Transit Depot 3 (Landing One)** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Mara's 12th spec; she has become the colony's operations-and-safety voice. Opens a fresh dimension: risk / incidents / disaster response — the first mechanic where something can suddenly go *wrong*.
- date: 2026-06-02
- depends-on: 001, 022

## Why (the citizens' case)
Mara Venn: *"Right now every failure is slow and polite — a building wears down but is never lost, and the colony
never faces a setback it must respond to. That makes floating scrap over the cloudsea feel far too safe. We need
moments where a neglected foundry or a bad power cut becomes an urgent choice: send the crews, protect the supply
chain, or accept the loss. Build an **Emergency Bellhouse** and staff it with response crews — foam carts, rescue
rigs, alarm drones — for the day something finally goes wrong."*

## Mechanic
- Working buildings carry a **hazard**: the chance an **incident** strikes — a workshop fire, a mine cave-in, a
  greenhouse blight, a power-shed spark, a storehouse collapse. Hazard rises with **wear** (022), and with
  **brownout** (017), **smog** (019), **congestion** (021) and **understaffing**. A neglected, stressed building
  is the one that goes up; a building in good shape is nearly incident-free.
- When an incident strikes, that building is **paused immediately** (it produces nothing) and a short
  **countdown** starts.
- A built + staffed **Emergency Bellhouse** dispatches a **response crew**. Each Bellhouse handles a fixed number
  of **concurrent** incidents; a crew that reaches an incident in time **resolves** it and the building recovers.
- An incident with **no crew** (no Bellhouse, or more incidents than crews) **times out** into a **consequence**:
  the building is **severely damaged** (its wear jumps to worn-out, so it limps until a Maintenance crew restores
  it) and a chunk of the colony's **stored goods is lost** in the blaze or collapse.
- The Bellhouse answers *sudden crises only* — it does **not** fix ordinary wear; the Maintenance Sheds (022)
  still do that. The two safety services are complementary: one prevents slow rot, the other answers fast disaster.

## Rules & data
- Each working building has a `hazard` rate built from its condition: a small base, multiplied up by high wear,
  an active brownout, smog exposure, congestion and low staffing.
- An incident pauses the building and runs a countdown (`incidentMin`, ~a few sim-hours).
- Emergency Bellhouse: ~`bellhouseCrews` (≈2) concurrent response crews while staffed. Active incidents up to that
  count are handled and **resolve** when the countdown ends (the building restarts, with a small wear bump from the
  scare). Incidents beyond capacity are unattended.
- Unattended timeout → consequence: building wear set to max (worn-out; limps at the maintenance floor until
  repaired) **and** a fraction (`incidentGoodsLoss`, ≈25%) of one stored resource is destroyed.
- **Testability / safety (important):** the base hazard must be low enough — and gated hard enough on bad
  condition — that the founding economy and the **existing tests see no incidents** in normal early play. Incidents
  must be drivable **deterministically** in a test (push a building to high wear + brownout, or inject an incident
  directly) so the response and the consequence are verifiable without flaky randomness. Prefer a hazard that only
  fires from sustained bad condition over a pure per-step dice roll.
- Cost: build ~16 materials + ~12 components + ~2 reels + a build crew of 3; run 2 response crew. *(Mara asked for a
  larger 12-worker station with structural panels and 4 reels; v1 uses the colony's standard service sizing and
  keeps her 2-concurrent-crew capacity — a bigger station is a later refinement.)*

## Cost — materials & labour
- To BUILD: treasury + ~16 materials + ~12 components + ~2 reels + a 3-colonist build crew.
- To RUN: 2 colonists (response crew). Without a Bellhouse, an incident always runs to its consequence — there is
  no one to answer the bell.

## Acceptance
- An incident pauses the stricken building (it stops producing) and starts a countdown.
- With a staffed Emergency Bellhouse in capacity, the incident is **resolved** and the building recovers (resumes
  production).
- With no Bellhouse (or more incidents than crews), the incident **times out**: the building is left severely
  damaged (worn-out) and a chunk of stored goods is lost.
- The founding / early economy is unaffected — no incidents fire in normal short play, and existing tests stay green.
- HUD shows active incidents and Bellhouse response capacity. Tests: an injected incident pauses production; a
  Bellhouse resolves it and output returns; without one it times out, damages the building and destroys some stored
  goods; a healthy colony in early play sees no incidents.
