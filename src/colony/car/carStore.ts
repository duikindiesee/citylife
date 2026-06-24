// Spec 096 Slice D — the parts a player OWNS, against their citizen id. Buying a part records ownership
// here; mounting requires ownership (the Street Rod buy-then-bolt-on loop). Free/stock parts (cost 0)
// are owned by everyone implicitly, so the base car always works. A single fail-soft localStorage layer
// (no-ops in the node env), screened to known catalog kinds so a corrupt entry can never reach the car.
import { CAR_PARTS, type CarPartKind } from "./carParts";

const LS_OWNED = "citylife.carparts.owned.v1";
type Owned = Record<string, CarPartKind[]>;

function ls(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function read(): Owned {
  const store = ls();
  if (!store) return {};
  try {
    const raw = store.getItem(LS_OWNED);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Owned = {};
    for (const [id, list] of Object.entries(obj)) {
      if (!Array.isArray(list)) continue;
      const kinds = [
        ...new Set(
          list.filter(
            (k): k is CarPartKind =>
              typeof k === "string" && !!CAR_PARTS[k as CarPartKind],
          ),
        ),
      ];
      if (kinds.length) out[id] = kinds;
    }
    return out;
  } catch {
    return {};
  }
}

function write(o: Owned): void {
  const store = ls();
  if (!store) return;
  try {
    store.setItem(LS_OWNED, JSON.stringify(o));
  } catch {
    /* quota / private mode — fail soft */
  }
}

/** Is a part owned by this player? Free (cost 0) parts are always owned. */
export function ownsCarPart(citizenId: string, kind: CarPartKind): boolean {
  const def = CAR_PARTS[kind];
  if (!def) return false;
  if (def.cost === 0) return true;
  return (read()[citizenId] ?? []).includes(kind);
}

/** Every part a player owns: their bought parts plus every free part. Deduped. */
export function ownedCarParts(citizenId: string): CarPartKind[] {
  const free = (Object.keys(CAR_PARTS) as CarPartKind[]).filter(
    (k) => CAR_PARTS[k].cost === 0,
  );
  return [...new Set([...free, ...(read()[citizenId] ?? [])])];
}

/** Record that a player owns a part (a bought, non-free part). Idempotent. */
export function ownCarPart(citizenId: string, kind: CarPartKind): void {
  const def = CAR_PARTS[kind];
  if (!def || def.cost === 0) return; // free parts need no record
  const o = read();
  const cur = o[citizenId] ?? [];
  if (!cur.includes(kind)) {
    o[citizenId] = [...cur, kind];
    write(o);
  }
}

/** Drop a bought part from a player's owned set (e.g. when listing it for sale, which escrows it onto
 *  the classifieds board). Free parts are universal and cannot be unowned. Idempotent. */
export function unownCarPart(citizenId: string, kind: CarPartKind): void {
  const def = CAR_PARTS[kind];
  if (!def || def.cost === 0) return; // free parts are always owned
  const o = read();
  const cur = o[citizenId] ?? [];
  if (cur.includes(kind)) {
    o[citizenId] = cur.filter((k) => k !== kind);
    write(o);
  }
}
