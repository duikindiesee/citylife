// Spec 139 — the giant red building fix. CommercialBlock (src/render/components/CommercialBlock.tsx)
// is a hand-authored ~100 m gas-station/garage STREET SCENE with a red (#aa3333) canopy — NOT a
// per-cell building. The renderer stamped one whole 100 m scene per 4 m commercial lot, so any
// run of adjacent commercial lots fused ~25 overlapping copies into one towering red wall (the
// operator's Sol-36 screenshot). Blocks are axis-aligned and never rotate.
//
// The fix: collapse a contiguous painted commercial region to ONE block at its centroid. This is
// the pure clustering used by ZoneManager — node-testable so the grouping is pinned.

export interface CommercialLot {
  id: string;
  /** lot anchor cell (grid coords) */
  x: number;
  y: number;
  /** graded pad footprint, in grid cells (defaults to the anchor plus w/d) */
  footprint?: { x: number; y: number; w: number; d: number };
  w?: number;
  d?: number;
}

export interface CommercialCluster {
  /** stable key for React — the first lot that seeded the cluster */
  id: string;
  /** centroid cell (grid coords) where the single block is placed */
  x: number;
  y: number;
  /** how many lots collapsed into this cluster */
  count: number;
  /** union of member pad footprints, used by the shared spec-128 seat formula */
  footprint: { x: number; y: number; w: number; d: number };
}

/** Group commercial lots so lots within `thresholdCells` of a cluster's running centroid merge
 *  into it, else seed a new cluster. Default threshold is the block's ~25-cell (100 m) width, so
 *  any two lots whose blocks would overlap collapse to one. Deterministic in input order (lots
 *  come from state.neighborhood.lots, a stable array), so the same colony always clusters the
 *  same way and React keys stay stable. */
export function clusterCommercialLots(
  lots: readonly CommercialLot[],
  thresholdCells = 25,
): CommercialCluster[] {
  const acc: {
    id: string;
    sx: number;
    sy: number;
    n: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }[] = [];
  for (const lot of lots) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < acc.length; i++) {
      const c = acc[i]!;
      const d = Math.hypot(lot.x - c.sx / c.n, lot.y - c.sy / c.n);
      if (d <= thresholdCells && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const pad = lot.footprint ?? {
      x: lot.x,
      y: lot.y,
      w: lot.w ?? 1,
      d: lot.d ?? 1,
    };
    const x1 = pad.x + pad.w;
    const y1 = pad.y + pad.d;
    if (best >= 0) {
      const c = acc[best]!;
      c.sx += lot.x;
      c.sy += lot.y;
      c.n += 1;
      c.x0 = Math.min(c.x0, pad.x);
      c.y0 = Math.min(c.y0, pad.y);
      c.x1 = Math.max(c.x1, x1);
      c.y1 = Math.max(c.y1, y1);
    } else {
      acc.push({
        id: lot.id,
        sx: lot.x,
        sy: lot.y,
        n: 1,
        x0: pad.x,
        y0: pad.y,
        x1,
        y1,
      });
    }
  }
  return acc.map((c) => ({
    id: c.id,
    x: c.sx / c.n,
    y: c.sy / c.n,
    count: c.n,
    footprint: { x: c.x0, y: c.y0, w: c.x1 - c.x0, d: c.y1 - c.y0 },
  }));
}
