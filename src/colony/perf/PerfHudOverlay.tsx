// Spec 158 — the debug HUD.
//
// A DOM overlay rather than an in-scene sprite, for two reasons: text in the scene would be
// drawn by the renderer it is measuring (the instrument would change the reading), and the
// HUD must stay legible while the world is stuttering.
//
// It mounts its OWN root into document.body rather than being placed in ColonyApp — a debug
// tool that is off by default should not be a permanent edit to the production UI tree, and
// this keeps the whole feature inside src/colony/perf.

import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { perfSession } from "./perfSession";
import type { PerfStats } from "./perfMonitor";
import type { SceneCensus } from "./sceneCensus";

function ms(value: number): string {
  if (value < 0) return "n/a";
  return `${value.toFixed(2)} ms`;
}

function int(value: number): string {
  return Math.round(value).toLocaleString("en-ZA");
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function PerfHud() {
  const session = perfSession();
  const [, force] = useState(0);
  useEffect(() => {
    if (!session) return;
    return session.subscribe(() => force((n) => n + 1));
  }, [session]);
  if (!session || !session.hudVisible) return null;

  const stats: PerfStats = session.monitor.stats();
  const census: SceneCensus | null = session.lastCensus;
  // Where the frame went. A frame whose CPU work is small but whose wall time is long spent
  // the difference waiting on the GPU / the presenter — that is the CPU-vs-GPU verdict.
  const waitMs = Math.max(
    0,
    stats.frameMeanMs - stats.cpuMeanMs - stats.drawMeanMs,
  );
  const shadowDelta = stats.shadowFrameMeanMs - stats.nonShadowFrameMeanMs;

  return (
    <div
      data-perf-hud="1"
      style={{
        position: "fixed",
        top: 8,
        left: 8,
        zIndex: 99999,
        font: "11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#d8f5ff",
        background: "rgba(6, 12, 20, 0.82)",
        border: "1px solid rgba(120, 200, 255, 0.35)",
        borderRadius: 6,
        padding: "8px 10px",
        minWidth: 260,
        pointerEvents: "none",
        whiteSpace: "pre",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        PERF · F9 to hide
        {session.replaying ? " · REPLAY" : ""}
        {session.recorder.recording
          ? ` · REC ${session.recorder.frameCount}`
          : ""}
      </div>
      <Row label="fps" value={`${stats.fpsMean.toFixed(1)}`} />
      <Row label="fps 1% low" value={`${stats.fpsLow1.toFixed(1)}`} />
      <Row label="frame p50" value={ms(stats.frameP50Ms)} />
      <Row label="frame p95" value={ms(stats.frameP95Ms)} />
      <Row label="frame p99" value={ms(stats.frameP99Ms)} />
      <Row label="frame max" value={ms(stats.frameMaxMs)} />
      <Row
        label="spikes >33ms"
        value={`${stats.spikeCount} (${(stats.spikeRatio * 100).toFixed(1)}%)`}
      />
      <hr style={{ border: 0, borderTop: "1px solid rgba(120,200,255,0.2)" }} />
      <Row label="cpu (pre-draw)" value={ms(stats.cpuMeanMs)} />
      <Row label="draw submit" value={ms(stats.drawMeanMs)} />
      <Row label="gpu (scene)" value={ms(stats.gpuMeanMs)} />
      <Row label="wait / present" value={ms(waitMs)} />
      <Row label="physics step" value={ms(stats.physicsMeanMs)} />
      <hr style={{ border: 0, borderTop: "1px solid rgba(120,200,255,0.2)" }} />
      <Row label="shadow frames" value={`${stats.shadowFrames}`} />
      <Row label="  on shadow frame" value={ms(stats.shadowFrameMeanMs)} />
      <Row label="  on other frame" value={ms(stats.nonShadowFrameMeanMs)} />
      <Row
        label="  shadow cost"
        value={shadowDelta > 0 ? `+${shadowDelta.toFixed(2)} ms` : "n/a"}
      />
      <hr style={{ border: 0, borderTop: "1px solid rgba(120,200,255,0.2)" }} />
      <Row label="draw calls" value={int(stats.drawCallsMean)} />
      <Row label="triangles" value={int(stats.trianglesMean)} />
      {census && (
        <>
          <Row label="instances" value={int(census.instances)} />
          <Row label="  shadow casters" value={int(census.shadowInstances)} />
          <Row label="meshes" value={int(census.meshes)} />
          {census.layers.slice(0, 4).map((layer) => (
            <Row
              key={layer.name}
              label={`  ${layer.name}${layer.castShadow ? " ☀" : ""}`}
              value={int(layer.instances)}
            />
          ))}
        </>
      )}
    </div>
  );
}

let root: Root | null = null;

/** Create the overlay root. Safe to call repeatedly; no-op when the flag is off. */
export function mountPerfHud(): void {
  if (root || typeof document === "undefined") return;
  if (!perfSession()) return;
  const host = document.createElement("div");
  host.id = "citylife-perf-hud";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<PerfHud />);
}
