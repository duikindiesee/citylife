import * as THREE from "three";
import { CELL_SIZE } from "../scale";
import type { GroundAt } from "./kitGround";

export interface RoadDrapeCell { x: number; y: number }
export interface TestbedRoadDrapeInput {
  carriage: readonly RoadDrapeCell[];
  verge: readonly RoadDrapeCell[];
  mapSize: number;
  groundAt: GroundAt;
  /** Unit grid vector along the street. */
  streetAxis: readonly [number, number];
}
export interface RoadDrapeGeometry {
  geometry: THREE.BufferGeometry;
  color: string;
  roughness: number;
  kind: "carriage" | "kerb" | "fade" | "verge";
}

export const TESTBED_ASPHALT = "#595f6a";
export const TESTBED_KERB = "#e8ecf2";
export const TESTBED_VERGE = "#b9c29a";
const CARRIAGE_LIFT = 0.07;
const KERB_LIFT = 0.12;
const KERB_WIDTH = 0.22;
const FADE_LENGTH_M = 10;
const SUBDIVISIONS = 4;

const key = (x: number, y: number) => `${x},${y}`;

/** Derives the along-street direction from the carriage footprint. */
export function streetAxisFromCarriage(cells: readonly RoadDrapeCell[]): [number, number] {
  const xs = cells.map(c => c.x), ys = cells.map(c => c.y);
  const xRange = Math.max(...xs) - Math.min(...xs);
  const yRange = Math.max(...ys) - Math.min(...ys);
  return xRange >= yRange ? [1, 0] : [0, 1];
}

