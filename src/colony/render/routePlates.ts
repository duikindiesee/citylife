// BUS.ROUTE.TURN.1 — plan-view plate renderer for the DRIVEN BUS ROUTE, in the same spirit as
// scripts/junctionPaintPlan.ts: overhead SVG evidence straight from the shipped geometry, for any
// seed, so a route-geometry claim can be seen instead of taken on trust.
//
// This module is the PURE half — projection, path emission, chart layout, SVG assembly. It boots
// nothing and touches no filesystem, so it is unit-testable and the CLI (scripts/busRoutePlates.ts)
// stays a thin shell around it. No Date.now / no Math.random: same seed in, same bytes out.
//
// The plates were first cut by hand while measuring the corner-cut defect (the smoothed route ran
// 8.86 cells off the road on seed 4242 and 14.04 on 31337). They earn their keep afterwards too:
// any change to simplifyClosed / smoothClosed / the cap is a change to these pictures.

export interface Pt {
  x: number;
  y: number;
}

/** Telemetry palette. Fixed rather than themed — a plate is a screen, and it is read next to the
 *  numbers it came from. The lane yellow is the game's own centre-line paint (roadRibbon dashMat). */
export const PLATE_INK = {
  ground: "#0d1117",
  cell: "#39424f",
  before: "#ff5c5c",
  after: "#4ade80",
  paint: "#f2cf52",
  text: "#e6ebf2",
  mute: "#8a93a3",
} as const;

const MONO = "ui-monospace,monospace";

/** Grid -> pixel projector fitted to `pts`, with `pad` cells of margin and a long edge of `px`. */
export interface Fit {
  X: (x: number) => string;
  Y: (y: number) => string;
  /** pixels per cell */
  scale: number;
  width: number;
  height: number;
  contains: (p: Pt) => boolean;
}

