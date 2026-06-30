import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ColonySim } from '../sim';

interface R3FPlayerCarProps {
  sim: ColonySim;
}

export function R3FPlayerCar({ sim }: R3FPlayerCarProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    const carState = (sim.state as any).raceState?.car;
    if (carState) {
      // Assuming a flat Y for now, but in reality we'd pull from terrain height
      const y = 0.22; 
      // Need to map world coordinates if the sim provides raw grid X/Y
      // The old raceLayer used opts.wx(c.x) and opts.wz(c.y). 
      // In R3FPlanetRenderer, wx = (x - size/2) * 4
      const size = sim.state.terrain.size;
      const wx = (carState.x - size / 2) * 4;
      const wz = (carState.y - size / 2) * 4;
      
      groupRef.current.position.set(wx, y, wz);
      groupRef.current.rotation.set(0, -carState.heading, 0);
    }
  });

  // If the raceState isn't active, don't render the car
  if (!(sim.state as any).raceState?.car) return null;

  return (
    <group ref={groupRef} name="R3FPlayerCar">
      {/* Body */}
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[1.18, 0.34, 0.68]} />
        <meshStandardMaterial color={0xff4c52} roughness={0.5} metalness={0.12} emissive={0x451010} emissiveIntensity={0.35} />
      </mesh>
      
      {/* Cabin */}
      <mesh position={[-0.1, 0.52, 0]}>
        <boxGeometry args={[0.48, 0.28, 0.46]} />
        <meshStandardMaterial color={0xffd24d} roughness={0.42} metalness={0.08} emissive={0x3a2a08} emissiveIntensity={0.28} />
      </mesh>

      {/* Wheels */}
      {[-0.42, 0.42].map((x) => 
        [-0.38, 0.38].map((z) => (
          <mesh key={`wheel-${x}-${z}`} position={[x, 0.12, z]}>
            <boxGeometry args={[0.24, 0.24, 0.12]} />
            <meshStandardMaterial color={0x171820} roughness={0.72} metalness={0.04} />
          </mesh>
        ))
      )}
    </group>
  );
}
