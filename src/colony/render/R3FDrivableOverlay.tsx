import React, { useMemo, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { ColonySim } from "../sim";
import type { ColonyRuntime } from "../runtime";
import { getSmoothRoadY } from "./roadSurface";
import { isPointInGarageVicinity } from "./garageAnchorShell";

interface R3FDrivableOverlayProps {
  sim: ColonySim;
  runtime?: ColonyRuntime | null;
}

/**
 * Spec 174 — In-world 3D visual test overlay of drivable surface.
 * Drapes an instanced grid mesh of thin tiles over terrain at road surface height,
 * color-coding road ribbons (cyan), verges (emerald), and blocked parcels (red).
 */
export function R3FDrivableOverlay({ sim, runtime }: R3FDrivableOverlayProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [visible, setVisible] = useState(runtime?.showDrivableOverlay ?? false);

  useEffect(() => {
    if (!runtime) return;
    setVisible(runtime.showDrivableOverlay ?? false);
    return runtime.subscribe(() => {
      setVisible(runtime.showDrivableOverlay ?? false);
    });
  }, [runtime]);

  const terrain = sim.state.terrain;
  const size = terrain.size;

  const data = useMemo(() => {
    if (!visible) return null;

    const roadSet = sim.state.roadSet;
    const roadWays = sim.state.roadWays ?? runtime?.roadWays ?? [];
    const buildings = sim.state.buildings ?? [];
    const structures = sim.state.structures ?? [];

    // Collect all candidate cells on or immediately adjacent to road surfaces
    const cells: {
      x: number;
      y: number;
      kind: "road" | "verge" | "blocked";
    }[] = [];
    const checked = new Set<string>();

    const checkCell = (x: number, y: number) => {
      const key = `${x},${y}`;
      if (checked.has(key)) return;
      checked.add(key);
      if (x < 2 || x >= size - 2 || y < 2 || y >= size - 2) return;
      if (terrain.isWater(x, y)) return;

      const isRoad = runtime?.isRoadSurface(x, y) ?? roadSet?.has(key) ?? false;
      const isBlocked =
        buildings.some((b) => Math.round(b.x) === x && Math.round(b.y) === y) ||
        structures.some((s) => Math.round(s.x) === x && Math.round(s.y) === y);

      if (isBlocked && isRoad) {
        cells.push({ x, y, kind: "blocked" });
      } else if (isRoad) {
        cells.push({ x, y, kind: "road" });
      }
    };

    // 1. Check all discrete road cells
    if (roadSet) {
      for (const key of roadSet) {
        const [sx, sy] = key.split(",");
        const x = Number(sx);
        const y = Number(sy);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              checkCell(x + dx, y + dy);
            }
          }
        }
      }
    }

    // 2. Check along all continuous road ways
    for (const way of roadWays) {
      if (!way.path) continue;
      for (const pt of way.path) {
        const rx = Math.round(pt.x);
        const ry = Math.round(pt.y);
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            checkCell(rx + dx, ry + dy);
          }
        }
      }
    }

    // 3. Spec 177: Check commercial garage vicinity (drivable apron, parking stalls, service bay, and obstacles)
    const garagePad = sim.state.commercialDistrict?.garagePad;
    if (garagePad && runtime) {
      for (
        let gx = garagePad.x - 2;
        gx <= garagePad.x + garagePad.w + 5;
        gx++
      ) {
        for (
          let gy = garagePad.y - 2;
          gy <= garagePad.y + garagePad.h + 5;
          gy++
        ) {
          if (gx < 2 || gx >= size - 2 || gy < 2 || gy >= size - 2) continue;
          if (isPointInGarageVicinity(gx, gy, garagePad)) {
            const key = `${gx},${gy}`;
            if (checked.has(key)) continue;
            checked.add(key);
            if (runtime.isGaragePadDrivable(gx, gy, garagePad)) {
              cells.push({ x: gx, y: gy, kind: "road" });
            } else {
              cells.push({ x: gx, y: gy, kind: "blocked" });
            }
          }
        }
      }
    }

    return cells;
  }, [visible, sim, runtime, terrain, size]);

  const assets = useMemo(() => {
    const geo = new THREE.BoxGeometry(3.8, 0.08, 3.8);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const m4 = new THREE.Matrix4();
    const color = new THREE.Color();
    return { geo, mat, m4, color };
  }, []);

  useEffect(() => {
    return () => {
      assets.geo.dispose();
      assets.mat.dispose();
    };
  }, [assets]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !data || data.length === 0) return;

    for (let i = 0; i < data.length; i++) {
      const c = data[i]!;
      const wx = (c.x - size / 2) * 4;
      const wz = (c.y - size / 2) * 4;
      const y = Math.max(0, getSmoothRoadY(terrain, c.x, c.y)) + 0.18;

      assets.m4.makeTranslation(wx, y, wz);
      mesh.setMatrixAt(i, assets.m4);

      if (c.kind === "road") {
        assets.color.set("#00f5ff"); // Glowing Cyan for paved road ribbon
      } else if (c.kind === "verge") {
        assets.color.set("#00ff66"); // Emerald green for traversable verge
      } else {
        assets.color.set("#ff2244"); // Crimson for blocked
      }
      mesh.setColorAt(i, assets.color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [data, assets, terrain, size]);

  if (!visible || !data || data.length === 0) return null;

  return (
    <group name="drivable-surface-overlay">
      <instancedMesh
        ref={meshRef}
        args={[assets.geo, assets.mat, data.length]}
        count={data.length}
      />
    </group>
  );
}
