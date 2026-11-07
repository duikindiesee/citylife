import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import {
  ROAD_RIBBON_LIFT,
  buildRoadRibbons,
  ROAD_MESH_NAME_ASPHALT,
  ROAD_MESH_NAME_EDGE_LINES,
  ROAD_MESH_NAME_DASHES,
  ROAD_MESH_NAME_JUNCTION_CAPS,
  ROAD_MESH_NAME_JUNCTION_PAINT,
  isRoadAsphaltMesh,
  isRoadPaintMesh,
  edgeLineOffset,
  EDGE_LINE_HALF_WIDTH,
  type RoadWay,
} from "../src/colony/render/roadRibbon";
import {
  deriveDrivewayApronCells,
  homeDrivewayGeometry,
  isPointOnRenderedRoadRibbon,
} from "../src/colony/render/HomeDrivewaySurface";
import { getSmoothRoadY } from "../src/colony/render/roadSurface";
import { leveledWorldYAt } from "../src/colony/render/terrainLeveling";
import { ColonyRuntime } from "../src/colony/runtime";
import { MultiplayerStatusHUD } from "../src/colony/ui/MultiplayerStatusHUD";
import type { PartyRaceState } from "../src/colony/multiplayer/multiplayerClient";

// ---------------------------------------------------------------------------
// Setup Lightweight Mounted DOM for Headless React createRoot
// ---------------------------------------------------------------------------
function setupMountedDOM() {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  class MockHTMLElement {}
  class MockHTMLIFrameElement extends MockHTMLElement {}

  for (const type of [
    "Element",
    "HTMLElement",
    "HTMLCanvasElement",
    "HTMLDivElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLSelectElement",
    "HTMLAnchorElement",
    "HTMLImageElement",
    "HTMLSpanElement",
    "SVGElement",
  ]) {
    (globalThis as Record<string, unknown>)[type] = class extends MockHTMLElement {};
  }
  (globalThis as any).HTMLIFrameElement = MockHTMLIFrameElement;

  let mockDoc: Record<string, unknown>;
  const createMockNode = (tag: string) => {
    const nodeListeners = new Map<string, Set<(e: unknown) => void>>();
    const propsStore: Record<string, any> = {};
    const baseNode: Record<string, unknown> = {
      tagName: tag.toUpperCase(),
      clientWidth: 800,
      clientHeight: 600,
      style: {},
      children: [] as unknown[],
      parentNode: null,
      ownerDocument: mockDoc,
      nodeType: 1,
      _listeners: nodeListeners,
      getAttribute: (attr: string) => (baseNode[attr] as unknown) ?? (baseNode[`data-${attr}`] as unknown) ?? null,
      setAttribute: (attr: string, val: any) => {
        baseNode[attr] = val;
        propsStore[attr] = val;
      },
      removeAttribute: (attr: string) => {
        delete baseNode[attr];
      },
      hasAttribute: (attr: string) => baseNode[attr] != null,
      addEventListener: (evt: string, fn: (e: unknown) => void) => {
        if (!nodeListeners.has(evt)) nodeListeners.set(evt, new Set());
        nodeListeners.get(evt)!.add(fn);
      },
      removeEventListener: (evt: string, fn: (e: unknown) => void) => {
        nodeListeners.get(evt)?.delete(fn);
      },
      dispatchEvent: () => {},
      appendChild: (child: Record<string, unknown>) => {
        child.parentNode = baseNode;
        (baseNode.children as unknown[]).push(child);
        return child;
      },
      removeChild: (child: Record<string, unknown>) => {
        const arr = baseNode.children as unknown[];
        const idx = arr.indexOf(child);
        if (idx !== -1) arr.splice(idx, 1);
        child.parentNode = null;
        return child;
      },
      insertBefore: (newChild: Record<string, unknown>, refChild: unknown) => {
        const arr = baseNode.children as unknown[];
        const idx = arr.indexOf(refChild);
        if (idx !== -1) arr.splice(idx, 0, newChild);
        else arr.push(newChild);
        newChild.parentNode = baseNode;
        return newChild;
      },
    };
    const proxyNode = new Proxy(baseNode, {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return propsStore[prop as string];
      },
      set(target, prop, value, receiver) {
        if (prop in target) return Reflect.set(target, prop, value, receiver);
        propsStore[prop as string] = value;
        return true;
      },
      ownKeys(target) {
        return Array.from(new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(propsStore)]));
      },
      getOwnPropertyDescriptor(target, prop) {
        if (prop in target) return Reflect.getOwnPropertyDescriptor(target, prop);
        if (prop in propsStore) {
          return {
            value: propsStore[prop as string],
            writable: true,
            enumerable: true,
            configurable: true,
          };
        }
        return undefined;
      },
    });
    return proxyNode;
  };

  mockDoc = {
    nodeType: 9,
    createElement: (tag: string) => createMockNode(tag),
    createElementNS: (_ns: string, tag: string) => createMockNode(tag),
    createTextNode: (text: string) => ({ nodeType: 3, nodeValue: text }),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    body: createMockNode("body"),
    defaultView: globalThis,
    HTMLIFrameElement: MockHTMLIFrameElement,
  };
  (mockDoc.body as Record<string, unknown>).ownerDocument = mockDoc;

  const windowListeners = new Map<string, Set<(e: unknown) => void>>();
  const g = globalThis as Record<string, unknown>;
  g.window = globalThis;
  (globalThis as any).location = { search: "", origin: "http://localhost" };
  g.addEventListener = (evt: string, fn: (e: unknown) => void) => {
    if (!windowListeners.has(evt)) windowListeners.set(evt, new Set());
    windowListeners.get(evt)!.add(fn);
  };
  g.removeEventListener = (evt: string, fn: (e: unknown) => void) => {
    windowListeners.get(evt)?.delete(fn);
  };
  g.dispatchEvent = (evt: { type: string }) => {
    windowListeners.get(evt.type)?.forEach((fn) => fn(evt));
  };
  g.document = mockDoc;
}

function getReactProps(node: any): any {
  if (!node) return null;
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")) {
      const val = node[key];
      return val?.memoizedProps || val;
    }
  }
  return null;
}

