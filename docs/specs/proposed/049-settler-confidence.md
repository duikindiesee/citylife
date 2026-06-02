# Spec 049 — Settler Confidence: word travels faster than skyships
- status: proposed
- proposed-by: Mara Venn, founding dock registrar (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 004 (settler immigration). Reads existing signals from 008 (food delivery), 005/046 (water), 028 (unrest), 029 (wages), 039 (treasury arrears).

## Why (the citizens' case)
Mara Venn keeps the dock register, and she has watched the contradiction long enough: today a settler skyship docks the moment a bed falls empty, no matter what state Landing One is in. Hungry, broke, restless, the water off — and still the newcomers step off, because the engine only asks whether a house is vacant. That is not how migration works. Word travels faster than skyships. If the colony is failing its own people, no free colonist should risk bringing their family across the cloudsea just because a room is free. Settlers should *choose* Landing One because it is visibly worth choosing — and stay away when it is not.

This is the missing dynamic on immigration: arrivals should follow the colony's reputation, not just its vacancies.

## Mechanic
- The colony carries a **Confidence** rating in `[0, 1]`, recomputed each step from the conditions a prospective settler can see: are the homes **fed**, the taps **watered**, the wages **paid**, the treasury **solvent** (not in arrears), and the streets **orderly** (low unrest).
- Immigration still requires a **vacant home** (spec 004 is unchanged there) — but the **rate** at which settlers actually arrive is now scaled by Confidence:
  - **High Confidence** (a colony meeting its needs) → settlers arrive at **full speed, exactly as today**.
  - **Low Confidence** → arrivals **slow**.
  - **Terrible Confidence** → immigration **halts** until the colony recovers.
- **Test-safe plateau (load-bearing):** Confidence maps to an immigration multiplier that is **exactly 1 for any reasonably healthy colony** (Confidence at or above a comfortable threshold). The mechanic only bites once conditions are actively bad, so a functioning colony immigrates precisely as it does today and the existing immigration tests stay green.
- **Neutral when not applicable (load-bearing):** each signal scores **1.0 when its subsystem is absent or irrelevant** — a young colony with no Pay Office is not docked for unpaid wages, a colony with no cisterns is not docked for a dry tank, a colony with no homes or no people is fully confident. Distress only counts when the colony has the thing and is failing at it. This keeps early and minimal colonies (and their tests) at full Confidence.

## Rules & data
- **Confidence signals** (each a `0..1` good-score, 1 = no problem):
  - **fed** — based on food delivery to homes (provisioned fraction, 008); 1 when there are no homes/people or food is reaching them, dropping only on a real, sustained shortfall.
  - **watered** — the existing watered fraction (005/046); already 1 when there are no homes.
  - **paid** — 1 when there is no Pay Office (029) or wages are met; drops only when a Pay Office is active and underpaying.
  - **solvent** — 1 unless the treasury is in arrears (039); scales down with arrears strain.
  - **orderly** — `1 - unrest` (028).
- **Confidence** = a weighted blend of the signals (a weighted average, so one missing subsystem cannot zero it), clamped to `[0, 1]`. Suggested weights favour the survival signals (fed, watered) over the civic ones, but the Review & Build routine may tune them to keep the suite green.
- **Immigration multiplier** `confidenceFactor`:
  - `confidence >= confidentThreshold` (suggest **0.7**) → **1.0** (full speed — unchanged from today).
  - `stopThreshold < confidence < confidentThreshold` (suggest stop at **0.25**) → ramps linearly **0 → 1**.
  - `confidence <= stopThreshold` → **0** (immigration halts).
- The factor multiplies the **arrival rate / probability** inside the existing immigration step (004); it never changes housing capacity, vacancy logic, or emigration (departure pressure, 041, is the separate shrinking side).
- Recompute Confidence on the normal step cadence; expose it (and the live factor) for the HUD so players can see why arrivals have slowed.
- **Recovery is symmetric:** fix the rations, pay the wages, calm the unrest, and Confidence climbs straight back, so a colony that halts immigration can always earn it back. No hysteresis trap.

## Cost — materials & labour
- **No building. No materials, no components, no staff.** Settler Confidence is a **rule on the existing immigration system**, computed from conditions the colony already tracks.
- The real cost is **ongoing and indirect**: Confidence must be *earned* by actually running the colony well — keeping rations delivered, water flowing, wages paid, the treasury out of arrears, and unrest down. Every one of those is already paid for in goods and labour elsewhere; Settler Confidence simply makes that upkeep the price of growth. Let the colony slide and it stops attracting people long before it starts losing them.

## Acceptance
How Review & Build verifies it:
- `npm run typecheck` clean and `npm test` fully green. Because this touches the core immigration path, the **whole existing suite must still pass** — the thresholds and weights are to be calibrated so a healthy/neutral colony reads Confidence at or above the plateau and immigrates exactly as before. New tests covering:
  1. **Healthy plateau (non-regression):** a fed, watered, solvent, orderly colony reads `confidenceFactor === 1` and immigrates at the same rate as today.
  2. **Neutral-when-absent:** a minimal early colony (no Pay Office, no cisterns, few people) still reads full Confidence (no false distress).
  3. **Distress slows arrivals:** a colony with empty rations / high unrest / deep arrears reads reduced Confidence and admits fewer settlers over a fixed run than a healthy one with the same vacancies.
  4. **Terrible halts:** stack several severe distress signals and confirm `confidenceFactor` reaches 0 and immigration stops while vacancies remain.
  5. **Recovery:** restore the conditions and confirm Confidence and the arrival rate climb back to full.
- On the live game (:5188): a **Confidence** HUD readout (a percentage) tracks conditions; wreck the rations or spike unrest and watch arrivals slow with it, then recover when the colony is set right.
