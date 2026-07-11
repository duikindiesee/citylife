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
}

export interface CommercialCluster {
  /** stable key for React — the first lot that seeded the cluster */
  id: string;
  /** centroid cell (grid coords) where the single block is placed */
  x: number;
  y: number;
  /** how many lots collapsed into this cluster */
  count: number;
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
  const acc: { id: string; sx: number; sy: number; n: number }[] = [];
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
    if (best >= 0) {
      acc[best]!.sx += lot.x;
      acc[best]!.sy += lot.y;
      acc[best]!.n += 1;
    } else {
      acc.push({ id: lot.id, sx: lot.x, sy: lot.y, n: 1 });
    }
  }
  return acc.map((c) => ({ id: c.id, x: c.sx / c.n, y: c.sy / c.n, count: c.n }));
}
