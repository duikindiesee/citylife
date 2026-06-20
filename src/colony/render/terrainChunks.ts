// Spec 084 S5 — the terrain as a GRID OF CHUNKS instead of one N²-vertex mesh. Three things the
// single mesh could not give us at the 608 world (and already pay off at 192):
//  1. PER-CHUNK FRUSTUM CULLING — a street-level camera draws a handful of chunks, not the island.
//  2. ANALYTIC NORMALS — computed once from the heightfield by central differences (the heights
//     never change), so the expensive computeVertexNormals never runs, at build or after.
//  3. STAGED RECOLOR — a view toggle (biome/buildable/elevation) marks chunks dirty and the frame
//     loop recolors a few per frame, so the toggle never stalls a frame the way one full-grid
//     rewrite did.
// Chunks share their seam vertices (the same cell row/column is the edge of both neighbours, with
// identical positions, normals and colours), so the surface stays crack-free.
import * as THREE from "three";
import type { Terrain } from "../terrain";

export interface TerrainChunk {
  mesh: THREE.Mesh;
  /** Inclusive CELL range whose vertices this chunk owns (seams shared with neighbours). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dirty: boolean;
}

export interface ChunkedTerrain {
  group: THREE.Group;
  chunks: TerrainChunk[];
  /** Mark every chunk for recolor (a view-mode change). */
  markAllDirty(): void;
  /** Recolor up to `budget` dirty chunks via colorFor(cellIndex, out); returns how many stay dirty. */
  recolor(
    colorFor: (i: number, out: THREE.Color) => void,
    budget: number,
  ): number;
  dispose(): void;
}

export function buildChunkedTerrain(
  t: Terrain,
  wx: (x: number) => number,
  wz: (y: number) => number,
  colorFor: (i: number, out: THREE.Color) => void,
  material: THREE.Material,
  grid = 8,
): ChunkedTerrain {
  const N = t.size;
  // The height at a clamped cell — the central-difference normal needs neighbours at the borders.
  const h = (x: number, y: number) =>
    t.worldY(Math.max(0, Math.min(N - 1, x)), Math.max(0, Math.min(N - 1, y)));
  const step = Math.ceil((N - 1) / grid);
  const group = new THREE.Group();
  const chunks: TerrainChunk[] = [];
  const col = new THREE.Color();
  const normal = new THREE.Vector3();
  for (let cy = 0; cy < grid; cy++) {
    for (let cx = 0; cx < grid; cx++) {
      const x0 = cx * step;
      const y0 = cy * step;
      if (x0 >= N - 1 || y0 >= N - 1) continue;
      const x1 = Math.min(x0 + step, N - 1);
      const y1 = Math.min(y0 + step, N - 1);
      const w = x1 - x0 + 1;
      const d = y1 - y0 + 1;
      const verts = new Float32Array(w * d * 3);
      const norms = new Float32Array(w * d * 3);
      const colors = new Float32Array(w * d * 3);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const v = (y - y0) * w + (x - x0);
          verts[v * 3] = wx(x);
          verts[v * 3 + 1] = t.worldY(x, y);
          verts[v * 3 + 2] = wz(y);
          // Central differences over a 1-cell world spacing — the smooth-shaded look of the old
          // computeVertexNormals at a fraction of the cost, and identical on both sides of a seam.
          normal
            .set(
              (h(x - 1, y) - h(x + 1, y)) / 2,
              1,
              (h(x, y - 1) - h(x, y + 1)) / 2,
            )
            .normalize();
          norms[v * 3] = normal.x;
          norms[v * 3 + 1] = normal.y;
          norms[v * 3 + 2] = normal.z;
          colorFor(y * N + x, col);
          colors[v * 3] = col.r;
          colors[v * 3 + 1] = col.g;
          colors[v * 3 + 2] = col.b;
        }
      }
      const indices: number[] = [];
      for (let y = 0; y < d - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
          const a = y * w + x;
          const b = a + 1;
          const c = a + w;
          const e = c + 1;
          indices.push(a, c, b, b, c, e);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(norms, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.computeBoundingSphere(); // per-chunk culling needs a real bound
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.castShadow = false; // terrain self-shadowing is costly + low-value
      group.add(mesh);
      chunks.push({ mesh, x0, y0, x1, y1, dirty: false });
    }
  }
  return {
    group,
    chunks,
    markAllDirty() {
      for (const c of chunks) c.dirty = true;
    },
    recolor(f, budget) {
      let done = 0;
      for (const c of chunks) {
        if (!c.dirty || done >= budget) continue;
        const attr = (c.mesh.geometry as THREE.BufferGeometry).getAttribute(
          "color",
        ) as THREE.BufferAttribute;
        const w = c.x1 - c.x0 + 1;
        for (let y = c.y0; y <= c.y1; y++) {
          for (let x = c.x0; x <= c.x1; x++) {
            f(y * N + x, col);
            attr.setXYZ((y - c.y0) * w + (x - c.x0), col.r, col.g, col.b);
          }
        }
        attr.needsUpdate = true;
        c.dirty = false;
        done++;
      }
      return chunks.reduce((n, c) => n + (c.dirty ? 1 : 0), 0);
    },
    dispose() {
      for (const c of chunks) c.mesh.geometry.dispose();
    },
  };
}
