// Spec 137 — dependency-free 2D helpers shared by the junction cap builder and the road
// ribbon paint suppression (a separate module so roadRibbon <-> roadJunctions never form
// a runtime import cycle).

/** Convex hull (Andrew monotone chain), CCW winding. */
export function convexHull(
  pts: { x: number; y: number }[],
): { x: number; y: number }[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length <= 2) return p;
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof p = [];
  for (const pt of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, pt) <= 0
    )
      lower.pop();
    lower.push(pt);
  }
  const upper: typeof p = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, pt) <= 0
    )
      upper.pop();
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Point-in-polygon for ARBITRARY (non-convex) simple polygons — even-odd raycast. */
export function pointInPoly(
  px: number,
  py: number,
  poly: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    if (
      a.y > py !== b.y > py &&
      px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polygon's boundary (min over edges). */
export function distToPolyEdge(
  px: number,
  py: number,
  poly: { x: number; y: number }[],
): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!,
      b = poly[(i + 1) % poly.length]!;
    const vx = b.x - a.x,
      vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.max(
      0,
      Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len2),
    );
    const dx = px - (a.x + vx * t),
      dy = py - (a.y + vy * t);
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Inside the polygon, or within `pad` cells of its boundary. */
export function nearPoly(
  px: number,
  py: number,
  poly: { x: number; y: number }[],
  pad: number,
): boolean {
  if (poly.length < 3) return false;
  return pointInPoly(px, py, poly) || distToPolyEdge(px, py, poly) <= pad;
}

/** Point-in-convex-polygon (CCW hull) with `inflate` cells of slack outside every edge. */
export function pointInConvexPoly(
  px: number,
  py: number,
  poly: { x: number; y: number }[],
  inflate = 0,
): boolean {
  if (poly.length < 3) return false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!,
      b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x,
      ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    // inward signed distance for a CCW polygon
    const d = ((px - a.x) * -ey + (py - a.y) * ex) / len;
    if (d < -inflate) return false;
  }
  return true;
}
