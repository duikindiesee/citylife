import { describe, it, expect } from 'vitest'
import {
  createRadio,
  tuneTo,
  toggleOn,
  toggleMuted,
  spinHouseAd,
  channelEmbedUrl,
  currentChannel,
  anyConfigured,
  DEFAULT_CHANNELS,
  type RadioChannel,
} from '../src/colony/radio'

describe('Low Power Radio state', () => {
  it('starts off with no current channel', () => {
    const r = createRadio()
    expect(r.on).toBe(false)
    expect(r.channelId).toBeNull()
  })

  it('toggleOn picks the first default channel when nothing is selected', () => {
    const r = toggleOn(createRadio())
    expect(r.on).toBe(true)
    expect(r.channelId).toBe(DEFAULT_CHANNELS[0]!.id)
  })

  it('toggleOn off → on → off is idempotent on the channel', () => {
    const a = toggleOn(toggleOn(createRadio())) // on then off
    expect(a.on).toBe(false)
    const b = toggleOn(a) // back on, same channel as before
    expect(b.on).toBe(true)
    expect(b.channelId).toBe(DEFAULT_CHANNELS[0]!.id)
  })

  it('tuneTo switches channel and turns on', () => {
    const r = tuneTo(createRadio(), 'coast')
    expect(r.on).toBe(true)
    expect(r.channelId).toBe('coast')
    expect(currentChannel(r)?.name).toBe('Coast')
  })

  it('tuneTo ignores unknown channel ids', () => {
    const before = createRadio()
    const after = tuneTo(before, 'fake')
    expect(after).toBe(before)
  })

  it('toggleMuted flips the muted flag', () => {
    const r = toggleMuted(createRadio())
    expect(r.muted).toBe(true)
    expect(toggleMuted(r).muted).toBe(false)
  })

  it('spinHouseAd queues a sponsored line, newest first, capped at 8', () => {
    let r = createRadio()
    for (let i = 0; i < 12; i++) r = spinHouseAd(r, 1000 + i)
    expect(r.ads.length).toBe(8)
    expect(r.ads[0]!.ts).toBeGreaterThan(r.ads[1]!.ts)
    expect(r.ads.every((a) => a.sponsor && a.copy)).toBe(true)
  })

  it('channelEmbedUrl builds a YouTube playlist URL when a playlist ref is set', () => {
    const ch: RadioChannel = { id: 'x', name: 'X', vibe: 'v', kind: 'youtube-playlist', ref: 'PLABC123' }
    const url = channelEmbedUrl(ch, { autoplay: true, muted: false })
    expect(url).toContain('youtube.com/embed/videoseries')
    expect(url).toContain('list=PLABC123')
    expect(url).toContain('autoplay=1')
    expect(url).toContain('enablejsapi=1')
  })

  it('channelEmbedUrl builds a single-video URL with playlist=ref so loop works', () => {
    const ch: RadioChannel = { id: 'x', name: 'X', vibe: 'v', kind: 'youtube-video', ref: 'dQw4w9WgXcQ' }
    const url = channelEmbedUrl(ch, { autoplay: false, muted: true })
    expect(url).toContain('youtube.com/embed/dQw4w9WgXcQ')
    expect(url).toContain('playlist=dQw4w9WgXcQ')
    expect(url).toContain('loop=1')
  })

  it('channelEmbedUrl returns empty when no ref is configured', () => {
    const ch: RadioChannel = { id: 'x', name: 'X', vibe: 'v', kind: 'youtube-playlist', ref: '' }
    expect(channelEmbedUrl(ch)).toBe('')
  })

  it('anyConfigured tells whether at least one channel has a playlist set', () => {
    expect(anyConfigured(createRadio())).toBe(false)
    const wired = { ...createRadio(), channels: [{ ...DEFAULT_CHANNELS[0]!, ref: 'PLABC' }, ...DEFAULT_CHANNELS.slice(1)] }
    expect(anyConfigured(wired)).toBe(true)
  })
})
