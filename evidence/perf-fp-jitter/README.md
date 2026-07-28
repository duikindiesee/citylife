# PERF.FP.JITTER.1 — raw probe output

Machine kooker1, AMD Radeon iGPU via ANGLE/D3D11, headless Chromium with
`--enable-gpu --use-angle=d3d11 --ignore-gpu-blocklist`, viewport 1600x900, seed 4242.
Every run verified the renderer string as hardware; the harness refuses a SwiftShader number.
Produced by `scripts/perf-trace-probe.mjs` (spec 158). JSON alongside each section.

## A — baseline, shipped code (12 s canonical walk)

```
overrides        {}
frames           78
fps mean         6.4
fps 1% low       1.7
frame p50/p95/p99 258.9 / 308.6 / 592.2 ms
spikes >33ms     41 (52.6%)
cpu pre-draw     1.23 ms
draw submit      18.67 ms
physics step     0.13 ms
triangles        1252532
instances        75234 (75227 shadow casting)
```

## B — shadow map never refreshed

```
overrides        {"shadows":false}
frames           78
fps mean         6.5
fps 1% low       1.6
frame p50/p95/p99 249.5 / 312.0 / 642.8 ms
spikes >33ms     42 (53.8%)
cpu pre-draw     1.38 ms
draw submit      19.18 ms
physics step     0.14 ms
triangles        1067513
instances        75234 (75227 shadow casting)
```

## C — foliage removed from the shadow pass

```
overrides        {"foliageShadow":false}
frames           78
fps mean         6.4
fps 1% low       1.6
frame p50/p95/p99 254.2 / 323.1 / 638.8 ms
spikes >33ms     41 (52.6%)
cpu pre-draw     1.47 ms
draw submit      18.98 ms
physics step     0.15 ms
triangles        1058610
instances        75234 (39 shadow casting)
```

## D — the whole 75k-instance foliage layer removed

```
overrides        {"foliage":false}
frames           84
fps mean         6.9
fps 1% low       1.5
frame p50/p95/p99 242.6 / 278.7 / 651.0 ms
spikes >33ms     43 (51.2%)
cpu pre-draw     1.27 ms
draw submit      18.14 ms
physics step     0.15 ms
triangles        314594
instances        46 (39 shadow casting)
```

## E — no Bloom / tone mapping

```
overrides        {"postProcessing":false}
frames           78
fps mean         6.5
fps 1% low       1.4
frame p50/p95/p99 250.4 / 321.6 / 712.8 ms
spikes >33ms     41 (52.6%)
cpu pre-draw     1.09 ms
draw submit      19.18 ms
physics step     0.13 ms
triangles        1254047
instances        75234 (75227 shadow casting)
```

## AFTER the fix — same canonical walk

```
frames           608
fps mean         50.6
fps 1% low       7.3
frame p50/p95/p99 16.9 / 30.8 / 40.6 ms
spikes >33ms     22 (3.6%)
cpu pre-draw     0.77 ms
draw submit      9.54 ms
gpu (scene)      9.27 ms
physics step     0.08 ms
shadow vs other  19.68 ms vs 19.79 ms
triangles        1231878
instances        75234 (75227 shadow casting)
```

## Host bisect — outside the WebGL scene (4 s windows)

```
host bisect (outside the WebGL scene)
  control                               7.8 fps    127.5 ms  p99   268.5 ms  cpu 1.1  draw 5.3
  react UI root display:none            7.8 fps    127.5 ms  p99   348.2 ms  cpu 0.8  draw 5.0
  sim paused (runtime.setPaused)        7.6 fps    131.7 ms  p99   284.9 ms  cpu 1.1  draw 5.2
  ui heartbeat stubbed (no emit)       60.2 fps     16.6 ms  p99    18.7 ms  cpu 0.8  draw 4.3
  navigator.getGamepads stubbed         8.6 fps    116.5 ms  p99   264.5 ms  cpu 0.9  draw 4.7
  viewport 1024x576                     7.9 fps    126.6 ms  p99   275.0 ms  cpu 1.0  draw 4.7
  viewport 640x360                      7.7 fps    130.6 ms  p99   275.0 ms  cpu 0.8  draw 4.5
  viewport 320x180                      8.1 fps    123.6 ms  p99   256.8 ms  cpu 0.9  draw 4.1
  blank-page rAF ceiling               60.2 fps
```

## Resolution sweep + harness ceilings

