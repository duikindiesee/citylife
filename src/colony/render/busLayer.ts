import * as THREE from "three";
import type { Terrain } from "../terrain";
import type { BusRoute } from "../transit/busRoute";
import {
  simplifyClosed,
  smoothClosed,
  buildPath,
  samplePath,
  type PathData,
} from "../transit/path";
import { COLONY } from "../config";

// Spec 088/122/149 — the render-side BUS. Spec 149 rebuilt the coach against the world metric
// system (1 unit = 1 m, 1 cell = 4 m): a real 12 m city bus whose group origin IS the road contact
// plane, so callers put y at the ribbon top and the tires touch asphalt. The rig adds the life the
// operator asked for — wheels that spin with distance, slope pitch sampled from the road surface,
// and a gentle speed-scaled body sway (wheels stay planted). buildBusLayer remains the legacy
// self-driving single coach: the fallback when a seed has no depot (spec 149 fleets render via
// R3FBus + the fleet machine instead). De-zigzag path math lives in transit/path.ts now.

export { simplifyClosed, smoothClosed };

export interface BusLayer {
  group: THREE.Group;
  update(timeMs: number): void;
  dispose(): void;
}

export interface BusLayerOptions {
  terrain: Terrain;
  route: BusRoute;
  wx: (x: number) => number;
  wz: (y: number) => number;
  roadY: (x: number, y: number) => number; // smoothed road height
}

const SPEED = 4; // legacy coach: loop cells per second — an unhurried town coach, easy to follow by eye
const STOP_DWELL = 1.4; // seconds paused at each stop
const STOP_RADIUS = 1.2; // how close (cells) to a stop counts as "at the stop"
/** How high the coach rides above the sampled road height — the rendered ribbon's top surface
 *  (matches roadRibbon.ROAD_RIBBON_LIFT; restated here to keep this module render-math only). */
export const BUS_ROAD_LIFT = 0.18;
const CELL_M = 4; // metres per grid cell — converts path distance (cells) to wheel-spin metres

/** A posed bus: the mesh plus the per-frame math that keeps it ON the road and alive.
 *  Positions are GRID coords; the rig converts via wx/wz and clamps y to the road surface. */
export interface BusRig {
  group: THREE.Group;
  /** Place at grid (gx, gy) facing `headingGrid`, having advanced `distDeltaCells` since the last
   *  frame (drives wheel spin + sway; negative when reversing). */
  place(gx: number, gy: number, headingGrid: number, distDeltaCells: number): void;
  setDoors(open: boolean): void;
  dispose(): void;
}

export function makeBusRig(opts: {
  wx: (x: number) => number;
  wz: (y: number) => number;
  roadY: (x: number, y: number) => number;
}): BusRig {
  const t = COLONY.transit;
  const group = buildBus();
  group.rotation.order = "YZX"; // yaw around Y first, then pitch the long axis with the slope
  const body = group.getObjectByName("bus-body-group") as THREE.Group | null;
  const spins: THREE.Object3D[] = [];
  group.traverse((o) => {
    if (o.name.startsWith("bus-wheel-spin")) spins.push(o);
  });
  const doorMats: THREE.MeshStandardMaterial[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.name.startsWith("bus-door"))
      doorMats.push(m.material as THREE.MeshStandardMaterial);
  });
  let spin = 0;
  let swayPhase = 0;
  const halfWheelbaseCells = t.busWheelbaseM / 2 / CELL_M;
  return {
    group,
    place(gx, gy, headingGrid, distDeltaCells) {
      const y = Math.max(0, opts.roadY(gx, gy)) + BUS_ROAD_LIFT;
      group.position.set(opts.wx(gx), y, opts.wz(gy));
      group.rotation.y = -headingGrid; // body is long in X; the rally car's -heading convention
      // Pitch with the slope: sample the road a half-wheelbase ahead and behind along the heading
      // so the coach climbs spec-130 grades nose-up instead of knifing through them.
      const cx = Math.cos(headingGrid) * halfWheelbaseCells;
      const cy = Math.sin(headingGrid) * halfWheelbaseCells;
      const yA = Math.max(0, opts.roadY(gx + cx, gy + cy));
      const yB = Math.max(0, opts.roadY(gx - cx, gy - cy));
      group.rotation.z = Math.atan2(yA - yB, t.busWheelbaseM);
      // Wheels roll with the ground covered; the body sways a touch when moving.
      const distM = distDeltaCells * CELL_M;
      spin += distM / t.busWheelRadiusM;
      for (const s of spins) s.rotation.z = -spin;
      if (body) {
        swayPhase += Math.abs(distM) * 0.35;
        const amp = Math.min(1, Math.abs(distDeltaCells) * 60) * t.swayAmpRad;
        body.rotation.x = Math.sin(swayPhase) * amp;
      }
    },
    setDoors(open) {
      for (const m of doorMats) m.emissiveIntensity = open ? 0.9 : 0.12;
    },
    dispose() {
      disposeGroup(group);
    },
  };
}

