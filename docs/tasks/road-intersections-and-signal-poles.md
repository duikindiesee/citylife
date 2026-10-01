# Road Intersections Geometry, Signal Pole Placement, and Crosswalk Terminations Backlog

- **Status:** recorded / backlog
- **Origin:** Operator feedback and live session captures
- **Context:** Player observed and captured traffic light poles planted inside crosswalks and road corners, crosswalk stripes painted on raw dirt terrain cuts, and oversized signal hardware with crosswalks terminating into pine forests and wilderness dead-ends.

---

## 1. Problem Statement & Root Cause Analysis

### A. Signal Pole In Carriageway & Crosswalk Area
- In [`src/colony/render/roadJunctions.ts`](file:///c:/workstreams/citylife-road-racing/src/colony/render/roadJunctions.ts), `junctionFurniture()` attempts to place cantilever traffic signal poles via `placeClear()`.
- The clearance buffer is set to `a.half + 0.4` cells (only 1.6m from lane centerline).
- On angled intersections or where road mouths flare, this tight margin causes the vertical stanchion to be planted directly in the pedestrian crosswalk or on the asphalt/curb boundary where vehicles turn.

### B. Crosswalk Stripes Painted Across Raw Terrain
- In [`src/colony/render/roadRibbon.ts`](file:///c:/workstreams/citylife-road-racing/src/colony/render/roadRibbon.ts) and [`src/colony/render/junctionCap.ts`](file:///c:/workstreams/citylife-road-racing/src/colony/render/junctionCap.ts), crosswalk geometry is generated at junction mouths.
- When an approach borders unpaved rough land or has an irregular boundary, the underlying junction cap polygon does not fully cover the verge, leaving white zebra stripes floating or stamped onto raw brown dirt.

### C. Wilderness Dead-End Crosswalks & Oversized Signal Hardware
- Signals and crosswalks are currently instantiated for all detected junction arms without checking the pedestrian network context or way termination.
- At sharp road curves or near town limits, this produces crosswalks that lead straight into wilderness trees or rockfaces, guarded by full multi-lane cantilever traffic lights.

---

## 2. Deliverable Tasks & Acceptance Criteria

### Task ROAD-POLE-01: Safe Verge Clearance for Road Furniture
- **Scope:** Upgrade `placeClear()` in `roadJunctions.ts` to enforce a minimum 2.5m clearance from all drivable road ribbons and crosswalk bounding boxes.
- **Acceptance Criteria:**
  - Zero traffic light poles or stop sign stanchions intersect the carriageway, curb corners, or crosswalk markings.
  - Poles sit squarely on the sidewalk or verge setback.

### Task ROAD-CAP-02: Continuous Paved Surface Under Crosswalks
- **Scope:** Ensure `junctionCap.ts` generates a continuous paved asphalt apron beneath all crosswalk zebra stripes.
- **Acceptance Criteria:**
  - 100% of crosswalk stripes sit on dark paved asphalt.
  - No stripes clip through or overlay bare dirt terrain.

### Task ROAD-DES-03: Context-Aware Signal & Crosswalk Pruning
- **Scope:** Classify junction arms by pedestrian connectivity and destination.
- **Acceptance Criteria:**
  - Suppress crosswalk markings where an approach does not connect to a walkable sidewalk or building frontage.
  - Replace oversized overhead cantilever masts with compact post-mounted signals on rural and perimeter road curves.
