import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Vector3, Quaternion, Mesh, BufferGeometry, BufferAttribute, MeshStandardMaterial } from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  FirstPersonController,
  updateFirstPersonDrivingChaseCamera,
} from "../src/render/components/FirstPersonController";
import {
  HomeDrivewaySurface,
  homeDrivewayGeometry,
  deriveDrivewayApronCells,
  isPointOnRenderedRoadRibbon,
} from "../src/colony/render/HomeDrivewaySurface";
import {
  ROAD_RIBBON_LIFT,
  buildRoadRibbons,
  ROAD_MESH_NAME_ASPHALT,
  ROAD_MESH_NAME_EDGE_LINES,
  ROAD_MESH_NAME_DASHES,
  isRoadAsphaltMesh,
  isRoadPaintMesh,
} from "../src/colony/render/roadRibbon";
import { ZoneManager } from "../src/colony/render/R3FPlanetRenderer";
import { R3FOperatorCar } from "../src/colony/render/R3FOperatorCar";
import { leveledWorldYAt } from "../src/colony/render/terrainLeveling";
import { getSmoothRoadY } from "../src/colony/render/roadSurface";
import { MultiplayerStatusHUD } from "../src/colony/ui/MultiplayerStatusHUD";
import type { PartyRaceState } from "../src/colony/multiplayer/multiplayerClient";

// Setup browser/client DOM mocks so createRoot works cleanly
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
      instanceMatrix: { count: 100, needsUpdate: false },
      setMatrixAt: () => {},
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

// Mock R3F and Rapier hooks to capture production useFrame callback and RigidBody
let capturedFrameCb: ((state: any, delta: number) => void) | null = null;
let currentRigidBody: any = null;
const cameraMock = {
  position: new Vector3(),
  quaternion: new Quaternion(),
  fov: 65,
  updateProjectionMatrix: vi.fn(),
  lookAt: vi.fn(),
};

vi.mock("@react-three/fiber", () => ({
  useFrame: (cb: any) => {
    capturedFrameCb = cb;
  },
  useThree: () => ({
    camera: cameraMock,
    scene: { getObjectByName: vi.fn() },
    gl: { domElement: {} },
  }),
}));

vi.mock("@react-three/rapier", () => ({
  RigidBody: ({ ref, children, position }: any) => {
    const rb = {
      pos: { x: position[0], y: position[1], z: position[2] },
      vel: { x: 0, y: 0, z: 0 },
      translation() {
        return { ...this.pos };
      },
      setTranslation(p: any) {
        this.pos = { ...p };
      },
      linvel() {
        return { ...this.vel };
      },
      setLinvel(v: any) {
        this.vel = { ...v };
      },
    };
    currentRigidBody = rb;
    if (ref) {
      if (typeof ref === "function") ref(rb);
      else ref.current = rb;
    }
    return React.createElement("div", { "data-testid": "rigid-body" }, children);
  },
  CapsuleCollider: () => null,
  HeightfieldCollider: () => null,
  CuboidCollider: () => null,
  Physics: ({ children }: any) => React.createElement("div", null, children),
  useRapier: () => ({ world: { bodies: new Map() } }),
}));

// Build a faithful Three mock scene with real Mesh geometry & material for OwnedVehicleModel
function createMockVehicleScene() {
  const geom = new BufferGeometry();
  const mat: any = {
    name: "carpaint_body",
    clone() {
      return { ...this, color: { set: vi.fn() } };
    },
    color: { set: vi.fn(), clone: () => ({ multiplyScalar: () => {} }) },
  };
  const bodyMesh = new Mesh(geom, mat);
  bodyMesh.name = "car_body";

  const root = {
    isObject3D: true,
    children: [bodyMesh],
    position: new Vector3(),
    rotation: { set: vi.fn() },
    scale: { setScalar: vi.fn() },
    updateWorldMatrix: vi.fn(),
    traverse(cb: (n: any) => void) {
      cb(this);
      cb(bodyMesh);
    },
    clone() {
      return createMockVehicleScene();
    },
  };
  return root;
}

vi.mock("@react-three/drei", () => {
  const fn: any = vi.fn(() => ({
    scene: createMockVehicleScene(),
  }));
  fn.preload = vi.fn();
  fn.clear = vi.fn();
  return {
    useGLTF: fn,
    Html: ({ children }: any) => React.createElement("div", { "data-testid": "r3f-html" }, children),
    Text: ({ children }: any) => React.createElement("div", null, children),
    ContactShadows: () => null,
    Sky: () => null,
    Stars: () => null,
    Billboard: ({ children }: any) => React.createElement("div", null, children),
    Line: () => null,
  };
});

function getReactProps(node: any): any {
  if (!node) return null;
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactProps$")) return node[key];
  }
  return null;
}

