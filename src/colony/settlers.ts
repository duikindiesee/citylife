// Settlers: named, KOOKER-carded residents with a unique home and a Kookerverse bank account.
// Arriving at border security, they deposit their Earth holdings (double-entry) and pay a house
// + settlement fee into the colony economy. Lot positions + ledger persist locally so the
// Kookerverse remains across refresh; identity lives in kooker; houses regenerate from the id.
import { RNG } from "../engine/rng";
import { claimLot } from "./build";
import { designHouse, type HouseSpec } from "./house";
import type { KookerCard } from "./kooker";
import type { ColonyState } from "./sim";
import { post } from "./ledger";

export interface Settler {
  kookerId: number;
  name: string;
  x: number;
  y: number;
  house: HouseSpec;
}

export interface SettlerResult {
  settler: Settler;
  holdings: number;
  settlement: number;
}

/** Place a settler with a unique home and inject their holdings into the economy. */
export function addSettler(
  state: ColonyState,
  rng: RNG,
  card: KookerCard,
): SettlerResult | null {
  const lot = claimLot(state, rng);
  if (!lot) return null;
  const settler: Settler = {
    kookerId: card.id,
    name: card.name,
    x: lot.x,
    y: lot.y,
    house: designHouse(card.id),
  };
  state.settlers.push(settler);
  state.colonists += 2;

  // double-entry: holdings flow from Earth into the settler's Kookerverse bank account...
  const holdings = rng.int(8000, 60000);
  post(state.ledger, `Border: ${card.name} deposits Earth holdings`, [
    { account: "earth", amount: -holdings },
    { account: `settler:${card.id}`, amount: holdings },
  ]);
  // ...then they pay a house + settlement fee into the colony treasury.
  const settlement = Math.round(holdings * (0.25 + rng.next() * 0.3));
  post(state.ledger, `House & settlement: ${card.name}`, [
    { account: `settler:${card.id}`, amount: -settlement },
    { account: "treasury", amount: settlement },
  ]);
  state.treasury += settlement; // injected into the live colony economy

  return { settler, holdings, settlement };
}

const LS_SETTLERS = "citylife.settlers.v1";
const LS_LEDGER = "citylife.ledger.v1";

export function saveColony(state: ColonyState): void {
  try {
    const slim = state.settlers.map((s) => ({
      kookerId: s.kookerId,
      name: s.name,
      x: s.x,
      y: s.y,
    }));
    localStorage.setItem(LS_SETTLERS, JSON.stringify(slim));
    localStorage.setItem(LS_LEDGER, JSON.stringify(state.ledger));
  } catch {
    /* no storage */
  }
}

/** Re-place previously-registered settlers and restore the ledger (no re-injection). */
export function restoreColony(state: ColonyState): number {
  let saved: { kookerId: number; name: string; x: number; y: number }[] = [];
  try {
    saved = JSON.parse(localStorage.getItem(LS_SETTLERS) ?? "[]");
    const ledger = JSON.parse(localStorage.getItem(LS_LEDGER) ?? "null");
    if (ledger && ledger.accounts) state.ledger = ledger;
  } catch {
    return 0;
  }
  for (const s of saved) {
    state.occupied.add(s.x + "," + s.y);
    state.settlers.push({
      kookerId: s.kookerId,
      name: s.name,
      x: s.x,
      y: s.y,
      house: designHouse(s.kookerId),
    });
    state.colonists += 2;
  }
  return saved.length;
}

/** Reset: forget all settlers and the ledger so the Kookerverse starts fresh on the next load. */
export function clearColony(): void {
  try {
    localStorage.removeItem(LS_SETTLERS);
    localStorage.removeItem(LS_LEDGER);
  } catch {
    /* no storage */
  }
}
