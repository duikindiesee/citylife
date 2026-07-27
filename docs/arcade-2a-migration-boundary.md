# ARCADE.2A — existing-world migration boundary (decision + governed follow-up)

## Decision

The authenticated Gamehouse venue (`citylife-arcade-3d-v1`) is appended to a world **only on the fresh
seed path** — when a `ColonyRuntime` builds a new layout with no active/hydrated document. A world
**hydrated from a durable layout that was persisted before this feature** is carried through verbatim and
is **intentionally NOT backfilled** with the venue.

This is a deliberate boundary, not an accidental gap.

## Why exclusion (not a backfill) for this slice

- **Zero user-facing impact today.** `citylife-arcade-3d-v1` is globally OFF and fail-closed. No player —
  entitled or not — can see or enter the venue until the server enables the flag per user/cohort. An
  un-migrated world is therefore behaviourally identical to a migrated one for every user right now.
- **Scope + safety.** An on-hydration backfill would mutate the durable spatial layout of every existing
  persisted world (new frames, portals, cabinet placement anchored on the plot door). That carries
  collision and determinism risk against already-persisted coordinates and is exactly the kind of
  authoritative-spatial-contract change that must land in its own reviewed slice, not be smuggled into a
  flag-wiring PR.
- **Reversible + observable.** The boundary is explicit in code (`withSeedGamehouseVenue`) and locked by a
  deterministic exclusion test, so lifting it later is a conscious, reviewed decision.

## Where it lives

- Code: `src/colony/runtime.ts` → `withSeedGamehouseVenue` (seed-only append, fail-safe, idempotent).
- Test lock: `tests/gamehousePortalRuntime.test.ts` →
  "existing hydrated worlds are intentionally NOT backfilled" proves a hydrated pre-feature world is not
  fabricated a venue on re-capture.

## Governed follow-up (deferred, not dropped)

When/if the flag moves toward broad enablement, implement a **deterministic, idempotent, fail-safe
backfill** on hydration for worlds whose commercial district fronts the `kooker_gamehouse` plot but whose
durable layout predates the venue:

- Reuse `withGamehousePortal` / `withGamehouseInterior` (already idempotent + preserves every existing
  island id and coordinate).
- Fail SAFE exactly like the seed path (no plot / collision / authoring error ⇒ leave the world
  untouched, never block hydration).
- Recompute the layout revision content-hash and add round-trip tests proving no pre-existing
  frame/portal/placement id or coordinate changes.

This follow-up must be tracked on the CityLife governed queue before the flag is enabled for real users.
