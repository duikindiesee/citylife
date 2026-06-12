import { describe, it, expect, beforeEach } from 'vitest'
import { createProfile, addPost, follow, safeProfile, POST_CAP, AUTHORED_PER_SOL } from '../src/colony/social/kookerbook'
import { loadKookerbookLocal, saveProfileLocal, clearKookerbookLocal, mergeKookerbook } from '../src/colony/bot/kookerbookStore'

// Spec 082 P0 — Kookerbook model + store: screened profiles, capped sol-stamped timelines, and the
// blueprintStore-style persistence contract (tampering and unsafe strings never get through).

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v)
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
}
beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage()
})

function joe() {
  return createProfile({
    citizenId: 'citizen_joe',
    alias: 'Joe the Crab',
    bio: 'Founder of Landing One.',
    plotId: 'lot_4',
    address: 'Driftwood Cove',
    kind: 'crab',
  })!
}

describe('kookerbook — the bot social network model (spec 082 P0)', () => {
  it('creates a screened profile; unsafe alias or bio is refused', () => {
    expect(joe()).toBeTruthy()
    expect(createProfile({ citizenId: 'x', alias: 'secret token man', bio: 'hi' })).toBeNull()
    expect(createProfile({ citizenId: 'x', alias: 'Fine Name', bio: 'my password is here' })).toBeNull()
  })

  it('posts are sol-stamped, newest first, and screened', () => {
    let p = joe()
    p = addPost(p, { sol: 1, kind: 'event', text: 'Joe arrived in Landing One.' })!
    p = addPost(p, { sol: 2, kind: 'narration', text: 'The tide is kind this morning.' })!
    expect(p.posts[0]!.sol).toBe(2)
    expect(p.posts[1]!.sol).toBe(1)
    expect(addPost(p, { sol: 3, kind: 'event', text: 'leaking a token here' })).toBeNull()
  })

  it('caps the timeline at POST_CAP, evicting the oldest', () => {
    let p = joe()
    for (let i = 0; i < POST_CAP + 10; i++) p = addPost(p, { sol: i, kind: 'event', text: `day ${i} in the colony` })!
    expect(p.posts.length).toBe(POST_CAP)
    expect(p.posts[0]!.sol).toBe(POST_CAP + 9) // newest kept
  })

  it('rate-caps authored posts per sol; events are uncapped', () => {
    let p = joe()
    for (let i = 0; i < AUTHORED_PER_SOL; i++) p = addPost(p, { sol: 5, kind: 'authored', text: `thought number ${i}` })!
    expect(addPost(p, { sol: 5, kind: 'authored', text: 'one too many' })).toBeNull()
    expect(addPost(p, { sol: 6, kind: 'authored', text: 'new sol, new thought' })).toBeTruthy()
    expect(addPost(p, { sol: 5, kind: 'event', text: 'events still flow' })).toBeTruthy()
  })

  it('follow is idempotent and never self', () => {
    let p = joe()
    p = follow(p, 'citizen_juno')
    p = follow(p, 'citizen_juno')
    p = follow(p, 'citizen_joe')
    expect(p.follows).toEqual(['citizen_juno'])
  })

  it('safeProfile rebuilds stored data through the screened path — tampered posts are dropped', () => {
    let p = joe()
    p = addPost(p, { sol: 1, kind: 'event', text: 'a fine day' })!
    const tampered = JSON.parse(JSON.stringify(p)) as Record<string, unknown>
    ;(tampered['posts'] as unknown[]).unshift({ id: 'x', sol: 2, seq: 0, kind: 'event', text: 'stole a secret key today' })
    const back = safeProfile(tampered)!
    expect(back.posts.some((q) => q.text.includes('secret'))).toBe(false)
    expect(back.posts.some((q) => q.text === 'a fine day')).toBe(true)
  })

  it('store round-trips profiles locally and merge prefers the backend copy', () => {
    let p = joe()
    p = addPost(p, { sol: 1, kind: 'event', text: 'moved in by the lighthouse' })!
    expect(saveProfileLocal(p)).toBe(true)
    const local = loadKookerbookLocal()
    expect(local['citizen_joe']!.alias).toBe('Joe the Crab')
    expect(local['citizen_joe']!.posts[0]!.text).toBe('moved in by the lighthouse')
    const backendCopy = addPost(local['citizen_joe']!, { sol: 2, kind: 'event', text: 'cross device truth' })!
    const merged = mergeKookerbook(local, { citizen_joe: backendCopy })
    expect(merged['citizen_joe']!.posts[0]!.text).toBe('cross device truth')
    clearKookerbookLocal()
    expect(loadKookerbookLocal()).toEqual({})
  })
})
