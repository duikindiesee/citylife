import { leveledWorldY } from './terrainLeveling';
import React, { useEffect, useMemo } from 'react';
import type { ColonySim } from '../sim';
import { buildCarMesh } from '../car/carMesh';
import { getSmoothRoadY } from './roadSurface';
import { ROAD_RIBBON_LIFT } from './roadRibbon';
import { disposeDeep } from './disposeDeep';
import { useSimSignal, type SimBridge } from './useSimSignal';
import { operatorCarSignature } from './simSignals';

// Spec 131 — the signed-in operator's tuned car parked at their home cell (legacy
// setOperatorCar). The runtime attaches { spec, cell } on sim.state (the raceState
// precedent); this builds the shared buildCarMesh and seats it on the road surface when
// parked on a road cell, else on the ground.

interface R3FOperatorCarProps {
  sim: ColonySim;
  runtime?: SimBridge;
  /** Spec 134 - the leveled-ground map: pads, graded roads and landscape edits reshape
   *  the visible mesh, and anything standing on the ground must stand on THAT surface. */
  terrainLevel?: ReadonlyMap<number, number> | null;
}

export function R3FOperatorCar({ sim, runtime, terrainLevel }: R3FOperatorCarProps) {
  const sig = useSimSignal(runtime, () => operatorCarSignature(sim.state));

  const built = useMemo(() => {
    const parked = sim.state.operatorCar;
    if (!parked) return null;
    const { spec, cell } = parked;
    const t = sim.state.terrain;
    const N = t.size;
    const g = buildCarMesh(spec);
    const onRoad = sim.state.roadSet.has(`${Math.round(cell.x)},${Math.round(cell.y)}`);
    const y = onRoad
      ? Math.max(0, getSmoothRoadY(t, cell.x, cell.y)) + ROAD_RIBBON_LIFT
      : Math.max(0, leveledWorldY(t, terrainLevel, Math.round(cell.x), Math.round(cell.y))) + 0.02;
    g.position.set((cell.x - N / 2) * 4, y, (cell.y - N / 2) * 4);
    g.name = 'operator-car';
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, sig, terrainLevel]);

  // Spec 119 — the superseded car mesh is disposed on every swap and on unmount.
  useEffect(() => () => {
    if (built) disposeDeep(built);
  }, [built]);

  if (!built) return null;
  return <primitive object={built} />;
}
