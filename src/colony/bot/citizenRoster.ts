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
import type { Household } from "../newcomers";
import { isPublicSafe } from "../newcomers";
import type { Plot } from "../cityPlan";

export interface Citizen {
  /** Stable id, derived from the household. The kooker user shares this id. */
  id: string;
  /** The household this citizen leads. One household = one citizen avatar (the lead). */
  householdId: string;
  /** Public-safe display name (the lead's name). */
  displayName: string;
  /** The allocated plot. */
  plotId: string;
  /** Public-safe name of the plot ("Beach Cove"). */
  plotName: string;
  /** The citizen's address on the heightfield — first-person camera anchors here. */
  homeXY: { x: number; y: number };
  /** Whether a real Hermes pod has been provisioned for this citizen. False until the spawner has minted one. */
  hasPod: boolean;
  /** In-cluster gateway URL once the pod is up. Never tracked in repo; only held in-memory + on the kooker user. */
  botGatewayUrl?: string;
  /** Public Telegram handle the operator can read the bot's life from. Never the bot token. */
  telegramHandle?: string;
  /** Cumulative inference tokens this citizen has spent across all turns + visions (token-thrift signal). */
  tokensSpentLifetime: number;
  /** Timestamp of registration (ms). Stamped from outside (deterministic in tests). */
  bornAtMs: number;
  /** P1 — live avatar position on the heightfield (cells). Starts at the home cell; eased toward target. */
  pos: { x: number; y: number };
  /** P1 — destination cell the avatar walks to. The bot or governor sets this via setTarget. */
  target: { x: number; y: number };
  /** P1 — facing in radians (atan2 of the travel direction). */
  heading: number;
  /** P1 — walk speed in cells per second. */
  spd: number;
  /** Spec 078 — avatar body kind. Ordinary citizens are 'human'; Joe the founder is a 'crab'. Drives
   *  which instanced mesh the renderer draws them with and the first-person eye height. */
  kind: "human" | "crab";
  /** Spec 077 P4 — the citizen's authored house blueprint (the DSL script accepted in the builder).
   *  Mirrors the parcel's stored script; the backend persistence slice syncs from here. */
  blueprint?: string;
}

/** Public-safe slice of a Citizen for the HUD / UI / save file. Excludes any field that could carry
 *  a credential or internal URL — e.g. botGatewayUrl is stripped on the way out. */
export interface CitizenPublic {
  id: string;
  displayName: string;
  plotName: string;
  homeXY: { x: number; y: number };
  hasPod: boolean;
  telegramHandle?: string;
  tokensSpentLifetime: number;
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
  };
}

/** A PLAYER may see only their own data and other citizens' public PRESENCE — their name and live
 *  avatar presence — but never another player's private address/plot, usage or contact fields. So
 *  the stub masks plotName, drops telegramHandle and zeroes tokensSpentLifetime. */
function publicStub(c: Citizen): CitizenPublic {
  return {
    id: c.id,
    displayName: c.displayName,
    plotName: "Occupied",
    homeXY: { x: c.homeXY.x, y: c.homeXY.y },
    hasPod: c.hasPod,
    tokensSpentLifetime: 0,
  };
}

/** The colony's citizen registry. */
export class CitizenRoster {
  private byHousehold = new Map<string, Citizen>();

  /** Register one citizen from an approved household + their allocated plot. Idempotent on
   *  householdId. Returns null if the household / plot fails public-safety screening (the
   *  household generator already pre-vets, but this is the second wall before persistence). */
  register(h: Household, plot: Plot, nowMs: number): Citizen | null {
    const lead = h.members[0];
    if (!lead) return null;
    const displayName = lead.name;
    if (!isPublicSafe(displayName) || !isPublicSafe(plot.name)) return null;
    if (!h.publicSafe) return null;
    const existing = this.byHousehold.get(h.id);
    if (existing) {
      // Idempotent — keep the original record. A new plot would be a re-allocation; the household
      // can only have one allocated plot at a time so the caller should not be re-registering.
      return existing;
    }
    const c: Citizen = {
      id: `citizen_${h.id.replace(/^household_/, "")}`,
      householdId: h.id,
      displayName,
      plotId: plot.id,
      plotName: plot.name,
      homeXY: { x: plot.x, y: plot.y },
      hasPod: false,
      tokensSpentLifetime: 0,
      bornAtMs: nowMs,
      pos: { x: plot.x, y: plot.y },
      target: { x: plot.x, y: plot.y },
      heading: 0,
      spd: 0.8,
      kind: "human",
    };
    this.byHousehold.set(h.id, c);
    return c;
  }

  /** Spec 078 — seed a permanent FOUNDER citizen (Joe the Crab) that is NOT tied to an approved
   *  household. Idempotent on the fixed citizen id and public-safety screened like any other record, so
   *  calling it every runtime construction is safe. Returns the citizen (existing or freshly seeded). */
  seedFounder(opts: {
    id: string;
    householdId: string;
    displayName: string;
    plotId: string;
    plotName: string;
    home: { x: number; y: number };
    kind: "human" | "crab";
    nowMs: number;
    spd?: number;
  }): Citizen | null {
    if (!isPublicSafe(opts.displayName) || !isPublicSafe(opts.plotName))
      return null;
    const existing = this.byId(opts.id);
    if (existing) return existing;
    const c: Citizen = {
      id: opts.id,
      householdId: opts.householdId,
      displayName: opts.displayName,
      plotId: opts.plotId,
      plotName: opts.plotName,
      homeXY: { x: opts.home.x, y: opts.home.y },
      hasPod: false,
      tokensSpentLifetime: 0,
      bornAtMs: opts.nowMs,
      pos: { x: opts.home.x, y: opts.home.y },
      target: { x: opts.home.x, y: opts.home.y },
      heading: 0,
      spd: opts.spd ?? 0.7,
      kind: opts.kind,
    };
    this.byHousehold.set(opts.householdId, c);
    return c;
  }