export function fit(
  pts: readonly Pt[],
  pad: number,
  px: number,
  /** Target width:height. 1 keeps the natural square window; 16/9 widens it for film delivery,
   *  where a square plate would leave a third of the frame empty. Only ever GROWS the window, so
   *  nothing that was in shot drops out of it. */
  aspect = 1,
): Fit {
  if (pts.length === 0) throw new Error("fit() needs at least one point");
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  x0 -= pad;
  x1 += pad;
  y0 -= pad;
  y1 += pad;
  let w = x1 - x0 || 1;
  let h = y1 - y0 || 1;
  if (w / h < aspect) {
    const grow = (h * aspect - w) / 2;
    x0 -= grow;
    x1 += grow;
    w = h * aspect;
  } else if (w / h > aspect) {
    const grow = (w / aspect - h) / 2;
    y0 -= grow;
    y1 += grow;
    h = w / aspect;
  }
  const scale = px / w;
  return {
    X: (x) => ((x - x0) * scale).toFixed(1),
    Y: (y) => ((y - y0) * scale).toFixed(1),
    scale,
    width: Math.round(w * scale),
    height: Math.round(h * scale),
    contains: (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1,
  };
}

/** Polyline, BROKEN at the window edge so a clipped path leaves a gap instead of a false chord
 *  straight across the plate. */
export function polyline(
  pts: readonly Pt[],
  f: Fit,
  stroke: string,
  width: number,
): string {
  const runs: string[][] = [];
  let run: string[] = [];
  for (const p of pts) {
    if (f.contains(p)) run.push(`${f.X(p.x)},${f.Y(p.y)}`);
    else {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs
    .map(
      (r) =>
        `<polyline points="${r.join(" ")}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
}

/** Every cell as ONE path rather than thousands of <rect>s — same picture, a fraction of the bytes
 *  (154 KB against 332 KB for a full seed-4242 network). */
export function cellField(cells: readonly Pt[], f: Fit, fill: string): string {
  const s = Math.max(1, f.scale).toFixed(1);
  const d = cells
    .filter((c) => f.contains(c))
    .map((c) => `M${f.X(c.x - 0.5)} ${f.Y(c.y - 0.5)}h${s}v${s}h-${s}z`)
    .join("");
  return d ? `<path d="${d}" fill="${fill}"/>` : "";
}

/** Closed path, for <animateMotion><mpath>. */
export function closedPath(pts: readonly Pt[], f: Fit): string {
  if (pts.length < 2) return "";
  return (
    pts.map((p, i) => `${i ? "L" : "M"}${f.X(p.x)},${f.Y(p.y)}`).join("") + "Z"
  );
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function caption(
  x: number,
  y: number,
  lines: Array<{ text: string; size?: number; fill?: string }>,
): string {
  const rows = lines
    .map((l, i) => {
      const size = l.size ?? 22;
      return `<text x="${x}" y="${y + i * (size + 12)}" font-size="${size}" fill="${l.fill ?? PLATE_INK.text}">${escapeText(l.text)}</text>`;
    })
    .join("");
  return `<g font-family="${MONO}">${rows}</g>`;
}

export function svgDoc(width: number, height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="${PLATE_INK.ground}"/>${body}</svg>`
  );
}

// ── Plate builders ─────────────────────────────────────────────────────────────────────────────

export interface RouteMeasure {
  seed: number;
  cells: Pt[];
  /** One point per cell of arc length, and its distance to the nearest drivable cell. */
  before: Pt[];
  after: Pt[];
  beforeDist: number[];
  afterDist: number[];
}

/** Film delivery widens the frame and drops the in-plate caption, because the cut carries its own
 *  typography and two titles on one frame read as a mistake. */
export interface PlateOpts {
  aspect?: number;
  captions?: boolean;
}

export function worstOf(
  pts: readonly Pt[],
  dist: readonly number[],
): { d: number; x: number; y: number } {
  let out = { d: 0, x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0 };
  dist.forEach((d, i) => {
    if (d > out.d) out = { d, x: pts[i]!.x, y: pts[i]!.y };
  });
  return out;
}

/** The whole circuit over the whole network — the establishing plate. */
export function plateCircuit(m: RouteMeasure, o: PlateOpts = {}): string {
  const f = fit([...m.cells, ...m.before], 12, 1400, o.aspect ?? 1);
  const body =
    cellField(m.cells, f, PLATE_INK.cell) +
    polyline(m.before, f, PLATE_INK.before, 3) +
    polyline(m.after, f, PLATE_INK.after, 3) +
    (o.captions === false
      ? ""
      : caption(28, 46, [
          { text: `SEED ${m.seed} — the whole circuit`, size: 26 },
          {
            text: "grey: drivable road cells · red: uncapped corner cut · green: capped",
            size: 19,
            fill: PLATE_INK.mute,
          },
        ]));
  return svgDoc(f.width, f.height, body);
}

/** Close-up on the worst excursion, with the offending point ringed. */
export function plateWorstBend(
  m: RouteMeasure,
  halfWindowCells = 30,
  o: PlateOpts = {},
): string {
  const w = worstOf(m.before, m.beforeDist);
  const f = fit(
    [
      { x: w.x - halfWindowCells, y: w.y - halfWindowCells },
      { x: w.x + halfWindowCells, y: w.y + halfWindowCells },
    ],
    0,
    1100,
    o.aspect ?? 1,
  );
  const body =
    cellField(m.cells, f, PLATE_INK.cell) +
    polyline(m.before, f, PLATE_INK.before, 5) +
    polyline(m.after, f, PLATE_INK.after, 5) +
    `<circle cx="${f.X(w.x)}" cy="${f.Y(w.y)}" r="10" fill="none" stroke="${PLATE_INK.before}" stroke-width="3"/>` +
    (o.captions === false
      ? ""
      : caption(24, 42, [
          { text: `SEED ${m.seed} — worst excursion`, size: 24 },
          {
            text: `${w.d.toFixed(2)} cells (${(w.d * 4).toFixed(0)} m) off the nearest road`,
            size: 20,
            fill: PLATE_INK.before,
          },
        ]));
  return svgDoc(f.width, f.height, body);
}

/** Distance from the road across one full lap, before against after. `kerbCells` draws the
 *  carriageway half-width — anything above it is off the paved surface. */
export function plateProfile(
  m: RouteMeasure,
  kerbCells = 2,
  o: PlateOpts = {},
): string {
  const W = 1400,
    H = o.aspect ? Math.round(W / o.aspect) : 460,
    L = 78,
    R = 24,
    T = 60,
    B = 56;
  const n = m.beforeDist.length;
  if (n < 2) throw new Error("plateProfile needs a sampled lap");
  const top = Math.max(...m.beforeDist, kerbCells * 2.5) * 1.08;
  const px = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const py = (d: number) => H - B - (d / top) * (H - T - B);
  const trace = (ds: readonly number[], stroke: string) =>
    `<polyline points="${ds.map((d, i) => `${px(i).toFixed(1)},${py(d).toFixed(1)}`).join(" ")}" fill="none" stroke="${stroke}" stroke-width="2.5"/>`;
  const kerbY = py(kerbCells).toFixed(1);
  const body =
    `<line x1="${L}" y1="${kerbY}" x2="${W - R}" y2="${kerbY}" stroke="${PLATE_INK.paint}" stroke-width="2" stroke-dasharray="8 6"/>` +
    `<text x="${W - R}" y="${(py(kerbCells) - 10).toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="17" fill="${PLATE_INK.paint}">kerb — ${kerbCells} cells</text>` +
    trace(m.beforeDist, PLATE_INK.before) +
    trace(m.afterDist, PLATE_INK.after) +
    `<line x1="${L}" y1="${T - 14}" x2="${L}" y2="${H - B}" stroke="${PLATE_INK.mute}" stroke-width="1.5"/>` +
    `<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="${PLATE_INK.mute}" stroke-width="1.5"/>` +
    `<g font-family="${MONO}" font-size="17" fill="${PLATE_INK.mute}">` +
    [0, 5, 10]
      .filter((v) => v <= top)
      .map(
        (v) =>
          `<text x="${L - 12}" y="${(py(v) + 5).toFixed(1)}" text-anchor="end">${v}</text>`,
      )
      .join("") +
    `<text x="${L}" y="${H - 18}">start of lap</text>` +
    `<text x="${W - R}" y="${H - 18}" text-anchor="end">one full lap</text></g>` +
    (o.captions === false
      ? ""
      : caption(L, 34, [
          {
            text: `SEED ${m.seed} — distance from any road, all the way round`,
            size: 24,
          },
        ]));
  return svgDoc(W, H, body);
}

/** Where along the lap the route is off the paved surface — as a fraction of arc, so a caller can
 *  point a camera (or an animation clock) at the event instead of guessing. */
export function excursionSpan(
  m: RouteMeasure,
  beyondCells = 2,
): { from: number; to: number; points: Pt[] } {
  const n = m.beforeDist.length;
  if (n === 0) return { from: 0, to: 1, points: [] };
  // The CONTIGUOUS run containing the worst point, not the first-to-last of every excursion on the
  // lap: a route with two bad bends at opposite ends would otherwise "span" the whole circuit and
  // frame nothing. Walk out from the worst index while the route is still off the paved surface.
  let peak = 0;
  for (let i = 1; i < n; i++)
    if (m.beforeDist[i]! > m.beforeDist[peak]!) peak = i;
  if (m.beforeDist[peak]! <= beyondCells) return { from: 0, to: 1, points: [] };
  let first = peak,
    last = peak;
  while (first > 0 && m.beforeDist[first - 1]! > beyondCells) first--;
  while (last < n - 1 && m.beforeDist[last + 1]! > beyondCells) last++;
  return {
    from: first / n,
    to: last / n,
    points: m.before.slice(first, last + 1),
  };
}

/** Two buses on the two routes at one speed, animated. The clip shot.
 *
 *  Framed on the EXCURSION rather than a fixed box around the worst point: a box wide enough to
 *  hold the whole bend is mostly empty veld once it has been widened to 16:9, and the thing worth
 *  watching ends up small and off to one side. */
export function plateDrive(
  m: RouteMeasure,
  padCells = 14,
  lapSeconds = 26,
  o: PlateOpts = {},
): string {
  const w = worstOf(m.before, m.beforeDist);
  const span = excursionSpan(m);
  const frame = span.points.length
    ? span.points
    : [
        { x: w.x - padCells, y: w.y - padCells },
        { x: w.x + padCells, y: w.y + padCells },
      ];
  const f = fit(frame, padCells, 1100, o.aspect ?? 1);
  const coach = (id: string, colour: string) =>
    `<g><rect x="-9" y="-5" width="18" height="10" rx="2.5" fill="${colour}"/>` +
    `<animateMotion dur="${lapSeconds}s" repeatCount="indefinite" rotate="auto">` +
    `<mpath href="#${id}"/></animateMotion></g>`;
  const body =
    cellField(m.cells, f, PLATE_INK.cell) +
    `<path id="routeBefore" d="${closedPath(m.before, f)}" fill="none" stroke="${PLATE_INK.before}" stroke-width="3" opacity="0.55"/>` +
    `<path id="routeAfter" d="${closedPath(m.after, f)}" fill="none" stroke="${PLATE_INK.after}" stroke-width="3" opacity="0.55"/>` +
    coach("routeBefore", PLATE_INK.before) +
    coach("routeAfter", PLATE_INK.after) +
    (o.captions === false
      ? ""
      : caption(24, 40, [
          { text: "Same lap, same speed", size: 23 },
          {
            text: "the red coach leaves the tarmac at the bend",
            size: 18,
            fill: PLATE_INK.mute,
          },
        ]));
  return svgDoc(f.width, f.height, body);
}

/** WHY it scales: one corner, three arm lengths, both smoothers. Needs no world — it is the
 *  defect stated as geometry. `cut` is injected so the plate cannot drift from the real smoother. */
export function plateScaling(
  armLengths: readonly number[],
  cut: (bend: Pt[], maxCut: number) => Pt[],
  cappedCells = 1,
): string {
  const W = 1500,
    H = 560;
  const perCell = 380 / Math.max(...armLengths);
  let body = "";
  armLengths.forEach((arm, i) => {
    const ox = 60 + (i * (W - 140)) / armLengths.length,
      oy = 470;
    const bend: Pt[] = [
      { x: 0, y: -arm },
      { x: 0, y: 0 },
      { x: arm, y: 0 },
    ];
    const P = (p: Pt) =>
      `${(ox + p.x * perCell).toFixed(1)},${(oy + p.y * perCell).toFixed(1)}`;
    // Deviation from the bend's own two arms, which lie on the axes through the corner.
    const deviation = (pts: readonly Pt[]) =>
      pts.reduce(
        (m, p) => Math.max(m, Math.min(Math.abs(p.x), Math.abs(p.y))),
        0,
      );
    const uncapped = cut(bend, Infinity);
    const capped = cut(bend, cappedCells);
    body +=
      `<polyline points="${bend.map(P).join(" ")}" fill="none" stroke="${PLATE_INK.mute}" stroke-width="2" stroke-dasharray="6 5"/>` +
      polylineRaw(uncapped.map(P), PLATE_INK.before) +
      polylineRaw(capped.map(P), PLATE_INK.after) +
      caption(ox - 10, oy + 52, [
        { text: `${arm}-cell arms`, size: 19 },
        {
          text: `quarter-cut: ${deviation(uncapped).toFixed(1)} cells off`,
          size: 17,
          fill: PLATE_INK.before,
        },
        {
          text: `capped: ${deviation(capped).toFixed(1)} cells off`,
          size: 17,
          fill: PLATE_INK.after,
        },
      ]);
  });
  body += caption(60, 46, [
    {
      text: "The SAME corner. Only the length of the arms changes.",
      size: 25,
    },
    {
      text: "a quarter of each segment scales with the segment — a fixed cut does not",
      size: 19,
      fill: PLATE_INK.mute,
    },
  ]);
  return svgDoc(W, H, body);
}

function polylineRaw(points: readonly string[], stroke: string): string {
  return `<polyline points="${points.join(" ")}" fill="none" stroke="${stroke}" stroke-width="4.5" stroke-linecap="round"/>`;
}
