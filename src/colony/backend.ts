// The forkable CityLife backend boundary (plan Slice 3 / issue #8). The browser talks ONLY to this
// interface — never to kooker services, secrets, or internal hosts directly. MockBackend runs
// in-memory for dev/tests; the real portable citylife-backend (Node + SQLite, its own operator auth
// + double-entry ledger, with adapters to kooker-service-ledger for the real wallet, kooker-service-
// user for the KOOKER card, and kooker-bot-spawner for the Hermes bot) will implement the same
// interface over HTTP. Swapping mock -> http is then an isolated change.
import { generateHousehold, type Household } from './newcomers'

export type Decision = 'approve' | 'hold' | 'decline'

export interface CityLifeBackend {
  /** Generate the next candidate family at the border (status: triage). */
  addNewcomer(): Promise<Household>
  /** Operator decision on a candidate. approve -> approved, hold -> held, decline -> rejected. */
  decide(id: string, decision: Decision): Promise<Household | null>
  /** Local cache of households for rendering (the real backend is the source of truth). */
  households(): Household[]
}

export class MockBackend implements CityLifeBackend {
  private list: Household[] = []
  private seed: number

  constructor(seed = 1) {
    this.seed = seed >>> 0
  }

  async addNewcomer(): Promise<Household> {
    const h: Household = { ...generateHousehold(this.seed), status: 'triage' }
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0 // LCG: next distinct candidate
    this.list.push(h)
    return h
  }

  async decide(id: string, decision: Decision): Promise<Household | null> {
    const h = this.list.find((x) => x.id === id) ?? null
    if (!h || h.status === 'rejected') return h // decline is terminal
    h.status = decision === 'approve' ? 'approved' : decision === 'hold' ? 'held' : 'rejected'
    return h
  }

  households(): Household[] {
    return this.list
  }
}
