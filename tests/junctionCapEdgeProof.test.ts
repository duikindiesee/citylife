import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  findJunctionZones,
  type JunctionZone,
} from "../src/colony/render/roadJunctions";
import { attachCapPolys, capKerbLines } from "../src/colony/render/junctionCap";
import {
  EDGE_LINE_HALF_WIDTH,
  edgeLineOffset,
} from "../src/colony/render/roadRibbon";

// ROAD.JUNCTION.CAP.1 — the SECOND half of the junction-continuity proof.
//
// tests/junctionContinuityProof.test.ts proves every arm mouth is INSIDE its cap (no gap,
// no interrupted asphalt). That is one-sided: a cap that swallows the whole junction —
// including the verge — satisfies it perfectly. Live, it did exactly that. Measured on
// main @84e4a77 over these same four seeds, 24 of 52 junctions had cap boundary running
// OUTSIDE the union of their arms' carriageways, worst 2.006 cells (8.0 m) at seed 4242
// zone 10: straight chords between two arm mouth corners cutting across the reflex kerb
// notch on the outside, i.e. asphalt wedged into the verge past the white edge line. And
// the cap's own kerb paint was laid hard against the perimeter (~half - 0.036 from the arm
// axis) while roadRibbon.edgeLines paints at half - 0.3, so the white line stepped sideways
// by 0.264 cells (1.06 m) at every mouth — the notch/jog.
//
// So this file pins the missing invariants, over every junction of four seeded worlds:
//   (a) NO OVERSHOOT — no part of the cap (boundary or interior) leaves the union of the
//       arm carriageways.
//   (b) NO NOTCH — every vertex of the cap's kerb paint lies within the painted band of
//       some arm's ribbon edge line, and the band is CENTRED on that line.
//   (c) and the no-gap invariant still holds, at the full mouth WIDTH, not just on the
//       centre-line — so (a) can never be "fixed" by shrinking the cap.
// (a) and (c) are asserted together on purpose: satisfying either alone is the bug.

const SEEDS = [4242, 7, 99, 1234];

function junctionsOf(seed: number): JunctionZone[] {
  const rt = new ColonyRuntime(seed);
  return attachCapPolys(findJunctionZones(rt.sim.state.roadWays ?? []));
}

/** Winding-number point-in-polygon (the caps are concave by design). */
function inside(poly: { x: number; y: number }[], px: number, py: number) {
  let wn = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const side = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
    if (a.y <= py) {
      if (b.y > py && side > 0) wn++;
    } else if (b.y <= py && side < 0) wn--;
  }
  return wn !== 0;
}

/** Arm-local coordinates of a world point: distance ALONG the arm heading from the zone
 *  centre, and unsigned distance ACROSS it. */
function local(
  z: JunctionZone,
  a: JunctionZone["arms"][number],
  px: number,
  py: number,
) {
  const rx = px - z.cx,
    ry = py - z.cy;
  return {
    along: rx * a.ux + ry * a.uy,
    across: Math.abs(rx * -a.uy + ry * a.ux),
  };
}

/** How far a point lies OUTSIDE the union of this zone's arm carriageways, in cells.
 *  <= 0 means it is on paved carriageway. An arm's carriageway is the rectangle
 *  |across| <= half, along in [-back, mouthD]; `back` (one carriageway half-width behind
 *  the centre) is the allowance the cap needs to pave the outer elbow of a bend, and is
 *  measured here against the widest arm so it is never tighter than the builder's. */
function outsideBy(z: JunctionZone, px: number, py: number): number {
  let back = 0;
  for (const a of z.arms) back = Math.max(back, a.half);
  let best = Infinity;
  for (const a of z.arms) {
    const { along, across } = local(z, a, px, py);
    best = Math.min(
      best,
      Math.max(across - a.half, along - a.mouthD, -along - back),
    );
  }
  return best;
}

/** Identity world transform on flat ground, and a terrain that never rejects a cell, so
 *  the paint sweep sees EVERY perimeter run rather than a terrain-filtered subset. */
const flatOpts = {
  terrain: {
    inBounds: () => true,
    idx: () => 0,
    biome: new Uint8Array([3]),
    water: new Uint8Array([0]),
  } as never,
  wx: (x: number) => x,
  wz: (y: number) => y,
  roadY: () => 0,
};

const TOL = 0.02; // cells (8 cm) — geometric slack, far under the 2.006-cell defect

