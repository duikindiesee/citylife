import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ColonySim } from '../sim';
import type { AvatarView } from './R3FPlanetRenderer';
import {
  AVATAR_CAP,
  AVATAR_BODY,
  AVATAR_HEAD,
  avatarColorHex,
  avatarTransform,
  drawableAvatars,
} from './avatarLayer';

// Spec 120 — citizens visible in the R3F world. The runtime pushes a per-frame avatar
// source through the PlanetRenderer class (setAvatarSource); this component pulls it in
// useFrame and syncs two fixed-capacity instanced meshes (capsule bodies + sphere heads)
// sharing per-instance matrices. Max-capacity + mesh.count means the meshes are never
// reconstructed when the roster changes.

export interface AvatarRefs {
  source: { current: (() => AvatarView[]) | null };
  fpCitizenId: { current: string | null };
  /** The list THIS frame's avatar pass fetched (spec 131 verify F3) — siblings that need
   *  avatar positions (the rally nameplates) read this instead of re-running the roster
   *  closure, which allocates a fresh array + N objects per call. */
  lastList?: { current: AvatarView[] | null };
}

interface R3FAvatarsProps {
  sim: ColonySim;
  refs: AvatarRefs;
}

export function R3FAvatars({ sim, refs }: R3FAvatarsProps) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);

  const bodyGeometry = useMemo(
    () => new THREE.CapsuleGeometry(AVATAR_BODY.radius, AVATAR_BODY.length, 4, 8),
    []
  );
  const headGeometry = useMemo(() => {
    const geo = new THREE.SphereGeometry(AVATAR_HEAD.radius, 10, 8);
    geo.translate(0, AVATAR_HEAD.lift, 0);
    return geo;
  }, []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }),
    []
  );
  // Spec 119 discipline — these live for the component lifetime and are freed on unmount.
  useEffect(() => () => {
    bodyGeometry.dispose();
    headGeometry.dispose();
    material.dispose();
  }, [bodyGeometry, headGeometry, material]);

  const scratch = useMemo(
    () => ({ m4: new THREE.Matrix4(), quat: new THREE.Quaternion(), color: new THREE.Color(), scale: new THREE.Vector3(1, 1, 1), pos: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0) }),
    []
  );

  useFrame(() => {
    const body = bodyRef.current;
    const head = headRef.current;
    if (!body || !head) return;

    const list = refs.source.current ? refs.source.current() : [];
    if (refs.lastList) refs.lastList.current = list;
    const drawn = drawableAvatars(list, refs.fpCitizenId.current);
    const size = sim.state.terrain.size;
    const groundY = (x: number, y: number) => sim.state.terrain.worldY(x, y);

    for (let i = 0; i < drawn.length; i++) {
      const a = drawn[i];
      const t = avatarTransform(a, size, groundY);
      scratch.pos.set(t.wx, t.wy, t.wz);
      scratch.quat.setFromAxisAngle(scratch.axis, t.rotY);
      scratch.m4.compose(scratch.pos, scratch.quat, scratch.scale);
      body.setMatrixAt(i, scratch.m4);
      head.setMatrixAt(i, scratch.m4);
      scratch.color.setHex(avatarColorHex(a));
      body.setColorAt(i, scratch.color);
      head.setColorAt(i, scratch.color);
    }

    body.count = drawn.length;
    head.count = drawn.length;
    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (head.instanceColor) head.instanceColor.needsUpdate = true;
  });

  return (
    <group name="avatars">
      <instancedMesh
        ref={bodyRef}
        name="avatar-bodies"
        args={[bodyGeometry, material, AVATAR_CAP]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={headRef}
        name="avatar-heads"
        args={[headGeometry, material, AVATAR_CAP]}
        castShadow
        frustumCulled={false}
      />
    </group>
  );
}
