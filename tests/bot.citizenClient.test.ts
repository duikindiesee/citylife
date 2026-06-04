import { describe, it, expect } from 'vitest'
import { CitizenGatewayAdapter, hasReachablePod, type FetchLike, type FetchLikeResponse } from '../src/colony/bot/citizenClient'
import type { ChatMessage } from '../src/colony/bots'

function jsonResponse(body: unknown, status = 200): FetchLikeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

const history: ChatMessage[] = [
  { speaker: 'patrol', text: 'Welcome. State your name.', ts: 1 },
  { speaker: 'newcomer', text: 'I am Pim.', ts: 2 },
]

describe('CitizenGatewayAdapter — spec 074 pod client', () => {
  it('posts to the OpenAI-compatible endpoint on the pod gateway with the bearer token', async () => {
    let seenUrl = ''
    let seenInit: RequestInit | undefined
    const fetchImpl: FetchLike = async (url, init) => {
      seenUrl = url
      seenInit = init
      return jsonResponse({ choices: [{ message: { content: 'I am Pim, glad to be here.' } }] })
    }
    const a = new CitizenGatewayAdapter('http://bot-pim.citylife-citizens.svc.cluster.local:18789/gateway', 'tok', 'hermes-openai-gpt-5.5', fetchImpl)
    const reply = await a.generate('You are Pim.', history, 'newcomer')
    expect(reply).toBe('I am Pim, glad to be here.')
    expect(seenUrl).toBe('http://bot-pim.citylife-citizens.svc.cluster.local:18789/gateway/v1/chat/completions')
    const headers = seenInit!.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
    const sent = JSON.parse(String(seenInit!.body))
    expect(sent.model).toBe('hermes-openai-gpt-5.5')
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'You are Pim.' })
    // the newcomer is speaking, so their own past line is assistant and the patrol line is user
    expect(sent.messages.some((m: { role: string }) => m.role === 'assistant')).toBe(true)
  })

  it('throws a clear fallback error on a 403 (the expected browser-blocked dev case)', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: 'forbidden' }, 403)
    const a = new CitizenGatewayAdapter('http://bot-x.citylife-citizens.svc.cluster.local:18789/gateway', undefined, 'hermes-openai-gpt-5.5', fetchImpl)
    await expect(a.generate('sys', history, 'newcomer')).rejects.toThrow(/403/)
  })

  it('throws when the network is unreachable, so the runtime can fall back', async () => {
    const fetchImpl: FetchLike = async () => { throw new Error('Failed to fetch') }
    const a = new CitizenGatewayAdapter('http://unreachable:18789', undefined, 'hermes-openai-gpt-5.5', fetchImpl)
    await expect(a.generate('sys', history, 'newcomer')).rejects.toThrow(/unreachable/)
  })

  it('throws on an empty reply rather than returning a blank', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ choices: [{ message: { content: '   ' } }] })
    const a = new CitizenGatewayAdapter('http://bot-y:18789', undefined, 'hermes-openai-gpt-5.5', fetchImpl)
    await expect(a.generate('sys', history, 'newcomer')).rejects.toThrow(/empty/)
  })

  it('omits the Authorization header when no token is given', async () => {
    let headers: Record<string, string> = {}
    const fetchImpl: FetchLike = async (_u, init) => { headers = init.headers as Record<string, string>; return jsonResponse({ choices: [{ message: { content: 'hi' } }] }) }
    const a = new CitizenGatewayAdapter('http://bot-z:18789', undefined, 'hermes-openai-gpt-5.5', fetchImpl)
    await a.generate('sys', history, 'patrol')
    expect(headers.Authorization).toBeUndefined()
  })

  it('hasReachablePod gates on a real http(s) url', () => {
    expect(hasReachablePod('http://bot-a.citylife-citizens.svc.cluster.local:18789/gateway')).toBe(true)
    expect(hasReachablePod('https://example.test')).toBe(true)
    expect(hasReachablePod(undefined)).toBe(false)
    expect(hasReachablePod('')).toBe(false)
    expect(hasReachablePod('not-a-url')).toBe(false)
  })
})
