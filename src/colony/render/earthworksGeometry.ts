import type { Parcel } from "../neighborhood";
import { UNDERCROFT_STOREY_M, type PlotGrading } from "../slope/plotGrading";
import { CELL_SIZE } from "../scale";
import { HOUSE_FOOTPRINT_M, housePoseForParcel } from "./housePlacement";
import { parcelStreetDirection } from "../parcelGeometry";

export type EarthworkPiece = {
  kind: "wall" | "bank" | "bench" | "lowerStorey" | "pad";
  material: string;
  bottomY: number[];
  topY: number[];
  vertices?: number[];
  box?: { centre: [number, number, number]; size: [number, number, number]; rotationY: number };
};
export type FixtureObject = { kind: "house" | "plinth" | "lowerStorey" | "garage"; position: [number, number, number]; rotation: [number, number, number]; size: [number, number, number] };

const WALL = "#9a948a", COPING = "#7d776e", BANK = "#a8956f", STOREY = "#b8b0a0", PAD = "#b5a58d", RECESS = "#3a3732";
type Point = [number, number];
const toWorld = (gx: number, gy: number, mapSize: number): Point => [(gx - mapSize / 2) * CELL_SIZE, (gy - mapSize / 2) * CELL_SIZE];
const rotate = (x: number, z: number, angle: number): Point => [x * Math.cos(angle) + z * Math.sin(angle), -x * Math.sin(angle) + z * Math.cos(angle)];

