// WORLD.KOKERBOOM.2 — the ONE list of footprints that plants must not grow through.
//
// This existed twice, informally: R3FFoliage built its own list inline, and R3FQuiverTrees passed `[]`
// and cleared nothing at all. Both facts caused a live defect within a day of each other —
//
//   - the GARAGE was missing from the foliage list, so plants grew over the forecourt and through the
//     Gearbox Auto Hub, the first building a new player is sent to (operator report: "not on garage");
//   - the quiver trees cleared NOTHING, which was survivable only because they were confined to
//     Highland/Mountain, far from any building. The moment they were allowed onto the dunes — where the
//     town actually stands — that would have put kokerbome inside houses and across the carriageway.
//
// Two lists that must agree, maintained by hand in two files, will drift. This is the one list. A new
// footprint is added here once and both layers respect it.
//
// NOTE the two anchoring conventions, which are NOT interchangeable and were the subject of spec 128:
// neighbourhood lots are CENTRE-anchored (the bulldoze convention), while commercial parcels and the
// depot/garage pads are ORIGIN-anchored (the leveling convention, the same field terrain grading reads
// so that clearing and grading agree on ONE footprint).
import { findJunctionZones } from "./roadJunctions";
import { buildIronworkHikePath, ironworkPillarCell } from "../ironworkPillar";
import type { ClearRect } from "./foliageLogic";

/** The subset of ColonyState this needs. Structural so both callers can pass their own state shape. */
export interface ClearRectState {
  neighborhood?: {
    lots?: readonly { x: number; y: number; w: number; h: number }[];
  } | null;
  commercialDistrict?: {
    parcels?: readonly { x: number; y: number; w: number; h: number }[];
    garagePad?: { x: number; y: number; w: number; h: number } | null;
  } | null;
  busDepotPad?: { x: number; y: number; w: number; h: number } | null;
  roadWays?: unknown;
  structures?: unknown;
}

/**
 * Every footprint a plant must not be sited in. Callers add a canopy margin themselves
 * (`calculateFoliagePositions` grows each rect by one cell); the rects here are the bare footprints.
 *
 * Pure and order-stable: the same state yields the same list in the same order, so two layers reading
 * it make the same decisions.
 */
export function worldClearRects(state: ClearRectState): ClearRect[] {
  const rects: ClearRect[] = [];

  // Spec 128 — "trees on houses is a big no". Lots are CENTRE-anchored.
  for (const lot of state.neighborhood?.lots ?? []) {
    const x0 = lot.x - Math.floor((lot.w - 1) / 2);
    const y0 = lot.y - Math.floor((lot.h - 1) / 2);
    rects.push({ x0, y0, x1: x0 + lot.w - 1, y1: y0 + lot.h - 1 });
  }

  // Commercial parcels are ORIGIN-anchored.
  for (const p of state.commercialDistrict?.parcels ?? []) {
    rects.push({ x0: p.x, y0: p.y, x1: p.x + p.w - 1, y1: p.y + p.h - 1 });
  }

  // Spec 137 — junctions clear their plants too: trees otherwise grow dead-centre in the crossing.
  for (const z of findJunctionZones((state.roadWays ?? []) as never)) {
    const r = z.rBound + 1;
    rects.push({
      x0: Math.floor(z.cx - r),
      y0: Math.floor(z.cy - r),
      x1: Math.ceil(z.cx + r),
      y1: Math.ceil(z.cy + r),
    });
  }

  // Spec 149 — the bus depot pad, or plants grow across the apron and half-bury the parked fleet.
  const depot = state.busDepotPad;
  if (depot) {
    rects.push({
      x0: depot.x,
      y0: depot.y,
      x1: depot.x + depot.w - 1,
      y1: depot.y + depot.h - 1,
    });
  }

  // The garage pad — same class as the depot, and the one that was missing.
  const garage = state.commercialDistrict?.garagePad;
  if (garage) {
    rects.push({
      x0: garage.x,
      y0: garage.y,
      x1: garage.x + garage.w - 1,
      y1: garage.y + garage.h - 1,
    });
  }

  // Spec 144 — the highland route is a footpath, not a road, so it never enters `roads`. Clear its
  // tread and the mountain dais explicitly or plants hide the destination and grow through the gravel.
  for (const cell of buildIronworkHikePath(state as never)) {
    rects.push({ x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y });
  }
  const pillar = ironworkPillarCell(state.structures as never);
  if (pillar) {
    rects.push({
      x0: pillar.x - 3,
      y0: pillar.y - 3,
      x1: pillar.x + 3,
      y1: pillar.y + 3,
    });
  }

  return rects;
}
