import React, { useState, useRef } from 'react';
import * as THREE from 'three';
import { useRoadNetwork } from '../stores/useRoadNetwork';
import { ThreeEvent } from '@react-three/fiber';
import type { ColonySim } from '../sim';
import { COLONY } from '../config';
import { BIG, COMPACT, ParcelSize } from '../neighborhood';
import type { Cell } from '../pathfind';

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

export function getZoningLayout(
  cx: number,
  cy: number,
  builderMode: string,
  tiles: Record<string, any>
) {
  const size: ParcelSize = BIG; // Default to BIG (11x14)
  const W = size.W;
  const D = size.D;
  const uHalf = (W - 1) / 2;

  // Let's check each of the 4 orientations for road adjacency
  let bestOrient: 'n' | 's' | 'e' | 'w' | null = null;
  let roadCell: { x: number; y: number } | null = null;

  // 1. Check facing North (road is to the North, plot is to the South of the road)
  // Front row is at y = cy, road check row is y = cy - 1
  for (let u = -uHalf; u <= uHalf; u++) {
    const rx = cx + u;
    const ry = cy - 1;
    if (tiles[`${rx},${ry}`]) {
      bestOrient = 'n';
      roadCell = { x: rx, y: ry };
      break;
    }
  }

  // 2. Check Facing South (road is to the South)
  if (!bestOrient) {
    for (let u = -uHalf; u <= uHalf; u++) {
      const rx = cx + u;
      const ry = cy + 1;
      if (tiles[`${rx},${ry}`]) {
        bestOrient = 's';
        roadCell = { x: rx, y: ry };
        break;
      }
    }
  }

  // 3. Check Facing West (road is to the West)
  if (!bestOrient) {
    for (let u = -uHalf; u <= uHalf; u++) {
      const rx = cx - 1;
      const ry = cy + u;
      if (tiles[`${rx},${ry}`]) {
        bestOrient = 'w';
        roadCell = { x: rx, y: ry };
        break;
      }
    }
  }

  // 4. Check Facing East (road is to the East)
  if (!bestOrient) {
    for (let u = -uHalf; u <= uHalf; u++) {
      const rx = cx + 1;
      const ry = cy + u;
      if (tiles[`${rx},${ry}`]) {
        bestOrient = 'e';
        roadCell = { x: rx, y: ry };
        break;
      }
    }
  }

  const orientation = bestOrient ?? 's'; // Default to South if no road connection
  const hasRoad = !!bestOrient;

  // Generate cells based on chosen orientation
  const cells: { x: number; y: number }[] = [];
  const translate = (u: number, d: number) => {
    switch (orientation) {
      case 'n': return { x: cx + u, y: cy + d };
      case 's': return { x: cx + u, y: cy - d };
      case 'w': return { x: cx + d, y: cy + u };
      case 'e': return { x: cx - d, y: cy + u };
    }
  };

  for (let d = 0; d < D; d++) {
    for (let u = -uHalf; u <= uHalf; u++) {
      cells.push(translate(u, d));
    }
  }

  const gateCell = translate(0, 0);

  return {
    orientation,
    hasRoad,
    cells,
    gateCell,
    roadCell: roadCell ?? translate(0, -1),
    size
  };
}

interface R3FRoadBuilderProps {
  sim: ColonySim;
  runtime?: any;
}

export function R3FRoadBuilder({ sim, runtime }: R3FRoadBuilderProps) {
  const terrainSize = sim.state.terrain.size;
  const builderActive = useRoadNetwork(state => state.builderActive);
  const builderMode = useRoadNetwork(state => state.builderMode);
  const plotRoad = useRoadNetwork(state => state.plotRoad);
  const applyLandscapeEdit = useRoadNetwork(state => state.applyLandscapeEdit);
  const isDrawing = useRoadNetwork(state => state.isDrawing);
  const setIsDrawing = useRoadNetwork(state => state.setIsDrawing);
  const tiles = useRoadNetwork(state => state.tiles);
  
  const [startCell, setStartCell] = useState<{ x: number; y: number } | null>(null);
  const [currentBlueprint, setCurrentBlueprint] = useState<{ x: number; y: number }[]>([]);
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);

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
    
    if (builderMode.startsWith('zoning_')) {
      const type = builderMode === 'zoning_residential' ? 'residential' : 'commercial';
      const layout = getZoningLayout(cell.x, cell.y, builderMode, tiles);
      if (layout && layout.hasRoad) {
        runtime?.placeZonedPlot(cell.x, cell.y, layout.orientation, 'BIG', type);
      } else {
        alert("No adjacent road access found! Plots must connect directly to a street.");
      }
      return;
    }
    
    setIsDrawing(true);
    setStartCell(cell);
    
    if (builderMode === 'roads') {
      setCurrentBlueprint([cell]);
    } else if (['raise', 'lower', 'flatten'].includes(builderMode)) {
      applyLandscapeEdit(cell.x, cell.y, builderMode as any);
    }
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!builderActive) return;
    e.stopPropagation();
    const cell = getCellFromEvent(e);
    setHoverCell(cell);
    
    if (!isDrawing || !startCell) return;
    
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
    } else if (['raise', 'lower', 'flatten'].includes(builderMode)) {
      applyLandscapeEdit(cell.x, cell.y, builderMode as any);
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
        onPointerOut={() => {
          setHoverCell(null);
          if (isDrawing) {
            setIsDrawing(false);
            setStartCell(null);
            setCurrentBlueprint([]);
          }
        }}
      >
        <planeGeometry args={[terrainSize * 4, terrainSize * 4]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Road Blueprint Preview */}
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

      {/* Zoning Footprint Preview */}
      {builderMode.startsWith('zoning_') && hoverCell && (() => {
        const layout = getZoningLayout(hoverCell.x, hoverCell.y, builderMode, tiles);
        if (!layout) return null;
        
        return layout.cells.map((c, i) => {
          const wY = sim.state.terrain.worldY(c.x, c.y);
          const color = layout.hasRoad 
            ? (builderMode === 'zoning_residential' ? "#55ff55" : "#55cfff") 
            : "#ff5555";
            
          return (
            <mesh 
              key={`zone-prev-${i}`} 
              position={[(c.x - terrainSize / 2) * 4, wY + 0.15, (c.y - terrainSize / 2) * 4]}
            >
              <boxGeometry args={[4, 0.1, 4]} />
              <meshStandardMaterial color={color} opacity={0.4} transparent />
            </mesh>
          );
        });
      })()}
    </group>
  );
}