export function buildBusLayer(opts: BusLayerOptions): BusLayer | null {
  const raw = opts.route.loop;
  if (raw.length < 2) return null;
  // De-zigzag the bus path: straighten the BFS staircase (Douglas-Peucker), then round the real
  // bends (Chaikin) — see transit/path.ts. The loop is arc-length parameterised so ground speed is
  // constant regardless of point density.
  const loop: PathData = buildPath(
    smoothClosed(simplifyClosed(raw, 1.5), 2),
    true,
  );
  if (loop.total < 1e-3) return null;
  const group = new THREE.Group();
  group.name = "Bus";
  const rig = makeBusRig(opts);
  group.add(rig.group);
  for (const s of opts.route.stops) group.add(buildStop(opts, s));

  let dist = 0; // arc length (cells) along the loop
  let last = -1;
  let dwell = 0;
  let lastStop = ""; // the stop we last paused at, cleared once we drive clear of it

  return {
    group,
    update(timeMs: number) {
      if (last < 0) last = timeMs;
      const dt = Math.min(0.1, (timeMs - last) / 1000);
      last = timeMs;
      let step = 0;
      if (dwell > 0) dwell = Math.max(0, dwell - dt);
      else {
        step = dt * SPEED;
        dist = (dist + step) % loop.total;
      }
      const p = samplePath(loop, dist);
      rig.place(p.x, p.y, p.heading, step);
      rig.setDoors(dwell > 0);
      // dwell briefly on arriving near a stop; re-arm once we have driven clear so each lap pauses again
      let near = "";
      for (const s of opts.route.stops)
        if (Math.hypot(p.x - s.x, p.y - s.y) < STOP_RADIUS) {
          near = `${s.x},${s.y}`;
          break;
        }
      if (near && near !== lastStop && dwell <= 0) {
        dwell = STOP_DWELL;
        lastStop = near;
      }
      if (!near) lastStop = "";
    },
    dispose() {
      disposeGroup(group);
    },
  };
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mt = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mt)) mt.forEach((x) => x.dispose());
    else if (mt) mt.dispose();
  });
  group.parent?.remove(group);
}

/** The coach body, to the metric constitution: 12 m long (X, the travel axis), 2.5 m wide, 3 m
 *  tall, 0.5 m wheels whose tire bottoms sit at LOCAL y = 0 — the group origin is the road contact
 *  plane. Body meshes live under `bus-body-group` (the sway group); each wheel + hub + spokes live
 *  under a `bus-wheel-spin-*` group that rotates about the axle. */
