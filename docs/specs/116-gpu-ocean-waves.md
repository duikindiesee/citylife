# Spec 116 — GPU ocean waves

QA hardening for the R3F render port (branch `r3f-colony-migration`, qa_report.md item 2).
`R3FOcean` animated the sea by iterating ~3,750 RingGeometry vertices in `useFrame` on the
CPU — three sines per vertex per frame on the main thread. Vertex normals had already been
dropped from that loop ("too slow for CPU each frame"), so the swells were unlit.

## Design

- `src/colony/render/oceanWaves.ts` is the single source of truth for the wave field: the
  EXACT legacy three-wave sum (pinned by tests — changing the numbers changes the sea), a
  GLSL builder for the height expression and its two analytic derivatives, and
  `patchOceanShader` which injects them into a `MeshStandardMaterial` via `onBeforeCompile`:
  `transformed.z` displacement after `begin_vertex`, and `objectNormal` replaced with
  `normalize(vec3(-dz/dx, -dz/dy, 1))` after `beginnormal_vertex`.
- `R3FOcean` keeps its geometry/material memos; `useFrame` now advances ONE uniform
  (`uOceanTime = elapsedTime * 0.5`, the legacy calm-swell time scale). Same idiom as the
  foliage wind sway (`material.userData.shader`).
- Net change: per-frame CPU cost goes from O(vertices) to O(1), and the swells are now lit
  (analytic normals) — the CPU path had none.

## Tests

`tests/oceanWaves.test.ts` (node env, no GPU): wave constants pinned to the legacy field;
height/derivative GLSL carries every term with correct axis split; the patch registers the
uniform at zero, declares it before the body, displaces after `begin_vertex`, replaces the
normal between `beginnormal_vertex` and `begin_vertex`, and generates balanced parentheses.

## Notes

- Geometry disposal on `size` change is unchanged from the legacy component and is in scope
  for the foliage-disposal slice (qa_report.md item 3), not this one.
- The wave field is rendering-only — no sim/engine coupling, no determinism impact.
