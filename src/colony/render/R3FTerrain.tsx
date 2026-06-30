import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody, HeightfieldCollider } from '@react-three/rapier';
import type { ColonySim } from '../sim';
import { buildChunkedTerrain } from './terrainChunks';
import { Biome, BIOME_COLOR } from '../terrain';
import { COLONY } from '../config';

interface R3FTerrainProps {
  sim: ColonySim;
  terrainLevel?: Map<number, number>;
}

export function R3FTerrain({ sim, terrainLevel }: R3FTerrainProps) {
  const terrainGroup = useMemo(() => {
    const t = sim.state.terrain;
    const N = t.size;
    const wx = (x: number) => (x - N / 2) * 4;
    const wz = (y: number) => (y - N / 2) * 4;

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.02,
      flatShading: false,
    });

    const leveledTerrain = new Proxy(t, {
      get(target, prop, receiver) {
        if (prop === 'worldY') {
          return (x: number, y: number) => {
            if (terrainLevel) {
              const idx = Math.round(y) * target.size + Math.round(x);
              const override = terrainLevel.get(idx);
              if (override !== undefined) return override;
            }
            return target.worldY(x, y);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });

    const chunked = buildChunkedTerrain(
      leveledTerrain,
      wx,
      wz,
      (i, out) => {
        let b = t.biome[i] as Biome;
        let isAboveWater = t.elev[i]! >= COLONY.world.seaLevel && !t.water[i];

        // Dynamically recolor terraformed cells
        if (terrainLevel && terrainLevel.has(i)) {
          const newY = terrainLevel.get(i)!;
          if (newY > 0.2) {
            if (b === Biome.Ocean || b === Biome.Shallows || b === Biome.River) b = Biome.Beach;
            isAboveWater = true;
          } else if (newY <= 0.2) {
            if (b === Biome.Beach || b === Biome.Plains || b === Biome.Forest) b = Biome.Shallows;
            isAboveWater = false;
          }
        }

        out.setHex(BIOME_COLOR[b] ?? 0xffffff);
        if (isAboveWater) {
          let h = (i * 2654435761) >>> 0;
          h = (h ^ (h >>> 15)) >>> 0;
          out.multiplyScalar(0.93 + (h / 4294967296) * 0.14);
        }
      },
      terrainMat,
      8
    );

    return chunked.group;
  }, [sim, terrainLevel]);

  const heights = useMemo(() => {
    const t = sim.state.terrain;
    const N = t.size;
    const h = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const idx = y * N + x;
        h[x + y * N] = terrainLevel?.get(idx) ?? t.worldY(x, y);
      }
    }
    return h;
  }, [sim, terrainLevel]);

  const N = sim.state.terrain.size;
  return (
    <group>
      <primitive object={terrainGroup} />
      <RigidBody type="fixed" colliders={false}>
        <HeightfieldCollider args={[N - 1, N - 1, Array.from(heights), { x: N * 4, y: 1, z: N * 4 }]} />
      </RigidBody>
    </group>
  );
}