export function buildBus(): THREE.Group {
  const t = COLONY.transit;
  const L = t.busLengthM; // 12
  const W = t.busWidthM; // 2.5
  const H = t.busHeightM; // 3
  const R = t.busWheelRadiusM; // 0.5
  const axleX = t.busWheelbaseM / 2; // 3.6

  const g = new THREE.Group();
  g.name = "bus-coach";
  const body = new THREE.Group();
  body.name = "bus-body-group";
  g.add(body);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffb02e,
    roughness: 0.5,
    metalness: 0.1,
    emissive: 0x4a2f06,
    emissiveIntensity: 0.3,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xe58a18,
    roughness: 0.55,
    metalness: 0.08,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fe6ff,
    roughness: 0.2,
    metalness: 0.25,
    emissive: 0x123740,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const darkGlassMat = new THREE.MeshStandardMaterial({
    color: 0x2f708a,
    roughness: 0.28,
    metalness: 0.22,
    emissive: 0x0b2630,
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x141620,
    roughness: 0.75,
  });
  const hubMat = new THREE.MeshStandardMaterial({
    color: 0xd8dde5,
    roughness: 0.35,
  });
  const routeMat = new THREE.MeshStandardMaterial({
    color: 0x1f2937,
    emissive: 0xffd66b,
    emissiveIntensity: 0.7,
    roughness: 0.35,
  });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xfff3b0,
    emissive: 0xffe28a,
    emissiveIntensity: 1.2,
    roughness: 0.2,
  });
  const tailLightMat = new THREE.MeshStandardMaterial({
    color: 0xff4f4f,
    emissive: 0xff1f1f,
    emissiveIntensity: 0.95,
    roughness: 0.25,
  });

  // Shell: skirt at 0.35 m, roofline at H. All body details ride the sway group.
  const skirtY = 0.35;
  // Open framed shell: lower skirt, roof and pillars surround actual window apertures.
  const lowerShell = new THREE.Mesh(new THREE.BoxGeometry(L, 0.55, W), bodyMat);
  lowerShell.name = "bus-lower-shell";
  lowerShell.position.y = skirtY + 0.275;
  const beltLine = new THREE.Group();
  beltLine.name = "bus-lower-belt-line";
  for (const [side, z] of [["left", W / 2 + 0.01], ["right", -(W / 2 + 0.01)]] as const) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L + 0.1, 0.16, 0.08), trimMat);
    rail.name = `bus-lower-belt-line-${side}`;
    rail.position.set(0, 1.1, z);
    beltLine.add(rail);
  }
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(L + 0.05, 0.16, W + 0.2),
    bodyMat,
  );
  roof.name = "bus-roof";
  roof.position.y = H - 0.12;
  body.add(lowerShell, beltLine, roof);
  addWindowFrames(body, bodyMat, L, W);

  addWindowStrip(body, glassMat, W / 2 + 0.01, "left", L);
  addWindowStrip(body, glassMat, -(W / 2 + 0.01), "right", L);
  addWindscreen(body, darkGlassMat, L / 2 + 0.02, W);
  addRouteBoard(body, routeMat, L / 2 + 0.03, "front", H);
  addRouteBoard(body, routeMat, -(L / 2 + 0.03), "rear", H);
  addDoors(body, W);
  addLights(body, headlightMat, tailLightMat, L, W);
  addPassengerInterior(body, L, W, H);

  const roofMarker = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.1, 0.5),
    routeMat,
  );
  roofMarker.name = "bus-roof-marker";
  roofMarker.position.set(0.9, H + 0.1, 0);
  body.add(roofMarker);

  addWheelPair(g, wheelMat, hubMat, -axleX, "rear", R, W);
  addWheelPair(g, wheelMat, hubMat, axleX, "front", R, W);

  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return g;
}

function addWindowFrames(bus: THREE.Group, material: THREE.Material, length: number, width: number): void {
  for (const [side, z] of [["left", width / 2], ["right", -width / 2]] as const) {
    for (const [edge, y] of [["bottom", 1.55], ["top", 2.72]] as const) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.18, 0.12), material);
      rail.name = `bus-window-frame-${side}-${edge}`;
      rail.position.set(0, y, z);
      bus.add(rail);
    }
    for (let i = 0; i <= 5; i++) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.12), material);
      pillar.name = `bus-window-pillar-${side}-${i}`;
      pillar.position.set(-length / 2 + 0.9 + i * 2.02, 2.14, z);
      bus.add(pillar);
    }
  }
  const rear = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.55, width), material);
  rear.name = "bus-rear-panel";
  rear.position.set(-length / 2 + 0.08, 1.65, 0);
  bus.add(rear);

  const frontX = length / 2 - 0.08;
  for (const [edge, y] of [["bottom", 1.39], ["top", 2.71]] as const) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, width), material);
    rail.name = `bus-front-frame-${edge}`;
    rail.position.set(frontX, y, 0);
    bus.add(rail);
  }
  for (const [side, z] of [["left", width / 2 - 0.22], ["right", -(width / 2 - 0.22)]] as const) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.16, 0.16), material);
    pillar.name = `bus-front-frame-${side}`;
    pillar.position.set(frontX, 2.05, z);
    bus.add(pillar);
  }
}

