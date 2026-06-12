import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ColonyRuntime, type ColonyUiState } from '../runtime'
import type { CameraPreset, ViewMode } from '../render/PlanetRenderer'
import type { HouseholdOverrides } from '../newcomers'
import { AuthClient } from '../authClient'

// Suggestions for the citizen-profession field (free text is still allowed).
const PROFESSION_SUGGESTIONS = ['Hydroponics tech', 'Welder', 'Medic', 'Teacher', 'Surveyor', 'Reactor tech', 'Logistics clerk', 'Cook', 'Botanist', 'Mechanic', 'Geologist', 'Pilot', 'Artist', 'Engineer', 'Farmer', 'Trader']
import { RadioPanel } from './RadioPanel'
import { FirstPersonPanel } from './FirstPersonPanel'
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
  const [newCitizen, setNewCitizen] = useState({ name: '', age: '', profession: '' })
  const composing = !!(newCitizen.name.trim() || newCitizen.profession.trim() || newCitizen.age.trim())
  const addNewcomer = () => {
    const o: HouseholdOverrides = {}
    if (newCitizen.name.trim()) o.name = newCitizen.name.trim()
    if (newCitizen.profession.trim()) o.profession = newCitizen.profession.trim()
    const ageNum = parseInt(newCitizen.age, 10)
    if (Number.isFinite(ageNum) && ageNum > 0) o.age = ageNum
    void runtime.addNewcomer(Object.keys(o).length ? o : undefined)
    setNewCitizen({ name: '', age: '', profession: '' })
  }
  const decide = (id: string, d: 'approve' | 'hold' | 'decline') => { void runtime.decideNewcomer(id, d) }
  // P1 — tell the runtime who is logged in, so it can mark the operator's own avatar + gate the step-into.
  const auth = useMemo(() => new AuthClient(), [])
  useEffect(() => { runtime.setOperatorName(auth.operator?.id ?? null) }, [auth, runtime])
  // Spec 085 P1 — once mounted (the AuthGate has signed the player in), drain any real-ledger sync
  // moves left queued from a prior session. New moves drain themselves on notice().
  useEffect(() => { runtime.flushLedgerSync() }, [runtime])

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
  // When stepped into a bot (first person), W/A/S/D or the arrow keys WALK it around.
  useEffect(() => {
    const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
    // 'KeyW' -> 'w', 'ArrowUp' -> 'arrowup' (runtime.setFpKey lowercases + maps these to fwd/back/left/right)
    const norm = (code: string) => (code.startsWith('Arrow') ? code.toLowerCase() : code.slice(3))
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (runtime.getUiState().firstPerson.active) {
        // Continuous WASD / arrow-key locomotion — hold to walk the bot, release to stop (keyup handler).
        if (MOVE.has(e.code)) {
          e.preventDefault()
          runtime.setFpKey(norm(e.code), true)
          return
        }
        // Additive first-person actions: N narrates what the citizen sees, Esc steps back out.
        if (e.code === 'KeyN') { e.preventDefault(); void runtime.narrate(); return }
        if (e.code === 'Escape') { runtime.exitFirstPerson(); return }
      }
      switch (e.code) {
        case 'Space': e.preventDefault(); runtime.setPaused(!runtime.getUiState().paused); break
        case 'Digit1': runtime.setPreset('street'); break
        case 'Digit2': runtime.setPreset('district'); break
        case 'Digit3': runtime.setPreset('planet'); break
        case 'KeyZ': runtime.toggleZones(); break
        case 'Escape': if (runtime.getUiState().firstPerson.active) runtime.exitFirstPerson(); break
        default: return
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (MOVE.has(e.code)) runtime.setFpKey(norm(e.code), false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pct = Math.round(ui.power.pct * 100)
  const battColor = ui.power.pct > 0.4 ? '#39d353' : ui.power.pct > 0.15 ? '#e6c84d' : '#e0584d'

  return (
    <div className="colony">
      <div className="canvas-host" ref={hostRef} />
      {ui.firstPerson.active && (
        <div style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 50, display: 'flex', gap: 10, alignItems: 'center', background: 'rgba(10,14,28,0.78)', border: '1px solid #2a3550', borderRadius: 10, padding: '8px 14px', backdropFilter: 'blur(4px)' }}>
          <span style={{ color: '#a0d4f0', fontSize: 13 }}>👁 Seeing through <b>{ui.firstPerson.citizenName ?? 'a citizen'}</b>&apos;s eyes</span>
          <span style={{ color: '#6f86b8', fontSize: 12 }}><b>W</b>/<b>S</b> walk · <b>A</b>/<b>D</b> turn · <b>Esc</b> exit</span>
          <button style={{ padding: '3px 12px' }} onClick={() => runtime.exitFirstPerson()}>Exit first person</button>
        </div>
      )}
      <FirstPersonPanel runtime={runtime} fp={ui.firstPerson} />

      <header className="topbar">
        <div className="brand">
          City<span>Life</span> <em>· Colony</em>
        </div>
        <div className="clock">
          Sol {ui.clock.sol} · {pad(ui.clock.hour)}:{pad(ui.clock.minute)} <span>{ui.clock.isDay ? '☀' : '☾'}</span>
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
          <button className={ui.zonesVisible ? 'on' : ''} disabled={!ui.colony.surveyed} onClick={() => runtime.toggleZones()} title={ui.colony.surveyed ? 'Liveability map — tint homes cyan (thriving) to amber (starved)' : 'Build a Civic Pulse Survey Office to unlock the liveability map'}>
            Liveability
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
              a.download = `citylife-sol${ui.clock.sol}-${String(ui.clock.hour).padStart(2, '0')}${String(ui.clock.minute).padStart(2, '0')}.png`
              a.click()
            }}
          >
            📷
          </button>
        </div>
      </header>

      <aside className="hud">
        <h2>{ui.name}</h2>
        {ui.courier.on && ui.courier.headline && (
          <div className="courier-ticker" title="The Kookerverse Courier — the colony's own news, from the Broadcast Mast" style={{ fontSize: 12, color: '#6fd0ff', fontStyle: 'italic', lineHeight: 1.35, margin: '2px 0 10px', borderLeft: '2px solid #6fd0ff', paddingLeft: 8 }}>📻 {ui.courier.headline}</div>
        )}
        <div className="row"><span>Site</span><b>{ui.biome}</b></div>
        <div className="row"><span>Colonists</span><b>{ui.colonists} / {ui.colony.capacity}</b></div>
        <div className="row"><span>Homes watered</span><b style={{ color: ui.colony.watered < 60 ? '#e6c84d' : undefined }}>{ui.colony.watered}%</b></div>
        <div className="row"><span>Homes fed</span><b style={{ color: ui.colony.provisioned < 60 ? '#e6c84d' : undefined }}>{ui.colony.provisioned}%</b></div>
        <div className="row"><span>Homes healthy</span><b style={{ color: ui.colony.health < 60 ? '#e6c84d' : undefined }}>{ui.colony.health}%</b></div>
        <div className="row"><span>Homes cultured</span><b style={{ color: ui.colony.culture < 40 || !ui.colony.cultureFuelled ? '#e6c84d' : undefined }} title={!ui.colony.cultureFuelled ? 'Theatres are out of reels — culture pull halved' : undefined}>{ui.colony.culture}%{!ui.colony.cultureFuelled ? ' · reels out' : ''}</b></div>
        {ui.colony.housewares > 0 && <div className="row"><span>Homes stocked</span><b style={{ color: ui.colony.housewares < 60 ? '#e6c84d' : undefined }} title="Housewares Market coverage — manufactured wares delivered to homes. The top tier needs luxury wares (reels).">{ui.colony.housewares}%</b></div>}
        {ui.colony.smog > 0 && <div className="row"><span>Homes smoggy</span><b style={{ color: '#e0844d' }} title="Homes near mines/foundries breathe smog — build Air Scrubber Gardens to clear it">{ui.colony.smog}%</b></div>}
        <div className="row"><span>Liveability</span><b style={{ color: ui.colony.liveability < 40 ? '#e6c84d' : undefined }}>{ui.colony.surveyed ? `${ui.colony.liveability}%` : '— locked'}</b></div>
        <div className="row"><span>Free labour</span><b style={{ color: ui.colony.freeLabour === 0 ? '#e6c84d' : undefined }}>{ui.colony.freeLabour}</b></div>
        <div className="row"><span>Jobs</span><b>{ui.colony.jobs} · {ui.colony.employed}% empl.</b></div>
        {ui.colony.commute.demand > 0 && <div className="row"><span>Commute</span><b style={{ color: ui.colony.commute.congested ? '#e0844d' : undefined }} title={ui.colony.commute.congested ? 'Congested — workers arrive late, all production slows. Build a Skybridge Transit Depot.' : 'Commute capacity: workers vs transit'}>{ui.colony.commute.demand}/{ui.colony.commute.capacity}{ui.colony.commute.congested ? ' ⚠' : ''}</b></div>}
        {ui.colony.maintenance.worst > 0 && <div className="row"><span>Upkeep</span><b style={{ color: ui.colony.maintenance.needing > 0 ? '#e0844d' : undefined }} title={ui.colony.maintenance.needing > 0 ? `${ui.colony.maintenance.needing} worn building(s) losing output — build a Maintenance Shed. ${ui.colony.maintenance.sheds} shed(s) running.` : `Worst building wear; ${ui.colony.maintenance.sheds} Maintenance Shed(s) running.`}>{ui.colony.maintenance.worst}% worn{ui.colony.maintenance.needing > 0 ? ` · ${ui.colony.maintenance.needing} ⚠` : ''}</b></div>}
        {(ui.colony.incidents.active > 0 || ui.colony.incidents.capacity > 0) && <div className="row"><span>Incidents</span><b style={{ color: ui.colony.incidents.active > ui.colony.incidents.capacity ? '#e0584d' : ui.colony.incidents.active > 0 ? '#e0844d' : undefined }} title={ui.colony.incidents.active > 0 ? `${ui.colony.incidents.active} active emergency — unanswered incidents leave the building worn-out and destroy stored goods. Bellhouse capacity ${ui.colony.incidents.capacity}.` : `No active incidents. Emergency Bellhouse response capacity ${ui.colony.incidents.capacity}.`}>{ui.colony.incidents.active > 0 ? `${ui.colony.incidents.active} active` : 'clear'} · cap {ui.colony.incidents.capacity}{ui.colony.incidents.active > ui.colony.incidents.capacity ? ' ⚠' : ''}</b></div>}
        {(ui.colony.fever.level > 0 || ui.colony.fever.contained) && <div className="row"><span>Outbreak</span><b style={{ color: ui.colony.fever.level >= 20 ? '#e0584d' : ui.colony.fever.level > 0 ? '#e0844d' : undefined }} title={ui.colony.fever.level > 0 ? `${ui.colony.fever.level}% of the colony is unwell${ui.colony.fever.contained ? ' — a Fever Watch is containing it.' : ' — build a Fever Watch Post to contain the spread.'}` : 'No outbreak. A Fever Watch Post stands ready.'}>{ui.colony.fever.level > 0 ? `${ui.colony.fever.level}% ill` : 'clear'}{ui.colony.fever.contained ? ' · watched' : ui.colony.fever.level >= 20 ? ' ⚠' : ''}</b></div>}
        {(ui.colony.order.unrest > 0 || ui.colony.order.warded) && <div className="row"><span>Unrest</span><b style={{ color: ui.colony.order.unrest >= 20 ? '#e0584d' : ui.colony.order.unrest > 0 ? '#e0844d' : undefined }} title={ui.colony.order.unrest > 0 ? `${ui.colony.order.unrest}% disorder — idle, squeezed blocks refuse the levy and slow the work${ui.colony.order.warded ? '. A Ward Post is on patrol.' : ' — build a Ward Post, ease the levy, or put people to work.'}` : 'Orderly. A Ward Post keeps the peace.'}>{ui.colony.order.unrest > 0 ? `${ui.colony.order.unrest}% disorder` : 'orderly'}{ui.colony.order.warded ? ' · warded' : ui.colony.order.unrest >= 20 ? ' ⚠' : ''}</b></div>}
        <div className="row"><span>Pollution</span><b style={{ color: ui.colony.pollution > 60 ? '#e0584d' : ui.colony.pollution > 25 ? '#e6c84d' : undefined }}>{ui.colony.pollution}</b></div>
        <div className="row"><span>Treasury</span><b>${ui.colony.treasury.toLocaleString()}</b></div>
        {ui.colony.arrears.office && ui.colony.arrears.debt > 0 && <div className="row"><span>Debt</span><b style={{ color: ui.colony.arrears.unmanaged ? '#e0584d' : ui.colony.arrears.strain ? '#e0844d' : '#e6c84d' }} title={ui.colony.arrears.unmanaged ? `Unmanaged arrears — the Comptroller's Office is unstaffed and interest is doubling. Debt ${ui.colony.arrears.debt} of ${ui.colony.arrears.ceiling}. Staff it and pay down.` : ui.colony.arrears.strain ? `Arrears strain — debt past half the ceiling. Settlers slow and unrest creeps until it is paid down. Debt ${ui.colony.arrears.debt} of ${ui.colony.arrears.ceiling}.` : `The colony is running a managed deficit. Debt ${ui.colony.arrears.debt} of ${ui.colony.arrears.ceiling}; interest accrues each payday.`}>-${ui.colony.arrears.debt.toLocaleString()}{ui.colony.arrears.unmanaged ? ' ⚠ unmanaged' : ui.colony.arrears.strain ? ' ⚠' : ''}</b></div>}
        {ui.colony.trade > 0 && <div className="row"><span>Trade</span><b style={{ color: '#5fd0a0' }}>+${ui.colony.trade.toLocaleString()}/day</b></div>}
        {ui.colony.levy.active && <div className="row"><span>Levy</span><span style={{ display: 'flex', gap: 4 }}>{(['low', 'normal', 'high'] as const).map((r) => <button key={r} className={ui.colony.levy.rate === r ? 'on' : ''} style={{ padding: '1px 6px', fontSize: 11, textTransform: 'capitalize' }} onClick={() => runtime.setLevy(r)} title={r === 'low' ? 'Gentle dues — slower treasury, faster immigration' : r === 'high' ? 'Hard levy — fatter treasury, settlers slow to a trickle' : 'Steady — today’s economy'}>{r}</button>)}</span></div>}
        {ui.colony.wage.active && <div className="row"><span>Wage</span><span style={{ display: 'flex', gap: 4 }}>{(['low', 'standard', 'generous'] as const).map((r) => <button key={r} className={ui.colony.wage.rate === r ? 'on' : ''} style={{ padding: '1px 5px', fontSize: 11 }} onClick={() => runtime.setWage(r)} title={r === 'low' ? 'Cheap payroll, but feeds unrest and slows settlers' : r === 'generous' ? 'Costly payroll, but eases unrest and draws settlers faster' : 'Fair pay — a steady workforce'}>{r === 'low' ? 'Low' : r === 'standard' ? 'Std' : 'Gen'}</button>)}</span></div>}
        {ui.colony.wage.active && ui.colony.wage.payroll > 0 && <div className="row"><span>Payroll</span><b style={{ color: '#e0844d' }} title="The colony's daily wage bill — employed workers times the wage rate.">-${ui.colony.wage.payroll.toLocaleString()}/day</b></div>}
        {ui.colony.roster.active && <div className="row"><span>Labour</span><span style={{ display: 'flex', gap: 4 }}>{(['essentials', 'balanced', 'industry'] as const).map((m) => <button key={m} className={ui.colony.roster.mode === m ? 'on' : ''} style={{ padding: '1px 5px', fontSize: 10 }} onClick={() => runtime.setRosterMode(m)} title={m === 'essentials' ? 'Essentials first — under a labour shortage the Roster Office fills Food, Safety and Services before Industry and Trade' : m === 'industry' ? 'Industry first — under a shortage it fills Industry, Logistics and Trade before Food and Services' : 'Balanced — the even split across all sectors (today’s behaviour)'}>{m === 'essentials' ? 'Ess' : m === 'industry' ? 'Ind' : 'Bal'}</button>)}</span></div>}
        {(ui.colony.feast.active || ui.colony.feast.canCall) && <div className="row"><span>Feast</span>{ui.colony.feast.active ? <b style={{ color: '#f0b840' }} title="A Civic Feast is on — unrest eases and settlers arrive faster while it runs.">🎉 {ui.colony.feast.daysLeft}d left</b> : <button style={{ padding: '1px 8px', fontSize: 11 }} onClick={() => runtime.callFeast()} title="Fund a Civic Feast — spend treasury + rations + housewares to lift morale and ease unrest for a few days.">Hold feast</button>}</div>}
        {ui.colony.liaison.active && <div className="row"><span>Standing</span><b style={{ color: ui.colony.liaison.standing < 0.3 ? '#e0584d' : ui.colony.liaison.standing > 0.7 ? '#5fd0a0' : undefined }} title="Kookerverse Standing — fulfil Civic Requests to raise it. High standing draws settlers; low standing repels them and breeds unrest.">{Math.round(ui.colony.liaison.standing * 100)}%</b></div>}
        {ui.colony.liaison.request && <div className="row"><span>Request</span>{ui.colony.liaison.canFulfil ? <button style={{ padding: '1px 6px', fontSize: 11, textTransform: 'capitalize' }} onClick={() => runtime.fulfillRequest()} title={`The Kookerverse asks for ${ui.colony.liaison.request.amount} ${ui.colony.liaison.request.good} (${ui.colony.liaison.request.daysLeft}d left). Fulfil to raise standing.`}>Send {ui.colony.liaison.request.amount} {ui.colony.liaison.request.good}</button> : <b style={{ color: '#e0844d' }} title="Not enough goods to fulfil this Civic Request — standing falls if it lapses.">{ui.colony.liaison.request.amount} {ui.colony.liaison.request.good} · {ui.colony.liaison.request.daysLeft}d ⚠</b>}</div>}
        {(ui.colony.spire.stage > 0 || ui.colony.spire.building) && <div className="row"><span>Spire</span><b style={{ color: ui.colony.spire.complete ? '#f0b840' : '#8fc8e0' }} title="The Horizon Spire — a grand multi-stage monument. When all four stages stand, it permanently lifts standing, immigration, and order.">{ui.colony.spire.complete ? '★ complete' : `Stage ${ui.colony.spire.stage}/${ui.colony.spire.total}${ui.colony.spire.building ? ` · ${Math.round(ui.colony.spire.progress * 100)}%` : ''}`}</b></div>}
        {ui.colony.front.established && <div className="row"><span>Cloudsea</span><b style={{ color: ui.colony.front.incoming ? (ui.colony.front.braced ? '#5fd0a0' : '#e0584d') : ui.colony.front.watching ? undefined : '#e0844d' }} title={ui.colony.front.incoming ? (ui.colony.front.braced ? 'A Cloudsea Front is incoming — the Stormwatch has sounded the Brace Order; damage will be slight.' : 'A Cloudsea Front is incoming and NO Stormwatch is braced — build/staff a Stormwatch Shelter or take heavy damage.') : ui.colony.front.watching ? `The Stormwatch scans the cloudsea — next front in ~${ui.colony.front.timerDays}d.` : `No Stormwatch on watch — the next front (~${ui.colony.front.timerDays}d) will hit unbraced. Build a Stormwatch Shelter.`}>{ui.colony.front.incoming ? (ui.colony.front.braced ? 'front · braced' : 'FRONT ⚠') : `${ui.colony.front.watching ? 'watched' : 'unwatched'} · ${ui.colony.front.timerDays}d`}</b></div>}
        {ui.colony.founders.active && <div className="row"><span>Founders</span><b style={{ color: '#e8c862' }} title={`The Founders' Hall seats the Living Roster — ${ui.colony.founders.seated} founders, each a named colonist with a post. Settlers arrive faster, standing earns more, and unrest eases.${ui.colony.founders.notable ? ` ${ui.colony.founders.notable.name}, ${ui.colony.founders.notable.role}, keeps the Hall.` : ''}`}>★ {ui.colony.founders.seated} seated{ui.colony.founders.notable ? ` · ${ui.colony.founders.notable.name}` : ''}</b></div>}
        {ui.colony.prosperity.active && <div className="row"><span>Prosperity</span><b style={{ color: ui.colony.prosperity.recognised ? '#f0b840' : ui.colony.prosperity.rank >= 3 ? '#5fd0a0' : ui.colony.prosperity.rank <= 1 ? '#e0844d' : undefined }} title={`The Census Hall reads the whole colony — liveability, housing tiers, employment, Kookerverse standing and Treasury solvency — as one Prosperity score (${ui.colony.prosperity.score}/100). ${ui.colony.prosperity.recognised ? 'At the top rank, Landing One is a Recognised Sky-Colony.' : 'High prosperity draws settlers a little faster.'}`}>{ui.colony.prosperity.rankName} · {ui.colony.prosperity.score}{ui.colony.prosperity.recognised ? ' ★' : ''}</b></div>}
        {ui.colony.education.schools > 0 && <div className="row"><span>Education</span><b style={{ color: ui.colony.education.coverage >= 60 ? '#d98f5a' : ui.colony.education.coverage > 0 ? undefined : '#e0844d' }} title="Little Schoolrooms teach the homes within reach — schooled homes draw settlers a little faster and let the Skillhouse Academy train skilled workers quicker.">{ui.colony.education.coverage}%</b></div>}
        {ui.colony.solace.shrines > 0 && <div className="row"><span>Solace</span><b style={{ color: ui.colony.solace.coverage >= 60 ? '#b6a8e0' : ui.colony.solace.coverage > 0 ? undefined : '#e0844d' }} title="Mooring Shrines carry Solace to nearby homes — consoled homes draw settlers a little faster and shed unrest more slowly. Solace dims if the shrines run out of linen.">{ui.colony.solace.coverage}%{ui.colony.solace.coverage === 0 ? ' (dim)' : ''}</b></div>}
        {ui.colony.departures.pressure > 0 && <div className="row"><span>Departures</span><b style={{ color: ui.colony.departures.atRisk ? '#e0584d' : '#e0844d' }} title={ui.colony.departures.atRisk ? `Households are leaving the failing decks — ${ui.colony.departures.cause}. Restore water, food, health, order or wages to drain the pressure before more pack up.` : `Some strain in the homes (${ui.colony.departures.cause}); keep the services up and it settles before anyone leaves.`}>{ui.colony.departures.pressure}%{ui.colony.departures.atRisk ? ' ⚠ leaving' : ''}</b></div>}
        {ui.colony.confidence.slowed && <div className="row"><span>Confidence</span><b style={{ color: ui.colony.confidence.halted ? '#e0584d' : '#e0844d' }} title={ui.colony.confidence.halted ? 'Settler Confidence has collapsed — word of the colony has soured, and immigration has halted even with beds empty. Calm the unrest, clear the arrears, pay the wages and feed the homes to win it back.' : 'Settler Confidence is low — disorder, debt, stingy wages or empty rations have slowed how fast newcomers risk the crossing. Set the colony right and arrivals speed back up.'}>{Math.round(ui.colony.confidence.confidence * 100)}%{ui.colony.confidence.halted ? ' ⚠ halted' : ' · slowed'}</b></div>}
        {ui.colony.calendar.office && <div className="row"><span>Calendar</span><b style={{ color: '#d9c089' }} title="The Founding Calendar — a staffed Calendar Office counts the colony's age. Every year-turn is Founders' Day, a small free morale lift (unlike the council-funded Civic Feast). This is the colony's own birthday.">Year {ui.colony.calendar.year}, Month {ui.colony.calendar.month} · Founders&apos; Day in {ui.colony.calendar.monthsToFounders}mo</b></div>}
        {ui.colony.season.active && <div className="row"><span>Season</span><b style={{ color: ui.colony.season.modifier > 0 ? '#7fc08a' : ui.colony.season.modifier < 0 ? '#d59a6a' : '#c8c0a0' }} title="Mild Seasons + Seasonal Solar — once the colony keeps a calendar, the skyfarms yield and the solar farms both follow the year (more in Bloom/Highsun, less in Grey/Frost). Each averages to no annual change, so store the surplus food and battery charge from the good months, and lean on wind turbines, to ride out the lean ones.">{ui.colony.season.name} {ui.colony.season.modifier > 0 ? '+' : ''}{ui.colony.season.modifier}% food · {ui.colony.season.solarModifier > 0 ? '+' : ''}{ui.colony.season.solarModifier}% sun</b></div>}
        {(ui.colony.ledger.hall || ui.colony.ledger.turning) && <div className="row"><span>Long Ledger</span><b style={{ color: ui.colony.ledger.lastPassings > 0 ? '#9a8fb0' : '#8a9ab0' }} title="The Long Ledger — colonists live a long span, then a gentle natural turnover begins, capped so it can never out-pace the colony's births and arrivals. A Hall of Names records the elders and comforts the colony after a loss. Keep births and newcomers flowing to renew across the generations.">{ui.colony.ledger.turning ? `turning${ui.colony.ledger.lastPassings > 0 ? ` · ${ui.colony.ledger.lastPassings} remembered` : ''}` : `settled (${ui.colony.ledger.onset - ui.colony.ledger.ageYears}yr to turn)`}{ui.colony.ledger.hall ? ' · Hall' : ''}</b></div>}
        {ui.colony.births.growing && <div className="row"><span>Children</span><b style={{ color: '#8ad0a8' }} title="Household Births — stable mid-tier homes that are watered, fed and on a calm deck slowly raise children. Each child eats half a colonist's rations and gives no labour until, with a home to live in, it grows up into a free colonist. Wreck the rations or spike unrest and the families stop raising.">{ui.colony.births.children}{ui.colony.births.homes > 0 ? ` · ${ui.colony.births.homes} homes` : ''}</b></div>}
        {(ui.colony.footprint.camp || ui.colony.footprint.claims > 0) && <div className="row"><span>Footprint</span><b style={{ color: ui.colony.footprint.atEdge ? '#8ec0d8' : '#c8a25a' }} title="Build footprint — a staffed Survey Camp runs Outer Claims, each pushing the colony's build radius one deck-ring further onto the island. Each claim takes days of survey work and spends materials + components; it waits if the colony cannot pay.">radius {ui.colony.footprint.radius} · {ui.colony.footprint.claims}/{ui.colony.footprint.maxClaims}{ui.colony.footprint.atEdge ? ' (island edge)' : ` · claim ${Math.round(ui.colony.footprint.progress * 100)}%`}</b></div>}
        {ui.colony.veins.mines > 0 && ui.colony.veins.poorest < 1 && <div className="row"><span>Ore veins</span><b style={{ color: ui.colony.veins.poorest <= 0.25 ? '#e0584d' : ui.colony.veins.poorest < 0.6 ? '#e0844d' : '#caa86a' }} title="Vein Ledger — every mine digs a finite vein. A fresh pit runs at full for months, then fades by bands to a 25% trickle as its vein runs down. This shows the poorest pit's output; claim new ground (Survey Camp) and sink a fresh shaft when the old veins thin.">poorest {Math.round(ui.colony.veins.poorest * 100)}%</b></div>}
        {ui.colony.imports.active && <div className="row"><span>Import</span><span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{([['Off', null], ['Mat', 'materials'], ['Comp', 'components'], ['Food', 'food'], ['Linen', 'linen'], ['Reels', 'reels']] as const).map(([label, good]) => <button key={label} className={ui.colony.imports.order === good ? 'on' : ''} style={{ padding: '1px 4px', fontSize: 10 }} onClick={() => runtime.setImportOrder(good)} title={good ? `Place a standing order to buy ${good} at a premium — the Import Office spends treasury to land it in storage` : 'Stop importing — clear the standing order'}>{label}</button>)}</span></div>}
        {ui.colony.imports.active && ui.colony.imports.order && ui.colony.imports.dailySpend > 0 && <div className="row"><span>Buying</span><b style={{ color: '#e0844d' }} title={`The Import Office is landing about ${ui.colony.imports.perDay} ${ui.colony.imports.order} per day, at a premium over the Exchange price.`}>-${ui.colony.imports.dailySpend.toLocaleString()}/day</b></div>}
        {ui.colony.storage.fill >= 50 && <div className="row"><span>Storage</span><b style={{ color: ui.colony.storage.full ? '#e0584d' : ui.colony.storage.fill >= 90 ? '#e0844d' : undefined }} title={ui.colony.storage.full ? `Storage full (${ui.colony.storage.tightest}) — overflow is lost overboard. Build a Storehouse Platform.` : `Fullest store: ${ui.colony.storage.tightest} at ${ui.colony.storage.fill}% of cap`}>{ui.colony.storage.fill}% full{ui.colony.storage.full ? ' ⚠' : ''}</b></div>}
        <div className="row"><span>Materials</span><b style={{ color: ui.colony.materials < 6 ? '#e0584d' : undefined }}>{ui.colony.materials}</b></div>
        <div className="row"><span>Components</span><b>{ui.colony.components}</b></div>
        <div className="row"><span>Food</span><b style={{ color: ui.colony.food === 0 ? '#e6c84d' : undefined }}>{ui.colony.food}</b></div>
        {ui.colony.reels > 0 && <div className="row"><span>Reels</span><b style={{ color: '#9a8fe0' }}>{ui.colony.reels}</b></div>}
        {ui.colony.fibre > 0 && <div className="row"><span>Fibre</span><b style={{ color: '#9ec0a0' }} title="Skyflax fibre — gathered from the rims by Flax Skimmer Docks, woven into linen by Weaveries.">{ui.colony.fibre}</b></div>}
        {ui.colony.linen > 0 && <div className="row"><span>Linen</span><b style={{ color: '#d8c8a0' }} title="Linen bolts — the top housing tier needs it, and clinics use it as bandage cloth (more during a fever).">{ui.colony.linen}</b></div>}
        {ui.colony.water.cisterns > 0 && <div className="row"><span>Water</span><b style={{ color: ui.colony.water.dry ? '#e0584d' : '#5aa6d8' }} title="Stored water — Mist Condenser Cisterns fill the tank and the Water Hubs draw it to serve homes. A dry tank (lost power, a storm, or too few cisterns) weakens water coverage and breeds fever + unrest.">{ui.colony.water.stored}/{ui.colony.water.cap}{ui.colony.water.dry ? ' ⚠ dry' : ''}</b></div>}
        {ui.colony.tools.cribs > 0 && <div className="row"><span>Tools</span><b style={{ color: ui.colony.tools.short ? '#e0584d' : '#d59a4a' }} title="Tool-kits — Tool Cribs turn components into kits, and the mines, workshops, skyfarms, fitters and turbines draw them as they work. A drained rack (too few cribs, no spare components, or a brownout) weakens every tooled workplace together toward a half-speed floor.">{ui.colony.tools.stored}/{ui.colony.tools.cap}{ui.colony.tools.short ? ' ⚠ short' : ''}</b></div>}
        {(ui.colony.security.active || ui.colony.security.nooks > 0) && <div className="row"><span>Watch</span><b style={{ color: ui.colony.security.active ? '#d8a64a' : '#7faf7a' }} title="The Watch Nook — a rich, populous, unguarded colony loses a small trickle of treasury to petty theft (never enough to bankrupt it, and none during a storm or shortage). Staff a Watch Nook to cut it; a second stops it entirely.">{ui.colony.security.nooks > 0 ? `${ui.colony.security.nooks} nook${ui.colony.security.nooks > 1 ? 's' : ''}` : 'unguarded'}{ui.colony.security.active ? ` · -${ui.colony.security.lossPerDay}/day` : ui.colony.security.nooks > 0 ? ' · secure' : ''}</b></div>}
        {(ui.colony.waste.harmful || ui.colony.waste.posts > 0) && <div className="row"><span>Waste</span><b style={{ color: ui.colony.waste.fevered ? '#e0584d' : ui.colony.waste.harmful ? '#d59a6a' : '#8aa07e' }} title="Household Waste — the everyday filth a growing population makes (the air-scrubbers only clean industrial smog). Harmless below 25%, but above it desirability slips, and above 50% it breeds fever. Staff Sanitation Posts to clear it on their rounds.">{ui.colony.waste.level}%{ui.colony.waste.fevered ? ' ⚠ breeding fever' : ui.colony.waste.harmful ? ' · filthy' : ''}{ui.colony.waste.posts > 0 ? ` · ${ui.colony.waste.posts} post${ui.colony.waste.posts > 1 ? 's' : ''}` : ''}</b></div>}
        {ui.colony.rimfish.docks > 0 && <div className="row"><span>Rimfish</span><b style={{ color: ui.colony.rimfish.stock > 0 ? '#4fb0a6' : '#7a9a96' }} title="Rimfish — a second food netted from the cloudsea rim by Cloudsea Net Docks, stored apart from skygrain. When on hand it covers a portion of the colony's meals and spares skygrain, so the grain lasts longer through a lean Frost season, and the varied table draws settlers a little faster. It is not subject to the skyfarm seasons — that is the buffer.">{ui.colony.rimfish.stock}{ui.colony.rimfish.varied ? ' · varied table' : ''}</b></div>}
        {ui.colony.festival.board && <div className="row"><span>Festival</span><b style={{ color: ui.colony.festival.active ? '#e2a93f' : '#9a8a5a' }} title="The Highsun Lantern Supper — a Festival Board lays a once-a-year supper from the colony's own stores (greens + fish + linen + materials). A well-supplied supper grants Lantern Cheer: a lift to settler confidence for the month, a calmer colony, and a little standing with the wider Kookerverse. A thin year simply passes — no penalty.">{ui.colony.festival.active ? `Lantern Cheer +${ui.colony.festival.bonus} · ${ui.colony.festival.cheerDays}d` : 'awaiting Highsun'}</b></div>}
        {ui.colony.reclaim.plants > 0 && <div className="row"><span>Reclaim</span><b style={{ color: ui.colony.reclaim.active ? '#4fb0c0' : '#7a9aa0' }} title="Greywater Reclaimer — a staffed utility plant that treats a share of the colony's daily used water back into the tanks at a 2:1 loss. It runs on power (halves in a brownout), needs a little linen for filters, and idles when the tanks are nearly full. Not new water, just some of our own back — a steadier tank through storm and brownout weeks.">{ui.colony.reclaim.plants} plant{ui.colony.reclaim.plants > 1 ? 's' : ''}{ui.colony.reclaim.active ? ` · +${ui.colony.reclaim.perDay}/day` : ' · idle'}</b></div>}
        {ui.colony.fire.posts > 0 && <div className="row"><span>Fire</span><b style={{ color: ui.colony.fire.active > 0 ? '#e0584d' : !ui.colony.fire.watered ? '#d8a64a' : '#7faf7a' }} title="Fire-Watch — staffed Posts watch a fire district. Worn, packed, power-stressed buildings in the warm season slowly build fire risk; a staffed, watered Post drains it and puts out sparks. Let the tanks run dry or the crew leave and a fire spreads deck-to-deck and burns a building down. A maintained, well-watered colony never catches.">{ui.colony.fire.active > 0 ? `${ui.colony.fire.active} alight!` : `risk ${ui.colony.fire.risk}%`}{ui.colony.fire.watered ? '' : ' · dry'}</b></div>}
        {ui.colony.stalls.stalls > 0 && <div className="row"><span>Market</span><b style={{ color: ui.colony.stalls.open ? '#e0b34a' : '#9a8a5a' }} title="Market Stalls — the colony's own home market. Staffed stalls sell surplus linen and folios (above a reserve) to paid colonists, returning a little coin to the treasury each day. They never sell below the reserve, so they never rob the export trade, and custom dries up if wages fall into arrears.">{ui.colony.stalls.stalls} stall{ui.colony.stalls.stalls > 1 ? 's' : ''}{ui.colony.stalls.open ? ` · +${ui.colony.stalls.coinPerDay}/day` : ' · quiet'}</b></div>}
        {ui.colony.porter.sheds > 0 && <div className="row"><span>Porters</span><b style={{ color: ui.colony.porter.working ? '#c79a5a' : '#8a7a5a' }} title="Porter Sheds — the first building whose whole point is to let you SEE the economy. While staffed, porters run handcarts along the roads between buildings, and the colony's goods pile up in crates and sacks that grow when a store fills and shrink as it is used. It invents no new good and changes no number, it gives the economy a body on the island. No porter ever crosses open water.">{ui.colony.porter.sheds} shed{ui.colony.porter.sheds > 1 ? 's' : ''}{ui.colony.porter.working ? ` · ${ui.colony.porter.porters} carts` : ' · idle'}</b></div>}
        {ui.colony.avatar.foundries > 0 && <div className="row"><span>Avatar Foundry</span><b style={{ color: ui.colony.avatar.staffed ? '#9f86d8' : '#7a6e8a' }} title="The Avatar Foundry — the civic hall that mints a citizen avatar (a real Hermes pod in the kooker DMZ namespace, routed through kooker-service-ai) for each approved household, and gives the colony's first-person vision a home on the map. While staffed it can mint up to its capacity of citizen pods. The pod spawn and the kooker user live out-of-process, the Foundry is the in-world gate.">{ui.colony.avatar.foundries} foundry{ui.colony.avatar.staffed ? ` · mints up to ${ui.colony.avatar.capacity}` : ' · unstaffed'}</b></div>}
        {ui.citizens.count > 0 && <div className="row"><span>Kookerbook</span><b><a href="/kookerbook.html" target="_blank" rel="noreferrer" style={{ color: '#8fb6e8', textDecoration: 'none' }} title="The bot social network — every citizen has a profile page with their home and timeline">📘 open the Book</a></b></div>}
        {ui.citizens.count > 0 && <div className="row"><span>Citizens</span><b style={{ color: ui.citizens.awake > 0 ? '#a0d4f0' : '#7a8a9a' }} title={`Spec 074 — named residents allocated to a plot by the Border Patrol bot. ${ui.citizens.awake} have a live Hermes pod (DMZ namespace, kooker-service-ai routing). ${ui.citizens.list.slice(0,4).map(c => `${c.displayName} at ${c.plotName}`).join(' · ') || '(none yet)'}.`}>{ui.citizens.awake}/{ui.citizens.count} living{ui.citizens.list.length ? ` · ${ui.citizens.list.slice(0,2).map(c => c.displayName.split(' ')[0]).join(', ')}${ui.citizens.list.length > 2 ? '…' : ''}` : ''}</b></div>}
        {ui.citizens.count > 0 && !ui.firstPerson.active && <div className="row"><span>Step in</span><span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{ui.citizens.list.slice(0, 4).map((c) => <button key={c.id} className={c.id === ui.firstPerson.operatorCitizenId ? 'on' : ''} style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => runtime.enterFirstPerson(c.id)} title={c.id === ui.firstPerson.operatorCitizenId ? `This is your citizen — see the world through ${c.displayName}'s eyes` : `Step into ${c.displayName} for a first-person view`}>👁 {c.displayName.split(' ')[0]}{c.id === ui.firstPerson.operatorCitizenId ? ' (you)' : ''}</button>)}</span></div>}
        {ui.neighborhood.lots.length > 0 && <div className="row"><span>Homesteads</span><b style={{ color: '#9fd0a0' }} title="Spec 076 — large bordered HOMESTEAD parcels on a terrain-aware street: each fenced plot has a front yard, a set-back voxel house, a garden and a farm field. Assign a citizen to a homestead, build their house, or demolish it. Raze-and-evict also destroys the citizen and tears down their Hermes agent.">{ui.neighborhood.built} built · {ui.neighborhood.free} free</b></div>}
        {ui.neighborhood.lots.length > 0 && <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>{ui.neighborhood.lots.slice(0, 8).map((l) => {
          const firstFree = ui.citizens.list.find((c) => !ui.neighborhood.lots.some((x) => x.ownerId === c.id))
          return <div key={l.id} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11 }}>
            <span style={{ flex: 1, color: l.reserved ? '#e8a06a' : l.built ? '#cdbf9e' : l.owner ? '#c9a23a' : '#7a8a7a' }} title={l.reserved ? 'Founder plot — permanently reserved; never assigned to newcomers and protected from demolition.' : l.price !== null ? `Plot price ${l.price} ₭ (≈ R${l.priceZar?.toLocaleString()}) — bigger and shore-ward land costs more` : undefined}>{l.id.replace('lot_', 'Plot ')}{l.owner ? ` · ${l.reserved ? l.owner : l.owner.split(' ')[0]}` : !l.reserved && l.price !== null ? ` · ${l.price} ₭` : ' · free'}{l.reserved ? `${l.owner?.includes('Crab') ? ' 🦀' : ' 🛠️'} · Founder` : l.built ? ' 🏠' : ''}</span>
            {!l.ownerId && !l.reserved && firstFree && (() => {
              const canBuy = l.price !== null && (ui.citizens.wallets[firstFree.id] ?? 0) >= l.price
              return <button style={{ padding: '0 6px', fontSize: 10, color: canBuy ? '#8fd0a6' : '#7a6a5a', opacity: canBuy ? 1 : 0.5, cursor: canBuy ? 'pointer' : 'not-allowed' }} disabled={!canBuy} onClick={() => runtime.purchaseLot(firstFree.id, l.id)} title={canBuy ? `${firstFree.displayName} buys the deed for ${l.price} ₭ (≈ R${l.priceZar?.toLocaleString()})` : `${firstFree.displayName} can't afford this plot (wallet ${ui.citizens.wallets[firstFree.id] ?? 0} ₭, price ${l.price} ₭)`}>Buy {l.price} ₭</button>
            })()}
            {l.ownerId && <button style={{ padding: '0 6px', fontSize: 10, color: '#8fd0a6' }} onClick={() => runtime.openBuilder(l.id)} title={l.built ? 'Re-design this house in the House Builder — the current blueprint loads for editing and Accept rebuilds it' : 'Design this house in the House Builder — Accept stores the blueprint and raises the house'}>{l.built ? 'Re-design' : 'Design'}</button>}
            {l.ownerId && !l.built && !l.reserved && <button style={{ padding: '0 6px', fontSize: 10, color: '#d8a85a' }} onClick={() => runtime.commissionLot(l.id)} title="Hire Viw the Builder — the citizen dreams a home, Viw quotes, they haggle, and the agreed house rises. The deal lands on both their Kookerbook pages.">🛠️ Hire Viw</button>}
            {l.ownerId && !l.built && <button style={{ padding: '0 6px', fontSize: 10 }} onClick={() => runtime.buildHouse(l.id)} title={ui.neighborhood.buildHint}>Build</button>}
            {l.built && !l.reserved && <button style={{ padding: '0 6px', fontSize: 10 }} onClick={() => runtime.demolishLot(l.id)} title="Tear the house down, keep the citizen">Demolish</button>}
            {l.ownerId && !l.reserved && <button style={{ padding: '0 6px', fontSize: 10, color: '#e0584d' }} onClick={() => runtime.demolishLotAndCitizen(l.id)} title="Raze the home AND destroy the citizen and their Hermes agent">Evict</button>}
          </div>
        })}</div>}
        {ui.colony.gallery.galleries > 0 && <div className="row"><span>Gallery</span><b style={{ color: ui.colony.gallery.open ? '#e0a83c' : '#9a8a5a' }} title="The Skydeck Gallery — a viewing hall on the mooring deck that charges Kookerverse travellers to see the colony. Its visitor coin scales with how worth-seeing the colony actually is: its liveability, lifted by a finished Horizon Spire and by the Prosperity standing. It is the first income the colony earns purely for being a good place to live, so every coin spent on Planter Squares, clean homes and the monument finally pays its own way. Must be staffed to open.">{ui.colony.gallery.galleries} gallery{ui.colony.gallery.open ? ` · +${ui.colony.gallery.coinPerDay}/day` : ' · quiet'}</b></div>}
        {ui.colony.planters.squares > 0 && <div className="row"><span>Planters</span><b style={{ color: ui.colony.planters.blooming > 0 ? '#6fae5a' : '#7a8a6a' }} title="Planter Squares — the colony's first deliberate beauty. A Square in Bloom (tended by a groundskeeper and watered for most of the last ten days) lifts the desirability of homes around it, raising their liveability and drawing settlers to a colony that looks cared for. Untended or unwatered, it simply gives nothing.">{ui.colony.planters.blooming}/{ui.colony.planters.squares} blooming</b></div>}
        {ui.colony.labour.active && <div className="row"><span>Employment</span><b style={{ color: ui.colony.labour.dragging ? '#e0584d' : ui.colony.labour.unemployment > 0.1 ? '#d8a64a' : '#7faf7a' }} title="The Labour Registry Desk — it keeps an honest count of working-age idle hands. Chronic unemployment (above 10% held a week, or 20% held a fortnight) drags the Prosperity Rank a step or two, and clears once the colony sits below 5% for a week. Without a Registry, idleness never shows in the books.">{Math.round((1 - ui.colony.labour.unemployment) * 100)}% employed{ui.colony.labour.dragging ? ` · Prosperity -${ui.colony.labour.penalty}` : ''}</b></div>}
        {ui.colony.duskcap.cellars > 0 && <div className="row"><span>Duskcap</span><b style={{ color: ui.colony.duskcap.stock > 0 ? '#9a86a6' : '#7a6e82' }} title="Duskcap — a hardy third food grown by Fungus Cellars on the cool dark under-decks. It needs no sunlight, no season and barely any power, so it keeps coming through a lean Frost or a brownout when the greenhouses falter and the rim nets fall idle. The homes eat it as a third protein course after the fish, sparing skygrain, and it counts as a varied-table dish so a fish-short colony can still keep a Varied Diet.">{ui.colony.duskcap.stock} · {ui.colony.duskcap.cellars} cellar{ui.colony.duskcap.cellars > 1 ? 's' : ''}</b></div>}
        {ui.colony.bathhouse.baths > 0 && <div className="row"><span>Hygiene</span><b style={{ color: ui.colony.bathhouse.hygiene > 0.66 ? '#6fb6cf' : ui.colony.bathhouse.hygiene > 0.33 ? '#8aa6b0' : '#9a8a7a' }} title="Hygiene — Steam Bathhouses on the cistern line keep the colony clean. Hygiene rises with how many baths serve the head-count, how well they are staffed, whether the tanks hold water, and a little power to heat them. It is preventive: a clean colony slows how fast a fever takes hold (up to 40% at full hygiene), so fewer outbreaks start. It also earns the Clean-Home Standing (spec 070) — a washed colony draws settlers a touch better and its served homes climb the housing ladder a little faster. The baths draw stored water each day, a real customer for the cisterns and the reclaimer. It does not cure a fever already running — that stays the Fever Watch and the clinic.">{Math.round(ui.colony.bathhouse.hygiene * 100)}% · {ui.colony.bathhouse.baths} bath{ui.colony.bathhouse.baths > 1 ? 's' : ''}{ui.colony.bathhouse.drawBonus > 0 ? ` · +${Math.round(ui.colony.bathhouse.drawBonus * 100)}% draw` : ''}</b></div>}
        {ui.colony.library.libraries > 0 && <div className="row"><span>Library</span><b style={{ color: ui.colony.library.lending ? '#d6b85a' : '#9a8a5a' }} title="The Folio Library — a reading room stocked with the colony's own folios, lent to the homes as culture. It is folio-fed the way the holo-theatres are reel-fed, so it gives the homes a second way to stay cultured that needs no reels. It draws a folio a day from the stores to lend, the first domestic demand to compete with the export trade, so shipping every folio out leaves the shelves bare. Inert with no Library.">{ui.colony.library.libraries} librar{ui.colony.library.libraries > 1 ? 'ies' : 'y'}{ui.colony.library.lending ? ` · lending · -${ui.colony.library.foliosPerDay}/day` : ' · shelves bare'}</b></div>}
        {ui.colony.driedFish.racks > 0 && <div className="row"><span>Dried fish</span><b style={{ color: ui.colony.driedFish.stock > 0 ? '#9fb4a0' : '#7a8a7a' }} title="Dried rimfish — Rimfish Drying Racks dry the surplus fresh catch (above a working reserve) into a shelf-stable food, banked in the storehouses. The homes eat fresh rimfish first and fall back on this reserve, so fish stays on the table and the diet stays varied through a net-dock outage or a lean Frost. Drying loses weight: 8 dried per 12 fresh.">{ui.colony.driedFish.stock}/{ui.colony.driedFish.cap} · {ui.colony.driedFish.racks} rack{ui.colony.driedFish.racks > 1 ? 's' : ''}</b></div>}
        {ui.colony.diet.counters > 0 && <div className="row"><span>Diet</span><b style={{ color: ui.colony.diet.varied ? '#d98c5f' : '#9a8a7a' }} title="The Variety Ration Counter — homes fed both skyfarm greens and rimfish over the last 20 days earn a Varied Diet, which lifts the colony's draw on newcomers and helps served homes climb the ladder a touch faster. One counter serves 80 residents. With only one food on the table there is no bonus and no penalty; if a counter loses its crew or power the standing holds five days, then fades.">{ui.colony.diet.served} served{ui.colony.diet.varied ? ' · varied' : ' · one food'}</b></div>}
        {ui.colony.seed.lofts > 0 && <div className="row"><span>Seed</span><b style={{ color: ui.colony.seed.short ? '#e0584d' : '#7fae57' }} title="Seed-stock — Seed Lofts dry saved harvest (food, plus water once cisterns stand) into seed the skyfarms plant. A drained bin (too few lofts, thin food, or a brownout) cuts every skyfarm's yield together toward a half-harvest floor.">{ui.colony.seed.stored}/{ui.colony.seed.cap}{ui.colony.seed.short ? ' ⚠ short' : ''}</b></div>}
        {ui.colony.folios > 0 &&<div className="row"><span>Folios</span><b style={{ color: '#e6c462' }} title="Skybound folios — the colony's signature finished export, bound from 1 reel + 1 linen by Folio Houses and sold by the Exchange well above either input.">{ui.colony.folios}</b></div>}
        {ui.colony.skilled > 0 && <div className="row"><span>Skilled</span><b style={{ color: '#5fd0c0' }} title="Skilled workers trained by Skillhouse Academies — the advanced trades run faster with them">{ui.colony.skilled}</b></div>}
        <div className="row"><span>Homes</span><b>{`T1×${ui.colony.tiers[0]} · T2×${ui.colony.tiers[1]} · T3×${ui.colony.tiers[2]}`}</b></div>
        <div className="row"><span>Buildings</span><b>{ui.colony.buildings}</b></div>
        <div className="row"><span>Building</span><b>{ui.colony.building}</b></div>
        <div className="row"><span>Solar</span><b>{ui.power.solarW.toFixed(1)} kW</b></div>
        {ui.power.windW > 0 && <div className="row"><span>Wind</span><b style={{ color: '#8fb8d0' }} title="Wind-Shear Turbine Masts — steady generation that feeds the grid day and night (no daylight dip), scaled by staffing. Build more to outrun brownouts as the colony grows.">{ui.power.windW.toFixed(1)} kW</b></div>}
        <div className="row"><span>Load</span><b style={{ color: ui.power.loadW > ui.power.solarW ? '#e0584d' : undefined }}>{ui.power.loadW.toFixed(1)} kW</b></div>
        {ui.power.brownout && <div className="row"><span style={{ color: '#e6c84d' }}>⚡ Brownout</span><b style={{ color: '#e6c84d' }} title="Grid over capacity + battery low — heavy industry at 50% until more solar is built">industry 50%</b></div>}
        <div className="batt">
          <div className="batt-head"><span>Battery</span><b>{pct}% · {Math.round(ui.power.batteryCapWh)}Wh</b></div>
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
            <div className="border-compose">
              <input
                className="bc-in bc-name"
                placeholder="Citizen name (optional)"
                value={newCitizen.name}
                maxLength={40}
                onChange={(e) => setNewCitizen((s) => ({ ...s, name: e.target.value }))}
              />
              <input
                className="bc-in bc-age"
                type="number"
                placeholder="Age"
                min={18}
                max={99}
                value={newCitizen.age}
                onChange={(e) => setNewCitizen((s) => ({ ...s, age: e.target.value }))}
              />
              <input
                className="bc-in bc-prof"
                placeholder="Profession (optional)"
                value={newCitizen.profession}
                maxLength={40}
                list="bc-prof-list"
                onChange={(e) => setNewCitizen((s) => ({ ...s, profession: e.target.value }))}
              />
              <datalist id="bc-prof-list">
                {PROFESSION_SUGGESTIONS.map((j) => <option key={j} value={j} />)}
              </datalist>
            </div>
            <button className="primary border-add" onClick={addNewcomer}>
              {composing ? '+ Bring this citizen to the border' : '+ A family arrives at the border'}
            </button>
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
