import { leveledWorldY } from "./terrainLeveling";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ColonySim } from "../sim";
import { COLONY } from "../config";
import {
  TARENTAAL_ADULT,
  TARENTAAL_CHICK,
  tarentaalTransform,
} from "./tarentaalLayer";

// Spec 125 — the tarentaal flock. Positions come from the deterministic sim tick
// (sim.state.tarentaal, stepped by stepTarentaalFlock), so this reads sim.state each frame
// and syncs two fixed-capacity instanced meshes (adults + chicks) — the mount-once /
// vary-mesh.count idiom. Pure placement math lives in tarentaalLayer.ts.

interface R3FTarentaalProps {
  /** Spec 134 - the leveled-ground map: pads, graded roads and landscape edits reshape
   *  the visible mesh, and anything standing on the ground must stand on THAT surface. */
  terrainLevel?: ReadonlyMap<number, number> | null;
  sim: ColonySim;
}

function birdGeometry(spec: typeof TARENTAAL_ADULT | typeof TARENTAAL_CHICK) {
  const geo = new THREE.SphereGeometry(spec.radius, spec.wseg, spec.hseg);
  geo.scale(spec.scale[0], spec.scale[1], spec.scale[2]);
  geo.translate(0, spec.translateY, 0);
  return geo;
}

export function R3FTarentaal({ sim, terrainLevel }: R3FTarentaalProps) {
  const adultRef = useRef<THREE.InstancedMesh>(null);
  const chickRef = useRef<THREE.InstancedMesh>(null);

  const adultGeo = useMemo(() => birdGeometry(TARENTAAL_ADULT), []);
  const chickGeo = useMemo(() => birdGeometry(TARENTAAL_CHICK), []);
  const adultMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: TARENTAAL_ADULT.color,
        roughness: 0.9,
        metalness: 0.02,
        flatShading: true,
      }),
    [],
  );
  const chickMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: TARENTAAL_CHICK.color,
        roughness: 0.95,
        metalness: 0,
        flatShading: true,
      }),
    [],
  );
  useEffect(
    () => () => {
      adultGeo.dispose();
      chickGeo.dispose();
      adultMat.dispose();
      chickMat.dispose();
    },
    [adultGeo, chickGeo, adultMat, chickMat],
  );

  const scratch = useMemo(
    () => ({
      m4: new THREE.Matrix4(),
      quat: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      axis: new THREE.Vector3(0, 1, 0),
    }),
    [],
  );

  useFrame(() => {
    const adult = adultRef.current;
    const chick = chickRef.current;
    if (!adult || !chick) return;
    const size = sim.state.terrain.size;
    const groundY = (x: number, y: number) =>
      leveledWorldY(sim.state.terrain, terrainLevel, x, y);

    let adults = 0,
      chicks = 0;
    for (const bird of sim.state.tarentaal) {
      const isAdult = bird.age === "adult";
      const mesh = isAdult ? adult : chick;
      const idx = isAdult ? adults++ : chicks++;
      if (idx >= mesh.instanceMatrix.count) continue; // never exceed the allocated cap
      const t = tarentaalTransform(bird, size, groundY);
      scratch.pos.set(t.wx, t.wy, t.wz);
      scratch.quat.setFromAxisAngle(scratch.axis, t.rotY);
      scratch.scale.set(t.stride, 1, t.stride);
      scratch.m4.compose(scratch.pos, scratch.quat, scratch.scale);
      mesh.setMatrixAt(idx, scratch.m4);
    }
    adult.count = adults;
    chick.count = chicks;
    adult.instanceMatrix.needsUpdate = true;
    chick.instanceMatrix.needsUpdate = true;
  });

  return (
    <group name="tarentaal">
      <instancedMesh
        ref={adultRef}
        name="tarentaal-adults"
        args={[adultGeo, adultMat, COLONY.tarentaal.adults]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={chickRef}
        name="tarentaal-chicks"
        args={[chickGeo, chickMat, COLONY.tarentaal.chicks]}
        castShadow
        frustumCulled={false}
      />
    </group>
  );
}
