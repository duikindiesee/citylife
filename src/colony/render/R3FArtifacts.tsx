import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ColonySim } from '../sim';
import {
  ARTIFACT_KINDS,
  ARTIFACT_CATALOG_SIZE,
  summarizeRenderableArtifacts,
  type ArtifactKind,
} from '../artifacts';
import { buildArtifactAssets, artifactTransform, type ArtifactAsset } from './artifactLayer';

// Spec 126 — the civic-art artifacts. The catalog is deterministic ColonySim state
// (sim.state.artifacts), so this reads sim.state each frame and syncs one fixed-capacity
// instanced mesh per kind (7 kinds), placing each renderable item and setting per-kind
// counts via summarizeRenderableArtifacts. Mount-once / vary-mesh.count idiom.

interface R3FArtifactsProps {
  sim: ColonySim;
}

export function R3FArtifacts({ sim }: R3FArtifactsProps) {
  const assets = useMemo<Record<ArtifactKind, ArtifactAsset>>(() => buildArtifactAssets(), []);
  const meshes = useRef<Partial<Record<ArtifactKind, THREE.InstancedMesh>>>({});
  const placed = useRef<Record<ArtifactKind, number>>({} as Record<ArtifactKind, number>);

  // Spec 119 — free every kind's geometry + material on unmount.
  useEffect(() => () => {
    for (const kind of ARTIFACT_KINDS) {
      assets[kind].geometry.dispose();
      assets[kind].material.dispose();
    }
  }, [assets]);

  const scratch = useMemo(
    () => ({ m4: new THREE.Matrix4(), quat: new THREE.Quaternion(), scale: new THREE.Vector3(), pos: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0) }),
    []
  );

  // The catalog is created once at sim construction and never mutated (no artifact stepper
  // exists), so a mount-time effect places everything — the old useFrame re-summarized and
  // re-allocated per frame for a static scene.
  useEffect(() => {
    const { counts, renderable } = summarizeRenderableArtifacts(sim.state.artifacts, ARTIFACT_CATALOG_SIZE);
    const size = sim.state.terrain.size;
    const groundY = (x: number, y: number) => sim.state.terrain.worldY(x, y);

    for (const kind of ARTIFACT_KINDS) placed.current[kind] = 0;
    for (const item of renderable) {
      const mesh = meshes.current[item.kind as ArtifactKind];
      if (!mesh) continue;
      const idx = placed.current[item.kind as ArtifactKind]++;
      if (idx >= mesh.instanceMatrix.count) continue; // never exceed the allocated cap
      const t = artifactTransform(item, size, groundY);
      scratch.pos.set(t.wx, t.wy, t.wz);
      scratch.quat.setFromAxisAngle(scratch.axis, t.rotY);
      scratch.scale.set(t.scaleW, 1, t.scaleH);
      scratch.m4.compose(scratch.pos, scratch.quat, scratch.scale);
      mesh.setMatrixAt(idx, scratch.m4);
    }
    for (const kind of ARTIFACT_KINDS) {
      const mesh = meshes.current[kind];
      if (!mesh) continue;
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [sim, assets, scratch]);

  return (
    <group name="artifacts">
      {ARTIFACT_KINDS.map((kind) => (
        <instancedMesh
          key={kind}
          ref={(el) => { if (el) meshes.current[kind] = el; }}
          name={`artifact-${kind}`}
          args={[assets[kind].geometry, assets[kind].material, ARTIFACT_CATALOG_SIZE]}
          castShadow
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
