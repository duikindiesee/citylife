import { useEffect, useReducer, useRef, useState } from 'react'
import { ColonyRuntime, type ColonyUiState } from '../runtime'
import type { CameraPreset, ViewMode } from '../render/PlanetRenderer'
import { RadioPanel } from './RadioPanel'
import './colony.css'

const pad = (n: number) => String(n).padStart(2, '0')

function useRuntime(): ColonyRuntime {
  const ref = useRef<ColonyRuntime | null>(null)
  if (!ref.current) {
    ref.current = new ColonyRuntime()
    ;(window as unknown as { __colony: ColonyRuntime }).__colony = ref.current
  }
  const [, force] = useReducer((x) => x + 1, 0)
  useEffect(() => ref.current!.subscribe(force), [])
  return ref.current!
}

const PRESETS: { id: CameraPreset; label: string }[] = [
  { id: 'street', label: 'Street' },
  { id: 'district', label: 'District' },
  { id: 'planet', label: 'Planet' },
]
const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'biome', label: 'Biome' },
  { id: 'buildable', label: 'Buildable' },
  { id: 'elevation', label: 'Elevation' },
]

export function ColonyApp() {
  const runtime = useRuntime()
  const hostRef = useRef<HTMLDivElement>(null)
  const ui: ColonyUiState = runtime.getUiState()
  const [borderOpen, setBorderOpen] = useState(false)
  const addNewcomer = () => { void runtime.addNewcomer() }
  const decide = (id: string, d: 'approve' | 'hold' | 'decline') => { void runtime.decideNewcomer(id, d) }

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    runtime.start(el)
    requestAnimationFrame(() => runtime.resize()) // re-measure after first layout
    const ro = new ResizeObserver(() => runtime.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      runtime.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keyboard shortcuts: Space pauses, 1/2/3 switch camera, Z toggles zoning. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      switch (e.code) {
        case 'Space': e.preventDefault(); runtime.setPaused(!runtime.getUiState().paused); break
        case 'Digit1': runtime.setPreset('street'); break
        case 'Digit2': runtime.setPreset('district'); break
        case 'Digit3': runtime.setPreset('planet'); break
        case 'KeyZ': runtime.toggleZones(); break
        default: return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pct = Math.round(ui.power.pct * 100)
  const battColor = ui.power.pct > 0.4 ? '#39d353' : ui.power.pct > 0.15 ? '#e6c84d' : '#e0584d'

  return (
    <div className="colony">
      <div className="canvas-host" ref={hostRef} />

      <header className="topbar">
        <div className="brand">
          City<span>Life</span> <em>· Colony</em>
        </div>
        <div className="clock">
          Sol {ui.clock.day} · {pad(ui.clock.hour)}:{pad(ui.clock.minute)} <span>{ui.clock.isDay ? '☀' : '☾'}</span>
        </div>
        <div className="spacer" />
        <div className="group">
          <button className={ui.paused ? 'on' : ''} onClick={() => runtime.setPaused(!ui.paused)}>
            {ui.paused ? '▶' : '❚❚'}
          </button>
          {[1, 2, 5].map((s) => (
            <button key={s} className={!ui.paused && ui.speed === s ? 'on' : ''} onClick={() => { runtime.setPaused(false); runtime.setSpeed(s) }}>
              {s}×
            </button>
          ))}
        </div>
        <div className="group">
          {PRESETS.map((p) => (
            <button key={p.id} className={ui.preset === p.id ? 'on' : ''} onClick={() => runtime.setPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="group">
          {VIEWS.map((v) => (
            <button key={v.id} className={ui.view === v.id ? 'on' : ''} onClick={() => runtime.setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="group">
          <button className={ui.zonesVisible ? 'on' : ''} onClick={() => runtime.toggleZones()} title="Show or hide the city-plan zoning overlay">
            Zones
          </button>
        </div>
        <div className="group">
          <button
            title="Save a PNG snapshot of the city"
            onClick={() => {
              const url = runtime.snapshot()
              if (!url) return
              const a = document.createElement('a')
              a.href = url
              a.download = `citylife-sol${ui.clock.day}-${String(ui.clock.hour).padStart(2, '0')}${String(ui.clock.minute).padStart(2, '0')}.png`
              a.click()
            }}
          >
            📷
          </button>
        </div>
      </header>

      <aside className="hud">
        <h2>{ui.name}</h2>
        <div className="row"><span>Site</span><b>{ui.biome}</b></div>
        <div className="row"><span>Colonists</span><b>{ui.colonists} / {ui.colony.capacity}</b></div>
        <div className="row"><span>Homes watered</span><b style={{ color: ui.colony.watered < 60 ? '#e6c84d' : undefined }}>{ui.colony.watered}%</b></div>
        <div className="row"><span>Homes fed</span><b style={{ color: ui.colony.provisioned < 60 ? '#e6c84d' : undefined }}>{ui.colony.provisioned}%</b></div>
        <div className="row"><span>Homes healthy</span><b style={{ color: ui.colony.health < 60 ? '#e6c84d' : undefined }}>{ui.colony.health}%</b></div>
        <div className="row"><span>Free labour</span><b style={{ color: ui.colony.freeLabour === 0 ? '#e6c84d' : undefined }}>{ui.colony.freeLabour}</b></div>
        <div className="row"><span>Jobs</span><b>{ui.colony.jobs} · {ui.colony.employed}% empl.</b></div>
        <div className="row"><span>Pollution</span><b style={{ color: ui.colony.pollution > 60 ? '#e0584d' : ui.colony.pollution > 25 ? '#e6c84d' : undefined }}>{ui.colony.pollution}</b></div>
        <div className="row"><span>Treasury</span><b>${ui.colony.treasury.toLocaleString()}</b></div>
        <div className="row"><span>Materials</span><b style={{ color: ui.colony.materials < 6 ? '#e0584d' : undefined }}>{ui.colony.materials}</b></div>
        <div className="row"><span>Components</span><b>{ui.colony.components}</b></div>
        <div className="row"><span>Food</span><b style={{ color: ui.colony.food === 0 ? '#e6c84d' : undefined }}>{ui.colony.food}</b></div>
        <div className="row"><span>Homes</span><b>{`T1×${ui.colony.tiers[0]} · T2×${ui.colony.tiers[1]} · T3×${ui.colony.tiers[2]}`}</b></div>
        <div className="row"><span>Buildings</span><b>{ui.colony.buildings}</b></div>
        <div className="row"><span>Building</span><b>{ui.colony.building}</b></div>
        <div className="row"><span>Solar</span><b>{ui.power.solarW.toFixed(1)} kW</b></div>
        <div className="row"><span>Load</span><b style={{ color: ui.power.loadW > ui.power.solarW ? '#e0584d' : undefined }}>{ui.power.loadW.toFixed(1)} kW</b></div>
        <div className="batt">
          <div className="batt-head"><span>Battery</span><b>{pct}%</b></div>
          <div className="bar"><div style={{ width: `${pct}%`, background: battColor }} /></div>
        </div>
        <div className="row" style={{ marginTop: 10 }}><span>Settlers</span><b>{ui.settlers.count}</b></div>
        {ui.settlers.recent.length > 0 && (
          <div className="settler-list">{ui.settlers.recent.map((s) => <span key={s.id} className="chip">#{s.id} {s.name}</span>)}</div>
        )}
        <button className="immigbtn" onClick={() => setBorderOpen(true)}>🛂 Border Control</button>

        <h2 style={{ marginTop: 18 }}>Kookerverse Bank</h2>
        <div className="row"><span>Deposits</span><b>{ui.bank.currency}{ui.bank.deposits.toLocaleString()}</b></div>
        <div className="row"><span>Accounts</span><b>{ui.bank.accounts}</b></div>
        {ui.bank.recent.length > 0 && (
          <div className="ledger">{ui.bank.recent.map((tx) => <div key={tx.id} className="ledger-row">{tx.memo}</div>)}</div>
        )}
      </aside>

      <div className="hint">
        Phase A · A dropship has landed. Solar + lithium battery are your only power.
        Use <b>Planet / District / Street</b> to zoom, and the view toggles to read the land.
        <br /><span className="hint-keys"><b>Space</b> pause · <b>1/2/3</b> camera · <b>Z</b> zoning</span>
      </div>

      <RadioPanel runtime={runtime} radio={ui.radio} tv={ui.tv} />

      {borderOpen && (
        <div className="modal-overlay" onClick={() => setBorderOpen(false)}>
          <div className="modal border-modal" onClick={(e) => e.stopPropagation()}>
            <h3>🛂 Border Control — {ui.name}</h3>
            <p>The border is the only way onto the planet. Review each family and decide who may settle.</p>
            {ui.border.botSource === 'mock'
              ? <p className="border-note">🤖 Bot replies are <b>mock stand-ins</b> — set <code>VITE_CITYLIFE_PAT</code> in <code>.env.local</code> for true Hermes responses.</p>
              : <p className="border-note">🧠 <b>Border Patrol Bot</b> (the city brain) and the newcomers are live from kooker inference ({ui.border.botSource}).</p>}
            {ui.border.plots.length > 0 && (
              <details className="plan-panel">
                <summary>📐 City Plan — {ui.border.plots.filter((p) => !p.assignedTo).length} of {ui.border.plots.length} plots available</summary>
                <div className="plan-list">
                  {ui.border.plots.map((p) => (
                    <div key={p.id} className={`plan-row plan-${p.assignedTo ? 'taken' : 'free'}`}>
                      <b>{p.name}</b> <span className="plan-vibe">{p.vibe}</span>
                      <span className="plan-desc">{p.description}</span>
                      <span className="plan-status">{p.assignedTo ? 'allocated' : 'available'}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <button className="primary border-add" onClick={addNewcomer}>+ A family arrives at the border</button>
            {ui.border.households.length === 0 && <div className="border-empty">No arrivals yet — receive a family to begin.</div>}
            <div className="border-list">
              {[...ui.border.households].reverse().map((h) => (
                <div key={h.id} className={`hh-card hh-${h.status}`}>
                  <div className="hh-head"><b>{h.displayName}</b><span className={`hh-status hh-status-${h.status}`}>{h.status}</span></div>
                  <div className="hh-meta">{h.membersSummary} · from {h.originLocation} · brings <b>{ui.bank.currency}{h.holdings.toLocaleString()}</b></div>
                  <div className="hh-members">{h.members.map((m, i) => <span key={i} className="hh-chip">{m.name} · {m.age} · {m.occupation}</span>)}</div>
                  <div className="hh-lead">“{h.lead.migrationMotivation}.”</div>
                  {(h.status === 'triage' || h.status === 'held') && (
                    <div className="hh-actions">
                      <button className="hh-approve" onClick={() => decide(h.id, 'approve')}>✅ Approve</button>
                      <button className="hh-hold" onClick={() => decide(h.id, 'hold')}>⏸ Hold</button>
                      <button className="hh-decline" onClick={() => decide(h.id, 'decline')}>⛔ Decline</button>
                    </div>
                  )}
                  {h.status === 'approved' && (() => {
                    const bot = ui.border.bots.find((b) => b.householdId === h.id)
                    if (!bot) return null
                    return (
                      <div className="bot-chat">
                        <div className="bot-head">🤖 {bot.name} <span className="bot-src">{bot.source}</span> <span className="bot-st">{bot.status}</span></div>
                        {bot.status === 'booting' && <div className="bot-booting">booting bot &amp; injecting life history…</div>}
                        <div className="bot-thread">
                          {bot.messages.map((m, i) => {
                            if (m.speaker === 'narrator') return <div key={i} className="bot-narrator">{m.text}</div>
                            const isPatrol = m.speaker === 'patrol'
                            return (
                              <div key={i} className={`bot-msg bot-${m.speaker}`}>
                                <b>{isPatrol ? '🛂 Border Patrol' : `🤖 ${bot.name}`}</b> {m.text}
                              </div>
                            )
                          })}
                        </div>
                        {bot.plotId && (() => {
                          const plot = ui.border.plots.find((p) => p.id === bot.plotId)
                          if (!plot) return null
                          return <div className="bot-plot">🏷️ Plot: <b>{plot.name}</b> · <i>{plot.vibe}</i> · {plot.description}</div>
                        })()}
                        {bot.status === 'error' && <div className="bot-err">⚠ {bot.error}</div>}
                        {(bot.status === 'awake' || bot.status === 'error') && (
                          <div className="bot-asks">
                            {['Why have you come to our colony?', 'What work can your family do here?', 'Will you follow our colony rules?'].map((q) => (
                              <button key={q} className="bot-ask" onClick={() => runtime.askBot(bot.id, q)}>{q}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="hh-decline" onClick={() => { if (window.confirm('Reset the Kookerverse? This clears all settlers, the bank, and bots, and starts fresh.')) { runtime.reset(); window.location.reload() } }}>↺ Reset game</button>
              <button className="primary" onClick={() => setBorderOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
