// The swappable brain interface. Heuristic, Ollama (Gemma), or a remote provider
// all implement this. The governor doesn't care which one it's talking to.
import type { GameAction, MetricsDigest } from "../engine/types";

export interface GovernorContext {
  goal: string;
  actionMenu: string;
  maxActions: number;
}

export interface GovernorPlan {
  actions: GameAction[];
  summary: string;
  providerName: string;
  raw?: string;
}

export interface LLMProvider {
  readonly name: string;
  /** Look at the city digest, return a small plan of structured actions. */
  plan(digest: MetricsDigest, ctx: GovernorContext): Promise<GovernorPlan>;
}
