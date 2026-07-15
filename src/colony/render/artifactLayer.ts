// Spec 126 — the civic-art artifacts (bench, lamppost, planter, fountain, shade_tree,
// notice_board, wayfinder), R3F port of the legacy updateArtifacts path. The catalog is
// deterministic ColonySim state (sim.state.artifacts, createVisualArtifacts), so R3FArtifacts
// reads sim.state directly. This module holds the PURE placement transform (node-testable)
// and the (three.js-coupled) per-kind geometry+material builder, legacy-verbatim.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ArtifactKind, VisualArtifact } from "../artifacts";

export interface ArtifactTransform {
  wx: number;
  wy: number;
  wz: number;
  /** Y rotation — legacy -rot. */
  rotY: number;
  /** Footprint scale (Y stays 1). */
  scaleW: number;
  scaleH: number;
}

/** Grid cell -> world transform for one artifact (4m grid); a small lift above the ground
 *  and the footprint scale, matching the legacy placeArtifact. */
export function artifactTransform(
  item: Pick<VisualArtifact, "x" | "y" | "rot" | "footprint">,
  size: number,
  groundY: (x: number, y: number) => number,
): ArtifactTransform {
  return {
    wx: (item.x - size / 2) * 4,
    wy: Math.max(0, groundY(Math.round(item.x), Math.round(item.y))) + 0.015,
    wz: (item.y - size / 2) * 4,
    rotY: -item.rot,
    scaleW: item.footprint.w,
    scaleH: item.footprint.h,
  };
}

/** Spec 126 revision (the operator's mid-road bus-stop lookalike, 2026-07-10): the widened
 *  boot carriageway paves over civic-art cells near the landing — the live town had the
 *  lamppost, wayfinder, bench and fountain all standing ON road cells (the golden wayfinder
 *  panels read as a bus-stop sign in the carriageway). An artifact whose cell the road
 *  covers slides to the nearest unpaved cell — deterministic outward ring walk, radius 3 —
 *  or hides when the whole block is asphalt. */
export function nudgeOffRoads(
  item: Pick<VisualArtifact, "x" | "y">,
  isRoad: (x: number, y: number) => boolean,
  size: number,
): { x: number; y: number } | null {
  const cx = Math.round(item.x),
    cy = Math.round(item.y);
  if (!isRoad(cx, cy)) return { x: item.x, y: item.y };
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx,
          ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (!isRoad(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

export interface ArtifactAsset {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** Build the legacy-verbatim geometry + material for each artifact kind. Each geometry is a
 *  merge of low-poly primitives (feet at ground). The caller owns disposal. */
export function buildArtifactAssets(): Record<ArtifactKind, ArtifactAsset> {
  const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;

  const benchSeat = new THREE.BoxGeometry(1.15, 0.12, 0.38);
  benchSeat.translate(0, 0.38, 0);
  const benchBack = new THREE.BoxGeometry(1.15, 0.45, 0.1);
  benchBack.translate(0, 0.58, -0.22);

  const lampPost = new THREE.CylinderGeometry(0.06, 0.07, 1.35, 8);
  lampPost.translate(0, 0.68, 0);
  const lampHead = new THREE.SphereGeometry(0.17, 8, 6);
  lampHead.translate(0, 1.42, 0);

  const planterBase = new THREE.CylinderGeometry(0.44, 0.5, 0.32, 8);
  planterBase.translate(0, 0.16, 0);
  const planterPlant = new THREE.SphereGeometry(0.34, 8, 6);
  planterPlant.scale(1, 0.72, 1);
  planterPlant.translate(0, 0.52, 0);

  const fountainBase = new THREE.CylinderGeometry(0.72, 0.78, 0.22, 16);
  fountainBase.translate(0, 0.11, 0);
  const fountainBowl = new THREE.CylinderGeometry(0.42, 0.5, 0.24, 16);
  fountainBowl.translate(0, 0.34, 0);
  const fountainJet = new THREE.CylinderGeometry(0.06, 0.08, 0.52, 8);
  fountainJet.translate(0, 0.72, 0);

  const shadeTrunk = new THREE.CylinderGeometry(0.16, 0.22, 1.05, 8);
  shadeTrunk.translate(0, 0.52, 0);
  const shadeCrown = new THREE.SphereGeometry(0.72, 10, 8);
  shadeCrown.scale(1, 0.82, 1);
  shadeCrown.translate(0, 1.18, 0);

  const noticePost = new THREE.BoxGeometry(0.12, 0.92, 0.12);
  noticePost.translate(0, 0.46, 0);
  const noticePanel = new THREE.BoxGeometry(0.92, 0.5, 0.08);
  noticePanel.translate(0, 0.92, 0);
  const noticeCap = new THREE.BoxGeometry(1.0, 0.08, 0.12);
  noticeCap.translate(0, 1.21, 0);

  const wayfinderPost = new THREE.CylinderGeometry(0.07, 0.08, 1.05, 8);
  wayfinderPost.translate(0, 0.52, 0);
  const wayfinderArmA = new THREE.BoxGeometry(0.72, 0.16, 0.08);
  wayfinderArmA.translate(0.24, 0.92, 0);
  const wayfinderArmB = new THREE.BoxGeometry(0.58, 0.14, 0.08);
  wayfinderArmB.translate(-0.18, 0.72, 0);

  return {
    bench: {
      geometry: merge([benchSeat, benchBack]),
      material: new THREE.MeshStandardMaterial({
        color: 0x8b5a35,
        roughness: 0.82,
      }),
    },
    lamppost: {
      geometry: merge([lampPost, lampHead]),
      material: new THREE.MeshStandardMaterial({
        color: 0x2f3740,
        emissive: 0xffd67a,
        emissiveIntensity: 0.3,
        roughness: 0.45,
        metalness: 0.25,
      }),
    },
    planter: {
      geometry: merge([planterBase, planterPlant]),
      material: new THREE.MeshStandardMaterial({
        color: 0x3d7a45,
        roughness: 0.9,
      }),
    },
    fountain: {
      geometry: merge([fountainBase, fountainBowl, fountainJet]),
      material: new THREE.MeshStandardMaterial({
        color: 0x6f8da7,
        roughness: 0.55,
      }),
    },
    shade_tree: {
      geometry: merge([shadeTrunk, shadeCrown]),
      material: new THREE.MeshStandardMaterial({
        color: 0x2f6f3e,
        roughness: 0.88,
      }),
    },
    notice_board: {
      geometry: merge([noticePost, noticePanel, noticeCap]),
      material: new THREE.MeshStandardMaterial({
        color: 0x8f6a3a,
        roughness: 0.78,
      }),
    },
    wayfinder: {
      geometry: merge([wayfinderPost, wayfinderArmA, wayfinderArmB]),
      material: new THREE.MeshStandardMaterial({
        color: 0xd8b45c,
        roughness: 0.74,
      }),
    },
  };
}
