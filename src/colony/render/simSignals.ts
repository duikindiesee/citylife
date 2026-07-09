// QA hardening — the "dead memo" fix. The R3F components hang off a MUTABLE sim.state class
// instance: React never sees its mutations, so useMemo deps like [sim.state.roadsVersion] only
// re-evaluate if something else happens to re-render the component. These signature functions
// reduce the slices of state each component renders to a cheap primitive string. Paired with
// useSimSignal (useSyncExternalStore over the runtime's emit loop), a component re-renders
// exactly when its signature changes — and never otherwise.
//
// RULES for a signature function:
//  - Pure read of state; no allocation beyond the returned string.
//  - Deterministic: the same state MUST produce the identical string (useSyncExternalStore
//    compares snapshots with Object.is; an unstable snapshot would re-render every emit).
//  - Cover every mutable field the component actually renders.
import type { ColonyState } from "../sim";

/** R3FFoliage — trees rebuild when roads, buildings or lots change (all cull foliage;
 *  spec 128 added lot/parcel footprints so zoning clears its trees). */
export function foliageSignature(state: ColonyState): string {
  const lots = state.neighborhood?.lots?.length ?? 0;
  const cd = state.commercialDistrict?.parcels?.length ?? 0;
  return `r${state.roadsVersion}:b${state.buildings.length}:l${lots}:c${cd}`;
}

/** ZoneManager — commercial blocks from the city plan, plus lot overlays / houses from the
 *  neighborhood. A lot appearing, vanishing or flipping built must re-render. */
export function zoneSignature(state: ColonyState): string {
  let sig = `p${state.cityPlan ? state.cityPlan.plots.length : -1}`;
  const lots = state.neighborhood?.lots ?? [];
  sig += `:n${lots.length}`;
  for (const lot of lots) sig += `|${lot.id}=${lot.built ? 1 : 0}`;
  sig += `:v${state.zonesVisible === false ? 0 : 1}`; // spec 131 — the HUD zones toggle
  return sig;
}

/** useTerrainLeveling — pads re-grade when roads change, a parcel builds, or the shop
 *  district appears. Parcel geometry (houseZone/fence/driveway) is fixed at placement, so
 *  id + built covers the mutable surface. */
export function levelingSignature(state: ColonyState): string {
  let sig = `r${state.roadsVersion}`;
  const parcels = state.neighborhood?.parcels ?? [];
  sig += `:n${parcels.length}`;
  for (const p of parcels) if (p.built) sig += `|${p.id}`;
  const cd = state.commercialDistrict;
  sig += cd ? `:c${cd.parcels.length}${cd.garagePad ? "g" : ""}` : ":c-";
  return sig;
}

/** R3FWorld's first-person spawn point — recomputes when the road network changes (the spawn
 *  snaps to the first road, else falls back to findDrySpawn over the immutable terrain). */
export function spawnSignature(state: ColonyState): string {
  return `r${state.roadsVersion}`;
}

/** R3FRoadRibbons — the smooth road surface rebuilds when the road network changes (the
 *  builder bumps roadsVersion and appends a centre-line way per drawn road, spec 127). */
export function roadwaySignature(state: ColonyState): string {
  return `r${state.roadsVersion}:w${state.roadWays?.length ?? 0}`;
}

/** R3FOperatorCar — the parked car rebuilds when the operator's car or home cell changes
 *  (spec 131). The spec is swapped whole by the runtime, so identity-ish fields suffice. */
export function operatorCarSignature(state: ColonyState): string {
  const p = state.operatorCar;
  if (!p) return "car-";
  // The FULL spec JSON, not its length (spec 131 verify F4): paint palette hex values
  // serialize to equal digit counts, so a garage repaint left the parked car stale forever.
  return `car${p.cell.x},${p.cell.y}:${JSON.stringify(p.spec)}`;
}

/** R3FRallyNameplates — plates rebuild when who-is-present (or a display name) changes
 *  (spec 131). Positions track the live avatars per frame; only membership re-renders. */
export function rallyPresenceSignature(state: ColonyState): string {
  const p = state.rallyPresence ?? [];
  return `rally${p.map((c) => `${c.id}=${c.displayName}`).join("|")}`;
}