function findNode(node: any, predicate: (n: any) => boolean): any {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Worker's Baseline Oracle from tests/homeDrivewayAndCameraEquivalence.test.ts
// ---------------------------------------------------------------------------
export interface OraclePoint3D {
  x: number;
  y: number;
  z: number;
}

export interface OracleEvaluationResult {
  testedMeshCount: number;
  evaluatedTriangleCount: number;
  testedPointCount: number;
  contacted: boolean;
  minDistXZ: number | null;
  minDist3D: number | null;
  closestSurfacePoint: [number, number, number] | null;
  closestQueryPoint: OraclePoint3D | null;
  surfaceType: "asphalt" | "paint" | "unsupported_empty" | "mixed";
  asphaltMeshCount: number;
  paintMeshCount: number;
}

export function closestPointOnTriangle3DBaseline(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): [number, number, number] {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az];

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [bx, by, bz];

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [ax + v * abx, ay + v * aby, az + v * abz];
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [cx, cy, cz];

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [ax + w * acx, ay + w * acy, az + w * acz];
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)];
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
}

export function evaluateSuppliedGeometryContactBaseline(
  queryPoints: OraclePoint3D[],
  meshes: THREE.Mesh[],
  options?: {
    requireAsphalt?: boolean;
    contactThreshold3D?: number;
    bbox?: { minX: number; maxX: number; minZ: number; maxZ: number };
  }
): OracleEvaluationResult {
  const threshold = options?.contactThreshold3D ?? 0.02;
  const requireAsphalt = options?.requireAsphalt ?? false;
  const asphaltMeshes = meshes.filter(isRoadAsphaltMesh);
  const paintMeshes = meshes.filter(isRoadPaintMesh);

  const targetMeshes = requireAsphalt ? asphaltMeshes : meshes;

  if (targetMeshes.length === 0 || queryPoints.length === 0) {
    return {
      testedMeshCount: meshes.length,
      evaluatedTriangleCount: 0,
      testedPointCount: 0,
      contacted: false,
      minDistXZ: null,
      minDist3D: null,
      closestSurfacePoint: null,
      closestQueryPoint: null,
      surfaceType: meshes.length === 0 ? "unsupported_empty" : (asphaltMeshes.length > 0 ? "asphalt" : "paint"),
      asphaltMeshCount: asphaltMeshes.length,
      paintMeshCount: paintMeshes.length,
    };
  }

  let min3D: number | null = null;
  let minXZ: number | null = null;
  let bestSurfacePt: [number, number, number] | null = null;
  let bestQueryPt: OraclePoint3D | null = null;
  let triangleCount = 0;
  let pointCount = 0;

  for (const mesh of targetMeshes) {
    const pos = mesh.geometry?.getAttribute("position");
    if (!pos || pos.count === 0) continue;

    for (let t = 0; t < pos.count; t += 3) {
      const ax = pos.getX(t), ay = pos.getY(t), az = pos.getZ(t);
      const bx = pos.getX(t + 1), by = pos.getY(t + 1), bz = pos.getZ(t + 1);
      const cx = pos.getX(t + 2), cy = pos.getY(t + 2), cz = pos.getZ(t + 2);

      if (options?.bbox) {
        const triMinX = Math.min(ax, bx, cx);
        const triMaxX = Math.max(ax, bx, cx);
        const triMinZ = Math.min(az, bz, cz);
        const triMaxZ = Math.max(az, bz, cz);
        if (
          triMaxX < options.bbox.minX ||
          triMinX > options.bbox.maxX ||
          triMaxZ < options.bbox.minZ ||
          triMinZ > options.bbox.maxZ
        ) {
          continue;
        }
      }

      triangleCount++;

      for (const pt of queryPoints) {
        pointCount++;
        const [qx, qy, qz] = closestPointOnTriangle3DBaseline(
          pt.x, pt.y, pt.z,
          ax, ay, az,
          bx, by, bz,
          cx, cy, cz
        );
        const dXZ = Math.hypot(pt.x - qx, pt.z - qz);
        const d3D = Math.hypot(pt.x - qx, pt.y - qy, pt.z - qz);

        if (min3D === null || d3D < min3D) {
          min3D = d3D;
          minXZ = dXZ;
          bestSurfacePt = [qx, qy, qz];
          bestQueryPt = pt;
        }
      }
    }
  }

  const surfaceType =
    asphaltMeshes.length > 0 && paintMeshes.length === 0
      ? "asphalt"
      : paintMeshes.length > 0 && asphaltMeshes.length === 0
        ? "paint"
        : asphaltMeshes.length > 0 && paintMeshes.length > 0
          ? "mixed"
          : "unsupported_empty";

  return {
    testedMeshCount: targetMeshes.length,
    evaluatedTriangleCount: triangleCount,
    testedPointCount: pointCount,
    contacted: min3D !== null && min3D < threshold,
    minDistXZ: minXZ,
    minDist3D: min3D,
    closestSurfacePoint: bestSurfacePt,
    closestQueryPoint: bestQueryPt,
    surfaceType,
    asphaltMeshCount: asphaltMeshes.length,
    paintMeshCount: paintMeshes.length,
  };
}

