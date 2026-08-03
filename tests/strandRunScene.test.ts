// Spec 169 slice 1b — the drive scene's geometry, tested where a failure would otherwise be
// "the operator fell through a bridge at 160 km/h".
//
// StrandRunView renders exactly what strandRunScene computes, so these properties ARE the scene:
// the deck never sags into a wash, the ribbon is the road (right width, centred on the path, above
// the ground), the chase camera stays behind and above, the gas giant hangs due west at a fixed
// distance, and the kokerbome line the drive without standing in it.
import { describe, expect, it } from "vitest";
import { buildLongBeachField } from "../src/colony/longbeach/longBeachField";
import { buildStrandRun } from "../src/colony/longbeach/strandRun";
import {
  CELL_M,
  GIANT_DISTANCE_M,
  MIN_DECK_ABOVE_SEA_M,
  ROAD_LIFT_M,
  ROAD_WIDTH_M,
  buildRibbonMesh,
  buildTerrainMesh,
  chaseCameraPose,
  deckHeights,
  gasGiantPosition,
  groundHeightM,
  kokerboomInstances,
} from "../src/colony/longbeach/strandRunScene";

const field = buildLongBeachField(1);
const run = buildStrandRun(field);

describe("Spec 169 slice 1b — the scene the operator drives", () => {
  it("the deck BRIDGES every wash: never below deck height, even where the ground is under the sea", () => {
    const decks = deckHeights(field, run);
    expect(decks.length).toBe(run.path.length);
    let bridgedSamples = 0;
    for (let i = 0; i < run.path.length; i++) {
      expect(decks[i]!, `deck at vertex ${i}`).toBeGreaterThanOrEqual(
        MIN_DECK_ABOVE_SEA_M - 1e-6,
      );
      const g = groundHeightM(field, run.path[i]!.x, run.path[i]!.y);
      if (g < 0) bridgedSamples++;
    }
    // Non-vacuity: the route must actually cross water somewhere, or the clamp proved nothing.
    expect(bridgedSamples, "wash vertices under the route").toBeGreaterThan(0);
  });

  it("the ribbon is the road: exact width, centred on the path, lifted above the deck", () => {
    const ribbon = buildRibbonMesh(field, run, ROAD_WIDTH_M);
    const decks = deckHeights(field, run);
    expect(ribbon.positions.length).toBe(run.path.length * 6);
    for (const i of [
      5,
      50,
      Math.floor(run.path.length / 2),
      run.path.length - 5,
    ]) {
      const lx = ribbon.positions[i * 6]!;
      const ly = ribbon.positions[i * 6 + 1]!;
      const lz = ribbon.positions[i * 6 + 2]!;
      const rx = ribbon.positions[i * 6 + 3]!;
      const ry = ribbon.positions[i * 6 + 4]!;
      const rz = ribbon.positions[i * 6 + 5]!;
      // Width between the pair is the carriageway, in metres.
      // Precision 3 (±5e-4 m): the verts live at ±2000 m, so unit-perp offsets carry ~1e-5 of
      // float noise — half a MICRON of asphalt is not a defect.
      expect(Math.hypot(rx - lx, rz - lz)).toBeCloseTo(ROAD_WIDTH_M, 3);
      // The pair's midpoint is the path point, world-mapped.
      const px = (run.path[i]!.x - field.width / 2) * CELL_M;
      const pz = (run.path[i]!.y - field.height / 2) * CELL_M;
      expect((lx + rx) / 2).toBeCloseTo(px, 3);
      expect((lz + rz) / 2).toBeCloseTo(pz, 3);
      // Both verts ride the lifted deck.
      expect(ly).toBeCloseTo(decks[i]! + ROAD_LIFT_M, 6);
      expect(ry).toBeCloseTo(ly, 9);
    }
  });

  it("the chase camera sits behind the car and above the deck, looking ahead", () => {
    const car = { x: 300, y: 250, heading: Math.PI / 3 };
    const pose = chaseCameraPose(field, car, 2.0);
    const cx = (car.x - field.width / 2) * CELL_M;
    const cz = (car.y - field.height / 2) * CELL_M;
    // Behind: the camera-to-car vector points along the heading.
    const toCarX = cx - pose.position[0];
    const toCarZ = cz - pose.position[2];
    const dot = toCarX * Math.cos(car.heading) + toCarZ * Math.sin(car.heading);
    expect(dot).toBeGreaterThan(0);
    // Above the deck, and the target is in front of the car.
    expect(pose.position[1]).toBeGreaterThan(2.0);
    const aheadX = pose.target[0] - cx;
    const aheadZ = pose.target[2] - cz;
    expect(
      aheadX * Math.cos(car.heading) + aheadZ * Math.sin(car.heading),
    ).toBeGreaterThan(0);
  });

  it("the gas giant hangs due WEST at its fixed distance, from anywhere", () => {
    for (const cam of [
      { x: 0, y: 10, z: 0 },
      { x: -1500, y: 40, z: 800 },
      { x: 900, y: 25, z: -600 },
    ]) {
      const [gx, gy, gz] = gasGiantPosition(cam);
      expect(gx, "west is -X").toBeLessThan(cam.x);
      expect(gy, "above the horizon").toBeGreaterThan(cam.y);
      expect(gz, "due west: no sideways drift").toBeCloseTo(cam.z, 9);
      const d = Math.hypot(gx - cam.x, gy - cam.y, gz - cam.z);
      expect(d, "fixed apparent size = fixed distance").toBeCloseTo(
        GIANT_DISTANCE_M,
        6,
      );
    }
  });

  it("kokerbome line the drive: dry ground only, never on the carriageway, deterministic", () => {
    const trees = kokerboomInstances(field, run);
    expect(trees.length, "a real stand").toBeGreaterThan(60);
    // Route x by coarse row, as the placer sees it.
    const routeXAtRow = new Map<number, number>();
    for (const p of run.path) routeXAtRow.set(Math.round(p.y / 8) * 8, p.x);
    for (const t of trees) {
      const cellX = t.position[0] / CELL_M + field.width / 2;
      const cellY = t.position[2] / CELL_M + field.height / 2;
      const i = field.idx(Math.round(cellX), Math.round(cellY));
      expect(field.water[i], "never in water").toBe(0);
      const rx = routeXAtRow.get(Math.round(cellY / 8) * 8);
      if (rx !== undefined) {
        expect(
          Math.abs(cellX - rx),
          "never on the carriageway",
        ).toBeGreaterThanOrEqual(4 - 1e-9);
      }
      expect(t.scaleY).toBeGreaterThanOrEqual(2.2);
      expect(t.scaleY).toBeLessThanOrEqual(9.0);
    }
    expect(kokerboomInstances(field, run)).toEqual(trees);
  });

  it("the terrain mesh is the field, decimated: corners match, sea dips below zero", () => {
    const mesh = buildTerrainMesh(field);
    expect(mesh.positions.length).toBe(mesh.cols * mesh.rows * 3);
    expect(mesh.indices.length).toBe((mesh.cols - 1) * (mesh.rows - 1) * 6);
    // First vertex is cell (0,0) — deep sea, so its height is negative (the sea plane covers it).
    expect(mesh.positions[1]!).toBeLessThan(0);
    // A vertex well inland sits above zero.
    const inlandCol = Math.floor(600 / 4);
    const midRow = Math.floor(mesh.rows / 2);
    expect(
      mesh.positions[(midRow * mesh.cols + inlandCol) * 3 + 1]!,
    ).toBeGreaterThan(0);
  });
});
