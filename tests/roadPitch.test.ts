// Spec 118 — road seam continuity. The invariant under test: ADJACENT SEGMENTS AGREE ON
// THEIR SHARED BOUNDARY HEIGHT, EXACTLY. Everything else (pitch, center, length) follows
// from landing the segment ends on those shared heights.
import { describe, it, expect } from "vitest";
import {
  ROAD_CELL_SPAN,
  isPitchableNS,
  isPitchableEW,
  isFlatRoad,
  roadEdgeHeight,
  pitchBetweenEdges,
} from "../src/colony/render/roadPitch";

describe("spec 118 — mask classification (Article I: pitch along travel, no roll)", () => {
  it("classifies straights and dead ends as pitchable on exactly one axis", () => {
    for (const m of [1, 4, 5]) {
      expect(isPitchableNS(m)).toBe(true);
      expect(isPitchableEW(m)).toBe(false);
    }
    for (const m of [2, 8, 10]) {
      expect(isPitchableEW(m)).toBe(true);
      expect(isPitchableNS(m)).toBe(false);
    }
  });

  it("keeps corners, junctions, crossroads and isolated cells flat", () => {
    for (const m of [0, 3, 6, 9, 12, 7, 11, 13, 14, 15]) {
      expect(isFlatRoad(m)).toBe(true);
    }
  });
});

describe("spec 118 — shared edge heights are symmetric (the no-seam invariant)", () => {
  it("two pitched neighbors compute the identical boundary from either side", () => {
    const a = 1.37, b = 2.9;
    expect(roadEdgeHeight(a, false, b, false)).toBe(roadEdgeHeight(b, false, a, false));
    expect(roadEdgeHeight(a, false, b, false)).toBe((a + b) / 2);
  });

  it("a flat tile wins from both sides — the pitched segment bends to meet it", () => {
    const flatH = 3.0, pitchedH = 2.2;
    expect(roadEdgeHeight(pitchedH, false, flatH, true)).toBe(flatH);
    expect(roadEdgeHeight(flatH, true, pitchedH, false)).toBe(flatH);
  });

  it("no neighbor: a dead end holds its own height at the open edge", () => {
    expect(roadEdgeHeight(1.5, false, null, false)).toBe(1.5);
  });

  it("two adjacent flats agree on max from either side", () => {
    expect(roadEdgeHeight(1.0, true, 2.0, true)).toBe(2.0);
    expect(roadEdgeHeight(2.0, true, 1.0, true)).toBe(2.0);
  });
});

describe("spec 118 — segments land exactly on their shared edges", () => {
  it("edge landing is exact: center +/- half-length along the pitch hits the edge heights", () => {
    const { rot, centerY, length } = pitchBetweenEdges(2.0, 0.5);
    expect(centerY + (length / 2) * Math.sin(rot)).toBeCloseTo(2.0, 12);
    expect(centerY - (length / 2) * Math.sin(rot)).toBeCloseTo(0.5, 12);
  });

  it("projected footprint stays exactly one 4m cell (orthogonal purity)", () => {
    const { rot, length } = pitchBetweenEdges(3.7, 1.1);
    expect(length * Math.cos(rot)).toBeCloseTo(ROAD_CELL_SPAN, 12);
  });

  it("level ground degenerates to the flat segment", () => {
    const p = pitchBetweenEdges(2.0, 2.0);
    expect(p.rot).toBe(0);
    expect(p.centerY).toBe(2.0);
    expect(p.length).toBe(ROAD_CELL_SPAN);
  });

  it("a chain of segments over a slope has NO step at any boundary", () => {
    // A north-south road over rolling ground: surface heights per cell.
    const heights = [0.0, 0.3, 0.8, 1.4, 1.4, 0.9];
    // masks: dead end, straights, dead end — all pitchable NS.
    const edges: { north: number; south: number }[] = heights.map((h, i) => {
      const north = roadEdgeHeight(h, false, i > 0 ? heights[i - 1] : null, false);
      const south = roadEdgeHeight(h, false, i < heights.length - 1 ? heights[i + 1] : null, false);
      return { north, south };
    });
    for (let i = 0; i + 1 < edges.length; i++) {
      // segment i's south boundary IS segment i+1's north boundary — exactly.
      expect(edges[i].south).toBe(edges[i + 1].north);
      // and both segments' rendered ends land on it exactly
      const a = pitchBetweenEdges(edges[i].north, edges[i].south);
      const b = pitchBetweenEdges(edges[i + 1].north, edges[i + 1].south);
      const aSouthEnd = a.centerY - (a.length / 2) * Math.sin(a.rot);
      const bNorthEnd = b.centerY + (b.length / 2) * Math.sin(b.rot);
      expect(aSouthEnd).toBeCloseTo(bNorthEnd, 12);
    }
  });

  it("a straight meeting a flat intersection lands exactly on the intersection surface", () => {
    const straightH = 2.6, junctionH = 2.0;
    const edge = roadEdgeHeight(straightH, false, junctionH, true);
    const p = pitchBetweenEdges(roadEdgeHeight(straightH, false, null, false), edge);
    const meetingEnd = p.centerY - (p.length / 2) * Math.sin(p.rot);
    expect(edge).toBe(junctionH);
    expect(meetingEnd).toBeCloseTo(junctionH, 12);
  });
});
