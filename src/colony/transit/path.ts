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

/** BUS.ROUTE.TURN.1 — how far (in cells) a corner may be cut off the routed line.
 *
 *  Textbook Chaikin cuts a QUARTER of every segment, so the corner it rounds moves by a distance
 *  PROPORTIONAL TO THE ADJACENT SEGMENT LENGTHS. That is harmless on the raw BFS loop (1-cell
 *  segments -> sub-cell rounding), but the loop is `simplifyClosed`d FIRST, which collapses the
 *  staircase into straight runs averaging ~29 cells. Cutting a quarter off runs that long sweeps
 *  the bus clean off the tarmac at every tight bend: measured on seed 4242, the smoothed loop ran
 *  8.86 cells (35 m) from the nearest drivable cell at (492, 198), with 70 sampled positions more
 *  than 5 cells out — buses driving a long, graceful arc across open veld.
 *
 *  Clamping the cut to a fixed DISTANCE decouples the corner radius from the segment length: long
 *  straight runs stay straight, and every corner rounds over the same ~1-cell fillet whatever the
 *  arms measure. 1 cell = 4 m, a plausible turn-in for a bus and comfortably inside the 4-cell
 *  carriageway. The bound holds across iterations because each pass only re-rounds the (short)
 *  fillet it just made.
 *
 *  NOTE: render/roadRibbon's `chaikin` has the SAME defect on the rendered asphalt (9.28 cells off
 *  its own road cells on seed 4242) and is NOT fixed here — capping it moves the conservative
 *  ribbon footprint enough to break depot siting on the live seed. See the
 *  claude-citylife/road-ribbon-corner-cut branch. When that lands, this rule should be hoisted
 *  somewhere both can share so the two cannot drift. */
const MAX_CORNER_CUT_CELLS = 1;

/** Corner-cut fraction for one segment: a quarter (plain Chaikin) unless that would cut more than
 *  `maxCut` cells off, in which case cut exactly `maxCut`. Zero-length segments cut nothing. */
function cornerCutFraction(a: Pt, b: Pt, maxCut: number): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return len > 1e-9 ? Math.min(0.25, maxCut / len) : 0;
}

/** Chaikin corner-cutting on a CLOSED loop: each iteration replaces every vertex with points near
 *  its 1/4 and 3/4 points (wrapping around), rounding the BFS cell staircase into a smooth circuit.
 *  The cut is capped at `maxCut` cells per corner — see MAX_CORNER_CUT_CELLS. */
export function smoothClosed(
  loop: Pt[],
  iters: number,
  maxCut = MAX_CORNER_CUT_CELLS,
): Pt[] {
  let pts = loop.map((p) => ({ x: p.x, y: p.y }));
  for (let it = 0; it < iters; it++) {
    const n = pts.length;
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i]!,
        b = pts[(i + 1) % n]!;
      const f = cornerCutFraction(a, b, maxCut);
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      out.push({ x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f });
    }
    pts = out;
  }
  return pts;
}

/** Chaikin on an OPEN polyline: endpoints are pinned so the path still starts and ends exactly where
 *  it must (a depot gate, a road junction); only the interior corners round off. Same per-corner cap
 *  as smoothClosed. */