/** Builds terrain-following sloped-testbed street meshes without mounting the React scene. */
export function buildTestbedRoadDrape(input: TestbedRoadDrapeInput): RoadDrapeGeometry[] {
  const { carriage, verge, mapSize, groundAt } = input;
  // streetAxis remains in the input for API stability; the parcel's street-facing
  // direction is across the road, so derive the longitudinal axis from the cells.
  const axis = streetAxisFromCarriage(carriage);
  const across: [number, number] = [-axis[1], axis[0]];
  const carriageKeys = new Set(carriage.map(c => key(c.x, c.y)));
  const stations = carriage.map(c => c.x * axis[0] + c.y * axis[1]);
  const minStation = Math.min(...stations), maxStation = Math.max(...stations);
  const terminalStations = [minStation, maxStation];
  const terminalCenters = terminalStations.map(station => {
    const cells = carriage.filter(c => Math.abs(c.x * axis[0] + c.y * axis[1] - station) < 0.001);
    return cells.reduce((sum, c) => sum + c.x * across[0] + c.y * across[1], 0) / Math.max(1, cells.length);
  });
  const alongRange = (cells: readonly RoadDrapeCell[]) => {
    const values = cells.map(c => c.x * axis[0] + c.y * axis[1]);
    return values.length ? [Math.min(...values), Math.max(...values)] as const : [0, -1] as const;
  };
  const carriageRange = alongRange(carriage);
  const groundColor = new THREE.Color(TESTBED_VERGE);
  const asphaltColor = new THREE.Color(TESTBED_ASPHALT);
  const world = (gx: number, gy: number) => [(gx - mapSize / 2) * CELL_SIZE, (gy - mapSize / 2) * CELL_SIZE] as const;
  const makeGeometry = (positions: number[], indices: number[], colors?: number[]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (colors) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };
  const geometries: RoadDrapeGeometry[] = [];

  // Use one shared vertex per sampled grid point, stamping every occupied cell into it. This
  // gives the road a seamless 4x4-cell drape while preserving the exact supplied footprint.
  const buildCellSurface = (cells: readonly RoadDrapeCell[], kind: "carriage" | "fade" | "verge") => {
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    const vertexMap = new Map<string, number>();
    const add = (gx: number, gy: number, color: THREE.Color, lift: number) => {
      const k = `${gx.toFixed(5)},${gy.toFixed(5)}`;
      const existing = vertexMap.get(k);
      if (existing !== undefined) return existing;
      const index = positions.length / 3, [x, z] = world(gx, gy);
      positions.push(x, groundAt(gx, gy) + lift, z);
      colors.push(color.r, color.g, color.b);
      vertexMap.set(k, index);
      return index;
    };
    for (const cell of cells) {
      const base: number[][] = [];
      for (let iz = 0; iz <= SUBDIVISIONS; iz++) {
        const row: number[] = [];
        for (let ix = 0; ix <= SUBDIVISIONS; ix++) {
          const gx = cell.x - 0.5 + ix / SUBDIVISIONS, gy = cell.y - 0.5 + iz / SUBDIVISIONS;
          let color = kind === "verge" ? groundColor : asphaltColor;
          let lift = kind === "verge" ? 0.04 : CARRIAGE_LIFT;
          if (kind === "carriage" || kind === "fade") {
            const station = gx * axis[0] + gy * axis[1];
            const terminalDistance = Math.min(station - minStation, maxStation - station) * CELL_SIZE;
            const t = Math.max(0, Math.min(1, terminalDistance / FADE_LENGTH_M));
            color = asphaltColor.clone().lerp(groundColor, 1 - t);
            lift = CARRIAGE_LIFT * t;
          }
          row.push(add(gx, gy, color, lift));
        }
        base.push(row);
      }
      for (let iz = 0; iz < SUBDIVISIONS; iz++) for (let ix = 0; ix < SUBDIVISIONS; ix++) {
        const a = base[iz]![ix]!, b = base[iz]![ix + 1]!, c = base[iz + 1]![ix]!, d = base[iz + 1]![ix + 1]!;
        indices.push(a, c, b, b, c, d);
      }
    }
    geometries.push({ geometry: makeGeometry(positions, indices, colors), color: "#ffffff", roughness: kind === "verge" ? 1 : 0.92, kind });
  };
  buildCellSurface(carriage, "carriage");
  // An explicit apron mesh label makes the two terminal fade regions straightforward to inspect.
  geometries[0]!.kind = "fade";
  buildCellSurface(verge, "verge");

  // Find the two outside cross-street edges from the carriage footprint. Internal lane seams
  // have occupied road cells on both sides and therefore never produce kerb strips.
  const boundaryEdges = new Map<string, { a: [number, number]; b: [number, number]; side: number }>();
  for (const cell of carriage) {
    for (const [dx, dy, corners] of [
      [1, 0, [[cell.x + .5, cell.y - .5], [cell.x + .5, cell.y + .5]]],
      [-1, 0, [[cell.x - .5, cell.y + .5], [cell.x - .5, cell.y - .5]]],
      [0, 1, [[cell.x + .5, cell.y + .5], [cell.x - .5, cell.y + .5]]],
      [0, -1, [[cell.x - .5, cell.y - .5], [cell.x + .5, cell.y - .5]]],
    ] as const) {
      if (carriageKeys.has(key(cell.x + dx, cell.y + dy))) continue;
      const [a, b] = corners as readonly (readonly [number, number])[];
      const side = ((a[0] + b[0]) / 2) * across[0] + ((a[1] + b[1]) / 2) * across[1];
      const station = (((a[0] + b[0]) / 2) * axis[0] + ((a[1] + b[1]) / 2) * axis[1]);
      if (station < minStation - .01 || station > maxStation + .01) continue;
      const k = `${a[0]},${a[1]}:${b[0]},${b[1]}`;
      boundaryEdges.set(k, { a: [...a], b: [...b], side });
    }
  }
  const sides = [...new Set([...boundaryEdges.values()].map(e => Math.round(e.side * 1000) / 1000))].sort((a, b) => a - b);
  const outerSides = sides.length <= 2 ? sides : [sides[0]!, sides[sides.length - 1]!];
  for (const outerSide of outerSides) {
    const edges = [...boundaryEdges.values()].filter(e => Math.abs(e.side - outerSide) < .01).sort((a, b) => {
      const sa = (a.a[0] + a.b[0]) / 2 * axis[0] + (a.a[1] + a.b[1]) / 2 * axis[1];
      const sb = (b.a[0] + b.b[0]) / 2 * axis[0] + (b.a[1] + b.b[1]) / 2 * axis[1];
      return sa - sb;
    });
    const positions: number[] = [], indices: number[] = [];
    for (const edge of edges) {
      const station = ((edge.a[0] + edge.b[0]) / 2) * axis[0] + ((edge.a[1] + edge.b[1]) / 2) * axis[1];
      const fromEnds = Math.min(station - minStation, maxStation - station) * CELL_SIZE;
      if (fromEnds < FADE_LENGTH_M - 0.5) continue;
      const nx = across[0] * Math.sign(outerSide), ny = across[1] * Math.sign(outerSide);
      const [ax, ay] = edge.a, [bx, by] = edge.b;
      const corners = [[ax, ay], [bx, by], [bx + nx * KERB_WIDTH / CELL_SIZE, by + ny * KERB_WIDTH / CELL_SIZE], [ax + nx * KERB_WIDTH / CELL_SIZE, ay + ny * KERB_WIDTH / CELL_SIZE]] as const;
      const base = positions.length / 3;
      for (const [gx, gy] of corners) { const [x, z] = world(gx, gy); positions.push(x, groundAt(gx, gy) + KERB_LIFT, z); }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (indices.length) geometries.push({ geometry: makeGeometry(positions, indices), color: TESTBED_KERB, roughness: 0.92, kind: "kerb" });
  }
  return geometries;
}
