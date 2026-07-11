// Spec 137 — junction zones from WAY-PAIR EVENTS, not cell blobs. Spec 127 detected
// junctions by dilating each centre-line into cells and flood-filling shared cells: the
// centroid of that blob drifted off the true crossing (offset tees), twin blobs 5-7 cells
// apart on one crossing produced two overlapping slabs, near-miss parallel ways produced
// phantom "pass" zones, and arms were compass-snapped. Here a junction is an EVENT between
// two ways' smoothed centre-lines: a real segment-segment intersection, or an endpoint
// projecting onto another way's line (a tee). Events merge only when their caps would
// overlap AND they share a way, each zone's arms carry their REAL unit headings and
// per-arm half-widths, and every mouth knows how far from the centre the junction tarmac
// must reach to clear every other arm's carriageway. Pure math, node-testable; the cap
// builder (junctionCap.ts) turns zones into draped geometry and the React layer draws it.
import type { RoadWay } from "./roadRibbon";
import { chaikin, densify } from "./roadRibbon";

export interface JunctionArm {
  /** Unit heading OUT of the junction (grid coords). Traffic approaches along -u. */
  ux: number;
  uy: number;
  /** This arm's carriageway half-width in cells (way.width / 2). */
  half: number;
  /** Distance (cells) from the zone centre to the arm MOUTH — where the junction tarmac
   *  ends and the ordinary ribbon begins. Crosswalks/stop bars/furniture anchor here. */
  mouthD: number;
  /** True when the arm's road ENDS at this junction (a T approach). */
  terminating: boolean;
  /** Index of the way this arm belongs to. */
  wayIdx: number;
}

export interface JunctionZone {
  /** Zone centre, grid coords — a real centre-line intersection (or endpoint projection
   *  for tees), never a blob centroid. */
  cx: number;
  cy: number;
  kind: "cross" | "tee" | "bend";
  arms: JunctionArm[];
  /** Indices of the ways that meet here (adjacency input for the ribbon micro-lift). */
  wayIdx: number[];
  /** Convex cap outline (grid coords) incl. kerb-corner fillet points. Built by
   *  junctionCap.capPolygon and attached here so paint suppression, coverage, foliage
   *  clearing and the cap mesh all share ONE footprint. */
  poly: { x: number; y: number }[];
  /** Bounding-circle radius (cells) around (cx, cy) for cheap point rejection. */
  rBound: number;
}

export interface FurnitureItem {
  kind: "light" | "stopsign" | "stopline";
  x: number;
  y: number;
  rotY: number;
  /** The arm's half-width in WORLD metres (cells * 4) — furniture scales with the road. */
  laneHalfM: number;
  /** Signal phase group: arms clustered on one axis share a group and go green together
   *  while the other axis holds red. */
  group?: "A" | "B";
}

const APRON = 0.75; // cells of clear tarmac beyond the geometric overlap at every mouth
const SIN_MIN = Math.sin((28 * Math.PI) / 180); // shallower pairs merge/reject upstream
const MOUTH_MAX = 6; // never a monster cap

const unit = (x: number, y: number) => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};

/** Acute angle between two arm AXES (lines, not rays): 0..PI/2. */
export function axisAngle(
  a: { ux: number; uy: number },
  b: { ux: number; uy: number },
): number {
  const dot = Math.abs(a.ux * b.ux + a.uy * b.uy);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** Proper segment-segment intersection point, or null. Touching endpoints count. */
function segIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): { x: number; y: number } | null {
  const rx = b.x - a.x,
    ry = b.y - a.y,
    sx = d.x - c.x,
    sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null; // parallel — never a crossing event
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + rx * t, y: a.y + ry * t };
}

/** Cumulative arc length per station. */
function arcLengths(p: { x: number; y: number }[]): number[] {
  const cum = [0];
  for (let i = 0; i < p.length - 1; i++)
    cum.push(cum[i]! + Math.hypot(p[i + 1]!.x - p[i]!.x, p[i + 1]!.y - p[i]!.y));
  return cum;
}

