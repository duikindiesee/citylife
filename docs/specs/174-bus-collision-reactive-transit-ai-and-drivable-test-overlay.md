# 174 — Municipal Bus Collision, Reactive Transit Traffic AI, and Drivable Road Surface Validator

Status: implemented and verified in cluster.
Branch: `antigravity/1907c3ce-a1d0-4134-8c15-7c436d33550d-raceable-roads`

## Player contract

1. **Solid Municipal Bus Collision (Anti-Phasing)**:
   - Municipal buses (`COLONY.transit.busLengthM = 12m`, `busWidthM = 2.5m`) are solid physical obstacles across the colony road network.
   - When driving an owned vehicle, `stepOwnedDrive` / `canOccupy` performs oriented bounding-box collision tests against all active transit bus poses (`busPoses`).
   - Vehicles cannot phantom-phase or drive through buses from the front, rear, or flanks; glancing collisions slide along the bus body, while direct impact arrests vehicle forward velocity cleanly (`speed = 0`).

2. **Reactive Transit Traffic AI (Braking and Overtaking)**:
   - Municipal buses monitor traffic in their travel corridor. When a player vehicle drives or stops in front of a bus within headway range (less than 14 cells / 56m ahead along the route loop):
     - **Dynamic Deceleration**: The bus decelerates smoothly and maintains a safe buffer distance (4 cells / 16m) behind the vehicle.
     - **Autonomous Overtaking**: If the vehicle remains stopped or drives slowly for more than 0.04 sim-minutes (~0.6s real time), and oncoming loop traffic is clear, the bus activates an overtaking maneuver:
       1. Transitions lateral offset toward the passing/right lane (`lateralOffset = -1.8` cells).
       2. Accelerates past the stationary or slow car in the passing lane.
       3. Safely returns to the standard left transit lane (`lateralOffset = 0`) once past the vehicle.

3. **Drivable Road Surface Visual Validator (Seed 4242 & Custom Seeds)**:
   - Players and operators can visualize and certify the ground-truth drivable surface without driving:
     - **Interactive 2D Diagnostic Modal**:
       - Rendered on a 400x400 top-down canvas showing the entire island terrain, ocean, neon cyan road ribbons, violet transit loop, yellow buses, and glowing magenta player car.
       - Hovering over any cell reveals coordinates, terrain elevation, and road surface designation.
       - Runs real-time automated graph analysis: BFS connectivity proof (certifying 1 single continuous connected road component with 0 orphan road islands), and accessibility checks for the Glass Showroom (commercial garage pad), Kooker HQ (civic landing center), Starter Home (Lot #0 driveway), and the Transit Bus Loop.
     - **3D In-World Draped Mesh Overlay**:
       - Toggleable instanced surface mesh (`R3FDrivableOverlay`) draped directly over terrain at road surface height (`getSmoothRoadY + 0.18m`).
       - Color-codes road ribbons (glowing cyan `#00f5ff`), verges (emerald `#00ff66`), and blocked structures (crimson `#ff2244`).
     - **Affordances & Triggers**:
       - HUD button `🛣️ Test Roads (4242)` in the bottom-left corner action rail.
       - Center driving HUD button `🛣️ Road Map` beside Park & Exit.
       - Direct URL query trigger via `?drivable=1` or `?testroads=1`.

## Verification

- `npm run typecheck`: clean (0 errors).
- `npx vitest run tests/busTrafficAndCollision.test.ts`: 4/4 passing unit tests covering bus collision bounding box, reactive deceleration, autonomous overtaking, and seed 4242 continuous connectivity.
- Full unit test suite: 265/265 files passed, 2,364/2,364 tests passing.
- Production build: `vite build` succeeded in 765ms.
- Public safety: `npm run validate` and `npm run public-safety` passed.
