import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Terrain } from "../src/colony/terrain";
import {
  buildBusLayer,
  buildBus,
  makeBusRig,
  BUS_ROAD_LIFT,
} from "../src/colony/render/busLayer";
import { COLONY } from "../src/colony/config";

const route = {
  stops: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
  ],
  loop: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 4, y: 0 },
    { x: 3, y: 1 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
  ],
};

describe("bus layer visual model", () => {
  it("builds a recognizable coach with windows, doors, lights, route board, roof marker, and wheel pairs", () => {
    const layer = buildBusLayer({
      terrain: {} as Terrain,
      route,
      wx: (x) => x,
      wz: (y) => y,
      roadY: () => 0,
    });

    expect(layer).not.toBeNull();
    const names = new Set<string>();
    layer!.group.traverse((object) => {
      if (object.name) names.add(object.name);
    });

    expect(Array.from(names)).toEqual(
      expect.arrayContaining([
        "bus-lower-shell",
        "bus-windscreen",
        "bus-side-window-left-0",
        "bus-side-window-right-0",
        "bus-door-left",
        "bus-door-right",
        "bus-route-board-front",
        "bus-headlight-left",
        "bus-tail-light-left",
        "bus-roof-marker",
        "bus-wheel-front-left",
        "bus-wheel-rear-right",
      ]),
    );

    layer!.dispose();
  });

  it("is a METRIC city bus: ~12 m long, ~3 m tall, 0.5 m wheels with tires touching local y=0", () => {
    // Spec 149 — the metric constitution (1 unit = 1 m): the group origin IS the road contact
    // plane, so the mesh's minY is the tire bottom and must sit on 0, not float 0.2 m up.
    const bus = buildBus();
    const box = new THREE.Box3().setFromObject(bus);
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(size.x).toBeGreaterThan(11.8); // length along the travel axis
    expect(size.x).toBeLessThan(12.5);
    expect(size.z).toBeGreaterThan(2.3); // width
    expect(size.z).toBeLessThan(2.8);
    expect(box.max.y).toBeGreaterThan(2.9); // roofline
    expect(box.max.y).toBeLessThan(3.3);
    expect(Math.abs(box.min.y)).toBeLessThanOrEqual(0.02); // tires ON the contact plane
    const wheel = bus.getObjectByName("bus-wheel-front-left") as THREE.Mesh;
    expect(wheel).toBeTruthy();
    const r = (wheel.geometry as THREE.CylinderGeometry).parameters.radiusTop;
    expect(r).toBeCloseTo(COLONY.transit.busWheelRadiusM);
  });

  it("has real transparent two-sided glazing and a named passenger interior", () => {
    const bus = buildBus();
    const required = [
      "bus-interior", "bus-interior-floor", "bus-interior-ceiling", "bus-interior-aisle",
      "bus-interior-seat-left-0", "bus-interior-seat-right-0", "bus-interior-handrail-left",
      "bus-interior-pole-front", "bus-driver-seat", "bus-dashboard", "bus-door-threshold",
    ];
    for (const name of required) expect(bus.getObjectByName(name), name).toBeTruthy();
    const glass = bus.getObjectByName("bus-side-window-left-0") as THREE.Mesh;
    const windscreen = bus.getObjectByName("bus-windscreen") as THREE.Mesh;
    for (const pane of [glass, windscreen]) {
      const material = pane.material as THREE.MeshStandardMaterial;
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeGreaterThan(0.15);
      expect(material.opacity).toBeLessThan(0.6);
      expect(material.side).toBe(THREE.DoubleSide);
      expect(material.depthWrite).toBe(false);
    }
    expect(bus.getObjectByName("bus-body")).toBeUndefined();
    expect(bus.getObjectByName("bus-window-frame-left-top")).toBeTruthy();
    expect(bus.getObjectByName("bus-window-frame-right-bottom")).toBeTruthy();
    expect(bus.getObjectByName("bus-front-frame")).toBeUndefined();
    for (const edge of ["top", "bottom", "left", "right"]) {
      expect(bus.getObjectByName(`bus-front-frame-${edge}`), edge).toBeTruthy();
    }

    const shellBox = new THREE.Box3().setFromObject(bus.getObjectByName("bus-lower-shell")!);
    const floorBox = new THREE.Box3().setFromObject(bus.getObjectByName("bus-interior-floor")!);
    const aisleBox = new THREE.Box3().setFromObject(bus.getObjectByName("bus-interior-aisle")!);
    const roofBox = new THREE.Box3().setFromObject(bus.getObjectByName("bus-roof")!);
    const leftTopFrameBox = new THREE.Box3().setFromObject(bus.getObjectByName("bus-window-frame-left-top")!);
    const rightTopFrameBox = new THREE.Box3().setFromObject(bus.getObjectByName("bus-window-frame-right-top")!);
    expect(floorBox.min.y).toBeGreaterThan(shellBox.max.y);
    expect(aisleBox.min.y).toBeGreaterThanOrEqual(floorBox.max.y);
    for (const frameBox of [leftTopFrameBox, rightTopFrameBox]) {
      const verticalOverlap = Math.min(roofBox.max.y, frameBox.max.y) - Math.max(roofBox.min.y, frameBox.min.y);
      expect(verticalOverlap).toBeGreaterThan(0);
      expect(roofBox.min.x).toBeLessThanOrEqual(frameBox.min.x);
      expect(roofBox.max.x).toBeGreaterThanOrEqual(frameBox.max.x);
      expect(roofBox.min.z).toBeLessThanOrEqual(frameBox.min.z);
      expect(roofBox.max.z).toBeGreaterThanOrEqual(frameBox.max.z);
    }
  });

  it("puts the boarding door CLEAR of the front wheel (not sitting on the tyre)", () => {
    // Operator review — the door was centred on the front axle and rendered on top of the wheel.
    // Its x-footprint must not overlap the front wheel's, along the travel axis.
    const bus = buildBus();
    const door = bus.getObjectByName("bus-door-left") as THREE.Mesh;
    const spinner = bus.getObjectByName("bus-wheel-spin-front-left")!;
    const doorBox = new THREE.Box3().setFromObject(door);
    const wheelBox = new THREE.Box3().setFromObject(spinner);
    // Disjoint in x: the door starts ahead of where the wheel ends (front overhang).
    expect(doorBox.min.x).toBeGreaterThan(wheelBox.max.x);
  });

  it("rides the road: ribbon lift, slope pitch nose-up, wheels spin with distance, body sways", () => {
    // A 12.5% grade rising along +x (grid cells are 4 m, so roadY climbs 0.5 m per cell).
    const rig = makeBusRig({
      wx: (x) => x * 4,
      wz: (y) => y * 4,
      roadY: (x) => x * 0.5,
    });
    rig.place(10, 0, 0, 0.2);
    expect(rig.group.position.y).toBeCloseTo(10 * 0.5 + BUS_ROAD_LIFT, 5);
    expect(rig.group.rotation.z).toBeGreaterThan(0.05); // climbing +x nose-up
    const spinner = rig.group.getObjectByName("bus-wheel-spin-front-left")!;
    const body = rig.group.getObjectByName("bus-body-group")!;
    const spin1 = spinner.rotation.z;
    rig.place(10.2, 0, 0, 0.2);
    expect(spinner.rotation.z).not.toBeCloseTo(spin1, 5); // wheels roll with ground covered
    expect(Math.abs(body.rotation.x)).toBeGreaterThan(0); // gentle sway while moving
    expect(Math.abs(body.rotation.x)).toBeLessThanOrEqual(COLONY.transit.swayAmpRad + 1e-9);
    rig.dispose();
  });
});
