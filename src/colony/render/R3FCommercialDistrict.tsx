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
import { GARAGE_CAR_METRE_SCALE } from "./garageAnchorShell";
import {
  applyDesertPavilionEnvMap,
  bakeDesertPavilionEnvMap,
  mergePosedCars,
} from "./garagePavilionLook";

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

    // GLBs are in metres. GARAGE_CAR_METRE_SCALE is 1/renderScale so the ×4 garage
    // group does not enlarge them. rotationOffset swings the native Z-length onto X
    // for cars that park across a stall. The lift car keeps yaw 0: nose toward -Z.
    const metre = GARAGE_CAR_METRE_SCALE;
    replaceCar(
      "garageAnchorShowroomHeroCar",
      x19.scene,
      SHOWROOM_VEHICLES[2]?.spec.paint,
      SHOWROOM_VEHICLES[2]?.rotationOffset,
      metre,
    );
    replaceCar(
      "garageAnchorDisplayCar.1",
      vonk.scene,
      SHOWROOM_VEHICLES[0]?.spec.paint,
      SHOWROOM_VEHICLES[0]?.rotationOffset,
      metre,
    );
    replaceCar(
      "garageAnchorDisplayCar.2",
      kaap.scene,
      SHOWROOM_VEHICLES[1]?.spec.paint,
      SHOWROOM_VEHICLES[1]?.rotationOffset,
      metre,
    );
    replaceCar(
      "garageAnchorBayLiftCar",
      vonk.scene,
      SHOWROOM_VEHICLES[0]?.spec.paint,
      [0, 0, 0],
      metre,
    );

    const scenes = [vonk.scene, kaap.scene, x19.scene];
    const painted = scenes.map((scene, i) =>
      prepareModel(scene, SHOWROOM_VEHICLES[i]?.spec.paint),
    );
    const floorSlots: Array<{
      prototype: number;
      x: number;
      y: number;
      z: number;
      rot: number;
      scale: number;
    }> = [];
    for (let n = 1; n <= 8; n++) {
      const slot = layerGroup.getObjectByName(`garageAnchorShowroomFloorCar.${n}`);
      if (!slot) continue;
      const modelIndex = Number(slot.userData.floorCarModel ?? 0);
      floorSlots.push({
        prototype: modelIndex,
        x: slot.position.x,
        y: slot.position.y,
        z: slot.position.z,
        rot: slot.rotation.y,
        scale: metre,
      });
      const doomed: THREE.Object3D[] = [];
      slot.traverse((child) => {
        if (child !== slot && (child as THREE.Mesh).isMesh) doomed.push(child);
      });
      for (const obj of doomed) obj.parent?.remove(obj);
    }
    if (floorSlots.length > 0) {
      const merged = mergePosedCars(painted, floorSlots);
      const anchor = layerGroup.getObjectByName("garageAnchorShowroomInterior");
      (anchor ?? layerGroup).add(merged);
    }

    const env = layerGroup.userData.desertPavilionEnvMap as
      | THREE.Texture
      | undefined;
    if (env) {
      for (const name of ["garageAnchorShowroomHeroCar", "garageAnchorBayLiftCar"]) {
        layerGroup.getObjectByName(name)?.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          for (const m of mats) {
            const mat = m as THREE.MeshStandardMaterial;
            if (!mat?.isMeshStandardMaterial) continue;
            mat.envMap = env;
            mat.envMapIntensity = mat.envMapIntensity || 0.55;
            mat.needsUpdate = true;
          }
        });
      }
    }
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

  useEffect(() => {
    if (!layer) return;
    const env = bakeDesertPavilionEnvMap(gl);
    if (!env) return;
    layer.group.userData.desertPavilionEnvMap = env;
    applyDesertPavilionEnvMap(layer.group, env);
    return () => {
      env.dispose();
      delete layer.group.userData.desertPavilionEnvMap;
    };
  }, [layer, gl]);

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
