import React, { useEffect, useMemo } from 'react';
import type { ColonySim } from '../sim';
import { buildRoadRibbons } from './roadRibbon';
import { getSmoothRoadY } from './roadSurface';
import { findJunctionZones, junctionFurniture, type JunctionZone } from './roadJunctions';
import { disposeDeep } from './disposeDeep';
import { useSimSignal, type SimBridge } from './useSimSignal';
import { roadwaySignature } from './simSignals';
import { TrafficLight, StopSign, StopLine } from './roadFurniture';

// Spec 127 — the smooth ribbon road surface, ported from the legacy renderer (spec 088). The
// road CELL data is a deliberately ~3-cell-wide carriageway for traffic/pathing; rendering a
// box per cell made every road read as 2-3 parallel bordered strips and cost ~100k scene
// nodes. The ribbon extrudes ONE terrain-draped strip per road centre-line (sim.state.roadWays,
// attached by the runtime — the raceState precedent), with dashes, edge lines and crosswalks
// baked into ~4 merged meshes. Junctions get a flat slab capping the coplanar ribbon overlap
// (which z-fights on main) plus way-based street furniture — real crossings only, not the
// per-cell false positives of the widened grid. Traffic, the bus and the rally still drive
// the cells underneath; the data is untouched.

interface R3FRoadRibbonsProps {
  sim: ColonySim;
  runtime?: SimBridge;
}

/** How far the junction slab sits above the road height — above the ribbon surface (0.18)
 *  so it caps the overlap, below the painted markings (0.23+, suppressed at junctions anyway). */
const SLAB_LIFT = 0.19;
const SLAB_THICKNESS = 0.05;

export function R3FRoadRibbons({ sim, runtime }: R3FRoadRibbonsProps) {
  const sig = useSimSignal(runtime, () => roadwaySignature(sim.state));

  const built = useMemo(() => {
    const ways = sim.state.roadWays ?? [];
    if (!ways.length) return null;
    const terrain = sim.state.terrain;
    const N = terrain.size;
    const wx = (x: number) => (x - N / 2) * 4;
    const wz = (y: number) => (y - N / 2) * 4;
    const roadY = (x: number, y: number) => getSmoothRoadY(terrain, x, y);
    const { group } = buildRoadRibbons(ways, { terrain, wx, wz, roadY });
    const zones = findJunctionZones(ways);
    // The slab height: the road surface's own max over the zone, so the slab stays proud of
    // the ribbon across the whole junction (intersections are flat — V3 constitution).
    const zoneY = (z: JunctionZone) => {
      let mx = 0;
      const r = Math.ceil(z.half);
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++) {
          const h = roadY(z.cx + dx, z.cy + dy);
          if (h > mx) mx = h;
        }
      return Math.max(0, mx);
    };
    return { group, zones: zones.map((z) => ({ ...z, wY: zoneY(z) })), wx, wz };
    // sig is the rebuild trigger for the mutable sim.state (dead-memo rule).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, sig]);

  // Spec 119 — the superseded ribbon group (4 merged geometries + materials) must be
  // disposed on every rebuild and on unmount, or each road edit leaks its GPU buffers.
  useEffect(() => () => {
    if (built) disposeDeep(built.group);
  }, [built]);

  if (!built) return null;
  const { wx, wz } = built;

  return (
    <group name="RoadRibbonsLayer">
      <primitive object={built.group} />
      <group name="RoadJunctions">
        {built.zones.map((z, i) => {
          const slabY = z.wY + SLAB_LIFT;
          const slabTop = slabY + SLAB_THICKNESS / 2;
          const size = z.half * 2 * 4;
          return (
            <group key={`junction-${i}`}>
              {/* Flat junction slab — one coplanar pad of open tarmac capping the ribbon
                  overlap, so crossings read crisp instead of z-fighting (the broken look on
                  main this hybrid replaces). */}
              <mesh position={[wx(z.cx), slabY, wz(z.cy)]}>
                <boxGeometry args={[size, SLAB_THICKNESS, size]} />
                <meshStandardMaterial color="#5d636e" roughness={0.9} metalness={0.02} />
              </mesh>
              {junctionFurniture(z).map((f, j) => {
                const pos: [number, number, number] =
                  f.kind === 'stopline'
                    ? [wx(f.x), slabTop + 0.012, wz(f.y)]
                    : [wx(f.x), slabTop, wz(f.y)];
                if (f.kind === 'light')
                  return <TrafficLight key={`f-${i}-${j}`} position={pos} rotationY={f.rotY} />;
                if (f.kind === 'stopsign')
                  return <StopSign key={`f-${i}-${j}`} position={pos} rotationY={f.rotY} />;
                return <StopLine key={`f-${i}-${j}`} position={pos} rotationY={f.rotY} />;
              })}
            </group>
          );
        })}
      </group>
    </group>
  );
}
