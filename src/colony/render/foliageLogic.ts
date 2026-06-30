import * as THREE from 'three';
import { Biome } from '../terrain';
import { COLONY } from '../config';

const TREE_COLORS = [
  0x55925b, 0x6fb069, 0x3f7d5e, 0x7a5aa8, 0x8fb557, 0x356b46,
];
const LOT_SIZE = 4;

export function calculateFoliagePositions(
  terrain: any,
  roads: any[],
  buildings: any[]
): { matrices: number[][]; colors: number[] } {
  const N = terrain.size;
  const hash = (n: number) => ((n * 2654435761) >>> 0) / 4294967296;

  const cleared = new Set<number>();
  const mark = (cx: number, cy: number, rad: number) => {
    const ix = Math.round(cx);
    const iy = Math.round(cy);
    for (let yy = iy - rad; yy <= iy + rad; yy++) {
      for (let xx = ix - rad; xx <= ix + rad; xx++) {
        if (xx >= 0 && yy >= 0 && xx < N && yy < N) cleared.add(yy * N + xx);
      }
    }
  };

  // Clear roads
  for (const r of roads) mark(r.x, r.y, 1);

  // Clear buildings
  for (const b of buildings) {
    if (b.houseZone) {
      const hz = b.houseZone;
      const cx = hz.x + (hz.w - 1) / 2;
      const cy = hz.y + (hz.d - 1) / 2;
      const r = Math.max(hz.w, hz.d) / 2 + 1; // approx clearance
      mark(cx, cy, r);
    }
  }

  const matrices: number[][] = [];
  const colors: number[] = [];
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (cleared.has(i)) continue;
      if (terrain.elev[i] < COLONY.world.seaLevel || terrain.water[i]) continue;

      const b = terrain.biome[i] as Biome;
      if (b === Biome.Ocean || b === Biome.Shallows || b === Biome.Beach) continue;

      // Deterministic pseudo-randomness
      const h1 = hash(i);
      const h2 = hash(i + 1);

      // Trees per cell based on biome
      let count = 0;
      if (b === Biome.Forest) count = 2 + Math.floor(h1 * 3);
      else if (b === Biome.Plains) count = h1 > 0.8 ? 1 : 0;
      else if (b === Biome.Mountain) count = h1 > 0.9 ? 1 : 0;

      for (let j = 0; j < count; j++) {
        const trX = x + (hash(i + j * 7) - 0.5) * 0.8;
        const trY = y + (hash(i + j * 11) - 0.5) * 0.8;
        
        // Clamp to edges
        if (trX < 0 || trX >= N - 1 || trY < 0 || trY >= N - 1) continue;

        const wX = (trX - N / 2) * LOT_SIZE;
        const wZ = (trY - N / 2) * LOT_SIZE;
        const wY = terrain.worldY(Math.round(trX), Math.round(trY));

        const scale = 0.6 + hash(i + j * 13) * 0.8;
        dummy.position.set(wX, wY, wZ);
        dummy.rotation.set(
          (hash(i + j * 17) - 0.5) * 0.2,
          hash(i + j * 19) * Math.PI * 2,
          (hash(i + j * 23) - 0.5) * 0.2
        );
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        
        matrices.push(dummy.matrix.toArray());
        
        const baseC = TREE_COLORS[Math.floor(hash(i + j * 29) * TREE_COLORS.length)];
        col.setHex(baseC);
        col.multiplyScalar(0.7 + hash(i + j * 31) * 0.5); // jitter brightness
        colors.push(col.getHex());
      }
    }
  }

  return { matrices, colors };
}
