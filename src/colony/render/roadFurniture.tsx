// Spec 127/137 — the 3D street furniture (traffic lights, stop signs) at REAL junctions.
// Spec 137 rebuilt both for the first-person eye:
//  - The STOP board used to be a cylinder lying FACE-UP — from eye height it was a 3 cm
//    red line. It now stands upright, faces the approaching driver, and is SA-R1 sized.
//  - Traffic lights were toy-scale (2.6 m pole, 1 m mast) beside 16 m carriageways, and
//    every light ran its own setTimeout starting at red — all approaches turned green
//    together. Signals now scale with the lane, and phase-lock to the shared frame clock:
//    arms on one axis (group A) hold green while the crossing axis (group B) holds red,
//    with an all-red inter-green, offset per junction so the city doesn't blink in unison.
// Stop LINES are painted road geometry now — baked into the merged RoadJunctionPaint mesh
// by junctionCap.capStopBars (lane-wide, arm-aligned), not a drei component.
import React from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';

interface FurnitureProps {
  position: [number, number, number];
  rotationY: number;
}

export function StopSign({ position, rotationY }: FurnitureProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Pole */}
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 2.4, 8]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
      </mesh>
      {/* Octagonal board, UPRIGHT: cylinder axis rotated onto Z so the octagon FACE is
          vertical and looks along local +Z — straight at the approaching driver. */}
      <group position={[0, 2.85, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh>
          <cylinderGeometry args={[0.45, 0.45, 0.04, 8]} />
          <meshStandardMaterial color="#d63031" roughness={0.5} />
        </mesh>
      </group>
      <mesh position={[0, 2.85, 0.025]}>
        <ringGeometry args={[0.38, 0.42, 8]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} />
      </mesh>
      <Text
        position={[0, 2.85, 0.03]}
        fontSize={0.22}
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

interface TrafficLightProps extends FurnitureProps {
  /** The served approach's half-width in metres — the mast reaches over its lane. */
  laneHalfM: number;
  /** Phase group: A-axis arms are green while B-axis arms are red, and vice versa. */
  group: 'A' | 'B';
  /** Per-junction cycle offset in seconds (0..CYCLE). */
  phase: number;
}

const CYCLE = 16;
const OFF = new THREE.Color('#2d3436');
const RED = new THREE.Color('#ff7675');
const AMBER = new THREE.Color('#ffeaa7');
const GREEN = new THREE.Color('#55efc4');

/** Signal state for one group at cycle time t: green [0,6.5) amber [6.5,8) red [8,16),
 *  group B shifted half a cycle — an all-red inter-green in both changeovers. Exported
 *  pure for the phasing unit test (never both groups green, both red at changeover). */
export function signalState(t: number, group: 'A' | 'B'): 'red' | 'amber' | 'green' {
  const local = group === 'A' ? t : (t + CYCLE / 2) % CYCLE;
  if (local < 6.5) return 'green';
  if (local < 8) return 'amber';
  return 'red';
}

export function TrafficLight({ position, rotationY, laneHalfM, group, phase }: TrafficLightProps) {
  const mast = Math.min(6, laneHalfM / 2 + 1.6);
  const redRef = React.useRef<THREE.MeshStandardMaterial>(null);
  const amberRef = React.useRef<THREE.MeshStandardMaterial>(null);
  const greenRef = React.useRef<THREE.MeshStandardMaterial>(null);

  // Imperative lamp driving off the shared clock — no per-light timers, no state churn.
  useFrame(({ clock }) => {
    const state = signalState((clock.elapsedTime + phase) % CYCLE, group);
    const set = (
      ref: React.RefObject<THREE.MeshStandardMaterial | null>,
      lit: boolean,
      color: THREE.Color,
    ) => {
      const m = ref.current;
      if (!m) return;
      m.color.copy(lit ? color : OFF);
      m.emissive.copy(lit ? color : OFF);
      m.emissiveIntensity = lit ? 1.8 : 0;
    };
    set(redRef, state === 'red', RED);
    set(amberRef, state === 'amber', AMBER);
    set(greenRef, state === 'green', GREEN);
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Pole — 5.8 m, believable beside a 16 m carriageway */}
      <mesh position={[0, 2.9, 0]}>
        <cylinderGeometry args={[0.09, 0.11, 5.8, 8]} />
        <meshStandardMaterial color="#2d3436" roughness={0.7} />
      </mesh>
      {/* Mast arm reaching over the approach lane (local +X = toward the carriageway) */}
      <mesh position={[mast / 2, 5.4, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, mast, 8]} />
        <meshStandardMaterial color="#2d3436" roughness={0.7} />
      </mesh>
      {/* Head over the lane, lenses facing the approaching driver (local +Z) */}
      <group position={[mast, 4.8, 0]}>
        <mesh>
          <boxGeometry args={[0.5, 1.3, 0.35]} />
          <meshStandardMaterial color="#232a2e" roughness={0.6} metalness={0.15} />
        </mesh>
        <mesh position={[0, 0.42, 0.19]}>
          <sphereGeometry args={[0.16, 10, 10]} />
          <meshStandardMaterial ref={redRef} color="#2d3436" />
        </mesh>
        <mesh position={[0, 0, 0.19]}>
          <sphereGeometry args={[0.16, 10, 10]} />
          <meshStandardMaterial ref={amberRef} color="#2d3436" />
        </mesh>
        <mesh position={[0, -0.42, 0.19]}>
          <sphereGeometry args={[0.16, 10, 10]} />
          <meshStandardMaterial ref={greenRef} color="#2d3436" />
        </mesh>
      </group>
    </group>
  );
}
