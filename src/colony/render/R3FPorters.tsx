import { leveledWorldY } from './terrainLeveling';
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ColonySim } from '../sim';
import { porterStatus } from '../build';
import { COLONY } from '../config';
import {
  PORTER_PILE_CAP,
  PORTER_CART_CAP,
  CRATE,
  CART,
  layPiles,
  pileUnits,
  stepCart,
  type PorterCart,
} from './porterLayer';

// Spec 131 — the porter economy made visible (legacy spec 073). Crates + sacks pile up at
// each Porter Shed quantised to the live materials/food stock (grow AND shrink), and porter
// handcarts run the roads near the sheds while staffed. Piles re-lay only when the quantised
// stock or shed set changes; carts are render-side ambience stepped per frame (the same
// idiom as the pedestrian crowd — deterministic sim state is untouched).

interface R3FPortersProps {
  /** Spec 134 - the leveled-ground map: pads, graded roads and landscape edits reshape
   *  the visible mesh, and anything standing on the ground must stand on THAT surface. */
  terrainLevel?: ReadonlyMap<number, number> | null;
  sim: ColonySim;
}

export function R3FPorters({ sim, terrainLevel }: R3FPortersProps) {
  const pileRef = useRef<THREE.InstancedMesh>(null);
  const cartRef = useRef<THREE.InstancedMesh>(null);
  const carts = useRef<PorterCart[]>([]);
  const pileSig = useRef('');
  const levelSeen = useRef<ReadonlyMap<number, number> | null | undefined>(undefined);
  const lastT = useRef<number | null>(null);

  const assets = useMemo(() => {
    const crateGeo = new THREE.BoxGeometry(CRATE.size, CRATE.size, CRATE.size);
    crateGeo.translate(0, CRATE.lift, 0);
    const cartGeo = new THREE.BoxGeometry(CART.w, CART.h, CART.d);
    cartGeo.translate(0, CART.lift, 0);
    return {
      crateGeo,
      cartGeo,
      pileMat: new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true }),
      cartMat: new THREE.MeshStandardMaterial({ color: CART.color, roughness: 0.6, metalness: 0.1 }),
      m4: new THREE.Matrix4(),
      quat: new THREE.Quaternion(),
      pos: new THREE.Vector3(),
      one: new THREE.Vector3(1, 1, 1),
      axis: new THREE.Vector3(0, 1, 0),
      color: new THREE.Color(),
    };
  }, []);
  useEffect(() => () => {
    assets.crateGeo.dispose();
    assets.cartGeo.dispose();
    assets.pileMat.dispose();
    assets.cartMat.dispose();
  }, [assets]);

  useFrame(() => {
    const s = sim.state;
    const t = s.terrain;
    const N = t.size;
    const sheds = s.buildings.filter((b) => b.artifact.kind === 'porter');
    const pileMesh = pileRef.current;
    const cartMesh = cartRef.current;
    if (!pileMesh || !cartMesh) return;

    // ---- piles: re-lay only when the quantised stock or the shed set changes ----
    const matUnits = pileUnits(s.materials ?? 0, COLONY.build.pilePerMaterials, COLONY.build.pileMaxUnits);
    const foodUnits = pileUnits(s.food ?? 0, COLONY.build.pilePerFood, COLONY.build.pileMaxUnits);
    // the leveling map re-shapes the ground the piles sit on - a new map identity must
    // re-lay them even when the stock signature is unchanged (spec 134)
    if (levelSeen.current !== terrainLevel) {
      levelSeen.current = terrainLevel;
      pileSig.current = '';
    }
    const sig = `${sheds.map((b) => `${b.x},${b.y}`).join('|')}:${matUnits}:${foodUnits}`;
    if (sig !== pileSig.current) {
      pileSig.current = sig;
      const piles = layPiles(sheds, matUnits, foodUnits, N, (x, y) => leveledWorldY(t, terrainLevel, x, y));
      let pi = 0;
      for (const p of piles) {
        if (pi >= pileMesh.instanceMatrix.count) break;
        assets.pos.set(p.wx, p.wy, p.wz);
        assets.quat.identity();
        assets.m4.compose(assets.pos, assets.quat, assets.one);
        pileMesh.setMatrixAt(pi, assets.m4);
        assets.color.setHex(p.color);
        pileMesh.setColorAt(pi, assets.color);
        pi++;
      }
      pileMesh.count = pi;
      pileMesh.instanceMatrix.needsUpdate = true;
      if (pileMesh.instanceColor) pileMesh.instanceColor.needsUpdate = true;
    }

    // ---- carts: handcarts on the roads while the sheds are staffed ----
    const status = porterStatus(s);
    const want = sheds.length && status.working ? Math.min(PORTER_CART_CAP, status.porters) : 0;
    while (carts.current.length < want) {
      const shed = sheds[carts.current.length % sheds.length]!;
      carts.current.push({
        x: shed.x,
        y: shed.y,
        tx: shed.x,
        ty: shed.y,
        spd: 0.6 + Math.random() * 0.5,
      });
    }
    if (carts.current.length > want) carts.current.length = want;

    const now = performance.now();
    const dt = lastT.current ? Math.min(0.05, (now - lastT.current) / 1000) : 1 / 60;
    lastT.current = now;

    let ci = 0;
    for (const cart of carts.current) {
      const heading = stepCart(cart, dt, s.roadSet, Math.random);
      const wy = Math.max(0, leveledWorldY(t, terrainLevel, Math.round(cart.x), Math.round(cart.y)));
      assets.pos.set((cart.x - N / 2) * 4, wy + 0.05, (cart.y - N / 2) * 4);
      assets.quat.setFromAxisAngle(assets.axis, -heading);
      assets.m4.compose(assets.pos, assets.quat, assets.one);
      cartMesh.setMatrixAt(ci, assets.m4);
      ci++;
    }
    cartMesh.count = ci;
    cartMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group name="porters">
      <instancedMesh
        ref={pileRef}
        name="porter-piles"
        args={[assets.crateGeo, assets.pileMat, PORTER_PILE_CAP]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={cartRef}
        name="porter-carts"
        args={[assets.cartGeo, assets.cartMat, PORTER_CART_CAP]}
        castShadow
        frustumCulled={false}
      />
    </group>
  );
}
