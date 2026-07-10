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
  /** Index into the ways array of the road this arm belongs to — furniture placement
   *  needs the arm's own carriageway width. */
  wayIndex: number;
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
        arms.push({ ...d, terminating: endsInside, wayIndex: wi });
      }
      if (!endsInside) {
        // far-side arm; traffic on it approaches the junction along the reverse direction.
        // It terminates here if the way STARTS inside the zone.
        const d = unit(cp[i1]!.x - cp[i1 + 1]!.x, cp[i1]!.y - cp[i1 + 1]!.y);
        arms.push({ ...d, terminating: startsInside, wayIndex: wi });
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

function distToPolyline(
  px: number,
  py: number,
  pts: { x: number; y: number }[],
): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i]!.x,
      ay = pts[i]!.y;
    const vx = pts[i + 1]!.x - ax,
      vy = pts[i + 1]!.y - ay;
    const L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2));
    const dx = px - (ax + t * vx),
      dy = py - (ay + t * vy);
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** How far a point may sit INSIDE a way's paint-clearance ring: furniture must clear every
 *  foreign carriageway edge by this margin (cells). */
const CLEAR = 0.35;

/** Lay out the 3D street furniture for one junction: traffic lights on the four corners of a
 *  crossing, a stop sign + stop line on each terminating arm of a T. Left-hand drive (SA):
 *  the approach lane is LEFT of the centre-line, the sign stands on the driver's left.
 *  Positions in grid coords; rotY already in world convention (atan2(dx, dy)).
 *
 *  The operator's mid-road bus-stop screenshot taught this function three rules it was
 *  breaking (measured live: 8 of 12 boot-town stop lines and BOTH stop signs stood on
 *  someone's asphalt):
 *   - a "pass" zone is a merge or chain point of collinear ways, not a controlled junction
 *     — it gets NO furniture (the slab alone caps the ribbon overlap there);
 *   - offsets must scale with the arm's OWN way width — boot roads are 4 cells wide, so
 *     the old fixed 1.9-cell sign shift planted the sign inside its own carriageway;
 *   - the flood-fill centroid skews toward the side road, so fixed back-offs from it do
 *     not reliably clear the through road — each item WALKS back along its approach until
 *     it genuinely clears every foreign carriageway (and is skipped when nowhere does). */
export function junctionFurniture(
  zone: JunctionZone,
  ways: RoadWay[],
): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  const { cx, cy, half } = zone;
  if (zone.kind === "pass") return items;
  if (zone.kind === "cross") {
    const off = half + 0.4;
    items.push(
      { kind: "light", x: cx + off, y: cy - off, rotY: Math.PI },
      { kind: "light", x: cx + off, y: cy + off, rotY: -Math.PI / 2 },
      { kind: "light", x: cx - off, y: cy + off, rotY: 0 },
      { kind: "light", x: cx - off, y: cy - off, rotY: Math.PI / 2 },
    );
  }
  // smoothed centre-lines, matching the geometry the ribbon actually draws
  const smoothed = ways.map((w) =>
    w.path.length >= 2 ? densify(chaikin(w.path, 2), 1.5) : null,
  );
  // the point clears every way except the item's own; ownAlso demands clearing that too
  const clears = (px: number, py: number, ownWi: number, ownAlso: boolean) => {
    for (let wi = 0; wi < ways.length; wi++) {
      const cp = smoothed[wi];
      if (!cp || (wi === ownWi && !ownAlso)) continue;
      if (distToPolyline(px, py, cp) < ways[wi]!.width / 2 + CLEAR) return false;
    }
    return true;
  };
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
    const ownHalf = (ways[a.wayIndex]?.width ?? 1) / 2;
    const rotY = Math.atan2(sx, sy);
    // The stop line paints the approach LANE — the left half of the arm's own carriageway.
    const lat = Math.max(0.25, ownHalf / 2);
    // Walk back from the slab edge until the paint clears every FOREIGN carriageway (its
    // own asphalt is exactly where paint belongs). Skip the item when nowhere in reach does.
    let lineBack = -1;
    for (let back = half + 0.55; back <= half + 6; back += 0.25) {
      const lx = cx - sx * back + sy * lat;
      const ly = cy - sy * back - sx * lat;
      if (clears(lx, ly, a.wayIndex, false)) {
        items.push({ kind: "stopline", x: lx, y: ly, rotY });
        lineBack = back;
        break;
      }
    }
    if (zone.kind === "tee" && a.terminating && lineBack >= 0) {
      // The sign stands on the KERB: past its own carriageway edge, clear of everyone's.
      const signLat = ownHalf + 0.8;
      for (let back = lineBack + 0.4; back <= lineBack + 6; back += 0.25) {
        const px = cx - sx * back + sy * signLat;
        const py = cy - sy * back - sx * signLat;
        if (clears(px, py, a.wayIndex, true)) {
          items.push({ kind: "stopsign", x: px, y: py, rotY: rotY + Math.PI });
          break;
        }
      }
    }
  }
  return items;
}
