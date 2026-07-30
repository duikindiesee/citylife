// BUS.ROUTE.TURN.1 — assembles the route measurements into a narrated MP4 (a rough cut / animatic).
// Run: npx vite-node scripts/busRouteFilm.ts
//
// Deliberately an ANIMATIC, not a trailer: every frame is the measured geometry, and the voice is
// the local Windows SAPI synth so the cut can be timed and reviewed before anyone books a booth.
// Re-record the VO over the same timings and nothing else has to move.
//
// It renders its OWN plates rather than reading the ones busRoutePlates.ts writes, because film
// wants a different frame: 16:9 (a square plate leaves a third of the screen empty) and no in-plate
// caption (the cut carries its own typography, and two titles on one frame read as a mistake).
// Same measure either way — scripts/routeMeasure.ts.
//
// Pipeline, all local, no network:
//   1. SAPI (via PowerShell) speaks each line to a WAV; ffprobe measures it. The AUDIO sets each
//      scene's length — deciding picture first always produces a cut that fights the narration.
//   2. Playwright rasterises the plates. Stills get ffmpeg's zoompan for the move; the animated
//      plate is sampled through svg.setCurrentTime(), so the motion in the film IS the motion in
//      the plate rather than a re-creation of it.
//   3. ffmpeg builds a clip per scene, concatenates, and lays the narration under it.
//
// Requires: ffmpeg + ffprobe on PATH, Playwright chromium, Windows (SAPI voices).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  plateCircuit,
  plateDrive,
  plateProfile,
  plateScaling,
  plateWorstBend,
  excursionSpan,
  type RouteMeasure,
} from "../src/colony/render/routePlates";
import { bendCut, measureRoute } from "./routeMeasure";

const WORK = "test-results/film";
const OUT = "test-results/bus-route-turn-1.mp4";
const W = 1920;
const H = 1080;
const FPS = 30;
const VOICE = "Microsoft Zira Desktop"; // clearest of the shipped voices for technical copy
const RATE = -1; // SAPI -10..10; a touch under default so the numbers land
const SEEDS = [4242, 31337];

/** Film framing: widen to 16:9 and let the cut's own typography carry the titles. */
const FILM = { aspect: 16 / 9, captions: false } as const;

type Measures = Record<number, RouteMeasure>;

interface Scene {
  id: string;
  /** Burned-in lower-left slug. */
  title: string;
  vo: string;
  svg: (m: Measures) => string;
  move?: "in" | "out" | "none";
  animated?: boolean;
  /** Which seed's excursion the animation clock should be pointed at. */
  focusSeed?: number;
  /** Seconds of picture held after the line finishes, so a beat can land. */
  hold: number;
  seconds?: number;
}

const SCENES: Scene[] = [
  {
    id: "01-circuit",
    title: "A bus route, seed 4242",
    vo: "This is a bus route through a generated city. The grey is road. The green line is where the bus drives today. The red line is where it drove before, and for months, nobody noticed.",
    svg: (m) => plateCircuit(m[4242]!, FILM),
    move: "in",
    hold: 0.8,
  },
  {
    id: "02-worst",
    title: "56 metres off the road",
    vo: "Here is the worst one. Fifty six metres of open ground, at a bend where the road turns and the bus simply does not.",
    svg: (m) => plateWorstBend(m[31337]!, 26, FILM),
    move: "in",
    hold: 1.0,
  },
  {
    id: "03-scaling",
    title: "Why it scales",
    vo: "The cause is one line of geometry. Corner smoothing cuts a quarter off every straight. On a one cell step that is nothing. On a forty cell straight it throws the line almost four cells wide. Same corner, three arm lengths, and the error grows with the road.",
    svg: () => plateScaling([8, 20, 40], bendCut),
    move: "none",
    hold: 0.9,
  },
  {
    id: "04-drive",
    title: "Same lap, same speed",
    vo: "Two buses now, same lap, same speed. Watch the red one leave the tarmac and take the shortcut across the field.",
    svg: (m) => plateDrive(m[4242]!, 12, 26, FILM),
    animated: true,
    focusSeed: 4242,
    hold: 1.4,
  },
  {
    id: "05-profile",
    title: "One lap, measured",
    vo: "This is one full lap, measured. How far the bus is from any road, all the way round. The yellow line is the kerb. Every red spike is a corner, and everything above yellow is a bus in a field.",
    svg: (m) => plateProfile(m[4242]!, 2, FILM),
    move: "none",
    hold: 1.0,
  },
  {
    id: "06-fix",
    title: "Capped at one cell",
    vo: "The fix caps the cut at one cell, whatever the straight. Long runs stay straight, corners round tightly, and the worst case across every seed tested drops from fourteen cells to one and a half.",
    svg: (m) => plateWorstBend(m[31337]!, 26, FILM),
    move: "out",
    hold: 1.2,
  },
  {
    id: "07-honest",
    title: "The number I got wrong",
    vo: "One last thing. My own pull request listed this seed as unchanged. One point five, before and after. Those were both post fix numbers, mislabelled. Re-measuring is what found the real fourteen. The fix was better than I claimed, and I only know because I stopped trusting my own table.",
    svg: (m) => plateProfile(m[31337]!, 2, FILM),
    move: "in",
    hold: 1.6,
  },
];

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });
}

