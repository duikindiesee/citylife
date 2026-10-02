# Road Intersections Geometry, Signal Pole Placement, and Crosswalk Terminations Backlog

- **Status:** resolved
- **Origin:** Operator feedback and live session captures
- **Context:** Player observed and captured traffic light poles planted inside crosswalks and road corners, crosswalk stripes painted on raw dirt terrain cuts, and oversized signal hardware with crosswalks terminating into pine forests and wilderness dead-ends.

---

## 1. Problem Statement & Root Cause Analysis

### A. Signal Pole In Carriageway & Crosswalk Area
- In [`src/colony/render/roadJunctions.ts`](file:///c:/workstreams/citylife-road-racing/src/colony/render/roadJunctions.ts), `junctionFurniture()` attempted to place cantilever traffic signal poles via `placeClear()`.
- The clearance buffer was set to `a.half + 0.4` cells (only 1.6m from lane centerline).
- On angled intersections or where road mouths flared, this tight margin caused the vertical stanchion to be planted directly in the pedestrian crosswalk or on the asphalt/curb boundary where vehicles turn.

### B. Crosswalk Stripes Painted Across Raw Terrain & Transverse Cuts
- In [`src/colony/render/junctionCap.ts`](file:///c:/workstreams/citylife-road-racing/src/colony/render/junctionCap.ts), `capKerbPaintSegments()` matched kerb runs based purely on radial distance without verifying the segment direction vector relative to the arm heading. On complex junctions, this generated diagonal kerb lines cutting across the asphalt carriageway.
- Zebra stripes used oversized proportions (1.3 cells / 5.2m depth, 0.16 / 1.28m stripe width), dominating junction mouths.

### C. Duplicate Signal Hardware & Oversized Masts
- Signals and stop signs were instantiated independently for each detected approach arm without clustering near-parallel approaches, causing duplicate stanchions and stop signs to sprout at the same intersection corner.
- Overhead cantilever masts reached 5.6m–6.0m over empty space with flat, unshielded lenses.

---

## 2. Deliverable Tasks & Acceptance Criteria

### Task ROAD-POLE-01: Safe Verge Clearance for Road Furniture
- **Scope:** Upgrade `placeClear()` in `roadJunctions.ts` to enforce a minimum 2.5m clearance from all drivable road ribbons and crosswalk bounding boxes. Cluster parallel approaches so each road corner receives exactly one signal or stop sign.
- **Status:** Resolved.
- **Acceptance Criteria:**
  - Zero traffic light poles or stop sign stanchions intersect the carriageway, curb corners, or crosswalk markings.
  - Poles sit squarely on the sidewalk or verge setback.

### Task ROAD-CAP-02: Continuous Paved Surface Under Crosswalks & Clean Kerb Paint
- **Scope:** Ensure `junctionCap.ts` generates a continuous paved asphalt apron beneath all crosswalk zebra stripes and constrains painted kerb runs to true parallel runs.
- **Status:** Resolved.
- **Acceptance Criteria:**
  - 100% of crosswalk stripes sit on dark paved asphalt.
  - No stripes clip through or overlay bare dirt terrain.
  - No diagonal paint segments cut across open asphalt lanes (`dot > 0.95` parallel constraint).

### Task ROAD-DES-03: Scaled Signal Hardware & Crosswalk Refinement
- **Scope:** Re-proportion traffic light hardware to realistic urban street scale and refine zebra crosswalk stripe dimensions.
- **Status:** Resolved.
- **Acceptance Criteria:**
  - Realistic zebra proportions (`depth: 0.75`, `stripeHalf: 0.08`, maintaining K=5 band constraint).
  - Compact, balanced cantilever mast arm (`Math.min(3.2, laneHalfM / 2 + 0.4)`), lowered pole (4.8m) and signal head (3.8m).
  - Authentic hardware details: arched sun visors over all lenses, rear mounting bracket, and eye-level secondary stanchion aspect.

---

## 3. Implementation Summary & Verification

1. **Kerb Paint Constraint (`src/colony/render/junctionCap.ts`):**
   - Enforced normalized dot-product check: `Math.abs((ex * q.ux + ey * q.uy) / len) > 0.95`.
   - Verified segment endpoints both lie within `q.half` lateral distance.
   - Refined `ZEBRA` dimensions to realistic width and depth while preserving `K: 5`.
   - Synchronized `capStopBars` offset: `a.mouthD + 0.2 + ZEBRA.depth + 0.3`.

2. **Approach Clustering & Clearance (`src/colony/render/roadJunctions.ts`):**
   - Grouped junction approach arms within a 28° angular threshold, selecting a single representative arm for furniture placement.
   - Expanded verge offset buffer to `(a.half + 0.5)`.

3. **Traffic Light Mesh Scaling & Dual-Aspect Ref Lifecycle (`src/colony/render/roadFurniture.tsx`):**
   - Lowered stanchion to 4.8m, mast arm to 3.2m max, and head to 3.8m.
   - Modeled arched visors over lenses, mast mounting collar, and secondary driver/pedestrian head.
   - Assigned separate distinct material refs (`redRef`, `secRedRef`, `greenRef`, `secGreenRef`) so React does not overwrite overhead signal refs with secondary stanchion materials.
   - Exported `updateTrafficLightLamps` imperative updater driving both overhead and eye-level aspects synchronously across all signal phases.

4. **Test Proofs:**
   - Vitest test suites passed: `trafficLightDualAspects.test.ts` (dual-head illumination and distinct ref mounting), `roadJunctions.test.ts`, `junctionCap.test.ts`, `junctionCapEdgeProof.test.ts`, `junctionPaintLayoutProof.test.ts`, `roadFurnitureClearance.test.ts`, `busFleetAnchorOrder.test.ts`, and full repository suite.
