import { useEffect, useReducer, useRef, useState } from "react";
import { Runtime, type UiState } from "../runtime/Runtime";
import type { ProviderName } from "../ai/governor";

// ── helpers ──
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (r: number) => `${Math.round(r * 100)}%`;
const pad = (n: number) => String(n).padStart(2, "0");

function useRuntime(): Runtime {
  const ref = useRef<Runtime | null>(null);
  if (!ref.current) ref.current = new Runtime();
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => ref.current!.subscribe(force), []);
  return ref.current!;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <svg className="spark" viewBox="0 0 100 28" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * 100},${28 - ((v - min) / span) * 26 - 1}`,
    )
    .join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

const INTERVAL_PRESETS: { label: string; ms: number }[] = [
  { label: "10s", ms: 10_000 },
  { label: "1m", ms: 60_000 },
  { label: "10m", ms: 600_000 },
  { label: "30m", ms: 1_800_000 },
];

export function App() {
  const runtime = useRuntime();
  const canvasRef = useRef<HTMLDivElement>(null);
  const ui: UiState = runtime.getUiState();
  const [intervalText, setIntervalText] = useState("10");

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    runtime.start(el);
    const ro = new ResizeObserver(() => runtime.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      runtime.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const m = ui.metrics;
  const g = ui.governor;
  const next = g.msUntilNext;
  const nextLabel = g.enabled
    ? `${pad(Math.floor(next / 60000))}:${pad(Math.floor((next % 60000) / 1000))}`
    : "off";
  const happinessColor =
    m.happiness >= 60 ? "#5cd65c" : m.happiness >= 45 ? "#e6c84d" : "#e0584d";

  const applyInterval = () => {
    const mins = parseFloat(intervalText);
    if (!Number.isNaN(mins) && mins > 0)
      runtime.setGovernorIntervalMs(mins * 60_000);
  };

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          City<span>Life</span>
        </div>
        <div className="clock">
          Day {ui.clock.day} · {Runtime.dowLabel(ui.clock.dayOfWeek)} ·{" "}
          {pad(ui.clock.hour)}:{pad(ui.clock.minute)}{" "}
          <span className={ui.clock.isDay ? "sun" : "moon"}>
            {ui.clock.isDay ? "☀" : "☾"}
          </span>
        </div>
        <div className="speeds">
          <button
            className={ui.paused ? "on" : ""}
            onClick={() => runtime.setPaused(!ui.paused)}
          >
            {ui.paused ? "▶" : "❚❚"}
          </button>
          {[1, 2, 5, 20, 60].map((s) => (
            <button
              key={s}
              className={!ui.paused && ui.speed === s ? "on" : ""}
              onClick={() => {
                runtime.setPaused(false);
                runtime.setSpeed(s);
              }}
            >
              {s}×
            </button>
          ))}
        </div>
      </header>

      <main className="stage">
        <div className="canvas-host" ref={canvasRef} />
        <div className="legend">
          <span>
            <i style={{ background: "#e0584d" }} /> unhappy
          </span>
          <span>
            <i style={{ background: "#e6c84d" }} /> ok
          </span>
          <span>
            <i style={{ background: "#5cd65c" }} /> happy
          </span>
        </div>
      </main>

      <aside className="sidebar">
        <section className="panel">
          <h2>City</h2>
          <div className="stats">
            <Stat
              label="Population"
              value={m.population.toLocaleString()}
              sub={`${m.unemployed} jobless`}
            />
            <Stat
              label="Treasury"
              value={money(m.treasury)}
              sub={m.treasury < 0 ? "deficit" : "solvent"}
            />
            <Stat
              label="Happiness"
              value={`${m.happiness}`}
              sub={`${pct(m.employmentRate)} employed`}
            />
            <Stat label="GDP / wk" value={money(m.gdp)} />
          </div>
          <div className="bars">
            <div className="bar-row">
              <span>Happiness</span>
              <div className="bar">
                <div
                  style={{
                    width: `${m.happiness}%`,
                    background: happinessColor,
                  }}
                />
              </div>
            </div>
            <div className="bar-row">
              <span>Employment</span>
              <div className="bar">
                <div
                  style={{
                    width: `${m.employmentRate * 100}%`,
                    background: "#5aa9e6",
                  }}
                />
              </div>
            </div>
          </div>
          <div className="sparks">
            <div>
              <label>Population</label>
              <Sparkline
                data={ui.history.map((h) => h.population)}
                color="#7ad17a"
              />
            </div>
            <div>
              <label>Treasury</label>
              <Sparkline
                data={ui.history.map((h) => h.treasury)}
                color="#e6c84d"
              />
            </div>
          </div>
          <div className="prices">
            {Object.entries(ui.prices).map(([k, v]) => (
              <span key={k} className="chip">
                {k} <b>${v}</b>
              </span>
            ))}
          </div>
        </section>

        <section className="panel ai">
          <h2>AI Mayor</h2>
          <div className="gov-row">
            <label>Brain</label>
            <select
              value={g.provider}
              onChange={(e) =>
                runtime.setProvider(e.target.value as ProviderName)
              }
            >
              <option value="heuristic">Heuristic (built-in)</option>
              <option value="ollama">Ollama · Gemma (local)</option>
            </select>
          </div>
          <div className="gov-row">
            <label>Check-in</label>
            <div className="interval">
              <input
                value={intervalText}
                onChange={(e) => setIntervalText(e.target.value)}
                onBlur={applyInterval}
              />
              <span>min</span>
              <button onClick={applyInterval}>set</button>
            </div>
          </div>
          <div className="presets">
            {INTERVAL_PRESETS.map((p) => (
              <button
                key={p.label}
                className={g.intervalMs === p.ms ? "on" : ""}
                onClick={() => {
                  runtime.setGovernorIntervalMs(p.ms);
                  setIntervalText(String(p.ms / 60000));
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="gov-row controls">
            <label className="toggle">
              <input
                type="checkbox"
                checked={g.enabled}
                onChange={(e) => runtime.setGovernorEnabled(e.target.checked)}
              />
              auto
            </label>
            <span className="countdown">next: {nextLabel}</span>
            <button
              className="checkin"
              disabled={g.busy}
              onClick={() => void runtime.checkInNow()}
            >
              {g.busy ? "…thinking" : "Check in now"}
            </button>
          </div>

          <div className="feed">
            {g.decisions.length === 0 && (
              <div className="empty">
                No decisions yet — the mayor checks in on the interval above.
              </div>
            )}
            {g.decisions.map((d) => (
              <div className="decision" key={d.id}>
                <div className="d-head">
                  <span className="d-prov">{d.providerName}</span>
                  <span className="d-day">day {d.day}</span>
                  {d.fellBack && (
                    <span className="d-fallback" title={d.error}>
                      fallback
                    </span>
                  )}
                </div>
                <ul>
                  {d.actions.map((a, i) => (
                    <li key={i} className={a.ok ? "ok" : "bad"}>
                      <code>
                        {a.action}({a.args.map(String).join(", ")})
                      </code>
                      {a.why && <em> — {a.why}</em>}
                      <span className="d-res">
                        {a.ok ? "✓" : "✗"} {a.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