```
host bisect (outside the WebGL scene)
  control                               7.9 fps    127.3 ms  p99   259.7 ms  cpu 1.1  draw 5.8
  react UI root display:none            7.5 fps    133.9 ms  p99   301.5 ms  cpu 0.9  draw 5.1
  sim paused (runtime.setPaused)        7.6 fps    131.0 ms  p99   260.8 ms  cpu 1.0  draw 5.4
  viewport 1024x576                     7.7 fps    130.2 ms  p99   280.3 ms  cpu 1.0  draw 4.9
  viewport 640x360                      7.8 fps    127.6 ms  p99   267.5 ms  cpu 0.9  draw 4.8
  viewport 320x180                      8.0 fps    124.5 ms  p99   257.6 ms  cpu 0.9  draw 4.5
  blank-page rAF ceiling               60.1 fps

raw rAF fps (NO instrumentation): 7.8 then 7.8  · renderer ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)
raw rAF fps (NO instrumentation): 7.5 then 7.6  · renderer ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)
trivial 1600x900 WebGL2 clear-only canvas: 60.3 fps
```

## Long-task anatomy of the UI heartbeat (5 s windows)

```
BEFORE:
emit anatomy (5 s windows)
  control                         22 long tasks,  4849 ms total, longest 254 ms
  emit stubbed                     0 long tasks,     0 ms total, longest 0 ms
  getUiState() alone            0.04 ms per call

AFTER:
emit anatomy (5 s windows)
  control                          0 long tasks,     0 ms total, longest 0 ms
  emit stubbed                     0 long tasks,     0 ms total, longest 0 ms
  getUiState() alone            0.06 ms per call
```

## CPU profile — heaviest call chains (before the fix)

```
cpu profile — top self time (13329 samples)
   12.9%  addRoadNetwork                     colony/worldSurvey.ts:402
    3.3%  cells                              spatial/worldLayoutDocument.ts:234
    3.1%  (garbage collector)                :0
    3.0%  cells                              spatial/worldLayoutDocument.ts:234
    2.6%  canonicalJson                      spatial/worldLayoutDocument.ts:848
    2.5%  sha256                             spatial/worldLayoutDocument.ts:723
    2.5%  sha256                             spatial/worldLayoutDocument.ts:723
    2.5%  sha256                             spatial/worldLayoutDocument.ts:723
    2.5%  sha256                             spatial/worldLayoutDocument.ts:723
    2.5%  sha256                             spatial/worldLayoutDocument.ts:723
    2.5%  sha256                             spatial/worldLayoutDocument.ts:723
    2.5%  canonicalJson                      spatial/worldLayoutDocument.ts:848
    2.5%  canonicalJson                      spatial/worldLayoutDocument.ts:848
    2.4%  canonicalJson                      spatial/worldLayoutDocument.ts:848
    2.4%  canonicalJson                      spatial/worldLayoutDocument.ts:848
    2.4%  canonicalJson                      spatial/worldLayoutDocument.ts:848
    2.4%  canonicalJson                      spatial/worldLayoutDocument.ts:848
    1.9%  placement                          spatial/worldLayoutDocument.ts:265
    1.8%  placement                          spatial/worldLayoutDocument.ts:265
    1.8%  cells                              spatial/worldLayoutDocument.ts:234

heaviest call chains
   12.9%  renderRootSync > workLoopSync > performUnitOfWork > runWithFiberInDEV > run > beginWork > updateFunctionComponent > renderWithHooks > react_stack_bottom_frame > ColonyApp > captureWorldLayout > seededWorldSurvey > createWorldSurvey > addRoadNetwork
    3.8%  (root)
    3.3%  performUnitOfWork > runWithFiberInDEV > run > beginWork > updateFunctionComponent > renderWithHooks > react_stack_bottom_frame > ColonyApp > captureWorldLayout > createWorldLayoutDocument > parseV1 > (anon) > placement > cells
    3.0%  run > beginWork > updateFunctionComponent > renderWithHooks > react_stack_bottom_frame > ColonyApp > captureWorldLayout > captureWorldLayoutDocument > captureWorldLayoutDocumentWithProvenance > createWorldLayoutDocument > parseV1 > (anon) > placement > cells
    2.6%  beginWork > updateFunctionComponent > renderWithHooks > react_stack_bottom_frame > ColonyApp > captureWorldLayout > createWorldLayoutDocument > parseV1 > contentHashForCanonical > canonicalJson > (anon) > canonicalJson > (anon) > canonicalJson
    2.5%  performUnitOfWork > runWithFiberInDEV > run > beginWork > updateFunctionComponent > renderWithHooks > react_stack_bottom_frame > ColonyApp > captureWorldLayout > captureWorldLayoutDocument > captureWorldLayoutDocumentWithProvenance > createWorldLayoutDocument > contentHashForCanonical > sha256
```
