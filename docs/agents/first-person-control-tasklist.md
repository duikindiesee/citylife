# First-person control tasklist

Persistent queue for autonomous slices that advance CityLife toward FPS-quality roaming. Each slice should finish one small executable item with tests and demo evidence when UI-visible.

## Tasks

1. [ ] Pointer-lock/mouse-look first-person mode with ESC restore.
   - Acceptance: entering first-person can request pointer lock from a user gesture; mouse movement updates yaw/pitch within clamped limits; ESC/pointerlockchange exits mouse-look without leaving first-person stuck; covered by tests or isolated control math tests plus browser demo.
2. [ ] Smooth WASD movement with acceleration/deceleration and better key handling.
   - Acceptance: held movement accelerates and release decelerates deterministically; diagonal input is normalized; repeated keydown does not stack speed; covered by control math tests and UI smoke.
3. [ ] Walkable collision/terrain guardrails: houses/shops/water/roads behavior.
   - Acceptance: first-person movement cannot settle in blocked buildings or water unless explicitly allowed; road/path cells feel preferred; blocked steps return a clear reason for HUD/narration; covered by route tests.
4. [x] First-person interaction affordance: nearest citizen/building/shop/action prompt.
   - Acceptance: first-person view exposes exactly one nearest useful interaction prompt from live avatar position, preferring nearby citizens then civic/buildings then roads; UI can show the prompt with rounded distances; covered by deterministic tests.
   - Done 2026-06-23: `FirstPersonView.interactionPrompt` now selects a single live-position prompt and the first-person panel renders it as an Action line. Verified with Vitest, typecheck, build, full test suite, and browser screenshot.
5. [ ] Photo mode/demo capture: deterministic screenshot evidence and PR comment/update.
   - Acceptance: an operator can trigger a reproducible first-person demo screenshot without private data; automation captures the current citizen, prompt/HUD and position evidence; documented in the PR/tasklist.
6. [ ] Immersive HUD mode separating debug telemetry from player overlay.
   - Acceptance: player-facing first-person overlay shows only concise movement/interactions while debug telemetry remains behind an operator affordance; no raw private/backend data displayed; UI screenshot verifies.
7. [ ] Route dogfood: scripted walk path with before/after position/camera assertions.
   - Acceptance: a test/script walks a deterministic path, asserts avatar position/heading/view changes after each step, and can be reused as browser dogfood.

## Run log

- 2026-06-23: Completed task 4, interaction affordance. Added a deterministic `interactionPrompt` to the first-person JSON view, rendered it in the HUD, and captured `/Users/joehermesbot/.hermes/cache/screenshots/browser_screenshot_15f2b3657a894e379e149d378c8e7e5d.png`. Branch note: PR #69 is already merged and remote branch was deleted; continued on recreated `joe/first-person-live-position` from `origin/main` so follow-up work stays isolated and unmerged. Next recommended slice: task 7 route dogfood or task 2 smooth movement math.
