// The AI governor: on each check-in it reads a tiny digest, asks the configured brain
// for a small plan, applies the (schema-validated) actions, and records the reasoning.
// The *cadence* is owned by the Runtime (a configurable timer) — this just does one pass.
import { CONFIG } from "../engine/config";
import { GameAPI } from "../engine/api";
import type { Simulation } from "../engine/simulation";
import { ACTION_MENU } from "./schema";
import { HeuristicProvider } from "./providers/heuristic";
import { OllamaProvider } from "./providers/ollama";
import type { LLMProvider } from "./LLMProvider";
import type { GameAction } from "../engine/types";

export type ProviderName = "heuristic" | "ollama";

export interface AppliedAction {
  action: string;
  args: unknown[];
  why?: string;
  ok: boolean;
  message?: string;
}

export interface DecisionRecord {
  id: number;
  atMs: number;
  day: number;
  providerName: string;
  summary: string;
  actions: AppliedAction[];
  fellBack: boolean;
  error?: string;
}

export class Governor {
  goal = "Grow to 1,000 happy citizens while staying solvent.";
  maxActions = CONFIG.governor.maxActionsPerCheckIn;
  provider: LLMProvider;
  providerName: ProviderName;
  decisions: DecisionRecord[] = [];
  busy = false;
  private nextId = 1;
  private fallback = new HeuristicProvider();

  constructor(
    private api: GameAPI,
    private sim: Simulation,
    providerName: ProviderName = CONFIG.governor.provider,
  ) {
    this.providerName = providerName;
    this.provider = this.makeProvider(providerName);
  }

  private makeProvider(name: ProviderName): LLMProvider {
    if (name === "ollama") {
      return new OllamaProvider(
        CONFIG.governor.ollama.baseUrl,
        CONFIG.governor.ollama.model,
        CONFIG.governor.ollama.timeoutMs,
      );
    }
    return this.fallback;
  }

  setProvider(name: ProviderName): void {
    this.providerName = name;
    this.provider = this.makeProvider(name);
  }

  /** Run one governance check-in. Safe to call concurrently — re-entrancy is guarded. */
  async checkIn(): Promise<DecisionRecord> {
    if (this.busy) {
      return (
        this.decisions[0] ?? {
          id: 0,
          atMs: Date.now(),
          day: this.sim.state.clock.day,
          providerName: this.providerName,
          summary: "check-in already running",
          actions: [],
          fellBack: false,
        }
      );
    }
    this.busy = true;
    const digest = this.sim.getDigest();
    const ctx = {
      goal: this.goal,
      actionMenu: ACTION_MENU,
      maxActions: this.maxActions,
    };

    let providerName = this.provider.name;
    let summary = "";
    let actions: GameAction[] = [];
    let fellBack = false;
    let error: string | undefined;

    try {
      const plan = await this.provider.plan(digest, ctx);
      if (plan.actions.length === 0 && this.provider.name !== "heuristic") {
        throw new Error("provider returned no usable actions");
      }
      actions = plan.actions;
      summary = plan.summary;
      providerName = plan.providerName;
    } catch (e) {
      const plan = await this.fallback.plan(digest, ctx);
      actions = plan.actions;
      summary = plan.summary;
      providerName = `${plan.providerName} (fallback)`;
      fellBack = true;
      error = (e as Error).message;
    }

    const applied: AppliedAction[] = actions.map((a) => {
      const r = this.api.apply(a);
      return {
        action: a.action,
        args: a.args,
        why: a.why,
        ok: r.ok,
        message: r.ok ? r.message : r.error,
      };
    });

    const record: DecisionRecord = {
      id: this.nextId++,
      atMs: Date.now(),
      day: digest.day,
      providerName,
      summary,
      actions: applied,
      fellBack,
      error,
    };
    this.decisions.unshift(record);
    if (this.decisions.length > 40) this.decisions.length = 40;
    this.busy = false;
    return record;
  }
}
