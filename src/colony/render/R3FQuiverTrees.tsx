/**
 * WORLD.KOKERBOOM.1 — the quiver tree, rendered.
 *
 * The shape is what makes a kokerboom recognisable, so it is built rather than approximated with
 * the generic foliage cone: a thick TAPERED trunk that splits DICHOTOMOUSLY (two, then four), with
 * a blue-green rosette at every branch tip. That candelabra silhouette is the whole point — from a
 * distance a stand of them on a ridge is unmistakable.
 *
 * Cost discipline: trunk + branches + rosettes are merged into ONE geometry and drawn with a
 * single instanced mesh, so the whole population is one draw call. Size varies per instance
 * through the instance matrix (age -> height), not through extra geometry.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { COLONY } from "../config";
import { worldClearRects } from "./worldClearRects";
import {
  calculateQuiverTrees,
  quiverTreeHeight,
  type QuiverTree,
} from "./quiverTreeLogic";

// Pale golden bark, and the blue-green succulent rosettes.
const BARK = 0xd8c9a3;
const ROSETTE = 0x6f9e84;

/** Build one unit-height kokerboom, origin at the base, merged into a single BufferGeometry. */
export function buildQuiverGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const colors: number[][] = [];

  const push = (geo: THREE.BufferGeometry, hex: number) => {
    parts.push(geo);
    colors.push([hex]);
  };

  // Trunk: strongly tapered, wide at the base. Unit height 1.0 total for the whole tree.
  const trunkH = 0.5;
  const trunk = new THREE.CylinderGeometry(0.055, 0.13, trunkH, 7);
  trunk.translate(0, trunkH / 2, 0);
  push(trunk, BARK);

  // Dichotomous forking: level 1 splits in two, level 2 splits each of those in two.
  const addFork = (
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    len: number,
    rad: number,
    depth: number,
  ) => {
    // Lean OUT more than UP. The first attempt used 0.6 out / 0.8 up, which grew a narrow bundle
    // straight upward and left every tip at the same height, so the rosettes fused into a flat
    // green slab. A kokerboom's crown is a wide dome, so the outward component now dominates.
    const tipX = x + dirX * len * 0.95;
    const tipY = y + len * 0.58;
    const tipZ = z + dirZ * len * 0.95;

    const branch = new THREE.CylinderGeometry(rad * 0.6, rad, len, 6);
    // Aim the cylinder from (x,y,z) towards the tip.
    const from = new THREE.Vector3(x, y, z);
    const to = new THREE.Vector3(tipX, tipY, tipZ);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const dir = to.clone().sub(from).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir,
    );
    branch.applyQuaternion(quat);
    branch.translate(mid.x, mid.y, mid.z);
    push(branch, BARK);

    if (depth > 0) {
      // THREE fork levels, not two. A real kokerboom forks repeatedly, and the result is a wide,
      // dense candelabra — the first version stopped at two levels (4 tips) and read as a thin
      // Y-shaped shrub rather than the tree. Three levels gives 8 tips, and the perpendicular
      // offset widens the crown instead of splitting it in one plane.
      const s = 0.5;
      const px = -dirZ,
        pz = dirX; // perpendicular, so successive splits rotate around the axis
      // ASYMMETRIC on purpose: the two halves of a fork are never equal, and giving them different
      // lengths staggers the tips in height. Equal children put every rosette on one plane.
      addFork(
        tipX,
        tipY,
        tipZ,
        dirX * s + px * 0.95,
        dirZ * s + pz * 0.95,
        len * 0.78,
        rad * 0.66,
        depth - 1,
      );
      addFork(
        tipX,
        tipY,
        tipZ,
        dirX * s - px * 0.95,
        dirZ * s - pz * 0.95,
        len * 0.58,
        rad * 0.62,
        depth - 1,
      );
    } else {
      // Rosette of succulent leaves at the tip. Sized to sit ON its branch rather than to merge
      // with its neighbours — oversized rosettes were what fused the crown into a slab.
      const ros = new THREE.IcosahedronGeometry(rad * 2.3, 0);
      ros.scale(1.1, 0.7, 1.1);
      ros.translate(tipX, tipY + rad * 1.4, tipZ);
      push(ros, ROSETTE);
    }
  };

  addFork(0, trunkH, 0, 0.42, 0.16, 0.26, 0.052, 2);
  addFork(0, trunkH, 0, -0.42, -0.16, 0.26, 0.052, 2);

  // Merge manually (no BufferGeometryUtils dependency): concatenate position/normal, add colour.
  let vertCount = 0;
  for (const g of parts) vertCount += g.getAttribute("position").count;

  const pos = new Float32Array(vertCount * 3);
  const nrm = new Float32Array(vertCount * 3);
  const col = new Float32Array(vertCount * 3);
  const idx: number[] = [];
  let vOff = 0;
  const c = new THREE.Color();

  parts.forEach((g, gi) => {
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    c.setHex(colors[gi]![0]!);
    for (let i = 0; i < p.count; i++) {
      pos[(vOff + i) * 3] = p.getX(i);
      pos[(vOff + i) * 3 + 1] = p.getY(i);
      pos[(vOff + i) * 3 + 2] = p.getZ(i);
      nrm[(vOff + i) * 3] = n.getX(i);
      nrm[(vOff + i) * 3 + 1] = n.getY(i);
      nrm[(vOff + i) * 3 + 2] = n.getZ(i);
      col[(vOff + i) * 3] = c.r;
      col[(vOff + i) * 3 + 1] = c.g;
      col[(vOff + i) * 3 + 2] = c.b;
    }
    const gIdx = g.getIndex();
    if (gIdx)
      for (let i = 0; i < gIdx.count; i++) idx.push(vOff + gIdx.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(vOff + i);
    vOff += p.count;
    g.dispose();
  });

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  merged.setAttribute("color", new THREE.BufferAttribute(col, 3));
  merged.setIndex(idx);
  return merged;
}

export function R3FQuiverTrees({ runtime }: { readonly runtime: unknown }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const trees: QuiverTree[] = useMemo(() => {
    const rt = runtime as { sim?: { state?: { terrain?: unknown } } } | null;
    const state = rt?.sim?.state;
    const terrain = state?.terrain as
      | Parameters<typeof calculateQuiverTrees>[0]
      | undefined;
    if (!terrain) return [];
    // WORLD.KOKERBOOM.2 — this used to pass `[]`, i.e. clear NOTHING. That was survivable only while
    // the trees were confined to Highland/Mountain, far from any building. Now that they grow on the
    // dunes the town stands on, siting must respect the same footprints the foliage layer does, or a
    // kokerboom ends up inside a house — and a placed kokerboom is never removed by later
    // construction (that is what "protected" means here), so it would stay there.
    return calculateQuiverTrees(
      terrain,
      COLONY.world.seaLevel,
      worldClearRects(state as never),
    );
  }, [runtime]);

  const geometry = useMemo(() => buildQuiverGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0.0,
        flatShading: true,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !trees.length) return;
    const dummy = new THREE.Object3D();
    trees.forEach((t, i) => {
      const h = quiverTreeHeight(t.age);
      dummy.position.set(t.wx, t.wy, t.wz);
      dummy.rotation.set(0, t.yaw, 0);
      // Older trees are both taller and stouter, so an old one reads as massive rather than stretched.
      dummy.scale.set(h * 0.55, h, h * 0.55);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = trees.length;
  }, [trees]);

  if (!trees.length) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, trees.length]}
      castShadow
      receiveShadow
      frustumCulled={false}
    />
  );
}
