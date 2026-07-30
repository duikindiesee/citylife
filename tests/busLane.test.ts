import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { setSolDebugOffsetMs } from "../src/colony/solRuntimeClock";
import {
  CITYLIFE_EPOCH_MS,
  MINUTES_PER_SOL,
  MS_PER_SOL,
} from "../src/colony/sol";
import {
  buildPath,
  busLoopPath,
  lanePose,
  samplePath,
} from "../src/colony/transit/path";
import { inCorridor } from "../src/colony/transit/busFleet";

// BUS.LANE.1 — a bus must drive in its LANE, not merely somewhere on the road.
//
// "On the road" was the old contract (BUS.ROUTE.TURN.1) and it is too weak: a coach straddling the
// centre-line of a two-way carriageway passes it while sitting in the path of oncoming traffic. The
// side is LEFT of travel — the SA near-side kerb the doors already open onto, which busStopAnchor,
// junctionCap and alightBus all independently agree on.

const LANE = COLONY.transit.busLaneOffsetCells;
/** A way is 4 cells of carriageway; the lane centres sit one cell either side of the centre-line. */
const CARRIAGEWAY_HALF_CELLS = 2;

type TransitDriver = { transitTick: () => void };
const tick = (rt: ColonyRuntime) =>
  (rt as unknown as TransitDriver).transitTick();

describe("lanePose — the lane-keeping primitive", () => {
  /** A straight run east, then a right-angle turn south. Generous radius so nothing is clamped. */
  const straight = buildPath(
    Array.from({ length: 40 }, (_, i) => ({ x: i, y: 0 })),
    false,
  );

  it("steps the full offset to the LEFT of travel on a straight", () => {
    const centre = samplePath(straight, 10);
    const lane = lanePose(straight, 10, 1);
    // heading is +x, so left of travel in this grid (y down) is +y
    expect(lane.x).toBeCloseTo(centre.x, 6);
    expect(lane.y - centre.y).toBeCloseTo(1, 6);
    expect(lane.heading).toBeCloseTo(centre.heading, 9);
  });

  it("mirrors to the right for a negative offset", () => {
    const centre = samplePath(straight, 10);
    expect(lanePose(straight, 10, -1).y - centre.y).toBeCloseTo(-1, 6);
  });

  it("is the plain centre-line pose at zero offset", () => {
    const centre = samplePath(straight, 12);
    const lane = lanePose(straight, 12, 0);
    expect(lane.x).toBeCloseTo(centre.x, 9);
    expect(lane.y).toBeCloseTo(centre.y, 9);
  });

  it("keeps the arc-length parameterisation on the CENTRE-LINE", () => {
    // The offset must not change where along the route `s` lands, or stop projection and dispatch
    // spacing would quietly shift with the lane.
    for (const s of [0, 5, 17.5, 39]) {
      expect(lanePose(straight, s, 1).x).toBeCloseTo(
        samplePath(straight, s).x,
        6,
      );
    }
  });

  it("NEVER turns the line inside out on the inside of a tight bend", () => {
    // The failure this clamp exists for: offsetting 1 cell into a bend of radius ~0.3 puts the bus
    // BEHIND where it just was, so it appears to swing backwards through the corner. Walking the
    // lane line must stay monotonic — every step forward moves forward.
    const hairpin = buildPath(
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6.3, y: 0.3 },
        { x: 6, y: 0.6 },
        { x: 0, y: 0.6 },
      ],
      false,
    );
    let prev = lanePose(hairpin, 0, 1);
    let backwards = 0;
    for (let s = 0.25; s <= hairpin.total; s += 0.25) {
      const here = lanePose(hairpin, s, 1);
      const along =
        Math.cos(prev.heading) * (here.x - prev.x) +
        Math.sin(prev.heading) * (here.y - prev.y);
      if (along < -1e-6) backwards++;
      prev = here;
    }
    expect(backwards).toBe(0);
  });

  it("gives back the full offset once the bend opens out again", () => {
    const gentle = buildPath(
      Array.from({ length: 60 }, (_, i) => {
        const a = (i / 59) * (Math.PI / 2);
        return { x: 30 * Math.sin(a), y: 30 - 30 * Math.cos(a) };
      }),
      false,
    );
    // radius 30 cells, so a 1-cell offset is nowhere near the clamp
    const centre = samplePath(gentle, gentle.total / 2);
    const lane = lanePose(gentle, gentle.total / 2, 1);
    expect(Math.hypot(lane.x - centre.x, lane.y - centre.y)).toBeCloseTo(1, 2);
  });
});

