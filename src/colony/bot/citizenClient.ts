// Citizen pod client — a thin HTTP client that lets a citizen speak through THEIR OWN Hermes pod
// (spec 074), instead of the shared kooker PAT. When a citizen has a live pod, their botGatewayUrl
// points at the pod's OpenAI-compatible gateway inside the kooker DMZ namespace. We post the
// conversation there and the pod replies in the citizen's own voice, with its own persistent memory.
//
// In the browser dev build this call is blocked — the gateway is a cluster-internal address the page
// cannot reach (and CORS / 403). That is EXPECTED. The adapter surfaces a clear error and the runtime
// falls back to the kooker-PAT adapter, so the game never stalls. The pod path lights up only when
// citylife runs server-side (or is proxied) with the DMZ reachable.
//
// fetchImpl is injectable so the unit tests drive it without a network.
import type { BotAdapter, ChatMessage, Speaker } from "../bots";

/** The minimal shape of a fetch response this client reads. */
export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<FetchLikeResponse>;

const HISTORY_TURNS = 6;

/** A BotAdapter backed by one citizen's own Hermes pod gateway. */
export class CitizenGatewayAdapter implements BotAdapter {
  readonly source = "citizen-pod";
  constructor(
    private readonly gatewayUrl: string,
    private readonly token?: string,
    private readonly model = "hermes-openai-gpt-5.5",
    private readonly fetchImpl: FetchLike = (u, i) =>
      fetch(u, i) as unknown as Promise<FetchLikeResponse>,
  ) {}

  /** The OpenAI-compatible chat endpoint on the pod gateway. */
  private endpoint(): string {
    return `${this.gatewayUrl.replace(/\/$/, "")}/v1/chat/completions`;
  }

  async generate(
    systemPrompt: string,
    history: ChatMessage[],
    speakingAs: Speaker,
  ): Promise<string> {
    const trimmed = history
      .filter((m) => m.speaker !== "narrator")
      .slice(-HISTORY_TURNS);
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...trimmed.map((m) => ({
        role:
          m.speaker === speakingAs ? ("assistant" as const) : ("user" as const),
        content: m.text,
      })),
    ];
    if (
      messages.length === 1 ||
      messages[messages.length - 1]!.role !== "user"
    ) {
      messages.push({ role: "user" as const, content: "(your turn)" });
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const body = JSON.stringify({
      model: this.model,
      messages,
      max_tokens: 220,
      temperature: 0.8,
    });

    let res: FetchLikeResponse;
    try {
      res = await this.fetchImpl(this.endpoint(), {
        method: "POST",
        headers,
        body,
      });
    } catch (e) {
      // Network unreachable from the browser — the expected dev case. The runtime falls back.
      throw new Error(
        `citizen pod unreachable (${(e as Error)?.message ?? "network error"})`,
      );
    }
    if (res.status === 403 || res.status === 401) {
      throw new Error(
        `citizen pod gateway ${res.status} (browser blocked from the DMZ; falling back)`,
      );
    }
    if (!res.ok) {
      throw new Error(`citizen pod gateway HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    throw new Error("citizen pod gateway returned an empty reply");
  }
}

/** True when a citizen record carries a usable in-cluster pod gateway URL. The browser still cannot
 *  reach it, but this gates whether the runtime even attempts the pod path before falling back. */
export function hasReachablePod(botGatewayUrl: string | undefined): boolean {
  return (
    typeof botGatewayUrl === "string" && /^https?:\/\//.test(botGatewayUrl)
  );
}
