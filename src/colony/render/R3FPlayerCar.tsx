import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ColonySim } from "../sim";

interface R3FPlayerCarProps {
  sim: ColonySim;
}

export function R3FPlayerCar({ sim }: R3FPlayerCarProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Spec 124 — the group ALWAYS mounts and its visibility is toggled per-frame from the
  // mutable raceState. The old `return null` gate was evaluated at React-render time with no
  // reactivity trigger, so the car never appeared when a race started mid-session (the
  // dead-memo class). Now it shows the instant sim.state.raceState.car exists.
  useFrame(() => {
    if (!groupRef.current) return;
    const carState = sim.state.raceState?.car;
    groupRef.current.visible = !!carState;
    if (carState) {
      // Spec 120 — snap the car to the terrain surface (the old hardcoded y=0.22 floated
      // on hills and sank in valleys). Wheel clearance rides on top of the ground height.
      const size = sim.state.terrain.size;
      const ground = Math.max(
        sim.state.terrain.worldY(
          Math.round(carState.x),
          Math.round(carState.y),
        ),
        0,
      );
      const wx = (carState.x - size / 2) * 4;
      const wz = (carState.y - size / 2) * 4;

      groupRef.current.position.set(wx, ground, wz);
      groupRef.current.rotation.set(0, -carState.heading, 0);
    }
  });

  return (
    <group ref={groupRef} name="R3FPlayerCar" visible={false}>
      {/* Body */}
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[1.18, 0.34, 0.68]} />
        <meshStandardMaterial
          color={0xff4c52}
          roughness={0.5}
          metalness={0.12}
          emissive={0x451010}
          emissiveIntensity={0.35}
        />
      </mesh>

      {/* Cabin */}
      <mesh position={[-0.1, 0.52, 0]}>
        <boxGeometry args={[0.48, 0.28, 0.46]} />
        <meshStandardMaterial
          color={0xffd24d}
          roughness={0.42}
          metalness={0.08}
          emissive={0x3a2a08}
          emissiveIntensity={0.28}
        />
      </mesh>

      {/* Wheels */}
      {[-0.42, 0.42].map((x) =>
        [-0.38, 0.38].map((z) => (
          <mesh key={`wheel-${x}-${z}`} position={[x, 0.12, z]}>
            <boxGeometry args={[0.24, 0.24, 0.12]} />
            <meshStandardMaterial
              color={0x171820}
              roughness={0.72}
              metalness={0.04}
            />
          </mesh>
        )),
      )}
    </group>
  );
}
