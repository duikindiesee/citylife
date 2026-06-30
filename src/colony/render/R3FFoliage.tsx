import React, { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ColonySim } from '../sim';
import { calculateFoliagePositions } from './foliageLogic';

interface R3FFoliageProps {
  sim: ColonySim;
}

export function R3FFoliage({ sim }: R3FFoliageProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  
  // Rebuild foliage when terrain or roads/buildings change.
  // We use sim.state.roadsVersion and sim.state.buildings.length as cheap triggers.
  const { matrices, colors, geometry } = useMemo(() => {
    const s = sim.state;
    const { matrices: mats, colors: cols } = calculateFoliagePositions(s.terrain, s.roads, s.buildings);
    
    // Create the geometry
    const geo = new THREE.ConeGeometry(4, 20, 5);
    // Lift geometry so the origin is at the base, not the center
    geo.translate(0, 10, 0);

    return { matrices: mats, colors: cols, geometry: geo };
  }, [sim.state.roadsVersion, sim.state.buildings.length]); // Note: In a real app we'd track precise signals

  // Use a custom material that sways in the wind
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      metalness: 0.05,
    });
    
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      // Pass the uniform reference to the material object so useFrame can update it
      (mat as any).userData.shader = shader;
      
      shader.vertexShader = `
        uniform float uTime;
        ${shader.vertexShader}
      `.replace(
        `#include <begin_vertex>`,
        `
        #include <begin_vertex>
        // Wind sway based on world position and time.
        // We use the instance matrix's position to offset the phase.
        vec4 worldPos = instanceMatrix * vec4(position, 1.0);
        float sway = sin(uTime * 1.5 + worldPos.x * 0.1 + worldPos.z * 0.1) * 0.1;
        // Only sway the top of the tree
        transformed.x += sway * position.y;
        `
      );
    };
    return mat;
  }, []);

  useFrame((state) => {
    if (material && (material as any).userData.shader) {
      (material as any).userData.shader.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  useLayoutEffect(() => {
    if (meshRef.current) {
      const mesh = meshRef.current;
      const m4 = new THREE.Matrix4();
      const c3 = new THREE.Color();
      for (let i = 0; i < matrices.length; i++) {
        m4.fromArray(matrices[i]);
        mesh.setMatrixAt(i, m4);
        c3.setHex(colors[i]);
        mesh.setColorAt(i, c3);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [matrices, colors]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, matrices.length]}
      castShadow
      receiveShadow
    />
  );
}
