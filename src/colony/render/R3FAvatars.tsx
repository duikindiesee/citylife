import { crowdGroundY } from './crowdGround';
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
import {
  buildCrabGeometry,
  buildHoverBoltGeometry,
  CRAB_BOLT_HOVER_Y,
  CRAB_COLORS,
} from './crabGeometry';

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
  /** Spec 134 - the leveled-ground map: pads, graded roads and landscape edits reshape
   *  the visible mesh, and anything standing on the ground must stand on THAT surface. */
  terrainLevel?: ReadonlyMap<number, number> | null;
  sim: ColonySim;
  refs: AvatarRefs;
}

export function R3FAvatars({ sim, refs, terrainLevel }: R3FAvatarsProps) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const crabRef = useRef<THREE.Group>(null);
  const boltRef = useRef<THREE.Mesh>(null);

  const bodyGeometry = useMemo(
    () => {
      const geo = new THREE.CapsuleGeometry(AVATAR_BODY.radius, AVATAR_BODY.length, 4, 8);
      geo.translate(0, AVATAR_BODY.lift, 0); // spec 137 — feet on the ground, not torso buried at it
      return geo;
    },
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
  // Spec 132 — Joe the Crab: the merged vertex-coloured crab (blue headset, bolts on the
  // earcup sides) plus the animated hover bolt the component bobs above him.
  const crabGeometry = useMemo(() => buildCrabGeometry(), []);
  const crabMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.04 }),
    []
  );
  const boltGeometry = useMemo(() => buildHoverBoltGeometry(), []);
  const boltMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: CRAB_COLORS.bolt,
        emissive: CRAB_COLORS.bolt,
        emissiveIntensity: 0.7,
        roughness: 0.4,
      }),
    []
  );
  // Spec 119 discipline — these live for the component lifetime and are freed on unmount.
  useEffect(() => () => {
    bodyGeometry.dispose();
    headGeometry.dispose();
    material.dispose();
    crabGeometry.dispose();
    crabMaterial.dispose();
    boltGeometry.dispose();
    boltMaterial.dispose();
  }, [bodyGeometry, headGeometry, material, crabGeometry, crabMaterial, boltGeometry, boltMaterial]);

  const scratch = useMemo(
    () => ({ m4: new THREE.Matrix4(), quat: new THREE.Quaternion(), color: new THREE.Color(), scale: new THREE.Vector3(1, 1, 1), pos: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0) }),
    []
  );

  useFrame((state) => {
    const body = bodyRef.current;
    const head = headRef.current;
    if (!body || !head) return;

    const list = refs.source.current ? refs.source.current() : [];
    if (refs.lastList) refs.lastList.current = list;
    const drawn = drawableAvatars(list, refs.fpCitizenId.current);
    const size = sim.state.terrain.size;
    // spec 140 — ride the road ribbon on road cells so citizens and Joe don't sink through it
    const groundY = (x: number, y: number) => crowdGroundY(sim.state.terrain, terrainLevel, sim.state.roadSet, x, y);

    // Spec 132 — crab-kind avatars draw the crab model, not a human capsule.
    let crab: AvatarView | null = null;
    let di = 0;
    for (let i = 0; i < drawn.length; i++) {
      const a = drawn[i];
      if (a.kind === 'crab') {
        if (!crab) crab = a; // Joe — one crab founder; a second would wait its turn
        continue;
      }
      const t = avatarTransform(a, size, groundY);
      scratch.pos.set(t.wx, t.wy, t.wz);
      scratch.quat.setFromAxisAngle(scratch.axis, t.rotY);
      scratch.m4.compose(scratch.pos, scratch.quat, scratch.scale);
      body.setMatrixAt(di, scratch.m4);
      head.setMatrixAt(di, scratch.m4);
      scratch.color.setHex(avatarColorHex(a));
      body.setColorAt(di, scratch.color);
      head.setColorAt(di, scratch.color);
      di++;
    }

    body.count = di;
    head.count = di;
    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (head.instanceColor) head.instanceColor.needsUpdate = true;

    const crabGroup = crabRef.current;
    if (crabGroup) {
      crabGroup.visible = !!crab;
      if (crab) {
        const t = avatarTransform(crab, size, groundY);
        crabGroup.position.set(t.wx, t.wy, t.wz);
        crabGroup.rotation.y = t.rotY;
        // the hover bolt bobs gently above Joe, tip down, slowly turning — the marker the
        // operator asked to keep ("pointing to him")
        const bolt = boltRef.current;
        if (bolt) {
          const T = state.clock.getElapsedTime();
          bolt.position.y = CRAB_BOLT_HOVER_Y + Math.sin(T * 2.2) * 0.06;
          bolt.rotation.y = T * 1.2;
        }
      }
    }
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
      <group ref={crabRef} name="avatar-crab" visible={false}>
        <mesh geometry={crabGeometry} material={crabMaterial} castShadow />
        <mesh
          ref={boltRef}
          name="crab-hover-bolt"
          geometry={boltGeometry}
          material={boltMaterial}
          position={[0, CRAB_BOLT_HOVER_Y, 0]}
          rotation={[0, 0, Math.PI]}
        />
      </group>
    </group>
  );
}