/** Pure, terrain seated earthwork geometry. Wall quads are [bottomA,bottomB,topB,topA]. */
export function buildEarthworksGeometry(grading: PlotGrading, parcel: Parcel, groundAt: (gx: number, gy: number) => number, mapSize: number, housePose = housePoseForParcel(parcel, mapSize, grading)): EarthworkPiece[] {
  const street = parcelStreetDirection(parcel), side: Point = [-street[1], street[0]];
  const cx = housePose.position[0] / CELL_SIZE + mapSize / 2, cz = housePose.position[2] / CELL_SIZE + mapSize / 2;
  const halfW = HOUSE_FOOTPRINT_M.w / 2, halfD = HOUSE_FOOTPRINT_M.d / 2, padHalfW = halfW + 1.5, padHalfD = halfD + 1.5;
  const corners: Point[] = [[-padHalfW, -padHalfD], [padHalfW, -padHalfD], [padHalfW, padHalfD], [-padHalfW, padHalfD]].map(([x, z]) => { const [rx, rz] = rotate(x, z, housePose.rotationY); return [cx + rx / CELL_SIZE, cz + rz / CELL_SIZE]; });
  const pieces: EarthworkPiece[] = [];
  const piece = (kind: EarthworkPiece["kind"], material: string): EarthworkPiece => {
    let found = pieces.find(p => p.kind === kind && p.material === material);
    if (!found) { found = { kind, material, bottomY: [], topY: [], vertices: [] }; pieces.push(found); }
    return found;
  };
  const quad = (kind: EarthworkPiece["kind"], material: string, points: [Point, number][]) => {
    const target = piece(kind, material);
    for (const [p, y] of points) { const [x, z] = toWorld(p[0], p[1], mapSize); target.vertices!.push(x, y, z); }
  };
  const wallQuad = (a: Point, b: Point, bottomA: number, bottomB: number, topA: number, topB: number, material = WALL) => {
    quad(material === STOREY || material === RECESS ? "lowerStorey" : "wall", material, [[a, bottomA], [b, bottomB], [b, topB], [a, topA]]);
    const target = piece(material === STOREY || material === RECESS ? "lowerStorey" : "wall", material); target.bottomY.push(bottomA, bottomB); target.topY.push(topB, topA);
  };
  const horizontal = (a: Point, b: Point, y: number, material: string, width = 0) => {
    let aa = a, bb = b;
    if (width) { const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1; aa = [a[0] - dz / len * width / CELL_SIZE, a[1] + dx / len * width / CELL_SIZE]; bb = [b[0] - dz / len * width / CELL_SIZE, b[1] + dx / len * width / CELL_SIZE]; }
    quad(material === STOREY || material === RECESS ? "lowerStorey" : "wall", material, [[a, y], [b, y], [bb, y], [aa, y]]);
  };
  const copingQuad = (a: Point, b: Point, topA: number, topB: number, width: number) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    const offset: Point = [-dz / len * width / CELL_SIZE, dx / len * width / CELL_SIZE];
    const aa: Point = [a[0] + offset[0], a[1] + offset[1]], bb: Point = [b[0] + offset[0], b[1] + offset[1]];
    quad("wall", COPING, [[a, topA], [b, topB], [bb, topB], [aa, topA]]);
  };
  // Flat pad, a metre and a half wider than the 11.5 m house on each side.
  for (let i = 0; i < 4; i++) quad("pad", PAD, [[corners[i]!, grading.padY], [corners[(i + 1) % 4]!, grading.padY], [corners[(i + 1) % 4]!, grading.padY], [corners[i]!, grading.padY]]);

  const platform = grading.technique === "house-platform" || grading.technique === "level-pad";
  const stepCells = 0.5 / CELL_SIZE;
  const perimeterDepth = Math.max(...corners.map(p => Math.abs(grading.padY - groundAt(p[0], p[1]))));
  const tiers = Math.max(1, Math.ceil(perimeterDepth / 1.6));
  for (let e = 0; e < 4; e++) {
    const a = corners[e]!, b = corners[(e + 1) % 4]!, len = Math.hypot((b[0] - a[0]) * CELL_SIZE, (b[1] - a[1]) * CELL_SIZE), count = Math.max(1, Math.ceil(len / 0.5));
    const edge: Point[] = Array.from({ length: count + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / count, a[1] + (b[1] - a[1]) * i / count]);
    const dx = b[0] - a[0], dz = b[1] - a[1], n = Math.hypot(dx, dz) || 1, outward: Point = [dz / n, -dx / n];
    const deltas = edge.map(p => grading.padY - groundAt(p[0], p[1]));
    for (let i = 0; i < count; i++) {
      const p = edge[i]!, q = edge[i + 1]!, ga = groundAt(p[0], p[1]), gb = groundAt(q[0], q[1]), da = deltas[i]!, db = deltas[i + 1]!;
      if (Math.max(Math.abs(da), Math.abs(db)) <= 0.15) continue;
      if (da >= 0 && db >= 0 && platform) {
        const lengthA = Math.min(Math.max(0, 2 * da), grading.banks.reduce((m, bank) => Math.max(m, bank.lengthM), 0));
        const lengthB = Math.min(Math.max(0, 2 * db), grading.banks.reduce((m, bank) => Math.max(m, bank.lengthM), 0));
        const farA: Point = [p[0] + outward[0] * lengthA / CELL_SIZE, p[1] + outward[1] * lengthA / CELL_SIZE], farB: Point = [q[0] + outward[0] * lengthB / CELL_SIZE, q[1] + outward[1] * lengthB / CELL_SIZE];
        quad("bank", BANK, [[p, grading.padY], [q, grading.padY], [farB, groundAt(...farB)], [farA, groundAt(...farA)]]);
      } else {
        const emitTiers = (sign: "fill" | "cut", depthA: number, depthB: number) => {
          if (depthA <= 0 && depthB <= 0) return;
          const level = (depth: number, k: number) => grading.padY + (sign === "fill" ? -1 : 1) * depth * k / tiers;
          for (let k = 0; k < tiers; k++) {
            const offset = k / CELL_SIZE;
            const pa: Point = [p[0] + outward[0] * offset, p[1] + outward[1] * offset], pb: Point = [q[0] + outward[0] * offset, q[1] + outward[1] * offset];
            const topA = level(depthA, k), topB = level(depthB, k), benchA = level(depthA, k + 1), benchB = level(depthB, k + 1);
            const gaAt = groundAt(...pa), gbAt = groundAt(...pb), last = k === tiers - 1;
            const bottomA = last ? Math.min(benchA, gaAt) : benchA;
            const bottomB = last ? Math.min(benchB, gbAt) : benchB;
            const faceTopA = sign === "fill" ? topA : Math.min(ga + 0.05, topA), faceTopB = sign === "fill" ? topB : Math.min(gb + 0.05, topB);
            wallQuad(pa, pb, bottomA, bottomB, faceTopA, faceTopB);
            copingQuad(pa, pb, faceTopA, faceTopB, 0.25);
            if (!last) {
              const nextA: Point = [pa[0] + outward[0] / CELL_SIZE, pa[1] + outward[1] / CELL_SIZE], nextB: Point = [pb[0] + outward[0] / CELL_SIZE, pb[1] + outward[1] / CELL_SIZE];
              quad("bench", BANK, [[pa, benchA], [pb, benchB], [nextB, benchB], [nextA, benchA]]);
            }
          }
        };
        emitTiers("fill", Math.max(0, da), Math.max(0, db));
        emitTiers("cut", Math.max(0, -da), Math.max(0, -db));
      }
    }
  }

  if (grading.garageMode === "undercroft") {
    const front: Point = [cx + street[0] * halfD / CELL_SIZE, cz + street[1] * halfD / CELL_SIZE], rear: Point = [cx - street[0] * halfD / CELL_SIZE, cz - street[1] * halfD / CELL_SIZE];
    const left: Point = [front[0] + side[0] * halfW / CELL_SIZE, front[1] + side[1] * halfW / CELL_SIZE], right: Point = [front[0] - side[0] * halfW / CELL_SIZE, front[1] - side[1] * halfW / CELL_SIZE];
    const rearLeft: Point = [rear[0] + side[0] * halfW / CELL_SIZE, rear[1] + side[1] * halfW / CELL_SIZE], rearRight: Point = [rear[0] - side[0] * halfW / CELL_SIZE, rear[1] - side[1] * halfW / CELL_SIZE];
    const bottomAt = (p: Point) => Math.min(grading.garageFloorY - 0.15, groundAt(...p) - 0.3), top = grading.houseFloorY;
    const openingBottom = grading.garageFloorY, openingTop = Math.min(openingBottom + 2.6, top), openingHalf = 2.1 / CELL_SIZE;
    const openLeft: Point = [cx + side[0] * openingHalf, cz + side[1] * openingHalf], openRight: Point = [cx - side[0] * openingHalf, cz - side[1] * openingHalf];
    const fb = bottomAt(left), frb = bottomAt(right);
    wallQuad(left, openLeft, fb, bottomAt(openLeft), top, top, STOREY);
    wallQuad(openRight, right, bottomAt(openRight), frb, top, top, STOREY);
    wallQuad(openLeft, openRight, openingTop, openingTop, top, top, STOREY);
    const setback = 0.05 / CELL_SIZE;
    const recessLeft: Point = [openLeft[0] + street[0] * setback, openLeft[1] + street[1] * setback];
    const recessRight: Point = [openRight[0] + street[0] * setback, openRight[1] + street[1] * setback];
    // This single inset quad faces the street; reverse the generic wall winding.
    quad("lowerStorey", RECESS, [[recessLeft, openingBottom], [recessLeft, openingTop], [recessRight, openingTop], [recessRight, openingBottom]]);
    wallQuad(left, rearLeft, fb, bottomAt(rearLeft), top, top, STOREY);
    wallQuad(rearLeft, rearRight, bottomAt(rearLeft), bottomAt(rearRight), top, top, STOREY);
    wallQuad(rearRight, right, bottomAt(rearRight), frb, top, top, STOREY);
    // Cut retaining faces are added wherever the surrounding ground rises above garage level.
    for (const [a, b] of [[left, rearLeft], [rearLeft, rearRight], [rearRight, right]] as [Point, Point][]) {
      const ga = groundAt(...a), gb = groundAt(...b);
      if (Math.max(ga, gb) > grading.garageFloorY) wallQuad(a, b, grading.garageFloorY, grading.garageFloorY, ga + 0.05, gb + 0.05, WALL);
    }
  }

  if (grading.garageMode === "street-level-cut") {
    const front: Point = [cx + street[0] * halfD / CELL_SIZE, cz + street[1] * halfD / CELL_SIZE], rear: Point = [cx - street[0] * halfD / CELL_SIZE, cz - street[1] * halfD / CELL_SIZE];
    const width = halfW / CELL_SIZE, depth = Math.min(grading.garageCutDepthM, halfD) / CELL_SIZE;
    const pts: Point[] = [[front[0] + side[0] * width, front[1] + side[1] * width], [front[0] - side[0] * width, front[1] - side[1] * width], [rear[0] - street[0] * depth, rear[1] - street[1] * depth], [rear[0] + street[0] * depth, rear[1] + street[1] * depth]];
    for (let i = 0; i < 4; i++) { const a = pts[i]!, b = pts[(i + 1) % 4]!, ga = groundAt(...a), gb = groundAt(...b); if (Math.max(ga, gb) > grading.garageFloorY) { wallQuad(a, b, grading.garageFloorY, grading.garageFloorY, ga + 0.05, gb + 0.05); copingQuad(a, b, ga + 0.05, gb + 0.05, 0.25); } }
  }
  return pieces;
}