export function smoothOpen(
  path: Pt[],
  iters: number,
  maxCut = MAX_CORNER_CUT_CELLS,
): Pt[] {
  let pts = path.map((p) => ({ x: p.x, y: p.y }));
  for (let it = 0; it < iters; it++) {
    if (pts.length < 3) return pts;
    const out: Pt[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!,
        b = pts[i + 1]!;
      const f = cornerCutFraction(a, b, maxCut);
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      out.push({ x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f });
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

/** Douglas-Peucker tolerance for the route loop: below this the BFS staircase weave is noise, above
 *  it is a real bend in the road. Also the loop's own worst-case offset from the routed line. */
export const ROUTE_SIMPLIFY_EPS_CELLS = 1.5;

/** Corner-cutting passes over the simplified loop. Three rather than the original two because the
 *  cut is now capped (MAX_CORNER_CUT_CELLS): each pass re-rounds only the short fillet the previous
 *  one made, so an extra pass buys turn-in resolution — ~8 vertices through a corner instead of 4 —
 *  without widening the corner. It cost the old unbounded smoother a longer sweep off the road. */
export const ROUTE_SMOOTH_ITERS = 3;

/** The driven bus circuit: straighten the BFS staircase (Douglas-Peucker), then round the real bends
 *  (capped Chaikin). ONE definition, shared by the runtime's fleet geometry and busLayer's legacy
 *  fallback coach — they have to drive the identical line, or the coach rides beside the fleet. */
export function busLoopPath(loop: Pt[]): PathData {
  return buildPath(
    smoothClosed(
      simplifyClosed(loop, ROUTE_SIMPLIFY_EPS_CELLS),
      ROUTE_SMOOTH_ITERS,
    ),
    true,
  );
}

/** BUS.LANE.1 — the pose at arc length `s`, moved into its LANE instead of straddling the
 *  centre-line. `offsetCells` is measured to the LEFT of travel, the SA near-side kerb the doors
 *  already open onto (busStopAnchor, junctionCap and alightBus all agree on that side).
 *
 *  Offsetting a curve is not offsetting a point: on the INSIDE of a bend the offset line has a
 *  smaller radius than the centre-line, and once the offset exceeds that radius the line turns
 *  itself inside out — the bus would swing backwards through the corner. The driven loop's fillets
 *  are ~0.3 cells, well under a 1-cell lane offset, so this is not a theoretical worry.
 *
 *  So the offset is CLAMPED by the local turn radius: full lane offset on a straight or on the
 *  outside of a bend, tapering to nothing as the inside radius closes. A bus cutting toward the
 *  centre-line through a tight turn is also what real ones do, so the degradation reads correctly
 *  rather than as a glitch.
 *
 *  Arc length is untouched: `s` still parameterises the CENTRE-LINE, so speeds, stop projections
 *  and the fleet's dispatch spacing are all unaffected by which lane the body sits in. */
export function lanePose(
  path: PathData,
  s: number,
  offsetCells: number,
  /** How much of the inside radius the offset may consume before it is cut back. */
  safety = 0.6,
): { x: number; y: number; heading: number } {
  const here = samplePath(path, s);
  if (offsetCells === 0 || path.total <= 1e-9) return here;
  // Curvature from symmetric samples around s, at SEVERAL SCALES, keeping the tightest radius any
  // of them sees. One scale is not enough: a wide pair averages straight over a short sharp feature
  // and under-clamps (a 1-cell pair reads a 0.3-cell fillet as nearly straight, and the offset line
  // then reverses through it), while a narrow pair alone is noisy on gentle curves where packed
  // vertices dominate. Taking the minimum is the conservative read.
  let radius = Infinity;
  let turnAtTightest = 0;
  for (const scale of [0.25, 0.5, 1]) {
    const step = Math.min(scale, path.total / 8);
    if (step <= 1e-9) continue;
    // ...and over a WINDOW of positions either side of s, not at s alone. The clamp has to vary
    // CONTINUOUSLY: evaluated pointwise, one sample can straddle a tip and clamp hard while its
    // neighbour reads the straight arm and does not, so the lane line jumps between two offsets and
    // the bus appears to step backwards. Neighbouring samples share most of this window, so the
    // limit they derive is near enough identical. A tight bend anywhere WITHIN REACH is a reason to
    // already be tucked in, which is also how the corner is actually driven.
    for (const du of [-1, -0.5, 0, 0.5, 1]) {
      const at = s + du * step;
      const before = samplePath(path, at - step);
      const after = samplePath(path, at + step);
      let turn = after.heading - before.heading;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      if (Math.abs(turn) < 1e-9) continue; // straight here at this scale
      const r = (2 * step) / Math.abs(turn); // radius = arc / |dtheta|
      if (r < radius) {
        radius = r;
        turnAtTightest = turn;
      }
    }
  }
  // A LEFT offset is on the inside of a LEFT turn (turn > 0 in this grid, y down).
  const insideTurn =
    turnAtTightest === 0
      ? false
      : offsetCells > 0
        ? turnAtTightest > 0
        : turnAtTightest < 0;
  const limit = insideTurn ? Math.max(0, radius * safety) : Infinity;
  const applied =
    Math.sign(offsetCells) * Math.min(Math.abs(offsetCells), limit);

  // BUS.COLLIDE.1 — where the route doubles back, both directions offset from the SHARED centre.
  //
  // A route serving a spur goes out and comes back along the same carriageway, and `makeBusRoute`
  // gives those two legs slightly different cell paths — measured 1.82 cells apart on seed 1234.
  // Offsetting each leg from ITS OWN line then double-counts a separation that already exists, and
  // because the return leg happens to lie on the outbound leg's LEFT, keeping left drives them
  // together: 1.82 cells became 0.23, which is inside a 0.625-cell-wide coach.
  //
  // Real left-hand traffic does not work that way. Opposing flows share ONE carriageway centre and
  // each keeps left OF THAT, which is what puts them on opposite sides. So when an opposing pass is
  // close enough to be the same road, the offset is measured from the midline between the two legs
  // rather than from this leg alone. Both coaches then sit a full offset either side of the shared
  // centre — properly in lane, and 2x the offset apart instead of converging.
  //
  // A clamp was tried first and rejected: giving the offset up removed lane keeping on 81% of the
  // route (off-centre service poses fell from over 70% to 19.1%), because these legs run close
  // together for most of their length. Sharing the centre keeps the full offset everywhere.
  const base = sharedCarriagewayCentre(path, s, here);

  return {
    x: base.x - Math.sin(here.heading) * applied,
    y: base.y + Math.cos(here.heading) * applied,
    heading: here.heading,
  };
}

/**
 * Two legs closer than this are treated as one carriageway with oncoming traffic, in cells. A
 * carriageway is ~4 cells; 3 keeps genuinely separate roads that merely run near each other from
 * being fused, while catching an out-and-back pair (measured 1.82 cells apart).
 */
const SHARED_CARRIAGEWAY_CELLS = 2;

/**
 * Arc-length window either side of `s` that is the same road continuing and must not be mistaken
 * for an opposing pass. Wider than any legitimate corner — on a tight bend the path is genuinely
 * near itself a few cells later.
 */
const SELF_IGNORE_CELLS = 24;

/**
 * The centre to offset from: the midline between this point and the nearest OPPOSING pass of the
 * same path, or this point itself when the route does not double back nearby.
 *
 * Segments, not vertices. A first attempt scanned vertices and was useless: on seed 1234 the loop
 * carries 432 points over 2636.6 cells — 6.1 cells apart — so from the colliding bus the nearest
 * qualifying VERTEX sat 15.997 cells away while the nearest point on the opposing SEGMENT was
 * 0.000. Anything vertex-based simply cannot see this geometry.
 */
function sharedCarriagewayCentre(
  path: PathData,
  s: number,
  here: { x: number; y: number; heading: number },
): { x: number; y: number } {
  const n = path.pts.length;
  if (n < 2 || path.total <= 1e-9) return here;

  // Callers pass a RAW arc that can exceed `total` (the fleet uses `joinT + lapT % loopLen` and
  // relies on samplePath wrapping), so normalise before comparing arc distances.
  const sNorm = path.closed
    ? ((s % path.total) + path.total) % path.total
    : Math.max(0, Math.min(path.total, s));

  const hx = Math.cos(here.heading);
  const hy = Math.sin(here.heading);
  const last = path.closed ? n : n - 1;

  let bestDist = Infinity;
  let bestX = 0;
  let bestY = 0;

  for (let i = 0; i < last; i++) {
    const arcA = path.cum[i] ?? 0;
    const arcB = path.cum[i + 1] ?? path.total;
    const gap = (arc: number) => {
      let d = Math.abs(arc - sNorm);
      if (path.closed) d = Math.min(d, path.total - d);
      return d;
    };
    // Skip only when the WHOLE segment is inside the ignore window; one straddling its edge still
    // carries a real opposing pass at its far end.
    if (gap(arcA) < SELF_IGNORE_CELLS && gap(arcB) < SELF_IGNORE_CELLS)
      continue;

    const a = path.pts[i]!;
    const b = path.pts[(i + 1) % n]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const l2 = vx * vx + vy * vy;
    if (l2 < 1e-12) continue;

    // Only OPPOSING traffic shares a centre with us. A same-direction leg running alongside is a
    // second lane of the same flow, not oncoming, and fusing with it would steer into it.
    if (hx * vx + hy * vy > 0) continue;

    let t = ((here.x - a.x) * vx + (here.y - a.y) * vy) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + vx * t;
    const py = a.y + vy * t;

    // Only the INVERTED case needs help. If the oncoming leg is already on our RIGHT, the two legs
    // are arranged correctly for left-hand traffic and keeping left moves us APART from it — there
    // is nothing to fix, and re-centring would shove us right of our own line and read (correctly)
    // as crossing into oncoming. The defect is specifically an oncoming leg on our LEFT, which is
    // the side we are about to move towards.
    const side =
      (px - here.x) * -Math.sin(here.heading) +
      (py - here.y) * Math.cos(here.heading);
    if (side <= 0) continue;

    const dist = Math.hypot(here.x - px, here.y - py);
    if (dist < bestDist) {
      bestDist = dist;
      bestX = px;
      bestY = py;
    }
  }

  if (bestDist > SHARED_CARRIAGEWAY_CELLS) return here;
  return { x: (here.x + bestX) / 2, y: (here.y + bestY) / 2 };
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
