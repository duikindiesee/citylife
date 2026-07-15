import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { BIOME_COLOR, Biome } from '../terrain';
import {
  patchOceanShader,
  OCEAN_TIME_SCALE,
  OCEAN_TIME_UNIFORM,
  type PatchableShader,
} from './oceanWaves';

interface R3FOceanProps {
  size: number;
}

export function R3FOcean({ size }: R3FOceanProps) {
  const geometry = useMemo(
    // RingGeometry creates in X,Y so we must rotate the mesh to lie flat in X,Z
    () => new THREE.RingGeometry(0.5, size * 0.99, 120, 30),
    [size]
  );
  // Spec 119 — dispose the superseded ring when size changes, and on unmount.
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Spec 116 — the waves live on the GPU. The vertex shader displaces the ring and derives
  // lit normals from the wave slopes (patchOceanShader); the frame loop below only advances
  // one uniform. The old path iterated ~3,750 vertices on the CPU every frame.
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: BIOME_COLOR[Biome.Ocean],
      roughness: 0.7,
      metalness: 0.0,
      flatShading: false,
    });
    mat.onBeforeCompile = (shader) => {
      patchOceanShader(shader);
      // Same idiom as R3FFoliage: park the shader on the material so useFrame can reach it
      mat.userData.shader = shader;
    };
    return mat;
  }, []);
  // Spec 119 — free the patched shader program on unmount.
  useEffect(() => () => material.dispose(), [material]);

  useFrame((state) => {
    const shader = material.userData.shader as PatchableShader | undefined;
    if (shader) {
      shader.uniforms[OCEAN_TIME_UNIFORM].value =
        state.clock.elapsedTime * OCEAN_TIME_SCALE;
    }
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.15, 0]}
      receiveShadow
    />
  );
}
