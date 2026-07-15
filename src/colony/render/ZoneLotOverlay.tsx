import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

// Spec 128 — the "purchasable land" overlay. The old zone-ground overlay was ONE flat
// lot-sized box (up to 44×56m) at the lot-CENTRE height: on any slope it floated mid-air /
// knifed through hills (the operator's "unpurchased land floating above the ground"). This
// renders the same overlay as one INSTANCED mesh per lot — one thin tile per cell, each at
// its own terrain height — so the tint drapes the ground like painted land. The mesh keeps
// the legacy `zone-ground-${lot.id}` name: e2e/reactivity.spec.ts counts those to prove a
// placed/demolished plot reaches the render.

interface ZoneLotOverlayProps {
  lot: {
    id: string | number;
    x: number;
    y: number;
    w: number;
    h: number;
    zone?: string;
  };
  terrain: { size: number; worldY: (x: number, y: number) => number };
}

export function ZoneLotOverlay({ lot, terrain }: ZoneLotOverlayProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const cap = lot.w * lot.h;
  const color = lot.zone === "commercial" ? "#55cfff" : "#55ff55";

  const assets = useMemo(
    () => ({
      geo: new THREE.BoxGeometry(4, 0.1, 4),
      mat: new THREE.MeshStandardMaterial({
        color,
        opacity: 0.35,
        transparent: true,
        roughness: 1.0,
      }),
      m4: new THREE.Matrix4(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(
    () => () => {
      assets.geo.dispose();
      assets.mat.dispose();
    },
    [assets],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const N = terrain.size;
    // lot.x/lot.y is the lot CENTRE cell (same convention as the bulldoze preview)
    const x0 = lot.x - Math.floor((lot.w - 1) / 2);
    const y0 = lot.y - Math.floor((lot.h - 1) / 2);
    let placed = 0;
    for (let dy = 0; dy < lot.h; dy++) {
      for (let dx = 0; dx < lot.w; dx++) {
        if (placed >= mesh.instanceMatrix.count) break;
        const cx = x0 + dx;
        const cy = y0 + dy;
        const wY = terrain.worldY(cx, cy);
        assets.m4.identity();
        assets.m4.setPosition((cx - N / 2) * 4, wY + 0.06, (cy - N / 2) * 4);
        mesh.setMatrixAt(placed++, assets.m4);
      }
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
  }, [lot, terrain, assets]);

  return (
    <instancedMesh
      ref={meshRef}
      name={`zone-ground-${lot.id}`}
      args={[assets.geo, assets.mat, cap]}
      frustumCulled={false}
    />
  );
}
