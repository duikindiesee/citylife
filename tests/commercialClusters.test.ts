// Spec 139 — the giant red building fix: contiguous commercial lots collapse to ONE ~100 m
// CommercialBlock at the cluster centroid instead of one overlapping scene per 4 m lot.
import { describe, it, expect } from "vitest";
import { clusterCommercialLots } from "../src/colony/render/commercialClusters";

const lot = (id: string, x: number, y: number, w = 1, d = 1) => ({
  id,
  x,
  y,
  w,
  d,
});

describe("spec 139 — commercial lot clustering", () => {
  it("no lots -> no clusters (the boot case, where commercial is zero)", () => {
    expect(clusterCommercialLots([])).toEqual([]);
  });

  it("a run of adjacent lots collapses to ONE block at their centroid", () => {
    // five lots two cells apart — well within the 25-cell block width
    const lots = [
      lot("a", 100, 100),
      lot("b", 102, 100),
      lot("c", 104, 100),
      lot("d", 106, 100),
      lot("e", 108, 100),
    ];
    const clusters = clusterCommercialLots(lots);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.count).toBe(5);
    expect(clusters[0]!.x).toBeCloseTo(104, 5); // centroid of 100..108
    expect(clusters[0]!.y).toBeCloseTo(100, 5);
    expect(clusters[0]!.id).toBe("a"); // stable key from the seeding lot
  });

  it("retains the full painted footprint for pad seating", () => {
    const [cluster] = clusterCommercialLots([
      lot("a", 100, 100, 4, 3),
      lot("b", 106, 102, 5, 4),
    ]);
    expect(cluster?.footprint).toEqual({ x: 100, y: 100, w: 11, d: 6 });
  });

  it("uses explicit houseZone footprints for the production cluster union", () => {
    const [cluster] = clusterCommercialLots([
      { id: "a", x: 100, y: 100, footprint: { x: 96, y: 103, w: 5, d: 4 } },
      { id: "b", x: 106, y: 102, footprint: { x: 104, y: 101, w: 7, d: 6 } },
    ]);
    expect(cluster?.footprint).toEqual({ x: 96, y: 101, w: 15, d: 6 });
  });

  it("two far-apart commercial regions stay as two separate blocks", () => {
    const lots = [
      lot("a", 100, 100),
      lot("b", 101, 100),
      lot("c", 400, 400),
      lot("d", 401, 400),
    ];
    const clusters = clusterCommercialLots(lots);
    expect(clusters.length).toBe(2);
    expect(clusters.map((c) => c.count).sort()).toEqual([2, 2]);
  });

  it("is deterministic in input order (stable React keys across renders)", () => {
    const lots = [lot("a", 10, 10), lot("b", 12, 11), lot("c", 200, 200)];
    expect(clusterCommercialLots(lots)).toEqual(clusterCommercialLots(lots));
  });

  it("respects a custom threshold — lots beyond it do not merge", () => {
    const lots = [lot("a", 0, 0), lot("b", 10, 0)];
    expect(clusterCommercialLots(lots, 5).length).toBe(2); // 10 apart, threshold 5 -> split
    expect(clusterCommercialLots(lots, 25).length).toBe(1); // default width -> merge
  });
});
