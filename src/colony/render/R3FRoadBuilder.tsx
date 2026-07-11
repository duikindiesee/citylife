import React, { useState, useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useRoadNetwork } from '../stores/useRoadNetwork';
import { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { ColonySim } from '../sim';
import { COLONY } from '../config';
import { Biome } from '../terrain';
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

  const candidates: { orient: 'n' | 's' | 'e' | 'w'; roadCell: { x: number; y: number }; dist: number }[] = [];

  // 1. Check facing North (road is to the North)
  for (let u = -uHalf; u <= uHalf; u++) {
    const rx = cx + u;
    const ry = cy - 1;
    if (tiles[`${rx},${ry}`]) {
      candidates.push({ orient: 'n', roadCell: { x: rx, y: ry }, dist: Math.abs(u) });
    }
  }

  // 2. Check Facing South (road is to the South)
  for (let u = -uHalf; u <= uHalf; u++) {
    const rx = cx + u;
    const ry = cy + 1;
    if (tiles[`${rx},${ry}`]) {
      candidates.push({ orient: 's', roadCell: { x: rx, y: ry }, dist: Math.abs(u) });
    }
  }

  // 3. Check Facing West (road is to the West)
  for (let u = -uHalf; u <= uHalf; u++) {
    const rx = cx - 1;
    const ry = cy + u;
    if (tiles[`${rx},${ry}`]) {
      candidates.push({ orient: 'w', roadCell: { x: rx, y: ry }, dist: Math.abs(u) });
    }
  }

  // 4. Check Facing East (road is to the East)
  for (let u = -uHalf; u <= uHalf; u++) {
    const rx = cx + 1;
    const ry = cy + u;
    if (tiles[`${rx},${ry}`]) {
      candidates.push({ orient: 'e', roadCell: { x: rx, y: ry }, dist: Math.abs(u) });
    }
  }

  // Find the candidate with the minimum distance (closest to center)
  const best = candidates.reduce((min, c) => (c.dist < min.dist ? c : min), candidates[0] || null);

  const orientation = best ? best.orient : 's';
  const hasRoad = !!best;
  const roadCell = best ? best.roadCell : null;

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
  const removeRoad = useRoadNetwork(state => state.removeRoad);
  const sameSessionPlacements = useRoadNetwork(state => state.sameSessionPlacements);
  const activeRoadType = useRoadNetwork(state => state.activeRoadType);
  
  const [startCell, setStartCell] = useState<{ x: number; y: number } | null>(null);
  const [currentBlueprint, setCurrentBlueprint] = useState<{ x: number; y: number }[]>([]);
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);

  const planeRef = useRef<THREE.Mesh>(null);

  // The zoning footprint preview as ONE mount-once InstancedMesh (cap = BIG 11×14 = 154).
  // The old JSX mapped 154 fresh <mesh><boxGeometry/><meshStandardMaterial/> on every hover
  // re-render — 154 geometry+material allocations and GPU uploads per moved cell. Now a hover
  // change writes 154 matrices into a pre-allocated buffer. Preview color is plot-wide, so a
  // single shared material recolors per hover.
  const zonePreviewRef = useRef<THREE.InstancedMesh>(null);
  const zonePreview = useMemo(
    () => ({
      geo: new THREE.BoxGeometry(4, 0.1, 4),
      mat: new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 }),
      m4: new THREE.Matrix4(),
    }),
    []
  );
  useEffect(
    () => () => {
      zonePreview.geo.dispose();
      zonePreview.mat.dispose();
    },
    [zonePreview]
  );
  const zoning = builderMode.startsWith('zoning_');
  useEffect(() => {
    const mesh = zonePreviewRef.current;
    if (!mesh) return;
    if (!zoning || !hoverCell) {
      mesh.count = 0;
      return;
    }
    const layout = getZoningLayout(hoverCell.x, hoverCell.y, builderMode, tiles);
    if (!layout) {
      mesh.count = 0;
      return;
    }
    const landOk = layout.cells.every(c => isBuildablePlotLand(c.x, c.y));
    const statusOk = layout.hasRoad && landOk;
    zonePreview.mat.color.set(
      statusOk ? (builderMode === 'zoning_residential' ? '#55ff55' : '#55cfff') : '#ff5555'
    );
    const cap = mesh.instanceMatrix.count;
    let placed = 0;
    for (const c of layout.cells) {
      if (placed >= cap) break;
      const cellY = sim.state.terrain.worldY(c.x, c.y);
      zonePreview.m4.identity();
      zonePreview.m4.setPosition(
        (c.x - terrainSize / 2) * 4,
        cellY + 0.05,
        (c.y - terrainSize / 2) * 4
      );
      mesh.setMatrixAt(placed++, zonePreview.m4);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverCell, builderMode, tiles, zoning, zonePreview, sim, terrainSize]);

  const isBuildableRoadLand = (x: number, y: number) => {
    if (x < 0 || x >= terrainSize || y < 0 || y >= terrainSize) return false;
    const index = y * terrainSize + x;
    const t = sim.state.terrain;
    // Roads: must not be water, must not be beach sand (spec 138 — the preview cell turns red on
    // the sand exactly as it does on water), and must not be extreme mountain cliffs.
    return (
      !t.isWater(x, y) &&
      t.biome[index] !== Biome.Beach &&
      t.buildable[index] > 0
    );
  };

  const isBuildablePlotLand = (x: number, y: number) => {
    if (x < 0 || x >= terrainSize || y < 0 || y >= terrainSize) return false;
    const index = y * terrainSize + x;
    const t = sim.state.terrain;
    const wY = t.worldY(x, y);
    // Plots: must not be water, must not be extreme cliffs, and must be dry ground above the beach (wY >= 0.2)
    return !t.isWater(x, y) && t.buildable[index] > 0 && wY >= 0.2;
  };

  const getCellFromEvent = (e: ThreeEvent<PointerEvent>) => {
    const x = Math.round(e.point.x / 4 + terrainSize / 2);
    const y = Math.round(e.point.z / 4 + terrainSize / 2);
    return { x, y };
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!builderActive || e.button !== 0) return;
    e.stopPropagation();
    const cell = getCellFromEvent(e);
    
    if (builderMode === 'bulldoze') {
      // 1. Try to demolish plot first
      const demolished = runtime?.demolishPlot(cell.x, cell.y);
      if (demolished) return;
      
      // 2. Try to remove road tile
      const key = `${cell.x},${cell.y}`;
      if (tiles[key]) {
        removeRoad(cell.x, cell.y, sim);
      }
      return;
    }
    
    if (builderMode.startsWith('zoning_')) {
      const type = builderMode === 'zoning_residential' ? 'residential' : 'commercial';
      const layout = getZoningLayout(cell.x, cell.y, builderMode, tiles);
      if (layout && layout.hasRoad) {
        // Validate all cells are buildable land
        const allOk = layout.cells.every(c => isBuildablePlotLand(c.x, c.y));
        if (!allOk) return; // Block placement silently
        runtime?.placeZonedPlot(cell.x, cell.y, layout.orientation, 'BIG', type);
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
    // Cells are 4 world-units wide, so most pointer-moves stay inside one cell: returning the
    // SAME reference makes React bail out of the re-render (the hover previews and the <Html>
    // tooltip used to rebuild on every single pointer event).
    setHoverCell(prev => (prev && prev.x === cell.x && prev.y === cell.y) ? prev : cell);
    
    if (!isDrawing || !startCell) return;
    
    if (builderMode === 'roads') {
      if (activeRoadType === 'culdesac') {
        setCurrentBlueprint([startCell]);
        return;
      }

      let targetX = cell.x;
      let targetY = cell.y;
      
      const dx = cell.x - startCell.x;
      const dy = cell.y - startCell.y;
      
      if (dx !== 0 || dy !== 0) {
        // Snap dragging angle to nearest 45 degrees
        const angle = Math.atan2(dy, dx);
        const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        
        const ux = Math.cos(snappedAngle);
        const uy = Math.sin(snappedAngle);
        
        const rawDist = Math.max(Math.abs(dx), Math.abs(dy));
        
        targetX = startCell.x + Math.round(ux * rawDist);
        targetY = startCell.y + Math.round(uy * rawDist);
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
      // Validate all cells in blueprint are buildable land
      const allOk = currentBlueprint.every(c => isBuildableRoadLand(c.x, c.y));
      if (!allOk) {
        setIsDrawing(false);
        setStartCell(null);
        setCurrentBlueprint([]);
        return; // Block placement silently
      }
      plotRoad(currentBlueprint, activeRoadType, sim);
    }
    
    setIsDrawing(false);
    setStartCell(null);
    setCurrentBlueprint([]);
  };

  if (!builderActive) return null;

  return (
    <group name="RoadBuilder">
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

      {/* Road Preview (Hover & Blueprint) */}
      {builderMode === 'roads' && (() => {
        const previewCells = isDrawing ? currentBlueprint : (hoverCell ? [hoverCell] : []);
        return previewCells.map((c, i) => {
          const wY = sim.state.terrain.worldY(c.x, c.y);
          const valid = isBuildableRoadLand(c.x, c.y);
          return (
            <mesh 
              key={i} 
              position={[(c.x - terrainSize / 2) * 4, wY + 0.25, (c.y - terrainSize / 2) * 4]}
            >
              <boxGeometry args={[4, 0.5, 4]} />
              <meshStandardMaterial 
                color={!valid ? "#ff3333" : "#33ff33"} 
                opacity={0.5} 
                transparent 
              />
            </mesh>
          );
        });
      })()}

      {/* Bulldozer Demolish Preview */}
      {builderMode === 'bulldoze' && hoverCell && (() => {
        const nbhd = (sim.state as any).neighborhood;
        const lots = nbhd?.lots || [];
        
        // 1. Try to find a plot first
        const lot = lots.find((l: any) => {
          const w = l.w || 3;
          const offX = Math.floor((w - 1) / 2);
          const offY = Math.floor(w / 2);
          return (
            hoverCell.x >= l.x - offX && hoverCell.x <= l.x + offY &&
            hoverCell.y >= l.y - offX && hoverCell.y <= l.y + offY
          );
        });

        if (lot) {
          const w = lot.w || 3;
          const offX = Math.floor((w - 1) / 2);
          const offY = Math.floor(w / 2);
          
          const cells = [];
          for (let xx = lot.x - offX; xx <= lot.x + offY; xx++) {
            for (let yy = lot.y - offX; yy <= lot.y + offY; yy++) {
              cells.push({ x: xx, y: yy });
            }
          }
          
          return (
            <group>
              {cells.map((c, i) => {
                const wY = sim.state.terrain.worldY(c.x, c.y);
                return (
                  <mesh key={`del-lot-${i}`} position={[(c.x - terrainSize / 2) * 4, wY + 0.35, (c.y - terrainSize / 2) * 4]}>
                    <boxGeometry args={[4.1, 0.7, 4.1]} />
                    <meshStandardMaterial color="#ff0000" opacity={0.6} transparent />
                  </mesh>
                );
              })}
            </group>
          );
        }

        // 2. Fallback to single cell (road/tile)
        const key = `${hoverCell.x},${hoverCell.y}`;
        if (tiles[key]) {
          const wY = sim.state.terrain.worldY(hoverCell.x, hoverCell.y);
          return (
            <mesh position={[(hoverCell.x - terrainSize / 2) * 4, wY + 0.35, (hoverCell.y - terrainSize / 2) * 4]}>
              <boxGeometry args={[4.1, 0.7, 4.1]} />
              <meshStandardMaterial color="#ff0000" opacity={0.6} transparent />
            </mesh>
          );
        }

        return null;
      })()}

      {/* Zoning Footprint Preview — the cell tint is the mount-once InstancedMesh above;
          here only the arrow + tooltip remain (they re-render only when the cell changes) */}
      <instancedMesh
        ref={zonePreviewRef}
        args={[zonePreview.geo, zonePreview.mat, BIG.W * BIG.D]}
        frustumCulled={false}
      />
      {builderMode.startsWith('zoning_') && hoverCell && (() => {
        const layout = getZoningLayout(hoverCell.x, hoverCell.y, builderMode, tiles);
        if (!layout) return null;

        const wY = sim.state.terrain.worldY(hoverCell.x, hoverCell.y);
        const landOk = layout.cells.every(c => isBuildablePlotLand(c.x, c.y));
        const statusOk = layout.hasRoad && landOk;

        const gateWorldX = (layout.gateCell.x - terrainSize / 2) * 4;
        const gateWorldZ = (layout.gateCell.y - terrainSize / 2) * 4;
        const gateWorldY = sim.state.terrain.worldY(layout.gateCell.x, layout.gateCell.y);

        let arrowRotY = 0;
        if (layout.orientation === 'n') arrowRotY = Math.PI;
        if (layout.orientation === 's') arrowRotY = 0;
        if (layout.orientation === 'w') arrowRotY = -Math.PI / 2;
        if (layout.orientation === 'e') arrowRotY = Math.PI / 2;

        return (
          <group>
            {/* Direction Arrow Hint pointing to connected street */}
            {layout.hasRoad && (
              <mesh 
                position={[gateWorldX, gateWorldY + 0.6, gateWorldZ]}
                rotation={[Math.PI / 2, arrowRotY, 0]}
              >
                <coneGeometry args={[0.3, 1.2, 4]} />
                <meshStandardMaterial color="#00ff00" emissive="#00ff00" emissiveIntensity={0.5} />
              </mesh>
            )}

            {/* Live Status Tooltip */}
            <Html position={[(hoverCell.x - terrainSize / 2) * 4, wY + 2.0, (hoverCell.y - terrainSize / 2) * 4]} center>
              <div style={{
                background: statusOk ? 'rgba(0, 0, 0, 0.85)' : 'rgba(180, 0, 0, 0.95)',
                color: '#fff',
                padding: '5px 10px',
                borderRadius: '5px',
                fontSize: '13px',
                whiteSpace: 'nowrap',
                fontFamily: 'system-ui, sans-serif',
                pointerEvents: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                border: statusOk ? '1px solid #00ff00' : '1px solid #ff3333'
              }}>
                {statusOk 
                  ? `Ready: Faces ${layout.orientation.toUpperCase()}`
                  : (!landOk ? "⚠️ Cannot build on water/beach" : "⚠️ Needs Road Connection")
                }
              </div>
            </Html>
          </group>
        );
      })()}
    </group>
  );
}
