// Newcomer bots (plan: Hermes-without-Telegram). When a household is APPROVED at the border, a
// minimal bot is created and injected with a generated life history; the border patrol then talks
// to it and a REAL reply comes back from the kooker inference choke point
// (POST /api/v1/ai/route/chat, OpenAI-compatible, Bearer = a citylife PAT). A MockBotAdapter gives
// flavored stand-in replies for dev/CI/offline; KookerInferenceBotAdapter gives true responses and
// switches on automatically when VITE_CITYLIFE_PAT is set. The browser never sees kooker internals.
import type { Household } from './newcomers'

export interface ChatMessage {
  role: 'patrol' | 'bot'
  text: string
  ts: number
}

export interface Bot {
  id: string
  householdId: string
  name: string // the household lead's name
  source: string // which adapter produced replies (mock | kooker-inference)
  status: 'booting' | 'awake' | 'error' | 'deleted'
  lifeHistory: string // the injected system prompt
  messages: ChatMessage[]
  error?: string
}

/** The scripted border-patrol questions. Questions may be mocked; replies must be the bot's own. */
export const PATROL_QUESTIONS = [
  'Welcome to the border. Please state your name and who travels with you.',
  'Why have you come to our colony?',
  'What work can your family do here?',
]

/** Build the bot's injected life history + vibe (its system prompt). */
export function composeLifeHistory(h: Household): string {
  const lead = h.members[0]
  const leadName = lead?.name ?? h.displayName
  const family = h.members.map((m) => `${m.name} (${m.age}, ${m.occupation})`).join(', ')
  return [
    `You are ${leadName}, the lead of ${h.displayName} — a family newly arrived at the border of a small off-world colony on a flat island floating in space.`,
    `Your family: ${family}. You came from ${h.originLocation}. Education: ${h.lead.education}. Work history: ${h.lead.jobHistory}.`,
    `Why you migrated: ${h.lead.migrationMotivation}. You bring ${h.holdings} in savings to deposit into the colony bank on arrival.`,
    `You are hopeful but a little nervous, speaking to the colony's border patrol officer. Reply in the first person, warmly and concisely (1-3 sentences), in character as ${leadName}. Never break character or mention being an AI.`,
  ].join(' ')
}

/** A source of bot replies. Mock for dev; the kooker-inference adapter for true LLM responses. */
export interface BotAdapter {
  readonly source: string
  reply(systemPrompt: string, history: ChatMessage[], question: string): Promise<string>
}

/** Flavored stand-in replies (NOT a real model) so the flow is demoable offline / in CI. */
export class MockBotAdapter implements BotAdapter {
  readonly source = 'mock'
  async reply(systemPrompt: string, _history: ChatMessage[], question: string): Promise<string> {
    const first = (systemPrompt.match(/You are ([^,]+),/)?.[1] ?? 'a settler').split(' ')[0]
    const q = question.toLowerCase()
    if (q.includes('name') || q.includes('who')) return `I'm ${first}. We've travelled a long way to reach your colony, and we're all here together.`
    if (q.includes('why') || q.includes('come')) return `Honestly? We needed a fresh start. The crossing was hard, but we're ready to build a real life here.`
    if (q.includes('work') || q.includes('do') || q.includes('skill')) return `We're hard workers — whatever the colony needs, we'll learn it fast. Just give us the chance.`
    return `Thank you for asking. We only want to settle, work, and belong here on the island.`
  }
}

/** Real replies via the kooker inference choke point. Bearer = a citylife PAT (gitignored env). */
export class KookerInferenceBotAdapter implements BotAdapter {
  readonly source = 'kooker-inference'
  constructor(
    private readonly token: string,
    private readonly model = 'kooker-codex',
    private readonly url = '/kooker/api/v1/ai/route/chat',
  ) {}

  async reply(systemPrompt: string, history: ChatMessage[], question: string): Promise<string> {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.text })),
      { role: 'user', content: question },
    ]
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${this.token}`, 'X-Kooker-Tier': 'external' },
      body: JSON.stringify({ model: this.model, messages, max_tokens: 220, temperature: 0.8 }),
    })
    if (!res.ok) throw new Error(`inference HTTP ${res.status}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('empty inference response')
    return content.trim()
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

/** Holds the colony's bots and drives the border-patrol conversation. */
export class BotService {
  bots: Bot[] = []
  constructor(private readonly adapter: BotAdapter) {}

  get source(): string {
    return this.adapter.source
  }

  /** Boot a bot for an approved household, inject its life history, and get its first reply. */
  async create(h: Household): Promise<Bot> {
    const existing = this.bots.find((b) => b.householdId === h.id)
    if (existing && existing.status !== 'deleted') return existing
    const lead = h.members[0]
    const bot: Bot = {
      id: `bot_${h.id}`,
      householdId: h.id,
      name: lead?.name ?? h.displayName,
      source: this.adapter.source,
      status: 'booting',
      lifeHistory: composeLifeHistory(h),
      messages: [],
    }
    this.bots.push(bot)
    const q = PATROL_QUESTIONS[0]!
    bot.messages.push({ role: 'patrol', text: q, ts: Date.now() })
    try {
      const reply = await this.adapter.reply(bot.lifeHistory, [], q)
      bot.messages.push({ role: 'bot', text: reply, ts: Date.now() })
      bot.status = 'awake'
    } catch (e) {
      bot.status = 'error'
      bot.error = String((e as Error)?.message ?? e)
    }
    return bot
  }

  /** Ask an awake bot another (possibly scripted) question; the reply is the bot's own. */
  async ask(botId: string, question: string): Promise<void> {
    const bot = this.bots.find((b) => b.id === botId)
    if (!bot || bot.status === 'deleted') return
    bot.messages.push({ role: 'patrol', text: question, ts: Date.now() })
    try {
      const reply = await this.adapter.reply(bot.lifeHistory, bot.messages.slice(0, -1), question)
      bot.messages.push({ role: 'bot', text: reply, ts: Date.now() })
      bot.status = 'awake'
    } catch (e) {
      bot.messages.push({ role: 'bot', text: `(could not reach inference: ${String((e as Error)?.message ?? e)})`, ts: Date.now() })
    }
  }

  /** Reset support: forget a bot (the real adapter will also delete it server-side later). */
  remove(botId: string): void {
    const bot = this.bots.find((b) => b.id === botId)
    if (bot) bot.status = 'deleted'
  }

  forHousehold(householdId: string): Bot | undefined {
    return this.bots.find((b) => b.householdId === householdId && b.status !== 'deleted')
  }
}
