import React, { useState, useRef } from 'react';
import * as THREE from 'three';
import { useRoadNetwork } from '../stores/useRoadNetwork';
import { ThreeEvent } from '@react-three/fiber';
import type { ColonySim } from '../sim';
import { COLONY } from '../config';

// Bresenham's line algorithm to get all cells between two points
function getCellsOnLine(x0: number, y0: number, x1: number, y1: number) {
  const cells: { x: number; y: number }[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let currentX = x0;
  let currentY = y0;

  while (true) {
    cells.push({ x: currentX, y: currentY });
    if (currentX === x1 && currentY === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      currentX += sx;
    }
    if (e2 < dx) {
      err += dx;
      currentY += sy;
    }
  }
  return cells;
}

interface R3FRoadBuilderProps {
  sim: ColonySim;
}

export function R3FRoadBuilder({ sim }: R3FRoadBuilderProps) {
  const terrainSize = sim.state.terrain.size;
  const builderActive = useRoadNetwork(state => state.builderActive);
  const builderMode = useRoadNetwork(state => state.builderMode);
  const plotRoad = useRoadNetwork(state => state.plotRoad);
  const applyLandscapeEdit = useRoadNetwork(state => state.applyLandscapeEdit);
  const isDrawing = useRoadNetwork(state => state.isDrawing);
  const setIsDrawing = useRoadNetwork(state => state.setIsDrawing);
  
  const [startCell, setStartCell] = useState<{ x: number; y: number } | null>(null);
  const [currentBlueprint, setCurrentBlueprint] = useState<{ x: number; y: number }[]>([]);

  const planeRef = useRef<THREE.Mesh>(null);

  const getCellFromEvent = (e: ThreeEvent<PointerEvent>) => {
    const x = Math.round(e.point.x / 4 + terrainSize / 2);
    const y = Math.round(e.point.z / 4 + terrainSize / 2);
    return { x, y };
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!builderActive || e.button !== 0) return;
    e.stopPropagation();
    const cell = getCellFromEvent(e);
    setIsDrawing(true);
    setStartCell(cell);
    
    if (builderMode === 'roads') {
      setCurrentBlueprint([cell]);
    } else {
      // Landscape brush mode
      applyLandscapeEdit(cell.x, cell.y, builderMode);
    }
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!builderActive || !isDrawing || !startCell) return;
    e.stopPropagation();
    const cell = getCellFromEvent(e);
    
    if (builderMode === 'roads') {
      const dx = Math.abs(cell.x - startCell.x);
      const dy = Math.abs(cell.y - startCell.y);
      let targetX = cell.x;
      let targetY = cell.y;
      
      if (dx > dy) {
        targetY = startCell.y;
      } else {
        targetX = startCell.x;
      }

      const cells = getCellsOnLine(startCell.x, startCell.y, targetX, targetY);
      setCurrentBlueprint(cells);
    } else {
      // Landscape brush mode - paint as we drag
      applyLandscapeEdit(cell.x, cell.y, builderMode);
    }
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!builderActive || !isDrawing) return;
    e.stopPropagation();
    
    if (builderMode === 'roads' && currentBlueprint.length > 0) {
      plotRoad(currentBlueprint, 'street');
    }
    
    setIsDrawing(false);
    setStartCell(null);
    setCurrentBlueprint([]);
  };

  if (!builderActive) return null;

  return (
    <group>
      <mesh 
        ref={planeRef}
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, COLONY.world.seaLevel, 0]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOut={handlePointerUp}
      >
        <planeGeometry args={[terrainSize * 4, terrainSize * 4]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {builderMode === 'roads' && currentBlueprint.map((c, i) => {
        const wY = sim.state.terrain.worldY(c.x, c.y);
        return (
          <mesh 
            key={i} 
            position={[(c.x - terrainSize / 2) * 4, wY + 0.2, (c.y - terrainSize / 2) * 4]}
          >
            <boxGeometry args={[4, 0.4, 4]} />
            <meshStandardMaterial color={i === currentBlueprint.length - 1 ? "#00ff00" : "#55ff55"} opacity={0.6} transparent />
          </mesh>
        );
      })}
    </group>
  );
}
