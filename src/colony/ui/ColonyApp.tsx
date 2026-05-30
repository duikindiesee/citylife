import { useEffect, useReducer, useRef, useState } from 'react'
import { ColonyRuntime, type ColonyUiState } from '../runtime'
import type { CameraPreset, ViewMode } from '../render/PlanetRenderer'
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
  const [immig, setImmig] = useState<{ open: boolean; name: string; busy: boolean; reg: { card: { id: number; name: string }; holdings: number; settlement: number } | null; error: string | null }>({ open: false, name: '', busy: false, reg: null, error: null })
  const openImmig = () => setImmig({ open: true, name: runtime.rollName(), busy: false, reg: null, error: null })
  const doRegister = async () => {
    setImmig((s) => ({ ...s, busy: true, error: null }))
    try {
      const reg = await runtime.registerSettler(immig.name.trim() || runtime.rollName())
      setImmig((s) => ({ ...s, busy: false, reg }))
    } catch (e) {
      setImmig((s) => ({ ...s, busy: false, error: String((e as Error)?.message ?? e) }))
    }
  }

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
      </header>

      <aside className="hud">
        <h2>{ui.name}</h2>
        <div className="row"><span>Site</span><b>{ui.biome}</b></div>
        <div className="row"><span>Colonists</span><b>{ui.colonists}</b></div>
        <div className="row"><span>Jobs</span><b>{ui.colony.jobs} · {ui.colony.employed}% empl.</b></div>
        <div className="row"><span>Pollution</span><b style={{ color: ui.colony.pollution > 60 ? '#e0584d' : ui.colony.pollution > 25 ? '#e6c84d' : undefined }}>{ui.colony.pollution}</b></div>
        <div className="row"><span>Treasury</span><b>${ui.colony.treasury.toLocaleString()}</b></div>
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
        <button className="immigbtn" onClick={openImmig}>🛂 Border security — welcome a settler</button>

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
      </div>

      {immig.open && (
        <div className="modal-overlay" onClick={() => setImmig((s) => ({ ...s, open: false }))}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {!immig.reg ? (
              <>
                <h3>A settler wants to move to {ui.name} 🛸</h3>
                <p>They'll register for a <b>KOOKER card</b> in your real kooker system, and we'll build them a unique home.</p>
                <div className="name-row">
                  <input value={immig.name} onChange={(e) => setImmig((s) => ({ ...s, name: e.target.value }))} disabled={immig.busy} placeholder="settler name" />
                  <button title="roll a name" onClick={() => setImmig((s) => ({ ...s, name: runtime.rollName() }))} disabled={immig.busy}>🎲</button>
                </div>
                {immig.error && <div className="err">⚠ {immig.error}</div>}
                <div className="modal-actions">
                  <button onClick={() => setImmig((s) => ({ ...s, open: false }))} disabled={immig.busy}>Cancel</button>
                  <button className="primary" onClick={doRegister} disabled={immig.busy || !immig.name.trim()}>{immig.busy ? '…registering' : 'Issue KOOKER card & build home'}</button>
                </div>
              </>
            ) : (
              <>
                <h3>Welcome to {ui.name}, {immig.reg.card.name}! 🎉</h3>
                <div className="kcard">
                  <div className="kcard-label">KOOKER CARD</div>
                  <div className="kcard-id">#{immig.reg.card.id}</div>
                  <div className="kcard-name">{immig.reg.card.name}</div>
                </div>
                <p>Registered in kooker. Deposited <b>{ui.bank.currency}{immig.reg.holdings.toLocaleString()}</b> into the Kookerverse Bank, and paid <b>{ui.bank.currency}{immig.reg.settlement.toLocaleString()}</b> into the colony for their house.</p>
                <div className="modal-actions">
                  <button onClick={openImmig}>Welcome another</button>
                  <button className="primary" onClick={() => setImmig((s) => ({ ...s, open: false }))}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
