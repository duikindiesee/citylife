// Spec 127 — REAL junction detection for the ribbon roads, from the road WAYS (centre-lines),
// not the widened cell grid. The old per-cell detector counted tile neighbours, and on the
// deliberately ~3-cell-wide carriageways almost every interior cell has 3-4 neighbours — so
// nearly every cell of every wide road got a "junction" (3,412 decoration groups measured
// live, the bulk of the road renderer's 102k scene nodes). Here a junction is where two or
// more DISTINCT ways' smoothed centre-lines pass close to each other — the same rule the
// ribbon uses to break its painted markings — so the world gets dozens of junctions, not
// thousands. Pure math, node-testable; the React layer draws the results.
import type { RoadWay } from "./roadRibbon";
import { chaikin, densify } from "./roadRibbon";

export interface JunctionArm {
  /** Unit direction of travel INTO the junction (grid coords). */
  dx: number;
  dy: number;
  /** True when the arm's road ENDS at this junction (a T approach). */
  terminating: boolean;
}

export interface JunctionZone {
  /** Zone centroid, grid coords. */
  cx: number;
  cy: number;
  /** Slab half-extent in cells (sized to the widest way through the zone). */
  half: number;
  kind: "cross" | "tee" | "pass";
  arms: JunctionArm[];
}

export interface FurnitureItem {
  kind: "light" | "stopsign" | "stopline";
  x: number;
  y: number;
  rotY: number;
}

const key = (x: number, y: number) => `${x},${y}`;

/** Find the junction zones of a road network: cluster the cells where 2+ distinct ways'
 *  centre-lines pass within ~2 cells of each other, then read each zone's arms off the
 *  ways that touch it. */
export function findJunctionZones(ways: RoadWay[]): JunctionZone[] {
  const paths = ways.map((w) =>
    w.path.length >= 2 ? densify(chaikin(w.path, 2), 1.5) : null,
  );
  // Cells each way's centre-line passes through, dilated by 1 (the ribbon's junction rule).
  const cellWays = new Map<string, Set<number>>();
  paths.forEach((cp, wi) => {
    if (!cp) return;
    for (const p of cp) {
      const cx = Math.round(p.x),
        cy = Math.round(p.y);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const k = key(cx + dx, cy + dy);
          let s = cellWays.get(k);
          if (!s) {
            s = new Set();
            cellWays.set(k, s);
          }
          s.add(wi);
        }
    }
  });
  const crossing = new Set<string>();
  for (const [k, s] of cellWays) if (s.size >= 2) crossing.add(k);

  // Flood-fill the crossing cells (8-neighbour) into contiguous zones.
  const seen = new Set<string>();
  const zones: JunctionZone[] = [];
  for (const start of crossing) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [start];
    const cells: { x: number; y: number }[] = [];
    const wayIdx = new Set<number>();
    while (stack.length) {
      const k = stack.pop()!;
      const [x, y] = k.split(",").map(Number);
      cells.push({ x: x!, y: y! });
      for (const wi of cellWays.get(k) ?? []) wayIdx.add(wi);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const nk = key(x! + dx, y! + dy);
          if (crossing.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
        }
    }
    let sx = 0,
      sy = 0,
      minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const c of cells) {
      sx += c.x;
      sy += c.y;
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
    // Two ways running PARALLEL within ~2 cells for a stretch merge into a long thin blob —
    // that is not a junction (the coplanar ribbons already read fine there). Skip it.
    if (Math.max(maxX - minX, maxY - minY) > 8 || cells.length > 45) continue;
    const cx = sx / cells.length,
      cy = sy / cells.length;
    let maxW = 1;
    for (const wi of wayIdx) maxW = Math.max(maxW, ways[wi]!.width);
    const half = Math.min(3, maxW / 2 + 0.3);

    // Arms: where each way's centre-line enters/leaves the zone box.
    const R = half + 1.2;
    const inZone = (p: { x: number; y: number }) =>
      Math.abs(p.x - cx) <= R && Math.abs(p.y - cy) <= R;
    const unit = (ax: number, ay: number) => {
      const l = Math.hypot(ax, ay) || 1;
      return { dx: ax / l, dy: ay / l };
    };
    const arms: JunctionArm[] = [];
    for (const wi of wayIdx) {
      const cp = paths[wi];
      if (!cp) continue;
      let i0 = -1,
        i1 = -1;
      for (let i = 0; i < cp.length; i++)
        if (inZone(cp[i]!)) {
          if (i0 < 0) i0 = i;
          i1 = i;
        }
      if (i0 < 0) continue;
      const startsInside = i0 === 0;
      const endsInside = i1 === cp.length - 1;
      if (!startsInside) {
        // approach arm from the way's near side; it terminates here if the way ends inside
        const d = unit(cp[i0]!.x - cp[i0 - 1]!.x, cp[i0]!.y - cp[i0 - 1]!.y);
        arms.push({ ...d, terminating: endsInside });
      }
      if (!endsInside) {
        // far-side arm; traffic on it approaches the junction along the reverse direction.
        // It terminates here if the way STARTS inside the zone.
        const d = unit(cp[i1]!.x - cp[i1 + 1]!.x, cp[i1]!.y - cp[i1 + 1]!.y);
        arms.push({ ...d, terminating: startsInside });
      }
      // a way both starting and ending inside is a swallowed stub — no arm
    }
    const compass = new Set(
      arms.map((a) => `${Math.round(a.dx)},${Math.round(a.dy)}`),
    );
    const kind: JunctionZone["kind"] =
      compass.size >= 4
        ? "cross"
        : compass.size === 3
          ? "tee"
          : "pass";
    zones.push({ cx, cy, half, kind, arms });
  }
  return zones;
}

