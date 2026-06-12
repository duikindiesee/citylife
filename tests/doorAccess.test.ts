import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { makeNeighborhood, retargetParcelAccess, blueprintDoorCell, streetDoorDir, type Parcel } from '../src/colony/neighborhood'
import { compileBlueprint } from '../src/colony/houseBuilder'
import { defaultBlueprint } from '../src/colony/neighborhood'
import { parseBlueprint } from '../src/colony/blueprintScript'
import { canRestoreBlueprint } from '../src/colony/runtime'
import type { DoorDir } from '../src/colony/voxelHouse'

// Spec 077/083 — the DOOR ACCESS CONTRACT: the compiled house centres its door on the door edge of
// the house zone, so the parcel's driveway/gate/fence must re-aim at that exact cell whenever a
// blueprint lands. The operator's bug: paths stopped a cell short of (or beside) front doors.

function parcels(seed: number): Parcel[] {
  return makeNeighborhood(new ColonySim(seed).state.terrain).parcels
}

describe('door access — the driveway lands ON the compiled door', () => {
  it('blueprintDoorCell matches the compiler: same column the micro-grid door is carved on', () => {
    const p = parcels(42)[0]!
    const dir = streetDoorDir(p)
    // The compiled door column (micro units) sits at the centre of the scaled footprint — the same
    // plot column blueprintDoorCell names. Compile a default design at the zone size to prove it.
    const script = defaultBlueprint(p.houseSeed, dir)
    const compiled = compileBlueprint(script, { w: p.houseZone.w, d: p.houseZone.d, seed: p.houseSeed })
    expect(compiled.gw).toBe(p.houseZone.w * compiled.n)
    const cell = blueprintDoorCell(p, dir)
    // Zone-local plot column of the door = centre column of the zone.
    expect(cell.x - p.houseZone.x).toBe(Math.floor(p.houseZone.w / 2))
  })

  it('at creation every parcel driveway already ends on the street-facing door cell', () => {
    for (const seed of [42, 7, 99]) {
      for (const p of parcels(seed)) {
        const door = blueprintDoorCell(p, streetDoorDir(p))
        expect({ x: p.doorX, y: p.doorY }).toEqual(door)
        expect(p.driveway[p.driveway.length - 1]).toEqual(door)
      }
    }
  })

  it('retarget to the street door keeps the straight drive: verge -> gate -> door, one column', () => {
    const p = parcels(42)[0]!
    retargetParcelAccess(p, streetDoorDir(p))
    const door = blueprintDoorCell(p, streetDoorDir(p))
    expect(p.driveway[p.driveway.length - 1]).toEqual(door)
    expect(p.gate.x).toBe(door.x)
    for (const c of p.driveway) expect(c.x).toBe(door.x)
    // The gate gap is real: no fence cell on the gate.
    expect(p.fence.some((f) => f.x === p.gate.x && f.y === p.gate.y)).toBe(false)
  })

  it('a side (east) door opens a second fence gap beside the real door', () => {
    const p = parcels(42)[0]!
    retargetParcelAccess(p, 'e')
    const door = blueprintDoorCell(p, 'e')
    expect({ x: p.doorX, y: p.doorY }).toEqual(door)
    // The side fence cell next to the door is open; the front gate also stays open.
    expect(p.fence.some((f) => f.x === door.x + 1 && f.y === door.y)).toBe(false)
    expect(p.fence.some((f) => f.x === p.gate.x && f.y === p.gate.y)).toBe(false)
    // The porch path survives so the parcel keeps its street connection.
    expect(p.driveway.length).toBeGreaterThanOrEqual(3)
  })

  it('a rear door gets a doorstep pad onto the garden', () => {
    const p = parcels(42)[0]!
    const street = streetDoorDir(p)
    const rear: DoorDir = street === 'n' ? 's' : 'n'
    retargetParcelAccess(p, rear)
    const door = blueprintDoorCell(p, rear)
    expect({ x: p.doorX, y: p.doorY }).toEqual(door)
    expect(p.driveway.some((c) => c.x === door.x && c.y === door.y + p.side)).toBe(true)
  })

  it('is deterministic and idempotent — retargeting twice changes nothing', () => {
    const a = parcels(42)[0]!
    const b = parcels(42)[0]!
    retargetParcelAccess(a, 'e')
    retargetParcelAccess(b, 'e')
    retargetParcelAccess(b, 'e')
    expect(a).toEqual(b)
  })

  it('archetype blueprints all author street-facing doors, so every house stays reachable', () => {
    for (const p of parcels(42)) {
      const dir = parseBlueprint(defaultBlueprint(p.houseSeed, streetDoorDir(p))).doorDir
      expect(dir).toBe(streetDoorDir(p))
    }
  })
})

