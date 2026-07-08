import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ColonySim } from '../sim';
import type { RaceState } from '../racing/race';
import { buildRaceLayer, type RaceLayer } from './raceLayer';
import { getSmoothRoadY } from './R3FRoadNetwork';

// Spec 124 — the Road Rally course (spec 087), R3F port of the legacy setRaceState path. The
// race is runtime state now attached to sim.state.raceState (the runtime mirrors it at start,
// on each raceTick, and on exit — the same fix that made the player's racing car in
// R3FPlayerCar actually render). This component reads it directly, the same idiom the bus
// uses, and wraps the existing buildRaceLayer (track + checkpoint gates). The player's racing
// car is drawn separately by R3FPlayerCar; the chase camera is a follow-up slice.

interface R3FRaceProps {
  sim: ColonySim;
}

export function R3FRace({ sim }: R3FRaceProps) {
  const containerRef = useRef<THREE.Group>(null);
  const layerRef = useRef<RaceLayer | null>(null);
  const builtTrack = useRef<RaceState['track'] | null>(null);

  const world = useMemo(() => {
    const size = sim.state.terrain.size;
    return {
      wx: (x: number) => (x - size / 2) * 4,
      wz: (y: number) => (y - size / 2) * 4,
      // Ride the rendered road surface (getSmoothRoadY, as the road tiles and the bus use)
      // so the course sits on the road on slopes instead of the raw cell-center terrain.
      roadSurfaceY: (x: number, y: number) => Math.max(0, getSmoothRoadY(sim.state.terrain, x, y)),
    };
  }, [sim]);

  const clearLayer = () => {
    if (layerRef.current) {
      containerRef.current?.remove(layerRef.current.group);
      layerRef.current.dispose();
      layerRef.current = null;
    }
    builtTrack.current = null;
  };

  useEffect(() => () => clearLayer(), []);

  useFrame((state) => {
    const race = sim.state.raceState ?? null;
    const active = race != null && race.mode !== 'idle';

    if (!active) {
      // Race ended or never started — tear the course down.
      if (layerRef.current) clearLayer();
      return;
    }

    // (Re)build the course when the track changes (or first appears).
    if (race.track !== builtTrack.current) {
      clearLayer();
      builtTrack.current = race.track;
      if (containerRef.current) {
        const layer = buildRaceLayer({
          terrain: sim.state.terrain,
          track: race.track,
          wx: world.wx,
          wz: world.wz,
          roadSurfaceY: world.roadSurfaceY,
        });
        if (layer) {
          layerRef.current = layer;
          containerRef.current.add(layer.group);
        }
      }
    }

    layerRef.current?.update(race, state.clock.elapsedTime * 1000);
  });

  return <group ref={containerRef} name="race" />;
}
