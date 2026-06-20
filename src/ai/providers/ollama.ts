// Local LLM brain via Ollama's OpenAI-ish chat API. Runs Gemma (~4B) — pin it to CPU
// (OLLAMA_NUM_GPU=0) so the 4GB GPU stays free for rendering. If Ollama isn't running,
// plan() throws and the governor falls back to the heuristic mayor.
import type {
  GovernorContext,
  GovernorPlan,
  LLMProvider,
} from "../LLMProvider";
import type { MetricsDigest } from "../../engine/types";
import { buildGovernorPrompt } from "../promptBuilder";
import { extractJson, validateActions } from "../schema";

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";

  constructor(
    private baseUrl: string,
    private model: string,
    private timeoutMs: number,
  ) {}

  async plan(
    digest: MetricsDigest,
    ctx: GovernorContext,
  ): Promise<GovernorPlan> {
    const { system, user } = buildGovernorPrompt(digest, ctx);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: "json",
          options: { temperature: 0.4 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
      const data: any = await res.json();
      const content: string = data?.message?.content ?? "";
      const parsed = extractJson(content) ?? safeParse(content);
      const actions = validateActions(parsed, ctx.maxActions);
      return {
        actions,
        summary: `${this.model} proposed ${actions.length} action(s)`,
        providerName: `ollama:${this.model}`,
        raw: content,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
