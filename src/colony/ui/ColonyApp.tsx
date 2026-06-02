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
        {ui.colony.fire.posts > 0 && <div className="row"><span>Fire</span><b style={{ color: ui.colony.fire.active > 0 ? '#e0584d' : !ui.colony.fire.watered ? '#d8a64a' : '#7faf7a' }} title="Fire-Watch — staffed Posts watch a fire district. Worn, packed, power-stressed buildings in the warm season slowly build fire risk; a staffed, watered Post drains it and puts out sparks. Let the tanks run dry or the crew leave and a fire spreads deck-to-deck and burns a building down. A maintained, well-watered colony never catches.">{ui.colony.fire.active > 0 ? `${ui.colony.fire.active} alight!` : `risk ${ui.colony.fire.risk}%`}{ui.colony.fire.watered ? '' : ' · dry'}</b></div>}
        {ui.colony.stalls.stalls > 0 && <div className="row"><span>Market</span><b style={{ color: ui.colony.stalls.open ? '#e0b34a' : '#9a8a5a' }} title="Market Stalls — the colony's own home market. Staffed stalls sell surplus linen and folios (above a reserve) to paid colonists, returning a little coin to the treasury each day. They never sell below the reserve, so they never rob the export trade, and custom dries up if wages fall into arrears.">{ui.colony.stalls.stalls} stall{ui.colony.stalls.stalls > 1 ? 's' : ''}{ui.colony.stalls.open ? ` · +${ui.colony.stalls.coinPerDay}/day` : ' · quiet'}</b></div>}
        {ui.colony.planters.squares > 0 && <div className="row"><span>Planters</span><b style={{ color: ui.colony.planters.blooming > 0 ? '#6fae5a' : '#7a8a6a' }} title="Planter Squares — the colony's first deliberate beauty. A Square in Bloom (tended by a groundskeeper and watered for most of the last ten days) lifts the desirability of homes around it, raising their liveability and drawing settlers to a colony that looks cared for. Untended or unwatered, it simply gives nothing.">{ui.colony.planters.blooming}/{ui.colony.planters.squares} blooming</b></div>}
        {ui.colony.labour.active && <div className="row"><span>Employment</span><b style={{ color: ui.colony.labour.dragging ? '#e0584d' : ui.colony.labour.unemployment > 0.1 ? '#d8a64a' : '#7faf7a' }} title="The Labour Registry Desk — it keeps an honest count of working-age idle hands. Chronic unemployment (above 10% held a week, or 20% held a fortnight) drags the Prosperity Rank a step or two, and clears once the colony sits below 5% for a week. Without a Registry, idleness never shows in the books.">{Math.round((1 - ui.colony.labour.unemployment) * 100)}% employed{ui.colony.labour.dragging ? ` · Prosperity -${ui.colony.labour.penalty}` : ''}</b></div>}
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
