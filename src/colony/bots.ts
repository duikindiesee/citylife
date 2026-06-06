// Newcomer + Border Patrol bots. The colony has TWO LLM bots that can talk to each other:
//
//   • The newcomer bot — one per approved household, injected with a generated life history,
//     answers the patrol in character as the family lead.
//   • The Border Patrol bot — a SINGLETON "city brain" with a system prompt that lists the
//     surveyed CityPlan: zones, available plots, and their vibes. When a newcomer arrives, the
//     patrol bot reads the newcomer's introduction and ALLOCATES a fitting named plot.
//
// Replies come from the kooker inference choke point (POST /api/v1/ai/route/chat,
// OpenAI-compatible, Bearer = a citylife PAT). MockBotAdapter is the offline / CI fallback.
//
// Storytelling caps (per the cross-platform LLM-NPC paper, arXiv 2504.13928): we keep the LLM
// history to the SIX most recent turns — anything longer bloats latency and the player stops
// feeling heard. Narrator turns ("plot allocated") are show-only and never sent to the LLM.
import type { Household } from './newcomers'
import type { CityPlan, Plot } from './cityPlan'
import { validatePG } from './bot/pgSafety'

export type Speaker = 'patrol' | 'newcomer' | 'narrator'

export interface ChatMessage {
  speaker: Speaker
  text: string
  ts: number
}

export type BotKind = 'newcomer' | 'patrol'

export interface Bot {
  id: string
  kind: BotKind
  householdId: string // 'patrol' for the singleton patrol bot
  name: string
  source: string
  status: 'booting' | 'awake' | 'error' | 'deleted'
  systemPrompt: string
  messages: ChatMessage[]
  plotId?: string // newcomer's allocated plot
  error?: string
}

const HISTORY_TURNS = 6

/** Scripted opening from the patrol — fast and free, then the real bots take over. */
export const GREETING = 'Welcome to the border of Landing One. Please state your name and tell us about your family.'

/** Newcomer bot system prompt. */
export function composeLifeHistory(h: Household): string {
  const lead = h.members[0]
  const leadName = lead?.name ?? h.displayName
  const family = h.members.map((m) => `${m.name} (${m.age}, ${m.occupation})`).join(', ')
  return [
    `You are ${leadName}, the lead of ${h.displayName} — a family newly arrived at the border of a small off-world colony on a flat island floating in space.`,
    `Your family: ${family}. You came from ${h.originLocation}. Education: ${h.lead.education}. Work history: ${h.lead.jobHistory}.`,
    `Why you migrated: ${h.lead.migrationMotivation}. You bring ${h.holdings} in savings to deposit into the colony bank on arrival.`,
    `You are hopeful but a little nervous, speaking to the colony's border patrol officer. You may mention what kind of home would suit your family (a beach cove, a hillside vista, a riverside plot, the open plains, or the forest edge). Reply in the first person, warmly and concisely (1–3 sentences), in character as ${leadName}. Never break character or mention being an AI.`,
  ].join(' ')
}

/** Border Patrol bot system prompt — the colony's brain. */
export function composeCityBrainPrompt(plan: CityPlan): string {
  const avail = plan.plots.filter((p) => !p.assignedTo)
  return [
    `You are the Border Patrol Officer of Landing One — a small off-world colony on a flat island floating in space, in the Kookerverse. You are also the COLONY'S BRAIN: you know the surveyed city plan, the zones, and which plots are still available.`,
    `THE PLAN: residential plots arc the north and west; commercial sits east near the small harbour; industrial sits downwind to the south; civic (school, clinic, fire post) anchors the centre. All zones connect via the pre-laid grid roads.`,
    `AVAILABLE RESIDENTIAL PLOTS (allocate ONE to the newcomer family, choosing the one that best fits any hint they gave — sea, hills, river, plains, forest):`,
    ...avail.map((p) => `  • ${p.name} — ${p.description}.`),
    `Reply in 2–3 sentences. Warmly welcome the family by their household name, name the plot you've allocated EXACTLY as it appears above, say one sentence about why it suits them, then welcome them to Landing One. Stay in character as the border patrol officer; never mention being an AI.`,
  ].join('\n')
}

