// Spec 077 P4.5 — BLUEPRINT PERSISTENCE. An accepted house design must survive a reload: the same DSL
// script regenerates the identical house (the compile path is deterministic, so the script IS the
// house). Two layers, both fail-soft:
//
//   • LOCAL — a localStorage map keyed by lot id. Always written; makes offline/dev reloads keep
//     designs with no backend at all (the settlers.ts saveColony pattern).
//   • BACKEND — best-effort calls through the /kooker proxy AS THE LOGGED-IN PLAYER (the
//     spawnCitizenSubUser pattern): never blocks the game, tolerates 404s while the kooker-side
//     endpoint ships separately, and wins over local on restore (cross-device truth).
//
// Safety: scripts are validated with validateBlueprint AND screened with isPublicSafe on every write
// and read — a corrupt or unsafe stored string can never reach the compiler or the backend.
import { getAuthClient } from '../authClient'
import { validateBlueprint } from '../blueprintScript'
import { isPublicSafe } from '../newcomers'

// v2 with the WORLD v2 re-baseline (spec 084 S6): lot ids name different physical land after the
// 608 estate masterplan, so v1 entries are deliberately NOT migrated — restoring a v1 design onto
// whatever lot now wears its old id would put someone's house on a stranger's plot. Founder homes
// re-seed from code; citizen designs start fresh on the new estates.
const LS_BLUEPRINTS = 'citylife.blueprints.v2'
const BACKEND_PATH = '/kooker/api/v1/citylife/blueprints'

export interface StoredBlueprint {
  citizenId: string
  script: string
}
export type BlueprintMap = Record<string, StoredBlueprint> // keyed by lotId

function safeEntry(lotId: string, e: unknown): StoredBlueprint | null {
  if (!e || typeof e !== 'object') return null
  const { citizenId, script } = e as { citizenId?: unknown; script?: unknown }
  if (typeof citizenId !== 'string' || typeof script !== 'string') return null
  if (!lotId || !isPublicSafe(script) || !validateBlueprint(script).ok) return null
  return { citizenId, script }
}

/** Read the local blueprint map. Unsafe/invalid entries are dropped, never returned. */
export function loadBlueprintsLocal(): BlueprintMap {
  try {
    const raw = localStorage.getItem(LS_BLUEPRINTS)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: BlueprintMap = {}
    for (const [lotId, e] of Object.entries(parsed)) {
      const ok = safeEntry(lotId, e)
      if (ok) out[lotId] = ok
    }
    return out
  } catch {
    return {}
  }
}

/** Store one accepted design locally (validated + screened first). */
export function saveBlueprintLocal(lotId: string, citizenId: string, script: string): boolean {
  if (!safeEntry(lotId, { citizenId, script })) return false
  try {
    const map = loadBlueprintsLocal()
    map[lotId] = { citizenId, script }
    localStorage.setItem(LS_BLUEPRINTS, JSON.stringify(map))
    return true
  } catch {
    return false
  }
}

/** Forget all locally stored designs (colony reset). */
export function clearBlueprintsLocal(): void {
  try {
    localStorage.removeItem(LS_BLUEPRINTS)
  } catch {
    /* no storage */
  }
}

export type BackendSaveResult = { ok: true } | { ok: false; error: string }

/** Best-effort: persist one design to the citylife backend as the logged-in player. Never throws,
 *  never blocks the game — a 404 simply means the kooker-side endpoint has not shipped yet. */
export async function saveBlueprintBackend(lotId: string, citizenId: string, script: string): Promise<BackendSaveResult> {
  if (!safeEntry(lotId, { citizenId, script })) return { ok: false, error: 'invalid blueprint' }
  const token = await getAuthClient().getValidToken()
  if (!token) return { ok: false, error: 'not signed in' }
  try {
    const resp = await fetch(BACKEND_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lotId, citizenId, script }),
    })
    return resp.ok ? { ok: true } : { ok: false, error: `HTTP ${resp.status}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' }
  }
}

/** Best-effort: fetch the player's stored designs from the backend. Null when signed out, the
 *  endpoint is missing, or the response is malformed — callers fall back to the local map. */
export async function fetchBlueprintsBackend(): Promise<BlueprintMap | null> {
  const token = await getAuthClient().getValidToken()
  if (!token) return null
  try {
    const resp = await fetch(BACKEND_PATH, { headers: { Authorization: `Bearer ${token}` } })
    if (!resp.ok) return null
    const data = (await resp.json()) as unknown
    if (!data || typeof data !== 'object') return null
    const out: BlueprintMap = {}
    for (const [lotId, e] of Object.entries(data as Record<string, unknown>)) {
      const ok = safeEntry(lotId, e)
      if (ok) out[lotId] = ok
    }
    return out
  } catch {
    return null
  }
}

/** Merge restore layers: the backend (when reachable) wins over local — it is the cross-device
 *  truth — while local fills anything the backend does not know about. Pure, node-testable. */
export function mergeBlueprints(local: BlueprintMap, backend: BlueprintMap | null): BlueprintMap {
  return { ...local, ...(backend ?? {}) }
}
