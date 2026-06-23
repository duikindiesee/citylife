# Spec 089 — Furniture arrangement: rearrange your house, any time

- status: building
- proposed-by: irwin (operator /loop directive 2026-06-22: furniture placement after the house is built,
  arrangeable whenever the player feels like it) + claude
- date: 2026-06-22
- depends-on: 088 (the furniture epic — `item{}` DSL, inventory, place-into-house, marketplace)
- branch: `feat/furniture-arrange` (PR into PROTECTED main)

## Why

Spec 088 Slice E let a player DROP an owned piece into their house at an auto-chosen cell — a one-shot
that consumed inventory and could not be undone or moved. This makes furniture a living layout you
rearrange after the house is built, **whenever you feel like it**: slide a piece to a new spot, rotate
it, move it between floors, or take it back out.

## The runtime arrangement API (this slice — backend)

All ops act on a lot you OWN that already has a blueprint, and rebuild the house through the validated
`applyBlueprint(…, null)` path (the `null` skips the "redesigned their home" Kookerbook post, so
shuffling furniture is quiet). Each placed piece is an `item{kind x y rot z}` token in the blueprint;
`placedFurniture` hands back its array index as the handle.

- **`placedFurniture(lotId)`** — the pieces currently in the house, each with `{index, kind, x, y, rot, z}`.
- **`moveArrangedFurniture(citizenId, lotId, index, dx, dy)`** — slide a piece (clamped to the footprint).
  Free; no inventory change.
- **`rotateArrangedFurniture(citizenId, lotId, index)`** — quarter-turn clockwise. Free.
- **`restackArrangedFurniture(citizenId, lotId, index, dz)`** — move a piece up/down a floor (clamped to
  the design's storeys). Free — the multi-level (088 B) arrange reaches every floor.
- **`removeArrangedFurniture(citizenId, lotId, index)`** — take a piece out and RETURN it to inventory
  (so it can be re-placed or sold). The piece returns as its catalog **kind** — the blueprint does not
  store the custom name, so a once-named "Cozy Couch" comes back a plain sofa. (A `name` field on the
  `item{}` DSL would preserve identity through a round-trip — a future enhancement.)

Move/rotate/restack never touch inventory (pure rearrangement); only remove returns the piece. Each edit
reuses the spec 077/088 `blueprintEdit` pure ops (`moveItem`/`rotateItem`/`moveItemStorey`/`removeItem`),
which clamp/normalize so the rebuilt blueprint always validates. Ownership-gated; idempotent no-op on an
out-of-range handle; `removeArrangedFurniture` refuses (returns nothing) on a bad index or a lot you do
not own.

## Verification

`tests/furnitureArrange.test.ts` (6): placedFurniture listing, move (+ownership refusal), rotate, restack
between floors (+clamp), remove→inventory (+out-of-range no-op + ownership refusal). 849 tests green, tsc
clean. Single-agent adversarial review: **0 real defects**.

## The arrange UI (DONE — commit `7a25164`)

A **"Rearrange home"** subsection in the HUD Furniture studio panel (`ColonyApp.tsx`), shown for the
signed-in player's own house. It lists `runtime.placedFurniture(myLot.id)`; each piece is a compact row
(icon + kind + cell + floor) with controls: **move ←→↑↓** (`moveArrangedFurniture` deltas), **rotate ↻**
(`rotateArrangedFurniture`), **floor ▲▼** (`restackArrangedFurniture`, shown only when
`runtime.houseStoreys(lotId) > 1`), and **remove ✕** (`removeArrangedFurniture` → back to inventory).
Every control carries a `data-build-action` (`arrange-move-${i}-${dir}` / `arrange-rotate-${i}` /
`arrange-floor-${i}-up|down` / `arrange-remove-${i}`). New `runtime.houseStoreys(lotId)` gates the floor
controls. `.arrange-btn` CSS.

**Live-verified** on the dev server: a two-storey house with two placed pieces rendered all 16 controls;
clicking them slid the sofa, rotated it, moved it up a floor, and removed the lamp back to inventory —
no console errors. 849 tests green, tsc clean. Adversarial review: 0 defects.

**FEATURE COMPLETE** (runtime + UI) on PR #73.

## Optional future enhancement

A `name` field on the `item{}` DSL so a placed piece keeps its custom name (a removed "Cozy Couch" comes
back as a plain sofa today, since the blueprint stores only the kind). The DSL is space-delimited, so a
free-text name needs encoding (slug or escaped spaces) — deferred as fiddly polish, not part of the core
"arrange whenever" ask.