interface JunctionEvent {
  x: number;
  y: number;
  ways: Set<number>;
}

/** Find the junction zones of a road network from way-pair centre-line events. */
export function findJunctionZones(ways: RoadWay[]): JunctionZone[] {
  const paths = ways.map((w) =>
    w.path.length >= 2 ? densify(chaikin(w.path, 2), 1.5) : null,
  );
  const events: JunctionEvent[] = [];
  const addEvent = (x: number, y: number, wi: number, wj: number) => {
    // fold events within 1.5 cells that share a way — one crossing can hit several
    // adjacent segment pairs of the same two smoothed lines
    for (const e of events) {
      if (
        Math.hypot(e.x - x, e.y - y) <= 1.5 &&
        (e.ways.has(wi) || e.ways.has(wj))
      ) {
        e.x = (e.x + x) / 2;
        e.y = (e.y + y) / 2;
        e.ways.add(wi);
        e.ways.add(wj);
        return;
      }
    }
    events.push({ x, y, ways: new Set([wi, wj]) });
  };

  // AABB per path so pairs that never come near skip the O(n*m) segment sweep — keeps
  // hand-built cities (dozens of ways, rebuilt on every road edit) snappy.
  const boxes = paths.map((p) => {
    if (!p) return null;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const q of p) {
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.y > maxY) maxY = q.y;
    }
    return { minX, maxX, minY, maxY };
  });
  for (let i = 0; i < ways.length; i++) {
    const pi = paths[i];
    if (!pi) continue;
    for (let j = i + 1; j < ways.length; j++) {
      const pj = paths[j];
      if (!pj) continue;
      const bi = boxes[i]!,
        bj = boxes[j]!;
      const gap = ways[i]!.width / 2 + ways[j]!.width / 2 + 1;
      if (
        bi.minX > bj.maxX + gap ||
        bj.minX > bi.maxX + gap ||
        bi.minY > bj.maxY + gap ||
        bj.minY > bi.maxY + gap
      )
        continue;
      // (a) true centre-line crossings
      for (let a = 0; a < pi.length - 1; a++) {
        for (let b = 0; b < pj.length - 1; b++) {
          const hit = segIntersect(pi[a]!, pi[a + 1]!, pj[b]!, pj[b + 1]!);
          if (hit) addEvent(hit.x, hit.y, i, j);
        }
      }
      // (b) tee events: one way's END near the other's line -> centre is the
      // PERPENDICULAR PROJECTION onto the through way (fixes offset tees)
      const eps = ways[i]!.width / 2 + ways[j]!.width / 2 + 0.5;
      const project = (
        endpoint: { x: number; y: number },
        onto: { x: number; y: number }[],
      ): { x: number; y: number } | null => {
        let best: { x: number; y: number; d: number } | null = null;
        for (let s = 0; s < onto.length - 1; s++) {
          const ax = onto[s]!.x,
            ay = onto[s]!.y;
          const vx = onto[s + 1]!.x - ax,
            vy = onto[s + 1]!.y - ay;
          const len2 = vx * vx + vy * vy || 1;
          const t = Math.max(
            0,
            Math.min(1, ((endpoint.x - ax) * vx + (endpoint.y - ay) * vy) / len2),
          );
          const px = ax + vx * t,
            py = ay + vy * t;
          const d = Math.hypot(endpoint.x - px, endpoint.y - py);
          if (d < eps && (!best || d < best.d)) best = { x: px, y: py, d };
        }
        return best;
      };
      for (const [endWay, endPath, other] of [
        [i, pi, pj],
        [j, pj, pi],
      ] as const) {
        for (const endpoint of [endPath[0]!, endPath[endPath.length - 1]!]) {
          const hit = project(endpoint, other);
          if (hit) addEvent(hit.x, hit.y, endWay, endWay === i ? j : i);
        }
      }
    }
  }

  // Merge only TRUE same-crossing duplicates (multi-hits of one crossing that escaped
  // the addEvent fold). Distant twins on the same ways stay SEPARATE zones: the exact
  // carriageway union (spec 137 v2) is drawn per crossing point — one star centre
  // cannot draw honest kerb lines for two crossings, which is exactly how the merged
  // blob the operator called an antipattern happened. Adjacent exact pads overlap
  // benignly along the shared road (per-zone micro-lift in the cap builder).
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let a = 0; a < events.length; a++) {
      for (let b = a + 1; b < events.length; b++) {
        const ea = events[a]!,
          eb = events[b]!;
        let shared = 0;
        for (const w of ea.ways) if (eb.ways.has(w)) shared++;
        if (shared === 0) continue;
        const d = Math.hypot(ea.x - eb.x, ea.y - eb.y);
        if (d <= (shared >= 2 ? 3 : 2.5)) {
          ea.x = (ea.x + eb.x) / 2;
          ea.y = (ea.y + eb.y) / 2;
          for (const w of eb.ways) ea.ways.add(w);
          events.splice(b, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  const zones: JunctionZone[] = [];
  for (const e of events) {
    const arms: JunctionArm[] = [];
    for (const wi of e.ways) {
      const cp = paths[wi];
      if (!cp) continue;
      const cum = arcLengths(cp);
      const total = cum[cum.length - 1]!;
      // nearest station to the centre
      let si = 0,
        sd = Infinity;
      for (let s = 0; s < cp.length; s++) {
        const d = Math.hypot(cp[s]!.x - e.x, cp[s]!.y - e.y);
        if (d < sd) {
          sd = d;
          si = s;
        }
      }
      const half = ways[wi]!.width / 2;
      const reach = half + 3; // how far out we sample the arm heading
      const STUB = 2.5; // material shorter than this on a side is a swallowed nub
      const remFwd = total - cum[si]!;
      const remBack = cum[si]!;
      // FORWARD arm (toward path end) and BACKWARD arm (toward path start). An arm
      // TERMINATES when the way has no material continuing on the OPPOSITE side of the
      // junction — a road ending here, the T approach.
      for (const dir of [1, -1] as const) {
        const remaining = dir === 1 ? remFwd : remBack;
        const opposite = dir === 1 ? remBack : remFwd;
        if (remaining < STUB) continue; // nub — the way ends basically at the centre
        // station ~reach cells out along this side
        const target = cum[si]! + dir * Math.min(reach, remaining);
        let k = si;
        while (k > 0 && cum[k]! > target) k--;
        while (k < cp.length - 1 && cum[k + 1]! < target) k++;
        const p = cp[Math.max(0, Math.min(cp.length - 1, k + (dir === 1 ? 1 : 0)))]!;
        const u = unit(p.x - e.x, p.y - e.y);
        arms.push({
          ux: u.x,
          uy: u.y,
          half,
          mouthD: 0, // filled below once all arms are known
          terminating: opposite < STUB,
          wayIdx: wi,
        });
      }
    }
    if (arms.length < 2) continue;

    // Mouth distances: the pad's side edges run EXACTLY along each arm's kerb lines, and
    // adjacent arms' kerbs intersect at t = (h_other + h_self*cos(delta)) / sin(delta)
    // along the arm (the true kerb corner). The mouth must sit past every such corner
    // plus an apron, so the mouth edge is a clean square cut across the carriageway.
    // Shallow pairs are floored at SIN_MIN (28 deg); past MOUTH_MAX the corner walk in
    // junctionCap falls back to a straight chamfer.
    for (const a of arms) {
      let need = 0;
      for (const b of arms) {
        if (b === a) continue;
        const ang = axisAngle({ ux: a.ux, uy: a.uy }, { ux: b.ux, uy: b.uy });
        if (ang < 1e-3) continue; // same axis (the opposite arm of a through way)
        const s = Math.max(Math.sin(ang), SIN_MIN);
        need = Math.max(need, (b.half + a.half * Math.cos(ang)) / s);
      }
      a.mouthD = Math.min(
        MOUTH_MAX,
        Math.max(2, a.half + 0.5, need + APRON),
      );
    }

    // Classify. Two near-collinear arms are just a way passing a projection event —
    // not a junction at all.
    let kind: JunctionZone["kind"];
    if (arms.length >= 4) kind = "cross";
    else if (arms.length === 3) kind = "tee";
    else {
      const ang = axisAngle(
        { ux: arms[0]!.ux, uy: arms[0]!.uy },
        { ux: arms[1]!.ux, uy: arms[1]!.uy },
      );
      if (ang < (25 * Math.PI) / 180) continue; // straight continuation — no zone
      kind = "bend";
    }
    const rBound =
      Math.max(...arms.map((a) => a.mouthD + a.half)) + 0.6;
    zones.push({
      cx: e.x,
      cy: e.y,
      kind,
      arms,
      wayIdx: [...e.ways],
      poly: [], // attached by junctionCap.capPolygon (React layer calls attachCapPolys)
      rBound,
    });
  }
  return zones;
}

/** Street furniture from REAL arm headings — never compass-snapped. SA left-hand drive:
 *  everything serving an approach stands on the LEFT verge of that approach (left of
 *  travel t = -u is L = (-uy, ux)). Positions in grid coords; rotY faces the approach
 *  (world yaw convention atan2(x, y), matching wx/wz). */
export function junctionFurniture(zone: JunctionZone): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  if (zone.kind === "bend") return items;

  // Signal phase groups: cluster arms by axis; the seed arm's axis is group A.
  const seed = zone.arms[0]!;
  const groupOf = (a: JunctionArm): "A" | "B" =>
    axisAngle(seed, a) < Math.PI / 4 ? "A" : "B";

  // A furniture pole must never stand inside ANY arm's carriageway corridor.
  const insideAnyCarriageway = (px: number, py: number): boolean => {
    for (const b of zone.arms) {
      const rx = px - zone.cx,
        ry = py - zone.cy;
      const along = rx * b.ux + ry * b.uy;
      const across = Math.abs(rx * -b.uy + ry * b.ux);
      if (along > -0.5 && along < b.mouthD + 2 && across < b.half + 0.2)
        return true;
    }
    return false;
  };
  const placeClear = (
    mx: number,
    my: number,
    lx: number,
    ly: number,
  ): { x: number; y: number } => {
    let x = mx,
      y = my;
    for (let i = 0; i < 4 && insideAnyCarriageway(x, y); i++) {
      x += lx * 0.8;
      y += ly * 0.8;
    }
    return { x, y };
  };

  for (const a of zone.arms) {
    const L = { x: -a.uy, y: a.ux }; // left verge of this approach
    const mx = zone.cx + a.ux * a.mouthD,
      my = zone.cy + a.uy * a.mouthD;
    if (zone.kind === "cross") {
      const p = placeClear(
        mx + a.ux * 0.6 + L.x * (a.half + 0.4),
        my + a.uy * 0.6 + L.y * (a.half + 0.4),
        L.x,
        L.y,
      );
      items.push({
        kind: "light",
        x: p.x,
        y: p.y,
        rotY: Math.atan2(a.ux, a.uy),
        laneHalfM: a.half * 4,
        group: groupOf(a),
      });
    }
    if (zone.kind === "tee" && a.terminating) {
      const p = placeClear(
        mx + a.ux * 0.7 + L.x * (a.half + 0.5),
        my + a.uy * 0.7 + L.y * (a.half + 0.5),
        L.x,
        L.y,
      );
      items.push({
        kind: "stopsign",
        x: p.x,
        y: p.y,
        rotY: Math.atan2(a.ux, a.uy),
        laneHalfM: a.half * 4,
      });
    }
  }
  return items;
}
