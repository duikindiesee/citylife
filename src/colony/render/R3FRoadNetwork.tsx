import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { Text } from '@react-three/drei';
import { useRoadNetwork } from '../stores/useRoadNetwork';
import type { ColonySim } from '../sim';

const RoadMask = {
  None: 0,
  N: 1,
  E: 2,
  S: 4,
  W: 8,
};

interface R3FRoadNetworkProps {
  sim: ColonySim;
  runtime?: any;
}

// 3D Stop Sign Component
interface StopSignProps {
  position: [number, number, number];
  rotationY: number;
}

function StopSign({ position, rotationY }: StopSignProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Thin black pole */}
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 2.2, 8]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
      </mesh>
      {/* Octagonal red sign board */}
      <group position={[0, 2.1, 0]}>
        <mesh rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.26, 0.26, 0.03, 8]} />
          <meshStandardMaterial color="#d63031" roughness={0.5} />
        </mesh>
        {/* White border circle */}
        <mesh position={[0, 0.016, 0]}>
          <ringGeometry args={[0.22, 0.24, 8]} />
          <meshStandardMaterial color="#ffffff" roughness={0.5} />
        </mesh>
        {/* White "STOP" text */}
        <Text
          position={[0, 0.017, 0]}
          rotation={[-Math.PI / 2, 0, Math.PI]}
          fontSize={0.12}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          STOP
        </Text>
      </group>
    </group>
  );
}

// 3D Traffic Light (Robot) Component with looping light cycle
interface TrafficLightProps {
  position: [number, number, number];
  rotationY: number;
}

function TrafficLight({ position, rotationY }: TrafficLightProps) {
  const [state, setState] = React.useState<'red' | 'amber' | 'green'>('red');
  
  React.useEffect(() => {
    const cycle = () => {
      setState(current => {
        if (current === 'red') return 'green';
        if (current === 'green') return 'amber';
        return 'red';
      });
    };
    
    // Vary cycles: green 4s, amber 1.5s, red 5s
    const delay = state === 'red' ? 5000 : (state === 'green' ? 4000 : 1500);
    const timer = setTimeout(cycle, delay);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Black pole */}
      <mesh position={[0, 1.3, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 2.6, 8]} />
        <meshStandardMaterial color="#2d3436" roughness={0.7} />
      </mesh>
      
      {/* Horizontal arm extending over the road */}
      <mesh position={[0.5, 2.5, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.04, 0.04, 1.0, 8]} />
        <meshStandardMaterial color="#2d3436" roughness={0.7} />
      </mesh>

      {/* Main traffic light box */}
      <mesh position={[1.0, 2.5, 0.1]}>
        <boxGeometry args={[0.2, 0.6, 0.2]} />
        <meshStandardMaterial color="#ffeaa7" roughness={0.5} metalness={0.1} />
      </mesh>

      {/* Light visor hood (black backing) */}
      <mesh position={[1.0, 2.5, 0.08]}>
        <boxGeometry args={[0.24, 0.64, 0.02]} />
        <meshStandardMaterial color="#2d3436" roughness={0.9} />
      </mesh>

      {/* Red Light */}
      <mesh position={[1.0, 2.68, 0.21]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial 
          color={state === 'red' ? '#ff7675' : '#2d3436'} 
          emissive={state === 'red' ? '#ff7675' : '#000000'}
          emissiveIntensity={state === 'red' ? 1.8 : 0}
        />
      </mesh>

      {/* Amber Light */}
      <mesh position={[1.0, 2.5, 0.21]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial 
          color={state === 'amber' ? '#ffeaa7' : '#2d3436'} 
          emissive={state === 'amber' ? '#ffeaa7' : '#000000'}
          emissiveIntensity={state === 'amber' ? 1.8 : 0}
        />
      </mesh>

      {/* Green Light */}
      <mesh position={[1.0, 2.32, 0.21]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial 
          color={state === 'green' ? '#55efc4' : '#2d3436'} 
          emissive={state === 'green' ? '#55efc4' : '#000000'}
          emissiveIntensity={state === 'green' ? 1.8 : 0}
        />
      </mesh>
    </group>
  );
}

// 3D Stop Line Decal Component
interface StopLineProps {
  position: [number, number, number];
  rotationY: number;
}

function StopLine({ position, rotationY }: StopLineProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Solid white paint line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.5, 0.25]} />
        <meshStandardMaterial color="#ffffff" roughness={0.9} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-4} />
      </mesh>
      {/* "STOP" paint on the road surface */}
      <Text
        position={[0, 0.015, 0.45]}
        rotation={[-Math.PI / 2, 0, Math.PI]}
        fontSize={0.24}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
      >
        STOP
      </Text>
    </group>
  );
}

