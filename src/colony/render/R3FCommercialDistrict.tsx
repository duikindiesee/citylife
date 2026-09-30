import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { Box3 } from "three";
import type { ColonySim } from "../sim";
import {
  buildCommercialDistrictLayer,
  type CommercialDistrictLayer,
} from "./commercialDistrictLayer";
import { leveledWorldY } from "./terrainLeveling";
import { useSimSignal, type SimBridge } from "./useSimSignal";
import { commercialSignature } from "./simSignals";
import { SHOWROOM_VEHICLES } from "../showroom/showroomCatalog";

// Spec 175 / Spec 135 — the commercial district in v3.
// Mounts the district layer and replaces the placeholder box cars in the showroom
// and forecourt with authentic, high-fidelity GLB models matching the hero sports car.

function R3FGarageCars({ layerGroup }: { layerGroup?: THREE.Group | null }) {
  const vonk = useGLTF("/assets/citylife/cars/karoo_vonk.glb");
  const kaap = useGLTF("/assets/citylife/cars/karoo_kaap_gt.glb");
  const x19 = useGLTF("/assets/citylife/cars/fiat_x19.glb");

  useEffect(() => {
    if (!layerGroup) return;

    const prepareModel = (
      scene: THREE.Group,
      paint?: { body?: number; cabin?: number; accent?: number },
      rotOffset?: readonly [number, number, number],
    ) => {
      const copy = scene.clone(true);
      copy.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          const mesh = node as THREE.Mesh;
          if (mesh.material) {
            const rawMats = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material];
            const clonedMats = rawMats.map((m) => {
              const cm = m.clone();
              const mat = cm as any;
              if (/carpaint/i.test(cm.name) && paint?.body !== undefined) {
                mat.color?.set(paint.body);
              } else if (
                /targa|roof|cabin/i.test(cm.name) &&
                paint?.cabin !== undefined
              ) {
                mat.color?.set(paint.cabin);
              } else if (
                /alloy|rim|accent/i.test(cm.name) &&
                paint?.accent !== undefined
              ) {
                mat.color?.set(paint.accent);
              }
              return cm;
            });
            mesh.material = Array.isArray(mesh.material)
              ? clonedMats
              : clonedMats[0]!;
          }
        }
      });
      if (rotOffset) {
        copy.rotation.set(rotOffset[0], rotOffset[1], rotOffset[2]);
      }
      const bounds = new Box3().setFromObject(copy);
      if (!bounds.isEmpty()) {
        copy.position.x -= (bounds.min.x + bounds.max.x) / 2;
        copy.position.y -= bounds.min.y;
        copy.position.z -= (bounds.min.z + bounds.max.z) / 2;
      }
      return copy;
    };

    const replaceCar = (
      name: string,
      scene: THREE.Group,
      paint?: { body?: number; cabin?: number; accent?: number },
      rotOffset?: readonly [number, number, number],
      scale = 0.5,
    ) => {
      const parent = layerGroup.getObjectByName(name);
      if (!parent) return;

      // Keep underglow if present, remove placeholder box meshes
      const toRemove: THREE.Object3D[] = [];
      parent.traverse((child) => {
        if (
          child !== parent &&
          !child.name.includes("UnderGlow") &&
          (child as THREE.Mesh).isMesh
        ) {
          toRemove.push(child);
        }
      });
      for (const obj of toRemove) {
        if (obj.parent) obj.parent.remove(obj);
      }

      // Add high-fidelity GLB model
      const model = prepareModel(scene, paint, rotOffset);
      model.scale.setScalar(scale);
      parent.add(model);
    };

    // Hero Car on showroom plinth: Karoo Kaap GT-V8
    // In local cells (shell group scaled by 4), scale 0.262 produces an authentic life-size 4.28m car.
    replaceCar(
      "garageAnchorShowroomHeroCar",
      kaap.scene,
      SHOWROOM_VEHICLES[1]?.spec.paint,
      SHOWROOM_VEHICLES[1]?.rotationOffset,
      0.262,
    );

    // Secondary Car in showroom: Karoo X19 Targa
    replaceCar(
      "garageAnchorShowroomSecondCar",
      x19.scene,
      SHOWROOM_VEHICLES[2]?.spec.paint,
      SHOWROOM_VEHICLES[2]?.rotationOffset,
      0.262,
    );

    // Forecourt Display Car 1: Karoo Vonk 1.1
    replaceCar(
      "garageAnchorDisplayCar.1",
      vonk.scene,
      SHOWROOM_VEHICLES[0]?.spec.paint,
      SHOWROOM_VEHICLES[0]?.rotationOffset,
      0.255,
    );

    // Forecourt Display Car 2: Karoo Kaap GT-V8
    replaceCar(
      "garageAnchorDisplayCar.2",
      kaap.scene,
      SHOWROOM_VEHICLES[1]?.spec.paint,
      SHOWROOM_VEHICLES[1]?.rotationOffset,
      0.262,
    );
  }, [layerGroup, vonk.scene, kaap.scene, x19.scene]);

  // Spec 176: Smooth continuous turntable rotation for the hero presentation display
  useFrame((_, delta) => {
    if (!layerGroup) return;
    const hero = layerGroup.getObjectByName("garageAnchorShowroomHeroCar");
    if (hero) {
      hero.rotation.y += delta * 0.22;
    }
    const plinth = layerGroup.getObjectByName("garageAnchorShowroomPlinth");
    if (plinth) {
      plinth.rotation.y += delta * 0.22;
    }
  });

  return null;
}

interface R3FCommercialDistrictProps {
  sim: ColonySim;
  runtime?: SimBridge;
  terrainLevel?: Map<number, number>;
}

export function R3FCommercialDistrict({
  sim,
  runtime,
  terrainLevel,
}: R3FCommercialDistrictProps) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const sig = useSimSignal(runtime, () => commercialSignature(sim.state));
  const levelRef = useRef(terrainLevel);
  levelRef.current = terrainLevel;

  const layer = useMemo<CommercialDistrictLayer | null>(() => {
    const district = sim.state.commercialDistrict;
    if (!district) return null;
    const terrain = sim.state.terrain;
    const N = terrain.size;
    return buildCommercialDistrictLayer({
      state: sim.state,
      district,
      wx: (x) => (x - N / 2) * 4,
      wz: (y) => (y - N / 2) * 4,
      surfaceY: (x, y) =>
        Math.max(
          0,
          leveledWorldY(
            terrain,
            levelRef.current,
            Math.round(x),
            Math.round(y),
          ),
        ),
    });
  }, [sim, sig]);

  useEffect(
    () => () => {
      layer?.dispose();
    },
    [layer],
  );

  useFrame(() => {
    if (!layer) return;
    layer.update(sim.state.clock.daylight, camera, scene, gl.domElement);
  });

  if (!layer) return null;
  return (
    <group name="commercial-district-root">
      <primitive object={layer.group} />
      <Suspense fallback={null}>
        <R3FGarageCars layerGroup={layer.group} />
      </Suspense>
    </group>
  );
}
