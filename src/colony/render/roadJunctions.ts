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
  /** The way this item serves (stop lines/signs) — clearance tests attribute paint to its
   *  own carriageway through this. Lights are zone-owned and carry none. */
  wayIndex?: number;
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
 *     not reliably clear the through road.
 *
 *  Placement is anchored to the arm's OWN smoothed centre-line (adversarial verify F1/F3):
 *  a first cut walked a compass-snapped axis from the centroid while checking clearance
 *  against the true centre-line, so a few degrees of tilt self-blocked every step and the
 *  boot towns silently lost ALL their stop signs. Each item now walks back by arc length
 *  along the way the ribbon actually draws and offsets perpendicular to the LOCAL tangent —
 *  own-way clearance holds by construction, and only foreign carriageways gate the walk
 *  (an item is skipped when nowhere in reach clears). Opposed terminating-arm pairs are a
 *  through movement — a chained corridor passing through the zone — and get no furniture
 *  even when a genuine side road makes the zone a tee (verify F2). */
export function junctionFurniture(
  zone: JunctionZone,
  ways: RoadWay[],
): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  const { cx, cy, half } = zone;
  if (zone.kind === "pass") return items;
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
  // Traffic lights only at a REAL crossing — one with through traffic (2+ non-terminating
  // arms). A "cross" assembled from chained-corridor compass artifacts has none. Each pole
  // slides outward along its corner diagonal until it stands clear of EVERY carriageway,
  // and is skipped when nowhere within reach does — a light pole in the road was the
  // operator's original mid-road bus-stop lookalike.
  if (
    zone.kind === "cross" &&
    zone.arms.filter((a) => !a.terminating).length >= 2
  ) {
    const corners: Array<[number, number, number]> = [
      [1, -1, Math.PI],
      [1, 1, -Math.PI / 2],
      [-1, 1, 0],
      [-1, -1, Math.PI / 2],
    ];
    for (const [ux, uy, rotY] of corners) {
      for (let off = half + 0.4; off <= half + 5; off += 0.25) {
        const px = cx + ux * off;
        const py = cy + uy * off;
        if (clears(px, py, -1, false)) {
          items.push({ kind: "light", x: px, y: py, rotY });
          break;
        }
      }
    }
  }
  const candidates =
    zone.kind === "cross"
      ? zone.arms
      : zone.arms.filter((a) => a.terminating);
  // Two near-opposed TERMINATING arms are one chained corridor flowing THROUGH the zone
  // (way ends, next way continues) — through traffic never gets a stop, even when a real
  // side road makes this zone a tee.
  const lineArms = candidates.filter(
    (a) =>
      !candidates.some(
        (b) =>
          b !== a && b.terminating && a.terminating &&
          a.dx * b.dx + a.dy * b.dy < -0.95,
      ),
  );
  const seenDir = new Set<string>();
  for (const a of lineArms) {
    // the compass key only DEDUPES arms sharing an axis; placement uses true geometry
    const sx = Math.abs(a.dx) > Math.abs(a.dy) ? Math.sign(a.dx) : 0;
    const sy = sx === 0 ? Math.sign(a.dy) : 0;
    const dirKey = `${sx},${sy}`;
    if ((sx === 0 && sy === 0) || seenDir.has(dirKey)) continue;
    seenDir.add(dirKey);
    const cp = smoothed[a.wayIndex];
    if (!cp || cp.length < 2) continue;
    const ownHalf = (ways[a.wayIndex]?.width ?? 1) / 2;

    // Anchor on the own centre-line: start at the polyline point nearest the centroid and
    // walk AWAY from the junction — the side where stepping moves against the arm's travel
    // direction (the arm points INTO the junction).
    let ci = 0;
    let best = Infinity;
    for (let i = 0; i < cp.length; i++) {
      const d = (cp[i]!.x - cx) ** 2 + (cp[i]!.y - cy) ** 2;
      if (d < best) {
        best = d;
        ci = i;
      }
    }
    const step = (i: number, w: number) =>
      cp[Math.max(0, Math.min(cp.length - 1, i + w))]!;
    // walking direction w: the step away from the junction opposes the travel direction
    const wDir =
      (step(ci, 1).x - cp[ci]!.x) * a.dx + (step(ci, 1).y - cp[ci]!.y) * a.dy < 0
        ? 1
        : -1;

    // Stations along the own way, by arc length from the anchor. At each: position on the
    // centre-line, local travel tangent (INTO the junction), and its left normal.
    type Station = { x: number; y: number; tx: number; ty: number };
    const stations: Station[] = [];
    {
      let acc = 0;
      let prev = cp[ci]!;
      for (let i = ci + wDir; i >= 0 && i < cp.length; i += wDir) {
        const p = cp[i]!;
        const segLen = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (segLen > 1e-9) {
          // tangent pointing back toward the junction = direction of travel
          const tx = (prev.x - p.x) / segLen;
          const ty = (prev.y - p.y) / segLen;
          const need = 0.25;
          let along = need - (acc % need || need);
          while (acc + along <= acc + segLen && stations.length < 64) {
            if (along > segLen) break;
            stations.push({
              x: prev.x + (p.x - prev.x) * (along / segLen),
              y: prev.y + (p.y - prev.y) * (along / segLen),
              tx,
              ty,
            });
            along += need;
          }
          acc += segLen;
        }
        prev = p;
        if (acc > half + 8) break;
      }
    }

    // The stop line paints the approach LANE — the left half of the own carriageway.
    const lat = Math.max(0.25, ownHalf / 2);
    let lineIdx = -1;
    for (let si = 0; si < stations.length; si++) {
      const s = stations[si]!;
      const backFromCentroid = Math.hypot(s.x - cx, s.y - cy);
      if (backFromCentroid < half + 0.55) continue; // still on the slab
      const lx = s.x + s.ty * lat;
      const ly = s.y - s.tx * lat;
      if (clears(lx, ly, a.wayIndex, false)) {
        items.push({
          kind: "stopline",
          x: lx,
          y: ly,
          rotY: Math.atan2(s.tx, s.ty),
          wayIndex: a.wayIndex,
        });
        lineIdx = si;
        break;
      }
    }
    if (zone.kind === "tee" && a.terminating && lineIdx >= 0) {
      // The sign stands on the KERB: past its own carriageway edge (by construction of the
      // perpendicular offset), clear of everyone's asphalt.
      const signLat = ownHalf + 0.8;
      for (let si = lineIdx + 1; si < stations.length; si++) {
        const s = stations[si]!;
        const px = s.x + s.ty * signLat;
        const py = s.y - s.tx * signLat;
        if (clears(px, py, a.wayIndex, true)) {
          items.push({
            kind: "stopsign",
            x: px,
            y: py,
            rotY: Math.atan2(s.tx, s.ty) + Math.PI,
            wayIndex: a.wayIndex,
          });
          break;
        }
      }
    }
  }
  return items;
}
