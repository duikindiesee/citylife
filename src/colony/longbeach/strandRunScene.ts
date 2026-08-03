// Spec 169 slice 1b — the Strand Run scene's GEOMETRY AND CAMERA RULES, as pure data.
//
// StrandRunView.tsx renders exactly what this module computes and decides nothing itself — the same
// split HqReceptionView uses, and for the same reason: a road that dips into an arroyo instead of
// bridging it, or a chase camera that clips the ground, is caught by a node test rather than by the
// operator mid-drive.
//
// World mapping: 1 cell = CELL_M metres, field x → world X, field y → world Z, height → world Y.
// The strip's west (small x) is world −X, which is where the sea and the gas giant live.
import {
  LB_SEA_LEVEL,
  LB_HEIGHT_SCALE,
  LB_BIOME,
  type LongBeachField,
} from "./longBeachField";
import type { StrandRun } from "./strandRun";

export const CELL_M = 4;
/** Terrain mesh decimation: one vertex every N cells. 4 → 257×129 grid, ~33k vertices. */
export const TERRAIN_MESH_STEP = 4;
/** Carriageway width in metres (spec §2 tier 0: 4 cells) and the painted edge-line strips. */
export const ROAD_WIDTH_M = 4 * CELL_M;
export const EDGE_LINE_WIDTH_M = 0.35;
/** The ribbon floats this far above the ground so it never z-fights the terrain. */
export const ROAD_LIFT_M = 0.22;
/** A bridge deck never sags below this height above the sea (spec §3.4: the arroyo crossing). */
export const MIN_DECK_ABOVE_SEA_M = 1.2;
/** Chase camera: distance behind the car, eye height, and how far ahead it looks. */
export const CHASE_BACK_M = 11;
export const CHASE_UP_M = 4.6;
export const CHASE_LOOK_AHEAD_M = 7;
/** The gas giant hangs due west over the sea at a fixed bearing and apparent size (spec §1.5). */
export const GIANT_DISTANCE_M = 3400;
export const GIANT_ELEVATION_RAD = (12 * Math.PI) / 180;
export const GIANT_RADIUS_M = 260;

/** Signed ground height in metres — NEGATIVE below sea, so a sea plane at y=0 reads as real water
 *  with the seabed and the arroyo beds dipping under it. (The field's own worldYAt clamps at 0,
 *  which is right for gameplay but wrong for rendering a shoreline.) */
export function groundHeightM(
  field: LongBeachField,
  x: number,
  y: number,
): number {
  const cx = Math.max(0, Math.min(field.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(field.height - 1, Math.round(y)));
  return (field.elev[field.idx(cx, cy)]! - LB_SEA_LEVEL) * LB_HEIGHT_SCALE;
}

/** Field cell → world position (metres). The strip is centred on x so the coast sits west of origin. */
export function cellToWorld(
  field: LongBeachField,
  x: number,
  y: number,
  lift = 0,
): [number, number, number] {
  return [
    (x - field.width / 2) * CELL_M,
    groundHeightM(field, x, y) + lift,
    (y - field.height / 2) * CELL_M,
  ];
}

/** Dusk-over-the-sea palette by biome — sand, scrub, rock, with the water tinted by depth. */
export function biomeColor(
  b: number,
  underwater: boolean,
): [number, number, number] {
  if (underwater) return [0.1, 0.2, 0.28];
  switch (b) {
    case LB_BIOME.Beach:
      return [0.86, 0.76, 0.58];
    case LB_BIOME.Plains:
      return [0.78, 0.62, 0.42];
    case LB_BIOME.Forest:
      return [0.35, 0.48, 0.32];
    case LB_BIOME.Highland:
      return [0.55, 0.45, 0.36];
    case LB_BIOME.Mountain:
      return [0.42, 0.38, 0.36];
    default:
      return [0.2, 0.3, 0.36];
  }
}

export interface TerrainMeshData {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Vertices per row/column, for the tests. */
  cols: number;
  rows: number;
}

/** The decimated strip mesh: positions in metres, vertex colours by biome, two triangles per quad. */
export function buildTerrainMesh(field: LongBeachField): TerrainMeshData {
  const step = TERRAIN_MESH_STEP;
  const cols = Math.floor((field.width - 1) / step) + 1;
  const rows = Math.floor((field.height - 1) / step) + 1;
  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  let p = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * step;
      const y = r * step;
      const [wx, wy, wz] = cellToWorld(field, x, y);
      positions[p] = wx;
      positions[p + 1] = wy;
      positions[p + 2] = wz;
      const i = field.idx(x, y);
      const col = biomeColor(field.biome[i]!, field.water[i] === 1 || wy < 0);
      colors[p] = col[0];
      colors[p + 1] = col[1];
      colors[p + 2] = col[2];
      p += 3;
    }
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let q = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices[q++] = a;
      indices[q++] = d;
      indices[q++] = b;
      indices[q++] = b;
      indices[q++] = d;
      indices[q++] = e;
    }
  }
  return { positions, colors, indices, cols, rows };
}

/**
 * Deck heights along the route, in metres: the ground height smoothed and CLAMPED so the carriageway
 * never sags into a wash — where the ground dips below the sea, the deck holds at bridge height and
 * the crossing reads as a bridge (spec §3.4). Smoothing is a 5-tap average so approach grades ease.
 */
