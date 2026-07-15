# GPU-enabled render verification (FPS probes + framed screenshots)

How to measure REAL rendering performance and capture meaningful screenshots of the R3F
world from automation. Written down after the spec-127 road rebuild, where these probes
produced the numbers that justified the change (3.2 → 60.4 FPS).

## Why plain headless is not enough

- **The preview/embedded browser tab is usually backgrounded** (`document.visibilityState ===
  'hidden'`). `requestAnimationFrame` never fires in a hidden tab, so the R3F canvas never
  mounts, `window.__r3fScene` never appears, and every scene probe times out. If a probe
  hangs but a trivial eval works, check `document.visibilityState` FIRST.
- **Default Playwright headless renders with SwiftShader** (software GL). It is fill-rate
  bound, not draw-call bound — a scene that jumps 3→60 FPS on a real GPU only moves 0.9→1.5
  FPS under SwiftShader. Software FPS is a floor, never the number to report.

## The GPU probe

Launch chromium headless WITH the GPU (works on this Windows/AMD box; verify the renderer
string before trusting any number):

```js
import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5188/');
// ALWAYS confirm you are on the real GPU, not SwiftShader:
const gl = await page.evaluate(() => {
  const g = document.createElement('canvas').getContext('webgl2');
  const ext = g.getExtension('WEBGL_debug_renderer_info');
  return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
// expect e.g. "ANGLE (AMD, AMD Radeon(TM) Graphics ... Direct3D11 ...)" — NOT "SwiftShader"
```

FPS measurement (run only after the world settled — wait for `__r3fScene`, the stage-1
groups, then a few seconds):

```js
const fps = await page.evaluate(() => new Promise((res) => {
  let frames = 0; const t0 = performance.now();
  (function tick() {
    frames++;
    performance.now() - t0 < 4000 ? requestAnimationFrame(tick)
      : res(frames / ((performance.now() - t0) / 1000));
  })();
}));
```

For a fair before/after: same machine, same probe, same view, both branches (switch the
worktree branch between runs; the dev server serves whatever is checked out).

## Framing screenshots on what you assert

The R3F default camera is NOT a scene child — you cannot reach it by traversing
`__r3fScene`. `SceneProbe` (R3FPlanetRenderer.tsx, spec 127) therefore exposes:

- `window.__r3fScene` — the scene (traverse to find groups/meshes by `name`)
- `window.__r3fCamera` — the active camera
- `window.__r3fControls` — the active drei controls (MapControls in world view), or null

To frame a subject: find its world position from the scene, then move BOTH the camera and
the controls target (controls with damping re-aim the camera every frame, so setting only
the camera position silently does nothing):

```js
await page.evaluate((p) => {
  const cam = window.__r3fCamera, ctl = window.__r3fControls;
  if (ctl?.target) ctl.target.set(p.x, p.y, p.z);
  cam.position.set(p.x + 20, p.y + 30, p.z + 20);
  cam.lookAt(p.x, p.y, p.z);
  ctl?.update?.();
}, subjectPos);
await page.waitForTimeout(1000); // let damping settle + a few frames present
await page.screenshot({ path: 'shot.png' });
```

Note: `toggleWorldView()` (via `window.useRoadNetwork.getState()`) switches to the aerial
MapControls camera and — since spec 127 — forces daylight, which is usually what a
screenshot wants.

## Numbers recorded for spec 127 (this machine, AMD Radeon, D3D11)

| probe                     | migration tip (per-cell roads) | ribbon branch |
| ------------------------- | ------------------------------ | ------------- |
| real GPU FPS              | 3.2                            | 60.4          |
| SwiftShader FPS (floor)   | 0.9                            | 1.5           |
| scene meshes              | 70,869                         | 204           |