/** System prompt that turns a player's free-text MAGIC PROMPT into a short, PG, in-universe colonist
 *  personality. Forbids anything technical, adult, or out-of-world so the result stays family-safe. */
export const PERSONALITY_SYSTEM = [
  'You are a character designer for a wholesome, all-ages off-world colony game called the Kookerverse.',
  'Turn the player request into a SHORT personality for their new colonist, written in the second person ("You are ..."), 2 to 3 sentences.',
  'Keep it warm, hopeful and family-friendly for a mixed audience of children and grownups. No profanity, no romance or sexual content, no graphic violence, no real-world brands, politics, religion or real people.',
  'Give them a trade they hope to take up, one gentle quirk, and what they want from their new home on the floating island.',
  'Never mention being an AI, a bot, a model, a prompt, a token, a server or anything technical. Stay fully in character as a game designer describing a colonist.',
].join(' ')

/** A source of bot replies. */
export interface BotAdapter {
  readonly source: string
  /** Generate the next message in the conversation. speakingAs is who's about to speak;
   *  history is the full conversation so far (narrator turns are filtered out before send). */
  generate(systemPrompt: string, history: ChatMessage[], speakingAs: Speaker): Promise<string>
  /** Optional — turn a player's magic prompt into a PG colonist personality. Adapters that cannot
   *  generate (the pod gateway) simply omit this; callers fall back. */
  generatePersonality?(magicPrompt: string): Promise<string>
}

/** Generate a personality and ENFORCE PG safety on both the player's input and the model's output. The
 *  building block the signup + admin flows call: a bad input or a bad output yields a validation error and
 *  nothing is ever persisted or shown. Returns a discriminated result so the caller renders the reason. */
export async function generateSafePersonality(
  adapter: BotAdapter,
  magicPrompt: string,
): Promise<{ ok: true; personality: string } | { ok: false; reason: string }> {
  const input = validatePG(magicPrompt)
  if (!input.ok) return { ok: false, reason: input.reason ?? 'Please keep it friendly and family-appropriate.' }
  if (!magicPrompt || !magicPrompt.trim()) return { ok: false, reason: 'Tell us a little about who your colonist is.' }
  if (!adapter.generatePersonality) return { ok: false, reason: 'Personality generation is unavailable right now.' }
  let out: string
  try {
    out = await adapter.generatePersonality(magicPrompt)
  } catch {
    return { ok: false, reason: 'Could not reach the storyteller — please try again.' }
  }
  const safe = validatePG(out)
  if (!safe.ok) return { ok: false, reason: safe.reason ?? 'The generated personality was not family-appropriate — try a different idea.' }
  return { ok: true, personality: out.trim() }
}

/** Flavored stand-in replies for dev / CI / offline (NOT a real model). */
export class MockBotAdapter implements BotAdapter {
  readonly source = 'mock'
  async generate(systemPrompt: string, history: ChatMessage[], speakingAs: Speaker): Promise<string> {
    const lastOther = [...history].reverse().find((m) => m.speaker !== speakingAs && m.speaker !== 'narrator')
    const lastText = (lastOther?.text || '').toLowerCase()
    if (speakingAs === 'patrol') {
      // Read the system prompt for available plot names, pick the first that fits any hint.
      const plots = (systemPrompt.match(/• ([^—\n]+) —/g) || []).map((s) => s.replace(/^• /, '').replace(/ —.*$/, '').trim())
      const hint = (() => {
        if (/(sea|beach|shore|coast)/.test(lastText)) return plots.find((n) => /(beach|shell|crystal)/i.test(n))
        if (/(hill|mountain|view|ridge|height)/.test(lastText)) return plots.find((n) => /(hill|ochre|ridge)/i.test(n))
        if (/(river|water|brook|creek)/.test(lastText)) return plots.find((n) => /(river|brook|creek)/i.test(n))
        if (/(forest|wood|tree|quiet)/.test(lastText)) return plots.find((n) => /(forest|grove|wood)/i.test(n))
        return undefined
      })()
      const pick = hint ?? plots[0] ?? 'Open Plains'
      return `Welcome to Landing One — we've allocated you ${pick}, which should suit your family well. We're glad you're here.`
    }
    // newcomer mock
    const first = (systemPrompt.match(/You are ([^,]+),/)?.[1] ?? 'a settler').split(' ')[0]
    if (lastText.includes('name') || lastText.includes('who')) return `I'm ${first}. We've travelled a long way, hoping for a fresh start by the sea.`
    if (lastText.includes('why') || lastText.includes('come')) return `Honestly, we needed a fresh start. The crossing was hard, but we're ready to build a real life here.`
    if (lastText.includes('work') || lastText.includes('skill')) return `We're hard workers — whatever the colony needs, we'll learn it fast.`
    return `Thank you. We're hopeful to settle here.`
  }