/** Pure upright object inventory used by the testbed and pose regression test. */
export function buildFixtureObjects(fixture: { parcel: Parcel; grading: PlotGrading; mapSize: number; groundAt: (gx: number, gy: number) => number }): FixtureObject[] {
  const { parcel, grading, mapSize } = fixture, pose = housePoseForParcel(parcel, mapSize, grading), angle = pose.rotationY;
  const out: FixtureObject[] = [{ kind: "house", position: [pose.position[0], grading.houseFloorY + 1.5, pose.position[2]], rotation: [0, angle, 0], size: [11.5, 3, 11.5] }];
  if (grading.garageMode === "undercroft") { out.push({ kind: "lowerStorey", position: [pose.position[0], (grading.garageFloorY + grading.houseFloorY) / 2, pose.position[2]], rotation: [0, angle, 0], size: [11.5, UNDERCROFT_STOREY_M, 5.75] }); out.push({ kind: "garage", position: starterCentre(parcel, mapSize, grading.garageFloorY), rotation: [0, angle, 0], size: [4, 3, 8] }); }
  else if (grading.garageMode === "street-level-cut") out.push({ kind: "garage", position: starterCentre(parcel, mapSize, grading.garageFloorY), rotation: [0, angle, 0], size: [4, 3, 8] });
  return out;
}
function starterCentre(parcel: Parcel, mapSize: number, y: number): [number, number, number] { const s = parcelStreetDirection(parcel), d = parcel.driveway.at(-1) ?? parcel.gate, frontOffset = parcel.driveway.length <= 2 ? 1 : 0; return [(d.x - mapSize / 2) * CELL_SIZE - s[0] * (6 - frontOffset), y, (d.y - mapSize / 2) * CELL_SIZE - s[1] * (6 - frontOffset)]; }
