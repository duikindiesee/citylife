// Spec 077 BUILD slice P2 — the GREEDY MESHER and the merged-geometry render path.
//
// THE WHOLE POINT: the compiled house (a fine micro-occupancy grid, houseBuilder.ts) is turned into ONE
// merged THREE.BufferGeometry per house so it reads as FANCY BRICK MASONRY — not flat low-poly planes and
// NOT chunky minecraft cubes — while LOWERING draw calls (one mesh vs hundreds of instanced boxes).
//
// Greedy meshing is a PERFORMANCE optimisation only: it must NOT flatten the brick detail. So a quad may
// merge two adjacent voxel faces ONLY when they are coplanar, face the same way, and carry the SAME block
// kind AND the SAME tint. Because the two brick tints (brick / brickAlt) are different kinds with different
// BLOCK_COLOR entries, the per-course colour banding survives the merge — adjacent courses of a different
// tint are never collapsed into one quad, so the wall still looks like brickwork.
//
// Output is in a TILE-LOCAL space: each micro-block is a `cell`-sized cube (cell = 1/N of a plot cell in x/z
// and `vy` tall in y). Vertex coordinates stay small (a house is a handful of plot cells across), and the
// renderer parents the mesh at the house-zone origin. Normals are FLAT per quad (every quad's 4 vertices
// share the face normal), and colours are per-vertex from BLOCK_COLOR, so a single vertexColors material
// shades the whole house with the brick banding baked in.
import * as THREE from "three";
import { BLOCK_COLOR, type Block, type BlockKind } from "../voxelHouse";

export interface GreedyMeshOpts {
  /** Sub-blocks per plot cell along x/z (== HOUSE_VOXEL_N). Sets the micro-block footprint (1/n of a cell). */
  n: number;
  /** Cell size in world units along x/z (defaults to 1 — one plot cell == one world unit). */
  cell?: number;
  /** Micro-block height in world units along y. Defaults to `cell` so bricks are roughly cubic. */
  voxelY?: number;
}

export interface GreedyMeshResult {
  geometry: THREE.BufferGeometry;
  /** Number of merged quads emitted (each quad = 2 triangles). Far fewer than 2 tris per face when runs merge. */
  quadCount: number;
}

// A face is keyed by (kind) so that only same-kind, same-tint runs merge. Air = empty cell.
type Cell = number; // 0 = air, else KIND_CODE (a stable per-kind integer)

// Stable kind <-> code mapping (kept private to the mesher so it never collides with the compiler's codes).
const KINDS = Object.keys(BLOCK_COLOR) as BlockKind[];
const CODE_OF = new Map<BlockKind, number>();
KINDS.forEach((k, i) => CODE_OF.set(k, i + 1)); // 0 reserved for air
const KIND_OF: BlockKind[] = ["floor", ...KINDS]; // index 0 unused sentinel; index i+1 -> KINDS[i]
KINDS.forEach((k, i) => (KIND_OF[i + 1] = k));

// The six face directions, as [axis, sign]. axis: 0=x, 1=y, 2=z.
const FACES = [
  { axis: 0, sign: +1 },
  { axis: 0, sign: -1 },
  { axis: 1, sign: +1 },
  { axis: 1, sign: -1 },
  { axis: 2, sign: +1 },
  { axis: 2, sign: -1 },
] as const;

/** Build a dense occupancy lattice from a Block[] plus its extents. Cells outside the given extents, or
 *  empty, are air (0). Later blocks at the same coordinate win (matches the compiler's last-write order). */
function lattice(
  blocks: Block[],
  gw: number,
  gd: number,
  gh: number,
): { cells: Int32Array; gw: number; gd: number; gh: number } {
  const cells = new Int32Array(gw * gd * gh);
  const idx = (x: number, y: number, z: number) => (z * gd + y) * gw + x;
  for (const b of blocks) {
    if (b.x < 0 || b.y < 0 || b.z < 0 || b.x >= gw || b.y >= gd || b.z >= gh)
      continue;
    const code = CODE_OF.get(b.kind);
    if (code === undefined) continue;
    cells[idx(b.x, b.y, b.z)] = code;
  }
  return { cells, gw, gd, gh };
}

function extentsOf(blocks: Block[]): { gw: number; gd: number; gh: number } {
  let gw = 0,
    gd = 0,
    gh = 0;
  for (const b of blocks) {
    if (b.x + 1 > gw) gw = b.x + 1;
    if (b.y + 1 > gd) gd = b.y + 1;
    if (b.z + 1 > gh) gh = b.z + 1;
  }
  return { gw, gd, gh };
}

/**
 * Greedy-mesh a house's micro-occupancy (a Block[] or an already-built lattice) into ONE merged
 * BufferGeometry. Exposed faces (a solid cell whose neighbour across the face is air) are emitted; hidden
 * internal faces are skipped. Coplanar exposed faces sharing the SAME kind+tint are merged into the largest
 * rectangle (the classic greedy sweep over each axis-aligned slice). Two brick tints never merge together,
 * so the masonry course banding stays visible.
 */
