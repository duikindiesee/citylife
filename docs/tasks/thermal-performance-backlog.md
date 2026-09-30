# Thermal Load & Frame Throttling Task Backlog

- **Status:** recorded / backlog
- **Origin:** Operator feedback ("my pc is getting very hot")
- **Context:** Player reported elevated PC temperatures while running CityLife in browser sessions.

---

## 1. Problem Statement & Root Cause Analysis

In 3D WebGL applications using Three.js and React Three Fiber (`@react-three/fiber`), `requestAnimationFrame` continuously drives the render loop at the display's maximum native refresh rate (e.g. 120Hz, 144Hz, or 240Hz on high-refresh gaming monitors) without an internal frame cap or idle sleep.

When a player minimizes the browser, switches tabs, or leaves the game running while inspecting menus or modals, the GPU and CPU may continue rendering full-resolution passes (cascaded shadow maps, Bloom post-processing passes, dynamic lights). This sustained draw-call and fill-rate pressure elevates GPU core temperatures and causes thermal throttling.

---

## 2. Deliverable Tasks & Acceptance Criteria

### Task PERF-THRM-01: Page Visibility & Window Focus Throttling

- **Scope:** Add event listeners for `document.visibilityState` (`visibilitychange`) and `window.onblur`/`window.onfocus` in the root renderer mount (`R3FPlanetRenderer` / `CityRenderer`).
- **Acceptance Criteria:**
  - When `document.visibilityState === 'hidden'`, throttle R3F render loop to a dormant state (e.g. 5-10 FPS or pause `invalidate()`).
  - When the browser tab regains active focus, resume standard 60 FPS presentation immediately with 0 visual hitching.

### Task PERF-THRM-02: Target Frame Rate & Eco Mode Setting

- **Scope:** Provide an optional frame-rate limiter in settings / localStorage (`citylife.target_fps`: `30`, `60`, `uncapped`).
- **Acceptance Criteria:**
  - On 120Hz+ displays, capping to 60 FPS prevents unnecessary 2x-4x GPU power draw.
  - An "Eco Mode" toggle reduces postprocessing bloom iterations and shadow map resolution from 2048 to 1024.

### Task PERF-THRM-03: Static Camera Sleep / Demand-Based Rendering

- **Scope:** When operator car and camera velocity is 0 and no dynamic particle effects are active, drop rendering to on-demand invalidation rather than continuous spinning.
- **Acceptance Criteria:**
  - Verified idle GPU utilization drops by >50% when stationary.
