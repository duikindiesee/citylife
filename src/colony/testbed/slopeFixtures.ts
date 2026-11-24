import { ColonyRuntime } from "../runtime";
import type { Parcel } from "../neighborhood";
import { gradePlot, type PlotGrading, type SlopeBand } from "../slope/plotGrading";
import type { GroundAt } from "../render/kitGround";
import type { Cell } from "../pathfind";
import { CELL_SIZE } from "../scale";

export type SlopeFixtureKind = "downhill" | "uphill" | "gentle" | "flat";
export interface SlopeFixture {
  kind: SlopeFixtureKind;
  seed: number;
  parcel: Parcel;
  neighbours: Parcel[];
  grading: PlotGrading;
  groundAt: GroundAt;
  carriage: Cell[];
  verge: Cell[];
  mapSize: number;
  runtime: ColonyRuntime;
}

export interface HeightfieldWindow { minGx: number; maxGx: number; minGy: number; maxGy: number }

/** Compute bounds for rendered context, with 15 m terrain margin. */
function computeHeightfieldWindow(fixture: Pick<SlopeFixture, "neighbours" | "parcel" | "carriage" | "verge" | "mapSize">): HeightfieldWindow {
  const xs: number[] = [], ys: number[] = [];
  const add = (x: number, y: number) => { xs.push(x); ys.push(y); };
  for (const parcel of fixture.neighbours) {
    for (const cell of [...parcel.fence, parcel.gate]) { add(cell.x - 1, cell.y - 1); add(cell.x + 1, cell.y + 1); }
    for (const cell of parcel.driveway) add(cell.x, cell.y);
    const hw = parcel.houseZone.w / 2, hh = parcel.houseZone.d / 2;
    add(parcel.houseZone.x - hw, parcel.houseZone.y - hh); add(parcel.houseZone.x + hw, parcel.houseZone.y + hh);
  }
  for (const cell of [...fixture.carriage, ...fixture.verge]) { add(cell.x - .5, cell.y - .5); add(cell.x + .5, cell.y + .5); }
  const margin = 15 / CELL_SIZE;
  let minGx = Math.floor(Math.min(...xs) - margin), maxGx = Math.ceil(Math.max(...xs) + margin);
  let minGy = Math.floor(Math.min(...ys) - margin), maxGy = Math.ceil(Math.max(...ys) + margin);
  return { minGx, maxGx, minGy, maxGy };
}

/** Bounds every rendered parcel, house, street and driveway, with 15 m terrain margin. */
export function heightfieldWindow(fixture: Pick<SlopeFixture, "neighbours" | "parcel" | "carriage" | "verge" | "mapSize">): HeightfieldWindow {
  const window = computeHeightfieldWindow(fixture);
  if ((window.maxGx - window.minGx) * CELL_SIZE > 320 || (window.maxGy - window.minGy) * CELL_SIZE > 320)
    throw new Error(`Slope fixture ${fixture.parcel.id} exceeds the 320 m heightfield cap: ${(window.maxGx-window.minGx)*CELL_SIZE} × ${(window.maxGy-window.minGy)*CELL_SIZE} m`);
  return window;
}

const FIXTURE: Record<Exclude<SlopeFixtureKind, "flat">, { seed: number; band: SlopeBand }> = {
  downhill: { seed: 42, band: "steep-downhill" },
  uphill: { seed: 4242, band: "steep-uphill" },
  gentle: { seed: 180, band: "gentle" },
};

