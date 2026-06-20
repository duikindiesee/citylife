// Builds the (small, curated) prompt handed to an LLM governor.
import type { GovernorContext } from "./LLMProvider";
import type { MetricsDigest } from "../engine/types";

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

export function buildGovernorPrompt(
  d: MetricsDigest,
  ctx: GovernorContext,
): { system: string; user: string } {
  const system = `You are the AI mayor of a small city in the game "CityLife".
Goal: ${ctx.goal}
You set POLICY ONLY (taxes, budgets, ordinances, zoning). Citizens, businesses and the
economy run themselves between your check-ins. Make small, sensible adjustments.

${ctx.actionMenu}`;

  const user = `City status — day ${d.day}:
- population: ${d.population}
- treasury: ${d.treasury}
- happiness: ${d.happiness}/100
- employment: ${pct(d.employmentRate)} (${d.unemployed} unemployed)
- GDP last week: ${d.gdp}
- tax rates: residential ${pct(d.taxRates.residential)}, commercial ${pct(d.taxRates.commercial)}, industrial ${pct(d.taxRates.industrial)}
- budget: ${JSON.stringify(d.budget)}
- commodity prices: ${JSON.stringify(d.prices)}
- problems: ${d.topProblems.join("; ")}

Pick up to ${ctx.maxActions} actions to improve the city toward the goal.
Return ONLY a JSON array of action objects.`;

  return { system, user };
}
