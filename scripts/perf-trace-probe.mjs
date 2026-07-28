// Spec 158 — the automated frame-time measurement.
//
// Boots the colony on a real GPU, replays the canonical movement trace, and prints the frame
// statistics as JSON. This is the A/B instrument: run it on two branches (or with a knob
// flipped through --set) and the only thing that differs between the two runs is the code.
//
// Usage:
//   node scripts/perf-trace-probe.mjs [--port 5631] [--seconds 12] [--label before]
//                                     [--set key=value ...] [--out report.json]
//
// --set writes window.__perfExperiment before the world boots; R3FFoliage and the shadow
// cadence read it (see src/colony/perf/perfExperiment.ts) so a candidate cause can be turned
// off WITHOUT editing code, which is how a cause gets named before anything is changed.
//
// Read docs/VERIFY-GPU.md first: a number produced under SwiftShader is a floor, not a
// measurement, and this script refuses to report one unless --allow-software is passed.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
function has(name) {
  return args.includes(`--${name}`);
}
const overrides = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--set" && args[i + 1]) {
    const [key, ...rest] = args[i + 1].split("=");
    const raw = rest.join("=");
    overrides[key] =
      raw === "true"
        ? true
        : raw === "false"
          ? false
          : Number.isNaN(Number(raw))
            ? raw
            : Number(raw);
  }
}

const PORT = Number(flag("port", "5631"));
const SECONDS = Number(flag("seconds", "12"));
const LABEL = flag("label", "run");
const OUT = flag("out", "");
const ALLOW_SOFTWARE = has("allow-software");

if (PORT < 5630 || PORT > 5639) {
  console.error(`refusing port ${PORT}: this worker is allocated 5630-5639`);
  process.exit(2);
}

