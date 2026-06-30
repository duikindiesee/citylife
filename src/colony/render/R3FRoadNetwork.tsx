import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useRoadNetwork, RoadMask } from '../stores/useRoadNetwork';
import type { ColonySim } from '../sim';

interface R3FRoadNetworkProps {
  sim: ColonySim;
}

export function R3FRoadNetwork({ sim }: R3FRoadNetworkProps) {
  const tiles = useRoadNetwork(state => state.tiles);
  
  // We use useMemo to rebuild the InstancedMeshes when the road tiles change.
  // In a massive city, we'd use InstancedMesh for each type of road segment.
  const { straightGeo, cornerGeo, crossGeo, tGeo, material } = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#333333',
      roughness: 0.9,
      metalness: 0.1,
    });
    
    const straight = new THREE.BoxGeometry(4, 0.4, 4);
    const corner = new THREE.BoxGeometry(4, 0.4, 4);
    const cross = new THREE.BoxGeometry(4, 0.4, 4);
    const t = new THREE.BoxGeometry(4, 0.4, 4);
    
    return { straightGeo: straight, cornerGeo: corner, crossGeo: cross, tGeo: t, material: mat };
  }, []);

  const roadMeshes = useMemo(() => {
    const elements = [];
    const terrain = sim.state.terrain;
    const terrainSize = terrain.size;
    
    const getRotation = (mask: number): [number, number, number] => {
      // Rotation around Y axis (which is Z in R3F when lying flat on X,Z)
      // Because we rotate the plane -PI/2 on X, the Y rotation becomes Z rotation.
      
      switch (mask) {
        // Straights
        case RoadMask.StraightH: return [-Math.PI / 2, 0, Math.PI / 2];
        case RoadMask.StraightV: return [-Math.PI / 2, 0, 0];
        // Corners
        case RoadMask.CornerNE: return [-Math.PI / 2, 0, 0];
        case RoadMask.CornerES: return [-Math.PI / 2, 0, -Math.PI / 2];
        case RoadMask.CornerSW: return [-Math.PI / 2, 0, Math.PI];
        case RoadMask.CornerNW: return [-Math.PI / 2, 0, Math.PI / 2];
        // T-junctions
        case RoadMask.T_N: return [-Math.PI / 2, 0, 0];
        case RoadMask.T_E: return [-Math.PI / 2, 0, -Math.PI / 2];
        case RoadMask.T_S: return [-Math.PI / 2, 0, Math.PI];
        case RoadMask.T_W: return [-Math.PI / 2, 0, Math.PI / 2];
        // Cross
        case RoadMask.Cross: return [-Math.PI / 2, 0, 0];
        default: return [-Math.PI / 2, 0, 0]; // dead end or isolated
      }
    };

    for (const key in tiles) {
      const tile = tiles[key];
      const wX = (tile.x - terrainSize / 2) * 4;
      const wZ = (tile.y - terrainSize / 2) * 4;
      // Get the true elevation from the terrain
      const wY = terrain.worldY(tile.x, tile.y);
      
      let geo = straightGeo;
      if ([RoadMask.CornerNE, RoadMask.CornerNW, RoadMask.CornerES, RoadMask.CornerSW].includes(tile.mask)) geo = cornerGeo;
      if ([RoadMask.T_N, RoadMask.T_E, RoadMask.T_S, RoadMask.T_W].includes(tile.mask)) geo = tGeo;
      if (tile.mask === RoadMask.Cross) geo = crossGeo;

      // Add a slight lift so the bottom rests on the terrain
      elements.push(
        <mesh 
          key={key} 
          position={[wX, wY + 0.2, wZ]} 
          rotation={getRotation(tile.mask)}
          geometry={geo}
          material={material}
          receiveShadow
        />
      );
    }
    
    return elements;
  }, [tiles, straightGeo, cornerGeo, crossGeo, tGeo, material, sim]);

  return <group name="RoadNetwork">{roadMeshes}</group>;
}
