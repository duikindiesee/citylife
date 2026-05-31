import { describe, it, expect } from 'vitest'
import { BotService, MockBotAdapter, composeLifeHistory, PATROL_QUESTIONS, type BotAdapter } from '../src/colony/bots'
import { generateHousehold } from '../src/colony/newcomers'

const h = generateHousehold(7)

class FixedAdapter implements BotAdapter {
  readonly source = 'fixed'
  async reply(): Promise<string> {
    return 'Hello, officer.'
  }
}
class BrokenAdapter implements BotAdapter {
  readonly source = 'broken'
  async reply(): Promise<string> {
    throw new Error('inference down')
  }
}

describe('composeLifeHistory', () => {
  it('embeds the household identity, origin, and motivation', () => {
    const s = composeLifeHistory(h)
    expect(s).toContain(h.members[0]!.name)
    expect(s).toContain(h.originLocation)
    expect(s).toContain(h.lead.migrationMotivation)
  })
})

describe('MockBotAdapter', () => {
  it('varies its stand-in reply by question', async () => {
    const a = new MockBotAdapter()
    const sys = composeLifeHistory(h)
    expect((await a.reply(sys, [], 'state your name')).length).toBeGreaterThan(0)
    expect(await a.reply(sys, [], 'why have you come?')).toMatch(/fresh start|life/i)
  })
})

describe('BotService', () => {
  it('boots a bot with the first patrol question and a reply', async () => {
    const svc = new BotService(new FixedAdapter())
    const bot = await svc.create(h)
    expect(bot.status).toBe('awake')
    expect(bot.messages[0]).toMatchObject({ role: 'patrol', text: PATROL_QUESTIONS[0] })
    expect(bot.messages[1]).toMatchObject({ role: 'bot', text: 'Hello, officer.' })
    expect(svc.forHousehold(h.id)?.id).toBe(bot.id)
  })

  it('is idempotent per household', async () => {
    const svc = new BotService(new FixedAdapter())
    const a = await svc.create(h)
    const b = await svc.create(h)
    expect(a).toBe(b)
    expect(svc.bots).toHaveLength(1)
  })

  it('appends the question and the reply on ask', async () => {
    const svc = new BotService(new FixedAdapter())
    const bot = await svc.create(h)
    await svc.ask(bot.id, 'What work can your family do?')
    expect(bot.messages).toHaveLength(4)
    expect(bot.messages[2]).toMatchObject({ role: 'patrol', text: 'What work can your family do?' })
    expect(bot.messages[3]!.role).toBe('bot')
  })

  it('marks error when the adapter fails (so the UI can show it)', async () => {
    const svc = new BotService(new BrokenAdapter())
    const bot = await svc.create(h)
    expect(bot.status).toBe('error')
    expect(bot.error).toContain('inference down')
  })

  it('remove marks the bot deleted (reset support)', async () => {
    const svc = new BotService(new FixedAdapter())
    const bot = await svc.create(h)
    svc.remove(bot.id)
    expect(svc.forHousehold(h.id)).toBeUndefined()
  })
})
