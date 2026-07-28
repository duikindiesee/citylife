# Spec 158 — Performance instrumentation: debug HUD, movement traces, and the first-person frame budget

- **Status:** built
- **Relates to:** spec 127 (road ribbons — the last perf win, and the source of
  `docs/VERIFY-GPU.md`), spec 152 (spatial registry; the HQ street door is the sole streaming
  boundary), spec 153 (props hydrate per wing segment — the residency budget)
- **Origin:** operator report PERF.FP.JITTER.1 — "first-person play is jittery", confirmed
  LONG-STANDING, not introduced by the spec-146 walker ground fix (PR #410)

## 1. Why this spec exists

Three previous investigations in this lane fixed a plausible cause before measuring it, and
two of those fixes made the game measurably worse and were reverted. The lesson is not "try
harder"; it is that the repository had **no way to measure a frame**. `docs/VERIFY-GPU.md`
could count frames over four seconds, which is enough to tell 3 FPS from 60 FPS but tells you
nothing about *where a frame went*, and nothing at all about a stutter — a stutter is a
property of the worst 1% of frames, and an average hides it by construction.

So this spec ships the instrument first and the conclusion second:

1. an in-world **debug HUD**, off by default, showing frame time, FPS, 1% lows, the CPU/GPU
   split, draw calls, triangles, resident instance counts and the physics step cost;
2. a **movement trace** recorder and a deterministic replay, so a stutter can be reproduced
   and A/B-ed instead of described;
3. **measurement knobs** so a candidate cause can be switched off and weighed *without
   editing the renderer* — otherwise every hypothesis test is itself a code change, and the
   "before" is gone before you have measured it.

## 2. What ships

| Module | Role |
| --- | --- |
| `src/colony/perf/perfFlags.ts` | Arming. `?perf=1` (HUD visible), `?perf=armed` (armed, hidden), `localStorage citylife.perf`. Default **off**. |
| `src/colony/perf/perfMonitor.ts` | Fixed-size frame-sample ring + the statistics (p50/p95/p99, 1% low, spike count, shadow-frame split). Framework-agnostic. |
| `src/colony/perf/gpuTimer.ts` | Real GPU frame time via `EXT_disjoint_timer_query_webgl2`; reports `-1` where unavailable. |
| `src/colony/perf/movementTrace.ts` | Trace format, recorder, deterministic time-sampled replay, and a closed-form canonical walk. |
| `src/colony/perf/sceneCensus.ts` | Resident-instance census: instances per layer and how many cast shadows. |
| `src/colony/perf/perfExperiment.ts` | The measurement knobs (`window.__perfExperiment`). Every knob defaults to shipped behaviour. |
| `src/colony/perf/perfSession.ts` | Ties them together; publishes `window.__perf`. |
| `src/colony/perf/PerfHudOverlay.tsx` | The HUD, mounted into its own DOM root (not into `ColonyApp`). |
| `src/colony/render/R3FPerfProbe.tsx` | The renderer-side hookup: patches the draw submission and the Rapier step, samples each frame. |
| `src/colony/ui/worldLayoutOperatorCapture.ts` | The fix: gates the world-layout capture on the operator surface that displays it being on screen. |
| `scripts/perf-trace-probe.mjs` | The automated harness: boots on a real GPU, replays the canonical trace, prints the numbers. Also `--bisect`, `--host-bisect`, `--emit-anatomy`, `--profile`, `--raw-fps`. |

Everything is inert when the flag is off: the probe mounts, sees no session, and returns
before it patches anything.

### The frame split

```
frameMs  = start of frame N -> start of frame N+1     (what the player feels)
cpuMs    = start of frame   -> first draw submission  (useFrame bodies, physics, walker)
drawMs   = CPU time inside renderer.render (all passes)
gpuMs    = GPU time for the scene render (timer query)
waitMs   = frameMs - cpuMs - drawMs                   (blocked: GPU / present / off-loop work)
```

`waitMs` is the important derived number and it is why the split is measured rather than
assumed: a frame that is 130 ms long with 1 ms of JS in it is not a CPU problem, and no
amount of optimising the walker will move it.

### Replay is pose-driven

Re-simulating recorded *input* through Rapier cannot be bit-exact — the step consumes
wall-clock deltas, so two runs diverge within a second and stop being comparable. Replay
therefore drives the walker from the recorded **pose** track, which reproduces the exact
camera path, which is what determines the render workload, which is what an A/B is comparing.
The input track is recorded anyway for a future physics-determinism harness.

## 3. Measured findings (PERF.FP.JITTER.1)

Machine: kooker1, AMD Radeon iGPU, ANGLE/D3D11, headless Chromium with
`--enable-gpu --use-angle=d3d11 --ignore-gpu-blocklist`, viewport 1600x900, seed 4242,
12-second canonical walk, 60 warm-up frames discarded. Renderer string verified as hardware
on every run (a SwiftShader number is refused by the harness).

### 3.1 It is not the CPU, and it is not the walker

| | baseline |
| --- | --- |
| fps mean / 1% low | 6.4 / 1.7 |
| frame p50 / p99 / max | 258.9 / 592.2 / 592.2 ms |
| **cpu (frame start -> first draw)** | **1.23 ms** |
| draw submit | 18.67 ms |
| gpu (scene, timer query) | 19.83 ms |
| **physics step (Rapier)** | **0.13 ms** |
| **wait / present** | **136.49 ms** |

Candidate 1 is answered: the first-person frame spends **1.2 ms** in JavaScript and **0.13 ms**
in physics. Ground sampling, `leveledWorldYAt`, the walker capsule and the sim step are not
the stutter and cannot be. Roughly **93% of the frame is spent blocked**, not working.

### 3.2 Foliage residency is NOT the cause — measured, not assumed

The task named foliage residency as the leading candidate: 75,486 instances fully resident on
seed 4242, all of them shadow casters. The census confirms the count (75,188 foliage instances
of 75,234 total, all castShadow). The cost does not.

| run | knob | fps mean | frame p50 | triangles |
| --- | --- | --- | --- | --- |
| A baseline | shipped | 6.4 | 258.9 ms | 1,252,532 |
| B | `shadows=false` (shadow map never refreshed) | 6.5 | 249.5 ms | 1,067,513 |
| C | `foliageShadow=false` (75k casters removed from the shadow pass) | 6.4 | 254.2 ms | 1,058,610 |
| D | `foliage=false` (**the whole 75k-instance layer removed**) | 6.9 | 242.6 ms | 314,594 |
| E | `postProcessing=false` (no Bloom / tone mapping) | 6.5 | 250.4 ms | 1,254,047 |

Deleting every conifer in the world — three quarters of a million triangles, 75,188 shadow
casters — buys **0.5 fps**. Distance culling, LOD or streamed hydration of foliage would have
been a large change to the residency model for no measurable gain, and would have been the
fourth "plausible cause fixed before it was measured" in this lane. **Do not implement foliage
residency for performance reasons.** If it is wanted for another reason, that is a different
spec with a different justification.

The shadow-cadence hypothesis was equally attractive and equally wrong. The frame trace shows
a clean 4-frame period (`gl.shadowMap.needsUpdate` is set every 4th frame in
`DayNightCycle`), and shadow frames average 285 ms against 115 ms for the rest — so the
cadence *looks* exactly like the cause. Switching the shadow refresh off entirely (run B)
changes nothing. The periodicity is real; the causation is not.

### 3.3 It is not fill rate, and the harness is not the ceiling

`--host-bisect`, same session, 4-second windows:

| probe | fps | frame mean |
| --- | --- | --- |
| control | 7.8 | 127.5 ms |
| React UI root `display:none` | 7.8 | 127.5 ms |
| sim paused (`runtime.setPaused`) | 7.6 | 131.7 ms |
| viewport 1024x576 | 7.9 | 126.6 ms |
| viewport 640x360 | 7.7 | 130.6 ms |
| **viewport 320x180** | **8.1** | **123.6 ms** |
| blank page, rAF ceiling | 60.2 | — |
| trivial 1600x900 WebGL2 clear-only canvas | 60.3 | — |
| the game with NO instrumentation at all (`?skipauth=1`, plain rAF count) | 7.5 / 7.6 | — |

Three controls that the earlier investigations never had:

- shrinking the render target by **25x** changes nothing, so it is not fill rate;
- a trivial WebGL canvas in the same browser at the same size hits **60.3 fps**, so it is not
  the harness's present path;
- the page with the perf flag *off entirely* is equally slow, so it is not the instrument
  measuring itself.

A cost that is invariant to both resolution and geometry, with ~1 ms of JavaScript in the
render window, is not rendering work at all.

## 4. The cause, named

`--host-bisect` again, with one more probe:

| probe | fps | frame mean | p99 |
| --- | --- | --- | --- |
| control | 7.8 | 127.5 ms | 268.5 ms |
| **UI heartbeat stubbed (`runtime.emit` no-op)** | **60.2** | **16.6 ms** | **18.7 ms** |

`--emit-anatomy`, 5-second windows, `PerformanceObserver('longtask')`:

| | long tasks | total | longest |
| --- | --- | --- | --- |
| control | 22 | 4,849 ms | 254 ms |
| emit stubbed | 0 | 0 ms | 0 ms |

**97% of the main thread was inside long tasks**, each ~200-254 ms, arriving at the 200 ms
heartbeat's cadence. `getUiState()` — the obvious suspect — costs **0.04 ms** and is not
involved.

The CDP sampling profile names the call chain outright:

```
ColonyApp > captureWorldLayout > seededWorldSurvey > createWorldSurvey > addRoadNetwork   12.9%
ColonyApp > captureWorldLayout > createWorldLayoutDocument > parseV1 > placement > cells   3.3%
ColonyApp > captureWorldLayout > ... > createWorldLayoutDocument > contentHashForCanonical > canonicalJson
ColonyApp > captureWorldLayout > ... > createWorldLayoutDocument > contentHashForCanonical > sha256
```

**`ColonyApp` called `runtime.captureWorldLayout()` directly from its render body.** That call
rebuilds the seeded world survey, canonically serialises the entire world-layout document and
SHA-256 hashes it — ~220 ms on seed 4242. `ColonyRuntime.loop` fires `emit()` every 200 ms,
`ColonyApp` subscribes with a bare `forceRuntimeRender`, so the whole document was rebuilt and
re-hashed **five times a second**. Each render took longer than the interval between renders,
so the main thread never came up for air, and the frame loop got whatever was left — which is
the observed 8 ms / 260 ms alternation and the 1.7 fps 1% low.

It is long-standing (it arrived with the spec-152 world-layout work, not with the walker
ground fix), it is invisible to every renderer-side probe, and it is exactly the kind of cause
that three previous investigations could not have found without an instrument.

### 4.1 The fix

`src/colony/ui/worldLayoutOperatorCapture.ts` gates the capture on the condition under which
its result can actually be seen. The captured document is used for one thing: comparing its
content hash to the durable head so the operator's revision controls can read "clean" or
"dirty". Those controls render only inside the City Builder / World View chrome —
`BuilderPanel` returns early otherwise. While the player is walking around, the document was
being built, hashed and discarded unobserved.

So this is not a throttle or a heuristic: when the gate is false the output is unobservable,
which is why skipping it cannot change behaviour. Save, export, rollback and import each
re-capture at click time, so operator actions still work against a live document.

### 4.2 Before / after — the same recorded trace, replayed

Identical canonical 12-second walk, same machine, same harness, 60 warm-up frames discarded:

| | before | after | |
| --- | --- | --- | --- |
| fps mean | 6.4 | **50.6** | 7.9x |
| fps 1% low | 1.7 | **7.3** | 4.3x |
| frame p50 | 258.90 ms | **16.90 ms** | 15.3x |
| frame p95 | 308.60 ms | **30.80 ms** | 10.0x |
| frame p99 | 592.20 ms | **40.60 ms** | 14.6x |
| frames >33 ms | 41 of 78 (52.6%) | **22 of 608 (3.6%)** | |
| frames rendered in the 12 s trace | 78 | **608** | |
| cpu (frame start -> first draw) | 1.23 ms | 0.77 ms | |
| physics step | 0.13 ms | 0.08 ms | |
| long tasks per 5 s | 22, totalling 4,849 ms | **0, totalling 0 ms** | |

Scene content is byte-identical across the two runs — 75,234 instances, 75,227 of them shadow
casters, ~1.23 M triangles. Nothing was removed from the world.

Two things worth noting in the "after" column. The shadow split is now
19.68 ms on shadow frames against 19.79 ms on the others — the periodic pattern that looked so
much like the cause in section 3.2 is, with the real cause gone, worth **nothing**, exactly as
run B predicted. And the replay's follow error dropped from 0.64 m to 0.01 m, because a
pose-driven replay tracks its trace far more tightly when frames are 17 ms apart than when
they are 260 ms apart.

`frame max` is still 468 ms: a single one-off stall near the start of the walk, which the
`drawMs` series attributes to a shader compile on first draw of a newly visible material. That
is a warm-up cost, not a steady-state stutter, and it is the next thing to look at with this
instrument.

**Known follow-up, with a number:** with the builder or world view OPEN, the capture still
runs once per heartbeat and the ~220 ms cost returns. The correct fix there is to cache the
capture in the runtime against a change epoch, which needs the full set of inputs to
`captureWorldLayout()` audited (seeded survey, terrain edits, roads, road ways, layout frames,
portals, zoned placements) — out of scope here, and not worth guessing at, which is the whole
lesson of this lane.

## 5. Using it

```
# HUD, in a dev session
http://localhost:5188/?skipauth=1&perf=1        # F9 toggles

# Automated measurement (ports 5630-5639 are the governed worker's range)
node scripts/perf-trace-probe.mjs --port 5631 --seconds 12 --label before --out before.json
node scripts/perf-trace-probe.mjs --port 5631 --set foliage=false --label no-foliage
node scripts/perf-trace-probe.mjs --port 5631 --bisect          # per-layer attribution
node scripts/perf-trace-probe.mjs --port 5631 --host-bisect     # outside the WebGL scene

# From the console / Playwright
window.__perf.startRecording("my-walk"); /* walk about */ const trace = window.__perf.stopRecording();
const result = await window.__perf.runTrace(trace);   // replays it and returns the stats
```

Read `docs/VERIFY-GPU.md` first: a number produced under SwiftShader is a floor, never a
measurement, and the harness refuses to report one without `--allow-software`.

## 6. What this cost, and the rule it earns

Four of the five candidates on the task list were wrong, and every one of them was plausible:
the 75,486 resident foliage instances, their shadow casting, the 4-frame shadow cadence with
its textbook periodic spike, and the post-processing stack. Each would have been a defensible
"fix" and none of them would have moved the frame time — which is precisely what happened to
this lane three times before.

The rule this earns: **in this repository, a performance change must quote a before and an
after from `scripts/perf-trace-probe.mjs`, on the same trace, with the renderer string
verified as hardware.** A hypothesis without those numbers is not evidence, no matter how
plausible the mechanism or how clean the periodicity looks in a frame trace.
