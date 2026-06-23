import * as THREE from "three";
import type { Terrain } from "../terrain";
import type { BusRoute } from "../transit/busRoute";

// Spec 088 — the render-loop BUS. A friendly little coach that drives the fixed busRoute loop between
// the hoods, plus a stop marker at each hood. Render-only + cosmetic: it advances on wall-clock dt
// (like the ambient cars), never touches the deterministic sim, and is rebuilt with the route.

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

const SPEED = 4; // loop cells per second — an unhurried town coach, easy to follow by eye
const STOP_DWELL = 1.4; // seconds paused at each stop
const STOP_RADIUS = 1.2; // how close (cells) to a stop counts as "at the stop"

export function buildBusLayer(opts: BusLayerOptions): BusLayer | null {
  const raw = opts.route.loop;
  if (raw.length < 2) return null;
  // De-zigzag the bus path. route.loop is a 4-connected BFS over road CELLS, so on diagonals it
  // staircases. Chaikin alone rounds the sharp corners but KEEPS the staircase WEAVE (it converges to a
  // smooth curve that still snakes through the staircase envelope), so the coach kept weaving side to
  // side. So first STRAIGHTEN the loop with Douglas-Peucker — drop points within ~1.5 cells of the
  // straight line, collapsing the sub-cell staircase weave into straight runs while keeping the road's
  // real bends — THEN chaikin-smooth those bends. The bus drives straight and glides through corners.
  // Render-only; the pure, node-tested route is untouched.
  const loop = smoothClosed(simplifyClosed(raw, 1.5), 2);
  const speedMul = Math.max(0.05, loop.length / raw.length); // keep ground speed ~constant despite the new point count
  const group = new THREE.Group();
  group.name = "Bus";
  const bus = buildBus();
  group.add(bus);
  for (const s of opts.route.stops) group.add(buildStop(opts, s));

  let dist = 0; // float index into the smoothed loop
  let last = -1;
  let dwell = 0;
  let lastStop = ""; // the stop we last paused at, cleared once we drive clear of it
  const place = (gx: number, gy: number, headingGrid: number) => {
    const y = Math.max(0, opts.roadY(gx, gy)) + 0.18; // continuous height (no cell rounding) so the coach rides smoothly, sitting on the road surface
    bus.position.set(opts.wx(gx), y, opts.wz(gy));
    bus.rotation.y = -headingGrid; // body is long in X; match the rally car's -heading convention
  };

  return {
    group,
    update(timeMs: number) {
      if (last < 0) last = timeMs;
      const dt = Math.min(0.1, (timeMs - last) / 1000);
      last = timeMs;
      if (dwell > 0) dwell = Math.max(0, dwell - dt);
      else dist = (dist + dt * SPEED * speedMul) % loop.length;
      const fi = Math.floor(dist) % loop.length;
      const fa = loop[fi]!,
        fb = loop[(fi + 1) % loop.length]!;
      const frac = dist - Math.floor(dist);
      const gx = fa.x + (fb.x - fa.x) * frac,
        gy = fa.y + (fb.y - fa.y) * frac;
      place(gx, gy, Math.atan2(fb.y - fa.y, fb.x - fa.x));
      // dwell briefly on arriving near a stop; re-arm once we have driven clear so each lap pauses again
      let near = "";
      for (const s of opts.route.stops)
        if (Math.hypot(gx - s.x, gy - s.y) < STOP_RADIUS) {
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
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mt = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mt)) mt.forEach((x) => x.dispose());
        else if (mt) mt.dispose();
      });
      group.parent?.remove(group);
    },
  };
}

/** Ramer-Douglas-Peucker line simplification on the loop (treated as a polyline from loop[0] to its last
 *  cell; the closing segment stays implicit). Drops any point within `eps` of the straight line between
 *  kept points, so the BFS staircase weave collapses into straight runs while the road's real bends
 *  (deviation > eps) are kept. */
function simplifyClosed(
  loop: { x: number; y: number }[],
  eps: number,
): { x: number; y: number }[] {
  if (loop.length < 4) return loop;
  const perp = (
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  };
  const rdp = (pts: { x: number; y: number }[]): { x: number; y: number }[] => {
    if (pts.length < 3) return pts;
    const a = pts[0]!,
      b = pts[pts.length - 1]!;
    let maxD = 0,
      idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = perp(pts[i]!, a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps)
      return rdp(pts.slice(0, idx + 1))
        .slice(0, -1)
        .concat(rdp(pts.slice(idx)));
    return [a, b];
  };
  const out = rdp(loop.map((p) => ({ x: p.x, y: p.y })));
  return out.length >= 2 ? out : loop;
}

/** Chaikin corner-cutting on a CLOSED loop: each iteration replaces every vertex with its 1/4 and 3/4
 *  points (wrapping around), rounding the BFS cell staircase into a smooth circuit. */
