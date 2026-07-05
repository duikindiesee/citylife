import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ColonySim } from '../sim';
import type { BusRoute } from '../transit/busRoute';
import { buildBusLayer, type BusLayer } from './busLayer';

// Spec 122 — the town bus (spec 088), R3F port of the legacy setBusRoute path. The route
// is deterministic runtime state (runtime.busRoute, computed once at boot from the road
// graph + hood anchors), so this component reads it directly — the same idiom the road
// network uses — rather than the imperative setBusRoute call (which stays a no-op stub on
// the R3F renderer). buildBusLayer is the existing, already-extracted mesh + animation
// builder; this component owns its lifecycle: build when the route appears, advance it in
// useFrame, dispose on unmount or route change.

interface R3FBusProps {
  sim: ColonySim;
  runtime?: { busRoute?: BusRoute | null } | null;
}

export function R3FBus({ sim, runtime }: R3FBusProps) {
  const containerRef = useRef<THREE.Group>(null);
  const layerRef = useRef<BusLayer | null>(null);
  const builtRoute = useRef<BusRoute | null>(null);

  const world = useMemo(() => {
    const size = sim.state.terrain.size;
    return {
      wx: (x: number) => (x - size / 2) * 4,
      wz: (y: number) => (y - size / 2) * 4,
      roadY: (x: number, y: number) =>
        Math.max(0, sim.state.terrain.worldY(Math.round(x), Math.round(y))),
    };
  }, [sim]);

  const clearLayer = () => {
    if (layerRef.current) {
      containerRef.current?.remove(layerRef.current.group);
      layerRef.current.dispose();
      layerRef.current = null;
    }
  };

  // Free the bus meshes on unmount.
  useEffect(() => () => clearLayer(), []);

  useFrame((state) => {
    const route = runtime?.busRoute ?? null;
    if (route !== builtRoute.current) {
      // Route appeared or changed — rebuild the layer.
      clearLayer();
      builtRoute.current = route;
      if (route && containerRef.current) {
        const layer = buildBusLayer({
          terrain: sim.state.terrain,
          route,
          wx: world.wx,
          wz: world.wz,
          roadY: world.roadY,
        });
        if (layer) {
          layerRef.current = layer;
          containerRef.current.add(layer.group);
        }
      }
    }
    layerRef.current?.update(state.clock.elapsedTime * 1000);
  });

  return <group ref={containerRef} name="bus" />;
}
