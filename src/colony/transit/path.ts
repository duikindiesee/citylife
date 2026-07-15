// Spec 149 — pure polyline math for the transit system. The de-zigzag helpers moved here from
// busLayer.ts (render) so the fleet's ARC-LENGTH world — path lengths, stop projections, poses —
// is node-testable without three.js. busLayer re-exports them for its legacy fallback coach.
// Everything is deterministic; no Date.now / no Math.random.

export interface Pt {
  x: number;
  y: number;
}

/** Ramer-Douglas-Peucker line simplification on the loop (treated as a polyline from loop[0] to its last
 *  cell; the closing segment stays implicit). Drops any point within `eps` of the straight line between
 *  kept points, so the BFS staircase weave collapses into straight runs while the road's real bends
 *  (deviation > eps) are kept. */
export function simplifyClosed(loop: Pt[], eps: number): Pt[] {
  if (loop.length < 4) return loop;
  const perp = (p: Pt, a: Pt, b: Pt): number => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  };
  const rdp = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const a = pts[0]!,
      b = pts[pts.length - 1]!;
    let maxD = 0,
      idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = perp(pts[i]!, a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps)
      return rdp(pts.slice(0, idx + 1))
        .slice(0, -1)
        .concat(rdp(pts.slice(idx)));
    return [a, b];
  };
  const out = rdp(loop.map((p) => ({ x: p.x, y: p.y })));
  return out.length >= 2 ? out : loop;
}

/** Chaikin corner-cutting on a CLOSED loop: each iteration replaces every vertex with its 1/4 and 3/4
 *  points (wrapping around), rounding the BFS cell staircase into a smooth circuit. */
export function smoothClosed(loop: Pt[], iters: number): Pt[] {
  let pts = loop.map((p) => ({ x: p.x, y: p.y }));
  for (let it = 0; it < iters; it++) {
    const n = pts.length;
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i]!,
        b = pts[(i + 1) % n]!;
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    pts = out;
  }
  return pts;
}

/** Chaikin on an OPEN polyline: endpoints are pinned so the path still starts and ends exactly where
 *  it must (a depot gate, a road junction); only the interior corners round off. */
export function smoothOpen(path: Pt[], iters: number): Pt[] {
  let pts = path.map((p) => ({ x: p.x, y: p.y }));
  for (let it = 0; it < iters; it++) {
    if (pts.length < 3) return pts;
    const out: Pt[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!,
        b = pts[i + 1]!;
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  return pts;
}

/** A polyline with its cumulative arc-length table, so distances (in CELLS) map to positions in O(log n).
 *  `closed` paths wrap: sampling at s + total is sampling at s, and the segment last->first exists. */
export interface PathData {
  pts: Pt[];
  /** cum[i] = arc length from pts[0] to pts[i]; for closed paths cum has pts.length+1 entries (the wrap). */
  cum: number[];
  total: number;
  closed: boolean;
}

export function buildPath(pts: Pt[], closed: boolean): PathData {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(
      cum[i - 1]! +
        Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y),
    );
  if (closed && pts.length > 1) {
    const a = pts[pts.length - 1]!,
      b = pts[0]!;
    cum.push(cum[cum.length - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { pts, cum, total: cum[cum.length - 1]!, closed };
}

/** Position + travel heading (radians, grid space) at arc length s. Open paths clamp to [0, total];
 *  closed paths wrap. Degenerate paths (a single point / zero length) return that point, heading 0. */
export function samplePath(
  path: PathData,
  s: number,
): { x: number; y: number; heading: number } {
  const n = path.pts.length;
  if (n === 0) return { x: 0, y: 0, heading: 0 };
  if (n === 1 || path.total <= 1e-9)
    return { x: path.pts[0]!.x, y: path.pts[0]!.y, heading: 0 };
  let d = s;
  if (path.closed) {
    d = ((d % path.total) + path.total) % path.total;
  } else {
    d = Math.max(0, Math.min(path.total, d));
  }
  // Binary search the cumulative table for the segment containing d.
  let lo = 0,
    hi = path.cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (path.cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const a = path.pts[lo % n]!,
    b = path.pts[(lo + 1) % n]!;
  const segLen = path.cum[lo + 1]! - path.cum[lo]!;
  const f = segLen > 1e-9 ? (d - path.cum[lo]!) / segLen : 0;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    heading: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** Arc length of the point on `path` nearest to p — how stops and the spur junction are located on
 *  the smoothed loop. Exhaustive over segments (paths are a few hundred points, built once at boot). */
export function projectPath(path: PathData, p: Pt): number {
  const n = path.pts.length;
  if (n === 0) return 0;
  if (n === 1) return 0;
  let bestS = 0,
    bestD = Infinity;
  const segs = path.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = path.pts[i]!,
      b = path.pts[(i + 1) % n]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t =
      l2 > 1e-12
        ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
        : 0;
    const qx = a.x + dx * t,
      qy = a.y + dy * t;
    const d = (p.x - qx) ** 2 + (p.y - qy) ** 2;
    if (d < bestD) {
      bestD = d;
      bestS = path.cum[i]! + Math.sqrt(l2) * t;
    }
  }
  return bestS;
}
