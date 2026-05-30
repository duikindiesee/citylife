import { useEffect, useReducer, useRef } from 'react'
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
        <button className="buildbtn" onClick={() => runtime.buildNow()}>+ Build habitat</button>
      </aside>

      <div className="hint">
        Phase A · A dropship has landed. Solar + lithium battery are your only power.
        Use <b>Planet / District / Street</b> to zoom, and the view toggles to read the land.
      </div>
    </div>
  )
}
