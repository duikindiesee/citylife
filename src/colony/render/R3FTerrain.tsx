import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { RigidBody, HeightfieldCollider } from "@react-three/rapier";
import type { ColonySim } from "../sim";
import { buildChunkedTerrain } from "./terrainChunks";
import {
  computeColliderHeights,
  colliderScale,
  COLLIDER_CENTER,
} from "./terrainCollider";
import { disposeDeep } from "./disposeDeep";
import { Biome, BIOME_COLOR } from "../terrain";
import { COLONY } from "../config";
import { useRoadNetwork } from "../stores/useRoadNetwork";

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
        if (prop === "worldY") {
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
        return typeof value === "function" ? value.bind(target) : value;
      },
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
            if (b === Biome.Ocean || b === Biome.Shallows || b === Biome.River)
              b = Biome.Beach;
            isAboveWater = true;
          } else if (newY <= 0.2) {
            if (b === Biome.Beach || b === Biome.Plains || b === Biome.Forest)
              b = Biome.Shallows;
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
      8,
    );

    return chunked.group;
  }, [sim, terrainLevel]);

  // Spec 119 — the chunked terrain (370k+ vertices plus its material) is rebuilt wholesale
  // on every terraform/leveling change; dispose the superseded tree or every rebuild leaks
  // its GPU buffers. Runs when a new group replaces the old, and on unmount.
  useEffect(() => () => disposeDeep(terrainGroup), [terrainGroup]);

  // The heightfield COLLIDER only matters to the first-person walker, which is off while the
  // builder or world view drives the aerial camera. Placing a plot changes terrainLevel and
  // used to rebuild the 607×607 collider (a 369,664-float fill + Array.from boxing + a full
  // Rapier rebuild) on EVERY placement — the "slow to place a plot" hitch. Freeze the collider
  // source while editing; it recommits once when the builder closes.
  const editing = useRoadNetwork((s) => s.builderActive || s.worldViewActive);
  // Column-major fill + exact mesh-matched sizing — see terrainCollider.ts for the rapier
  // layout contract (the old inline row-major fill mirrored the island across the diagonal).
  const computeHeights = () =>
    computeColliderHeights(sim.state.terrain, terrainLevel);
  const [colliderHeights, setColliderHeights] =
    useState<Float32Array>(computeHeights);
  useEffect(() => {
    if (editing) return; // frozen while building — recomputed when the builder closes
    setColliderHeights(computeHeights());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, terrainLevel, editing]);

  const N = sim.state.terrain.size;
  // Memoize the boxed args: a fresh Array.from on every render would rebuild the Rapier
  // collider whenever anything re-renders R3FWorld (builder toggles, road edits, ...).
  const colliderArgs = useMemo(
    () =>
      [N - 1, N - 1, Array.from(colliderHeights), colliderScale(N)] as const,
    [colliderHeights, N],
  );
  return (
    <group>
      <primitive object={terrainGroup} />
      <RigidBody type="fixed" colliders={false} position={COLLIDER_CENTER}>
        <HeightfieldCollider args={colliderArgs as any} />
      </RigidBody>
    </group>
  );
}