describe("PR#548/PR#547 Production Consumer Equivalence, Redraw & Controls", () => {
  beforeEach(() => {
    setupMountedDOM();
    capturedFrameCb = null;
    currentRigidBody = null;
    cameraMock.position.set(0, 0, 0);
    cameraMock.quaternion.set(0, 0, 0, 1);
    cameraMock.lookAt.mockClear();
    cameraMock.updateProjectionMatrix.mockClear();
  });

  it("PR#547: mounts FirstPersonController and verifies driving chase camera follows vehicle pose with positive/negative controls", async () => {
    const rt = new ColonyRuntime(4242);
    const drivingPose = { x: 50, y: 60, heading: Math.PI / 4, speed: 12 };
    (rt as any).getOwnedDrivePose = () => drivingPose;

    const container = (globalThis as any).document.createElement("div");
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(FirstPersonController, {
          sim: rt.sim,
          runtime: rt as any,
          terrainLevel: null,
        }),
      );
    });

    expect(capturedFrameCb).not.toBeNull();

    // 1. Positive Control: Driving pose engages arcade chase camera (6.2m distance behind vehicle)
    capturedFrameCb!({}, 0.016);

    const terrainSize = rt.sim.state.terrain.size;
    const wx = (drivingPose.x - terrainSize / 2) * 4;
    const wz = (drivingPose.y - terrainSize / 2) * 4;

    const expectedCamX = wx - Math.cos(drivingPose.heading) * 6.2;
    const expectedCamZ = wz - Math.sin(drivingPose.heading) * 6.2;
    expect(cameraMock.position.x).toBeCloseTo(expectedCamX, 1);
    expect(cameraMock.position.z).toBeCloseTo(expectedCamZ, 1);
    expect(cameraMock.lookAt).toHaveBeenCalledWith(
      expect.closeTo(wx + Math.cos(drivingPose.heading) * 4, 1),
      expect.any(Number),
      expect.closeTo(wz + Math.sin(drivingPose.heading) * 4, 1),
    );
    expect(rt.fpCameraCell).toEqual({ x: drivingPose.x, y: drivingPose.y });

    // 2. Negative Control: When driver exits (not driving), chase camera releases back to walking mode
    (rt as any).getOwnedDrivePose = () => null;
    cameraMock.lookAt.mockClear();
    capturedFrameCb!({}, 0.016);
    expect(cameraMock.lookAt).not.toHaveBeenCalled();

    await act(async () => root?.unmount());
  });

  it("PR#547: verifies FirstPersonController camera maintains elevation clearance and heading alignment across orientations", async () => {
    const rt = new ColonyRuntime(4242);
    const container = (globalThis as any).document.createElement("div");
    let root: Root | null = null;

    let activePose = { x: 40, y: 40, heading: 0, speed: 10 };
    (rt as any).getOwnedDrivePose = () => activePose;

    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(FirstPersonController, {
          sim: rt.sim,
          runtime: rt as any,
          terrainLevel: null,
        }),
      );
    });

    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      activePose = { x: 40, y: 40, heading, speed: 10 };
      cameraMock.lookAt.mockClear();
      capturedFrameCb?.({}, 0.016);

      const terrainSize = rt.sim.state.terrain.size;
      const wx = (40 - terrainSize / 2) * 4;
      const wz = (40 - terrainSize / 2) * 4;

      const cam = cameraMock.position;
      const dx = wx - cam.x;
      const dz = wz - cam.z;
      // Dot product of (target - cam) with vehicle forward vector must be positive (cam is behind car)
      const forwardDot = dx * Math.cos(heading) + dz * Math.sin(heading);
      expect(forwardDot).toBeGreaterThan(5.5);
      // Elevation clearance above ground
      expect(cam.y).toBeGreaterThanOrEqual(2.4);
      expect(cameraMock.lookAt).toHaveBeenCalled();
    }

    await act(async () => root?.unmount());
  });

  it("PR#547: mounts FirstPersonController and verifies fractional terrain elevation clearance (clearing leveledWorldYAt + 1.2m)", async () => {
    const tSize = 128;
    const heightGrid: Record<number, number> = {};
    const mockTerrain = {
      size: tSize,
      inBounds: (gx: number, gy: number) => gx >= 0 && gx < tSize && gy >= 0 && gy < tSize,
      worldY: (gx: number, gy: number) => heightGrid[gy * tSize + gx] ?? 0,
    };
    const mockSim = {
      state: {
        terrain: mockTerrain,
        roadSet: new Set<string>(),
      },
    };

    // Car at (64.0, 64.0), heading 0 (East).
    // wx = (64 - 64)*4 = 0, wz = 0.
    // camX = 0 - cos(0)*6.2 = -6.2.
    // camZ = 0 - sin(0)*6.2 = 0.
    // camGridX = -6.2 / 4 + 64 = 62.45.
    // camGridY = 64.0.
    // Math.round(camGridX) is 62.
    // Set cell (62, 64) to 0m, but cell (63, 64) to 10m.
    // Rounded height at (62, 64) is 0m.
    // Fractional height at (62.45, 64) is 0 * 0.55 + 10 * 0.45 = 4.5m!
    heightGrid[64 * tSize + 62] = 0;
    heightGrid[64 * tSize + 63] = 10;
    heightGrid[64 * tSize + 64] = 0;

    const mockRuntime: any = {
      getOwnedDrivePose: () => ({
        x: 64.0,
        y: 64.0,
        heading: 0,
        speed: 0,
      }),
      fpCameraCell: null,
    };

    const container = (globalThis as any).document.createElement("div");
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(FirstPersonController, {
          sim: mockSim,
          runtime: mockRuntime,
          terrainLevel: null,
        }),
      );
    });

    expect(capturedFrameCb).not.toBeNull();
    capturedFrameCb!({}, 0.016);

    const fractionalH = leveledWorldYAt(mockTerrain as any, null, 62.45, 64.0);
    expect(fractionalH).toBeCloseTo(4.5, 2);
    // Rounded height would be 0m, leading to camY ~ 2.42m.
    // But fractional clearance ensures camY >= fractionalH + 1.2 = 5.7m!
    expect(cameraMock.position.y).toBeGreaterThanOrEqual(fractionalH + 1.2);
    expect(cameraMock.position.y).toBeGreaterThan(5.6);

    await act(async () => root?.unmount());
  });

  it("PR#547: mounts R3FOperatorCar in client root and verifies exterior model is rendered and visible without error boundary fallback", async () => {
    const rt = new ColonyRuntime(4242);
    const citizen = (rt as any).citizens.list()[0]!;
    rt.setOperatorName(citizen.displayName);
    rt.setOperatorUserId("driver-user-client-1");

    // Acquire vehicle so operatorCar exists in sim state
    rt.sim.state.operatorCar = {
      cell: { x: 45, y: 55 },
      heading: 0,
      spec: { id: "showroom:karoo-x19-targa", name: "Karoo X19 Targa", paint: { body: 0xff0000 } } as any,
    };

    // Driver is seated
    (rt as any).getOwnedDrivePose = () => ({ x: 45, y: 55, heading: 0, speed: 0 });

    const container = (globalThis as any).document.createElement("div");
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(R3FOperatorCar, {
          sim: rt.sim,
          runtime: rt as any,
          terrainLevel: null,
        }),
      );
    });

    const findNode = (node: any, predicate: (n: any) => boolean): any => {
      if (predicate(node)) return node;
      for (const child of node.children || []) {
        const res = findNode(child, predicate);
        if (res) return res;
      }
      return null;
    };

    // 1. Positive Control: Operator car group is present and not suppressed
    const carGroup = findNode(container, (n) => n.name === "operator-car" || n.getAttribute?.("name") === "operator-car");
    expect(carGroup).not.toBeNull();
    // Exterior model primitive is mounted inside carGroup
    const modelNode = findNode(container, (n) => n.name === "owned-vehicle-model" || n.getAttribute?.("name") === "owned-vehicle-model");
    expect(modelNode).not.toBeNull();
    const modelProps = getReactProps(modelNode);
    expect(modelProps?.userData?.vehicleId).toBe("showroom:karoo-x19-targa");

    // 2. Explicitly verify no error boundary fallback was triggered
    const alertNode = findNode(container, (n) => n.getAttribute?.("role") === "alert" || n.role === "alert");
    expect(alertNode).toBeNull();

    // 3. Negative Control: When operatorCar is null, car group is omitted
    rt.sim.state.operatorCar = null;
    await act(async () => {
      root?.render(
        React.createElement(R3FOperatorCar, {
          sim: rt.sim,
          runtime: rt as any,
          terrainLevel: null,
        }),
      );
    });
    const omittedGroup = findNode(container, (n) => n.name === "operator-car" || n.getAttribute?.("name") === "operator-car");
    expect(omittedGroup).toBeNull();

    await act(async () => root?.unmount());
  });

  it("PR#548: verifies homeDrivewayGeometry creates nonempty geometry with vertical offset and upward normals", () => {
    const cells = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 1 }];
    const roadSet = new Set(["1,1"]);
    const terrainSize = 64;
    const geometry = homeDrivewayGeometry(cells, terrainSize, roadSet, (x, y) => x + y);

    const pos = geometry.getAttribute("position");
    // 2 unique off-road cells * 4 vertices = 8 vertices
    expect(pos.count).toBe(8);
    expect(geometry.getIndex()?.count).toBe(12);

    // Vertex Y has the +0.055 offset above graded surface
    expect(pos.getY(0)).toBeCloseTo(2.055, 3);

    // Surface normal must point upward (+Y > 0)
    const norm = geometry.getAttribute("normal");
    expect(norm.getY(0)).toBeGreaterThan(0);
    geometry.dispose();
  });

  it("PR#548: mounts HomeDrivewaySurface and tests road seam continuity and owner-switch redraw lifecycle", async () => {
    const rt = new ColonyRuntime(4242);
    const citizen1 = (rt as any).citizens.list()[0]!;
    rt.setOperatorName(citizen1.displayName);
    rt.setOperatorUserId("home-owner-alice");
    const aliceId = rt.operatorCitizenId();
    expect(aliceId).toBeTruthy();

    const claimed = rt.claimStarterHome();
    expect(claimed).toBe(true);

    const driveway = rt.getPlayerHomeDriveway();
    expect(driveway).not.toBeNull();
    expect(driveway!.cells.length).toBeGreaterThan(0);

    // 1. Road seam continuity: check elevation between gate cell on road and the contiguous driveway cell
    const lot = (rt as any).neighborhood.lots.find((l: any) => l.ownerCitizenId === aliceId)!;
    const terrain = rt.sim.state.terrain;
    const roadGateY = getSmoothRoadY(terrain, lot.gate.x, lot.gate.y);
    const gateDrivewayY = leveledWorldYAt(terrain, null, lot.gate.x, lot.gate.y);
    // Across the gate seam where driveway meets road carriageway, vertical delta is within smooth road grade (< 0.20m)
    expect(Math.abs(gateDrivewayY - roadGateY)).toBeLessThan(0.20);

    // 2. Client-mounted lifecycle & Production Subscription Redraw: Mount ZoneManager with ColonyRuntime
    const container = (globalThis as any).document.createElement("div");
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(ZoneManager, {
          sim: rt.sim,
          runtime: rt as any,
          terrainLevel: null,
        }),
      );
    });

    const findNode = (node: any, predicate: (n: any) => boolean): any => {
      if (predicate(node)) return node;
      for (const child of node.children || []) {
        const res = findNode(child, predicate);
        if (res) return res;
      }
      return null;
    };

    let mesh = findNode(container, (n) => n.name === "player-home-driveway" || n.getAttribute?.("name") === "player-home-driveway");
    expect(mesh).not.toBeNull();
    // Actual observed consumer prop identity directly from React element / fiber props (NO fallback):
    const meshProps = getReactProps(mesh);
    expect(meshProps?.userData?.plotId).toBe(driveway!.plotId);

    // 2b. Verify actual generated lot_1 and all neighborhood plots reach rendered road ribbon with zero parcel collision:
    const roadWays = rt.sim.state.roadWays;
    expect(isPointOnRenderedRoadRibbon(235, 313, roadWays)).toBe(false);
    expect(isPointOnRenderedRoadRibbon(235, 316, roadWays)).toBe(true);
    const renderedPos = meshProps?.geometry?.getAttribute("position");
    // 8 driveway cells + 3 apron cells = 11 cells * 4 vertices = 44 vertices
    expect(renderedPos?.count).toBe(44);

    // Verify all neighborhood lots reach rendered road ribbon and never encroach on any parcel footprint
    const allLots = (rt as any).neighborhood.lots as any[];
    const parcelFootprintCells = new Set<string>();
    for (const p of allLots) {
      for (const f of p.fence) parcelFootprintCells.add(`${f.x},${f.y}`);
      parcelFootprintCells.add(`${p.doorX},${p.doorY}`);
    }
    for (const p of allLots) {
      const pApron = deriveDrivewayApronCells(
        p.driveway,
        p.gate,
        p.side,
        undefined,
        (gx, gy) => isPointOnRenderedRoadRibbon(gx, gy, roadWays),
      );
      expect(pApron.length).toBeGreaterThan(0);
      const pEnd = pApron[pApron.length - 1]!;
      expect(isPointOnRenderedRoadRibbon(pEnd.x, pEnd.y, roadWays)).toBe(true);
      for (const ac of pApron) {
        expect(parcelFootprintCells.has(`${ac.x},${ac.y}`)).toBe(false);
      }
      // Same-coordinate elevation continuity at the road ribbon contact cell
      const ribbonSurfaceY = Math.max(0, getSmoothRoadY(terrain, pEnd.x, pEnd.y)) + ROAD_RIBBON_LIFT;
      const apronSurfaceY = Math.max(leveledWorldYAt(terrain, null, pEnd.x, pEnd.y), ribbonSurfaceY - 0.045) + 0.055;
      expect(Math.abs(apronSurfaceY - ribbonSurfaceY)).toBeCloseTo(0.01, 3);
    }

    // 3. Negative Control / Production Redraw: Switch operator to unauthenticated / guest (no claimed home)
    await act(async () => {
      rt.setOperatorName(null);
      rt.setOperatorUserId(null);
    });

    mesh = findNode(container, (n) => n.name === "player-home-driveway" || n.getAttribute?.("name") === "player-home-driveway");
    expect(mesh).toBeNull();

    await act(async () => root?.unmount());
  });

  it("PR#548: verifies deriveDrivewayApronCells projects apron along road direction reaching road ribbon with safety bounds", () => {
    // 1. Positive: lot_1 driveway reaching streetward from gate
    const gate = { x: 235, y: 311 };
    const side = 1; // +Y facing
    const cells = [
      { x: 235, y: 306 },
      { x: 235, y: 307 },
      { x: 235, y: 308 },
      { x: 235, y: 309 },
      { x: 235, y: 310 },
      { x: 235, y: 311 },
      { x: 235, y: 312 },
      { x: 235, y: 313 },
    ];
    // Road ribbon corridor is reached at (235, 314-316)
    const isRoadSurface = (_x: number, y: number) => y >= 316;

    const apron = deriveDrivewayApronCells(cells, gate, side, new Set(), isRoadSurface, 5);
    expect(apron.length).toBe(3);
    expect(apron).toEqual([
      { x: 235, y: 314 },
      { x: 235, y: 315 },
      { x: 235, y: 316 },
    ]);

    // 2. Negative / Edge Control: Empty driveway or null gate produces zero apron
    expect(deriveDrivewayApronCells([], gate, side, new Set(), isRoadSurface)).toEqual([]);
    expect(deriveDrivewayApronCells(cells, undefined, side, new Set(), isRoadSurface)).toEqual([]);

    // 3. Safety Bound Control: If road ribbon is not found within maxSteps, do not run away
    const noRoadSurface = () => false;
    const boundedApron = deriveDrivewayApronCells(cells, gate, side, new Set(), noRoadSurface, 4);
    // When road ribbon isn't found within maxSteps, it stops at maxSteps without indefinite elongation
    expect(boundedApron.length).toBe(4);
    expect(boundedApron[boundedApron.length - 1]).toEqual({ x: 235, y: 317 });
  });

  it("PR#548: verifies homeDrivewayGeometry includes apron cells and connects seamlessly to road elevation", () => {
    const terrainSize = 512;
    const roadSet = new Set<string>(); // apron cells are explicitly retained
    const cells = [
      { x: 235, y: 312 },
      { x: 235, y: 313 },
      { x: 235, y: 314 },
      { x: 235, y: 315 },
      { x: 235, y: 316 },
    ];
    const geom = homeDrivewayGeometry(cells, terrainSize, roadSet, (_x, y) => 3.0 + (y - 312) * 0.05);
    expect(geom).toBeDefined();
    const pos = geom.getAttribute("position");
    // 5 cells * 4 vertices = 20 vertices
    expect(pos.count).toBe(20);
    // Verify vertical continuity: height step between adjacent apron vertices matches elevation gradient
    const yEdge0 = pos.getY(4 * 0); // cell 0
    const yEdge4 = pos.getY(4 * 4); // cell 4
    expect(yEdge4).toBeGreaterThan(yEdge0);
    geom.dispose();
  });

    function closestPointOnTriangle3D(
      px: number, py: number, pz: number,
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
    ): [number, number, number] | null {
      if (
        !Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz) ||
        !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
        !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz) ||
        !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)
      ) {
        return null;
      }

      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      const apx = px - ax, apy = py - ay, apz = pz - az;

      const lenSqAB = abx * abx + aby * aby + abz * abz;
      const lenSqAC = acx * acx + acy * acy + acz * acz;

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
      if (lenSqAB > 1e-12 && vc <= 0 && d1 >= 0 && d3 <= 0 && (d1 - d3) > 1e-12) {
        const v = d1 / (d1 - d3);
        return [ax + v * abx, ay + v * aby, az + v * abz];
      }

      const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
      const d5 = abx * cpx + aby * cpy + abz * cpz;
      const d6 = acx * cpx + acy * cpy + acz * cpz;
      if (d6 >= 0 && d5 <= d6) return [cx, cy, cz];

      const vb = d5 * d2 - d1 * d6;
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

      const dSqA = (px - ax) ** 2 + (py - ay) ** 2 + (pz - az) ** 2;
      const dSqB = (px - bx) ** 2 + (py - by) ** 2 + (pz - bz) ** 2;
      const dSqC = (px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2;
      if (dSqA <= dSqB && dSqA <= dSqC) return [ax, ay, az];
      if (dSqB <= dSqC) return [bx, by, bz];
      return [cx, cy, cz];
    }

    interface OraclePoint3D {
      x: number;
      y: number;
      z: number;
    }

    interface OracleEvaluationResult {
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

    function evaluateSuppliedGeometryContact(
      queryPoints: OraclePoint3D[],
      meshes: Mesh[],
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

          if (
            !Number.isInteger(idxA) || idxA < 0 || idxA >= pos.count ||
            !Number.isInteger(idxB) || idxB < 0 || idxB >= pos.count ||
            !Number.isInteger(idxC) || idxC < 0 || idxC >= pos.count
          ) {
            continue;
          }

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
            if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(pt.z)) {
              continue;
            }
            pointCount++;
            const cp = closestPointOnTriangle3D(
              pt.x, pt.y, pt.z,
              ax, ay, az,
              bx, by, bz,
              cx, cy, cz
            );
            if (!cp) continue;
            const [qx, qy, qz] = cp;
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


  it("M2-02: finite discriminating geometry oracle evaluates supplied asphalt geometry and discriminates paint-only negatives", () => {
    const rt = new ColonyRuntime(42);
    const terrain = rt.sim.state.terrain;
    const N = terrain.size;
    const roadWays = rt.sim.state.roadWays ?? [];

    const { group: ribbonGroup } = buildRoadRibbons(roadWays, {
      terrain,
      wx: (gx) => (gx - N / 2) * 4,
      wz: (gy) => (gy - N / 2) * 4,
      roadY: (gx, gy) => getSmoothRoadY(terrain, gx, gy),
    });

    const ribbonMeshes = ribbonGroup.children.filter((c): c is Mesh => c instanceof Mesh);
    expect(ribbonMeshes.length).toBeGreaterThan(0);

    const asphaltMeshes = ribbonMeshes.filter(isRoadAsphaltMesh);
    const paintMeshes = ribbonMeshes.filter(isRoadPaintMesh);
    expect(asphaltMeshes.length).toBeGreaterThan(0);
    expect(paintMeshes.length).toBeGreaterThan(0);

    for (const m of asphaltMeshes) {
      expect(m.name).toBe(ROAD_MESH_NAME_ASPHALT);
      expect(isRoadPaintMesh(m)).toBe(false);
    }
    const dashMesh = paintMeshes.find((m) => m.name === ROAD_MESH_NAME_DASHES);
    const edgeMesh = paintMeshes.find((m) => m.name === ROAD_MESH_NAME_EDGE_LINES);
    expect(dashMesh).toBeDefined();
    expect(edgeMesh).toBeDefined();

    const lot = (rt as any).neighborhood.lots.find((l: any) => l.id === "lot_1");
    expect(lot).toBeDefined();

    const apronCells = deriveDrivewayApronCells(
      lot.driveway,
      lot.gate,
      lot.side,
      undefined,
      (gx, gy) => isPointOnRenderedRoadRibbon(gx, gy, roadWays),
    );
    expect(apronCells.length).toBeGreaterThan(0);
    const fullDrivewayCells = [...lot.driveway, ...apronCells];

    const drivewayGeom = homeDrivewayGeometry(
      fullDrivewayCells,
      N,
      new Set(),
      (gx, gy) => {
        const groundY = leveledWorldYAt(terrain, null, gx, gy);
        if (isPointOnRenderedRoadRibbon(gx, gy, roadWays)) {
          const roadH = Math.max(0, getSmoothRoadY(terrain, gx, gy)) + ROAD_RIBBON_LIFT;
          return Math.max(groundY, roadH - 0.045);
        }
        return groundY;
      },
    );

    const dPos = drivewayGeom.getAttribute("position");
    expect(dPos).toBeDefined();

    let maxZ = -Infinity;
    for (let i = 0; i < dPos.count; i++) {
      if (dPos.getZ(i) > maxZ) maxZ = dPos.getZ(i);
    }
    const contactVertices: OraclePoint3D[] = [];
    for (let i = 0; i < dPos.count; i++) {
      if (Math.abs(dPos.getZ(i) - maxZ) < 0.05) {
        contactVertices.push({ x: dPos.getX(i), y: dPos.getY(i), z: dPos.getZ(i) });
      }
    }
    expect(contactVertices.length).toBeGreaterThanOrEqual(2);

    let lotMinX = Infinity, lotMaxX = -Infinity, lotMinZ = Infinity, lotMaxZ = -Infinity;
    for (let i = 0; i < dPos.count; i++) {
      const x = dPos.getX(i), z = dPos.getZ(i);
      if (x < lotMinX) lotMinX = x;
      if (x > lotMaxX) lotMaxX = x;
      if (z < lotMinZ) lotMinZ = z;
      if (z > lotMaxZ) lotMaxZ = z;
    }
    const margin = 15.0;
    const bbox = { minX: lotMinX - margin, maxX: lotMaxX + margin, minZ: lotMinZ - margin, maxZ: lotMaxZ + margin };

    // 1. Valid asphalt contact positive
    const positiveResult = evaluateSuppliedGeometryContact(contactVertices, asphaltMeshes, {
      requireAsphalt: true,
      bbox,
    });
    expect(positiveResult.contacted).toBe(true);
    expect(positiveResult.evaluatedTriangleCount).toBeGreaterThan(0);
    expect(positiveResult.testedPointCount).toBeGreaterThan(0);
    expect(positiveResult.minDistXZ).not.toBeNull();
    expect(positiveResult.minDist3D).not.toBeNull();
    expect(positiveResult.minDistXZ!).toBeLessThan(0.01);
    expect(positiveResult.minDist3D!).toBeLessThan(0.02);
    expect(positiveResult.closestSurfacePoint).not.toBeNull();
    const seamDelta = Math.abs(positiveResult.closestQueryPoint!.y - positiveResult.closestSurfacePoint![1]);
    expect(seamDelta).toBeLessThan(0.02);

    // 2. Empty / malformed geometry negative (explicit refusal)
    const emptyResult = evaluateSuppliedGeometryContact(contactVertices, [], {
      requireAsphalt: true,
    });
    expect(emptyResult.contacted).toBe(false);
    expect(emptyResult.evaluatedTriangleCount).toBe(0);
    expect(emptyResult.minDist3D).toBeNull();
    expect(emptyResult.surfaceType).toBe("unsupported_empty");

    // 3. Paint-only meshes supplied to asphalt-required oracle (explicit refusal)
    const paintOnlyResult = evaluateSuppliedGeometryContact(contactVertices, paintMeshes, {
      requireAsphalt: true,
      bbox,
    });
    expect(paintOnlyResult.contacted).toBe(false);
    expect(paintOnlyResult.asphaltMeshCount).toBe(0);
    expect(paintOnlyResult.evaluatedTriangleCount).toBe(0);
    expect(paintOnlyResult.minDist3D).toBeNull();

    // 4. Measured finite distance to painted road markings (RoadEdgeLines and RoadDashes)
    const paintResult = evaluateSuppliedGeometryContact(contactVertices, paintMeshes, {
      requireAsphalt: false,
    });
    expect(paintResult.evaluatedTriangleCount).toBeGreaterThan(0);
    expect(paintResult.minDistXZ).not.toBeNull();
    expect(Number.isFinite(paintResult.minDistXZ!)).toBe(true);
    expect(paintResult.minDistXZ!).toBeGreaterThan(1.0);
    expect(paintResult.contacted).toBe(false);

    // 5. Pre-apron tip negative (driveway vertices at or behind gate without apron extension)
    const preApronGateZ = (lot.gate.y - N / 2) * 4;
    const preApronPoints: OraclePoint3D[] = [];
    for (let i = 0; i < dPos.count; i++) {
      const vz = dPos.getZ(i);
      if (vz <= preApronGateZ + 0.01 && vz >= preApronGateZ - 4.5) {
        preApronPoints.push({ x: dPos.getX(i), y: dPos.getY(i), z: vz });
      }
    }
    expect(preApronPoints.length).toBeGreaterThan(0);

    const preApronResult = evaluateSuppliedGeometryContact(preApronPoints, asphaltMeshes, {
      requireAsphalt: true,
      bbox: {
        minX: lotMinX - 10,
        maxX: lotMaxX + 10,
        minZ: lotMinZ - 10,
        maxZ: lotMaxZ + 35,
      },
    });
    expect(preApronResult.evaluatedTriangleCount).toBeGreaterThan(0);
    expect(preApronResult.minDistXZ).not.toBeNull();
    expect(Number.isFinite(preApronResult.minDistXZ!)).toBe(true);
    expect(preApronResult.minDistXZ!).toBeGreaterThan(5.5);
    expect(preApronResult.contacted).toBe(false);

    // 6. Far-separated negative control at remote point (-424, 3.0, -96) and off-map (-600, 3.0, -600)
    const farResult = evaluateSuppliedGeometryContact([{ x: -424, y: 3.0, z: -96 }], asphaltMeshes, {
      requireAsphalt: true,
    });
    expect(farResult.evaluatedTriangleCount).toBeGreaterThan(0);
    expect(farResult.minDist3D).not.toBeNull();
    expect(Number.isFinite(farResult.minDist3D!)).toBe(true);
    expect(farResult.minDist3D!).toBeGreaterThan(30);
    expect(farResult.contacted).toBe(false);

    const veryFarResult = evaluateSuppliedGeometryContact([{ x: -1000, y: 3.0, z: -1000 }], asphaltMeshes, {
      requireAsphalt: true,
    });
    expect(veryFarResult.minDist3D!).toBeGreaterThan(50);
    expect(veryFarResult.contacted).toBe(false);

    drivewayGeom.dispose();
  });

  it("M2-03 / HUD: mounts MultiplayerStatusHUD and verifies root pointerEvents none, party-race-panel pointerEvents auto, button styles, and runtime handler wiring (browser hit testing deferred to M4)", async () => {
    setupMountedDOM();

    const inviteCalls: any[] = [];
    const joinCalls: string[] = [];
    const readyCalls: Array<{ ready: boolean; raceId?: string }> = [];
    const startCalls: string[] = [];
    const cancelCalls: string[] = [];
    const leaveCalls: string[] = [];

    const sampleLobbyRace: PartyRaceState = {
      raceId: "race-lobby-42",
      hostUserId: "host-1",
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
          userId: "host-1",
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
          userId: "guest-2",
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

    let currentParticipantId = "part-host-1";
    let mockPartyRaceState: PartyRaceState | null = sampleLobbyRace;

    const mockRuntime = {
      isOwnedDriveSeated: () => true,
      subscribe: (_cb: () => void) => () => {},
      getMultiplayerClient: () => ({
        getStatus: () => "connected",
        getSessionInfo: () => ({
          sessionId: "sess-hud-1",
          inviteCode: "PARTY-HUD",
          participantId: currentParticipantId,
          mode: "driving",
        }),
      }),
      sim: {
        state: {
          remoteRacers: new Map([["peer-1", {} as any]]),
        },
      },
      getPartyRaceState: () => mockPartyRaceState,
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

    const container = (globalThis as any).document.createElement("div");
    const root = createRoot(container);

    // 1. Mount as host with sample lobby race
    await act(async () => {
      root.render(
        React.createElement(MultiplayerStatusHUD, {
          runtime: mockRuntime,
        }),
      );
    });

    const findNode = (node: any, predicate: (n: any) => boolean): any => {
      if (!node) return null;
      if (predicate(node)) return node;
      for (const child of node.children || []) {
        const found = findNode(child, predicate);
        if (found) return found;
      }
      return null;
    };

    const getReactProps = (node: any) => {
      if (!node) return null;
      for (const key of Object.keys(node)) {
        if (key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")) {
          const val = node[key];
          return val?.memoizedProps || val;
        }
      }
      return null;
    };

    // Verify root pointer-events: none
    const hudNode = findNode(container, (n) => n.getAttribute?.("data-testid") === "multiplayer-hud");
    expect(hudNode).not.toBeNull();
    const hudProps = getReactProps(hudNode);
    expect(hudProps?.style?.pointerEvents).toBe("none");

    // Verify panel pointer-events: auto
    const panelNode = findNode(container, (n) => n.getAttribute?.("data-testid") === "party-race-panel");
    expect(panelNode).not.toBeNull();
    const panelProps = getReactProps(panelNode);
    expect(panelProps?.style?.pointerEvents).toBe("auto");

    // Verify Ready button wiring for host
    const readyBtn = findNode(container, (n) => n.getAttribute?.("data-testid") === "party-race-ready-btn");
    expect(readyBtn).not.toBeNull();
    const readyProps = getReactProps(readyBtn);
    expect(readyProps?.disabled).toBe(false);
    expect(readyProps?.style?.cursor).toBe("pointer");
    readyProps?.onClick?.();
    expect(readyCalls.length).toBe(1);
    expect(readyCalls[0]).toEqual({ ready: false, raceId: "race-lobby-42" });

    // Verify Cancel button wiring for host
    const cancelBtn = findNode(container, (n) => n.getAttribute?.("data-testid") === "party-race-cancel-btn");
    expect(cancelBtn).not.toBeNull();
    const cancelProps = getReactProps(cancelBtn);
    cancelProps?.onClick?.();
    expect(cancelCalls).toEqual(["race-lobby-42"]);

    // 2. Mount as guest in fresh root to verify Leave button wiring
    await act(async () => {
      root.unmount();
    });

    const container2 = (globalThis as any).document.createElement("div");
    const root2 = createRoot(container2);
    currentParticipantId = "part-guest-2";
    mockPartyRaceState = sampleLobbyRace;
    await act(async () => {
      root2.render(
        React.createElement(MultiplayerStatusHUD, {
          runtime: mockRuntime,
        }),
      );
    });

    const leaveBtn = findNode(container2, (n) => n.getAttribute?.("data-testid") === "party-race-leave-btn");
    expect(leaveBtn).not.toBeNull();
    const leaveProps = getReactProps(leaveBtn);
    leaveProps?.onClick?.();
    expect(leaveCalls).toEqual(["race-lobby-42"]);

    // 3. Mount in countdown state to verify visible Leave button during countdown
    await act(async () => {
      root2.unmount();
    });

    const containerCountdown = (globalThis as any).document.createElement("div");
    const rootCountdown = createRoot(containerCountdown);
    currentParticipantId = "part-guest-2";
    mockPartyRaceState = {
      ...sampleLobbyRace,
      status: "countdown",
      raceId: "race-countdown-1",
    };
    await act(async () => {
      rootCountdown.render(
        React.createElement(MultiplayerStatusHUD, {
          runtime: mockRuntime,
        }),
      );
    });

    const countdownLeaveBtn = findNode(containerCountdown, (n) => n.getAttribute?.("data-testid") === "party-race-leave-btn");
    expect(countdownLeaveBtn).not.toBeNull();
    const countdownLeaveProps = getReactProps(countdownLeaveBtn);
    countdownLeaveProps?.onClick?.();
    expect(leaveCalls).toContain("race-countdown-1");

    await act(async () => {
      rootCountdown.unmount();
    });

    // 4. Mount in active racing state to verify visible Leave button and DNF/forfeit entrant label
    const containerActive = (globalThis as any).document.createElement("div");
    const rootActive = createRoot(containerActive);
    currentParticipantId = "part-guest-2";
    mockPartyRaceState = {
      ...sampleLobbyRace,
      status: "active",
      raceId: "race-active-1",
      entrants: [
        {
          userId: "user-host-1",
          username: "host_driver",
          participantId: "part-host-1",
          ready: true,
          vehicleKey: "karoo-x19-targa",
          joinedAtMs: 1000,
          checkpointIndex: 2,
          place: null,
          elapsedMs: null,
          finishedAtMs: null,
        },
        {
          userId: "user-guest-2",
          username: "guest_driver",
          participantId: "part-guest-2",
          ready: true,
          vehicleKey: "karoo-x19-targa",
          joinedAtMs: 1000,
          checkpointIndex: 0,
          place: null,
          elapsedMs: null,
          finishedAtMs: 12345, // Server DNF: finishedAtMs non-null with place null
        },
      ],
    };
    await act(async () => {
      rootActive.render(
        React.createElement(MultiplayerStatusHUD, {
          runtime: mockRuntime,
        }),
      );
    });

    const activeLeaveBtn = findNode(containerActive, (n) => n.getAttribute?.("data-testid") === "party-race-leave-btn");
    expect(activeLeaveBtn).not.toBeNull();
    const activeProgressGuest = findNode(containerActive, (n) => n.getAttribute?.("data-testid") === "party-race-progress-guest_driver");
    expect(activeProgressGuest).not.toBeNull();
    const guestProps = getReactProps(activeProgressGuest);
    expect(guestProps?.children?.join?.("")).toContain("Forfeited (Left)");

    await act(async () => {
      rootActive.unmount();
    });

    // 5. Mount with no party race in fresh root to verify Invite button wiring
    const container3 = (globalThis as any).document.createElement("div");
    const root3 = createRoot(container3);
    currentParticipantId = "part-host-1";
    mockPartyRaceState = null;
    await act(async () => {
      root3.render(
        React.createElement(MultiplayerStatusHUD, {
          runtime: mockRuntime,
        }),
      );
    });

    const inviteBtn = findNode(container3, (n) => n.getAttribute?.("data-testid") === "party-race-invite-btn");
    expect(inviteBtn).not.toBeNull();
    const inviteProps = getReactProps(inviteBtn);
    inviteProps?.onClick?.();
    expect(inviteCalls.length).toBe(1);

    await act(async () => {
      root3.unmount();
    });
  });

    it("guards degenerate triangle edges with lenSq > 1e-12 and supports indexed geometries", () => {
      // 1. Degenerate edge test
      const degenGeom = new BufferGeometry();
      const posArr = new Float32Array([
        0, 0, 0,
        0, 0, 0, // A == B
        1, 0, 0,
      ]);
      degenGeom.setAttribute("position", new BufferAttribute(posArr, 3));
      const degenMesh = new Mesh(degenGeom, new MeshStandardMaterial({ color: 0x595f6a, name: ROAD_MESH_NAME_ASPHALT }));
      const degenResult = evaluateSuppliedGeometryContact([{ x: 0.5, y: 0, z: 0 }], [degenMesh], { requireAsphalt: true });
      expect(degenResult.contacted).toBe(true);
      expect(Number.isFinite(degenResult.minDist3D)).toBe(true);

      // 2. Indexed buffer test
      const indexedGeom = new BufferGeometry();
      const iPos = new Float32Array([
        0, 0, 0,
        2, 0, 0,
        2, 0, 2,
        0, 0, 2,
      ]);
      indexedGeom.setAttribute("position", new BufferAttribute(iPos, 3));
      indexedGeom.setIndex([0, 1, 2, 0, 2, 3]);
      const indexedMesh = new Mesh(indexedGeom, new MeshStandardMaterial({ color: 0x595f6a, name: ROAD_MESH_NAME_ASPHALT }));
      const indexedResult = evaluateSuppliedGeometryContact([{ x: 1, y: 0, z: 1 }], [indexedMesh], { requireAsphalt: true });
      expect(indexedResult.evaluatedTriangleCount).toBe(2);
      expect(indexedResult.contacted).toBe(true);
      expect(indexedResult.minDist3D).toBeCloseTo(0, 5);
    });

    it("refuses non-finite vertex coordinates fail-closed: cannot fabricate origin [0, 0, 0] contact pass", () => {
      // Query point at origin [0, 0, 0]
      const queryPoints = [{ x: 0, y: 0, z: 0 }];

      // Triangle with NaN / Infinity vertex coordinates
      const nanGeom = new BufferGeometry();
      nanGeom.setAttribute("position", new BufferAttribute(new Float32Array([
        Number.NaN, 0, 0,
        Number.POSITIVE_INFINITY, 1, 0,
        0, Number.NEGATIVE_INFINITY, 1,
      ]), 3));
      const nanMesh = new Mesh(nanGeom, new MeshStandardMaterial({ color: 0x595f6a, name: ROAD_MESH_NAME_ASPHALT }));

      const nanResult = evaluateSuppliedGeometryContact(queryPoints, [nanMesh], { requireAsphalt: true });
      expect(nanResult.contacted).toBe(false);
      expect(nanResult.minDist3D).toBeNull();
    });

    it("refuses out-of-range, negative, and truncated index buffers fail-closed", () => {
      const queryPoints = [{ x: 1, y: 0, z: 1 }];

      // Mesh with out-of-bounds / invalid indices
      const badIndexGeom = new BufferGeometry();
      badIndexGeom.setAttribute("position", new BufferAttribute(new Float32Array([
        0, 0, 0,
        2, 0, 0,
        2, 0, 2,
      ]), 3));
      // Index buffer points to non-existent vertex 99 and negative vertex -1
      badIndexGeom.setIndex([99, -1, 1]);
      const badIndexMesh = new Mesh(badIndexGeom, new MeshStandardMaterial({ color: 0x595f6a, name: ROAD_MESH_NAME_ASPHALT }));

      const badIndexResult = evaluateSuppliedGeometryContact(queryPoints, [badIndexMesh], { requireAsphalt: true });
      expect(badIndexResult.contacted).toBe(false);
      expect(badIndexResult.minDist3D).toBeNull();

      // Truncated index buffer (< 3 entries)
      const truncGeom = new BufferGeometry();
      truncGeom.setAttribute("position", new BufferAttribute(new Float32Array([
        0, 0, 0,
        2, 0, 0,
        2, 0, 2,
      ]), 3));
      truncGeom.setIndex([0, 1]); // only 2 indices
      const truncMesh = new Mesh(truncGeom, new MeshStandardMaterial({ color: 0x595f6a, name: ROAD_MESH_NAME_ASPHALT }));

      const truncResult = evaluateSuppliedGeometryContact(queryPoints, [truncMesh], { requireAsphalt: true });
      expect(truncResult.contacted).toBe(false);
      expect(truncResult.minDist3D).toBeNull();
    });

    it("exercises actual production FirstPersonController driving chase camera callback against rendered fractional terrain", () => {
      const tSize = 128;
      // Mock terrain with custom height map: sloped hill around behind-car position
      const heightGrid = new Float32Array(tSize * tSize);
      const mockTerrain: any = {
        size: tSize,
        inBounds: (gx: number, gy: number) => gx >= 0 && gx < tSize && gy >= 0 && gy < tSize,
        getHeight: (gx: number, gy: number) => {
          if (gx >= 0 && gx < tSize && gy >= 0 && gy < tSize) {
            return heightGrid[gy * tSize + gx] ?? 0;
          }
          return 0;
        },
        worldY: (gx: number, gy: number) => {
          if (gx >= 0 && gx < tSize && gy >= 0 && gy < tSize) {
            return heightGrid[gy * tSize + gx] ?? 0;
          }
          return 0;
        },
      };

      const mockSim: any = {
        state: {
          terrain: mockTerrain,
          roadSet: new Set<string>(),
        },
      };

      // Helper to test camera pose across multiple headings and terrain configurations
      const testChaseCamera = (options: {
        drivingX: number;
        drivingY: number;
        heading: number;
        speed: number;
        slopedBehindHeight?: number;
      }) => {
        const camPos = { x: 0, y: 0, z: 0 };
        const lookAtTarget = { x: 0, y: 0, z: 0 };
        const mockCamera = {
          position: {
            set: (x: number, y: number, z: number) => {
              camPos.x = x;
              camPos.y = y;
              camPos.z = z;
            },
          },
          lookAt: (x: number, y: number, z: number) => {
            lookAtTarget.x = x;
            lookAtTarget.y = y;
            lookAtTarget.z = z;
          },
        };

        const mockRuntime: any = {
          getOwnedDrivePose: () => ({
            x: options.drivingX,
            y: options.drivingY,
            heading: options.heading,
            speed: options.speed,
          }),
          fpCameraCell: null,
        };

        const carWx = (options.drivingX - tSize / 2) * 4;
        const carWz = (options.drivingY - tSize / 2) * 4;
        const expectedCamX = carWx - Math.cos(options.heading) * 6.2;
        const expectedCamZ = carWz - Math.sin(options.heading) * 6.2;
        const camGridX = expectedCamX / 4 + tSize / 2;
        const camGridY = expectedCamZ / 4 + tSize / 2;
        if (options.slopedBehindHeight !== undefined) {
          const x0 = Math.floor(camGridX), y0 = Math.floor(camGridY);
          for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
              heightGrid[(y0 + dy) * tSize + (x0 + dx)] = options.slopedBehindHeight;
            }
          }
        } else {
          const camGx = Math.round(camGridX);
          const camGy = Math.round(camGridY);
          heightGrid[camGy * tSize + camGx] = 0;
        }

        const executed = updateFirstPersonDrivingChaseCamera({
          sim: mockSim,
          runtime: mockRuntime,
          camera: mockCamera,
        });

        expect(executed).toBe(true);
        // Verify camera maintains exact 6.2m chase distance behind vehicle
        const distXZ = Math.hypot(camPos.x - carWx, camPos.z - carWz);
        expect(distXZ).toBeCloseTo(6.2, 3);
        expect(camPos.x).toBeCloseTo(expectedCamX, 3);
        expect(camPos.z).toBeCloseTo(expectedCamZ, 3);

        if (options.slopedBehindHeight !== undefined) {
          // Camera clears sloped terrain by at least 1.2m
          expect(camPos.y).toBeGreaterThanOrEqual(options.slopedBehindHeight + 1.2);
        }

        expect(mockRuntime.fpCameraCell).toEqual({
          x: options.drivingX,
          y: options.drivingY,
        });

        return { camPos, lookAtTarget };
      };

      // 1. Heading 0 (East, +x) on flat ground (groundY 0.02 + chaseHeight 2.4)
      const flatEast = testChaseCamera({ drivingX: 64.5, drivingY: 64.5, heading: 0, speed: 0 });
      expect(flatEast.camPos.y).toBeCloseTo(2.42, 2);

      // 2. Heading pi/2 (South, +z) on flat ground
      const flatSouth = testChaseCamera({ drivingX: 64.25, drivingY: 64.75, heading: Math.PI / 2, speed: 10 });
      expect(flatSouth.camPos.y).toBeGreaterThan(2.4); // speed increase elevates camera

      // 3. Heading pi (West, -x) with sloped hill behind vehicle rising to 5.0m
      const slopedWest = testChaseCamera({
        drivingX: 64.0,
        drivingY: 64.0,
        heading: Math.PI,
        speed: 0,
        slopedBehindHeight: 5.0,
      });
      expect(slopedWest.camPos.y).toBeCloseTo(6.2, 2); // 5.0 + 1.2

      // 4. Heading -pi/4 (North-East) with sloped hill behind vehicle rising to 8.5m
      const slopedNE = testChaseCamera({
        drivingX: 60.125,
        drivingY: 60.375,
        heading: -Math.PI / 4,
        speed: 5,
        slopedBehindHeight: 8.5,
      });
      expect(slopedNE.camPos.y).toBeGreaterThanOrEqual(8.5 + 1.2);
    });
  });