  /** Look up a citizen by their household id. */
  forHousehold(householdId: string): Citizen | undefined {
    return this.byHousehold.get(householdId);
  }

  /** Look up a citizen by their citizen id. */
  byId(citizenId: string): Citizen | undefined {
    for (const c of this.byHousehold.values()) if (c.id === citizenId) return c;
    return undefined;
  }

  /** Mark a citizen as having a live Hermes pod, with the in-cluster gateway URL. The URL is
   *  validated against the denylist before it lands on the record. */
  setBotGatewayUrl(citizenId: string, url: string): boolean {
    if (!isPublicSafe(url)) return false;
    const c = this.byId(citizenId);
    if (!c) return false;
    c.botGatewayUrl = url;
    c.hasPod = true;
    return true;
  }

  /** Clear the pod binding (the spawner was torn down or the citizen lost their podship). */
  clearBotGatewayUrl(citizenId: string): void {
    const c = this.byId(citizenId);
    if (!c) return;
    c.botGatewayUrl = undefined;
    c.hasPod = false;
  }

  /** Attach the citizen's dedicated Telegram channel (the public handle, never the token). */
  setTelegramHandle(citizenId: string, handle: string): boolean {
    if (!isPublicSafe(handle)) return false;
    const c = this.byId(citizenId);
    if (!c) return false;
    c.telegramHandle = handle;
    return true;
  }

  /** P1 — point a citizen's avatar at a destination cell. The bot or governor calls this to make the avatar walk. */
  setTarget(citizenId: string, cell: { x: number; y: number }): boolean {
    const c = this.byId(citizenId);
    if (!c || !Number.isFinite(cell.x) || !Number.isFinite(cell.y))
      return false;
    c.target = { x: cell.x, y: cell.y };
    return true;
  }

  /** P1 — advance every avatar toward its target by dt seconds (eased straight-line walk, heading follows travel). */
  stepAvatars(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const c of this.byHousehold.values()) {
      const dx = c.target.x - c.pos.x,
        dy = c.target.y - c.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3) continue;
      const move = Math.min(d, c.spd * dt);
      c.pos.x += (dx / d) * move;
      c.pos.y += (dy / d) * move;
      c.heading = Math.atan2(dy, dx);
    }
  }

  /** P1 — live avatar render data for the renderer (public-safe: name + position only, never the gateway URL). */
  avatars(): {
    id: string;
    displayName: string;
    x: number;
    y: number;
    heading: number;
    hasPod: boolean;
    kind: "human" | "crab";
  }[] {
    return Array.from(this.byHousehold.values()).map((c) => ({
      id: c.id,
      displayName: c.displayName,
      x: c.pos.x,
      y: c.pos.y,
      heading: c.heading,
      hasPod: c.hasPod,
      kind: c.kind,
    }));
  }

  /** Token-thrift accounting: charge this citizen for inference they just spent. */
  recordTokens(citizenId: string, tokens: number): void {
    const c = this.byId(citizenId);
    if (!c || !Number.isFinite(tokens) || tokens <= 0) return;
    c.tokensSpentLifetime += Math.floor(tokens);
  }

  /** All citizens, public-safe view. The HUD + uiState reads this. */
  list(): CitizenPublic[] {
    return Array.from(this.byHousehold.values()).map(publicView);
  }

  /** Viewer-scoped roster (spec — player data isolation). With viewerId = null this is the operator /
   *  privileged view and returns the full public record of every citizen (identical to list()). For a
   *  PLAYER viewer (their own citizen id) it returns their own full record but only a public-presence
   *  stub for everyone else, so a player sees only their own data plus others' public presence — never
   *  another player's private usage/contact fields. The Builder (builderId) is always shown in full so
   *  the construction trade stays legible to everyone. */
  listFor(viewerId: string | null, builderId?: string): CitizenPublic[] {
    if (!viewerId) return this.list();
    return Array.from(this.byHousehold.values()).map((c) =>
      c.id === viewerId || c.id === builderId ? publicView(c) : publicStub(c),
    );
  }

  /** Count of registered citizens. */
  size(): number {
    return this.byHousehold.size;
  }

  /** Count of citizens whose Hermes pod is live. */
  awakeCount(): number {
    let n = 0;
    for (const c of this.byHousehold.values()) if (c.hasPod) n++;
    return n;
  }

  /** Remove a single citizen (demolition / destroy-the-agent). Returns true if one was removed. */
  remove(citizenId: string): boolean {
    for (const [k, c] of this.byHousehold) {
      if (c.id === citizenId) {
        this.byHousehold.delete(k);
        return true;
      }
    }
    return false;
  }

  /** Drop everything (test reset / colony reset). */
  clear(): void {
    this.byHousehold.clear();
  }
}
