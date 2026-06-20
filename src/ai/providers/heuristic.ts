// A deterministic, rule-based "mayor". Always available (no model needed), and the
// fallback whenever an LLM provider errors. Good enough to visibly govern the city.
import type {
  GovernorContext,
  GovernorPlan,
  LLMProvider,
} from "../LLMProvider";
import type { GameAction, MetricsDigest } from "../../engine/types";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class HeuristicProvider implements LLMProvider {
  readonly name = "heuristic";

  async plan(d: MetricsDigest, ctx: GovernorContext): Promise<GovernorPlan> {
    const actions: GameAction[] = [];
    const t = d.taxRates;
    const usedTax = new Set<string>();
    const usedBudget = new Set<string>();
    const has = (frag: string) => d.topProblems.some((p) => p.includes(frag));

    // 1) Solvency first.
    if (d.treasury < 0) {
      actions.push({
        action: "setTaxRate",
        args: ["commercial", r3(t.commercial + 0.02)],
        why: "treasury in deficit — raise commercial tax",
      });
      usedTax.add("commercial");
      actions.push({
        action: "setBudget",
        args: ["environment", Math.max(200, d.budget.environment - 200)],
        why: "trim spending to balance the books",
      });
      usedBudget.add("environment");
    } else if (d.treasury < 8000 && !usedTax.has("industrial")) {
      actions.push({
        action: "setTaxRate",
        args: ["industrial", r3(Math.min(0.2, t.industrial + 0.01))],
        why: "treasury low — nudge industrial tax up",
      });
      usedTax.add("industrial");
    }

    // 2) Jobs/people balance.
    if (d.employmentRate < 0.6 && !usedTax.has("industrial")) {
      actions.push({
        action: "setTaxRate",
        args: ["industrial", r3(Math.max(0.04, t.industrial - 0.02))],
        why: "high unemployment — cut industrial tax so firms hire",
      });
      usedTax.add("industrial");
    }
    if (has("unfilled jobs") && !usedTax.has("residential")) {
      actions.push({
        action: "setTaxRate",
        args: ["residential", r3(Math.max(0.03, t.residential - 0.02))],
        why: "jobs going unfilled — lower residential tax to attract residents",
      });
      usedTax.add("residential");
    }
    if (has("housing shortage")) {
      actions.push({
        action: "passOrdinance",
        args: ["urban_renewal"],
        why: "housing shortage — densify residential blocks",
      });
    }

    // 3) Quality of life.
    if (d.happiness < 50 && !usedBudget.has("safety")) {
      actions.push({
        action: "setBudget",
        args: ["safety", d.budget.safety + 400],
        why: "low happiness — improve safety coverage",
      });
      usedBudget.add("safety");
    }
    if (has("pollution")) {
      actions.push({
        action: "passOrdinance",
        args: ["anti_pollution_act"],
        why: "pollution high — pass the anti-pollution act",
      });
    }

    // 4) Healthy city → invest in growth.
    if (
      actions.length === 0 &&
      d.treasury > 20000 &&
      d.happiness > 60 &&
      !usedTax.has("residential")
    ) {
      actions.push({
        action: "setTaxRate",
        args: ["residential", r3(Math.max(0.03, t.residential - 0.01))],
        why: "stable and flush — small tax cut to spur growth",
      });
    }
    if (actions.length === 0) {
      actions.push({
        action: "noop",
        args: [],
        why: "city is stable — hold course",
      });
    }

    const summary = `treasury ${d.treasury}, pop ${d.population}, happiness ${d.happiness} → ${actions.length} action(s)`;
    return {
      actions: actions.slice(0, ctx.maxActions),
      summary,
      providerName: this.name,
    };
  }
}
