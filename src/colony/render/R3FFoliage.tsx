import React, { useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ColonySim } from '../sim';
import { calculateFoliagePositions } from './foliageLogic';
import { findJunctionZones } from './roadJunctions';
import { useSimSignal, type SimBridge } from './useSimSignal';
import { foliageSignature } from './simSignals';

interface R3FFoliageProps {
  sim: ColonySim;
  runtime?: SimBridge;
}

export function R3FFoliage({ sim, runtime }: R3FFoliageProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Rebuild foliage when roads or buildings change. The signature subscription is what
  // actually triggers the re-render — sim.state is mutable and invisible to React on its own.
  const foliageSig = useSimSignal(runtime, () => foliageSignature(sim.state));
  const { matrices, colors } = useMemo(() => {
    const s = sim.state;
    // Spec 128 — lots and parcels clear their trees ("trees on houses is a big no"):
    // neighborhood lots are CENTRE-anchored (bulldoze convention), commercial parcels
    // ORIGIN-anchored (leveling convention).
    const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const lot of s.neighborhood?.lots ?? []) {
      const x0 = lot.x - Math.floor((lot.w - 1) / 2);
      const y0 = lot.y - Math.floor((lot.h - 1) / 2);
      rects.push({ x0, y0, x1: x0 + lot.w - 1, y1: y0 + lot.h - 1 });
    }
    for (const p of s.commercialDistrict?.parcels ?? []) {
      rects.push({ x0: p.x, y0: p.y, x1: p.x + p.w - 1, y1: p.y + p.h - 1 });
    }
    // Spec 137 — junctions clear their trees too: conifers grew straight through the
    // old slab (and now would through the draped cap), dead-centre in the crossing.
    for (const z of findJunctionZones(s.roadWays ?? [])) {
      const r = z.rBound + 1;
      rects.push({
        x0: Math.floor(z.cx - r),
        y0: Math.floor(z.cy - r),
        x1: Math.ceil(z.cx + r),
        y1: Math.ceil(z.cy + r),
      });
    }
    const { matrices: mats, colors: cols } = calculateFoliagePositions(s.terrain, s.roads, s.buildings, rects);
    return { matrices: mats, colors: cols };
  }, [sim, foliageSig]);

  // Spec 119 — the cone is IDENTICAL for every rebuild: one geometry for the component's
  // lifetime (the old code re-created and leaked it on every roads/buildings rebuild),
  // disposed on unmount.
  const geometry = useMemo(() => {
    const geo = new THREE.ConeGeometry(1.5, 8, 5);
    // Lift geometry so the origin is at the base, not the center
    geo.translate(0, 4, 0);
    return geo;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Use a custom material that sways in the wind
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      metalness: 0.05,
    });
    
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      // Pass the uniform reference to the material object so useFrame can update it
      mat.userData.shader = shader;
      
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
  // Spec 119 — free the GPU program on unmount.
  useEffect(() => () => material.dispose(), [material]);

  useFrame((state) => {
    if (material.userData.shader) {
      material.userData.shader.uniforms.uTime.value = state.clock.elapsedTime;
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
      name="foliage"
      args={[geometry, material, matrices.length]}
      castShadow
      receiveShadow
    />
  );
}