import {
  isPitchableNS,
  isPitchableEW,
  isFlatRoad,
  roadEdgeHeight,
  pitchCellHalves,
} from './roadPitch';

// Bilinear interpolation for fractional grid coordinates to prevent NaN spiky geometries.
// Exported (spec 122) so the bus rides the SAME surface the road tiles render on — the max
// over a small bilinear footprint — instead of the raw cell-center terrain height, which
// floats/sinks the coach on slopes.
export function getSmoothRoadY(terrain: any, x: number, y: number): number {
  const size = terrain.size;
  const cl = (v: number) => Math.max(0, Math.min(size - 1, v));
  
  const bil = (fx: number, fy: number): number => {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = terrain.worldY(cl(x0), cl(y0));
    const b = terrain.worldY(cl(x0 + 1), cl(y0));
    const c = terrain.worldY(cl(x0), cl(y0 + 1));
    const d = terrain.worldY(cl(x0 + 1), cl(y0 + 1));
    return (
      a * (1 - tx) * (1 - ty) +
      b * tx * (1 - ty) +
      c * (1 - tx) * ty +
      d * tx * ty
    );
  };

  let mx = -9999;
  // Narrower search footprint (from -0.6 to 0.6) matching the 4m wide road width.
  // We use max height so the road never clips into the hillside (no diagonal tearing).
  // Integer loop indices: the old `dx += 0.2` float loop accumulated to 0.6000000000000001
  // and silently sampled an asymmetric -0.6..+0.4 footprint (spec 118 verify finding).
  for (let ix = -3; ix <= 3; ix++) {
    for (let iy = -3; iy <= 3; iy++) {
      const h = bil(x + ix * 0.2, y + iy * 0.2);
      if (h > mx) mx = h;
    }
  }
  return mx;
}