describe("ROAD.JUNCTION.CAP.1 — the cap stays inside the carriageway it caps", () => {
  it("edgeLineOffset is the ribbon's own edge-line position (pinned)", () => {
    // The cap's kerb paint has to continue THIS line. Pinned literally so the shared
    // helper cannot drift and take both sides of the invariant with it.
    expect(edgeLineOffset(2)).toBeCloseTo(1.7, 12);
    expect(edgeLineOffset(2)).toBeCloseTo(Math.max(0.3, 2 - 0.3), 12);
    expect(edgeLineOffset(0.4)).toBeCloseTo(0.3, 12);
    expect(EDGE_LINE_HALF_WIDTH).toBeCloseTo(0.09, 12);
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: no cap overshoots the carriageway edge, and none leaves a mouth uncovered`, () => {
      const zones = junctionsOf(seed);
      expect(zones.length, "world has junctions to prove").toBeGreaterThan(0);

      const over: string[] = [];
      const gaps: string[] = [];
      for (let zi = 0; zi < zones.length; zi++) {
        const z = zones[zi]!;
        const poly = z.poly;
        expect(
          poly.length >= 3,
          `seed ${seed} zone ${zi} has no cap polygon`,
        ).toBe(true);

        // (a) BOUNDARY: walk every edge at 0.1-cell resolution.
        let worst = -Infinity;
        let worstAt = { x: 0, y: 0 };
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i]!,
            b = poly[(i + 1) % poly.length]!;
          const n = Math.max(
            2,
            Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1),
          );
          for (let s = 0; s <= n; s++) {
            const t = s / n;
            const px = a.x + (b.x - a.x) * t,
              py = a.y + (b.y - a.y) * t;
            const d = outsideBy(z, px, py);
            if (d > worst) {
              worst = d;
              worstAt = { x: px, y: py };
            }
          }
        }
        // (a) INTERIOR: a 0.25-cell lattice over the cap's bounding box. Anything the
        // polygon encloses is asphalt and must be carriageway too.
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const p of poly) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
        for (let y = minY; y <= maxY; y += 0.25)
          for (let x = minX; x <= maxX; x += 0.25) {
            if (!inside(poly, x, y)) continue;
            const d = outsideBy(z, x, y);
            if (d > worst) {
              worst = d;
              worstAt = { x, y };
            }
          }
        if (worst > TOL)
          over.push(
            `zone ${zi} (${z.kind}, ${z.arms.length} arms): cap runs ${worst.toFixed(3)} cells past the carriageway edge at (${worstAt.x.toFixed(2)}, ${worstAt.y.toFixed(2)})`,
          );

        // (c) NO GAP, at the full mouth width — not just the centre-line sample the
        // existing continuity proof takes.
        for (let ai = 0; ai < z.arms.length; ai++) {
          const arm = z.arms[ai]!;
          for (const k of [-0.9, -0.5, 0, 0.5, 0.9]) {
            const off = k * (arm.half - 0.1);
            const mx = z.cx + arm.ux * (arm.mouthD - 0.25) + -arm.uy * off;
            const my = z.cy + arm.uy * (arm.mouthD - 0.25) + arm.ux * off;
            if (!inside(poly, mx, my))
              gaps.push(
                `zone ${zi} arm ${ai} at across=${off.toFixed(2)} (${mx.toFixed(2)}, ${my.toFixed(2)})`,
              );
          }
        }
      }

      expect(
        over.length === 0
          ? "no overshoot"
          : `seed ${seed}: ${over.length}/${zones.length} junction caps overshoot the carriageway — ${over.slice(0, 4).join(" | ")}`,
      ).toBe("no overshoot");
      expect(
        gaps.length === 0
          ? "no gap"
          : `seed ${seed}: ${gaps.length} mouth sample(s) fall outside their cap — ${gaps.slice(0, 4).join(" | ")}`,
      ).toBe("no gap");
    });

    it(`seed ${seed}: junction kerb paint continues the arms' edge lines with no notch`, () => {
      const zones = junctionsOf(seed);
      const notches: string[] = [];
      let painted = 0;
      for (let zi = 0; zi < zones.length; zi++) {
        const z = zones[zi]!;
        if (z.poly.length < 3) continue;
        const out: number[] = [];
        capKerbLines(z, flatOpts, out);
        for (let i = 0; i < out.length; i += 3) {
          painted++;
          const px = out[i]!,
            py = out[i + 2]!;
          // Every corner of the painted strip must sit EXACTLY one paint half-width off
          // some arm's ribbon edge line — i.e. the strip is the same width and centred on
          // the same line as the edge line it continues. Merely landing somewhere inside
          // the band would still allow a strip laid off-centre, which reads as a step.
          let best = Infinity,
            bestArm = -1,
            bestAcross = 0;
          for (let ai = 0; ai < z.arms.length; ai++) {
            const a = z.arms[ai]!;
            const { across, along } = local(z, a, px, py);
            if (along > a.mouthD + 0.5 || along < -a.half - 0.5) continue;
            const target = Math.max(0.3, a.half - 0.3); // roadRibbon.edgeLines
            const err = Math.abs(
              Math.abs(across - target) - EDGE_LINE_HALF_WIDTH,
            );
            if (err < best) {
              best = err;
              bestArm = ai;
              bestAcross = across;
            }
          }
          if (best > 1e-6)
            notches.push(
              `zone ${zi}: kerb paint corner (${px.toFixed(2)}, ${py.toFixed(2)}) is ${bestAcross.toFixed(3)} cells off arm ${bestArm}'s axis, ${best.toFixed(3)} cells away from that arm's edge-line band`,
            );
        }
      }
      expect(painted, "junctions actually emit kerb paint").toBeGreaterThan(0);
      expect(
        notches.length === 0
          ? "collinear"
          : `seed ${seed}: ${notches.length} kerb-paint notch(es) — ${notches.slice(0, 4).join(" | ")}`,
      ).toBe("collinear");
    });
  }
});
