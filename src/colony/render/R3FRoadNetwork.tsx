import React, { useMemo } from "react";
import * as THREE from "three";
import { useRoadNetwork } from "../stores/useRoadNetwork";
import { getSmoothRoadY } from "./roadSurface";
import type { ColonySim } from "../sim";

// Spec 127 — this component used to draw the committed road surface as one bordered box PER
// CELL, plus per-cell junction decorations detected off tile-neighbour counts. The road cell
// data is a deliberately ~3-cell-wide carriageway, so that rendered every road as 2-3 parallel
// bordered strips (the operator's "laid triple and double") and, because nearly every interior
// cell of a wide road has 3-4 neighbours, hung "junction" furniture on thousands of cells —
// together ~100k scene nodes and the single biggest frame cost (7 FPS measured). The surface
// now renders as the smooth centre-line ribbon (R3FRoadRibbons, the legacy spec 088 path) and
// junctions come from the road WAYS (roadJunctions.ts). What remains here is the one per-cell
// feature the ribbon genuinely can't produce: the cul-de-sac turnaround bulbs. The road
// trimesh collider is gone too — nothing collides road meshes (first-person, the car and the
// race all ride terrain.worldY / getSmoothRoadY).

interface R3FRoadNetworkProps {
  sim: ColonySim;
  runtime?: any;
}

export function R3FRoadNetwork({ sim }: R3FRoadNetworkProps) {
  const tiles = useRoadNetwork((state) => state.tiles);

  const culDeSacs = useMemo(() => {
    const elements = [];
    const terrain = sim.state.terrain;
    const N = terrain.size;

    const keys = Object.keys(tiles);

    for (const k of keys) {
      const tile = tiles[k];
      if (tile.type === "culdesac") {
        const wX = (tile.x - N / 2) * 4;
        const wZ = (tile.y - N / 2) * 4;
        const wY = getSmoothRoadY(terrain, tile.x, tile.y) + 0.18;

        elements.push(
          <group key={`culdesac-${k}`} position={[wX, wY, wZ]}>
            {/* Asphalt turnaround bulb */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0, 3.2]} />
              <meshStandardMaterial
                color="#595f6a"
                roughness={0.92}
                metalness={0.02}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* White outer curb */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
              <ringGeometry args={[3.1, 3.3]} />
              <meshStandardMaterial
                color="#e8ecf2"
                roughness={0.6}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>,
        );
      }
    }
    return elements;
  }, [tiles, sim]);

  return <group name="RoadNetwork">{culDeSacs}</group>;
}
