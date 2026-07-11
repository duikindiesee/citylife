// Spec 148 — the road network is ONE connected web. Every road source at boot (the founders' avenue,
// each satellite hamlet, the trunk mesh, the commercial high street + cross street, the rally spur)
// merges cells straight into `state.roads`, but nothing guaranteed they touched. On some seeds a piece
// merged as an ISLAND — the commercial cross street the mall pad severs from its own high street, or a
// rally stub the homesteads wall off — leaving visible gaps in World View where roads plainly do not
// connect. This module is the shared, pure flood-fill the connectivity repair pass and its invariant
// test both read, so "one component" is measured the same way everywhere. Deterministic: components
// are ordered by size (largest first) then by their lowest cell index, so the "main" network is always
// the same one run-to-run.

export interface RoadCell {
  x: number;
  y: number;
}

export interface RoadComponent {
  /** Flat cell indices (y * size + x) belonging to this component. */
  cells: number[];
  size: number;
  /** Lowest cell index in the component — the stable identity used to break size ties. */
  min: number;
}

/** Flood-fill the road cells into 4-connected components, largest first (deterministic tie-break by
 *  lowest cell index). `size` is the terrain grid width, so a cell index is `y * size + x`. */
export function roadComponents(
  roads: ReadonlyArray<RoadCell>,
  size: number,
): RoadComponent[] {
  const key = (x: number, y: number) => y * size + x;
  const set = new Set<number>();
  // Insert in a canonical order so the flood-fill (and its tie-breaks) never depend on the order the
  // various road sources happened to push cells into `state.roads`.
  const cellIdx = roads.map((r) => key(r.x, r.y));
  cellIdx.sort((a, b) => a - b);
  for (const k of cellIdx) set.add(k);
  const seen = new Set<number>();
  const comps: RoadComponent[] = [];
  // cellIdx is ascending and we skip seen cells, so the seed `k0` of each flood-fill is always the
  // LOWEST index in its component (any lower-indexed member would have seeded it first). That makes
  // `k0` a stable component identity with no O(n) Math.min scan (and no huge-array spread).
  for (const k0 of cellIdx) {
    if (seen.has(k0)) continue;
    const cells: number[] = [];
    const stack = [k0];
    while (stack.length) {
      const k = stack.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      cells.push(k);
      const x = k % size,
        y = (k / size) | 0;
      const nbrs = [key(x + 1, y), key(x - 1, y), key(x, y + 1), key(x, y - 1)];
      for (const nk of nbrs) if (set.has(nk) && !seen.has(nk)) stack.push(nk);
    }
    comps.push({ cells, size: cells.length, min: k0 });
  }
  comps.sort((a, b) => b.size - a.size || a.min - b.min);
  return comps;
}

/** The fraction of road cells that live in the single largest component — 1 when the whole network is
 *  connected. The connectivity invariant reads this. Returns 1 for an empty network (vacuously one web). */
export function largestComponentShare(
  roads: ReadonlyArray<RoadCell>,
  size: number,
): number {
  if (roads.length === 0) return 1;
  const comps = roadComponents(roads, size);
  return comps.length === 0 ? 1 : comps[0]!.size / roads.length;
}