export function R3FRoadNetwork({ sim, runtime }: R3FRoadNetworkProps) {
  const tiles = useRoadNetwork(state => state.tiles);

  const roadBlocks = useMemo(() => {
    const elements = [];
    const terrain = sim.state.terrain;
    const N = terrain.size;
    
    // Spec 118 — shared boundary heights. Both sides of every cell boundary compute the
    // SAME edge height (roadEdgeHeight is symmetric), and each pitched segment lands its
    // ends exactly on those heights — no more steps between segments at grade changes.
    const surfaceH = (x: number, y: number) => getSmoothRoadY(terrain, x, y);
    const neighborInfo = (x: number, y: number): { h: number; flat: boolean } | null => {
      const t2 = tiles[`${x},${y}`];
      if (!t2) return null;
      // Cul-de-sacs render as flat bulbs at their own height — treat as flat neighbors.
      const flat = t2.type === 'culdesac' || isFlatRoad(t2.mask || 0);
      return { h: surfaceH(x, y), flat };
    };

    for (const k in tiles) {
      const tile = tiles[k];
      if (tile.type === 'culdesac') continue;

      const wX = (tile.x - N / 2) * 4;
      const wZ = (tile.y - N / 2) * 4;

      const mask = tile.mask || 0;
      const isGravel = tile.type === 'gravel';
      const selfH = surfaceH(tile.x, tile.y);

      const surfaceMat = (
        <meshStandardMaterial
          color={isGravel ? "#8d6e63" : "#3d424b"}
          roughness={isGravel ? 0.98 : 0.88}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      );
      const curbMat = <meshStandardMaterial color="#e8ecf2" roughness={0.6} />;
      const lineMat = (
        <meshStandardMaterial color="#f1c40f" roughness={0.8} polygonOffset polygonOffsetFactor={-2} />
      );

      // Pitched straights render as TWO half-segments meeting at the CELL'S OWN height —
      // one straight box edge-to-edge dives under the surface on convex crests (spec 118
      // adversarial verify). Outer ends still land exactly on the shared edge heights.
      // N-S roads pitch up/down between their SHARED north/south edges — never roll.
      if (isPitchableNS(mask)) {
        const nN = neighborInfo(tile.x, tile.y - 1);
        const nS = neighborInfo(tile.x, tile.y + 1);
        const northEdge = roadEdgeHeight(selfH, false, nN ? nN.h : null, nN ? nN.flat : false);
        const southEdge = roadEdgeHeight(selfH, false, nS ? nS.h : null, nS ? nS.flat : false);
        const { inHalf: north, outHalf: south } = pitchCellHalves(northEdge, selfH, southEdge);

        elements.push(
          <group key={`road-block-${k}`} position={[wX, selfH + 0.05, wZ]}>
            <group position={[0, north.centerY - selfH, -1]} rotation={[north.rot, 0, 0]}>
              <mesh>
                <boxGeometry args={[4, 0.15, north.length]} />
                {surfaceMat}
              </mesh>
              {!isGravel && !(mask & RoadMask.E) && (
                <mesh position={[1.9, 0.08, 0]}><boxGeometry args={[0.2, 0.08, north.length]} />{curbMat}</mesh>
              )}
              {!isGravel && !(mask & RoadMask.W) && (
                <mesh position={[-1.9, 0.08, 0]}><boxGeometry args={[0.2, 0.08, north.length]} />{curbMat}</mesh>
              )}
              {!isGravel && !(mask & RoadMask.N) && (
                <mesh position={[0, 0.08, -(north.length / 2 - 0.1)]}><boxGeometry args={[4, 0.08, 0.2]} />{curbMat}</mesh>
              )}
              {!isGravel && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
                  <planeGeometry args={[0.15, north.length]} />
                  {lineMat}
                </mesh>
              )}
            </group>
            <group position={[0, south.centerY - selfH, 1]} rotation={[south.rot, 0, 0]}>
              <mesh>
                <boxGeometry args={[4, 0.15, south.length]} />
                {surfaceMat}
              </mesh>
              {!isGravel && !(mask & RoadMask.E) && (
                <mesh position={[1.9, 0.08, 0]}><boxGeometry args={[0.2, 0.08, south.length]} />{curbMat}</mesh>
              )}
              {!isGravel && !(mask & RoadMask.W) && (
                <mesh position={[-1.9, 0.08, 0]}><boxGeometry args={[0.2, 0.08, south.length]} />{curbMat}</mesh>
              )}
              {!isGravel && !(mask & RoadMask.S) && (
                <mesh position={[0, 0.08, south.length / 2 - 0.1]}><boxGeometry args={[4, 0.08, 0.2]} />{curbMat}</mesh>
              )}
              {!isGravel && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
                  <planeGeometry args={[0.15, south.length]} />
                  {lineMat}
                </mesh>
              )}
            </group>
          </group>
        );
        continue;
      }
      // E-W roads pitch up/down between their SHARED east/west edges — never roll.
      if (isPitchableEW(mask)) {
        const nE = neighborInfo(tile.x + 1, tile.y);
        const nW = neighborInfo(tile.x - 1, tile.y);
        const eastEdge = roadEdgeHeight(selfH, false, nE ? nE.h : null, nE ? nE.flat : false);
        const westEdge = roadEdgeHeight(selfH, false, nW ? nW.h : null, nW ? nW.flat : false);
        const { inHalf: east, outHalf: west } = pitchCellHalves(eastEdge, selfH, westEdge);

        elements.push(
          <group key={`road-block-${k}`} position={[wX, selfH + 0.05, wZ]}>
            <group position={[1, east.centerY - selfH, 0]} rotation={[0, 0, east.rot]}>
              <mesh>
                <boxGeometry args={[east.length, 0.15, 4]} />
                {surfaceMat}
              </mesh>
              {!isGravel && !(mask & RoadMask.N) && (
                <mesh position={[0, 0.08, -1.9]}><boxGeometry args={[east.length, 0.08, 0.2]} />{curbMat}</mesh>
              )}
              {!isGravel && !(mask & RoadMask.S) && (
                <mesh position={[0, 0.08, 1.9]}><boxGeometry args={[east.length, 0.08, 0.2]} />{curbMat}</mesh>
              )}
              {!isGravel && !(mask & RoadMask.E) && (
                <mesh position={[east.length / 2 - 0.1, 0.08, 0]}><boxGeometry args={[0.2, 0.08, 4]} />{curbMat}</mesh>
              )}
              {!isGravel && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
                  <planeGeometry args={[east.length, 0.15]} />
                  {lineMat}
                </mesh>
              )}
            </group>
            <group position={[-1, west.centerY - selfH, 0]} rotation={[0, 0, west.rot]}>
              <mesh>
                <boxGeometry args={[west.length, 0.15, 4]} />
                {surfaceMat}
              </mesh>
              {!isGravel && !(mask & RoadMask.N) && (
                <mesh position={[0, 0.08, -1.9]}><boxGeometry args={[west.length, 0.08, 0.2]} />{curbMat}</mesh>
              )}
              {!isGravel && !(mask & RoadMask.S) && (
                <mesh position={[0, 0.08, 1.9]}><boxGeometry args={[west.length, 0.08, 0.2]} />{curbMat}</mesh>
              )}
              {!isGravel && !(mask & RoadMask.W) && (
                <mesh position={[-(west.length / 2 - 0.1), 0.08, 0]}><boxGeometry args={[0.2, 0.08, 4]} />{curbMat}</mesh>
              )}
              {!isGravel && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
                  <planeGeometry args={[west.length, 0.15]} />
                  {lineMat}
                </mesh>
              )}
            </group>
          </group>
        );
        continue;
      }

      // Intersections (3-way, 4-way, corners, isolated cells) stay perfectly flat to
      // connect cleanly — their pitched neighbors bend to meet THEM (flat wins).
      const wY = selfH + 0.05;

      // Dynamic Curbs (streets only, no connections!)
      const curbs = [];
      if (!isGravel) {
        if (!(mask & RoadMask.N)) {
          curbs.push(
            <mesh key="curb-n" position={[0, 0.08, -1.9]}>
              <boxGeometry args={[4, 0.08, 0.2]} />
              <meshStandardMaterial color="#e8ecf2" roughness={0.6} />
            </mesh>
          );
        }
        if (!(mask & RoadMask.E)) {
          curbs.push(
            <mesh key="curb-e" position={[1.9, 0.08, 0]}>
              <boxGeometry args={[0.2, 0.08, 4]} />
              <meshStandardMaterial color="#e8ecf2" roughness={0.6} />
            </mesh>
          );
        }
        if (!(mask & RoadMask.S)) {
          curbs.push(
            <mesh key="curb-s" position={[0, 0.08, 1.9]}>
              <boxGeometry args={[4, 0.08, 0.2]} />
              <meshStandardMaterial color="#e8ecf2" roughness={0.6} />
            </mesh>
          );
        }
        if (!(mask & RoadMask.W)) {
          curbs.push(
            <mesh key="curb-w" position={[-1.9, 0.08, 0]}>
              <boxGeometry args={[0.2, 0.08, 4]} />
              <meshStandardMaterial color="#e8ecf2" roughness={0.6} />
            </mesh>
          );
        }
      }

      // Yellow center lines (isolated cells only — straights carry theirs per half)
      const lines = [];
      if (!isGravel && mask === 0) {
        lines.push(
          <mesh key="line-ns" rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
            <planeGeometry args={[0.15, 4]} />
            <meshStandardMaterial color="#f1c40f" roughness={0.8} polygonOffset polygonOffsetFactor={-2} />
          </mesh>
        );
      }
      
      elements.push(
        <group key={`road-block-${k}`} position={[wX, wY, wZ]}>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[4, 0.15, 4]} />
            <meshStandardMaterial 
              color={isGravel ? "#8d6e63" : "#3d424b"} 
              roughness={isGravel ? 0.98 : 0.88} 
              polygonOffset 
              polygonOffsetFactor={-1} 
            />
          </mesh>
          {curbs}
          {lines}
        </group>
      );
    }
    
    return elements;
  }, [tiles, sim]);

  const culDeSacs = useMemo(() => {
    const elements = [];
    const terrain = sim.state.terrain;
    const N = terrain.size;
    
    const keys = Object.keys(tiles);

    for (const k of keys) {
      const tile = tiles[k];
      if (tile.type === 'culdesac') {
        const wX = (tile.x - N / 2) * 4;
        const wZ = (tile.y - N / 2) * 4;
        const wY = getSmoothRoadY(terrain, tile.x, tile.y) + 0.18;
        
        elements.push(
          <group key={`culdesac-${k}`} position={[wX, wY, wZ]}>
            {/* Asphalt turnaround bulb */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0, 3.2]} />
              <meshStandardMaterial color="#595f6a" roughness={0.92} metalness={0.02} side={THREE.DoubleSide} />
            </mesh>
            {/* White outer curb */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
              <ringGeometry args={[3.1, 3.3]} />
              <meshStandardMaterial color="#e8ecf2" roughness={0.6} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      }
    }
    return elements;
  }, [tiles, sim]);

  // Analyze topology and place stop signs, stop lines, and traffic lights dynamically
  const junctionDecorations = useMemo(() => {
    const elements = [];
    const terrain = sim.state.terrain;
    const N = terrain.size;
    
    const keys = Object.keys(tiles);
    const toKey = (x: number, y: number) => `${x},${y}`;
    
    const getJunctionNeighbors = (x: number, y: number) => {
      const list = [];
      if (tiles[toKey(x, y - 1)]) list.push('N');
      if (tiles[toKey(x + 1, y)]) list.push('E');
      if (tiles[toKey(x, y + 1)]) list.push('S');
      if (tiles[toKey(x - 1, y)]) list.push('W');
      return list;
    };

    for (const k of keys) {
      const tile = tiles[k];
      if (tile.type === 'culdesac') continue;
      
      const neighbors = getJunctionNeighbors(tile.x, tile.y);
      const wX = (tile.x - N / 2) * 4;
      const wZ = (tile.y - N / 2) * 4;
      const wY = getSmoothRoadY(terrain, tile.x, tile.y);
      
      if (neighbors.length === 4) {
        // 4-way intersection: Render 3D Traffic Lights (Robots) at all 4 corners + 4 stop lines!
        elements.push(
          <group key={`4way-${k}`}>
            {/* Traffic Lights (Robots) */}
            <TrafficLight position={[wX + 2.2, wY, wZ - 2.2]} rotationY={Math.PI} />
            <TrafficLight position={[wX + 2.2, wY, wZ + 2.2]} rotationY={-Math.PI / 2} />
            <TrafficLight position={[wX - 2.2, wY, wZ + 2.2]} rotationY={0} />
            <TrafficLight position={[wX - 2.2, wY, wZ - 2.2]} rotationY={Math.PI / 2} />
            
            {/* Stop Lines on road surface */}
            <StopLine position={[wX + 1.0, wY + 0.19, wZ - 1.8]} rotationY={0} />
            <StopLine position={[wX + 1.8, wY + 0.19, wZ + 1.0]} rotationY={-Math.PI / 2} />
            <StopLine position={[wX - 1.0, wY + 0.19, wZ + 1.8]} rotationY={Math.PI} />
            <StopLine position={[wX - 1.8, wY + 0.19, wZ - 1.0]} rotationY={Math.PI / 2} />
          </group>
        );
      } else if (neighbors.length === 3) {
        // T-junction: Render a Stop Sign and a Stop Line facing the terminating road
        const hasN = neighbors.includes('N');
        const hasE = neighbors.includes('E');
        const hasS = neighbors.includes('S');
        const hasW = neighbors.includes('W');
        
        if (!hasN) {
          // Terminating road comes from South
          elements.push(
            <group key={`t-junction-${k}`}>
              <StopSign position={[wX - 2.2, wY, wZ + 2.2]} rotationY={0} />
              <StopLine position={[wX - 1.0, wY + 0.19, wZ + 1.8]} rotationY={Math.PI} />
            </group>
          );
        } else if (!hasS) {
          // Terminating road comes from North
          elements.push(
            <group key={`t-junction-${k}`}>
              <StopSign position={[wX + 2.2, wY, wZ - 2.2]} rotationY={Math.PI} />
              <StopLine position={[wX + 1.0, wY + 0.19, wZ - 1.8]} rotationY={0} />
            </group>
          );
        } else if (!hasE) {
          // Terminating road comes from West
          elements.push(
            <group key={`t-junction-${k}`}>
              <StopSign position={[wX - 2.2, wY, wZ - 2.2]} rotationY={Math.PI / 2} />
              <StopLine position={[wX - 1.8, wY + 0.19, wZ - 1.0]} rotationY={Math.PI / 2} />
            </group>
          );
        } else if (!hasW) {
          // Terminating road comes from East
          elements.push(
            <group key={`t-junction-${k}`}>
              <StopSign position={[wX + 2.2, wY, wZ + 2.2]} rotationY={-Math.PI / 2} />
              <StopLine position={[wX + 1.8, wY + 0.19, wZ + 1.0]} rotationY={-Math.PI / 2} />
            </group>
          );
        }
      }
    }
    return elements;
  }, [tiles, sim]);

  return (
    <group name="RoadNetwork">
      <RigidBody type="fixed" colliders="trimesh">
        {roadBlocks}
        {culDeSacs}
      </RigidBody>
      {junctionDecorations}
    </group>
  );
}
