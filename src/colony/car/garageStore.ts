// Spec 096 Slice A — the GARAGE store: the one car a player owns, kept against their citizen id. A
// single localStorage layer (fail-soft, like blueprintStore/furnitureStore) so offline/dev reloads keep
// a player's car with no backend; a best-effort backend mirror is a later slice. Every read/write is
// screened through safeCarSpec, so a corrupt or tampered entry can never reach the renderer or a
// player-facing label, and an empty garage always yields a deterministic default car (never throws).
import { type CarSpec, defaultCarSpec, safeCarSpec } from "./carSpec";

const LS_GARAGE = "citylife.garage.v1";

/** Per-player garage keyed by citizen id: the one car a player currently owns. */
type Garage = Record<string, CarSpec>;

/** localStorage is absent in the node sim/test env — every access is guarded so the store no-ops there
 *  (loadCar then returns the deterministic default) instead of throwing. */
function ls(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function read(): Garage {
  const store = ls();
  if (!store) return {};
  try {
    const raw = store.getItem(LS_GARAGE);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Garage = {};
    for (const [k, v] of Object.entries(obj)) {
      const safe = safeCarSpec(v);
      if (safe) out[k] = safe;
    }
    return out;
  } catch {
    return {};
  }
}

function write(g: Garage): void {
  const store = ls();
  if (!store) return;
  try {
    store.setItem(LS_GARAGE, JSON.stringify(g));
  } catch {
    // quota / private mode — fail soft, the car just is not persisted this session
  }
}

/** The player's car, screened, or a deterministic default stock car if they have none. Never throws. */
export function loadCar(citizenId: string): CarSpec {
  const stored = read()[citizenId];
  return (stored && safeCarSpec(stored)) || defaultCarSpec(citizenId);
}

/** Persist a player's car (screened on the way in). A spec that fails validation is ignored. */
export function saveCar(citizenId: string, spec: CarSpec): void {
  const safe = safeCarSpec(spec);
  if (!safe) return;
  const g = read();
  g[citizenId] = safe;
  write(g);
}
