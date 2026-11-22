# Spec 182 — Starter economy

- status: proposed
- proposed-by: Forge (operator decision 22 Nov 2026: raise the player starter grant to at least 1,300 KCO so a new player can afford the 350 KCO starter house and the 950 KCO gold Fiat X19; a player wage or earn loop is to be explored later)
- date: 2026-11-22
- depends-on: 085 (land economy + citizen starter deposit), 156 (starter-property purchase at 350 KCO), 166 / 162 (bug-bounty signal, payment out of scope), 171 (KCO vehicle acquisition), 175 (claimStarterHome), 181 (plot ownership and land purchase), [PLAYER-ARRIVAL-ACCEPTANCE.md](../PLAYER-ARRIVAL-ACCEPTANCE.md)

This is a **proposed contract**, not a claim that the grant has changed in production. Implementation of the grant lives in the ledger `StarterGrantService` (kooker-web / the ledger service, not a CityLife client constant) and lands in a later change after review. Nothing in [PR #584](https://github.com/duikindiesee/citylife/pull/584) implements it.

Land sizes and the 0.27 KCO/m² rate are owned by [spec 181](181-plot-ownership-and-land-purchase.md). This spec owns the player starting pot, first-day affordability, and the inconsistencies between wallets and house prices.

## Why

A new human player is documented as receiving a one-time **750 KCO** starter grant. After that, this repo has no implemented player job, wage, stipend, or paid bounty, so anything above 750 is unreachable. The documented starter path already names the 350 KCO starter house and the 950 KCO Karoo X19 Targa (gold paint). Those two items cost **1,300 KCO** together, 550 more than the grant. That gap is already written down in `docs/PLAYER-ARRIVAL-ACCEPTANCE.md:20`.

On 22 November 2026 the operator decided to fund that path now: raise the grant to **at least 1,300 KCO**, and explore a player wage or earn loop later.

## Mechanic

1. **The player starter grant is ≥ 1,300 KCO**, paid once, by the ledger `StarterGrantService`, into the signed-in player's KCO wallet (`GET /kooker/api/ledger/me/wallet`). It is authoritative, idempotent, and auditable. It must not replenish ordinary spending on every login (`PLAYER-ARRIVAL-ACCEPTANCE.md`, required journey item 5).
2. **Sticker prices stay as they are** unless a later decision changes them: starter house **350 KCO** (spec 156), Karoo X19 Targa **950 KCO** (spec 171 / showroom catalogue), Karoo Vonk 1.1 **250 KCO**, Karoo Kaap GT-V8 **2,400 KCO**. Land uses the spec 181 schedule (Compact 130, Standard 173, Large 272, Smallholding 2,700 KCO).
3. **1,300 is a floor, not yet a final ceiling.** House + X19 costs 1,300 exactly and leaves **0**. House + a Standard plot + X19 costs **1,473** and does not fit. Whether the grant should be about **1,500 KCO** so that basket fits is an open question below.
4. **A player wage or earn loop is deferred.** This spec records the need; it does not design a job, a rate, or a daily stipend.

## Rules & data

### Grant touchpoints

The 750 figure is not a CityLife client constant. Confirming the live service still grants 750 needs the kooker ledger / kooker-web source or a live wallet read. When the grant changes, every location that still presents 750 as the live amount must follow it:

| Location | What it says today | Role when implementing ≥ 1,300 |
|---|---|---|
| Ledger `StarterGrantService` (kooker-web / ledger service, not this repo) | Authoritative one-time grant of 750 KCO, as documented at `docs/PLAYER-ARRIVAL-ACCEPTANCE.md:20` | **Change the grant here.** Confirm with a live wallet read. |
| `docs/PLAYER-ARRIVAL-ACCEPTANCE.md:20` | Evidence column still documents today’s 750 grant; the remaining-gap column now records the 22 Nov 2026 decision (≥ 1,300, with the 1,500 question still open) | Keep as the arrival contract. Update the evidence column once the service actually grants ≥ 1,300. |
| `docs/ROADMAP.md:129` | `POST users` (settler, 750 KCO) | Update when the API grant changes, so the roadmap does not contradict this spec. |
| `docs/HANDOVER.md:13` | kooker-web #362 create+fund 750 KCO | Historical note; annotate or update so it does not read as the live grant. |
| `docs/EPIC-street-rod.md:238` | Test players John/Jane Doe (`CITYLIFE_PLAYER`, 750 KCO, real login) | Same. |
| `tests/playerWallet.test.ts:28,48` | Fixtures `balance: "750.00"` / `balanceKco: 750` | Follow the new grant, or stop implying the fixture is the grant amount. |
| `tests/newPlayerGarageSpawn.test.ts:965–994` | `walletKco: 750`, label `₭750 KCO` | Same. |

`docs/KOOKERVERSE_FOR_NEWCOMERS.md:33` mentions a starter grant of “kooker cash” without the 750 figure; leave it unless the prose starts quoting an amount.

### House price: resolve the free-claim path

There are two house prices for the same journey today:

- The server starter-home deed costs **350 KCO** (spec 156, `POST /players/me/home/purchase`).
- Client `claimStarterHome` can then place a house, and the no-argument fallback can assign the first free primary lot **without debiting KCO** (`src/colony/runtime.ts:4738-4865`; spec 175).

**Resolution for the entitled player path:** the house costs 350 KCO on the server. `claimStarterHome` is a projection of an already-granted deed, not a second official price of 0. As already required by spec 181, `claimStarterHome()` with no grant must not assign open land, and the no-argument “first free primary lot, no payment” fallback must be removed from the entitled journey. This spec does **not** make the starter house free.

### Two starting pots: flag, do not invent a merge

A second, in-game pot still exists:

- Citizen arrival deposit **600–1,000 ₭**, from `starterDepositMin: 600` and `starterDepositSpread: 400` (`src/colony/config.ts:1076-1077`; `starterDeposit()` in `src/colony/land.ts:48-51`; spec 085).
- `ledgerSync` seeds the real wallet with `POST /wallets` `initialBalance` equal to that citizen deposit and is a no-op if the wallet already exists (first writer wins; `src/colony/bot/ledgerSync.ts:9-12`).

Raising the player grant to 1,300 makes a collision worse: a 600–1,000 deposit that wins the race would block or replace the 1,300 grant; a grant that wins first would ignore the citizen seed. **This spec does not pick the merge rule.** It flags the conflict and requires the implementation PR to state, and test, that the player grant is not overwritten or prevented by the citizen deposit — or that the two pots are unified into one amount. Until that is decided, “what does a new player start with?” has two answers.

The in-game ledger is also still described in places as the source of truth (`ledgerSync.ts:3-4`), while specs 156 and 171 say the kooker service is the sole authority for home and car KCO. The player grant and the entitled house and car purchases follow the kooker-service authority.

### Affordability at a 1,300 KCO grant

Prices below use the spec 181 land schedule and the catalogue / server house and car prices above. “Short” means the 1,300 grant cannot pay for the basket. There is still no player earn loop, so anything short stays unreachable until the grant is raised further or the deferred earn loop exists.

| Basket | Cost (KCO) | At a 1,300 grant | Residual |
|---|---:|---|---:|
| Starter house | 350 | Yes | 950 |
| Gold X19 | 950 | Yes | 350 |
| **House + X19** (the funded starter path) | **1,300** | **Yes, exactly** | **0** |
| Compact plot (480 m²) | 130 | Yes | 1,170 |
| Standard plot (640 m²) | 173 | Yes | 1,127 |
| Large plot (1,008 m²) | 272 | Yes | 1,028 |
| House + Standard plot | 523 | Yes | 777 |
| House + Vonk 1.1 | 600 | Yes | 700 |
| House + Vonk + Standard plot | 773 | Yes | 527 |
| House + X19 + Compact plot | 1,430 | **Short 130** | — |
| **House + X19 + Standard plot** | **1,473** | **Short 173** | — |
| House + X19 + Large plot | 1,572 | Short 272 | — |
| 1 ha smallholding | 2,700 | Short 1,400 | — |
| Kaap GT-V8 | 2,400 | Short 1,100 | — |

House + X19 leaving 0 means a new player who buys both has nothing left for a plot, furniture (full studio set 132 KCO), or a later upgrade. That is the reason the 1,500 question is still open.

## Deferred (recorded, not designed)

These stay on the backlog. This spec does not invent a wage, a pay cadence, or a bounty payout path.

- **Player wage or earn loop.** Operator decision 22 Nov 2026: explore later. There is still no job, wage, or daily stipend that credits the signed-in player's KCO wallet. NPC engine wages and colony `incomePerColonistPerDay` / Pay Office payroll are different ledgers and must not be treated as player income.
- **Bug bounty payout.** **100 KCO** per validated fix is configured (`DEFAULT_KCO_PER_VALIDATED_FIX` in `src/colony/bug/bugBounty.ts:30-31,50`; operator decision in spec 166) but is **not paid**. Spec 162 leaves amounts, the payee, and posting out of scope: it produces the validated-fix signal and stops. Payment remains deferred with the earn loop.

## Open questions for Irwin

1. **Grant 1,300 or about 1,500?** 1,300 funds house + X19 with nothing left. House + Standard plot + X19 is 1,473. Should the grant be raised to about 1,500 so that basket fits on day one, or is “house and car now, plot from whatever is left — or later” the intended first day?
2. **How do the two starting pots merge?** Player grant (soon ≥ 1,300 KCO) vs citizen deposit (600–1,000 ₭) under `ledgerSync` first-writer-wins. Which writer is the player authority, and what happens to the other pot?
3. (From spec 181, still open and relevant here.) When does the player pay for land relative to the 350 KCO house — before, with, or after — and can they own more than one plot?

## Acceptance

Implementation is a later change, most of it outside this client repo. That work is not done until all of the following hold:

- The ledger `StarterGrantService` pays a new player **≥ 1,300 KCO** once, idempotently, and does not top the wallet back up on later logins.
- The touchpoints in the table above no longer present 750 as the live grant amount.
- The entitled starter-house purchase debits **350 KCO** on the server. `claimStarterHome` without a grant assigns no open land (spec 181).
- Tests pin the affordability facts: 1,300 covers house + X19 with 0 left; house + Standard plot + X19 is 1,473 and is not claimed as covered unless the grant is raised to meet it.
- The implementation states and tests the rule that the citizen arrival deposit cannot overwrite or prevent the player grant, or that the two pots have been unified — once that question is answered.
- A player earn loop and the 100 KCO bug-bounty payout are still absent until separately specified. Their absence is not a failure of this grant change.
- Nothing merges to `main` without review.

Move this file to `docs/specs/built/` and mark `built` only when the grant change has shipped and the touchpoints have been updated.
