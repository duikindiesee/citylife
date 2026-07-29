// BUS.ROUTE.TURN.1 — plan-view plate renderer for the DRIVEN BUS ROUTE.
// Run: npx vite-node scripts/busRoutePlates.ts [--seeds 4242,31337]
//
// Companion to scripts/junctionPaintPlan.ts. The in-world screenshot can only show the BOOT seed;
// this renders the route's overhead geometry for ANY seed, straight from the shipped smoother, and
// does it twice per seed: once with the corner cut UNCAPPED (what shipped before BUS.ROUTE.TURN.1)
// and once capped (what ships now). Writes SVGs to test-results/ — gitignored, PR evidence rather
// than a repo asset.
//
// The measure is the honest one: distance from each sampled point of the driven loop to the nearest
// DRIVABLE cell (state.roadKind), which is the set the route's own BFS walked. A road way is four
// cells of carriageway, so two cells is the outer kerb.
//
// Pure rendering lives in src/colony/render/routePlates.ts (unit-tested); the world boot and the
// measure live in scripts/routeMeasure.ts, shared with scripts/busRouteFilm.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import {
  plateCircuit,
  plateDrive,
  plateProfile,
  plateScaling,
  plateWorstBend,
  worstOf,
} from "../src/colony/render/routePlates";
import { arcBeyond, bendCut, measureRoute } from "./routeMeasure";

const OUT = "test-results";
const ARM_LENGTHS = [8, 20, 40];

function parseSeeds(argv: string[]): number[] {
  const i = argv.indexOf("--seeds");
  if (i < 0 || !argv[i + 1]) return [4242, 31337];
  return argv[i + 1]!.split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

mkdirSync(OUT, { recursive: true });
const seeds = parseSeeds(process.argv);
const summary: string[] = [];

for (const seed of seeds) {
  const m = measureRoute(seed);
  if (!m) {
    console.log(`seed ${seed}: no bus route (no depot sited) — skipped`);
    continue;
  }
  const w = worstOf(m.before, m.beforeDist);
  const after = worstOf(m.after, m.afterDist);
  const write = (name: string, svg: string) => {
    writeFileSync(`${OUT}/route-${name}-seed${seed}.svg`, svg);
  };
  write("circuit", plateCircuit(m));
  write("worst-bend", plateWorstBend(m));
  write("profile", plateProfile(m));
  write("drive", plateDrive(m));
  const arc5 = arcBeyond(m.beforeDist, 5);
  summary.push(
    `seed ${seed}: worst ${w.d.toFixed(2)} cells (${(w.d * 4).toFixed(0)} m) at ` +
      `(${w.x.toFixed(0)}, ${w.y.toFixed(0)}), ${arc5} cells of arc beyond 5 -> ` +
      `capped worst ${after.d.toFixed(2)}; wrote 4 plates`,
  );
}

writeFileSync(`${OUT}/route-scaling.svg`, plateScaling(ARM_LENGTHS, bendCut));
summary.push(`scaling plate: arms ${ARM_LENGTHS.join(" / ")} cells`);

for (const line of summary) console.log(line);