function smoothClosed(
  loop: { x: number; y: number }[],
  iters: number,
): { x: number; y: number }[] {
  let pts = loop.map((p) => ({ x: p.x, y: p.y }));
  for (let it = 0; it < iters; it++) {
    const n = pts.length;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i]!,
        b = pts[(i + 1) % n]!;
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    pts = out;
  }
  return pts;
}

function buildBus(): THREE.Group {
  const g = new THREE.Group();
  g.name = "bus-coach";
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
  });
  const darkGlassMat = new THREE.MeshStandardMaterial({
    color: 0x2f708a,
    roughness: 0.28,
    metalness: 0.22,
    emissive: 0x0b2630,
    emissiveIntensity: 0.45,
  });
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x141620,
    roughness: 0.75,
  });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xd8dde5, roughness: 0.35 });
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

  // Body — long in X (the travel axis). All details are render-only child meshes.
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.72, 0.86), bodyMat);
  body.name = "bus-body";
  body.position.y = 0.58;
  const beltLine = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.08, 0.9), trimMat);
  beltLine.name = "bus-lower-belt-line";
  beltLine.position.y = 0.38;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.13, 0.84), bodyMat);
  roof.name = "bus-roof";
  roof.position.y = 0.98;
  g.add(body, beltLine, roof);

  addWindowStrip(g, glassMat, 0.45, "left");
  addWindowStrip(g, glassMat, -0.45, "right");
  addWindscreen(g, darkGlassMat, 1.31);
  addRouteBoard(g, routeMat, 1.34, "front");
  addRouteBoard(g, routeMat, -1.34, "rear");
  addDoors(g, trimMat);
  addWheelPair(g, wheelMat, hubMat, -0.82, "rear");
  addWheelPair(g, wheelMat, hubMat, 0.82, "front");
  addLights(g, headlightMat, tailLightMat);

  const roofMarker = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.18), routeMat);
  roofMarker.name = "bus-roof-marker";
  roofMarker.position.set(0.22, 1.09, 0);
  g.add(roofMarker);

  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return g;
}

function addWindowStrip(
  bus: THREE.Group,
  material: THREE.Material,
  z: number,
  side: "left" | "right",
): void {
  const xs = [-0.68, -0.18, 0.34, 0.82];
  xs.forEach((x, i) => {
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.25, 0.035), material);
    window.name = `bus-side-window-${side}-${i}`;
    window.position.set(x, 0.82, z);
    bus.add(window);
  });
}

function addWindscreen(bus: THREE.Group, material: THREE.Material, x: number): void {
  const windscreen = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.32, 0.56), material);
  windscreen.name = "bus-windscreen";
  windscreen.position.set(x, 0.82, 0);
  bus.add(windscreen);
}

function addRouteBoard(
  bus: THREE.Group,
  material: THREE.Material,
  x: number,
  end: "front" | "rear",
): void {
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.5), material);
  board.name = `bus-route-board-${end}`;
  board.position.set(x, 0.99, 0);
  bus.add(board);
}

function addDoors(bus: THREE.Group, material: THREE.Material): void {
  for (const [name, z] of [
    ["bus-door-left", 0.463],
    ["bus-door-right", -0.463],
  ] as const) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.58, 0.035), material);
    door.name = name;
    door.position.set(0.2, 0.58, z);
    bus.add(door);
  }
}

function addWheelPair(
  bus: THREE.Group,
  wheelMat: THREE.Material,
  hubMat: THREE.Material,
  x: number,
  axle: "front" | "rear",
): void {
  for (const [side, z] of [
    ["left", 0.46],
    ["right", -0.46],
  ] as const) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 14), wheelMat);
    wheel.name = `bus-wheel-${axle}-${side}`;
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.2, z);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.145, 12), hubMat);
    hub.name = `bus-wheel-hub-${axle}-${side}`;
    hub.rotation.x = Math.PI / 2;
    hub.position.copy(wheel.position);
    bus.add(wheel, hub);
  }
}

function addLights(
  bus: THREE.Group,
  headlightMat: THREE.Material,
  tailLightMat: THREE.Material,
): void {
  for (const [side, z] of [
    ["left", 0.24],
    ["right", -0.24],
  ] as const) {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.12), headlightMat);
    headlight.name = `bus-headlight-${side}`;
    headlight.position.set(1.32, 0.5, z);
    const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.12), tailLightMat);
    tailLight.name = `bus-tail-light-${side}`;
    tailLight.position.set(-1.32, 0.5, z);
    bus.add(headlight, tailLight);
  }
}

function buildStop(
  opts: BusLayerOptions,
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
    new THREE.CylinderGeometry(0.05, 0.06, 1.5, 8),
    poleMat,
  );
  pole.position.set(0, 0.75, 1.3);
  pole.castShadow = true;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.06), signMat);
  sign.position.set(0, 1.5, 1.3);
  g.add(pole, sign);
  return g;
}
