# Spec 035 — The Founders' Hall: the people who built Landing One

- status: built — slice 31, shipped to mechanics/dev. Engine in src/colony/build.ts (foundersHallActive guard, FOUNDERS roster, foundersRoster/foundersStatus selectors, gated immigration/standing/unrest effects, founder-named Courier headlines), knobs in config.ts, uiState in runtime.ts, a HUD Founders row in ColonyApp.tsx, and seven tests in tests/economy.test.ts. typecheck clean and all 271 tests pass; the live HUD shows the seated Roster (14 founders, Tessa Quill keeping the Hall). v1 seats the full roster with modest colony-wide bonuses; Tessa's per-founder domain benefits and absence/disgrace dynamics are a later deepening.
- proposed-by: **Tessa Quill, ledger-keeper of the Dawn Market shift (Landing One)** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Tessa Quill returns (she authored the Skybridge Transit Depots, 021) — and fittingly, a founder proposes the mechanic that makes the founders real. Opens a fresh dimension: the colony's notable people — the self-design loop made flesh.
- date: 2026-06-02
- depends-on: 016

## Why (the citizens' case)

Tessa Quill: _"Systems without people become ghosts. Landing One should know who carries its burdens. Build a Founders'
Hall and enter each system-author not as a signature, but as a living notable colonist — with a post, a shift, and a
public duty."_

## Mechanic

- A new building, the **Founders' Hall** — a civic archive and seat of the colony's notable citizens. Once built and
  staffed, it activates the **Living Roster**.
- The **Living Roster** seats the colony's **founders** — the real authors of its systems (Mara Venn, Bram Teel, Niko
  Vance, Lys Ardent, Ravi Okondo, Jalen Orro, Echo Marlow, Tessa Quill, Jory Pell, Tavi Orro, Sella Brint, Niko Darr,
  Hessa Morn, Bren Kalo, and each new author as they propose). Each is no longer a signature but a **named colonist with
  a role** tied to the system they championed (Mara Venn, Dock Marshal; Jory Pell, Levy Clerk; Tavi Orro, Fever Warden;
  Sella Brint, Market Packer; Bren Kalo, Feast Steward; Hessa Morn, Pay Clerk; …).
- A seated, honoured roster gives the colony a **face and a memory**:
  - the colony draws settlers a little faster (people want to join a place with names and a story),
  - it stands a little prouder before the Kookerverse (a small **standing** lift — the founders are a face to the wider world),
  - and its people are steadier (a small daily **unrest relief** — pride in who built this).
- The **Kookerverse Courier (016)** now reports the founders **by name and deed** — who holds which post, who proposed
  what — instead of only buildings and tiers. The self-design loop becomes news.
- (Tessa's fuller vision — each founder lending a benefit to their **own specific domain**, and that benefit pausing if a
  founder is absent, disgraced, injured or overworked — is a future deepening; v1 seats the full roster and grants the
  modest colony-wide benefits above plus the named Courier deeds.)

## Rules & data

- A built + **staffed Founders' Hall** activates the Living Roster; without it the founders remain signatures (inert).
- While the Roster is seated: immigration desirability gets a small **founders bonus** (≈ +10%), the colony's
  **Kookerverse standing** is lifted slightly, and a small daily **unrest relief** applies. Modest, lasting, gated on the Hall.
- The roster is the real list of system-authors, each with a role; the Courier draws on it for **founder-named headlines**.
- Founders' Hall: build ~18 materials + ~12 components + a build crew of 3; run 3 (2 clerks + a steward) to keep the
  roster. _(Tessa asked for timber / stone / iron / glass and 160 worker-hours; v1 maps the build onto the colony's
  materials + components and a 3-staff hall — the richer kit is a later refinement.)_
- **Testability / safety:** the roster's benefits are gated on a staffed Founders' Hall, so with none built the colony is
  unchanged and existing tests stay green. The roster and its bonuses must be readable/drivable deterministically (build
  the Hall, check the roster and the bonuses).

## Cost — materials & labour

- To BUILD: treasury + ~18 materials + ~12 components + a 3-colonist build crew.
- To RUN: 3 colonists (2 clerks + a steward) to keep the Living Roster. Without a Founders' Hall, the people who built
  Landing One stay ghosts — names on scrolls, absent from the colony they made.

## Acceptance

- With a staffed Founders' Hall, the Living Roster is seated: immigration runs a little faster, standing lifts slightly,
  and unrest eases a touch — modest, lasting bonuses; the Courier reports founders by name and role.
- Without a Founders' Hall, the founders remain signatures and the colony is unchanged — the founding economy and
  existing tests stay green.
- HUD shows the Founders' Hall / Living Roster (a seated-founder count, or a notable name), and the Courier carries
  founder-named deeds.
- Tests: a staffed Hall seats the roster and applies the bonuses (immigration / standing / unrest); the roster lists the
  real author names with roles; with no Hall it is inert.
