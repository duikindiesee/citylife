// Ties the engine, renderer and AI governor together for the browser.
// Owns the fixed-timestep sim loop, the render loop, and — crucially — the
// CONFIGURABLE governor check-in timer (default 10 minutes).
import { CONFIG } from "../engine/config";
import { Simulation } from "../engine/simulation";
import { GameAPI } from "../engine/api";
import {
  Governor,
  type DecisionRecord,
  type ProviderName,
} from "../ai/governor";
import { R3FCityRenderer } from "../render/R3FCityRenderer";
import type { Commodity } from "../engine/types";

export interface UiState {
  running: boolean;
  paused: boolean;
  speed: number;
  clock: {
    day: number;
    dayOfWeek: number;
    hour: number;
    minute: number;
    isDay: boolean;
  };
  metrics: {
    population: number;
    treasury: number;
    happiness: number;
    gdp: number;
    employmentRate: number;
    unemployed: number;
  };
  taxRates: { residential: number; commercial: number; industrial: number };
  budget: {
    transport: number;
    safety: number;
    health: number;
    environment: number;
  };
  prices: Record<Commodity, number>;
  history: {
    day: number;
    population: number;
    treasury: number;
    happiness: number;
    gdp: number;
  }[];
  governor: {
    enabled: boolean;
    provider: ProviderName;
    intervalMs: number;
    msUntilNext: number;
    busy: boolean;
    decisions: DecisionRecord[];
  };
  log: string[];
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export class Runtime {
  readonly sim: Simulation;
  readonly api: GameAPI;
  readonly governor: Governor;
  private renderer: R3FCityRenderer | null = null;
  private running = false;
  private governorTimer: ReturnType<typeof setInterval> | null = null;

  private raf = 0;
  private lastFrame = 0;
  private lastUi = 0;
  private accumulator = 0;
  private speed = 1;
  private paused = false;

  private governorEnabled = true;
  private intervalMs = CONFIG.governor.defaultIntervalMs;
  private nextCheckInAt = 0;

  private listeners = new Set<() => void>();

  constructor(seed: number = CONFIG.render.seed) {
    this.sim = new Simulation(seed);
    this.api = new GameAPI(this.sim);
    this.governor = new Governor(this.api, this.sim, CONFIG.governor.provider);
  }

  // ── lifecycle ──
  start(container: HTMLElement) {
    if (this.running) return;
    this.renderer = new R3FCityRenderer(container, this.sim);
    this.running = true;
    this.lastFrame = performance.now();
    this.lastUi = this.lastFrame;
    this.scheduleGovernor();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.governorTimer) clearInterval(this.governorTimer);
    this.renderer?.dispose();
    this.renderer = null;
  }

  private loop = (now: number) => {
    if (!this.running) return;
    const dtReal = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (!this.paused) {
      this.accumulator += dtReal * this.speed;
      const stepDt = 1 / CONFIG.time.stepsPerSec;
      let steps = 0;
      while (this.accumulator >= stepDt && steps < 3000) {
        this.sim.step();
        this.accumulator -= stepDt;
        steps++;
      }
    }

    this.renderer?.frame();

    if (now - this.lastUi > 200) {
      this.lastUi = now;
      this.emit();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  // ── controls ──
  setSpeed(mult: number) {
    this.speed = Math.max(0, Math.min(60, mult));
    this.emit();
  }
  setPaused(p: boolean) {
    this.paused = p;
    this.emit();
  }
  resize() {
    this.renderer?.resize();
  }
  refreshBuildings() {
    this.renderer?.refreshBuildings();
  }

  // ── governor ──
  private scheduleGovernor() {
    if (this.governorTimer) clearInterval(this.governorTimer);
    if (!this.governorEnabled) {
      this.nextCheckInAt = 0;
      return;
    }
    this.nextCheckInAt = Date.now() + this.intervalMs;
    this.governorTimer = setInterval(
      () => void this.checkInNow(),
      this.intervalMs,
    );
  }

  setGovernorEnabled(on: boolean) {
    this.governorEnabled = on;
    this.scheduleGovernor();
    this.emit();
  }

  setGovernorIntervalMs(ms: number) {
    this.intervalMs = Math.max(
      CONFIG.governor.minIntervalMs,
      Math.min(24 * 60 * 60 * 1000, Math.round(ms)),
    );
    this.scheduleGovernor();
    this.emit();
  }

  setProvider(name: ProviderName) {
    this.governor.setProvider(name);
    this.emit();
  }

  async checkInNow(): Promise<DecisionRecord> {
    const rec = await this.governor.checkIn();
    this.nextCheckInAt = Date.now() + this.intervalMs;
    this.refreshBuildings(); // ordinances/zoning may have changed structures
    this.emit();
    return rec;
  }

  // ── ui plumbing ──
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit() {
    for (const cb of this.listeners) cb();
  }

  getUiState(): UiState {
    const s = this.sim.state;
    const prices = {} as Record<Commodity, number>;
    for (const c of Object.keys(s.market) as Commodity[])
      prices[c] = Math.round(s.market[c].price * 10) / 10;
    return {
      running: this.running,
      paused: this.paused,
      speed: this.speed,
      clock: {
        day: s.clock.day,
        dayOfWeek: s.clock.dayOfWeek,
        hour: s.clock.hour,
        minute: s.clock.minute,
        isDay: s.clock.isDay,
      },
      metrics: {
        population: s.metrics.population,
        treasury: Math.round(s.metrics.treasury),
        happiness: Math.round(s.metrics.happiness),
        gdp: Math.round(s.metrics.gdp),
        employmentRate: s.metrics.employmentRate,
        unemployed: s.metrics.unemployed,
      },
      taxRates: { ...s.taxRates },
      budget: { ...s.budget },
      prices,
      history: this.sim.history.slice(-60),
      governor: {
        enabled: this.governorEnabled,
        provider: this.governor.providerName,
        intervalMs: this.intervalMs,
        msUntilNext: this.nextCheckInAt
          ? Math.max(0, this.nextCheckInAt - Date.now())
          : 0,
        busy: this.governor.busy,
        decisions: this.governor.decisions.slice(0, 12),
      },
      log: s.log.slice(0, 8),
    };
  }

  static dowLabel(i: number): string {
    return DOW[i] ?? "?";
  }
}