export function greedyMesh(
  blocks: Block[],
  opts: GreedyMeshOpts,
): GreedyMeshResult {
  const n = Math.max(1, Math.floor(opts.n));
  const cell = opts.cell ?? 1;
  const vx = cell / n; // micro-block footprint in world units along x/z
  const vy = opts.voxelY ?? vx; // micro-block height along y
  const e = extentsOf(blocks);
  const { cells, gw, gd, gh } = lattice(blocks, e.gw, e.gd, e.gh);

  // Per-axis world size of one micro-block step. The COMPILER is Z-UP (block.z is the storey/height axis,
  // block.x/block.y are the plan footprint), so the storey scale `vy` goes on axis 2 (z) and the footprint
  // scale `vx` on axes 0/1 (x,y). The finished geometry is rotated Z-up -> three.js Y-up below.
  const step = [vx, vx, vy] as const;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  let quadCount = 0;

  const at = (x: number, y: number, z: number): Cell => {
    if (x < 0 || y < 0 || z < 0 || x >= gw || y >= gd || z >= gh) return 0;
    return cells[(z * gd + y) * gw + x]!;
  };

  const col = new THREE.Color();

  // For each of the 6 face directions, sweep the grid slice-by-slice along that face's axis. On each slice
  // we build a 2D mask of (kind code) for the faces that are EXPOSED on that side, then greedily merge equal
  // runs into rectangles. This is O(cells) and collapses a flat one-tint wall to a single quad.
  for (const { axis, sign } of FACES) {
    // u, v are the two in-plane axes; w is the slice axis.
    const w = axis;
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const dim = [gw, gd, gh];
    const wMax = dim[w]!;
    const uMax = dim[u]!;
    const vMax = dim[v]!;

    const coord = [0, 0, 0];
    const get = (wi: number, ui: number, vi: number): Cell => {
      coord[w] = wi;
      coord[u] = ui;
      coord[v] = vi;
      return at(coord[0]!, coord[1]!, coord[2]!);
    };

    for (let wi = 0; wi < wMax; wi++) {
      // mask[vi*uMax + ui] = kind code of an exposed face here, or 0 if none.
      const mask = new Int32Array(uMax * vMax);
      for (let vi = 0; vi < vMax; vi++) {
        for (let ui = 0; ui < uMax; ui++) {
          const here = get(wi, ui, vi);
          if (here === 0) continue;
          // The neighbour across this face (one step along w in `sign`). If it is solid, this face is hidden.
          const neighbour = get(wi + sign, ui, vi);
          if (neighbour !== 0) continue;
          mask[vi * uMax + ui] = here;
        }
      }

      // Greedy-merge equal codes in the mask into maximal rectangles.
      for (let vi = 0; vi < vMax; vi++) {
        for (let ui = 0; ui < uMax; ) {
          const code = mask[vi * uMax + ui]!;
          if (code === 0) {
            ui++;
            continue;
          }
          // grow the run along u while the code matches
          let runU = 1;
          while (ui + runU < uMax && mask[vi * uMax + ui + runU] === code)
            runU++;
          // grow the run along v while every cell of the [ui..ui+runU) span matches
          let runV = 1;
          grow: for (; vi + runV < vMax; runV++) {
            for (let k = 0; k < runU; k++) {
              if (mask[(vi + runV) * uMax + ui + k] !== code) break grow;
            }
          }
          // emit one quad spanning [ui..ui+runU) x [vi..vi+runV) on this slice face, then clear the mask.
          emitQuad(wi, ui, vi, runU, runV, w, u, v, sign, code);
          for (let dv = 0; dv < runV; dv++)
            for (let du = 0; du < runU; du++)
              mask[(vi + dv) * uMax + ui + du] = 0;
          ui += runU;
        }
      }
    }
  }

  function emitQuad(
    wi: number,
    ui: number,
    vi: number,
    runU: number,
    runV: number,
    w: number,
    u: number,
    v: number,
    sign: number,
    code: Cell,
  ): void {
    // The face plane sits at the +sign side of the cell layer wi: wi+1 for +, wi for -.
    const wWorld = (sign > 0 ? wi + 1 : wi) * step[w]!;
    const u0 = ui * step[u]!;
    const u1 = (ui + runU) * step[u]!;
    const v0 = vi * step[v]!;
    const v1 = (vi + runV) * step[v]!;

    // Build the 4 corners in (u,v) and lift into 3D by placing each component on its axis.
    const corner = (uu: number, vv: number): [number, number, number] => {
      const p: [number, number, number] = [0, 0, 0];
      p[w] = wWorld;
      p[u] = uu;
      p[v] = vv;
      return p;
    };
    const a = corner(u0, v0);
    const b = corner(u1, v0);
    const c = corner(u1, v1);
    const d = corner(u0, v1);

    // Flat per-quad normal: +/-1 on the slice axis.
    const nrm: [number, number, number] = [0, 0, 0];
    nrm[w] = sign;

    // Winding: order the two triangles so the front face points along the normal (CCW seen from +normal).
    // For sign>0 use (a,b,c)+(a,c,d); for sign<0 reverse so the visible side faces the air neighbour.
    const tris = sign > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    col.setHex(BLOCK_COLOR[KIND_OF[code]!]);
    for (const p of tris) {
      positions.push(p[0], p[1], p[2]);
      normals.push(nrm[0], nrm[1], nrm[2]);
      colors.push(col.r, col.g, col.b);
    }
    quadCount++;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  // The lattice is built Z-UP (block.z is the height axis). Rotate it onto three.js' Y-UP world so the house
  // stands up — block.z becomes world Y (up) and the plan depth (block.y) becomes world Z. This is a pure
  // rotation (orientation- and winding-preserving, normals rotate with it), then we shift the flipped depth
  // back into [0, depth] so the renderer can still parent the mesh at the house-zone origin unchanged.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, gd * vx);
  geometry.computeBoundingSphere();
  return { geometry, quadCount };
}
