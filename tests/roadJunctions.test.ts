// Spec 137 — junction zones from way-pair centre-line EVENTS (crossings + endpoint
// projections), replacing the spec-127 dilated-cell blobs whose centroids drifted, whose
// twins overlapped, and whose near-miss parallels produced phantom "pass" slabs.
import { describe, it, expect } from "vitest";
import type { RoadWay } from "../src/colony/render/roadRibbon";
import {
  findJunctionZones,
  junctionFurniture,
  axisAngle,
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

describe("spec 137 — junction zones from way-pair events", () => {
  it("finds ONE crossing where two long ways cross, centred on the true intersection", () => {
    const zones = findJunctionZones([
      straight(0, 50, 100, 50),
      straight(50, 0, 50, 100),
    ]);
    expect(zones.length).toBe(1);
    const z = zones[0]!;
    expect(z.kind).toBe("cross");
    expect(z.cx).toBeCloseTo(50, 1);
    expect(z.cy).toBeCloseTo(50, 1);
    expect(z.arms.length).toBe(4);
    expect(z.arms.some((a) => a.terminating)).toBe(false);
    // every arm knows its real half-width and a sane mouth distance
    for (const a of z.arms) {
      expect(a.half).toBe(2);
      expect(a.mouthD).toBeGreaterThanOrEqual(2);
      expect(a.mouthD).toBeLessThanOrEqual(6);
    }
  });

  it("classifies a road ENDING on another road as a tee centred ON the through line", () => {
    // OFFSET tee: the stub ends 2 cells short of the through road's centre-line — the
    // spec-127 blob centroid drifted into the gap; the event centre is the projection.
    const zones = findJunctionZones([
      straight(0, 50, 100, 50),
      straight(50, 0, 50, 48),
    ]);
    expect(zones.length).toBe(1);
    const z = zones[0]!;
    expect(z.kind).toBe("tee");
    expect(z.cy).toBeCloseTo(50, 0.5); // ON the through way, not the blob mean
    const term = z.arms.filter((a) => a.terminating);
    expect(term.length).toBe(1);
    // the terminating arm points north (OUT of the junction, back up the stub)
    expect(term[0]!.uy).toBeLessThan(-0.9);
  });

  it("a single way (no crossing) produces no zones", () => {
    expect(findJunctionZones([straight(0, 10, 80, 10)]).length).toBe(0);
  });

  it("parallel near-miss ways produce NO zones (and no phantom pass slabs)", () => {
    // two ways running 2 cells apart for 60 cells: no intersection, no endpoint near the
    // other line's carriageway reach at the sides -> zero events. The spec-127 detector
    // produced a 60-cell blob here and (worse) suppressed all paint along it.
    const zones = findJunctionZones([
      straight(0, 50, 60, 50),
      straight(0, 53, 60, 53, 1),
    ]);
    expect(zones.length).toBe(0);
  });

  it("a hairpin crossing the same road twice keeps TWO exact zones (spec 137 v2)", () => {
    // Two real crossings ~5.7 cells apart each get their own exact carriageway-union
    // pad, anchored at their own crossing point — one merged star centre cannot draw
    // honest kerb lines for two crossings (the operator's "antipattern" blob). The two
    // pads overlap benignly along the shared road; the cap builder micro-lifts them.
    const dogleg: RoadWay = {
      path: [
        { x: 40, y: 40 },
        { x: 50, y: 54 },
        { x: 60, y: 40 },
      ],
      kind: "street",
      width: 4,
    };
    const zones = findJunctionZones([straight(0, 50, 100, 50), dogleg]);
    expect(zones.length).toBe(2);
    for (const z of zones) expect(Math.abs(z.cy - 50)).toBeLessThan(1); // ON the road
  });

  it("mixed widths keep PER-ARM half-widths (no more widest-way square)", () => {
    const zones = findJunctionZones([
      straight(0, 50, 100, 50, 4),
      straight(50, 0, 50, 100, 1),
    ]);
    expect(zones.length).toBe(1);
    const halves = zones[0]!.arms.map((a) => a.half).sort();
    expect(halves).toEqual([0.5, 0.5, 2, 2]);
  });

  it("a 45-degree crossing keeps REAL arm headings — never compass-snapped", () => {
    const zones = findJunctionZones([
      straight(0, 50, 100, 50),
      straight(20, 20, 80, 80),
    ]);
    expect(zones.length).toBe(1);
    const z = zones[0]!;
    expect(z.kind).toBe("cross");
    const diag = z.arms.filter(
      (a) => Math.abs(Math.abs(a.ux) - Math.abs(a.uy)) < 0.35,
    );
    expect(diag.length).toBeGreaterThanOrEqual(2);
    // diagonal arms need DEEPER mouths (h/sin(45) > h)
    for (const a of diag) expect(a.mouthD).toBeGreaterThan(2.75);
  });
});

describe("spec 137 — junction furniture from real headings", () => {
  it("a crossing gets one signal per arm, phased by axis, none inside any carriageway", () => {
    const zones = findJunctionZones([
      straight(0, 50, 100, 50),
      straight(50, 0, 50, 100),
    ]);
    const z = zones[0]!;
    const items = junctionFurniture(z);
    const lights = items.filter((i) => i.kind === "light");
    expect(lights.length).toBe(4);
    expect(items.filter((i) => i.kind === "stopsign").length).toBe(0);
    // two per phase group: one axis goes green while the other holds red
    expect(lights.filter((l) => l.group === "A").length).toBe(2);
    expect(lights.filter((l) => l.group === "B").length).toBe(2);
    // no pole stands inside ANY arm's carriageway corridor
    for (const l of lights) {
      for (const a of z.arms) {
        const rx = l.x - z.cx,
          ry = l.y - z.cy;
        const along = rx * a.ux + ry * a.uy;
        const across = Math.abs(rx * -a.uy + ry * a.ux);
        const inside = along > -0.5 && along < a.mouthD + 2 && across < a.half;
        expect(inside).toBe(false);
      }
    }
  });

  it("a tee gets an upright stop sign on the terminating arm's left verge", () => {
    const zones = findJunctionZones([
      straight(0, 50, 100, 50),
      straight(50, 0, 50, 48),
    ]);
    const z = zones[0]!;
    const items = junctionFurniture(z);
    expect(items.filter((i) => i.kind === "light").length).toBe(0);
    const signs = items.filter((i) => i.kind === "stopsign");
    expect(signs.length).toBe(1);
    const sign = signs[0]!;
    // terminating arm heads north (u = -y): sign north of the junction, and LEFT of the
    // southbound approach (left of travel t=(0,1) is (+1,0) -> east... L=(t.y,-t.x)=(1,0))
    expect(sign.y).toBeLessThan(z.cy);
    expect(sign.x).toBeGreaterThan(z.cx);
    // faces the approaching driver: rotY = atan2(ux, uy) of the OUTWARD heading
    expect(sign.rotY).toBeCloseTo(Math.atan2(0, -1), 1);
    expect(sign.laneHalfM).toBe(8);
  });

  it("diagonal arms each keep their own stop treatment — the compass dedup is gone", () => {
    // two diagonals sharing a dominant axis used to collapse via seenDir
    const zones = findJunctionZones([
      straight(0, 50, 100, 50),
      straight(20, 20, 80, 80),
    ]);
    const items = junctionFurniture(zones[0]!);
    expect(items.filter((i) => i.kind === "light").length).toBe(4);
  });

  it("bends get no furniture", () => {
    const elbow: RoadWay = {
      path: [
        { x: 20, y: 50 },
        { x: 50, y: 50 },
      ],
      kind: "street",
      width: 4,
    };
    const elbow2: RoadWay = {
      path: [
        { x: 50, y: 50 },
        { x: 75, y: 25 },
      ],
      kind: "street",
      width: 4,
    };
    const zones = findJunctionZones([elbow, elbow2]);
    for (const z of zones) expect(junctionFurniture(z)).toEqual([]);
  });
});

describe("spec 137 — axisAngle", () => {
  it("treats opposite rays as one axis and orthogonals as 90 degrees", () => {
    expect(axisAngle({ ux: 1, uy: 0 }, { ux: -1, uy: 0 })).toBeCloseTo(0, 6);
    expect(axisAngle({ ux: 1, uy: 0 }, { ux: 0, uy: 1 })).toBeCloseTo(
      Math.PI / 2,
      6,
    );
  });
});
