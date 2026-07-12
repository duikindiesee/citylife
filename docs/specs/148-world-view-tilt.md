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

- `LEFT` — still reserved for building roads.
- `RIGHT` — now `ROTATE`: drag to **tilt/orbit** the camera (top-down `0` down to ~82°).
- `MIDDLE` — now `PAN` (the wheel still zooms, so the dedicated dolly button was redundant).

`enableRotate` and `minPolarAngle: 0` are set explicitly so top-down remains reachable and the
tilt range is unambiguous.

## Verification

Live: entering World View and driving the controls tilts the camera from polar 0 (top-down) to
1.31 rad (~75°), rendering a proper oblique view of the island. `tsc` clean.
