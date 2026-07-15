import React, { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildFoam, FoamLayer } from "./foamLayer";
import { ColonySim } from "../sim";

export function R3FFoam({ sim }: { sim: ColonySim }) {
  const groupRef = useRef<THREE.Group>(null);
  const foamLayerRef = useRef<FoamLayer | null>(null);

  useEffect(() => {
    if (!groupRef.current) return;

    const N = sim.state.terrain.size;
    const wx = (x: number) => (x - N / 2) * 4;
    const wz = (y: number) => (y - N / 2) * 4;

    const layer = buildFoam({ terrain: sim.state.terrain, wx, wz });
    if (layer) {
      groupRef.current.add(layer.group);
      foamLayerRef.current = layer;
    }

    return () => {
      if (layer) {
        layer.dispose();
        foamLayerRef.current = null;
      }
    };
  }, [sim.state.terrain]);

  useFrame((state) => {
    if (foamLayerRef.current) {
      foamLayerRef.current.update(state.clock.elapsedTime * 1000);
    }
  });

  return <group ref={groupRef} />;
}
