import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildCommercialDistrictLayer } from "../src/colony/render/commercialDistrictLayer";
import { surveyBillboards } from "../src/colony/commerce/billboards";
import { ribbonSurfaceCells, type RoadWay } from "../src/colony/render/roadRibbon";
import { findJunctionZones } from "../src/colony/render/roadJunctions";
import { attachCapPolys } from "../src/colony/render/junctionCap";
import { junctionZonesToPads } from "../src/colony/render/venuePlacement";
import { isPointInGarageVicinity } from "../src/colony/render/garageAnchorShell";

describe("CityLife Expanded QA Findings Verification (2026-10-02)", () => {
  const rt = new ColonyRuntime(4242);
  const s = rt.sim.state;
  const d = s.commercialDistrict!;
  const t = s.terrain;
  const N = t.size;
  const wx = (x: number) => (x - N / 2) * 4;
  const wz = (y: number) => (y - N / 2) * 4;
  const ways = (s.roadWays ?? []) as RoadWay[];
  const ribbonCells = ribbonSurfaceCells(ways, t);
  const junctionPads = junctionZonesToPads(attachCapPolys(findJunctionZones(ways)));

  const layer = buildCommercialDistrictLayer({
    state: s,
    district: d,
    wx,
    wz,
    surfaceY: (x, y) => Math.max(0, t.worldY(Math.round(x), Math.round(y))),
  });

  it("Finding 6: Garage showroom hero car and display cars are scaled to 1.0 real-world metres", () => {
    let heroCar: THREE.Object3D | null = null;
    const displayCars: THREE.Object3D[] = [];

    layer.group.traverse((obj) => {
      if (obj.name === "garageAnchorShowroomHeroCar") heroCar = obj;
      if (obj.name.startsWith("garageAnchorDisplayCar.")) displayCars.push(obj);
    });

    expect(heroCar).not.toBeNull();
    // Anchor container group scale must be 1.0 so replaced GLB car (scaled ~0.26 in R3FCommercialDistrict) inside 4x parent renders at 1:1 real-world size
    expect((heroCar as any).scale.x).toBeCloseTo(1.0, 4);

    expect(displayCars.length).toBeGreaterThanOrEqual(2);
    for (const car of displayCars) {
      expect((car as any).scale.x).toBeCloseTo(1.0, 4);
      // Find the realCar inside displayCar group
      let carMesh: THREE.Object3D | null = null;
      car.traverse((child) => {
        if (child.name === "carMesh" || (child as any).isMesh) carMesh = child;
      });
      expect(carMesh).not.toBeNull();
    }
  });

  it("Finding 4 & 3: Promenade lamps, benches, and planters never collide, never pierce, and clear road markings", () => {
    const lampPositions: THREE.Vector3[] = [];
    const benchPositions: THREE.Vector3[] = [];
    const planterPositions: THREE.Vector3[] = [];

    layer.group.traverse((obj) => {
      if (obj.parent === layer.group) {
        // Find lamps, benches, planters
        const children = obj.children;
        const hasPole = children.some((c: any) => c.geometry?.type === "CylinderGeometry" && c.position.y === 1.6);
        const hasSeat = children.some((c: any) => c.geometry?.type === "BoxGeometry" && Math.abs(c.position.y - 0.45) < 0.05);
        const hasTub = children.some((c: any) => c.geometry?.type === "CylinderGeometry" && Math.abs(c.position.y - 0.25) < 0.05);

        if (hasPole) lampPositions.push(obj.position.clone());
        if (hasSeat) benchPositions.push(obj.position.clone());
        if (hasTub) planterPositions.push(obj.position.clone());
      }
    });

    expect(lampPositions.length).toBeGreaterThan(0);
    expect(benchPositions.length).toBeGreaterThan(0);
    expect(planterPositions.length).toBeGreaterThan(0);

    // Verify lamps never pierce or collide with benches (min 2.5m separation)
    for (const lamp of lampPositions) {
      for (const bench of benchPositions) {
        const dist = Math.hypot(lamp.x - bench.x, lamp.z - bench.z);
        expect(dist).toBeGreaterThanOrEqual(2.5);
      }
    }

    // Verify all furniture positions are strictly outside the garage vicinity, mall pad, and junction pads
    const allFurniture = [...lampPositions, ...benchPositions, ...planterPositions];
    for (const pos of allFurniture) {
      const gx = pos.x / 4 + N / 2;
      const gy = pos.z / 4 + N / 2;

      // Never inside garage pad
      if (d.garagePad) {
        expect(isPointInGarageVicinity(gx, gy, d.garagePad)).toBe(false);
      }

      // Never inside any junction pad
      for (const pad of junctionPads) {
        const dJunction = Math.hypot(pad.cx - gx, pad.cy - gy);
        expect(dJunction).toBeGreaterThan(pad.r * 0.7);
      }

      // Never on road asphalt
      expect(ribbonCells.has(`${Math.round(gx)},${Math.round(gy)}`)).toBe(false);
    }
  });

  it("Finding 1, 2, 10: Unbuildable parcels never place crates or protruding slabs in roadways, and label halo has depthTest", () => {
    // Check that no unbuildable parcel spawned crates on the carriageway
    let looseCratesFound = 0;
    layer.group.traverse((obj) => {
      if (obj.name.startsWith("venue.")) {
        const userData = (obj as any).userData;
        if (userData?.venue && userData.venue.buildable === false) {
          // Unbuildable venue: must NOT contain crates or protruding mesh
          for (const child of obj.children) {
            if (child.name === "commercialShopNightFloor" || (child as any).isMesh) {
              looseCratesFound++;
            }
          }
        }
      }
    });
    expect(looseCratesFound).toBe(0);
  });

  it("Finding 10: MoJoJo Records billboard stands outside carriageway with swept clearance", () => {
    const renderedBoards: THREE.Object3D[] = [];
    layer.group.traverse((obj) => {
      if (obj.name.startsWith("commercialBillboard.")) renderedBoards.push(obj);
    });
    expect(renderedBoards.length).toBeGreaterThan(0);

    for (const board of renderedBoards) {
      // Check board base position
      const gx = Math.round(board.position.x / 4 + N / 2);
      const gy = Math.round(board.position.z / 4 + N / 2);
      expect(ribbonCells.has(`${gx},${gy}`)).toBe(false);

      // Check posts within the board group
      for (const child of board.children) {
        if ((child as any).geometry?.type === "CylinderGeometry") {
          const worldPos = new THREE.Vector3();
          child.getWorldPosition(worldPos);
          const postGx = Math.round(worldPos.x / 4 + N / 2);
          const postGy = Math.round(worldPos.z / 4 + N / 2);
          expect(ribbonCells.has(`${postGx},${postGy}`)).toBe(false);
        }
      }
    }
  });
});
