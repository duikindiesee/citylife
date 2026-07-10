// Spec 134 follow-up — the walker's heightfield collider, extracted pure so the rapier
// raycast parity test (tests/terrainColliderParity.test.ts) drives the EXACT same array
// and sizing the component mounts.
import type { Terrain } from "../terrain";

/** Rapier heightfield layout: `heights` is a COLUMN-MAJOR (nrows+1)x(ncols+1) matrix —
 *  index j*(nrows+1)+i, where j walks columns along local X and i walks rows along local Z.
 *  Verified empirically (2026-07-10): a high block written at the last THIRD of the array
 *  raises the +X edge, not the +Z edge. The old row-major fill `h[x + y*N]` therefore built
 *  the island MIRRORED across the X/Z diagonal: 85% of land cells carried >1 m of
 *  collider/ground mismatch (worst 20 m), the walker fell through every asymmetric hill and
 *  the spec-134 guardrail bounced it back up — the operator's "falling into the world,
 *  bouncy effect". terrainLevel stays keyed row-major (y*N+x) like every other consumer;
 *  only the rapier-facing array is column-major. */
export function computeColliderHeights(
  t: Terrain,
  terrainLevel?: Map<number, number> | null,
): Float32Array {
  const N = t.size;
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const idx = y * N + x;
      h[x * N + y] = terrainLevel?.get(idx) ?? t.worldY(x, y);
    }
  }
  return h;
}

/** Collider sizing matched EXACTLY to the terrain mesh. N samples span N-1 cells of 4
 *  units, so the field's total extent is (N-1)*4 — the old `N*4` stretched the collider
 *  ~2 units at the far edges (a half-cell of horizontal skew on slopes). */
export function colliderScale(N: number): { x: number; y: number; z: number } {
  return { x: (N - 1) * 4, y: 1, z: (N - 1) * 4 };
}

/** The mesh maps cell j to world (j - N/2)*4, so vertices run -N/2*4 .. (N-1-N/2)*4 and
 *  their CENTRE sits at -2 on both axes (independent of N). Rapier centres a heightfield
 *  on its body's origin, so the fixed body carrying it must sit at [-2, 0, -2] for sample
 *  points to land exactly on mesh vertices. */
export const COLLIDER_CENTER: [number, number, number] = [-2, 0, -2];