// ---------------------------------------------------------------------------
// Hardened Oracle: Zero-Length Edge Guards, Indexed Geometry Resolution & Refusal
// ---------------------------------------------------------------------------
export function closestPointOnTriangle3DRobust(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): [number, number, number] {
  // If coordinates are invalid/NaN/undefined, cleanly refuse
  if (
    !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
    !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz) ||
    !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)
  ) {
    return [0, 0, 0];
  }

  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const lenSqAB = abx * abx + aby * aby + abz * abz;
  const lenSqAC = acx * acx + acy * acy + acz * acz;

  // Fully degenerate point triangle (A == B == C)
  if (lenSqAB < 1e-12 && lenSqAC < 1e-12) {
    return [ax, ay, az];
  }

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az];

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [bx, by, bz];

  const vc = d1 * d4 - d3 * d2;
  // Edge AB guard: only enter if edge AB is non-degenerate (lenSqAB > 0) and d1 - d3 > 0
  if (lenSqAB > 1e-12 && vc <= 0 && d1 >= 0 && d3 <= 0 && (d1 - d3) > 1e-12) {
    const v = d1 / (d1 - d3);
    return [ax + v * abx, ay + v * aby, az + v * abz];
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [cx, cy, cz];

  const vb = d5 * d2 - d1 * d6;
  // Edge AC guard: only enter if edge AC is non-degenerate and d2 - d6 > 0
  if (lenSqAC > 1e-12 && vb <= 0 && d2 >= 0 && d6 <= 0 && (d2 - d6) > 1e-12) {
    const w = d2 / (d2 - d6);
    return [ax + w * acx, ay + w * acy, az + w * acz];
  }

  const bcx = cx - bx, bcy = cy - by, bcz = cz - bz;
  const lenSqBC = bcx * bcx + bcy * bcy + bcz * bcz;
  const va = d3 * d6 - d5 * d4;
  const denomBC = (d4 - d3) + (d5 - d6);
  if (lenSqBC > 1e-12 && va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0 && denomBC > 1e-12) {
    const w = (d4 - d3) / denomBC;
    return [bx + w * bcx, by + w * bcy, bz + w * bcz];
  }

  const denom = va + vb + vc;
  if (Math.abs(denom) > 1e-12) {
    const invDenom = 1 / denom;
    const v = vb * invDenom;
    const w = vc * invDenom;
    return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
  }

  // Fallback for colinear / zero-area triangles: pick nearest vertex
  const dSqA = (px - ax) ** 2 + (py - ay) ** 2 + (pz - az) ** 2;
  const dSqB = (px - bx) ** 2 + (py - by) ** 2 + (pz - bz) ** 2;
  const dSqC = (px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2;
  if (dSqA <= dSqB && dSqA <= dSqC) return [ax, ay, az];
  if (dSqB <= dSqC) return [bx, by, bz];
  return [cx, cy, cz];
}

export function evaluateSuppliedGeometryContactRobust(
  queryPoints: OraclePoint3D[],
  meshes: THREE.Mesh[],
  options?: {
    requireAsphalt?: boolean;
    contactThreshold3D?: number;
    bbox?: { minX: number; maxX: number; minZ: number; maxZ: number };
  }
): OracleEvaluationResult {
  const threshold = options?.contactThreshold3D ?? 0.02;
  const requireAsphalt = options?.requireAsphalt ?? false;
  const asphaltMeshes = meshes.filter(isRoadAsphaltMesh);
  const paintMeshes = meshes.filter(isRoadPaintMesh);

  const targetMeshes = requireAsphalt ? asphaltMeshes : meshes;

  if (targetMeshes.length === 0 || queryPoints.length === 0) {
    return {
      testedMeshCount: meshes.length,
      evaluatedTriangleCount: 0,
      testedPointCount: 0,
      contacted: false,
      minDistXZ: null,
      minDist3D: null,
      closestSurfacePoint: null,
      closestQueryPoint: null,
      surfaceType: meshes.length === 0 ? "unsupported_empty" : (asphaltMeshes.length > 0 ? "asphalt" : "paint"),
      asphaltMeshCount: asphaltMeshes.length,
      paintMeshCount: paintMeshes.length,
    };
  }

  let min3D: number | null = null;
  let minXZ: number | null = null;
  let bestSurfacePt: [number, number, number] | null = null;
  let bestQueryPt: OraclePoint3D | null = null;
  let triangleCount = 0;
  let pointCount = 0;

  for (const mesh of targetMeshes) {
    const geom = mesh.geometry;
    if (!geom) continue;
    const pos = geom.getAttribute("position");
    if (!pos || pos.count < 3) continue;

    const index = geom.getIndex();
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);

    for (let t = 0; t < triCount; t++) {
      let idxA: number, idxB: number, idxC: number;
      if (index) {
        idxA = index.getX(t * 3);
        idxB = index.getX(t * 3 + 1);
        idxC = index.getX(t * 3 + 2);
      } else {
        idxA = t * 3;
        idxB = t * 3 + 1;
        idxC = t * 3 + 2;
      }

      if (idxA >= pos.count || idxB >= pos.count || idxC >= pos.count) continue;

      const ax = pos.getX(idxA), ay = pos.getY(idxA), az = pos.getZ(idxA);
      const bx = pos.getX(idxB), by = pos.getY(idxB), bz = pos.getZ(idxB);
      const cx = pos.getX(idxC), cy = pos.getY(idxC), cz = pos.getZ(idxC);

      if (options?.bbox) {
        const triMinX = Math.min(ax, bx, cx);
        const triMaxX = Math.max(ax, bx, cx);
        const triMinZ = Math.min(az, bz, cz);
        const triMaxZ = Math.max(az, bz, cz);
        if (
          triMaxX < options.bbox.minX ||
          triMinX > options.bbox.maxX ||
          triMaxZ < options.bbox.minZ ||
          triMinZ > options.bbox.maxZ
        ) {
          continue;
        }
      }

      triangleCount++;

      for (const pt of queryPoints) {
        pointCount++;
        const [qx, qy, qz] = closestPointOnTriangle3DRobust(
          pt.x, pt.y, pt.z,
          ax, ay, az,
          bx, by, bz,
          cx, cy, cz
        );
        const dXZ = Math.hypot(pt.x - qx, pt.z - qz);
        const d3D = Math.hypot(pt.x - qx, pt.y - qy, pt.z - qz);

        if (Number.isFinite(d3D) && (min3D === null || d3D < min3D)) {
          min3D = d3D;
          minXZ = dXZ;
          bestSurfacePt = [qx, qy, qz];
          bestQueryPt = pt;
        }
      }
    }
  }

  const surfaceType =
    asphaltMeshes.length > 0 && paintMeshes.length === 0
      ? "asphalt"
      : paintMeshes.length > 0 && asphaltMeshes.length === 0
        ? "paint"
        : asphaltMeshes.length > 0 && paintMeshes.length > 0
          ? "mixed"
          : "unsupported_empty";

  return {
    testedMeshCount: targetMeshes.length,
    evaluatedTriangleCount: triangleCount,
    testedPointCount: pointCount,
    contacted: min3D !== null && min3D < threshold,
    minDistXZ: minXZ,
    minDist3D: min3D,
    closestSurfacePoint: bestSurfacePt,
    closestQueryPoint: bestQueryPt,
    surfaceType,
    asphaltMeshCount: asphaltMeshes.length,
    paintMeshCount: paintMeshes.length,
  };
}