  /** Deterministic, always-PG mock personality for dev / CI / offline (no model). */
  async generatePersonality(magicPrompt: string): Promise<string> {
    const seed = magicPrompt.replace(/[^a-zA-Z ]/g, '').trim().slice(0, 60) || 'a hopeful new arrival'
    return `You are a warm-hearted colonist who arrived dreaming of ${seed}. You hope to take up an honest trade on the floating island, you hum while you work, and more than anything you want a home where neighbours look out for one another.`
  }
}

/** Real replies via the kooker inference choke point.
 *  Auth has two modes, both keeping the PAT out of the public bundle:
 *   • Local dev — a gitignored VITE_CITYLIFE_PAT is passed as `token` and sent as the Bearer.
 *   • In-cluster — `token` is undefined; the nginx layer injects the Bearer from a k8s Secret
 *     on the inference route, so the browser never holds the credential. */
export class KookerInferenceBotAdapter implements BotAdapter {
  readonly source = 'kooker-inference'
  constructor(
    private readonly token?: string,
    private readonly model = 'kooker-codex',
    private readonly url = '/kooker/api/v1/ai/route/chat',
  ) {}

  async generate(systemPrompt: string, history: ChatMessage[], speakingAs: Speaker): Promise<string> {
    const trimmed = history.filter((m) => m.speaker !== 'narrator').slice(-HISTORY_TURNS)
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...trimmed.map((m) => ({ role: m.speaker === speakingAs ? ('assistant' as const) : ('user' as const), content: m.text })),
    ]
    // If the last entry is from us (or there's nothing), prompt the LLM to begin.
    if (messages.length === 1 || messages[messages.length - 1]!.role !== 'user') {
      messages.push({ role: 'user' as const, content: '(your turn)' })
    }
    return this.chat(messages, 220)
  }

  /** Turn a player magic prompt into a PG colonist personality (PG enforcement is applied by the caller
   *  via generateSafePersonality on both this input and this output). */
  async generatePersonality(magicPrompt: string): Promise<string> {
    return this.chat(
      [
        { role: 'system' as const, content: PERSONALITY_SYSTEM },
        { role: 'user' as const, content: magicPrompt },
      ],
      200,
    )
  }

  /** Shared OpenAI-compatible chat call to the kooker choke point, with the 5xx retry/backoff the
   *  cluster needs (the inference/gateway flaps under RAM pressure). */
  private async chat(messages: { role: 'system' | 'user' | 'assistant'; content: string }[], maxTokens: number): Promise<string> {
    const body = JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, temperature: 0.8 })
    let lastErr = 'unknown error'
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Kooker-Tier': 'external',
            // Only attach a Bearer when we hold a PAT locally; in-cluster the nginx proxy injects it.
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          body,
        })
        if (res.ok) {
          const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
          const content = data?.choices?.[0]?.message?.content
          if (typeof content === 'string' && content.trim()) return content.trim()
          lastErr = 'empty response'
        } else {
          lastErr = `HTTP ${res.status}`
          if (res.status < 500) break // a real 4xx — don't retry
        }
      } catch (e) {
        lastErr = (e as Error).message || 'network error'
      }
      if (attempt < 4) await new Promise((r) => setTimeout(r, 600 * attempt)) // backoff
    }
    throw new Error(`inference ${lastErr}`)
  }
}