const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "run",
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(PORT),
      "--strictPort",
    ],
    { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" },
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("dev server did not start in 120 s")),
      120_000,
    );
    const onData = (buffer) => {
      const text = String(buffer);
      if (text.includes("ready in") || text.includes("Local:")) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`dev server exited early with code ${code}`));
    });
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
  });
  let report = null;
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 900 },
    });
    page.on("pageerror", (error) =>
      console.error("[page error]", error.message),
    );

    // Plant the experiment knobs before any module runs.
    await page.addInitScript((values) => {
      window.__perfExperiment = values;
    }, overrides);

    // --raw-fps loads the page with NO perf flag at all and counts frames the way
    // docs/VERIFY-GPU.md always has. It is the control for the instrument itself: if the
    // un-instrumented page is just as slow, the probe is exonerated; if it is fast, the probe
    // is the stall and every number it produced is about the probe.
    const rawFps = has("raw-fps");
    await page.goto(`${BASE}/?skipauth=1${rawFps ? "" : "&perf=armed"}`, {
      waitUntil: "domcontentloaded",
    });

    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return "no-webgl2";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
    });
    const software = /swiftshader|llvmpipe|software/i.test(renderer);
    if (software && !ALLOW_SOFTWARE) {
      throw new Error(
        `refusing to report a software-rendered number: ${renderer}. Pass --allow-software to record it as a floor.`,
      );
    }

    const t0 = Date.now();
    const mark = (what) =>
      console.error(
        `[probe] ${((Date.now() - t0) / 1000).toFixed(1)}s ${what}`,
      );
    mark(`gpu = ${renderer}`);
    await page.waitForFunction(
      (needPerf) => !!window.__r3fScene && (!needPerf || !!window.__perf),
      !rawFps,
      { timeout: 180_000 },
    );
    mark("scene up");

    if (rawFps) {
      // Wait for the world the same way, but by counting scene objects rather than through
      // __perf, which does not exist on this page.
      await page.waitForFunction(
        () => {
          let objects = 0;
          window.__r3fScene.traverse(() => objects++);
          return objects > 200;
        },
        undefined,
        { timeout: 180_000 },
      );
      let previous = -1;
      for (let i = 0; i < 40; i++) {
        const now = await page.evaluate(() => {
          let objects = 0;
          window.__r3fScene.traverse(() => objects++);
          return objects;
        });
        if (now === previous) break;
        previous = now;
        await page.waitForTimeout(1000);
      }
      mark(`world settled at ${previous} objects`);
      const sample = async () =>
        page.evaluate(
          (ms) =>
            new Promise((resolve) => {
              let frames = 0;
              const t0 = performance.now();
              const tick = () => {
                frames++;
                if (performance.now() - t0 < ms) requestAnimationFrame(tick);
                else resolve(frames / ((performance.now() - t0) / 1000));
              };
              requestAnimationFrame(tick);
            }),
          5000,
        );
      const first = await sample();
      const second = await sample();
      console.log(
        `raw rAF fps (NO instrumentation): ${first.toFixed(1)} then ${second.toFixed(1)}  · renderer ${renderer}`,
      );

      // Control: a trivial WebGL2 canvas of the same size that does nothing but clear. If
      // THIS is also slow, the ceiling belongs to the harness's present path and no absolute
      // number from it describes the game. Without this control, "the colony renders at 8
      // fps" is an unsupported claim.
      const trivial = await browser.newPage({
        viewport: { width: 1600, height: 900 },
      });
      await trivial.goto("about:blank");
      const trivialFps = await trivial.evaluate(
        () =>
          new Promise((resolve) => {
            const canvas = document.createElement("canvas");
            canvas.width = 1600;
            canvas.height = 900;
            document.body.appendChild(canvas);
            const gl = canvas.getContext("webgl2");
            if (!gl) return resolve(-1);
            let frames = 0;
            const t0 = performance.now();
            const tick = () => {
              gl.clearColor((frames % 60) / 60, 0.2, 0.3, 1);
              gl.clear(gl.COLOR_BUFFER_BIT);
              frames++;
              if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
              else resolve(frames / ((performance.now() - t0) / 1000));
            };
            requestAnimationFrame(tick);
          }),
      );
      await trivial.close();
      console.log(
        `trivial 1600x900 WebGL2 clear-only canvas: ${trivialFps.toFixed(1)} fps`,
      );
      if (OUT)
        writeFileSync(
          OUT,
          JSON.stringify(
            { rawFps: [first, second], trivialFps, renderer },
            null,
            2,
          ),
        );
      return;
    }
    // Wait for the world to STOP CHANGING rather than for any particular layer: a knob run
    // may have removed the layer the gate was watching for, and a probe that hangs on its own
    // control condition produces no measurement at all.
    await page.waitForFunction(
      () => (window.__perf?.census()?.meshes ?? 0) > 20,
      undefined,
      { timeout: 180_000 },
    );
    mark("scene populated");
    let previous = "";
    let stable = 0;
    for (let i = 0; i < 40 && stable < 3; i++) {
      const now = await page.evaluate(() => {
        const c = window.__perf.census();
        return `${c.instances}/${c.meshes}`;
      });
      stable = now === previous ? stable + 1 : 0;
      previous = now;
      await page.waitForTimeout(1000);
    }
    mark(`world settled at ${previous} instances/meshes`);
    await page.waitForTimeout(3000);

    const census = await page.evaluate(() => window.__perf.census());

    // A frame budget is not only the renderer's. The colony runs its own rAF loop and pushes
    // a UI heartbeat into a large React tree; if the frame is being eaten outside WebGL, no
    // amount of scene bisecting will ever find it. These probes look outside the canvas.
    if (has("host-bisect")) {
      const settle = Number(flag("bisect-ms", "4000"));
      const measure = async (label, setup, teardown) => {
        if (setup) await page.evaluate(setup);
        await page.evaluate(() => window.__perf.reset());
        await page.waitForTimeout(settle);
        const stats = await page.evaluate(() => window.__perf.stats());
        if (teardown) await page.evaluate(teardown);
        if (stats.frames === 0)
          throw new Error(
            `probe stopped sampling during "${label}" — the measurement is void, not zero`,
          );
        console.log(
          `  ${label.padEnd(34)} ${stats.fpsMean.toFixed(1).padStart(6)} fps  ${stats.frameMeanMs.toFixed(1).padStart(7)} ms  p99 ${stats.frameP99Ms.toFixed(1).padStart(7)} ms  cpu ${stats.cpuMeanMs.toFixed(1)}  draw ${stats.drawMeanMs.toFixed(1)}`,
        );
        return stats;
      };
      console.log("\nhost bisect (outside the WebGL scene)");
      const rows = {};
      rows.control = await measure("control", null, null);
      rows.uiHidden = await measure(
        "react UI root display:none",
        () => {
          document.getElementById("root").style.display = "none";
        },
        () => {
          document.getElementById("root").style.display = "";
        },
      );
      rows.simPaused = await measure(
        "sim paused (runtime.setPaused)",
        () => window.__colony?.setPaused?.(true),
        () => window.__colony?.setPaused?.(false),
      );
      // setPaused only stops sim.step. The 200 ms UI heartbeat keeps firing and re-renders
      // the whole ColonyApp tree through useSyncExternalStore — React work that happens
      // outside the measured render window and would show up only as wait time.
      rows.emitStubbed = await measure(
        "ui heartbeat stubbed (no emit)",
        () => {
          const colony = window.__colony;
          if (!colony) return;
          window.__perfRealEmit = colony.emit;
          colony.emit = () => {};
        },
        () => {
          const colony = window.__colony;
          if (colony && window.__perfRealEmit)
            colony.emit = window.__perfRealEmit;
        },
      );
      // navigator.getGamepads() is called every frame by the walker. On Windows it polls the
      // HID stack and is a known stall when a flaky device is attached.
      rows.gamepadStubbed = await measure(
        "navigator.getGamepads stubbed",
        () => {
          window.__perfRealGamepads = navigator.getGamepads;
          navigator.getGamepads = () => [];
        },
        () => {
          if (window.__perfRealGamepads)
            navigator.getGamepads = window.__perfRealGamepads;
        },
      );
      // Resolution sweep — the fill-rate question. Resize the VIEWPORT, not the canvas
      // element: R3F owns the canvas size through a resize observer and reverts a raw
      // canvas.width write within a frame, which makes the naive version of this test lie.
      for (const [w, h] of [
        [1024, 576],
        [640, 360],
        [320, 180],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(1500);
        rows[`viewport${w}`] = await measure(`viewport ${w}x${h}`, null, null);
      }
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.waitForTimeout(1500);

      // Harness ceiling: how fast can requestAnimationFrame run in this browser at all,
      // with no scene? Any measurement of the world is meaningless above this number.
      const blank = await browser.newPage();
      await blank.goto("about:blank");
      const ceiling = await blank.evaluate(
        () =>
          new Promise((resolve) => {
            let frames = 0;
            const t0 = performance.now();
            const tick = () => {
              frames++;
              if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
              else resolve(frames / ((performance.now() - t0) / 1000));
            };
            requestAnimationFrame(tick);
          }),
      );
      await blank.close();
      rows.harnessCeilingFps = ceiling;
      console.log(
        `  ${"blank-page rAF ceiling".padEnd(34)} ${ceiling.toFixed(1).padStart(6)} fps`,
      );
      if (OUT) writeFileSync(OUT, JSON.stringify({ rows, census }, null, 2));
      return;
    }

    // Anatomy of the UI heartbeat. Once --host-bisect has shown that stubbing runtime.emit()
    // restores the frame rate, this says WHAT inside the heartbeat costs the time: the long
    // tasks it produces, and how much of each is getUiState() versus React rendering.
    // Sampling CPU profile via CDP. Once the long tasks are known to be the UI heartbeat's
    // React render, this names the actual function burning the time — the alternative is
    // guessing which of 4,000 lines is expensive, which is how this lane went wrong before.
    if (has("profile")) {
      const client = await page.context().newCDPSession(page);
      await client.send("Profiler.enable");
      await client.send("Profiler.setSamplingInterval", { interval: 200 });
      await client.send("Profiler.start");
      await page.waitForTimeout(Number(flag("profile-ms", "6000")));
      const { profile } = await client.send("Profiler.stop");

      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const self = new Map();
      const total = profile.samples.length || 1;
      for (const id of profile.samples) self.set(id, (self.get(id) ?? 0) + 1);
      const rows = [...self.entries()]
        .map(([id, count]) => {
          const node = byId.get(id);
          const frame = node?.callFrame ?? {};
          const url = (frame.url || "").split("/").slice(-2).join("/");
          return {
            name: frame.functionName || "(anonymous)",
            where: `${url}:${(frame.lineNumber ?? -1) + 1}`,
            percent: (count / total) * 100,
          };
        })
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 20);
      console.log(`\ncpu profile — top self time (${total} samples)`);
      for (const row of rows)
        console.log(
          `  ${row.percent.toFixed(1).padStart(5)}%  ${row.name.padEnd(34)} ${row.where}`,
        );

      // Self time says WHAT is slow; the caller chain says WHO asked for it, which is where
      // the fix goes. Aggregate samples by the whole stack and print the heaviest chains.
      const parent = new Map();
      for (const node of profile.nodes)
        for (const child of node.children ?? []) parent.set(child, node.id);
      const chainOf = (id) => {
        const names = [];
        let cursor = id;
        while (cursor !== undefined && names.length < 14) {
          const node = byId.get(cursor);
          if (!node) break;
          const fn = node.callFrame.functionName || "(anon)";
          if (fn !== "(garbage collector)" && fn !== "(program)")
            names.push(fn);
          cursor = parent.get(cursor);
        }
        return names.reverse().join(" > ");
      };
      const chains = new Map();
      for (const [id, count] of self) {
        const chain = chainOf(id);
        chains.set(chain, (chains.get(chain) ?? 0) + count);
      }
      const topChains = [...chains.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);
      console.log("\nheaviest call chains");
      for (const [chain, count] of topChains)
        console.log(
          `  ${((count / total) * 100).toFixed(1).padStart(5)}%  ${chain}`,
        );
      if (OUT)
        writeFileSync(
          OUT,
          JSON.stringify({ rows, chains: topChains }, null, 2),
        );
      return;
    }

    if (has("emit-anatomy")) {
      const longTasks = async (label, setup, teardown) => {
        if (setup) await page.evaluate(setup);
        const tasks = await page.evaluate(
          (ms) =>
            new Promise((resolve) => {
              const seen = [];
              let observer = null;
              try {
                observer = new PerformanceObserver((list) => {
                  for (const entry of list.getEntries())
                    seen.push(Math.round(entry.duration));
                });
                observer.observe({ entryTypes: ["longtask"] });
              } catch {
                /* longtask unsupported */
              }
              setTimeout(() => {
                observer?.disconnect();
                resolve(seen);
              }, ms);
            }),
          5000,
        );
        if (teardown) await page.evaluate(teardown);
        const total = tasks.reduce((a, b) => a + b, 0);
        console.log(
          `  ${label.padEnd(30)} ${String(tasks.length).padStart(3)} long tasks, ${String(total).padStart(5)} ms total, longest ${Math.max(0, ...tasks)} ms`,
        );
        return tasks;
      };

      console.log("\nemit anatomy (5 s windows)");
      const out = {};
      out.control = await longTasks("control", null, null);
      out.stubbed = await longTasks(
        "emit stubbed",
        () => {
          window.__perfRealEmit = window.__colony.emit;
          window.__colony.emit = () => {};
        },
        () => {
          window.__colony.emit = window.__perfRealEmit;
        },
      );
      out.getUiStateMs = await page.evaluate(() => {
        const colony = window.__colony;
        colony.getUiState(); // warm
        const t0 = performance.now();
        for (let i = 0; i < 20; i++) colony.getUiState();
        return (performance.now() - t0) / 20;
      });
      console.log(
        `  getUiState() alone            ${out.getUiStateMs.toFixed(2)} ms per call`,
      );
      if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
      return;
    }

    if (has("bisect")) {
      // Attribute the frame cost to a LAYER: hide one subtree at a time, hold still, and
      // measure. No reload, no code change — the difference from the control IS that layer's
      // cost. This is what stops the investigation guessing which draw is the expensive one.
      const settle = Number(flag("bisect-ms", "2500"));
      const names = await page.evaluate(() =>
        window.__r3fScene.children.map(
          (child, index) => child.name || `${child.type}#${index}`,
        ),
      );
      // Most R3F groups are unnamed, so label each one by what is inside it — a bisect table
      // of "Group#7" tells nobody which layer to go and look at.
      const hints = await page.evaluate(() =>
        window.__r3fScene.children.map((child) => {
          const named = [];
          let objects = 0;
          child.traverse((node) => {
            objects++;
            if (node.name && named.length < 3) named.push(node.name);
          });
          return `${objects}obj${named.length ? " " + named.join(",") : ""}`;
        }),
      );
      const measure = async (hide) => {
        await page.evaluate((target) => {
          window.__r3fScene.children.forEach((child, index) => {
            const key = child.name || `${child.type}#${index}`;
            child.visible = target === null ? true : key !== target;
          });
          window.__perf.reset();
        }, hide);
        await page.waitForTimeout(settle);
        const stats = await page.evaluate(() => window.__perf.stats());
        if (stats.frames === 0)
          throw new Error(
            `probe stopped sampling while bisecting "${hide ?? "control"}" — the measurement is void, not zero`,
          );
        return stats;
      };
      const control = await measure(null);
      console.log(
        `\nlayer bisect (control: ${control.fpsMean.toFixed(1)} fps, ${control.frameMeanMs.toFixed(1)} ms/frame)`,
      );
      const rows = [];
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const hidden = await measure(name);
        rows.push({
          name: `${name} [${hints[i]}]`,
          fps: hidden.fpsMean,
          frameMs: hidden.frameMeanMs,
          savedMs: control.frameMeanMs - hidden.frameMeanMs,
        });
      }
      await measure(null);
      rows.sort((a, b) => b.savedMs - a.savedMs);
      for (const row of rows) {
        console.log(
          `  hide ${row.name.padEnd(44)} ${row.fps.toFixed(1).padStart(6)} fps  ${row.frameMs.toFixed(1).padStart(7)} ms  saved ${row.savedMs.toFixed(1).padStart(7)} ms`,
        );
      }
      if (OUT)
        writeFileSync(OUT, JSON.stringify({ control, rows, census }, null, 2));
      return;
    }

    report = await page.evaluate(async (seconds) => {
      const camera = window.__r3fCamera;
      const trace = window.__perf.canonicalTrace({
        origin: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        startYaw: 0,
        speed: 10,
        durationMs: seconds * 1000,
      });
      const startPos = camera.position.clone();
      const result = await window.__perf.runTrace(trace, 60);
      const last = trace.frames[trace.frames.length - 1];
      // The replay is worthless if the camera did not actually follow it — assert the walk
      // happened rather than trusting that it did.
      const travelled = startPos.distanceTo(camera.position);
      const followError = Math.hypot(
        camera.position.x - last.x,
        camera.position.z - last.z,
      );
      return {
        travelled,
        followError,
        stats: result.stats,
        frames: result.frames,
        census: result.census,
        gpuAvailable: window.__perf.gpuAvailable,
        // Keep the raw frame times so a spike pattern can be plotted / period-checked.
        frameMs: result.samples.map((s) => Number(s.frameMs.toFixed(3))),
        cpuMs: result.samples.map((s) => Number(s.cpuMs.toFixed(3))),
        drawMs: result.samples.map((s) => Number(s.drawMs.toFixed(3))),
        gpuMs: result.samples.map((s) => Number(s.gpuMs.toFixed(3))),
        shadowPass: result.samples.map((s) => (s.shadowPass ? 1 : 0)),
      };
    }, SECONDS);

    report.label = LABEL;
    report.renderer = renderer;
    report.software = software;
    report.overrides = overrides;
    report.censusBeforeRun = census;
  } finally {
    await browser.close();
    server.kill();
    if (process.platform === "win32" && server.pid) {
      spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    }
  }

  const { stats } = report;
  console.log(
    [
      `label            ${report.label}`,
      `renderer         ${report.renderer}`,
      `gpu timer        ${report.gpuAvailable ? "available" : "unavailable"}`,
      `overrides        ${JSON.stringify(report.overrides)}`,
      `frames           ${report.frames}`,
      `walk travelled   ${report.travelled.toFixed(1)} m (follow error ${report.followError.toFixed(2)} m)`,
      `fps mean         ${stats.fpsMean.toFixed(1)}`,
      `fps 1% low       ${stats.fpsLow1.toFixed(1)}`,
      `frame p50        ${stats.frameP50Ms.toFixed(2)} ms`,
      `frame p95        ${stats.frameP95Ms.toFixed(2)} ms`,
      `frame p99        ${stats.frameP99Ms.toFixed(2)} ms`,
      `frame max        ${stats.frameMaxMs.toFixed(2)} ms`,
      `spikes >33ms     ${stats.spikeCount} (${(stats.spikeRatio * 100).toFixed(1)}%)`,
      `cpu pre-draw     ${stats.cpuMeanMs.toFixed(2)} ms`,
      `draw submit      ${stats.drawMeanMs.toFixed(2)} ms`,
      `wait / present   ${Math.max(0, stats.frameMeanMs - stats.cpuMeanMs - stats.drawMeanMs).toFixed(2)} ms`,
      `gpu (scene)      ${stats.gpuMeanMs.toFixed(2)} ms`,
      `physics step     ${stats.physicsMeanMs.toFixed(2)} ms`,
      `shadow frames    ${stats.shadowFrames} @ ${stats.shadowFrameMeanMs.toFixed(2)} ms`,
      `other frames     ${stats.frames - stats.shadowFrames} @ ${stats.nonShadowFrameMeanMs.toFixed(2)} ms`,
      `draw calls       ${Math.round(stats.drawCallsMean)}`,
      `triangles        ${Math.round(stats.trianglesMean)}`,
      `instances        ${report.census?.instances ?? "?"} (${report.census?.shadowInstances ?? "?"} shadow casting)`,
      `top layers       ${(report.census?.layers ?? [])
        .slice(0, 4)
        .map((l) => `${l.name}=${l.instances}${l.castShadow ? "☀" : ""}`)
        .join(" ")}`,
    ].join("\n"),
  );
  if (OUT) {
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`\nwrote ${OUT}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