/** Construct the real seeded world and select the requested graded parcel deterministically. */
export function pickSlopeFixture(kind: SlopeFixtureKind): SlopeFixture {
  const seed = kind === "flat" ? 180 : FIXTURE[kind].seed;
  const runtime = new ColonyRuntime(seed, { surveyOnly: true });
  const terrain = runtime.sim.state.terrain;
  const groundAt: GroundAt = (gx, gy) => terrain.worldYAt(gx, gy);
  const lots = runtime.lots();
  const candidates = lots.map((parcel) => ({ parcel, grading: gradePlot(parcel, groundAt) }));
  const desired = kind === "flat" ? null : FIXTURE[kind].band;
  const eligible = candidates.filter((candidate) => candidate.grading.band === desired && candidate.grading.ok);
  const minFenceGround = (parcel: Parcel) => Math.min(...[...parcel.fence, parcel.gate].map((cell) => groundAt(cell.x, cell.y)));
  const aboveGroundThreshold = eligible.filter(({ parcel }) => minFenceGround(parcel) > 1.0);
  const matching = kind === "gentle" ? aboveGroundThreshold : (aboveGroundThreshold.length > 0 ? aboveGroundThreshold : eligible);
  const drivewayGrade = (candidate: (typeof candidates)[number]) => {
    const path = candidate.parcel.driveway;
    if (path.length < 2) return 0;
    const start = groundAt(path[0]!.x, path[0]!.y);
    const end = groundAt(path[path.length - 1]!.x, path[path.length - 1]!.y);
    return Math.abs(end - start) / ((path.length - 1) * 4);
  };
  if (desired && matching.length === 0) throw new Error(`No valid ${desired} parcel found above the ground threshold for fixture seed ${seed}`);
  const knownDownhill = kind === "downhill" ? matching.find(({ parcel }) => /(?:wood|hill|vale)5_lot_3$/.test(parcel.id)) : undefined;
  const parcel = (kind === "downhill"
    ? knownDownhill ?? matching.sort((a, b) => drivewayGrade(b) - drivewayGrade(a))[0]
    : matching[0])?.parcel ?? candidates[0]?.parcel;
  if (!parcel) throw new Error(`No parcel found for slope fixture ${kind}`);
  const grading = gradePlot(parcel, groundAt);
  const toMetres = (cell: Cell) => Math.hypot(cell.x - parcel.gate.x, cell.y - parcel.gate.y) * 4;
  const neighbours = lots.filter((lot) => lot.id === parcel.id || toMetres(lot.gate) <= 110);
  let fixture: SlopeFixture = { kind, seed, parcel, neighbours, grading, groundAt, carriage: [], verge: [], mapSize: terrain.size, runtime };
  // Keep rendered context inside a 320 m terrain window; street cells use the same radius.
  for (let radius = 30; radius >= 8; radius -= 2) {
    fixture.neighbours = lots.filter((lot) => lot.id === parcel.id || toMetres(lot.gate) <= radius * CELL_SIZE);
    const carriage = runtime.carriageCellsNear(parcel.gate.x, parcel.gate.y, radius);
    const keys = new Set(carriage.map((cell) => `${cell.x},${cell.y}`));
    const components: Cell[][] = [];
    const seen = new Set<string>();
    for (const cell of carriage) {
      const start = `${cell.x},${cell.y}`;
      if (seen.has(start)) continue;
      const component: Cell[] = [], queue = [cell]; seen.add(start);
      while (queue.length) {
        const current = queue.pop()!; component.push(current);
        for (const [dx, dy] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
          const key = `${current.x+dx},${current.y+dy}`;
          if (keys.has(key) && !seen.has(key)) { seen.add(key); queue.push({x:current.x+dx,y:current.y+dy}); }
        }
      }
      components.push(component);
    }
    components.sort((a,b) => Math.min(...a.map(c=>Math.hypot(c.x-parcel.gate.x,c.y-parcel.gate.y))) - Math.min(...b.map(c=>Math.hypot(c.x-parcel.gate.x,c.y-parcel.gate.y))));
    fixture.carriage = components[0] ?? [];
    const componentKeys = new Set(fixture.carriage.map(c=>`${c.x},${c.y}`));
    fixture.verge = runtime.vergeCellsNear(parcel.gate.x, parcel.gate.y, radius)
      .filter(v => fixture.carriage.some(c => Math.max(Math.abs(v.x-c.x),Math.abs(v.y-c.y)) <= 2) && !componentKeys.has(`${v.x},${v.y}`));
    const window = computeHeightfieldWindow(fixture);
    if ((window.maxGx - window.minGx) * CELL_SIZE <= 320 && (window.maxGy - window.minGy) * CELL_SIZE <= 320) break;
  }
  return fixture;
}
