# Spec 117 — staged mount (first paint in seconds, not tens of seconds)

Operator report 2026-07-04: the game "loads super slow". Boot profiling (Playwright probe,
prod build served locally) attributed the cost precisely:

| phase                                    | before |
| ---------------------------------------- | ------ |
| canvas in DOM                            | 1.4s   |
| worldgen done (`window.__colony`)        | 1.5s   |
| R3F tree committed (`window.__r3fScene`) | 10.0s  |
| first real frame (canvas sized)          | 17.1s  |

The sim and worldgen are fast. ~16 of ~18 seconds went to mounting the ENTIRE R3F tree in
one synchronous commit — terrain chunk build, foliage scan, road meshes, zone meshes,
shore/venue props, physics, and the postprocessing shader compiles — before the player saw
anything. Dev-server overhead was ~1s (measured dev vs prod: 18.1s vs 17.1s).

## Design

`src/colony/render/bootStage.ts` — pure, node-testable stage progression keyed on
PRESENTED frames (never wall-clock, never blocking the first paint):

- **Stage 0** (first commit): terrain, ocean, day/night lights, physics floor, camera —
  the world exists.
- **Stage 1** (after `BOOT_STAGE_FRAMES.city` presented frames): roads, zones, foliage,
  player car, foam — the city arrives.
- **Stage 2** (after `BOOT_STAGE_FRAMES.dressing`): shore/venue props, clouds, contact
  shadows, postprocessing (Bloom + ACES) — the polish lands.

`useBootStage()` in `R3FPlanetRenderer.tsx` counts frames in `useFrame` and advances via
`nextBootStage`. The shore/venue props memo is also stage-gated — building those during
the first commit was part of the blockage.

## Measured result (same probe, prod build)

| phase              | before | after    |
| ------------------ | ------ | -------- |
| R3F tree committed | 10.0s  | **2.5s** |
| first real frame   | 17.1s  | **2.6s** |

The stage-1/2 mounts still cost their build time, but they land AFTER the player is
looking at a live world (brief hitches at frames ~5 and ~20 in exchange for a 6.5x faster
first paint). Chunking the foliage/zone builds across frames is a possible future
refinement if the hitches ever matter.

## Tests

`tests/bootStage.test.ts` — progression is monotonic, frame-gated, and terminal.
Full vitest + Playwright suites green (first_plot's pre-existing machine timeout aside —
this slice plausibly helps it by shortening the boot it waits through).

## Notes

- The single >500 kB bundle chunk is a SEPARATE lever that matters for remote users behind
  the ngrok tunnel (code-splitting) — not addressed here.
- Rendering-only; no sim/engine coupling.
