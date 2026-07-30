// WORLD.SURVEY.1 — qualify seeds in bulk.
//
//   npx vite-node scripts/seedQualify.ts --from 1 --to 200
//   npx vite-node scripts/seedQualify.ts --seeds 4242,31337 --verbose
//   npx vite-node scripts/seedQualify.ts --from 1 --to 4000 --jobs 8 --json test-results/seeds.json
//
// Boots each world in SURVEY mode (no residents, no social, no bots — see ColonyRuntime surveyOnly)
// and scores it with the pure verdict logic in src/colony/worldQualify.ts.
//
// ON COST, measured rather than assumed: a survey boot is ~0.6-0.9 s and that is NOT the residents
// it skips — survey saves about 2.5%. The time is terrain (~0.2 s), then site-finding,
// neighbourhoods and road routing, every one of which is required before any geometric question
// about a seed can be asked. There is no cheap path to a seed's roads; there is only a parallel
// one, which is what --jobs does (disjoint shards, one child process each).
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { ColonyRuntime } from "../src/colony/runtime";
import { densify, roadRibbonRenderPath } from "../src/colony/render/roadRibbon";
import { STATION_STEP_CELLS } from "../src/colony/render/roadClearance";
import { busLoopPath, samplePath } from "../src/colony/transit/path";
import {
  QUALIFY_HEADER,
  qualifyRow,
  qualifyWorld,
  type Pt,
  type Qualification,
} from "../src/colony/worldQualify";

const execFileAsync = promisify(execFile);

// JSON cannot carry Infinity, and "no drivable cell within the scan radius" is a real measurement
// that must survive a shard round-trip rather than silently becoming null.
const INF = "__Infinity__";
const jsonReplacer = (_k: string, v: unknown) =>
  typeof v === "number" && !Number.isFinite(v) ? INF : v;
const jsonReviver = (_k: string, v: unknown) => (v === INF ? Infinity : v);

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function seedList(): number[] {
  const explicit = arg("seeds");
  if (explicit)
    return explicit
      .split(",")
      .map((s) => Number(s.trim()))
      .filter(Number.isFinite);
  const from = Number(arg("from") ?? 1);
  const to = Number(arg("to") ?? 24);
  const out: number[] = [];
  for (let s = from; s <= to; s++) out.push(s);
  return out;
}

/** Survey one seed. The boot is the whole cost; everything after it is arithmetic. */
export function qualifySeed(seed: number): Qualification {
  const rt = new ColonyRuntime(seed, { surveyOnly: true });
  const st = rt.sim.state;
  const ways = st.roadWays ?? [];

  // The ROUTED centre-line, densified: sampling only a way's vertices hides every gap BETWEEN them,
  // which is exactly where the land filter's refusals live.
  const waySamples: Pt[][] = ways
    .filter((w) => w.path.length >= 2)
    .map((w) => densify(w.path, STATION_STEP_CELLS));
  const ribbonSamples: Pt[][] = ways
    .filter((w) => w.path.length >= 2)
    .map((w) => roadRibbonRenderPath(w, st.terrain));

  let routeSamples: Pt[] | null = null;
  let loopCells = 0;
  if (rt.busRoute) {
    const loop = busLoopPath(rt.busRoute.loop);
    loopCells = loop.total;
    routeSamples = [];
    for (let s = 0; s < loop.total; s += 1) {
      const p = samplePath(loop, s);
      routeSamples.push({ x: p.x, y: p.y });
    }
  }

  return qualifyWorld({
    seed,
    gridSize: st.terrain.size,
    roads: st.roads,
    routeSamples,
    waySamples,
    ribbonSamples,
    hasDepot: rt.busDepot !== null,
    loopCells,
    stopCount: rt.busRoute?.stops.length ?? 0,
  });
}