/** Pick the real adapter when a citylife PAT is configured, else the mock. */
export function defaultBotAdapter(): BotAdapter {
  let pat: string | undefined
  try {
    pat = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_CITYLIFE_PAT
  } catch {
    pat = undefined
  }
  return pat ? new KookerInferenceBotAdapter(pat) : new MockBotAdapter()
}

/** Resolve the reply source at runtime, in priority order, NEVER baking a secret into the bundle:
 *   1. Local dev — a gitignored VITE_CITYLIFE_PAT means call the choke point directly with it.
 *   2. In-cluster — fetch /citylife-runtime.json (rendered by nginx from env, no secret). When it
 *      says botBackend:"kooker", use the real adapter with NO token; the nginx proxy injects the
 *      Bearer from a k8s Secret on the inference route, so the PAT never reaches the browser.
 *   3. Otherwise — mock stand-ins (offline / CI / unconfigured cluster). */
export async function resolveBotAdapter(): Promise<BotAdapter> {
  let pat: string | undefined
  try {
    pat = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_CITYLIFE_PAT
  } catch {
    pat = undefined
  }
  if (pat) return new KookerInferenceBotAdapter(pat)
  try {
    const res = await fetch('/citylife-runtime.json', { cache: 'no-store' })
    if (res.ok) {
      const cfg = (await res.json()) as { botBackend?: string; model?: string }
      if (cfg.botBackend === 'kooker') return new KookerInferenceBotAdapter(undefined, cfg.model || 'kooker-codex')
    }
  } catch {
    /* no runtime config (e.g. local dev without the proxy) — fall through to mock */
  }
  return new MockBotAdapter()
}

/** Holds the colony's bots and orchestrates the border / patrol-allocation dialogue. */
export class BotService {
  bots: Bot[] = []
  patrolBot: Bot | null = null
  private plan: CityPlan | null
  constructor(private adapter: BotAdapter, plan: CityPlan | null = null) {
    this.plan = plan
  }

  /** Swap the reply source at runtime (e.g. after fetching the in-cluster runtime config). */
  setAdapter(adapter: BotAdapter): void {
    this.adapter = adapter
    if (this.patrolBot) this.patrolBot.source = adapter.source
  }

  get source(): string {
    return this.adapter.source
  }

  /** Generate a PG-safe personality from a player's magic prompt (enforces safety on input + output). */
  generatePersonality(magicPrompt: string): Promise<{ ok: true; personality: string } | { ok: false; reason: string }> {
    return generateSafePersonality(this.adapter, magicPrompt)
  }

  /** Update the patrol bot's system prompt as the plan changes (plots allocated, etc). */
  setCityPlan(plan: CityPlan): void {
    this.plan = plan
    if (this.patrolBot) this.patrolBot.systemPrompt = composeCityBrainPrompt(plan)
  }

  /** Ensure the singleton patrol bot exists with the latest plan. */
  private ensurePatrol(): Bot {
    if (this.patrolBot && this.patrolBot.status !== 'deleted') {
      if (this.plan) this.patrolBot.systemPrompt = composeCityBrainPrompt(this.plan)
      return this.patrolBot
    }
    this.patrolBot = {
      id: 'bot_patrol',
      kind: 'patrol',
      householdId: 'patrol',
      name: 'Border Patrol',
      source: this.adapter.source,
      status: 'awake',
      systemPrompt: this.plan
        ? composeCityBrainPrompt(this.plan)
        : 'You are the Border Patrol Officer of Landing One. Welcome the family briefly and warmly.',
      messages: [],
    }
    return this.patrolBot
  }