function addPassengerInterior(bus: THREE.Group, length: number, width: number, height: number): void {
  const interior = new THREE.Group();
  interior.name = "bus-interior";
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x38434a, roughness: 0.85 });
  const liningMat = new THREE.MeshStandardMaterial({ color: 0xe9e5d8, roughness: 0.8, side: THREE.DoubleSide });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x285b70, roughness: 0.7 });
  const aisleMat = new THREE.MeshStandardMaterial({ color: 0xc7b27b, roughness: 0.9 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xf4c542, metalness: 0.45, roughness: 0.3 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(length - 0.35, 0.12, width - 0.2), floorMat);
  floor.name = "bus-interior-floor"; floor.position.y = 1.0;
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(length - 0.5, 0.06, width - 0.2), liningMat);
  ceiling.name = "bus-interior-ceiling"; ceiling.position.y = height - 0.14;
  const aisle = new THREE.Mesh(new THREE.BoxGeometry(length - 2.0, 0.025, 0.62), aisleMat);
  aisle.name = "bus-interior-aisle"; aisle.position.set(-0.45, 1.075, 0);
  interior.add(floor, ceiling, aisle);
  for (let i = 0; i < 4; i++) for (const [side, z] of [["left", 0.82], ["right", -0.82]] as const) {
    const seat = new THREE.Group(); seat.name = `bus-interior-seat-${side}-${i}`;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.58), seatMat); base.position.y = 1.48;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.82, 0.58), seatMat); back.position.set(-0.31, 1.82, 0);
    seat.position.set(-3.9 + i * 1.65, 0, z); seat.add(base, back); interior.add(seat);
  }
  for (const [side, z] of [["left", 0.66], ["right", -0.66]] as const) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, length - 1.4, 8), railMat);
    rail.name = `bus-interior-handrail-${side}`; rail.rotation.z = Math.PI / 2; rail.position.set(-0.35, 2.55, z); interior.add(rail);
  }
  for (const [name, x] of [["front", 3.55], ["middle", -0.5], ["rear", -4.35]] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.65, 8), railMat);
    pole.name = `bus-interior-pole-${name}`; pole.position.set(x, 1.82, 0.45); interior.add(pole);
  }
  const driver = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.75, 0.62), seatMat);
  driver.name = "bus-driver-seat"; driver.position.set(4.25, 1.48, 0.72);
  const dashboard = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, width - 0.45), floorMat);
  dashboard.name = "bus-dashboard"; dashboard.position.set(5.35, 1.45, 0);
  const threshold = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.08, 0.62), aisleMat);
  threshold.name = "bus-door-threshold"; threshold.position.set(4.85, 1.04, -0.75);
  interior.add(driver, dashboard, threshold); bus.add(interior);
}

function addWindowStrip(
  bus: THREE.Group,
  material: THREE.Material,
  z: number,
  side: "left" | "right",
  length: number,
): void {
  const n = 5;
  const w = 1.5;
  const gap = (length - 3.4 - n * w) / (n - 1); // clear of the windscreen end
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + 1.2 + w / 2 + i * (w + gap);
    const window = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.95, 0.06),
      material,
    );
    window.name = `bus-side-window-${side}-${i}`;
    window.position.set(x, 2.15, z);
    bus.add(window);
  }
}

function addWindscreen(
  bus: THREE.Group,
  material: THREE.Material,
  x: number,
  width: number,
): void {
  const windscreen = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 1.15, width - 0.6),
    material,
  );
  windscreen.name = "bus-windscreen";
  windscreen.position.set(x, 2.05, 0);
  bus.add(windscreen);
}

function addRouteBoard(
  bus: THREE.Group,
  material: THREE.Material,
  x: number,
  end: "front" | "rear",
  height: number,
): void {
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 1.7), material);
  board.name = `bus-route-board-${end}`;
  board.position.set(x, height - 0.35, 0);
  bus.add(board);
}

