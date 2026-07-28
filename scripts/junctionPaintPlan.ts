// ROAD.JUNCTION.PAINT.1 — plan-view evidence renderer.
// Run: npx vite-node scripts/junctionPaintPlan.ts
//
// The in-world overhead screenshot (e2e/junctionPaintOverhead.spec.ts) can only show the
// BOOT seed, because the app builds its world from COLONY.render.seed. This renders the
// same overhead view of the junction paint for ANY seed, straight from the shipped
// geometry, and does it twice per junction: once over the raw `zone.arms` (the old
// per-way-arm emission — the stripe fan) and once over `paintApproaches` (the fix).
// Writes side-by-side SVGs to test-results/ (gitignored — PR evidence, not a repo asset).
import { mkdirSync, writeFileSync } from "node:fs";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  findJunctionZones,
  type JunctionArm,
  type JunctionZone,
} from "../src/colony/render/roadJunctions";
import {
  attachCapPolys,
  paintApproaches,
  zebraBand,
  ZEBRA,
} from "../src/colony/render/junctionCap";

const SEEDS = [4242, 7];
const PAD = 3; // cells of margin around the junction

/** The five stripe quads of one approach's band — same math capCrosswalks draws. */
function stripes(
  zone: JunctionZone,
  a: JunctionArm,
): Array<Array<[number, number]>> {
  const { K, depth, stripeHalf: sw } = ZEBRA;
  const { bx, by, span, px, py } = zebraBand(zone, a);
  const out: Array<Array<[number, number]>> = [];
  for (let k = 0; k < K; k++) {
    const ca = (k / (K - 1) - 0.5) * 2 * span;
    const sx = bx + px * ca,
      sy = by + py * ca;
    out.push([
      [sx + a.ux * (depth / 2) + px * sw, sy + a.uy * (depth / 2) + py * sw],
      [sx + a.ux * (depth / 2) - px * sw, sy + a.uy * (depth / 2) - py * sw],
      [sx - a.ux * (depth / 2) - px * sw, sy - a.uy * (depth / 2) - py * sw],
      [sx - a.ux * (depth / 2) + px * sw, sy - a.uy * (depth / 2) + py * sw],
    ]);
  }
  return out;
}

function svg(zone: JunctionZone, arms: JunctionArm[], title: string): string {
  const quads = arms.flatMap((a) => stripes(zone, a));
  const pts = [
    ...quads.flat(),
    ...zone.poly.map((p) => [p.x, p.y] as [number, number]),
  ];
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs) - PAD,
    maxX = Math.max(...xs) + PAD;
  const minY = Math.min(...ys) - PAD,
    maxY = Math.max(...ys) + PAD;
  const S = 26; // px per cell
  const W = (maxX - minX) * S,
    H = (maxY - minY) * S;
  const X = (x: number) => ((x - minX) * S).toFixed(2);
  const Y = (y: number) => ((y - minY) * S).toFixed(2);
  const cap = zone.poly.length
    ? `<polygon points="${zone.poly.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}" fill="#595f6a" stroke="#2b2f36" stroke-width="1"/>`
    : "";
  const bands = quads
    .map(
      (q) =>
        `<polygon points="${q.map((c) => `${X(c[0])},${Y(c[1])}`).join(" ")}" fill="#ffffff" fill-opacity="0.55" stroke="#ff2d2d" stroke-width="0.7"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${(H + 26).toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${(H + 26).toFixed(0)}">
<rect width="100%" height="100%" fill="#20242b"/>
<text x="6" y="17" font-family="monospace" font-size="13" fill="#e8ecf2">${title}</text>
<g transform="translate(0,26)">${cap}${bands}</g></svg>`;
}

mkdirSync("test-results", { recursive: true });
for (const seed of SEEDS) {
  const rt = new ColonyRuntime(seed);
  const ways = (rt.sim.state.roadWays ?? []).filter(
    (w) => w.source !== "depot-spur",
  );
  const zones = attachCapPolys(findJunctionZones(ways));
  // the worst offender: the junction with the most duplicate arms
  let zi = 0,
    worst = -1;
  zones.forEach((z, i) => {
    const d = z.arms.length - paintApproaches(z).length;
    if (d > worst) {
      worst = d;
      zi = i;
    }
  });
  const zone = zones[zi]!;
  const before = zone.arms;
  const after = paintApproaches(zone);
  const tag = `seed ${seed} zone ${zi} (${zone.kind})`;
  writeFileSync(
    `test-results/junction-paint-plan-seed${seed}-BEFORE.svg`,
    svg(zone, before, `${tag} BEFORE: ${before.length} bands (per way-arm)`),
  );
  writeFileSync(
    `test-results/junction-paint-plan-seed${seed}-AFTER.svg`,
    svg(zone, after, `${tag} AFTER: ${after.length} bands (per approach)`),
  );
  console.log(
    `${tag}: ${before.length} raw arms -> ${after.length} approaches; wrote BEFORE/AFTER svg`,
  );
}
