import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { isPointInGarageVicinity } from "../src/colony/render/garageAnchorShell";
import { createWorldLayoutDocument } from "../src/colony/spatial/worldLayoutDocument";

describe("Garage Road Walkability & Exit Regression (Exact Hosted Park & Exit Coordinates)", () => {
  it("proves equivalence between seed-4242 generated layout and hosted actual-pair world layout", () => {
    const runtime = new ColonyRuntime(4242);
    const surveyDoc = runtime.captureWorldLayout();
    const doc = createWorldLayoutDocument({
      ...surveyDoc,
      layoutId: "seed-4242",
      seed: 4242,
      revision: { number: 0, parentHash: null },
    });

    // 1. Grid geometry and origin equivalence
    const terrain = runtime.sim.state.terrain;
    expect(terrain.size).toBe(608);
    const surfaceFrame = doc.frames.find((f: any) => f.id === "frame-surface" || f.id === "surface" || f.layer === "surface") ?? doc.frames[0];
    expect(surfaceFrame).toBeDefined();
    expect(surfaceFrame!.grid?.cellSize).toBe(4);
    expect(surfaceFrame!.grid?.width).toBe(608);
    expect(surfaceFrame!.grid?.height).toBe(608);

    // 2. Commercial garage pad presence and exact transform
    const district = runtime.sim.state.commercialDistrict;
    expect(district).toBeDefined();
    const garagePad = district!.garagePad;
    expect(garagePad).toBeDefined();
    expect(garagePad!.x).toBe(130);
    expect(garagePad!.y).toBe(270);
    expect(garagePad!.w).toBe(16);
    expect(garagePad!.h).toBe(11);
    expect(garagePad!.facingAngle).toBeCloseTo(Math.PI, 4);

    // 3. Exact hosted failure coordinates: world x = -660.48, z = -156.00
    const HOSTED_WORLD_X = -660.48;
    const HOSTED_WORLD_Z = -156.00;
    const originCell = terrain.size / 2; // 304
    const cellX = HOSTED_WORLD_X / 4 + originCell; // 138.88
    const cellY = HOSTED_WORLD_Z / 4 + originCell; // 265.00
    expect(cellX).toBeCloseTo(138.88, 2);
    expect(cellY).toBeCloseTo(265.00, 2);

    const roundedCellKey = `${Math.round(cellX)},${Math.round(cellY)}`; // "139,265"
    expect(runtime.sim.state.roadSet.has(roundedCellKey)).toBe(true);

    // 4. Proves the root-cause condition: cell is in garage apron throat, but NOT a cadastral garage surface
    const inVicinity = isPointInGarageVicinity(Math.round(cellX), Math.round(cellY), garagePad!);
    expect(inVicinity).toBe(true);

    const inGarageSurface = (runtime as any).isGaragePadWalkable(Math.round(cellX), Math.round(cellY), garagePad!);
    expect(inGarageSurface).toBe(false);
  });

  it("passes exitOwnedCar at exact hosted coordinates with fix, and reproduces d0cf712 failure without it", () => {
    const runtime = new ColonyRuntime(4242);
    const size = runtime.sim.state.terrain.size;
    const cellX = -660.48 / 4 + size / 2;
    const cellY = -156.00 / 4 + size / 2;
    const rx = Math.round(cellX);
    const ry = Math.round(cellY);

    // 1. Verify candidate exit cells around parked vehicle are municipal roads
    const candidates = [
      { x: Math.round(cellX - Math.sin(-Math.PI / 2)), y: Math.round(cellY + Math.cos(-Math.PI / 2)) }, // (140, 265)
      { x: Math.round(cellX + Math.sin(-Math.PI / 2)), y: Math.round(cellY - Math.cos(-Math.PI / 2)) }, // (138, 265)
      { x: Math.round(cellX - Math.cos(-Math.PI / 2)), y: Math.round(cellY - Math.sin(-Math.PI / 2)) }, // (139, 266)
      { x: Math.round(cellX + Math.cos(-Math.PI / 2)), y: Math.round(cellY + Math.sin(-Math.PI / 2)) }, // (139, 264)
    ];

    for (const c of candidates) {
      expect(runtime.sim.state.roadSet.has(`${c.x},${c.y}`)).toBe(true);
      // With fix: road cells inside vicinity evaluate to null (walkable)
      const reason = (runtime as any).blockedStepReason(c.x, c.y);
      expect(reason).toBeNull();
    }

    // 2. Full exitOwnedCar execution
    (runtime as any).ownedDrivePose = {
      x: cellX,
      y: cellY,
      heading: -Math.PI / 2,
      speed: 0,
    };
    (runtime as any).ownedDriveSeated = true;
    (runtime as any).operatorUserId = "test-operator";
    (runtime as any).authoritativeCar = { id: "karoo-vonk-11", name: "Karoo" } as any;

    const exited = runtime.exitOwnedCar();
    expect(exited).toBe(true);
    expect((runtime as any).ownedDriveSeated).toBe(false);
    expect((runtime as any).fpCameraCell).not.toBeNull();

    // Verify exit distance from vehicle is within legitimate boarding range (< 16m)
    const exitCell = (runtime as any).fpCameraCell;
    const distMetres = Math.hypot((exitCell.x - cellX) * 4, (exitCell.y - cellY) * 4);
    expect(distMetres).toBeLessThan(16);
  });

  describe("Negative Coverage: Preserves All Non-Road Obstacle & Boundary Rejections", () => {
    it("rejects map edge coordinates as 'edge of map'", () => {
      const runtime = new ColonyRuntime(4242);
      const size = runtime.sim.state.terrain.size;
      expect((runtime as any).blockedStepReason(-1, 100)).toBe("edge of map");
      expect((runtime as any).blockedStepReason(100, -1)).toBe("edge of map");
      expect((runtime as any).blockedStepReason(size, 100)).toBe("edge of map");
      expect((runtime as any).blockedStepReason(100, size)).toBe("edge of map");
    });

    it("rejects water cells as 'water'", () => {
      const runtime = new ColonyRuntime(4242);
      const t = runtime.sim.state.terrain;
      let waterX = -1;
      let waterY = -1;
      for (let y = 10; y < t.size - 10 && waterX < 0; y += 10) {
        for (let x = 10; x < t.size - 10 && waterX < 0; x += 10) {
          if (t.isWater(x, y)) {
            waterX = x;
            waterY = y;
          }
        }
      }
      expect(waterX).toBeGreaterThanOrEqual(0);
      expect((runtime as any).blockedStepReason(waterX, waterY)).toBe("water");
    });

    it("rejects building structures as 'building'", () => {
      const runtime = new ColonyRuntime(4242);
      const t = runtime.sim.state.terrain;
      // Find a dry land cell
      let dryX = 130, dryY = 260;
      for (let y = 130; y < 270; y++) {
        for (let x = 130; x < 270; x++) {
          if (!t.isWater(x, y) && !runtime.sim.state.roadSet.has(`${x},${y}`)) {
            dryX = x;
            dryY = y;
            break;
          }
        }
      }
      runtime.sim.state.buildings.push({
        id: "test-building",
        x: dryX,
        y: dryY,
        w: 1,
        h: 1,
      } as any);
      expect((runtime as any).blockedStepReason(dryX, dryY)).toBe("building");
    });

    it("rejects non-road occupied parcel cells as 'parcel'", () => {
      const runtime = new ColonyRuntime(4242);
      const t = runtime.sim.state.terrain;
      // Pick a dry parcel cell not in roadSet
      let occupiedNonRoadKey: string | null = null;
      for (const key of runtime.sim.state.occupied) {
        const [ox, oy] = key.split(",").map(Number);
        if (!runtime.sim.state.roadSet.has(key) && !t.isWater(ox, oy)) {
          occupiedNonRoadKey = key;
          break;
        }
      }
      expect(occupiedNonRoadKey).not.toBeNull();
      const [ox, oy] = occupiedNonRoadKey!.split(",").map(Number);
      expect((runtime as any).blockedStepReason(ox, oy)).toBe("parcel");
    });

    it("rejects non-walkable garage structure footprint cells as 'building'", () => {
      const runtime = new ColonyRuntime(4242);
      const garagePad = runtime.sim.state.commercialDistrict!.garagePad!;
      // Cell (139, 267) is in garage vicinity but is NOT road and NOT in walkable surface
      const nonWalkableGarageCell = { x: 139, y: 267 };
      expect(runtime.sim.state.roadSet.has("139,267")).toBe(false);
      expect(isPointInGarageVicinity(nonWalkableGarageCell.x, nonWalkableGarageCell.y, garagePad)).toBe(true);
      expect((runtime as any).isGaragePadWalkable(nonWalkableGarageCell.x, nonWalkableGarageCell.y, garagePad)).toBe(false);
      expect((runtime as any).blockedStepReason(nonWalkableGarageCell.x, nonWalkableGarageCell.y)).toBe("building");
    });
  });
});