function addDoors(bus: THREE.Group, width: number): void {
  // Front-entrance door in the front OVERHANG, clear of the front wheel: the front axle sits at
  // x=3.6 (wheel front edge ~4.1), so a 1.3 m door centred at 4.85 (4.2–5.5) stands ahead of the
  // arch like a real city bus, not on top of the tyre. Doors get their OWN material so the rig can
  // light them when they open at a stop.
  const DOOR_X = 4.85;
  for (const [name, z] of [
    ["bus-door-left", width / 2 + 0.02],
    ["bus-door-right", -(width / 2 + 0.02)],
  ] as const) {
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0xe58a18,
      roughness: 0.55,
      metalness: 0.08,
      emissive: 0xfff3c0,
      emissiveIntensity: 0.12,
    });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.2, 0.06), doorMat);
    door.name = name;
    door.position.set(DOOR_X, 1.45, z);
    bus.add(door);
  }
}

function addWheelPair(
  bus: THREE.Group,
  wheelMat: THREE.Material,
  hubMat: THREE.Material,
  x: number,
  axle: "front" | "rear",
  radius: number,
  width: number,
): void {
  const tyreW = 0.35;
  for (const [side, z] of [
    ["left", width / 2 - tyreW / 2 + 0.02],
    ["right", -(width / 2 - tyreW / 2 + 0.02)],
  ] as const) {
    // The spin group sits at the axle; rotating it about Z rolls the wheel (spokes make it visible).
    const spinner = new THREE.Group();
    spinner.name = `bus-wheel-spin-${axle}-${side}`;
    spinner.position.set(x, radius, z);
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, tyreW, 18),
      wheelMat,
    );
    wheel.name = `bus-wheel-${axle}-${side}`;
    wheel.rotation.x = Math.PI / 2;
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, tyreW + 0.02, 12),
      hubMat,
    );
    hub.name = `bus-wheel-hub-${axle}-${side}`;
    hub.rotation.x = Math.PI / 2;
    for (const spokeAngle of [0, Math.PI / 2]) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(radius * 1.7, 0.07, tyreW + 0.04),
        hubMat,
      );
      spoke.name = `bus-wheel-spoke-${axle}-${side}-${spokeAngle > 0 ? 1 : 0}`;
      spoke.rotation.z = spokeAngle;
      spinner.add(spoke);
    }
    spinner.add(wheel, hub);
    bus.add(spinner);
  }
}

function addLights(
  bus: THREE.Group,
  headlightMat: THREE.Material,
  tailLightMat: THREE.Material,
  length: number,
  width: number,
): void {
  for (const [side, z] of [
    ["left", width / 2 - 0.55],
    ["right", -(width / 2 - 0.55)],
  ] as const) {
    const headlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.28, 0.4),
      headlightMat,
    );
    headlight.name = `bus-headlight-${side}`;
    headlight.position.set(length / 2 + 0.02, 0.85, z);
    const tailLight = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.28, 0.4),
      tailLightMat,
    );
    tailLight.name = `bus-tail-light-${side}`;
    tailLight.position.set(-(length / 2 + 0.02), 0.85, z);
    bus.add(headlight, tailLight);
  }
}

export function buildStop(
  opts: Pick<BusLayerOptions, "wx" | "wz" | "roadY">,
  s: { x: number; y: number },
): THREE.Group {
  const g = new THREE.Group();
  const baseY = Math.max(0, opts.roadY(s.x, s.y));
  g.position.set(opts.wx(s.x), baseY, opts.wz(s.y));
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x3a3f4a,
    roughness: 0.7,
  });
  const signMat = new THREE.MeshStandardMaterial({
    color: 0xffb02e,
    emissive: 0xffb02e,
    emissiveIntensity: 0.55,
    roughness: 0.4,
  });
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.07, 3.0, 8),
    poleMat,
  );
  pole.position.set(0, 1.5, 3.2);
  pole.castShadow = true;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.08), signMat);
  sign.position.set(0, 3.0, 3.2);
  g.add(pole, sign);
  return g;
}
