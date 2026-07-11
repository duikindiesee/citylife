# Spec 143 — Mobile Road Rally driving controls

Status: UPDATED · Date: 2026-06-26 · Owner: Joe / Player & UI

## Why

The Road Rally already runs on phones — countdown, checkpoint HUD, and car render all appear — but the car was only controllable through keyboard events (`W/A/S/D` or arrows) feeding `race.ts` through `runtime.setRaceKey`. Touch devices have no keyboard, so the rally could start while remaining unplayable on a phone.

## Mechanic

Add a touch-only Road Rally control dock that appears only while an active rally is in `countdown` or `running` mode. The dock gives the player four large hold buttons:

- `Steer left` -> the same `KeyA` path as desktop keyboard left steering.
- `Steer right` -> the same `KeyD` path as desktop keyboard right steering.
- `Hold throttle` -> the same `KeyW` path as desktop accelerate.
- `Brake or reverse` -> the same `KeyS` path as desktop brake/reverse.

The controls do not call a separate car movement API. Pointer down sets the mapped race key to `true`; pointer up/cancel/leave/blur releases it to `false`. That means `stepRace` and `driveCar` consume the identical `RaceInput` booleans used by desktop, preserving handling, checkpoint crossing, off-track pullback, and reverse behaviour.

Iteration 2 adds two more additive inputs over the same normalised race driver path:

- **Gyro steering** is a touch-only optional toggle in the rally dock. Enabling requests the platform motion permission only at that moment, captures the current `DeviceOrientation` as the neutral baseline, applies a deterministic dead-zone, and maps calibrated left/right tilt into `RaceInput.steer` in `[-1, 1]`. The recenter button captures the current orientation as the new baseline and clears the current steer. Turning gyro off removes only the gyro input, so the touch wheel/buttons remain the fallback.
- **Android TV / gamepad** is polled through the browser Gamepad API only behind `navigator.getGamepads` guards. Left stick X steers with a dead-zone; D-pad left/right steers when the stick is neutral; A is throttle; B is brake/reverse. The HUD shows a small controller-connected hint while a gamepad is active.

The runtime combines key/touch, gyro, and gamepad sources before stepping the race, then `race.ts` normalises the result into one deterministic `{ steer, throttle, brake, handbrake }` drive input for the car physics.

## Rules and boundaries

- Visibility gate: render touch controls only when touch capability is detected and `race.mode` is `countdown` or `running`; never show touch controls for idle/finished races or on normal desktop keyboard play.
- Gyro is opt-in, touch-scoped, calibrated on enable, deterministic, and cleared on disable or race end.
- Gamepad polling is node-safe/browser-guarded and additive; no gamepad API exists in server tests or non-browser runtimes.
- The existing first-person walking joystick remains separate (`data-fp-action=*`) and untouched; rally controls use `data-race-action=*` selectors.
- Desktop keyboard handling stays unchanged: the existing `RACE_KEY_CODES` listener still drives `runtime.setRaceKey`.
- CSS uses large touch targets, `touch-action: none`, safe-area-aware bottom placement, and high day/night contrast.
- Deterministic: no sim randomness, no race physics fork, and no wall-clock input in the race stepper.

## Acceptance

- On mobile/touch during Road Rally countdown/running, the player can steer, throttle, brake/reverse, and clear checkpoints using on-screen controls.
- Gyro steering can be toggled on after motion permission, recentred, toggled off, and falls back to touch controls without changing the race physics path.
- Android TV / gamepad play works through the Gamepad API: left stick or D-pad steers, A throttles, and B brakes; the rally HUD shows a controller-connected hint.
- Desktop keyboard remains unchanged.
- The walking first-person mobile joystick does not regress.
- Vitest covers the visibility gate, accessible `data-race-action` controls, exact keyboard-code bridge, gyro tilt mapping/dead-zone, gamepad mapping, and the shared normalised race driver input.
- Browser proof should use a phone viewport/touch context, start the rally, hold throttle/steer through the actual DOM controls, and capture day + night evidence plus structured car movement/checkpoint state. For iteration 2, also verify the gyro toggle/recenter DOM and synthetic Gamepad API mapping in-browser.
