// Citizen roster — the colony's real, named people, persisted against a kooker user.
//
// Spec 074: when the Border Patrol approves a Household + the Patrol bot allocates a Plot, we
// register a Citizen here. This is the engine-side record. The matching kooker-user (role
// CITYLIFE_CITIZEN), the spawned Hermes pod, and the NetworkPolicy DMZ are out-of-process — the
// citylife backend, kooker-bot-spawner and kooker-user repos own those. Here we keep only the
// public-safe fields the HUD + first-person view need.
//
// Safety: every shown / saved string passes through `isPublicSafe()` (newcomers.ts denylist), so
// internal hosts / role names / secret-looking strings can never leak into a Citizen record.
import type { Household } from '../newcomers'
import { isPublicSafe } from '../newcomers'
import type { Plot } from '../cityPlan'

export interface Citizen {
  /** Stable id, derived from the household. The kooker user shares this id. */
  id: string
  /** The household this citizen leads. One household = one citizen avatar (the lead). */
  householdId: string
  /** Public-safe display name (the lead's name). */
  displayName: string
  /** The allocated plot. */
  plotId: string
  /** Public-safe name of the plot ("Beach Cove"). */
  plotName: string
  /** The citizen's address on the heightfield — first-person camera anchors here. */
  homeXY: { x: number; y: number }
  /** Whether a real Hermes pod has been provisioned for this citizen. False until the spawner has minted one. */
  hasPod: boolean
  /** In-cluster gateway URL once the pod is up. Never tracked in repo; only held in-memory + on the kooker user. */
  botGatewayUrl?: string
  /** Public Telegram handle the operator can read the bot's life from. Never the bot token. */
  telegramHandle?: string
  /** Cumulative inference tokens this citizen has spent across all turns + visions (token-thrift signal). */
  tokensSpentLifetime: number
  /** Timestamp of registration (ms). Stamped from outside (deterministic in tests). */
  bornAtMs: number
}

/** Public-safe slice of a Citizen for the HUD / UI / save file. Excludes any field that could carry
 *  a credential or internal URL — e.g. botGatewayUrl is stripped on the way out. */
export interface CitizenPublic {
  id: string
  displayName: string
  plotName: string
  homeXY: { x: number; y: number }
  hasPod: boolean
  telegramHandle?: string
  tokensSpentLifetime: number
}

function publicView(c: Citizen): CitizenPublic {
  return {
    id: c.id,
    displayName: c.displayName,
    plotName: c.plotName,
    homeXY: { x: c.homeXY.x, y: c.homeXY.y },
    hasPod: c.hasPod,
    telegramHandle: c.telegramHandle,
    tokensSpentLifetime: c.tokensSpentLifetime,
  }
}

/** The colony's citizen registry. */
export class CitizenRoster {
  private byHousehold = new Map<string, Citizen>()

  /** Register one citizen from an approved household + their allocated plot. Idempotent on
   *  householdId. Returns null if the household / plot fails public-safety screening (the
   *  household generator already pre-vets, but this is the second wall before persistence). */
  register(h: Household, plot: Plot, nowMs: number): Citizen | null {
    const lead = h.members[0]
    if (!lead) return null
    const displayName = lead.name
    if (!isPublicSafe(displayName) || !isPublicSafe(plot.name)) return null
    if (!h.publicSafe) return null
    const existing = this.byHousehold.get(h.id)
    if (existing) {
      // Idempotent — keep the original record. A new plot would be a re-allocation; the household
      // can only have one allocated plot at a time so the caller should not be re-registering.
      return existing
    }
    const c: Citizen = {
      id: `citizen_${h.id.replace(/^household_/, '')}`,
      householdId: h.id,
      displayName,
      plotId: plot.id,
      plotName: plot.name,
      homeXY: { x: plot.x, y: plot.y },
      hasPod: false,
      tokensSpentLifetime: 0,
      bornAtMs: nowMs,
    }
    this.byHousehold.set(h.id, c)
    return c
  }

  /** Look up a citizen by their household id. */
  forHousehold(householdId: string): Citizen | undefined {
    return this.byHousehold.get(householdId)
  }

  /** Look up a citizen by their citizen id. */
  byId(citizenId: string): Citizen | undefined {
    for (const c of this.byHousehold.values()) if (c.id === citizenId) return c
    return undefined
  }

  /** Mark a citizen as having a live Hermes pod, with the in-cluster gateway URL. The URL is
   *  validated against the denylist before it lands on the record. */
  setBotGatewayUrl(citizenId: string, url: string): boolean {
    if (!isPublicSafe(url)) return false
    const c = this.byId(citizenId)
    if (!c) return false
    c.botGatewayUrl = url
    c.hasPod = true
    return true
  }

  /** Clear the pod binding (the spawner was torn down or the citizen lost their podship). */
  clearBotGatewayUrl(citizenId: string): void {
    const c = this.byId(citizenId)
    if (!c) return
    c.botGatewayUrl = undefined
    c.hasPod = false
  }

  /** Attach the citizen's dedicated Telegram channel (the public handle, never the token). */
  setTelegramHandle(citizenId: string, handle: string): boolean {
    if (!isPublicSafe(handle)) return false
    const c = this.byId(citizenId)
    if (!c) return false
    c.telegramHandle = handle
    return true
  }

  /** Token-thrift accounting: charge this citizen for inference they just spent. */
  recordTokens(citizenId: string, tokens: number): void {
    const c = this.byId(citizenId)
    if (!c || !Number.isFinite(tokens) || tokens <= 0) return
    c.tokensSpentLifetime += Math.floor(tokens)
  }

  /** All citizens, public-safe view. The HUD + uiState reads this. */
  list(): CitizenPublic[] {
    return Array.from(this.byHousehold.values()).map(publicView)
  }

  /** Count of registered citizens. */
  size(): number {
    return this.byHousehold.size
  }

  /** Count of citizens whose Hermes pod is live. */
  awakeCount(): number {
    let n = 0
    for (const c of this.byHousehold.values()) if (c.hasPod) n++
    return n
  }

  /** Drop everything (test reset / colony reset). */
  clear(): void {
    this.byHousehold.clear()
  }
}