/** Lay out the 3D street furniture for one junction: traffic lights on the four corners of a
 *  crossing, a stop sign + stop line on each terminating arm of a T. Left-hand drive (SA):
 *  the approach lane is LEFT of the centre-line, the sign stands on the driver's left.
 *  Positions in grid coords; rotY already in world convention (atan2(dx, dy)). */
export function junctionFurniture(zone: JunctionZone): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  const { cx, cy, half } = zone;
  if (zone.kind === "cross") {
    const off = half + 0.4;
    items.push(
      { kind: "light", x: cx + off, y: cy - off, rotY: Math.PI },
      { kind: "light", x: cx + off, y: cy + off, rotY: -Math.PI / 2 },
      { kind: "light", x: cx - off, y: cy + off, rotY: 0 },
      { kind: "light", x: cx - off, y: cy - off, rotY: Math.PI / 2 },
    );
  }
  const lineArms =
    zone.kind === "cross"
      ? zone.arms
      : zone.arms.filter((a) => a.terminating);
  const seenDir = new Set<string>();
  for (const a of lineArms) {
    // snap the arm to its dominant compass axis so the paint sits square on the slab
    const sx = Math.abs(a.dx) > Math.abs(a.dy) ? Math.sign(a.dx) : 0;
    const sy = sx === 0 ? Math.sign(a.dy) : 0;
    const dirKey = `${sx},${sy}`;
    if ((sx === 0 && sy === 0) || seenDir.has(dirKey)) continue;
    seenDir.add(dirKey);
    const back = half + 0.55; // just outside the slab edge
    // approach point = centroid - dir*back, shifted one cell LEFT of travel ((dy,-dx))
    const lx = cx - sx * back + sy * 1.0;
    const ly = cy - sy * back - sx * 1.0;
    const rotY = Math.atan2(sx, sy);
    items.push({ kind: "stopline", x: lx, y: ly, rotY });
    if (zone.kind === "tee" && a.terminating) {
      items.push({
        kind: "stopsign",
        x: cx - sx * (back + 0.4) + sy * 1.9,
        y: cy - sy * (back + 0.4) - sx * 1.9,
        rotY: rotY + Math.PI,
      });
    }
  }
  return items;
}
