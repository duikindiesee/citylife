import React, { useEffect, useMemo, useRef, useLayoutEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ColonySim } from "../sim";
import { calculateFoliagePositions } from "./foliageLogic";
import { findJunctionZones } from "./roadJunctions";
import { useSimSignal, type SimBridge } from "./useSimSignal";
import { foliageSignature } from "./simSignals";
import { buildIronworkHikePath, ironworkPillarCell } from "../ironworkPillar";

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
    // Spec 149 — the bus depot pad clears its trees too (same class as lots/parcels/junctions):
    // conifers otherwise grow across the apron and parking bays, half-burying the parked fleet.
    // ORIGIN-anchored AABB (same field the terrain leveling grades in useTerrainLeveling §2b, so
    // trees and grading agree on ONE footprint); the whole depot GLB + bays sit inside it, and the
    // gate spur is a real road already cleared by the roads pass above. The 1-cell canopy margin is
    // added by calculateFoliagePositions, exactly as for the commercial parcels.
    const depot = s.busDepotPad;
    if (depot) {
      rects.push({
        x0: depot.x,
        y0: depot.y,
        x1: depot.x + depot.w - 1,
        y1: depot.y + depot.h - 1,
      });
    }
    // Spec 144 — the highland route is a footpath, not a road, so it does not enter `roads`.
    // Clear its narrow tread and the mountain dais explicitly or conifers hide the destination
    // and grow through the gravel ribbon.
    for (const cell of buildIronworkHikePath(s)) {
      rects.push({ x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y });
    }
    const pillar = ironworkPillarCell(s.structures);
    if (pillar) {
      rects.push({
        x0: pillar.x - 3,
        y0: pillar.y - 3,
        x1: pillar.x + 3,
        y1: pillar.y + 3,
      });
    }
    const { matrices: mats, colors: cols } = calculateFoliagePositions(
      s.terrain,
      s.roads,
      s.buildings,
      rects,
      s.roadWays ?? [],
    );
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
        `,
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