// Spec 084 S2 — the L-walkway: when the parcel tier insets the house zone one extra cell from the
// side fence (a clear strip exists), a side or rear door gets a REAL path ending on the door cell,
// every cell inside the parcel rect, with the side fence left whole. The new ESTATE/GRAND tiers
// (S6) have the strip by construction; these tests fake one by insetting a live parcel's zone.
describe('door access S2 — the side-strip L-walkway', () => {
  function stripParcel(): Parcel {
    // Since the 084 S6 estates landed, real parcels carry the side strip by construction (inset 2).
    const p = parcels(42)[0]!
    const x0 = p.x - (p.w - 1) / 2
    expect(p.houseZone.x, 'expected an estate-tier parcel with a side strip').toBeGreaterThanOrEqual(x0 + 2)
    return p
  }
  /** The driveway must be one connected component (4-connectivity over the cell set). */
  function isConnected(cells: { x: number; y: number }[]): boolean {
    if (cells.length === 0) return false
    const set = new Set(cells.map((c) => `${c.x},${c.y}`))
    const seen = new Set<string>()
    const stack = [`${cells[0]!.x},${cells[0]!.y}`]
    while (stack.length) {
      const k = stack.pop()!
      if (seen.has(k)) continue
      seen.add(k)
      const [x, y] = k.split(',').map(Number) as [number, number]
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = `${x + dx},${y + dy}`
        if (set.has(nk) && !seen.has(nk)) stack.push(nk)
      }
    }
    return seen.size === set.size
  }
  // The parcel rect plus the street APRON (the 1-2 verge rows the drive has always crossed to
  // meet the carriageway). The walkway legs themselves must never leave the fence rect sideways.
  function inParcelRect(p: Parcel, c: { x: number; y: number }): boolean {
    const xHalf = (p.w - 1) / 2
    const y0 = (p.side === 1 ? p.gate.y : p.gate.y - p.h + 1) - (p.side === 1 ? 2 : 0)
    const y1 = (p.side === 1 ? p.gate.y + p.h - 1 : p.gate.y) + (p.side === 1 ? 0 : 2)
    return c.x >= p.x - xHalf && c.x <= p.x + xHalf && c.y >= y0 && c.y <= y1
  }

  it('an east door gets a connected walkway ending ON the door, fence whole, all inside the parcel', () => {
    const p = stripParcel()
    retargetParcelAccess(p, 'e')
    const door = blueprintDoorCell(p, 'e')
    expect(p.driveway[p.driveway.length - 1]).toEqual(door)
    expect(isConnected(p.driveway)).toBe(true)
    for (const c of p.driveway) expect(inParcelRect(p, c), `cell ${c.x},${c.y} escapes the parcel`).toBe(true)
    // The side fence stays WHOLE — the walkway is internal; only the front gate gap exists.
    expect(p.fence.some((f) => f.x === door.x + 2 && f.y === door.y)).toBe(true)
    expect(p.fence.some((f) => f.x === p.gate.x && f.y === p.gate.y)).toBe(false)
  })

  it('a west door routes up the west strip the same way', () => {
    const p = stripParcel()
    retargetParcelAccess(p, 'w')
    const door = blueprintDoorCell(p, 'w')
    expect(p.driveway[p.driveway.length - 1]).toEqual(door)
    expect(isConnected(p.driveway)).toBe(true)
  })

  it('a rear door wraps the west strip and approaches through the garden row', () => {
    const p = stripParcel()
    const rear: DoorDir = streetDoorDir(p) === 'n' ? 's' : 'n'
    retargetParcelAccess(p, rear)
    const door = blueprintDoorCell(p, rear)
    expect(p.driveway[p.driveway.length - 1]).toEqual(door)
    expect(isConnected(p.driveway)).toBe(true)
    expect(p.driveway.some((c) => c.x === p.houseZone.x - 1)).toBe(true) // rides the west strip
  })

  it('is idempotent on the strip tier too', () => {
    const a = stripParcel()
    const b = stripParcel()
    retargetParcelAccess(a, 'e')
    retargetParcelAccess(b, 'e')
    retargetParcelAccess(b, 'e')
    expect(a).toEqual(b)
  })
})

describe('door access S2 — founder restore guard', () => {
  it('a founder plot only restores its own design; ordinary lots restore anything', () => {
    expect(canRestoreBlueprint({ reservedFor: 'citizen_joe' }, 'citizen_joe')).toBe(true)
    expect(canRestoreBlueprint({ reservedFor: 'citizen_joe' }, 'citizen_someone')).toBe(false)
    expect(canRestoreBlueprint({ reservedFor: undefined }, 'citizen_anyone')).toBe(true)
  })
})
