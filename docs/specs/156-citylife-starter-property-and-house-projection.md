# Spec 156 — CityLife starter-property selection and identity-bound house projection (PLAYER.HOME.1C)

Status: proposed (dark — behind the fail-closed new-player-journey gate + a default-OFF build flag)

## Why

After the authoritative backend home-purchase contract shipped (kooker-service-user `1.37.3`,
PR #228 — `POST /players/me/home/purchase`, 350 KCO fixed price, server-derived
`starter-home:<userId>` plot/deed, public-neighbourhood-only eligibility), the guided new-player
journey needs its **client** step: let a `CITYLIFE_PLAYER` choose an eligible starter neighbourhood,
buy it, and see their one home appear. The whole slice stays **dark** until operator UAT — it must
never enable a flag, move KCO, create player/deed/home/neighbourhood state, or expose City Builder.

## Mechanic

A guided mobile overlay (`StarterPropertyOverlay`) that:

1. renders **only** the server-returned eligible starter neighbourhoods
   (`GET /players/me/home/eligible-neighbourhoods`, token-derived). A private/inaccessible
   neighbourhood is **omitted by the authority** and so can never appear — the client adds no choice
   of its own and infers nothing from the map, static layout, localStorage or client state;
2. shows the **canonical server price** and the current **server-synced wallet truth** (display only —
   neither is ever submitted);
3. on purchase posts the **selected `neighbourhoodKey` only** (`POST /players/me/home/purchase`) with a
   stable `Idempotency-Key`, and refuses locally — without touching the wire — any key the server did
   not just offer. Identity comes solely from the bearer token; price/owner/frame/deed stay
   server-owned;
4. re-fetches the **authoritative home truth** (`GET /players/me/home` →
   `{owned,status,neighbourhoodKey,plotId,frameId,onboardingState}`) and projects an `OWNED` deed into
   **exactly one** deterministic, identity-bound starter house;
5. advances the journey to the owned state **only** when the authoritative truth says the home is
   owned, and **preserves the legacy entry** whenever the feature is OFF or an entitlement/eligibility
   read fails.

## Rules & data

- **Two gates, both fail-closed.** The step mounts only when the server new-player-journey entitlement
  is a live positive (or the DEV/E2E null-operator bypass) **and** the dark build flag
  `VITE_CITYLIFE_HOME_PURCHASE` is on (this worker never sets it — production stays dark). Absent either
  gate the entry is **absent from the DOM** (not merely hidden) and the legacy entry stands.
- **Response classification (closed set).** `200/201 → owned`, `422 → insufficient_funds` (the deployed
  home shortfall status, distinct from the vehicle flow's 402), `202/409 → pending` (idempotent replay —
  never a second POST), `401/403/503 → disabled` (signed out / feature off / kill switch — never a blind
  retry), else `error`.
- **Deterministic projection (`projectStarterHome`).** A **pure** function of the authoritative deed
  alone: the seed and grid placement are a fixed hash of the server-owned
  `frameId → plotId → neighbourhoodKey` chain, fed through the shared `designHouse` pipeline. No
  `Date.now`, no `Math.random`, no `ColonyState`. Therefore a refresh, a re-login and a second device
  converge on the **same house at the same place**; a double-tap / replay is **idempotent** (one deed →
  one house, never a second or a drifting one). Returns `null` for any non-`OWNED`/malformed truth, so
  the journey never advances on a blip.
- **No client authority.** No localStorage authority anywhere; the projected house is a pure function of
  the re-fetched server truth. City Builder stays inaccessible to `CITYLIFE_PLAYER` (unchanged
  `canEnterCityBuilder` gate).

## Cost

No in-world materials/labour — this is a player-journey UI slice over an existing authoritative backend.
The KCO cost of a starter home is the server's fixed 350 KCO, charged and owned entirely server-side.

## Acceptance

- focused unit tests (dark gate, eligible-list sanitiser, home-truth parser, purchase classifier,
  button-view state machine, idempotency key, local purchase refusals) + projection tests (determinism,
  cross-device/re-login convergence, idempotency, identity binding, OWNED-only, bounded placement);
- full CityLife `typecheck` + `test` + production `build` green;
- mobile-viewport E2E: server-eligible-only render, canonical price + wallet display, private-omission,
  double-tap-idempotent purchase → exactly one owned projection, cross-boot deterministic convergence,
  loading/error/retry, and feature-OFF legacy fallback;
- both rollout gates stay OFF; no KCO moved, no flag/allowlist enabled, no production player/deed/home
  state created, no City Builder exposure.

Implementation: `src/colony/home/starterProperty.ts`, `src/colony/home/starterHouseProjection.ts`,
`src/colony/ui/StarterPropertyOverlay.tsx`, wired in `src/colony/ui/ColonyApp.tsx`. Tests in
`tests/starterProperty.test.ts`, `tests/starterHouseProjection.test.ts`,
`e2e/starter-property-mobile.spec.ts` (+ `e2e/starter-property-mobile.harness.config.ts`, ports
5630-5639). Move to `specs/built/` when it ships.
