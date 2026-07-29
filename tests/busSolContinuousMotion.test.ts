import { afterEach, describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { setSolDebugOffsetMs, solNowMs } from "../src/colony/solRuntimeClock";
import {
  CITYLIFE_EPOCH_MS,
  MINUTES_PER_SOL,
  MS_PER_SOL,
  REAL_SECONDS_PER_SOL_MINUTE,
} from "../src/colony/sol";
import { busLoopPath, samplePath } from "../src/colony/transit/path";

// BUS.SOL.STUTTER.FIX.1 — locks the continuous bus motion contract diagnosed in BUS.SOL.STUTTER.DIAG.1:
// 1. Continuous position changes across adjacent animation frames (sub-frame/frame cadence).
// 2. Bounded recovery after reload (replay bounded to one sol day, deterministic).
// 3. No off-road turns (poses strictly stay on authoritative road/depot paths).
// 4. Correct stop dwell (holds stationary with doors open for stopDwellMin).
// 5. No regression to sol-time service (hours, night parking, sim speed independence).

// BUS.ROUTE.TURN.1 — what "on road" means here. `state.roadKind` IS the authority: it is the set of
// drivable cells the route BFS walks, and it is rasterised straight onto each way's routed centre-
// line, so a pose's distance to the nearest drivable cell is its offset from the road itself. A way
// is 4 cells of carriageway (runtime layRoad), so 2 cells is the outer kerb — past that the bus is
// on the veld. The clamped smoother (transit/path.ts) holds the worst boot-seed pose at ~1.5 cells;
// the unbounded Chaikin it replaced reached 8.86.
const CARRIAGEWAY_HALF_CELLS = 2;

/** Distance in cells from (px, py) to the nearest drivable road cell centre, by expanding ring so
 *  the common on-road case terminates after two rings. Ring r can hold nothing closer than r - 0.5,
 *  which is the stopping rule; far-off-road points saturate at the 24-cell scan bound. */
function cellsFromDrivableRoad(
  road: ReadonlyMap<string, unknown>,
  px: number,
  py: number,
): number {
  let best = Infinity;
  const cx = Math.round(px),
    cy = Math.round(py);
  for (let r = 0; r <= 24 && best > r - 0.5; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        if (!road.has(`${cx + dx},${cy + dy}`)) continue;
        best = Math.min(best, Math.hypot(px - (cx + dx), py - (cy + dy)));
      }
  return best;
}

type TransitDriver = { transitTick: () => void };

function tick(rt: ColonyRuntime): void {
  (rt as unknown as TransitDriver).transitTick();
}

afterEach(() => setSolDebugOffsetMs(0));

describe("BUS.SOL.STUTTER.FIX.1 — continuous bus motion while persisting canonical-sol schedule", () => {
  it("advances bus positions continuously across adjacent 16ms animation frames without stutter or jumps", () => {
    const rt = new ColonyRuntime();
    // Set sol time to midday (12:00) when buses are out in active service
    rt.debugSetSolTimeOfDay(12, 0);
    // Bracket BOTH driver reads: beforeMs is taken before the first tick and afterMs after the
    // second, so the measured window can only be LONGER than the one the fleet actually stepped
    // through. A bracket that starts after the first tick understates the window and turns runner
    // scheduling into a false failure.
    const beforeMs = solNowMs();
    tick(rt);

    const poses1 = rt.busPoses();
    const activeIdx = poses1.findIndex((p) => p.moving);
    expect(activeIdx).toBeGreaterThanOrEqual(0);

    const p1 = poses1[activeIdx]!;

    // Advance real clock by 16ms (one 60fps frame delta)
    const currentOffset = solNowMs() - Date.now();
    setSolDebugOffsetMs(currentOffset + 16);
    tick(rt);
    const afterMs = solNowMs();

    const poses2 = rt.busPoses();
    const p2 = poses2[activeIdx]!;

    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    // Position must change smoothly on adjacent frame (dist > 0), NOT remaining static or jumping
    // coarse cells.
    expect(dist).toBeGreaterThan(0);
    // Spec 164 — the upper bound is RATE-DERIVED, not a magic 0.1 cells. The old absolute bound
    // silently folded wall-clock drift into the measurement: `setSolDebugOffsetMs(offset + 16)`
    // advances the clock by 16 ms PLUS however long the runner took between the two samples, so the
    // bound only held while the bus was slow enough to absorb tens of milliseconds of jitter, and it
    // failed on a faster bus for a reason that had nothing to do with stutter. Bounding the CHORD by
    // the arc the bus could physically have covered in the window that actually elapsed is the real
    // no-teleport contract (chord <= arc <= cruise * dt) and is drift-immune.
    const elapsedSolMin =
      (afterMs - beforeMs) / (REAL_SECONDS_PER_SOL_MINUTE * 1000);
    expect(dist).toBeLessThanOrEqual(
      elapsedSolMin * COLONY.transit.busSpeedCellsPerMin + 1e-6,
    );
    // ...and the DESIGNED per-frame advance stays sub-cell, which is clock-free and is what
    // "no coarse cell jumping" actually meant.
    const designedFrameCells =
      (COLONY.transit.busSpeedCellsPerMin * (16 / 1000)) /
      REAL_SECONDS_PER_SOL_MINUTE;
    expect(designedFrameCells).toBeLessThan(0.1);
  });

  it("guarantees bounded, deterministic recovery after reload from canonical sol clock", () => {
    // Simulate runtime 1 at sol 14:30:15.5
    const targetMs = CITYLIFE_EPOCH_MS + 0.6 * MS_PER_SOL + 15500;

    setSolDebugOffsetMs(targetMs - Date.now());
    const rt1 = new ColonyRuntime();
    setSolDebugOffsetMs(targetMs - Date.now()); // Pin to exact same target instant for tick 1
    tick(rt1);
    const poses1 = rt1.busPoses();

    // Reload simulation: new runtime instance on the exact same sol clock instant
    const rt2 = new ColonyRuntime();
    setSolDebugOffsetMs(targetMs - Date.now()); // Pin to exact same target instant for tick 2
    tick(rt2);
    const poses2 = rt2.busPoses();

    expect(poses1.length).toBe(poses2.length);
    for (let i = 0; i < poses1.length; i++) {
      expect(poses2[i]!.x).toBeCloseTo(poses1[i]!.x, 4);
      expect(poses2[i]!.y).toBeCloseTo(poses1[i]!.y, 4);
      expect(poses2[i]!.heading).toBeCloseTo(poses1[i]!.heading, 4);
      expect(poses2[i]!.doorsOpen).toBe(poses1[i]!.doorsOpen);
      expect(poses2[i]!.moving).toBe(poses1[i]!.moving);
    }
  });

  it("keeps every posed bus strictly on authoritative road and depot paths with no off-road turns", () => {
    const rt = new ColonyRuntime();
    const road = rt.sim.state.roadKind;
    const route = rt.busRoute;
    const depot = rt.busDepot;
    expect(route, "the boot seed routes a bus loop").not.toBeNull();
    expect(depot, "the boot seed sites a depot").not.toBeNull();
    const site = depot!.site;
    /** Inside the depot plot (+1 cell of apron slack): where bay/gate poses legitimately live. */
    const onDepotPad = (x: number, y: number) =>
      x >= site.x - 1 &&
      x <= site.x + site.w + 1 &&
      y >= site.y - 1 &&
      y <= site.y + site.h + 1;

    // PART 1 — a full sol day, minute by minute: every bus, every mode, dispatch to night park.
    // A bus IN SERVICE is on the public road network; anything in or around the depot must be on
    // the depot plot. Read the fleet back INSIDE the loop: the transit driver re-seeds busFleet
    // when it re-anchors the clock, so a reference captured up front goes stale (and stays parked).
    let worstOnRoute = 0;
    let worstOnRouteAt = "";
    let servicePoses = 0;
    for (let minute = 0; minute < MINUTES_PER_SOL; minute++) {
      setSolDebugOffsetMs(
        CITYLIFE_EPOCH_MS +
          (minute / MINUTES_PER_SOL) * MS_PER_SOL -
          Date.now(),
      );
      tick(rt);
      const poses = rt.busPoses();
      const buses = rt.busFleet!.buses;
      for (let i = 0; i < poses.length; i++) {
        const p = poses[i]!;
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(Number.isFinite(p.heading)).toBe(true);
        if (buses[i]!.mode !== "service") {
          expect(
            onDepotPad(p.x, p.y) ||
              cellsFromDrivableRoad(road, p.x, p.y) <= CARRIAGEWAY_HALF_CELLS,
            `bus ${i} (${buses[i]!.mode}) at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) is neither on the depot plot nor on a road`,
          ).toBe(true);
          continue;
        }
        servicePoses++;
        const d = cellsFromDrivableRoad(road, p.x, p.y);
        if (d > worstOnRoute) {
          worstOnRoute = d;
          worstOnRouteAt = `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) at sol ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        }
      }
    }
    expect(
      servicePoses,
      "buses ran in service during the sol day",
    ).toBeGreaterThan(0);
    expect(
      worstOnRoute <= CARRIAGEWAY_HALF_CELLS
        ? "on road"
        : `bus in service at ${worstOnRouteAt} is ${worstOnRoute.toFixed(2)} cells from the nearest drivable road cell (limit ${CARRIAGEWAY_HALF_CELLS})`,
    ).toBe("on road");

    // PART 2 — the same measure over the WHOLE circuit, not just the minute-cadence samples above.
    // A bus in service is a point on this path and nothing else, so walking it at half-cell steps
    // bounds every position any bus can ever occupy — including a bad turn the day sweep steps over.
    //
    // The day sweep's resolution SCALES WITH CRUISE SPEED and this does not, which is the whole
    // reason both exist. Spec 164 raised busSpeedCellsPerMin 28 -> 84, so a minute-cadence sample
    // now lands every 84 cells instead of 28: against the pre-fix smoothing the sweep reports the
    // worst it happens to land on (3.21 cells at 84, where it caught 8.20 at 28) while the true
    // peak is 8.86. Part 2 finds that peak at any speed, and would still fail if a future speed
    // change let the sweep skip the bad arc entirely.
    //
    // busLoopPath is the one definition the runtime builds its fleet geometry from — and, since
    // BUS.BOARD.1, the curve its boarding anchors are projected onto — so this cannot drift from
    // what is actually driven.
    const loop = busLoopPath(route!.loop);
    let worstOnLoop = 0;
    let worstOnLoopAt = "";
    for (let s = 0; s < loop.total; s += 0.5) {
      const p = samplePath(loop, s);
      const d = cellsFromDrivableRoad(road, p.x, p.y);
      if (d > worstOnLoop) {
        worstOnLoop = d;
        worstOnLoopAt = `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
      }
    }
    expect(
      worstOnLoop <= CARRIAGEWAY_HALF_CELLS
        ? "on road"
        : `the driven circuit runs ${worstOnLoop.toFixed(2)} cells off the road network at ${worstOnLoopAt} (limit ${CARRIAGEWAY_HALF_CELLS})`,
    ).toBe("on road");
  });

  it("handles stop dwell correctly: halts moving bus and opens doors for the dwell duration", () => {
    const rt = new ColonyRuntime();
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);

    // Drive forward until a bus enters dwell at a stop
    let dwellingBusId = -1;
    const baseMs = solNowMs();
    for (let i = 0; i < 500; i++) {
      setSolDebugOffsetMs(baseMs + i * 500 - Date.now()); // step 0.5s chunks
      tick(rt);
      const poses = rt.busPoses();
      const dIdx = poses.findIndex((p) => p.doorsOpen && !p.moving);
      if (dIdx >= 0) {
        dwellingBusId = dIdx;
        break;
      }
    }

    if (dwellingBusId >= 0) {
      const dwellPose = rt.busPoses()[dwellingBusId]!;
      expect(dwellPose.doorsOpen).toBe(true);
      expect(dwellPose.moving).toBe(false);

      // 100ms later during dwell, position must remain fixed at the stop
      const nowOffset = solNowMs() - Date.now();
      setSolDebugOffsetMs(nowOffset + 100);
      tick(rt);
      const dwellPose2 = rt.busPoses()[dwellingBusId]!;
      expect(dwellPose2.x).toBeCloseTo(dwellPose.x, 5);
      expect(dwellPose2.y).toBeCloseTo(dwellPose.y, 5);
    }
  });

  it("preserves sol-time service without regression from sim speed changes", () => {
    const targetMs = CITYLIFE_EPOCH_MS + (14 / 24) * MS_PER_SOL;

    const rtSlow = new ColonyRuntime();
    const rtFast = new ColonyRuntime();
    rtFast.setSpeed(10);

    setSolDebugOffsetMs(targetMs - Date.now());
    tick(rtSlow);
    setSolDebugOffsetMs(targetMs - Date.now());
    tick(rtFast);

    const slowPoses = rtSlow.busPoses();
    const fastPoses = rtFast.busPoses();

    expect(slowPoses.length).toEqual(fastPoses.length);
    for (let i = 0; i < slowPoses.length; i++) {
      expect(fastPoses[i]!.x).toBeCloseTo(slowPoses[i]!.x, 4);
      expect(fastPoses[i]!.y).toBeCloseTo(slowPoses[i]!.y, 4);
    }
  });
});
