import { crowdGroundY } from './crowdGround';
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ColonySim } from '../sim';
import {
  PED_POOL_CAP,
  PED_BODY,
  PED_HEAD,
  PED_HEAD_COLOR,
  pedColorHex,
  visiblePedCount,
  initPedPool,
  stepPed,
  pedTransform,
  makePedRng,
  type Ped,
} from './pedestrianLayer';

// Spec 121 — the ambient pedestrian crowd. A self-contained decorative layer: it owns a
// pool of 28 figures, steps them toward nearby road cells each frame, and draws as many as
// the colony has colonists. Two fixed-capacity instanced meshes (bodies + heads) allocated
// once; the drawn count varies via mesh.count. Pure math lives in pedestrianLayer.ts.

interface R3FPedestriansProps {
  /** Spec 134 - the leveled-ground map: pads, graded roads and landscape edits reshape
   *  the visible mesh, and anything standing on the ground must stand on THAT surface. */
  terrainLevel?: ReadonlyMap<number, number> | null;
  sim: ColonySim;
}

export function R3FPedestrians({ sim, terrainLevel }: R3FPedestriansProps) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<Ped[] | null>(null);
  const randRef = useRef<(() => number) | null>(null);
  const lastT = useRef<number | null>(null);

  const bodyGeometry = useMemo(() => {
    const geo = new THREE.CapsuleGeometry(PED_BODY.radius, PED_BODY.length, 3, 6);
    geo.translate(0, PED_BODY.translateY, 0);
    return geo;
  }, []);
  const headGeometry = useMemo(() => {
    const geo = new THREE.SphereGeometry(PED_HEAD.radius, 8, 6);
    geo.translate(0, PED_HEAD.translateY, 0);
    return geo;
  }, []);
  const bodyMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }),
    []
  );
  const headMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: PED_HEAD_COLOR, roughness: 0.85 }),
    []
  );
  // Spec 119 discipline — free the GPU resources on unmount.
  useEffect(() => () => {
    bodyGeometry.dispose();
    headGeometry.dispose();
    bodyMaterial.dispose();
    headMaterial.dispose();
  }, [bodyGeometry, headGeometry, bodyMaterial, headMaterial]);

  const scratch = useMemo(
    () => ({ m4: new THREE.Matrix4(), quat: new THREE.Quaternion(), color: new THREE.Color(), scale: new THREE.Vector3(1, 1, 1), pos: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0) }),
    []
  );

  useFrame((state) => {
    const body = bodyRef.current;
    const head = headRef.current;
    if (!body || !head) return;
    const terrain = sim.state.terrain;

    // Lazy one-time pool seed once terrain is available.
    if (!poolRef.current) {
      const rand = makePedRng(0x9e3779b9 ^ terrain.size);
      randRef.current = rand;
      const onLand = (x: number, y: number) => {
        const ix = Math.round(x), iy = Math.round(y);
        if (ix < 0 || iy < 0 || ix >= terrain.size || iy >= terrain.size) return false;
        return !terrain.isWater(ix, iy);
      };
      poolRef.current = initPedPool(terrain.landing, rand, onLand);
      // Per-instance body colors set once (heads use the shared skin material).
      for (let i = 0; i < poolRef.current.length; i++) {
        scratch.color.setHex(pedColorHex(i));
        body.setColorAt(i, scratch.color);
      }
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
    }

    const pool = poolRef.current;
    const rand = randRef.current!;
    const now = state.clock.elapsedTime;
    const dt = lastT.current === null ? 1 / 60 : Math.min(0.05, now - lastT.current);
    lastT.current = now;

    const size = terrain.size;
    const lx = terrain.landing.x, ly = terrain.landing.y;
    const roadCells = sim.state.roads;
    // spec 140 — pedestrians target road cells, so ride the ribbon top instead of sinking under it
    const groundY = (x: number, y: number) => crowdGroundY(terrain, terrainLevel, sim.state.roadSet, x, y);
    const onLand = (x: number, y: number) => {
      const ix = Math.round(x), iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= size || iy >= size) return false;
      return !terrain.isWater(ix, iy);
    };

    const want = visiblePedCount(sim.state.colonists, pool.length);
    for (let i = 0; i < want; i++) {
      const p = pool[i];
      const { heading, bob } = stepPed(p, dt, lx, ly, roadCells, rand, onLand);
      const t = pedTransform(p, heading, bob, size, groundY);
      scratch.pos.set(t.wx, t.wy, t.wz);
      scratch.quat.setFromAxisAngle(scratch.axis, t.rotY);
      scratch.m4.compose(scratch.pos, scratch.quat, scratch.scale);
      body.setMatrixAt(i, scratch.m4);
      head.setMatrixAt(i, scratch.m4);
    }
    body.count = want;
    head.count = want;
    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
  });

  return (
    <group name="pedestrians">
      <instancedMesh
        ref={bodyRef}
        name="pedestrian-bodies"
        args={[bodyGeometry, bodyMaterial, PED_POOL_CAP]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={headRef}
        name="pedestrian-heads"
        args={[headGeometry, headMaterial, PED_POOL_CAP]}
        castShadow
        frustumCulled={false}
      />
    </group>
  );
}