function summarise(results: Qualification[]): void {
  const sound = results.filter((r) => r.sound);
  console.log(
    `\n${sound.length}/${results.length} sound (${((sound.length / Math.max(1, results.length)) * 100).toFixed(0)}%)`,
  );
  const tally = new Map<string, number>();
  for (const r of results)
    for (const c of r.checks)
      if (!c.pass) tally.set(c.id, (tally.get(c.id) ?? 0) + 1);
  for (const [id, n] of [...tally].sort((a, b) => b[1] - a[1])) {
    const known =
      results[0]?.checks.find((c) => c.id === id)?.severity === "known";
    console.log(
      `  ${id.padEnd(18)} failed ${String(n).padStart(4)}/${results.length}${known ? "   (known defect, not blocking)" : ""}`,
    );
  }
  if (sound.length) {
    // Tightest radius = hardest to drive, so this sorts ASCENDING. Seeds whose loop never really
    // turns report Infinity and must not win "hardest" by sorting to the front of a descending list.
    const hardest = [...sound].sort(
      (a, b) =>
        a.metrics.tightestTurnRadiusCells - b.metrics.tightestTurnRadiusCells,
    )[0]!;
    const longest = [...sound].sort(
      (a, b) => b.metrics.loopCells - a.metrics.loopCells,
    )[0]!;
    console.log(
      `  tightest turn among sound seeds: ${hardest.seed} ` +
        `(radius ${hardest.metrics.tightestTurnRadiusCells.toFixed(1)} cells)`,
    );
    console.log(
      `  longest lap among sound seeds:  ${longest.seed} ` +
        `(${Math.round(longest.metrics.loopCells)} cells)`,
    );
  }
}

async function runSharded(
  seeds: number[],
  jobs: number,
): Promise<Qualification[]> {
  mkdirSync("test-results", { recursive: true });
  const shards = Array.from({ length: jobs }, (_, i) =>
    seeds.filter((_, idx) => idx % jobs === i),
  ).filter((s) => s.length);
  console.log(`sharding ${seeds.length} seeds across ${shards.length} job(s)`);
  const parts = await Promise.all(
    shards.map(async (shard, i) => {
      const out = `test-results/seed-shard-${i}.json`;
      // shell:true because vite-node is resolved through npx (it is not a local dependency), and
      // Node refuses to spawn a Windows .cmd shim without one. Every interpolated argument here is
      // digits, commas or a fixed literal — asserted, not assumed, because a shell is involved.
      const list = shard.join(",");
      if (!/^[0-9,]+$/.test(list))
        throw new Error(`refusing to shell a non-numeric seed list: ${list}`);
      await execFileAsync(
        "npx",
        [
          "vite-node",
          "scripts/seedQualify.ts",
          "--seeds",
          list,
          "--json",
          out,
          "--quiet",
        ],
        { maxBuffer: 1 << 28, shell: true },
      );
      const parsed = JSON.parse(
        readFileSync(out, "utf8"),
        jsonReviver,
      ) as Qualification[];
      unlinkSync(out);
      return parsed;
    }),
  );
  return parts.flat().sort((a, b) => a.seed - b.seed);
}

async function main(): Promise<void> {
  const seeds = seedList();
  const jobs = Number(arg("jobs") ?? 1);
  const quiet = flag("quiet");
  const started = Date.now();

  let results: Qualification[];
  if (jobs > 1) {
    results = await runSharded(seeds, jobs);
  } else {
    results = [];
    if (!quiet) console.log(QUALIFY_HEADER);
    for (const seed of seeds) {
      const q = qualifySeed(seed);
      results.push(q);
      if (!quiet) console.log(qualifyRow(q));
    }
  }

  if (jobs > 1 && !quiet) {
    console.log(QUALIFY_HEADER);
    for (const q of results) console.log(qualifyRow(q));
  }

  if (flag("verbose"))
    for (const q of results)
      for (const c of q.checks)
        console.log(
          `  seed ${q.seed} ${c.pass ? "ok  " : "FAIL"} ${c.id.padEnd(18)} ` +
            `${c.value === null ? "" : `${c.value.toFixed(2)} / ${c.limit}`}  ${c.detail}`,
        );

  const json = arg("json");
  if (json) {
    mkdirSync("test-results", { recursive: true });
    writeFileSync(json, JSON.stringify(results, jsonReplacer, 2));
  }
  if (!quiet) {
    summarise(results);
    const ms = Date.now() - started;
    console.log(
      `\n${seeds.length} seeds in ${(ms / 1000).toFixed(1)}s  ` +
        `(${Math.round(ms / seeds.length)} ms/seed, ${jobs} job(s))`,
    );
  }
}

await main();
