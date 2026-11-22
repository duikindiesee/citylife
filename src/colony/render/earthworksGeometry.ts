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
  quad("pad", PAD, corners.map((corner) => [corner, grading.padY]));

  const platform = grading.technique === "house-platform" || grading.technique === "level-pad";
  for (let e = 0; e < 4; e++) {
    const a = corners[e]!, b = corners[(e + 1) % 4]!, len = Math.hypot((b[0] - a[0]) * CELL_SIZE, (b[1] - a[1]) * CELL_SIZE), count = Math.max(1, Math.ceil(len / 0.5));
    const edge: Point[] = Array.from({ length: count + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / count, a[1] + (b[1] - a[1]) * i / count]);
    const dx = b[0] - a[0], dz = b[1] - a[1], n = Math.hypot(dx, dz) || 1, outward: Point = [dz / n, -dx / n];
    const delta = edge.map(p => grading.padY - groundAt(...p));
    const cls = (d: number): "fill" | "cut" | "level" => Math.abs(d) <= 0.15 ? "level" : d > 0 ? "fill" : "cut";
    let start = 0;
    while (start < count) {
      const type = cls((delta[start]! + delta[start + 1]!) / 2);
      let end = start + 1;
      while (end < count && cls((delta[end]! + delta[end + 1]!) / 2) === type) end++;
      const p = edge[start]!, q = edge[end]!, da = delta[start]!, db = delta[end]!;
      if (type !== "level") {
        if (type === "fill" && platform) {
          const depth = Math.max(0, da, db), bankMax = grading.banks.reduce((m, bank) => Math.max(m, bank.lengthM), 0), length = Math.min(2 * depth, bankMax);
          const steps = Math.max(1, Math.ceil(len / 0.5));
          for (let i = 0; i < steps; i++) {
            const t0 = i / steps, t1 = (i + 1) / steps;
            const a: Point = [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0];
            const b: Point = [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1];
            const fa: Point = [a[0] + outward[0] * length / CELL_SIZE, a[1] + outward[1] * length / CELL_SIZE];
            const fb: Point = [b[0] + outward[0] * length / CELL_SIZE, b[1] + outward[1] * length / CELL_SIZE];
            quad("bank", BANK, [[a, grading.padY], [b, grading.padY], [fb, groundAt(...fb)], [fa, groundAt(...fa)]]);
          }
        } else {
          const sign = type;
          const maxDepth = Math.max(Math.abs(da), Math.abs(db)), tiers = Math.max(1, Math.ceil(maxDepth / 1.6));
          const offsetPoint = (v: Point, tier: number): Point => [v[0] + outward[0] * tier / CELL_SIZE, v[1] + outward[1] * tier / CELL_SIZE];
          for (let k = 0; k < tiers; k++) {
            const pa = offsetPoint(p, k), pb = offsetPoint(q, k), nextA = offsetPoint(p, k + 1), nextB = offsetPoint(q, k + 1);
            const top = sign === "fill" ? grading.padY - k * maxDepth / tiers : grading.padY + k * maxDepth / tiers;
            const nextTop = sign === "fill" ? grading.padY - (k + 1) * maxDepth / tiers : grading.padY + (k + 1) * maxDepth / tiers;
            const topA = sign === "cut" ? groundAt(...pa) + 0.05 : top;
            const topB = sign === "cut" ? groundAt(...pb) + 0.05 : top;
            const bottomA = k === tiers - 1 ? Math.min(nextTop, groundAt(...nextA) - 0.3) : nextTop;
            const bottomB = k === tiers - 1 ? Math.min(nextTop, groundAt(...nextB) - 0.3) : nextTop;
            wallQuad(pa, pb, bottomA, bottomB, topA, topB);
            copingQuad(pa, pb, topA, topB, 0.25);
            if (k < tiers - 1) quad("bench", BANK, [[pa, nextTop], [pb, nextTop], [nextB, nextTop], [nextA, nextTop]]);
          }
        }
      }
      start = end;
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