  /** Boot a newcomer bot, get their first real reply, then have the patrol allocate a plot. */
  async create(h: Household): Promise<Bot> {
    const existing = this.bots.find((b) => b.householdId === h.id)
    if (existing && existing.status !== 'deleted') return existing
    const lead = h.members[0]
    const bot: Bot = {
      id: `bot_${h.id}`,
      kind: 'newcomer',
      householdId: h.id,
      name: lead?.name ?? h.displayName,
      source: this.adapter.source,
      status: 'booting',
      systemPrompt: composeLifeHistory(h),
      messages: [],
    }
    this.bots.push(bot)
    // Turn 0: scripted patrol greeting.
    bot.messages.push({ speaker: 'patrol', text: GREETING, ts: Date.now() })
    // Turn 1: real newcomer reply.
    try {
      const reply = await this.adapter.generate(bot.systemPrompt, bot.messages, 'newcomer')
      bot.messages.push({ speaker: 'newcomer', text: reply, ts: Date.now() })
      bot.status = 'awake'
    } catch (e) {
      bot.status = 'error'
      bot.error = String((e as Error)?.message ?? e)
      return bot
    }
    // Turns 2 + 3: city-brain patrol allocates a plot (real LLM call).
    await this.patrolAllocates(bot, h)
    return bot
  }

  /** The patrol bot reads the newcomer's intro + the plan, allocates a fitting plot, narrates it. */
  private async patrolAllocates(newcomerBot: Bot, h: Household): Promise<void> {
    if (!this.plan || this.plan.plots.every((p) => p.assignedTo)) return
    const patrol = this.ensurePatrol()
    try {
      // The patrol's view of the conversation: it sees the newcomer's intro as the user turn.
      const newcomerLast = [...newcomerBot.messages].reverse().find((m) => m.speaker === 'newcomer')
      const introText = `${h.displayName} arrived from ${h.originLocation}. The lead just said: "${newcomerLast?.text ?? '(no intro)'}". Allocate them a plot.`
      const patrolView: ChatMessage[] = [{ speaker: 'newcomer', text: introText, ts: Date.now() }]
      const reply = await this.adapter.generate(patrol.systemPrompt, patrolView, 'patrol')
      newcomerBot.messages.push({ speaker: 'patrol', text: reply, ts: Date.now() })
      const plot = this.matchPlot(reply)
      if (plot) {
        plot.assignedTo = newcomerBot.householdId
        newcomerBot.plotId = plot.id
        newcomerBot.messages.push({
          speaker: 'narrator',
          text: `✅ ${plot.name} allocated — ${plot.description}.`,
          ts: Date.now(),
        })
      } else {
        newcomerBot.messages.push({
          speaker: 'narrator',
          text: '(the city brain spoke but did not name a recognised plot — try again later)',
          ts: Date.now(),
        })
      }
    } catch (e) {
      newcomerBot.messages.push({
        speaker: 'narrator',
        text: `(city brain unreachable: ${String((e as Error)?.message ?? e)})`,
        ts: Date.now(),
      })
    }
  }

  /** Find a free plot whose name appears in the patrol's reply. */
  private matchPlot(reply: string): Plot | undefined {
    if (!this.plan) return undefined
    const lower = reply.toLowerCase()
    for (const p of this.plan.plots) {
      if (p.assignedTo) continue
      if (lower.includes(p.name.toLowerCase())) return p
    }
    return undefined
  }

  /** Operator asks an awake newcomer bot another question (the reply is the bot's own). */
  async ask(botId: string, question: string): Promise<void> {
    const bot = this.bots.find((b) => b.id === botId)
    if (!bot || bot.status === 'deleted') return
    bot.messages.push({ speaker: 'patrol', text: question, ts: Date.now() })
    try {
      const reply = await this.adapter.generate(bot.systemPrompt, bot.messages, 'newcomer')
      bot.messages.push({ speaker: 'newcomer', text: reply, ts: Date.now() })
      bot.status = 'awake'
    } catch (e) {
      bot.messages.push({
        speaker: 'narrator',
        text: `(could not reach inference: ${String((e as Error)?.message ?? e)})`,
        ts: Date.now(),
      })
    }
  }

  /** Reset support: forget a bot (the real adapter will also delete it server-side later). */
  remove(botId: string): void {
    const bot = this.bots.find((b) => b.id === botId)
    if (bot) bot.status = 'deleted'
    if (this.patrolBot && this.patrolBot.id === botId) this.patrolBot.status = 'deleted'
  }

  forHousehold(householdId: string): Bot | undefined {
    return this.bots.find((b) => b.householdId === householdId && b.status !== 'deleted')
  }
}
