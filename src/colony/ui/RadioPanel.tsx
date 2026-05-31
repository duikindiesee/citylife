import { useState } from 'react'
import { channelEmbedUrl, currentChannel, anyConfigured, type RadioState } from '../radio'
import type { ColonyRuntime } from '../runtime'

/** Low Power Radio tray — bottom-right toggle that expands to a Now Playing panel.
 *  When a channel is selected, a hidden YouTube iframe streams the licensed playlist. */
export function RadioPanel({ runtime, radio, tv }: { runtime: ColonyRuntime; radio: RadioState; tv: boolean }) {
  const [open, setOpen] = useState(false)
  const ch = currentChannel(radio)
  const url = ch ? channelEmbedUrl(ch, { autoplay: true, muted: radio.muted }) : ''
  const wired = anyConfigured(radio)

  return (
    <>
      <div className={`radio-tray ${open ? 'is-open' : ''} ${tv ? 'is-tv' : ''}`}>
        <button className="radio-toggle" onClick={() => setOpen((v) => !v)} title="Low Power Radio">
          {radio.on ? '📻' : '📻 ̲'}
          <span className="radio-toggle-label">{radio.on && ch ? ch.name : 'Radio'}</span>
        </button>
        {open && (
          <div className="radio-panel">
            <div className="radio-head">
              <b>📻 Low Power Radio</b>
              <span className="radio-sub">a tiny always-on station on the roof</span>
            </div>

            {!wired && (
              <div className="radio-note">
                Set <code>VITE_RADIO_PLAYLIST_DRIVE</code> (and friends) in <code>.env.local</code> to a YouTube playlist id to start broadcasting. YouTube handles licensing for embedded playback — see <code>docs/research/2026-05-31-low-power-radio.md</code>.
              </div>
            )}

            <div className="radio-channels">
              {radio.channels.map((c) => (
                <button key={c.id} className={`radio-channel ${radio.channelId === c.id ? 'on' : ''} ${c.ref ? '' : 'empty'}`} onClick={() => runtime.tuneRadio(c.id)} disabled={!c.ref} title={c.ref ? c.vibe : 'no playlist configured'}>
                  <b>{c.name}</b>
                  <span>{c.vibe}</span>
                </button>
              ))}
            </div>

            <div className="radio-controls">
              <button onClick={() => runtime.toggleRadio()}>{radio.on ? '⏸ Pause' : '▶ Play'}</button>
              <button onClick={() => runtime.toggleRadioMuted()}>{radio.muted ? '🔇 Muted' : '🔈 Sound'}</button>
              <button onClick={() => runtime.toggleTv()}>{tv ? '📺 Exit TV' : '📺 TV mode'}</button>
            </div>

            {radio.ads.length > 0 && (
              <div className="radio-ads">
                <div className="radio-ads-head">📣 Sponsor reads (in-game ad market)</div>
                {radio.ads.slice(0, 4).map((a) => (
                  <div key={a.id} className="radio-ad">
                    <b>{a.sponsor}</b> — {a.copy}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {radio.on && url && (
        <iframe
          className="radio-iframe"
          src={url}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="origin-when-cross-origin"
          title="Low Power Radio"
        />
      )}

      {tv && ch && radio.on && (
        <div className="tv-now-playing">
          <span className="tv-tag">LOW POWER RADIO</span>
          <b>{ch.name}</b>
          <span>{ch.vibe}</span>
        </div>
      )}
    </>
  )
}
