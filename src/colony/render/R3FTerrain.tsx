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

/**
 * Procedural ground detail texture generator.
 * Creates a seamless sand/gravel/earth micro-detail texture that blends with vertex colors
 * to replace flat shading with rich, realistic desert ground textures.
 */
function createGroundTextures(): {
  map: THREE.CanvasTexture | null;
  bumpMap: THREE.CanvasTexture | null;
} {
  if (typeof document === "undefined" || !document.createElement) {
    return { map: null, bumpMap: null };
  }
  try {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { map: null, bumpMap: null };

    // Fill base desert ground tone (normalized lightness ~0.86 so vertexColors are preserved)
    ctx.fillStyle = "#ded6c4";
    ctx.fillRect(0, 0, size, size);

    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;

    let seed = 4242;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed & 0xffff) / 65536;
    };

    // Layer 1: Sand grain / micro-grit & tiny stone granules
    for (let i = 0; i < data.length; i += 4) {
      const noise = (rnd() - 0.5) * 36;
      data[i] = Math.min(255, Math.max(0, data[i]! + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1]! + noise * 0.9));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2]! + noise * 0.8));
    }

    // Layer 2: Subtle wind ripple striations
    for (let y = 0; y < size; y++) {
      const ripple = Math.sin((y / size) * Math.PI * 16) * 8;
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        data[idx] = Math.min(255, Math.max(0, data[idx]! + ripple));
        data[idx + 1] = Math.min(255, Math.max(0, data[idx + 1]! + ripple * 0.85));
        data[idx + 2] = Math.min(255, Math.max(0, data[idx + 2]! + ripple * 0.7));
      }
    }

    // Layer 3: Scattered pebbles/gravel
    for (let p = 0; p < 800; p++) {
      const px = Math.floor(rnd() * size);
      const py = Math.floor(rnd() * size);
      const radius = 1 + Math.floor(rnd() * 2);
      const shade = (rnd() - 0.5) * 45;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius) {
            const sx = (px + dx + size) % size;
            const sy = (py + dy + size) % size;
            const idx = (sy * size + sx) * 4;
            data[idx] = Math.min(255, Math.max(0, data[idx]! + shade));
            data[idx + 1] = Math.min(255, Math.max(0, data[idx + 1]! + shade * 0.9));
            data[idx + 2] = Math.min(255, Math.max(0, data[idx + 2]! + shade * 0.8));
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    const map = new THREE.CanvasTexture(canvas);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.generateMipmaps = true;

    // Create matching grayscale bump map for tactile micro-relief
    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bumpCtx = bumpCanvas.getContext("2d");
    if (bumpCtx) {
      const bumpData = bumpCtx.createImageData(size, size);
      for (let i = 0; i < data.length; i += 4) {
        const lum = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
        bumpData.data[i] = lum;
        bumpData.data[i + 1] = lum;
        bumpData.data[i + 2] = lum;
        bumpData.data[i + 3] = 255;
      }
      bumpCtx.putImageData(bumpData, 0, 0);
      const bumpMap = new THREE.CanvasTexture(bumpCanvas);
      bumpMap.wrapS = THREE.RepeatWrapping;
      bumpMap.wrapT = THREE.RepeatWrapping;
      bumpMap.generateMipmaps = true;
      return { map, bumpMap };
    }

    return { map, bumpMap: null };
  } catch {
    return { map: null, bumpMap: null };
  }
}

export function R3FTerrain({ sim, terrainLevel }: R3FTerrainProps) {
  const terrainGroup = useMemo(() => {
    const t = sim.state.terrain;
    const N = t.size;
    const wx = (x: number) => (x - N / 2) * 4;
    const wz = (y: number) => (y - N / 2) * 4;

    const { map, bumpMap } = createGroundTextures();
    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.02,
      flatShading: false,
      map: map ?? undefined,
      bumpMap: bumpMap ?? undefined,
      bumpScale: bumpMap ? 0.08 : 0,
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
