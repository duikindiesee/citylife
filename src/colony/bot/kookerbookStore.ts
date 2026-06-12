// Spec 082 P0 — Kookerbook persistence, the blueprintStore two-layer contract:
//   • LOCAL — a localStorage map keyed by citizenId; always written, so profiles + timelines
//     survive offline/dev reloads with no backend at all.
//   • BACKEND — best-effort calls through the /kooker proxy AS THE LOGGED-IN PLAYER against the
//     generic kooker-service-social contract (appName-scoped; citylife is tenant one). Tolerates
//     404 while that service ships separately; wins over local on restore (cross-device truth).
// Every profile is re-validated + re-screened through safeProfile on BOTH write and read — tampered
// or unsafe stored data never reaches the UI or the backend.
import { getAuthClient } from '../authClient'
import { safeProfile, type KbProfile } from '../social/kookerbook'

const LS_KOOKERBOOK = 'citylife.kookerbook.v1'
const BACKEND_PATH = '/kooker/api/v1/social/profiles'
const APP_NAME = 'citylife'

export type KbMap = Record<string, KbProfile> // keyed by citizenId

export function loadKookerbookLocal(): KbMap {
  try {
    const raw = localStorage.getItem(LS_KOOKERBOOK)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: KbMap = {}
    for (const [id, e] of Object.entries(parsed)) {
      const ok = safeProfile(e)
      if (ok && ok.citizenId === id) out[id] = ok
    }
    return out
  } catch {
    return {}
  }
}

export function saveProfileLocal(profile: KbProfile): boolean {
  const ok = safeProfile(profile)
  if (!ok) return false
  try {
    const map = loadKookerbookLocal()
    map[ok.citizenId] = ok
    localStorage.setItem(LS_KOOKERBOOK, JSON.stringify(map))
    return true
  } catch {
    return false
  }
}

export function clearKookerbookLocal(): void {
  try {
    localStorage.removeItem(LS_KOOKERBOOK)
  } catch {
    /* no storage */
  }
}

/** Best-effort: push one profile to kooker-service-social as the player. Never blocks the game. */
export async function saveProfileBackend(profile: KbProfile): Promise<{ ok: boolean; error?: string }> {
  const ok = safeProfile(profile)
  if (!ok) return { ok: false, error: 'invalid profile' }
  const token = await getAuthClient().getValidToken()
  if (!token) return { ok: false, error: 'not signed in' }
  try {
    const resp = await fetch(BACKEND_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ appName: APP_NAME, profile: ok }),
    })
    return resp.ok ? { ok: true } : { ok: false, error: `HTTP ${resp.status}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' }
  }
}

/** Best-effort: fetch the player's app-scoped profiles. Null when signed out / missing / malformed. */
export async function fetchKookerbookBackend(): Promise<KbMap | null> {
  const token = await getAuthClient().getValidToken()
  if (!token) return null
  try {
    const resp = await fetch(`${BACKEND_PATH}?appName=${APP_NAME}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!resp.ok) return null
    const data = (await resp.json()) as unknown
    if (!data || typeof data !== 'object') return null
    const out: KbMap = {}
    for (const [id, e] of Object.entries(data as Record<string, unknown>)) {
      const ok = safeProfile(e)
      if (ok && ok.citizenId === id) out[id] = ok
    }
    return out
  } catch {
    return null
  }
}

/** Backend wins (cross-device truth); local fills the gaps. Pure. */
export function mergeKookerbook(local: KbMap, backend: KbMap | null): KbMap {
  return { ...local, ...(backend ?? {}) }
}