// ---------------------------------------------------------------------------
// TEST SUITE: Empirical Adversarial Challenge (M2-02 Road Contact & M2-03 HUD)
// ---------------------------------------------------------------------------
describe("Milestone 2 Adversarial Challenge: Road Contact Geometry Oracle & HUD Stress", () => {
  beforeEach(() => {
    setupMountedDOM();
  });

  // =========================================================================
  // Section 1: Surface Predicate Classification & Boundary Differentiation
  // =========================================================================
  describe("1. Mesh Surface Classification Predicates (isRoadAsphaltMesh vs isRoadPaintMesh)", () => {
    it("1.1 strictly classifies named asphalt meshes and rejects paint meshes", () => {
      const asphaltMesh = new THREE.Mesh(new THREE.BufferGeometry());
      asphaltMesh.name = ROAD_MESH_NAME_ASPHALT;
      expect(isRoadAsphaltMesh(asphaltMesh)).toBe(true);
      expect(isRoadPaintMesh(asphaltMesh)).toBe(false);

      const capMesh = new THREE.Mesh(new THREE.BufferGeometry());
      capMesh.name = ROAD_MESH_NAME_JUNCTION_CAPS;
      expect(isRoadAsphaltMesh(capMesh)).toBe(true);
      expect(isRoadPaintMesh(capMesh)).toBe(false);
    });

    it("1.2 strictly classifies named paint meshes and rejects asphalt classification", () => {
      const edgeLineMesh = new THREE.Mesh(new THREE.BufferGeometry());
      edgeLineMesh.name = ROAD_MESH_NAME_EDGE_LINES;
      expect(isRoadPaintMesh(edgeLineMesh)).toBe(true);
      expect(isRoadAsphaltMesh(edgeLineMesh)).toBe(false);

      const dashesMesh = new THREE.Mesh(new THREE.BufferGeometry());
      dashesMesh.name = ROAD_MESH_NAME_DASHES;
      expect(isRoadPaintMesh(dashesMesh)).toBe(true);
      expect(isRoadAsphaltMesh(dashesMesh)).toBe(false);

      const juncPaintMesh = new THREE.Mesh(new THREE.BufferGeometry());
      juncPaintMesh.name = ROAD_MESH_NAME_JUNCTION_PAINT;
      expect(isRoadPaintMesh(juncPaintMesh)).toBe(true);
      expect(isRoadAsphaltMesh(juncPaintMesh)).toBe(false);
    });

    it("1.3 identifies anonymous meshes by asphalt and paint material hex colors", () => {
      // Mid asphalt grey (0x595f6a) and Avenue asphalt (0x646b78)
      for (const hex of [0x595f6a, 0x646b78]) {
        const mat = new THREE.MeshStandardMaterial({ color: hex });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        expect(isRoadAsphaltMesh(mesh)).toBe(true);
        expect(isRoadPaintMesh(mesh)).toBe(false);
      }

      // Edge white (0xe8ecf2) and Dash yellow (0xf2cf52)
      for (const hex of [0xe8ecf2, 0xf2cf52]) {
        const mat = new THREE.MeshStandardMaterial({ color: hex });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        expect(isRoadPaintMesh(mesh)).toBe(true);
        expect(isRoadAsphaltMesh(mesh)).toBe(false);
      }
    });

    it("1.4 enforces mutual exclusion: no mesh can be simultaneously classified as asphalt and paint", () => {
      const testCases = [
        ROAD_MESH_NAME_ASPHALT,
        ROAD_MESH_NAME_JUNCTION_CAPS,
        ROAD_MESH_NAME_EDGE_LINES,
        ROAD_MESH_NAME_DASHES,
        ROAD_MESH_NAME_JUNCTION_PAINT,
        "UnknownMesh",
        "",
      ];

      for (const name of testCases) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry());
        mesh.name = name;
        const isAsphalt = isRoadAsphaltMesh(mesh);
        const isPaint = isRoadPaintMesh(mesh);
        expect(isAsphalt && isPaint).toBe(false);
      }
    });

    it("1.5 rejects non-road objects (terrain, vehicle, foliage, plain object3D)", () => {
      const plainObj = new THREE.Object3D();
      expect(isRoadAsphaltMesh(plainObj)).toBe(false);
      expect(isRoadPaintMesh(plainObj)).toBe(false);

      const grassMat = new THREE.MeshStandardMaterial({ color: 0x33aa33 });
      const grassMesh = new THREE.Mesh(new THREE.BufferGeometry(), grassMat);
      grassMesh.name = "TerrainGrass";
      expect(isRoadAsphaltMesh(grassMesh)).toBe(false);
      expect(isRoadPaintMesh(grassMesh)).toBe(false);
    });
  });

  // =========================================================================
  // Section 2: Degenerate, Zero-Area, and Colinear Triangle Geometry Stress
  // =========================================================================
  describe("2. Degenerate, Zero-Area & Colinear Triangle Geometry Empirical Stress", () => {
    it("2.1 handles zero-area triangles (A == B == C) with finite distance and zero NaN leaks", () => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([10, 2, 10,  10, 2, 10,  10, 2, 10], 3)
      );
      const mesh = new THREE.Mesh(geom);
      mesh.name = ROAD_MESH_NAME_ASPHALT;

      // Query point directly on the coincident vertex
      const resOn = evaluateSuppliedGeometryContactBaseline([{ x: 10, y: 2, z: 10 }], [mesh]);
      expect(resOn.contacted).toBe(true);
      expect(resOn.minDist3D).toBeCloseTo(0.000, 3);
      expect(Number.isFinite(resOn.minDist3D!)).toBe(true);
      expect(Number.isNaN(resOn.minDist3D!)).toBe(false);

      // Query point 5m away
      const resAway = evaluateSuppliedGeometryContactBaseline([{ x: 13, y: 2, z: 14 }], [mesh]);
      expect(resAway.contacted).toBe(false);
      expect(resAway.minDist3D).toBeCloseTo(5.000, 3);
      expect(Number.isFinite(resAway.minDist3D!)).toBe(true);
    });

    it("2.2 handles colinear triangles along a line with finite distance and zero NaN leaks", () => {
      const geom = new THREE.BufferGeometry();
      // Triangle where A=(0,0,0), B=(2,0,0), C=(4,0,0) (colinear along X axis)
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0, 0,  2, 0, 0,  4, 0, 0], 3)
      );
      const mesh = new THREE.Mesh(geom);
      mesh.name = ROAD_MESH_NAME_ASPHALT;

      // Point projecting onto interior segment [0, 4]
      const resMid = evaluateSuppliedGeometryContactBaseline([{ x: 1.5, y: 3.0, z: 0 }], [mesh]);
      expect(resMid.minDist3D).toBeCloseTo(3.000, 3);
      expect(Number.isFinite(resMid.minDist3D!)).toBe(true);
      expect(Number.isNaN(resMid.minDist3D!)).toBe(false);

      // Point before A (x < 0)
      const resBefore = evaluateSuppliedGeometryContactBaseline([{ x: -3.0, y: 4.0, z: 0 }], [mesh]);
      expect(resBefore.minDist3D).toBeCloseTo(5.000, 3);
      expect(Number.isFinite(resBefore.minDist3D!)).toBe(true);

      // Point beyond C (x > 4)
      const resAfter = evaluateSuppliedGeometryContactBaseline([{ x: 7.0, y: 4.0, z: 0 }], [mesh]);
      expect(resAfter.minDist3D).toBeCloseTo(5.000, 3);
      expect(Number.isFinite(resAfter.minDist3D!)).toBe(true);
    });

    it("2.3 empirically reproduces division-by-zero NaN leak on baseline oracle for degenerate triangle (A==B!=C) and verifies robust mitigation", () => {
      const geom = new THREE.BufferGeometry();
      // Degenerate triangle where A == B != C: A=(0,0,0), B=(0,0,0), C=(1,0,0)
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0, 0,  0, 0, 0,  1, 0, 0], 3)
      );
      const mesh = new THREE.Mesh(geom);
      mesh.name = ROAD_MESH_NAME_ASPHALT;

      // Baseline oracle evaluation:
      // In closestPointOnTriangle3DBaseline:
      // ab = (0,0,0) => d1 = 0, d3 = 0, vc = 0.
      // Condition (vc <= 0 && d1 >= 0 && d3 <= 0) triggers Edge AB and computes v = d1 / (d1 - d3) = 0 / 0 = NaN!
      const baselineResult = evaluateSuppliedGeometryContactBaseline([{ x: 0.5, y: 1.0, z: 0 }], [mesh]);
      expect(Number.isNaN(baselineResult.minDist3D!)).toBe(true);
      expect(Number.isNaN(baselineResult.minDistXZ!)).toBe(true);
      expect(baselineResult.closestSurfacePoint?.[0]).toBeNaN();

      // Robust oracle evaluation:
      // Guards against lenSqAB < 1e-12 and falls through to valid segment AC or nearest vertex
      const robustResult = evaluateSuppliedGeometryContactRobust([{ x: 0.5, y: 1.0, z: 0 }], [mesh]);
      expect(robustResult.minDist3D).not.toBeNull();
      expect(Number.isNaN(robustResult.minDist3D!)).toBe(false);
      expect(Number.isFinite(robustResult.minDist3D!)).toBe(true);
      expect(robustResult.minDist3D).toBeCloseTo(1.000, 3);
      expect(robustResult.closestSurfacePoint).toEqual([0.5, 0, 0]);
    });

    it("2.4 handles malformed / truncated vertex buffers cleanly without crashing or NaN leaks", () => {
      // Buffer with only 2 vertices (count = 2 < 3)
      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0, 0,  1, 1, 1], 3)
      );
      const mesh = new THREE.Mesh(geom);
      mesh.name = ROAD_MESH_NAME_ASPHALT;

      const robustResult = evaluateSuppliedGeometryContactRobust([{ x: 0.5, y: 0.5, z: 0.5 }], [mesh]);
      expect(robustResult.contacted).toBe(false);
      expect(robustResult.evaluatedTriangleCount).toBe(0);
      expect(robustResult.minDist3D).toBeNull();
    });
  });

  // =========================================================================
  // Section 3: Empty Geometries & Indexed vs Non-Indexed BufferGeometry
  // =========================================================================
  describe("3. BufferGeometry Topology Stress: Empty Geometries & Indexed vs Non-Indexed", () => {
    it("3.1 cleanly refuses empty mesh list, empty geometry, and empty query points", () => {
      const qPt = [{ x: 10, y: 0, z: 10 }];
      const emptyMeshResult = evaluateSuppliedGeometryContactRobust(qPt, []);
      expect(emptyMeshResult.contacted).toBe(false);
      expect(emptyMeshResult.evaluatedTriangleCount).toBe(0);
      expect(emptyMeshResult.minDist3D).toBeNull();
      expect(emptyMeshResult.surfaceType).toBe("unsupported_empty");

      const emptyGeom = new THREE.BufferGeometry();
      const mesh = new THREE.Mesh(emptyGeom);
      mesh.name = ROAD_MESH_NAME_ASPHALT;
      const emptyGeomResult = evaluateSuppliedGeometryContactRobust(qPt, [mesh]);
      expect(emptyGeomResult.contacted).toBe(false);
      expect(emptyGeomResult.evaluatedTriangleCount).toBe(0);
      expect(emptyGeomResult.minDist3D).toBeNull();

      const emptyQueryPtResult = evaluateSuppliedGeometryContactRobust([], [mesh]);
      expect(emptyQueryPtResult.contacted).toBe(false);
      expect(emptyQueryPtResult.testedPointCount).toBe(0);
    });

    it("3.2 evaluates non-indexed BufferGeometry with exact triangle iteration", () => {
      // 2 triangles forming a 2x2 unit quad on Y=0
      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([
          // Tri 1
          0, 0, 0,   2, 0, 0,   2, 0, 2,
          // Tri 2
          0, 0, 0,   2, 0, 2,   0, 0, 2,
        ], 3)
      );
      const mesh = new THREE.Mesh(geom);
      mesh.name = ROAD_MESH_NAME_ASPHALT;

      const result = evaluateSuppliedGeometryContactRobust([{ x: 1, y: 0.005, z: 1 }], [mesh]);
      expect(result.evaluatedTriangleCount).toBe(2);
      expect(result.contacted).toBe(true);
      expect(result.minDist3D).toBeCloseTo(0.005, 3);
    });

    it("3.3 evaluates indexed BufferGeometry resolving index buffer correctly", () => {
      // Quad with 4 unique vertices and index [0, 1, 2,  0, 2, 3]
      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([
          0, 0, 0, // 0
          2, 0, 0, // 1
          2, 0, 2, // 2
          0, 0, 2, // 3
        ], 3)
      );
      geom.setIndex([0, 1, 2,  0, 2, 3]);
      const mesh = new THREE.Mesh(geom);
      mesh.name = ROAD_MESH_NAME_ASPHALT;

      // Query point located on Triangle 2: (0, 0, 0) - (2, 0, 2) - (0, 0, 2)
      const qPt = { x: 0.5, y: 0.002, z: 1.5 };

      // Baseline oracle misses Tri 2 because it iterates pos.count/3 = 1 and accesses undefined for vertex 4
      const baselineResult = evaluateSuppliedGeometryContactBaseline([qPt], [mesh]);
      // Triangle 1 does not cover (0.5, 0, 1.5), so baseline measures distance to hypotenuse of Tri 1
      expect(baselineResult.evaluatedTriangleCount).toBe(2); // loops t=0, t=3

      // Robust oracle reads geom.getIndex() and evaluates both indexed triangles
      const robustResult = evaluateSuppliedGeometryContactRobust([qPt], [mesh]);
      expect(robustResult.evaluatedTriangleCount).toBe(2);
      expect(robustResult.contacted).toBe(true);
      expect(robustResult.minDist3D).toBeCloseTo(0.002, 3);
      expect(robustResult.closestSurfacePoint).toEqual([0.5, 0, 1.5]);
    });
  });

  // =========================================================================
  // Section 4: Boundary Discrimination, Distance Thresholds & Remote Negatives
  // =========================================================================
  describe("4. Boundary Differentiation, Apron vs Pre-Apron Separation & Remote Negatives", () => {
    it("4.1 differentiates asphalt surface from paint markings at the boundary edge line", () => {
      // Road carriageway centered on Z=0, width 8 cells (32m), half-width = 16m
      const half = 4; // cells
      const offCells = edgeLineOffset(half); // cells
      const offMetres = offCells * 4; // metres from centerline
      const lineHalfW = EDGE_LINE_HALF_WIDTH * 4; // 0.36m

      // Paint mesh positioned at (offMetres, Y = 0.23, Z = [0..20])
      const paintGeom = new THREE.BufferGeometry();
      paintGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([
          offMetres - lineHalfW, 0.23, 0,
          offMetres + lineHalfW, 0.23, 0,
          offMetres + lineHalfW, 0.23, 20,
          offMetres - lineHalfW, 0.23, 0,
          offMetres + lineHalfW, 0.23, 20,
          offMetres - lineHalfW, 0.23, 20,
        ], 3)
      );
      const paintMesh = new THREE.Mesh(paintGeom);
      paintMesh.name = ROAD_MESH_NAME_EDGE_LINES;

      // Asphalt mesh spanning full width: [-16..16] at Y = 0.18
      const asphaltGeom = new THREE.BufferGeometry();
      asphaltGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([
          -16, 0.18, 0,
           16, 0.18, 0,
           16, 0.18, 20,
          -16, 0.18, 0,
           16, 0.18, 20,
          -16, 0.18, 20,
        ], 3)
      );
      const asphaltMesh = new THREE.Mesh(asphaltGeom);
      asphaltMesh.name = ROAD_MESH_NAME_ASPHALT;

      // Query Point 1: Directly on the paint marking (offMetres, 0.23, 10)
      const qPaintOn = [{ x: offMetres, y: 0.23, z: 10 }];

      // Evaluated against paint meshes without asphalt requirement: exact contact (<0.01m)
      const resPaint = evaluateSuppliedGeometryContactRobust(qPaintOn, [paintMesh], {
        requireAsphalt: false,
      });
      expect(resPaint.contacted).toBe(true);
      expect(resPaint.minDist3D).toBeCloseTo(0.000, 3);
      expect(resPaint.surfaceType).toBe("paint");

      // Evaluated with requireAsphalt: true against paint mesh only: strictly refused
      const resPaintRefused = evaluateSuppliedGeometryContactRobust(qPaintOn, [paintMesh], {
        requireAsphalt: true,
      });
      expect(resPaintRefused.contacted).toBe(false);
      expect(resPaintRefused.asphaltMeshCount).toBe(0);
      expect(resPaintRefused.evaluatedTriangleCount).toBe(0);
      expect(resPaintRefused.minDist3D).toBeNull();

      // Query Point 2: Road centerline (pure asphalt, far from paint line)
      const qCenter = [{ x: 0, y: 0.18, z: 10 }];
      const resCenterAsphalt = evaluateSuppliedGeometryContactRobust(qCenter, [asphaltMesh], {
        requireAsphalt: true,
      });
      expect(resCenterAsphalt.contacted).toBe(true);
      expect(resCenterAsphalt.minDist3D).toBeCloseTo(0.000, 3);

      const resCenterPaint = evaluateSuppliedGeometryContactRobust(qCenter, [paintMesh], {
        requireAsphalt: false,
      });
      expect(resCenterPaint.contacted).toBe(false);
      expect(resCenterPaint.minDist3D).toBeGreaterThan(10.0);
    });

    it("4.2 verifies 6.0m pre-apron gate separation is strictly distinguished from connected apron (<0.01m)", () => {
      // Gate at (32, 31). Driveway extends from house (y=26) to pre-apron tip at gate (y=32.5).
      // Road carriageway starts at y=34.
      // Pre-apron tip at gate terminates ~1.5 cells (6.0m) away from road carriageway.
      const gate = { x: 32, y: 31 };
      const drivewayCells = [
        { x: 32, y: 26 },
        { x: 32, y: 27 },
        { x: 32, y: 28 },
        { x: 32, y: 29 },
        { x: 32, y: 30 },
        { x: 32, y: 31 },
        { x: 32, y: 32 },
      ];

      const isRoadSurface = (_gx: number, gy: number) => gy >= 34;
      const apronCells = deriveDrivewayApronCells(
        drivewayCells,
        gate,
        1,
        new Set(["32,34"]),
        isRoadSurface,
        5
      );
      expect(apronCells.length).toBeGreaterThan(0);
      expect(apronCells).toEqual([
        { x: 32, y: 33 },
        { x: 32, y: 34 },
      ]);

      // Road asphalt quad covering (x: [28..36], y: [33..37]) at world coordinates:
      // (gx - 32) * 4 => x: [-16..16], z: [4..20], Y: 0.18
      const roadGeom = new THREE.BufferGeometry();
      roadGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([
          -16, 0.18, 4,
           16, 0.18, 4,
           16, 0.18, 20,
          -16, 0.18, 4,
           16, 0.18, 20,
          -16, 0.18, 20,
        ], 3)
      );
      const roadMesh = new THREE.Mesh(roadGeom);
      roadMesh.name = ROAD_MESH_NAME_ASPHALT;

      // Gate vertex at world coordinates: (32 - 32)*4 = 0, z: (32 - 32)*4 = 0
      // Pre-apron tip at gate is at Z = 0, while road carriageway starts at Z = 4 (delta = 4m..6m)
      const preApronVertex = [{ x: 0, y: 0.18, z: -2.0 }];
      const preApronResult = evaluateSuppliedGeometryContactRobust(preApronVertex, [roadMesh], {
        requireAsphalt: true,
      });
      expect(preApronResult.contacted).toBe(false);
      expect(preApronResult.minDist3D).toBeCloseTo(6.000, 3);
      expect(preApronResult.minDist3D!).toBeGreaterThan(5.5);

      // Connected apron tip at y=34 => Z = (34 - 32)*4 = +8.0 (inside road quad)
      const connectedApronVertex = [{ x: 0, y: 0.18, z: 8.0 }];
      const connectedResult = evaluateSuppliedGeometryContactRobust(connectedApronVertex, [roadMesh], {
        requireAsphalt: true,
      });
      expect(connectedResult.contacted).toBe(true);
      expect(connectedResult.minDist3D).toBeCloseTo(0.000, 3);
      expect(connectedResult.minDist3D!).toBeLessThan(0.01);
    });

    it("4.3 handles distant negative points and extreme coordinates without overflow or NaN", () => {
      const roadGeom = new THREE.BufferGeometry();
      roadGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([
          -10, 0, -10,
           10, 0, -10,
           10, 0,  10,
          -10, 0, -10,
           10, 0,  10,
          -10, 0,  10,
        ], 3)
      );
      const roadMesh = new THREE.Mesh(roadGeom);
      roadMesh.name = ROAD_MESH_NAME_ASPHALT;

      // 1. Moderate distant control (-424, 3.0, -96)
      const res424 = evaluateSuppliedGeometryContactRobust([{ x: -424, y: 3.0, z: -96 }], [roadMesh], {
        requireAsphalt: true,
      });
      expect(res424.contacted).toBe(false);
      expect(res424.minDist3D!).toBeGreaterThan(30.0);
      expect(Number.isFinite(res424.minDist3D!)).toBe(true);

      // 2. Far separated negative (-1000, 3.0, -1000)
      const res1000 = evaluateSuppliedGeometryContactRobust([{ x: -1000, y: 3.0, z: -1000 }], [roadMesh], {
        requireAsphalt: true,
      });
      expect(res1000.contacted).toBe(false);
      expect(res1000.minDist3D!).toBeGreaterThan(50.0);
      expect(Number.isFinite(res1000.minDist3D!)).toBe(true);

      // 3. Extreme coordinate negative (1e6, 0, 1e6)
      const resExtreme = evaluateSuppliedGeometryContactRobust([{ x: 1e6, y: 0, z: 1e6 }], [roadMesh], {
        requireAsphalt: true,
      });
      expect(resExtreme.contacted).toBe(false);
      expect(Number.isFinite(resExtreme.minDist3D!)).toBe(true);
      expect(Number.isNaN(resExtreme.minDist3D!)).toBe(false);
    });
  });

  // =========================================================================
  // Section 5: MultiplayerStatusHUD Root Passthrough & Runtime Action Wiring
  // =========================================================================
  describe("5. MultiplayerStatusHUD Root Pointer Passthrough & Runtime Wiring (M2-03)", () => {
    const sampleLobbyRace: PartyRaceState = {
      raceId: "race-hud-adv-1",
      hostUserId: "host-user-1",
      hostParticipantId: "part-host-1",
      status: "lobby",
      createdAtMs: 1000,
      countdownMs: 3000,
      countdownEndsAtMs: null,
      startedAtMs: null,
      finishedAtMs: null,
      winnerUserId: null,
      checkpoints: [{ x: 10, z: 20, radiusMetres: 8 }],
      entrants: [
        {
          userId: "host-user-1",
          participantId: "part-host-1",
          username: "HostPlayer",
          vehicleKey: "showroom:karoo-kaap-gt-v8",
          ready: true,
          checkpointIndex: 0,
          finishedAtMs: null,
          elapsedMs: null,
          place: null,
          joinedAtMs: 1000,
        },
        {
          userId: "guest-user-2",
          participantId: "part-guest-2",
          username: "GuestPlayer",
          vehicleKey: "showroom:karoo-kaap-gt-v8",
          ready: false,
          checkpointIndex: 0,
          finishedAtMs: null,
          elapsedMs: null,
          place: null,
          joinedAtMs: 1050,
        },
      ],
    };

    function createMockRuntimeHarness(overrides?: {
      participantId?: string;
      partyRaceState?: PartyRaceState | null;
      isDriving?: boolean;
      status?: "connected" | "connecting" | "disconnected" | "error";
    }) {
      const inviteCalls: any[] = [];
      const joinCalls: string[] = [];
      const readyCalls: Array<{ ready: boolean; raceId?: string }> = [];
      const startCalls: string[] = [];
      const cancelCalls: string[] = [];
      const leaveCalls: string[] = [];

      const participantId = overrides?.participantId ?? "part-host-1";
      const partyRaceState = overrides?.partyRaceState !== undefined ? overrides.partyRaceState : sampleLobbyRace;
      const isDriving = overrides?.isDriving ?? true;
      const status = overrides?.status ?? "connected";

      const mockRuntime = {
        isOwnedDriveSeated: () => isDriving,
        subscribe: (_cb: () => void) => () => {},
        getMultiplayerClient: () => ({
          getStatus: () => status,
          getSessionInfo: () => ({
            sessionId: "sess-adv-100",
            inviteCode: "ADVHUD",
            participantId,
            mode: isDriving ? "driving" : "walking",
          }),
        }),
        sim: {
          state: {
            remoteRacers: new Map([["peer-1", { participantId: "peer-1", username: "PeerOne" } as any]]),
          },
        },
        getPartyRaceState: () => partyRaceState,
        invitePartyRace: (opts?: any) => {
          inviteCalls.push(opts);
          return true;
        },
        joinPartyRace: (raceId?: string) => {
          if (raceId) joinCalls.push(raceId);
          return true;
        },
        setPartyRaceReady: (ready: boolean, raceId?: string) => {
          readyCalls.push({ ready, raceId });
          return true;
        },
        startPartyRace: (raceId?: string) => {
          if (raceId) startCalls.push(raceId);
          return true;
        },
        cancelPartyRace: (raceId?: string) => {
          if (raceId) cancelCalls.push(raceId);
          return true;
        },
        leavePartyRace: (raceId?: string) => {
          if (raceId) leaveCalls.push(raceId);
          return true;
        },
      } as unknown as ColonyRuntime;

      return {
        mockRuntime,
        inviteCalls,
        joinCalls,
        readyCalls,
        startCalls,
        cancelCalls,
        leaveCalls,
      };
    }

    it("5.1 verifies root overlay pointerEvents === 'none' preventing viewport interception", async () => {
      const { mockRuntime } = createMockRuntimeHarness();
      const container = (globalThis as any).document.createElement("div");
      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container as unknown as HTMLElement);
        root.render(React.createElement(MultiplayerStatusHUD, { runtime: mockRuntime }));
      });

      const hudNode = findNode(container, (n) => n.getAttribute?.("data-testid") === "multiplayer-hud");
      expect(hudNode).not.toBeNull();
      const hudProps = getReactProps(hudNode);
      expect(hudProps?.style?.pointerEvents).toBe("none");

      await act(async () => root?.unmount());
    });

    it("5.2 verifies child panel pointerEvents === 'auto' enabling interactive buttons", async () => {
      const { mockRuntime } = createMockRuntimeHarness();
      const container = (globalThis as any).document.createElement("div");
      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container as unknown as HTMLElement);
        root.render(React.createElement(MultiplayerStatusHUD, { runtime: mockRuntime }));
      });

      const panelNode = findNode(container, (n) => n.getAttribute?.("data-testid") === "party-race-panel");
      expect(panelNode).not.toBeNull();
      const panelProps = getReactProps(panelNode);
      expect(panelProps?.style?.pointerEvents).toBe("auto");

      await act(async () => root?.unmount());
    });

    it("5.3 verifies Host action wiring: Cancel, Start, and Ready fire exact runtime methods", async () => {
      const { mockRuntime, cancelCalls, startCalls, readyCalls } = createMockRuntimeHarness({
        participantId: "part-host-1",
      });
      const container = (globalThis as any).document.createElement("div");
      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container as unknown as HTMLElement);
        root.render(React.createElement(MultiplayerStatusHUD, { runtime: mockRuntime }));
      });

      // Ready button click toggles ready state for host
      const readyBtn = findNode(container, (n) => n.getAttribute?.("data-testid") === "party-race-ready-btn");
      expect(readyBtn).not.toBeNull();
      const readyProps = getReactProps(readyBtn);
      readyProps?.onClick?.();
      expect(readyCalls).toHaveLength(1);
      expect(readyCalls[0]).toEqual({ ready: false, raceId: "race-hud-adv-1" });

      // Cancel button click cancels party race
      const cancelBtn = findNode(container, (n) => n.getAttribute?.("data-testid") === "party-race-cancel-btn");
      expect(cancelBtn).not.toBeNull();
      const cancelProps = getReactProps(cancelBtn);
      cancelProps?.onClick?.();
      expect(cancelCalls).toEqual(["race-hud-adv-1"]);

      // Start button is disabled when not all entrants are ready
      const startBtn = findNode(container, (n) => n.getAttribute?.("data-testid") === "party-race-start-btn");
      expect(startBtn).not.toBeNull();
      const startProps = getReactProps(startBtn);
      expect(startProps?.disabled).toBe(true);

      await act(async () => root?.unmount());
    });

    it("5.4 verifies Guest action wiring: Leave button fires runtime.leavePartyRace", async () => {
      const { mockRuntime, leaveCalls } = createMockRuntimeHarness({
        participantId: "part-guest-2",
      });
      const container = (globalThis as any).document.createElement("div");
      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container as unknown as HTMLElement);
        root.render(React.createElement(MultiplayerStatusHUD, { runtime: mockRuntime }));
      });

      const leaveBtn = findNode(container, (n) => n.getAttribute?.("data-testid") === "party-race-leave-btn");
      expect(leaveBtn).not.toBeNull();
      const leaveProps = getReactProps(leaveBtn);
      expect(leaveProps?.disabled).toBeFalsy();
      leaveProps?.onClick?.();
      expect(leaveCalls).toEqual(["race-hud-adv-1"]);

      await act(async () => root?.unmount());
    });

    it("5.5 verifies Idle player action wiring: Invite button fires runtime.invitePartyRace", async () => {
      const { mockRuntime, inviteCalls } = createMockRuntimeHarness({
        partyRaceState: null, // No active race
      });
      const container = (globalThis as any).document.createElement("div");
      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container as unknown as HTMLElement);
        root.render(React.createElement(MultiplayerStatusHUD, { runtime: mockRuntime }));
      });

      const inviteBtn = findNode(container, (n) => n.getAttribute?.("data-testid") === "party-race-invite-btn");
      expect(inviteBtn).not.toBeNull();
      const inviteProps = getReactProps(inviteBtn);
      expect(inviteProps?.disabled).toBe(false);
      inviteProps?.onClick?.();
      expect(inviteCalls).toHaveLength(1);

      await act(async () => root?.unmount());
    });

    it("5.6 verifies walking state (isDriving = false) disables invite button with not-allowed cursor", async () => {
      const { mockRuntime, inviteCalls } = createMockRuntimeHarness({
        partyRaceState: null,
        isDriving: false, // Player is walking
      });
      const container = (globalThis as any).document.createElement("div");
      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container as unknown as HTMLElement);
        root.render(React.createElement(MultiplayerStatusHUD, { runtime: mockRuntime }));
      });

      const inviteBtn = findNode(container, (n) => n.getAttribute?.("data-testid") === "party-race-invite-btn");
      expect(inviteBtn).not.toBeNull();
      const inviteProps = getReactProps(inviteBtn);
      expect(inviteProps?.disabled).toBe(true);
      expect(inviteProps?.style?.cursor).toBe("not-allowed");

      await act(async () => root?.unmount());
    });

    it("5.7 returns null when multiplayer status is disconnected", async () => {
      const { mockRuntime } = createMockRuntimeHarness({
        status: "disconnected",
      });
      const container = (globalThis as any).document.createElement("div");
      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container as unknown as HTMLElement);
        root.render(React.createElement(MultiplayerStatusHUD, { runtime: mockRuntime }));
      });

      const hudNode = findNode(container, (n) => n.getAttribute?.("data-testid") === "multiplayer-hud");
      expect(hudNode).toBeNull();

      await act(async () => root?.unmount());
    });
  });
});
