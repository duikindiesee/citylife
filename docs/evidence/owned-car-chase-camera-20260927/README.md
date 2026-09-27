# Owned-car chase camera — local browser evidence, 2026-09-27

Task API: `6c9c937d-3179-4a2e-a739-e91b7feec406`.

The earlier first-person camera sat inside the exterior GLB and hid the car while seated. This change places the camera 6.6 world metres behind the owned vehicle, clears the surveyed ground at the camera, aims at the car, and leaves its model visible. The walker rigid body remains pinned to the car for position and interaction state.

Local validation on this branch:

- `npm run typecheck` passed.
- `npx vitest run tests/ownedDriveCamera.test.ts tests/ownedVehicleSurface.test.ts` passed, 2/2.
- The Gearbox departure/road/park test passed in Chromium, 1/1, after increasing its 120-second limit to 180 seconds. A first run reached its final screenshot but timed out at the old limit; the second run completed in 2.3 minutes. A second returning-resident fixture test passed 1/1 in 27.6 seconds and confirmed exact X19 and published home-spawn coordinates with the car visible and on screen.
- The test uses authenticated fixture state and mocked API responses. It verifies the X19 model is visible/on screen while seated, after exit/re-entry, and after keyboard driving from Gearbox onto a road. It is not deployed gameplay proof, nor a completed home-driveway-arrival check.

Screenshots: [Gearbox departure](gearbox-departure.png), [parked outside](parked-outside.png), [road drive](road-drive.png), and [returning home spawn](returning-home-spawn.png). [Camera/model measurements](gearbox-measurements.json) show the model visible and on screen, with a 6.6 m horizontal separation and 3.6 m camera height over the car anchor at departure. The returning-home screenshot shows the car on bare ground beside the road, with no visible house or surfaced driveway. The position assertion passes, but the visual driveway acceptance fails; this needs the existing first-move-in/driveway tasks, not a claim of camera completion.

Remaining: independently review exact PR head, integrate after parent CityLife #546, follow build/deploy, then prove the owned-car/home-driveway view and usable road departure in the actual authenticated interface.