export function deckHeights(
  field: LongBeachField,
  run: StrandRun,
): Float32Array {
  const raw = run.path.map((pt) =>
    Math.max(groundHeightM(field, pt.x, pt.y), MIN_DECK_ABOVE_SEA_M * 0.0),
  );
  const clamped = raw.map((h) => Math.max(h, MIN_DECK_ABOVE_SEA_M));
  const out = new Float32Array(run.path.length);
  for (let i = 0; i < clamped.length; i++) {
    let sum = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= clamped.length) continue;
      sum += clamped[j]!;
      n++;
    }
    out[i] = sum / n;
  }
  return out;
}

export interface RibbonMeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

/** A flat ribbon of the given width along the route at the given deck heights (plus ROAD_LIFT_M). */
export function buildRibbonMesh(
  field: LongBeachField,
  run: StrandRun,
  widthM: number,
  extraLift = 0,
): RibbonMeshData {
  const n = run.path.length;
  const heights = deckHeights(field, run);
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const pt = run.path[i]!;
    const prev = run.path[Math.max(0, i - 1)]!;
    const next = run.path[Math.min(n - 1, i + 1)]!;
    // Perpendicular of the local direction, in cell space; cells are square so this is exact.
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    const half = widthM / 2 / CELL_M; // back to cells for the offset, world-converted below
    const y = heights[i]! + ROAD_LIFT_M + extraLift;
    const lx = pt.x + px * half;
    const ly = pt.y + py * half;
    const rx = pt.x - px * half;
    const ry = pt.y - py * half;
    positions[i * 6] = (lx - field.width / 2) * CELL_M;
    positions[i * 6 + 1] = y;
    positions[i * 6 + 2] = (ly - field.height / 2) * CELL_M;
    positions[i * 6 + 3] = (rx - field.width / 2) * CELL_M;
    positions[i * 6 + 4] = y;
    positions[i * 6 + 5] = (ry - field.height / 2) * CELL_M;
  }
  const indices = new Uint32Array((n - 1) * 6);
  let q = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices[q++] = a;
    indices[q++] = b;
    indices[q++] = c;
    indices[q++] = b;
    indices[q++] = d;
    indices[q++] = c;
  }
  return { positions, indices };
}

/** Chase-camera pose for a car at (x, y, heading) in FIELD cells: behind, above, looking ahead. */
export function chaseCameraPose(
  field: LongBeachField,
  car: { x: number; y: number; heading: number },
  deckY: number,
): { position: [number, number, number]; target: [number, number, number] } {
  const cx = (car.x - field.width / 2) * CELL_M;
  const cz = (car.y - field.height / 2) * CELL_M;
  const hx = Math.cos(car.heading);
  const hz = Math.sin(car.heading);
  return {
    position: [
      cx - hx * CHASE_BACK_M,
      deckY + CHASE_UP_M,
      cz - hz * CHASE_BACK_M,
    ],
    target: [
      cx + hx * CHASE_LOOK_AHEAD_M,
      deckY + 1.2,
      cz + hz * CHASE_LOOK_AHEAD_M,
    ],
  };
}

/** The gas giant, sky-anchored due WEST of the camera at a fixed elevation and distance, so it hangs
 *  over the sea from everywhere on the strip and its apparent size never changes (spec §1.5). */
export function gasGiantPosition(cameraPos: {
  x: number;
  y: number;
  z: number;
}): [number, number, number] {
  return [
    cameraPos.x - GIANT_DISTANCE_M * Math.cos(GIANT_ELEVATION_RAD),
    cameraPos.y + GIANT_DISTANCE_M * Math.sin(GIANT_ELEVATION_RAD),
    cameraPos.z,
  ];
}

export interface KokerboomInstance {
  position: [number, number, number];
  scaleY: number;
  yaw: number;
}

/** Kokerbome lining the drive: deterministic murmur-selected stands on dry Plains/Highland, denser
 *  near the road corridor so the operator's tree frames the operator's road (spec §3.4, Kokerboom
 *  Pass gets the hero placement later — this is the strand-side supporting cast). */
export function kokerboomInstances(
  field: LongBeachField,
  run: StrandRun,
): KokerboomInstance[] {
  const hash = (n: number) => {
    let h = n >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  };
  // A coarse set of route columns for the "near the road" densification.
  const routeXAtRow = new Map<number, number>();
  for (const p of run.path) routeXAtRow.set(Math.round(p.y / 8) * 8, p.x);

  const out: KokerboomInstance[] = [];
  for (let y = 0; y < field.height; y += 2) {
    for (let x = 0; x < 700; x += 2) {
      const i = field.idx(x, y);
      if (field.water[i] === 1) continue;
      const b = field.biome[i]!;
      if (b !== LB_BIOME.Plains && b !== LB_BIOME.Highland) continue;
      const rx = routeXAtRow.get(Math.round(y / 8) * 8);
      const nearRoad = rx !== undefined && Math.abs(x - rx) < 60;
      // Measured at 650/2600 the whole strip carried 26 trees — a rumour, not a stand. These rates
      // put ~90 in the road corridor and ~30 beyond it: the drive reads tree-lined, the flat stays
      // sparse enough that each silhouette still lands (the island's landmark rule, scaled up).
      const rarity = nearRoad ? 160 : 1400;
      if (hash(field.seed ^ (i * 31 + 7)) * rarity >= 1) continue;
      // Never ON the carriageway: keep a verge beyond the road half-width.
      if (rx !== undefined && Math.abs(x - rx) < 4) continue;
      const [wx, wy, wz] = cellToWorld(field, x, y);
      out.push({
        position: [wx, wy, wz],
        scaleY: 2.2 + hash(field.seed ^ (i * 17 + 3)) * 6.8,
        yaw: hash(field.seed ^ (i * 23 + 11)) * Math.PI * 2,
      });
    }
  }
  return out;
}
