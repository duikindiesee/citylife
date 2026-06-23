# First-person control tasklist

Persistent queue for autonomous slices that advance CityLife toward FPS-quality roaming. Each slice should finish one small executable item with tests and demo evidence when UI-visible.

## Tasks

1. [ ] Pointer-lock/mouse-look first-person mode with ESC restore.
   - Acceptance: entering first-person can request pointer lock from a user gesture; mouse movement updates yaw/pitch within clamped limits; ESC/pointerlockchange exits mouse-look without leaving first-person stuck; covered by tests or isolated control math tests plus browser demo.
2. [~] Smooth WASD movement with acceleration/deceleration and better key handling.
   - Acceptance: held movement accelerates and release decelerates deterministically; diagonal input is normalized; repeated keydown does not stack speed; covered by control math tests and UI smoke.
   - Slice done 2026-06-23: first-person walking now ramps toward configured max speed and briefly coasts down after release; tunables live in `COLONY.firstPerson`; covered by dogfood regression and browser smoke. Remaining for full task: explicit diagonal/key-repeat regression and any strafe-vs-turn decision.
3. [ ] Walkable collision/terrain guardrails: houses/shops/water/roads behavior.
   - Acceptance: first-person movement cannot settle in blocked buildings or water unless explicitly allowed; road/path cells feel preferred; blocked steps return a clear reason for HUD/narration; covered by route tests.
4. [x] First-person interaction affordance: nearest citizen/building/shop/action prompt.
   - Acceptance: first-person view exposes exactly one nearest useful interaction prompt from live avatar position, preferring nearby citizens then civic/buildings then roads; UI can show the prompt with rounded distances; covered by deterministic tests.
   - Done 2026-06-23: `FirstPersonView.interactionPrompt` now selects a single live-position prompt and the first-person panel renders it as an Action line. Verified with Vitest, typecheck, build, full test suite, and browser screenshot.
5. [ ] Photo mode/demo capture: deterministic screenshot evidence and PR comment/update.
   - Acceptance: an operator can trigger a reproducible first-person demo screenshot without private data; automation captures the current citizen, prompt/HUD and position evidence; documented in the PR/tasklist.
6. [ ] Immersive HUD mode separating debug telemetry from player overlay.
   - Acceptance: player-facing first-person overlay shows only concise movement/interactions while debug telemetry remains behind an operator affordance; no raw private/backend data displayed; UI screenshot verifies.
7. [x] Route dogfood: scripted walk path with before/after position/camera assertions.
   - Acceptance: a test/script walks a deterministic path, asserts avatar position/heading/view changes after each step, and can be reused as browser dogfood.
   - Done 2026-06-23: Added `driveFirstPersonRouteDogfood`, a deterministic reusable route dogfood helper that enters first-person, drives the same key input path as the UI, samples before/after position and heading, and verifies the live first-person JSON view follows each step.

## Run log

- 2026-06-23: Advanced task 2 smooth movement. Added `COLONY.firstPerson` locomotion tunables, replaced instant first-person speed with deterministic ramp-up/coast-down velocity state, and reset walk speed on enter/exit/collision. Added a dogfood regression that failed against instant 3.4 units/sec movement, then passed after the fix. Verified focused first-person tests, full Vitest, typecheck, build, and browser smoke screenshot `/Users/joehermesbot/.hermes/cache/screenshots/browser_screenshot_88c12f425de44acdab02afeecc979563.png`. Remaining task-2 work: explicit diagonal/key-repeat regression and any strafe-vs-turn decision.
- 2026-06-23: Completed task 7, route dogfood. Added `src/colony/bot/firstPersonDogfood.ts` and `tests/firstPersonDogfood.test.ts` so a deterministic scripted first-person route now drives W/D/S via the runtime key path and asserts before/after position, heading, and live view samples. Verified with focused Vitest, full Vitest, typecheck, and build. Next recommended slice: task 2 smooth movement with acceleration/deceleration, or task 1 pointer-lock/mouse-look if the branch should move into browser controls next.
- 2026-06-23: Completed task 4, interaction affordance. Added a deterministic `interactionPrompt` to the first-person JSON view, rendered it in the HUD, and captured `/Users/joehermesbot/.hermes/cache/screenshots/browser_screenshot_15f2b3657a894e379e149d378c8e7e5d.png`. Branch note: PR #69 is already merged and remote branch was deleted; continued on recreated `joe/first-person-live-position` from `origin/main` so follow-up work stays isolated and unmerged. Next recommended slice: task 7 route dogfood or task 2 smooth movement math.
