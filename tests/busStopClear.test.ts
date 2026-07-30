import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { busStopAnchor } from "../src/colony/transit/busStopAnchor";
import { buildPath, type Pt } from "../src/colony/transit/path";
import { findJunctionZones } from "../src/colony/render/roadJunctions";
import { attachCapPolys } from "../src/colony/render/junctionCap";
import { nearPoly } from "../src/colony/render/geom2d";

// BUS.STOP.CLEAR.1 — a bus may not HALT inside a junction.
//
// `makeBusRoute` snaps each hood anchor to its nearest drivable cell, and the commercial
// district's anchor IS its crossroads, so on the boot seed the stop at (125,265) projected onto
// the driven loop at (125.2, 265.2) — inside the junction cap. The coach dwelt there with its
// doors open for stopDwellMin (1.5 sim-minutes, 22.5 real seconds) squarely across a four-way,
// which is what the operator saw: "the bus that stops in the middle of the road".
//
// The authored stop cell is left alone — it is what identifies the stop. Only the HALT POINT
// slides along the route, which is the BUS.BOARD.1 rule that furniture follows the pose the bus
// really stops at, so the pole comes with it for free.

describe("busStopAnchor — halts slide clear of blocked ground", () => {
  /** A straight run east; "blocked" is an arbitrary band across the middle of it. */
  const line = buildPath(
    Array.from({ length: 60 }, (_, i) => ({ x: i, y: 0 })),
    false,
  );
  const band = (x: number) => x >= 20 && x <= 30;

  it("leaves a halt alone when its projection is already clear", () => {
    const a = busStopAnchor(line, { x: 45, y: 0 }, undefined, 0, (x) => band(x));
    expect(a.at.x).toBeCloseTo(45, 6);
  });

  it("slides OUT of blocked ground, and takes the furniture with it", () => {
    const a = busStopAnchor(line, { x: 25, y: 0 }, undefined, 0, (x) => band(x));
    expect(band(a.at.x)).toBe(false);
    // the pole is still exactly the verge offset from the halt, wherever the halt ended up
    expect(
      Math.hypot(a.furniture.x - a.at.x, a.furniture.y - a.at.y),
    ).toBeCloseTo(2.25, 6);
  });

  it("takes the NEARER side of the obstruction", () => {
    // 22 is 2 from the near edge (20) and 8 from the far edge (30)
    const a = busStopAnchor(line, { x: 22, y: 0 }, undefined, 0, (x) => band(x));
    expect(a.at.x).toBeLessThan(20.01);
  });

  it("keeps the authored cell as the stop's identity", () => {
    const a = busStopAnchor(line, { x: 25, y: 0 }, undefined, 0, (x) => band(x));
    expect(a.cell).toEqual({ x: 25, y: 0 });
  });

  it("keeps the projection rather than inventing a stop when nothing is clear in reach", () => {
    const a = busStopAnchor(line, { x: 25, y: 0 }, undefined, 0, () => true);
    expect(Number.isFinite(a.at.x)).toBe(true);
    expect(a.at.x).toBeCloseTo(25, 6);
  });

  it("is a no-op without a keep-clear predicate", () => {
    const withOut = busStopAnchor(line, { x: 25, y: 0 });
    expect(withOut.at.x).toBeCloseTo(25, 6);
  });
});

describe("BUS.STOP.CLEAR.1 — no live stop halts in a junction", () => {
  for (const seed of [4242, 1234]) {
    it(`seed ${seed}: every halt is outside every junction cap`, () => {
      const rt = new ColonyRuntime(seed);
      const zones = attachCapPolys(
        findJunctionZones(rt.sim.state.roadWays ?? []),
      );
      const anchors = rt.busStopAnchors();
      expect(anchors.length).toBeGreaterThan(0);
      const offenders = anchors
        .filter((a) =>
          zones.some(
            (z) => z.poly.length >= 3 && nearPoly(a.at.x, a.at.y, z.poly, 0),
          ),
        )
        .map(
          (a) =>
            `stop (${a.cell.x},${a.cell.y}) halts at (${a.at.x.toFixed(1)}, ${a.at.y.toFixed(1)})`,
        );
      expect(offenders).toEqual([]);
    });
  }

  it("DISCRIMINATES: the boot seed's commercial stop projects into a junction untreated", () => {
    // Guards the guard. Without the keep-clear predicate the halt lands in the crossroads, which
    // is the defect — if this ever stops being true the test above is no longer proving anything.
    const rt = new ColonyRuntime(4242);
    const zones = attachCapPolys(findJunctionZones(rt.sim.state.roadWays ?? []));
    const anchors = rt.busStopAnchors();
    const commercial = anchors.find(
      (a) => a.cell.x === 125 && a.cell.y === 265,
    );
    expect(commercial, "boot seed still has its commercial stop").toBeDefined();
    // The RAW projection of that cell sits in the cap...
    const raw: Pt = { x: 125.2, y: 265.2 };
    expect(
      zones.some((z) => z.poly.length >= 3 && nearPoly(raw.x, raw.y, z.poly, 0)),
    ).toBe(true);
    // ...and the anchor moved the halt somewhere else entirely.
    expect(
      Math.hypot(commercial!.at.x - raw.x, commercial!.at.y - raw.y),
    ).toBeGreaterThan(1);
  });
});