function ffprobeSeconds(file: string): number {
  return Number(
    sh("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ]).trim(),
  );
}

/** Speak one line to WAV with SAPI. A single-quoted PowerShell here-string keeps the copy literal
 *  so an apostrophe or a dollar sign in the narration cannot become script. */
function speak(text: string, file: string): void {
  const ps = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    `try { $s.SelectVoice('${VOICE}') } catch { };`,
    `$s.Rate = ${RATE};`,
    `$s.SetOutputToWaveFile('${resolve(file).replace(/'/g, "''")}');`,
    `$s.Speak(@'\n${text}\n'@);`,
    "$s.Dispose();",
  ].join(" ");
  sh("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps]);
}

async function rasterise(scenes: Scene[], measures: Measures): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const s of scenes) {
    const svg = s.svg(measures);
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>
        html,body{margin:0;height:100%;background:#0d1117;overflow:hidden}
        #stage{position:absolute;inset:0;display:grid;place-items:center}
        #stage svg{width:100%;height:100%}
        /* the slug is burned into the frame, so a zoompan move would crop it — inset past the
           widest crop we use (6% zoom = 3% a side) */
        #slug{position:absolute;left:118px;bottom:104px;font:600 34px ui-monospace,monospace;
              color:#f2cf52;letter-spacing:.08em;text-transform:uppercase}
      </style><div id="stage">${svg}</div><div id="slug">${s.title}</div>`,
      { waitUntil: "load" },
    );
    if (s.animated) {
      const frames = Math.round(s.seconds! * FPS);
      const lap: number = await page.evaluate(() => {
        const el = document.querySelector("#stage svg") as SVGSVGElement;
        el.pauseAnimations();
        const m = el.querySelector("animateMotion");
        return m ? parseFloat(m.getAttribute("dur") ?? "26") : 26;
      });
      // Point the animation clock AT the excursion rather than sweeping the whole lap: the coaches
      // are only in this window for a fraction of a lap, and a blind sweep spends most of the shot
      // on an empty frame. `excursionSpan` gives the arc fraction where the route is off the road.
      const span = excursionSpan(measures[s.focusSeed ?? SEEDS[0]!]!);
      const from = (span.from - 0.02) * lap;
      const to = (span.to + 0.02) * lap;
      for (let i = 0; i < frames; i++) {
        const t = from + (i / frames) * (to - from);
        await page.evaluate((tt: number) => {
          (
            document.querySelector("#stage svg") as SVGSVGElement
          ).setCurrentTime(tt);
        }, t);
        await page.screenshot({
          path: `${WORK}/${s.id}-${String(i).padStart(5, "0")}.png`,
        });
      }
    } else {
      await page.screenshot({ path: `${WORK}/${s.id}.png` });
    }
  }
  await browser.close();
}

function buildClip(s: Scene): string {
  const clip = `${WORK}/${s.id}.mp4`;
  const dur = s.seconds!.toFixed(3);
  if (s.animated) {
    sh("ffmpeg", [
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      `${WORK}/${s.id}-%05d.png`,
      "-t",
      dur,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(FPS),
      "-vf",
      `scale=${W}:${H}`,
      clip,
    ]);
    return clip;
  }
  // Ken Burns: a slow push in or pull out, so a still is not a slideshow.
  const n = Math.round(s.seconds! * FPS);
  const zoom =
    s.move === "in"
      ? `z='1+0.06*on/${n}'`
      : s.move === "out"
        ? `z='1.06-0.06*on/${n}'`
        : "z=1";
  const vf =
    s.move === "none"
      ? `scale=${W}:${H}`
      : `scale=${W * 2}:-2,zoompan=${zoom}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`;
  sh("ffmpeg", [
    "-y",
    "-loop",
    "1",
    "-i",
    `${WORK}/${s.id}.png`,
    "-t",
    dur,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    clip,
  ]);
  return clip;
}

const listFile = (name: string, files: string[]): string => {
  const path = `${WORK}/${name}`;
  writeFileSync(
    path,
    files.map((f) => `file '${resolve(f).replace(/\\/g, "/")}'`).join("\n"),
  );
  return path;
};

async function main(): Promise<void> {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  console.log("1/5  measuring worlds");
  const measures: Measures = {};
  for (const seed of SEEDS) {
    const m = measureRoute(seed);
    if (!m) throw new Error(`seed ${seed} routes no bus loop — pick another`);
    measures[seed] = m;
    console.log(`     seed ${seed}: ${m.before.length} cells of lap`);
  }

  console.log("2/5  narration");
  for (const s of SCENES) {
    const wav = `${WORK}/${s.id}.wav`;
    speak(s.vo, wav);
    const spoken = ffprobeSeconds(wav);
    s.seconds = spoken + s.hold;
    console.log(
      `     ${s.id}  spoken ${spoken.toFixed(2)}s  scene ${s.seconds.toFixed(2)}s`,
    );
  }

  console.log("3/5  frames");
  await rasterise(SCENES, measures);

  console.log("4/5  clips");
  const clips = SCENES.map(buildClip);

  console.log("5/5  assemble");
  // Pad each line out to its scene length so picture and voice stay locked end to end.
  const padded = SCENES.map((s) => {
    const out = `${WORK}/${s.id}-pad.wav`;
    sh("ffmpeg", [
      "-y",
      "-i",
      `${WORK}/${s.id}.wav`,
      "-af",
      `apad=whole_dur=${s.seconds!.toFixed(3)}`,
      out,
    ]);
    return out;
  });
  sh("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile("voice.txt", padded),
    "-c",
    "copy",
    `${WORK}/voice.wav`,
  ]);
  sh("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile("clips.txt", clips),
    "-c",
    "copy",
    `${WORK}/picture.mp4`,
  ]);
  sh("ffmpeg", [
    "-y",
    "-i",
    `${WORK}/picture.mp4`,
    "-i",
    `${WORK}/voice.wav`,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-shortest",
    OUT,
  ]);

  const total = SCENES.reduce((a, s) => a + s.seconds!, 0);
  console.log(`\nwrote ${OUT}  ${total.toFixed(1)}s  ${SCENES.length} scenes`);
}

await main();
