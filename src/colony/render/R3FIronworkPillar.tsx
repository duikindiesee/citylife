import React, { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { restingToothIndex } from "../build";
import {
  buildIronworkHikePath,
  IRONWORK_PILLAR_ASSET_URL,
  ironworkPillarCell,
} from "../ironworkPillar";
import type { ColonySim } from "../sim";
import { leveledWorldY } from "./terrainLeveling";
import { pillarSignature } from "./simSignals";
import { useSimSignal, type SimBridge } from "./useSimSignal";

interface R3FIronworkPillarProps {
  sim: ColonySim;
  runtime?: SimBridge;
  terrainLevel?: Map<number, number>;
}

interface PillarModel {
  scene: THREE.Group;
  stages: THREE.Object3D[];
  ring: THREE.Object3D | null;
  irisLeft: THREE.Object3D | null;
  irisRight: THREE.Object3D | null;
  core: THREE.Object3D | null;
  emissive: THREE.MeshStandardMaterial[];
  brass: THREE.MeshStandardMaterial[];
  dispose(): void;
}

interface TrailLayer {
  group: THREE.Group;
  dispose(): void;
}

function clonePillar(source: THREE.Group): PillarModel {
  const scene = source.clone(true);
  scene.name = "IronworkPillarGLB";
  const emissive: THREE.MeshStandardMaterial[] = [];
  const brass: THREE.MeshStandardMaterial[] = [];
  const clonedMaterials = new Set<THREE.Material>();
  scene.traverse((node) => {
    if (!(node as THREE.Mesh).isMesh) return;
    const value = node as THREE.Mesh;
    value.castShadow = true;
    value.receiveShadow = true;
    const originals = Array.isArray(value.material) ? value.material : [value.material];
    const materials = originals.map((entry) => {
      const cloned = entry.clone();
      clonedMaterials.add(cloned);
      if (
        cloned instanceof THREE.MeshStandardMaterial &&
        cloned.emissive.getHex() !== 0
      ) {
        emissive.push(cloned);
      }
      if (
        cloned instanceof THREE.MeshStandardMaterial &&
        cloned.name === "Pillar_Old_Brass"
      ) {
        brass.push(cloned);
      }
      return cloned;
    });
    value.material = Array.isArray(value.material) ? materials : materials[0]!;
  });
  return {
    scene,
    stages: [1, 2, 3].map(
      (stage) => scene.getObjectByName(`Pillar_Stage_${stage}`)!,
    ),
    ring: scene.getObjectByName("Pillar_Retune_Ring") ?? null,
    irisLeft: scene.getObjectByName("Pillar_Iris_Left") ?? null,
    irisRight: scene.getObjectByName("Pillar_Iris_Right") ?? null,
    core: scene.getObjectByName("Pillar_Crown_Core") ?? null,
    emissive,
    brass,
    dispose: () => clonedMaterials.forEach((material) => material.dispose()),
  };
}

function buildTrailLayer(sim: ColonySim): TrailLayer | null {
  const state = sim.state;
  const path = buildIronworkHikePath(state);
  if (path.length < 2) return null;
  const terrain = state.terrain;
  const size = terrain.size;
  const controls = path
    .filter((_, index) => index === 0 || index === path.length - 1 || index % 4 === 0)
    .map((cell) => new THREE.Vector3(cell.x, 0, cell.y));
  const curve = new THREE.CatmullRomCurve3(controls, false, "centripetal", 0.28);
  const samples = Math.max(48, path.length * 3);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const sampled: THREE.Vector3[] = [];
  for (let index = 0; index <= samples; index++) {
    const t = index / samples;
    const grid = curve.getPoint(t);
    const tangent = curve.getTangent(t);
    const sideX = -tangent.z;
    const sideZ = tangent.x;
    const sideLength = Math.hypot(sideX, sideZ) || 1;
    const halfWidth = 1.12 + Math.sin(index * 1.77) * 0.1;
    const center = new THREE.Vector3(
      (grid.x - size / 2) * 4,
      Math.max(0, terrain.worldYAt(grid.x, grid.z)) + 0.12,
      (grid.z - size / 2) * 4,
    );
    sampled.push(center);
    for (const side of [-1, 1]) {
      positions.push(
        center.x + (sideX / sideLength) * halfWidth * side,
        center.y,
        center.z + (sideZ / sideLength) * halfWidth * side,
      );
      normals.push(0, 1, 0);
      uvs.push(side < 0 ? 0 : 1, t * path.length * 0.45);
    }
    if (index < samples) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  trailGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  trailGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  trailGeometry.setIndex(indices);
  trailGeometry.computeBoundingSphere();
  const trailMaterial = new THREE.MeshStandardMaterial({
    color: 0x514d46,
    roughness: 0.98,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const trail = new THREE.Mesh(trailGeometry, trailMaterial);
  trail.name = "IronworkHikePath";
  trail.receiveShadow = true;

  const markerGeometry = new THREE.DodecahedronGeometry(0.45, 0);
  const markerMaterial = new THREE.MeshStandardMaterial({
    color: 0x343a39,
    roughness: 0.9,
    metalness: 0.08,
  });
  const markerCount = Math.max(1, Math.floor(sampled.length / 28));
  const markers = new THREE.InstancedMesh(
    markerGeometry,
    markerMaterial,
    markerCount,
  );
  markers.name = "IronworkTrailMarkers";
  markers.castShadow = true;
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < markerCount; index++) {
    const sampleIndex = Math.min(sampled.length - 1, (index + 1) * 28);
    const point = sampled[sampleIndex]!;
    const side = index % 2 === 0 ? -1 : 1;
    matrix.compose(
      new THREE.Vector3(point.x + side * 1.35, point.y + 0.35, point.z),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(index * 0.17, index * 0.73, index * 0.11),
      ),
      new THREE.Vector3(1, 1.5 + (index % 3) * 0.28, 1),
    );
    markers.setMatrixAt(index, matrix);
  }
  markers.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.name = "IronworkHikeLayer";
  group.add(trail, markers);
  return {
    group,
    dispose: () => {
      trailGeometry.dispose();
      trailMaterial.dispose();
      markerGeometry.dispose();
      markerMaterial.dispose();
    },
  };
}

export function R3FIronworkPillar({
  sim,
  runtime,
  terrainLevel,
}: R3FIronworkPillarProps) {
  const sig = useSimSignal(runtime, () => pillarSignature(sim.state));
  const crownLight = useRef<THREE.PointLight>(null);
  const undercroftLight = useRef<THREE.PointLight>(null);
  const { scene } = useGLTF(IRONWORK_PILLAR_ASSET_URL);
  const model = useMemo(() => clonePillar(scene), [scene]);
  const trail = useMemo(() => buildTrailLayer(sim), [sim, sig]);
  const cell = ironworkPillarCell(sim.state.structures);
  const stage = sim.state.pillarStage ?? 0;
  const building = sim.state.pillarBuilding ?? false;
  const progress = THREE.MathUtils.clamp(sim.state.pillarProgress ?? 0, 0, 1);
  const visible = stage > 0 || building;

  useEffect(() => () => model.dispose(), [model]);
  useEffect(() => () => trail?.dispose(), [trail]);

  for (let index = 0; index < model.stages.length; index++) {
    const number = index + 1;
    const completed = stage >= number;
    const active = building && stage + 1 === number;
    const node = model.stages[index];
    if (!node) continue;
    node.visible = completed || active;
    const growth = completed ? 1 : Math.max(0.06, progress);
    node.scale.set(1, growth, 1);
  }

  useFrame(({ clock }, delta) => {
    if (!visible) return;
    const colonyClock = sim.state.clock;
    const midnight = stage >= 3 && colonyClock.hour === 0;
    const night = 1 - colonyClock.daylight;
    const pulse = midnight
      ? 0.72 + Math.sin(clock.elapsedTime * 4.2) * 0.28
      : 0.32 + night * 0.48;
    for (const material of model.emissive) {
      material.emissiveIntensity = 1.4 + pulse * 4.2;
    }
    for (const material of model.brass) {
      material.emissive.setHex(midnight ? 0x789f94 : 0x000000);
      material.emissiveIntensity = midnight ? 1.8 : 0;
    }
    if (crownLight.current) {
      crownLight.current.intensity = stage >= 3 ? (midnight ? 105 : night * 28) : 0;
    }
    if (undercroftLight.current) {
      undercroftLight.current.intensity = stage >= 1 ? (midnight ? 62 : night * 16) : 0;
    }
    if (model.ring && stage >= 2) {
      const tooth = restingToothIndex(colonyClock.day, colonyClock.hour);
      const target =
        -(tooth / 12) * Math.PI * 2 -
        (midnight ? (colonyClock.minute / 60) * Math.PI * 2 : 0);
      model.ring.rotation.z = THREE.MathUtils.damp(
        model.ring.rotation.z,
        target,
        midnight ? 2.8 : 5.5,
        delta,
      );
    }
    if (model.core && stage >= 3) {
      const coreScale = midnight ? 1.1 + Math.sin(clock.elapsedTime * 3.5) * 0.18 : 1;
      model.core.scale.setScalar(coreScale);
    }
    if (model.irisLeft && model.irisRight && stage >= 3) {
      const opening = midnight ? 0.8 : 0;
      model.irisLeft.position.x = -1.45 - opening;
      model.irisRight.position.x = 1.45 + opening;
    }
  });

  if (!cell) return null;
  const terrain = sim.state.terrain;
  const position: [number, number, number] = [
    (cell.x - terrain.size / 2) * 4,
    Math.max(0, leveledWorldY(terrain, terrainLevel, cell.x, cell.y)),
    (cell.y - terrain.size / 2) * 4,
  ];
  const rotation = Math.atan2(
    terrain.landing.x - cell.x,
    terrain.landing.y - cell.y,
  );

  return (
    <>
      {visible && trail && <primitive object={trail.group} />}
      {visible && (
        <group name="IronworkPillar" position={position} rotation-y={rotation}>
          <RigidBody type="fixed" colliders={false}>
            <CuboidCollider args={[4.6, 32, 4.6]} position={[0, 32, 0]} />
            <primitive object={model.scene} />
            <pointLight
              ref={crownLight}
              name="IronworkCrownLight"
              position={[0, 59, 0]}
              color={0xc8fff0}
              distance={82}
              decay={2}
            />
            <pointLight
              ref={undercroftLight}
              name="IronworkUndercroftLight"
              position={[0, 3, 0]}
              color={0xa6d4c8}
              distance={46}
              decay={2}
            />
          </RigidBody>
        </group>
      )}
    </>
  );
}

useGLTF.preload(IRONWORK_PILLAR_ASSET_URL);
