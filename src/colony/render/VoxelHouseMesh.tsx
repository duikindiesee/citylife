import { useMemo } from "react";
import * as THREE from "three";
import { compileBlueprint, VOXEL_Y } from "../houseBuilder";
import { greedyMesh } from "./voxelMesh";
import { defaultBlueprint, streetDoorDir, type Parcel } from "../neighborhood";

const HOUSE_TINTS = [
  0xc97b5a, 0xd9c0a0, 0x8fa07a, 0x7d93a8, 0xc9a24a, 0xb0543f, 0x9c8aa8,
  0x9aa05a,
];
const LOT_SIZE = 4;

export function VoxelHouseMesh({
  lot,
  mapSize,
  seatY,
}: {
  lot: Parcel;
  mapSize: number;
  seatY?: number;
}) {
  const { geometry, material } = useMemo(() => {
    const doorDir = streetDoorDir(lot);
    const script =
      lot.blueprint ??
      defaultBlueprint(lot.houseSeed, doorDir, lot.houseZone.w);
    let compiled;
    try {
      compiled = compileBlueprint(script, {
        w: lot.houseZone.w,
        d: lot.houseZone.d,
        seed: lot.houseSeed,
      });
    } catch {
      return { geometry: null, material: null };
    }

    // Spec 129 — the legacy renderer's world is 1 unit per grid cell (it seats meshes with a
    // HALF-UNIT corner offset); VOXEL_Y = 0.22 was calibrated for that world. This world is
    // 4 units per cell: the footprint was already scaled (cell: LOT_SIZE) but the height was
    // not, so every house rendered 4x wider than tall — a knee-high pancake the walker
    // stepped over. Scale the storey height by the SAME world factor.
    const { geometry: geo } = greedyMesh(compiled.blocks, {
      n: compiled.n,
      cell: LOT_SIZE,
      voxelY: VOXEL_Y * LOT_SIZE,
    });

    const cAttr = geo.getAttribute("color") as
      | THREE.BufferAttribute
      | undefined;
    if (cAttr) {
      const tint = new THREE.Color(
        HOUSE_TINTS[
          ((lot.houseSeed % HOUSE_TINTS.length) + HOUSE_TINTS.length) %
            HOUSE_TINTS.length
        ]!,
      );
      const a = cAttr.array as Float32Array;
      const k = 0.42;
      for (let i = 0; i < a.length; i += 3) {
        const r = a[i]!,
          g = a[i + 1]!,
          b = a[i + 2]!;
        if (!(r > g && g > b) || r < 0.2) continue;
        a[i] = r * (1 - k) + tint.r * k;
        a[i + 1] = g * (1 - k) + tint.g * k;
        a[i + 2] = b * (1 - k) + tint.b * k;
      }
      cAttr.needsUpdate = true;
    }

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true,
    });

    return { geometry: geo, material: mat };
  }, [lot.id, lot.houseSeed, lot.blueprint]);

  if (!geometry || !material) return null;

  // mapSize represents the width of the grid in tiles (e.g., 256).
  // The center of the grid is at mapSize / 2.
  // One grid tile is LOT_SIZE units wide (4 units).
  // Half-cell corner offset (legacy seats the micro-grid corner flush on the zone: cell x
  // spans [wx(x) - half, wx(x) + half]).
  const wX = (lot.houseZone.x - mapSize / 2) * LOT_SIZE - LOT_SIZE / 2;
  const wZ = (lot.houseZone.y - mapSize / 2) * LOT_SIZE - LOT_SIZE / 2;

  return (
    // Spec 128 — the house sits on its leveled pad (seatY, computed by ZoneManager with the
    // exact useTerrainLeveling seat formula). The old absolute 0.05 buried every house
    // under the terrain; the default keeps old behavior for any caller without a seat.
    <group position={[wX, seatY ?? 0.05, wZ]}>
      <mesh geometry={geometry} material={material} castShadow receiveShadow />
    </group>
  );
}
