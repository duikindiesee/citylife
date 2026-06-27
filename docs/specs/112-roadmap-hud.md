# Spec 112 — KOOKER Roadmap HUD

Status: SLICE 3 BUILT · Date: 2026-06-27 · Owner: Joe / Player & UI

## Slice 3 scope

Add an in-world Roadmap HUD panel that is bound to `src/colony/roadmap.ts` and opens from KOOKER beacon proximity/click in first-person play.

## Acceptance

- Roadmap data lives in `src/colony/roadmap.ts`.
- Groups render in this order: Shipped, Merging, Next, Later, Parallel.
- The first-person action cluster shows a bot-drivable Roadmap button when the active interaction prompt is KOOKER.
- The panel uses selectors:
  - `data-roadmap-action="open-from-kooker-beacon"`
  - `data-roadmap-action="close"`
  - `data-roadmap-panel="open"`
  - `data-roadmap-phase="shipped|merging|next|later|parallel"`
  - `data-roadmap-item="..."`
- Mobile-safe panel layout is handled in `colony.css` with a bottom-sheet style breakpoint.
- Day and night in-world proof must show the panel over the live world.
