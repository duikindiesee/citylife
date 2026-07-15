# Spec 148 — bring back tilting the world view

## The complaint

The operator missed being able to **tilt** the world-view camera — it was stuck flat top-down.

## Root cause

`R3FPlanetRenderer`'s `MapControls` bound the mouse buttons as `LEFT: undefined` (reserved for
road building), `MIDDLE: DOLLY`, `RIGHT: PAN`. **No button was bound to `ROTATE`**, so even
though `enableRotate` defaults on and `maxPolarAngle` already allowed an ~82° tilt, there was no
way to actually orbit/tilt the camera. It could only pan and zoom, flat.

## The fix

Rebind so tilting has a control, without stealing the road-building button:

- `LEFT` — pans naturally in World View; still reserved for building roads in City Builder.
- `RIGHT` — now `ROTATE`: drag to **tilt/orbit** the camera (top-down `0` down to ~82°).
- `MIDDLE` — remains a `PAN` fallback in either aerial mode (the wheel still zooms, so the dedicated
  dolly button was redundant).

The mode-aware binding matters: reserving `LEFT` globally made the tilt fix technically correct but
left World View panning accessible only through a middle-button drag. World View performs no road
placement, so it can safely use the familiar left-drag gesture without weakening builder input.

`enableRotate` and `minPolarAngle: 0` are set explicitly so top-down remains reachable and the
tilt range is unambiguous.

## Verification

Live: entering World View and driving the controls tilts the camera from polar 0 (top-down) to
1.31 rad (~75°), rendering a proper oblique view of the island. Left-drag changes the camera target
across both map axes, while City Builder retains its road-placement gesture. `tsc` clean.
