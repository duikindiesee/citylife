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
