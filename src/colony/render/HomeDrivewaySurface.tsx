import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ColonySim } from "../sim";
import { leveledWorldYAt } from "./terrainLeveling";

type Cell = { x: number; y: number };

/** Pave the same server-projected cells that the owned-car footprint may traverse. */
export function homeDrivewayGeometry(
  cells: readonly Cell[],
  terrainSize: number,
  roadSet: ReadonlySet<string>,
  surfaceAt: (x: number, y: number) => number,
): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    const key = `${cell.x},${cell.y}`;
    if (seen.has(key) || roadSet.has(key)) continue;
    seen.add(key);
    const first = vertices.length / 3;
    for (const [dx, dy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const gx = cell.x + dx, gy = cell.y + dy;
      vertices.push((gx - terrainSize / 2) * 4, surfaceAt(gx, gy) + 0.055,
        (gy - terrainSize / 2) * 4);
    }
    indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function HomeDrivewaySurface({ sim, terrainLevel, plotId, cells }: {
  sim: ColonySim;
  terrainLevel: ReadonlyMap<number, number> | null | undefined;
  plotId: string;
  cells: readonly Cell[];
}) {
  const geometry = useMemo(() => homeDrivewayGeometry(cells, sim.state.terrain.size,
    sim.state.roadSet, (x, y) => Math.max(0,
      leveledWorldYAt(sim.state.terrain, terrainLevel, x, y))),
  [sim, terrainLevel, cells]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh name="player-home-driveway" userData={{ plotId }} geometry={geometry}
    receiveShadow>
    <meshStandardMaterial color="#65727b" roughness={0.9} side={THREE.DoubleSide} />
  </mesh>;
}
