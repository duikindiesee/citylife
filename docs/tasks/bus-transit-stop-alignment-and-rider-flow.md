# Bus Transit Route Alignment, Stop Positioning, and Rider Flow Backlog

- **Status:** recorded / backlog
- **Origin:** Operator feedback and live session captures
- **Context:** Player observed and captured transit buses driving off-road, cutting across dirt curves, zigzagging through intersections, and bus stop signs positioned excessively far into the terrain. Additionally requested an automated next-stop onboarding and offboarding passenger ride flow.
  - **Live Observation (2026-10-02 11:11 CEST / Sol 501 18:27):** Player driving Karoo X19 on elevated Highway (speed 16 km/h) captured orange municipal transit bus running completely off-road on the dirt shoulder parallel to the road verge (evidence: `media_1790930235802.png`). Shows the bus path offset from the road ribbon on curved highway segments.

---

## 1. Problem Statement & Root Cause Analysis

### A. Bus Route Alignment & Corner-Cutting ("BUS SIZZAG")

1. **Grid BFS vs. 3D Ribbon Splines:** The bus route is currently computed in [`src/colony/transit/busRoute.ts`](file:///c:/workstreams/citylife-road-racing/src/colony/transit/busRoute.ts) using 4-connected Breadth-First Search (BFS) over 2D grid cells (`state.roadKind`).
2. **Chaikin Smoothing Divergence:** The raw grid route is smoothed with Douglas-Peucker simplification and Chaikin subdivision ([`src/colony/transit/path.ts`](file:///c:/workstreams/citylife-road-racing/src/colony/transit/path.ts)). On corners and forks, this smoothing cuts the corner across raw terrain, diverging from the rendered 3D ribbon road geometry by up to 4–12 metres.
3. **Lane Offset Exaggeration:** [`src/colony/config.ts`](file:///c:/workstreams/citylife-road-racing/src/colony/config.ts) sets `busLaneOffsetCells = 1` (4 metres to the left of the centerline). When the bus negotiates a curved ribbon, this constant lateral offset pushes the 12-metre coach chassis completely outside the asphalt road verge onto the brown dirt terrain.

### B. Bus Stop Furniture Distance

- [`src/colony/transit/busStopAnchor.ts`](file:///c:/workstreams/citylife-road-racing/src/colony/transit/busStopAnchor.ts) specifies `STOP_VERGE_OFFSET_CELLS = 2.25` (9.0 metres back from the driven lane centerline).
- On narrower road sections or where the driven path cuts into the dirt, this offset pushes the yellow bus stop sign far out into the unpaved landscape, distant from both the road edge and the bus coach doors.

### C. Passenger Transit Experience & Rider Flow

- Currently, boarding requires being in pedestrian mode within `boardMaxDistanceCells = 3` (12m) of a dwelling bus.
- There is no guided stop schedule, route announcement, or automated destination offboarding mechanism.

---

## 2. Deliverable Tasks & Acceptance Criteria

### Task TRANSIT-ALIGN-01: Ribbon Road Centerline Snapping & Corner Retention

- **Scope:** Bind bus waypoint generation directly to the continuous 3D ribbon road splines ([`src/colony/render/R3FRoadRibbons.tsx`](file:///c:/workstreams/citylife-road-racing/src/colony/render/R3FRoadRibbons.tsx)) rather than coarse 2D grid cell BFS.
- **Acceptance Criteria:**
  - The bus chassis and wheels stay 100% on paved road asphalt throughout all straightaways, curves, and intersections.
  - Eliminate off-road shortcutting and zigzagging across bends.
  - Dynamically attenuate `busLaneOffsetCells` through turns with radius < 24m to prevent chassis overhang off the road ribbon.

### Task TRANSIT-STOP-02: Calibrated Stop Verge Offset & Passenger Waiting Pad

- **Scope:** Recalibrate `STOP_VERGE_OFFSET_CELLS` in `busStopAnchor.ts` and anchor stop furniture to the actual paved ribbon kerb edge.
- **Acceptance Criteria:**
  - Yellow bus stop sign stands on the paved verge exactly 1.5m to 2.2m from the halted coach's front passenger doors.
  - Render a small paved concrete waiting pad under the stop sign so passengers are not waiting in raw dirt.

### Task TRANSIT-RIDER-03: Automated Next-Stop Onboarding & Offboarding Flow

- **Scope:** Provide an interactive transit rider UI and autonomous passenger ride state in `transit/` and `ui/`.
- **Acceptance Criteria:**
  - **Stop Approach HUD:** When a player walks near a bus stop, show an indicator: _"Bus arriving in X seconds"_ or arrival status.
  - **Onboarding:** When the bus arrives and dwells with doors open, provide a single-action _"Board Bus"_ prompt.
  - **Rider Experience:** Once onboard, the camera transitions to an interior or chase passenger view. An in-bus transit HUD displays the route line with upcoming stops.
  - **Automated Offboarding:** The rider can click _"Offboard at Next Stop"_ (or select a named destination stop). When the bus reaches that stop, it automatically halts, opens doors, and disembarks the player onto the passenger stop pad.
