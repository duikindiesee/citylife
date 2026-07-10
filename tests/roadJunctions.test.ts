// Spec 127 — way-based junction detection. Junctions come from the road WAYS (centre-lines),
// not the widened cell grid whose interior cells all look like 4-way crossings.
import { describe, it, expect } from "vitest";
import type { RoadWay } from "../src/colony/render/roadRibbon";
import {
  findJunctionZones,
  junctionFurniture,
} from "../src/colony/render/roadJunctions";

const straight = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width = 4,
): RoadWay => ({
  path: [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ],
  kind: "street",
  width,
});

describe("spec 127 — way-based junction zones", () => {
  it("finds ONE crossing where two long ways cross, with four arms", () => {
    const zones = findJunctionZones([
      straight(0, 50, 100, 50),
      straight(50, 0, 50, 100),
    ]);
    expect(zones.length).toBe(1);
    const z = zones[0]!;
    expect(z.kind).toBe("cross");
    expect(Math.round(z.cx)).toBe(50);
    expect(Math.round(z.cy)).toBe(50);
    // no arm terminates — both roads pass through
    expect(z.arms.some((a) => a.terminating)).toBe(false);
  });

  it("classifies a road ENDING on another road as a tee with a terminating arm", () => {
    const zones = findJunctionZones([
      straight(0, 50, 100, 50),
      straight(50, 0, 50, 49), // ends at the horizontal road
    ]);
    expect(zones.length).toBe(1);
    const z = zones[0]!;
    expect(z.kind).toBe("tee");
    const term = z.arms.filter((a) => a.terminating);
    expect(term.length).toBe(1);
    // the terminator approaches heading +y (south, into the junction)
    expect(Math.round(term[0]!.dy)).toBe(1);
    expect(Math.round(term[0]!.dx)).toBe(0);
  });

  it("a single way (no crossing) produces no zones", () => {
    expect(findJunctionZones([straight(0, 10, 80, 10)]).length).toBe(0);
  });

  it("skips long parallel-run blobs — parallel ways are not a junction", () => {
    // two ways running 2 cells apart for 60 cells: the dilated centre-lines touch the whole
    // way along, which must NOT produce a 60-cell junction slab
    const zones = findJunctionZones([
      straight(0, 50, 60, 50),
      straight(0, 52, 60, 52),
    ]);
    expect(zones.length).toBe(0);
  });

  it("slab half-extent follows the widest way and is capped", () => {
    const zones = findJunctionZones([
      straight(0, 50, 100, 50, 4),
      straight(50, 0, 50, 100, 1),
    ]);
    expect(zones.length).toBe(1);
    expect(zones[0]!.half).toBeCloseTo(Math.min(3, 4 / 2 + 0.3), 6);
  });
});

describe("spec 127 — junction furniture", () => {
  it("a crossing gets 4 traffic lights and 4 stop lines, square on the compass", () => {
    const ways = [straight(0, 50, 100, 50), straight(50, 0, 50, 100)];
    const zones = findJunctionZones(ways);
    const items = junctionFurniture(zones[0]!, ways);
    expect(items.filter((i) => i.kind === "light").length).toBe(4);
    expect(items.filter((i) => i.kind === "stopline").length).toBe(4);
    expect(items.filter((i) => i.kind === "stopsign").length).toBe(0);
    // each stop line sits OUTSIDE the slab on its own compass arm
    const z = zones[0]!;
    for (const line of items.filter((i) => i.kind === "stopline")) {
      const d = Math.max(Math.abs(line.x - z.cx), Math.abs(line.y - z.cy));
      expect(d).toBeGreaterThan(z.half);
    }
  });

  it("a tee gets a stop sign + stop line on the terminating arm only", () => {
    const ways = [straight(0, 50, 100, 50), straight(50, 0, 50, 49)];
    const zones = findJunctionZones(ways);
    const items = junctionFurniture(zones[0]!, ways);
    expect(items.filter((i) => i.kind === "light").length).toBe(0);
    expect(items.filter((i) => i.kind === "stopline").length).toBe(1);
    expect(items.filter((i) => i.kind === "stopsign").length).toBe(1);
    // the terminator comes from the north heading south (+y): its stop line sits north of
    // the junction (y < cy), one cell LEFT of travel (left of +y travel is +x... east)
    const line = items.find((i) => i.kind === "stopline")!;
    const z = zones[0]!;
    expect(line.y).toBeLessThan(z.cy);
    expect(line.x).toBeGreaterThan(z.cx);
    expect(line.rotY).toBeCloseTo(Math.atan2(0, 1), 6); // heading +y → rotY 0
  });

  // The mid-road bus-stop regression (operator screenshot, 2026-07-10): the boot generator
  // chains ways end-to-start along one corridor. Each chain point is a "pass" zone with two
  // collinear terminating arms — a MERGE, not a controlled junction. The old code painted a
  // stop line per terminating arm there, marching yellow paint down the middle of what reads
  // as one continuous road.
  it("a chain point — way ending where the next continues — gets NO furniture", () => {
    const ways = [straight(0, 50, 50, 50), straight(50, 50, 100, 50)];
    const zones = findJunctionZones(ways);
    expect(zones.length).toBe(1);
    expect(zones[0]!.kind).toBe("pass");
    expect(zones[0]!.arms.filter((a) => a.terminating).length).toBe(2);
    expect(junctionFurniture(zones[0]!, ways)).toEqual([]);
  });

  // Same regression, second defect: boot side roads are width 4, and the old fixed 1.9-cell
  // lateral shift stood the stop sign INSIDE its own carriageway (the "bus stop" in the road).
  it("a wide side road tee keeps the sign off every carriageway and the paint on its own", () => {
    const ways = [straight(0, 50, 100, 50, 4), straight(50, 10, 50, 48, 4)];
    const zones = findJunctionZones(ways);
    expect(zones.length).toBe(1);
    expect(zones[0]!.kind).toBe("tee");
    const items = junctionFurniture(zones[0]!, ways);
    const sign = items.find((i) => i.kind === "stopsign")!;
    const line = items.find((i) => i.kind === "stopline")!;
    expect(sign).toBeTruthy();
    expect(line).toBeTruthy();
    // distance from a point to each way's straight centre-line
    const distMain = (p: { x: number; y: number }) => Math.abs(p.y - 50);
    const distSide = (p: { x: number; y: number }) => Math.abs(p.x - 50);
    // the sign stands clear of BOTH 4-cell carriageways (half-width 2)
    expect(distMain(sign)).toBeGreaterThan(2.25);
    expect(distSide(sign)).toBeGreaterThan(2.25);
    // the paint lies on its own approach lane but clear of the main road
    expect(distSide(line)).toBeLessThan(2);
    expect(distMain(line)).toBeGreaterThan(2.25);
  });
});