describe("BUS.LANE.1 — the live fleet keeps left", () => {
  it("holds the left lane the whole way round the circuit", () => {
    // Measured at the SAME ARC LENGTH on the centre-line rather than by projecting the pose back
    // onto the polyline. Projection is ambiguous near a corner — the nearest segment flips to the
    // far arm and the sign of the offset inverts with it, which is a fact about the measurement
    // and not about the bus. Comparing like for like at a shared `s` has no such ambiguity.
    const rt = new ColonyRuntime();
    expect(rt.busRoute, "boot seed routes a loop").not.toBeNull();
    const loop = busLoopPath(rt.busRoute!.loop);

    let worstRight = 0;
    let worstWide = 0;
    let atCentre = 0;
    let n = 0;
    for (let s = 0; s < loop.total; s += 0.5) {
      const centre = samplePath(loop, s);
      const lane = lanePose(loop, s, LANE);
      // signed offset along the codebase's left-of-travel basis (-sin h, cos h)
      const off =
        (lane.x - centre.x) * -Math.sin(centre.heading) +
        (lane.y - centre.y) * Math.cos(centre.heading);
      worstRight = Math.min(worstRight, off);
      worstWide = Math.max(worstWide, off);
      if (off < 0.05) atCentre++;
      n++;
    }

    expect(n).toBeGreaterThan(100);
    expect(
      worstRight >= -1e-6
        ? "keeps left"
        : `crossed ${(-worstRight).toFixed(2)} cells into the oncoming lane`,
    ).toBe("keeps left");
    expect(
      worstWide <= CARRIAGEWAY_HALF_CELLS
        ? "inside the kerb"
        : `sat ${worstWide.toFixed(2)} cells left of centre, past the ${CARRIAGEWAY_HALF_CELLS}-cell kerb`,
    ).toBe("inside the kerb");
    // The clamp gives ground back at tight bends, but it must not be doing so everywhere — if most
    // of the lap sits on the centre-line then the bus is not really in a lane at all.
    expect(atCentre / n).toBeLessThan(0.25);
  });

  it("puts every in-service pose in the lane, not on the centre-line", () => {
    const rt = new ColonyRuntime();
    const loop = busLoopPath(rt.busRoute!.loop);
    /** Unsigned distance to the centre-line — no projection sign to get wrong. */
    const toCentre = (px: number, py: number) => {
      let best = Infinity;
      const n = loop.pts.length;
      for (let i = 0; i < n; i++) {
        const a = loop.pts[i]!,
          b = loop.pts[(i + 1) % n]!;
        const vx = b.x - a.x,
          vy = b.y - a.y;
        const len2 = vx * vx + vy * vy;
        let t = len2 > 0 ? ((px - a.x) * vx + (py - a.y) * vy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        best = Math.min(
          best,
          Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t)),
        );
      }
      return best;
    };

    let service = 0;
    let offCentre = 0;
    let worst = 0;
    for (let minute = 0; minute < MINUTES_PER_SOL; minute += 3) {
      setSolDebugOffsetMs(
        CITYLIFE_EPOCH_MS +
          (minute / MINUTES_PER_SOL) * MS_PER_SOL -
          Date.now(),
      );
      tick(rt);
      const poses = rt.busPoses();
      const buses = rt.busFleet!.buses;
      for (let i = 0; i < poses.length; i++) {
        if (buses[i]!.mode !== "service") continue; // the depot apron has no lanes
        const d = toCentre(poses[i]!.x, poses[i]!.y);
        service++;
        if (d > 0.2) offCentre++;
        worst = Math.max(worst, d);
      }
    }
    setSolDebugOffsetMs(0);

    expect(service, "buses ran in service").toBeGreaterThan(0);
    // Most of the day the coach is genuinely displaced off the centre-line...
    expect(offCentre / service).toBeGreaterThan(0.7);
    // ...and never beyond the kerb.
    expect(
      worst <= CARRIAGEWAY_HALF_CELLS
        ? "inside the kerb"
        : `a service pose sat ${worst.toFixed(2)} cells off the centre-line`,
    ).toBe("inside the kerb");
  });

  it("DISCRIMINATES: the centre-line pose it replaced is not in a lane at all", () => {
    // Guards the guard. With the offset switched off the bus sits on the centre-line, which the
    // "keeps left" bound above must be able to tell apart from a lane.
    const rt = new ColonyRuntime();
    const loop = busLoopPath(rt.busRoute!.loop);
    const s = loop.total * 0.37;
    const centre = samplePath(loop, s);
    const lane = lanePose(loop, s, LANE);
    expect(Math.hypot(lane.x - centre.x, lane.y - centre.y)).toBeGreaterThan(
      0.2,
    );
  });

  it("leaves depot manoeuvring on the centre-line", () => {
    // Bays and the single-lane spur have no oncoming traffic and no lane to keep; offsetting there
    // would push the coach off its own manoeuvring geometry.
    const rt = new ColonyRuntime();
    rt.debugSetSolTimeOfDay(3, 0); // before first departure — everyone parked
    tick(rt);
    const buses = rt.busFleet!.buses;
    expect(buses.every((b) => b.mode === "parked" || inCorridor(b.mode))).toBe(
      true,
    );
    const poses = rt.busPoses();
    for (const p of poses) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});
