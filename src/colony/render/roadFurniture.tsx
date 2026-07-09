// Spec 127 — the 3D street furniture (traffic lights, stop signs, stop lines), moved out of
// R3FRoadNetwork so the way-based junction renderer places them at REAL junctions only.
// Components are unchanged v3 features; only their placement source changed.
import React from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';

interface FurnitureProps {
  position: [number, number, number];
  rotationY: number;
}

export function StopSign({ position, rotationY }: FurnitureProps) {
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

export function TrafficLight({ position, rotationY }: FurnitureProps) {
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

export function StopLine({ position, rotationY }: FurnitureProps) {
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
