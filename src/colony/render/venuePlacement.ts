// Spec 143 — venue placement: the ONE survey that decides where a commercial venue BUILDING
// stands on its parcel, which way it faces, and how big it is. Pure math (no three.js, no
// DOM) so the layer renderer, the runtime (bar stools) and the node tests all read the SAME
// answer — the operator's floating/toy-box/on-the-junction shops were three renderers each
// improvising their own.
//
// Scale constitution (the world metric system spec, measured audit): 1 grid cell = 4 m,
// 1 world unit = 1 m, a citizen is ~1.8 m, a storey ~3.5 m, a door 2.4–2.6 m. The legacy
// commercial layer authored its meshes in CELL units on a 4 m/cell world, which is exactly
// why every shop rendered as a knee-high kiosk on a 16–32 m parcel.
//
// GLB-ready contract: a VenuePlacement is everything Jack's venue GLBs (bar, shop, studio)
// need to drop in where the primitive massing stands today — same swap-in pattern as
// GlbHouse/VoxelHouseMesh (specs 128/129): mount at (origin, seatY, facing), the building
// shell fills `footprint`, the walk-in door is at `entrance` on the frontage.

import type { CommercialDistrict, ShopParcel } from "../commerce/district";
import type { Terrain } from "../terrain";
import { padSeatY } from "./useTerrainLeveling";
import { ribbonCoverage, type RoadWay } from "./roadRibbon";
import { getSmoothRoadY } from "./roadSurface";
import { CELL_SIZE } from "../scale";

/** 1 grid cell = 4 m — the shared scale-constitution anchor (`src/colony/scale.ts`, spec
 *  137). Re-exported under the venue module's own name so callers read one metric here. */
export const CELL_M = CELL_SIZE;
/** One storey of a commercial venue, metres. */
export const STOREY_M = 3.5;
/** A walk-in door (scale constitution: 2.4–2.6 m). */
export const DOOR_H_M = 2.5;
export const DOOR_W_M = 1.4;
/** Pavement + awning strip between the carriageway edge and the building front face —
 *  a full grid cell, so kerbside furniture (bar stools, crates) stands a whole quantized
 *  ribbon-coverage cell clear of the asphalt. */
export const FRONT_STRIP_M = 4;
/** Clear ground kept at the parcel's side and back boundaries. */
export const SIDE_MARGIN_M = 1;
export const BACK_MARGIN_M = 1;
/** The high street / cross street carriageways are 4-cell ways (runtime roadWays). */
export const ROAD_HALF_CELLS = 2;
/** A building thinner than this reads as a shed, not a venue — the parcel stays open. */
const MIN_BODY_M = 6;
/** Bar counter/stool offsets from the building front face, metres (frontage strip zone —
 *  by construction < FRONT_STRIP_M so seated bots never sit on the carriageway). */
export const BAR_COUNTER_OFF_M = 1.1;
export const BAR_STOOL_OFF_M = 1.85;
export const BAR_STOOL_SPACING_M = 1.15;

export type VenueType =
  | "bar"
  | "nursery"
  | "club"
  | "market"
  | "garage"
  | "studio"
  | "shop"
  | "kiosk"
  | "showroom";

/** A circular no-build footprint around a road junction (grid cells). Callers map the
 *  live junction zones here — `rBound` once the junction-caps rework lands, `half` + apron
 *  today — so venues respect whichever pad geometry the road layer actually draws. */
export interface JunctionPad {
  cx: number;
  cy: number;
  r: number;
}

export interface VenuePlacement {
  parcelId: string;
  businessId?: string;
  venueType: VenueType;
  /** The surveyed parcel, grid cells (min corner + size). */
  parcel: { x: number; y: number; w: number; h: number };
  /** Building footprint centre, grid coords (fractional). Multiply by CELL_M via the
   *  renderer's wx/wz to get the world-space origin. */
  centerGX: number;
  centerGY: number;
  /** Unit grid direction from the building toward its fronting road. */
  frontDir: { x: number; y: number };
  /** World Y rotation so the building's local +Z is the street face: atan2(x, y) of
   *  frontDir (the world yaw convention the road furniture uses). */
  facing: number;
  /** Building shell footprint, world metres (fills ~60–80 % of the parcel). */
  footprint: { w: number; d: number };
  /** Storeys and the resulting wall height budget, metres (massing adds per-business
   *  flair on top; a GLB should reach roughly this eaves height). */
  storeys: number;
  wallHM: number;
  /** The walk-in entrance: the parcel's surveyed door cell (grid), and the door centre's
   *  offset from the building origin in the building's LOCAL frame (metres; +z = street). */
  entrance: { gx: number; gy: number; localX: number; localZ: number };
  /** Metres of clear frontage strip between the building face and the carriageway edge. */
  frontStripM: number;
  /** False when a junction pad swallowed the parcel — no building; the parcel renders as
   *  open forecourt and a GLB must NOT be dropped here. */
  buildable: boolean;
}

const KIND_META: Record<
  ShopParcel["kind"],
  { widthFrac: number; depthFrac: number; storeys: number }
> = {
  kiosk: { widthFrac: 0.8, depthFrac: 0.72, storeys: 1 },
  store: { widthFrac: 0.85, depthFrac: 0.75, storeys: 2 },
  showroom: { widthFrac: 0.85, depthFrac: 0.75, storeys: 2 },
};

const BUSINESS_VENUE_TYPE: Record<string, VenueType> = {
  nearest_bar: "bar",
  sprout_nursery: "nursery",
  sportifine_club: "club",
  chef_market: "market",
  citylife_garage: "garage",
  builder_studio: "studio",
};

export function venueTypeOf(parcel: ShopParcel): VenueType {
  if (parcel.business && BUSINESS_VENUE_TYPE[parcel.business])
    return BUSINESS_VENUE_TYPE[parcel.business]!;
  if (parcel.kind === "kiosk") return "kiosk";
  if (parcel.kind === "showroom") return "showroom";
  return "shop";
}

/** World-frame offset of a building-local point (three.js rotation.y convention). */
export function localToWorldOffset(
  lx: number,
  lz: number,
  facing: number,
): { x: number; z: number } {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

function worldToLocalOffset(
  wx: number,
  wz: number,
  facing: number,
): { x: number; z: number } {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x: wx * c - wz * s, z: wx * s + wz * c };
}

/** Axis-aligned rect (grid cells, centre + half extents) vs circle overlap. The survey's
 *  parcels front axis-aligned streets, so the building rects stay axis-aligned in grid
 *  space even though `facing` may flip them 180°. */
function rectHitsPad(
  cx: number,
  cy: number,
  halfX: number,
  halfY: number,
  pad: JunctionPad,
): boolean {
  const dx = Math.max(Math.abs(pad.cx - cx) - halfX, 0);
  const dy = Math.max(Math.abs(pad.cy - cy) - halfY, 0);
  return dx * dx + dy * dy < pad.r * pad.r;
}

/** The ONE seat formula, re-exported at the venue contract's altitude: a venue building
 *  (primitive massing today, Jack's GLB tomorrow) seats at EXACTLY the height the terrain
 *  leveling grades its parcel pad to — padSeatY, spec 128. */
export function venueSeatY(t: Terrain, p: VenuePlacement): number {
  return padSeatY(t, p.parcel.x, p.parcel.y, p.parcel.w, p.parcel.h);
}

/** The cells a venue building may not cover: everything the road RIBBON actually renders
 *  over (the same quantized coverage the terrain leveling grades, spec 130) — the fronting
 *  street's setback alone can't protect a corner parcel from the CROSS street's ribbon
 *  sweeping its flank. Heights are irrelevant here; only the keys are kept. */
export function venueRoadBlockedCells(
  ways: readonly RoadWay[] | undefined,
  t: Terrain,
): ReadonlySet<string> {
  const cover = ribbonCoverage(
    (ways ?? []) as RoadWay[],
    t,
    (x, y) => getSmoothRoadY(t, x, y),
  );
  return new Set(cover.keys());
}

/** Survey every parcel of the commercial district into a venue placement. Pure and
 *  deterministic in (district, junctionPads, blocked): the renderer, the runtime and the
 *  tests must all call this with the same inputs and get byte-identical answers. */
export function surveyVenuePlacements(
  district: Pick<CommercialDistrict, "parcels" | "street">,
  junctionPads: readonly JunctionPad[] = [],
  blocked: ReadonlySet<string> = new Set(),
): VenuePlacement[] {
  const out: VenuePlacement[] = [];
  const streetByX = new Map<number, number[]>();
  for (const c of district.street) {
    let ys = streetByX.get(c.x);
    if (!ys) streetByX.set(c.x, (ys = []));
    ys.push(c.y);
  }

  for (const p of district.parcels) {
    const meta = KIND_META[p.kind];
    const parcelCX = p.x + (p.w - 1) / 2;
    const parcelCY = p.y + (p.h - 1) / 2;

    // Face the fronting road. The door cell sits on the parcel's street-facing row by
    // survey construction, so door-minus-centre IS the survey's own answer for which way
    // the street lies; snap to the dominant axis so the facing is a clean quarter-turn.
    let fx = p.doorX - parcelCX;
    let fy = p.doorY - parcelCY;
    if (Math.abs(fx) >= Math.abs(fy) && fx !== 0) {
      fx = Math.sign(fx);
      fy = 0;
    } else {
      fy = fy !== 0 ? Math.sign(fy) : -p.side;
      fx = 0;
    }
    const frontDir = { x: fx, y: fy };
    const facing = Math.atan2(frontDir.x, frontDir.y);

    // The fronting street row: the surveyed street cell nearest the door (falls back to
    // the survey geometry — door + (SETBACK+1) toward the street — when the street list
    // is empty, e.g. a synthetic district in a unit test).
    const doorStreetYs = streetByX.get(p.doorX);
    let streetOrd: number;
    if (frontDir.y !== 0) {
      streetOrd =
        doorStreetYs && doorStreetYs.length > 0
          ? doorStreetYs.reduce((best, y) =>
              Math.abs(y - p.doorY) < Math.abs(best - p.doorY) ? y : best,
            )
          : p.doorY + frontDir.y * 2;
    } else {
      // x-fronting parcels (none surveyed today, but the contract allows them)
      streetOrd = p.doorX + frontDir.x * 2;
    }

    // Everything below works on the depth axis in METRES measured from the street
    // centre-line, positive into the parcel.
    const doorOrd = frontDir.y !== 0 ? p.doorY : p.doorX;
    const parcelDepthM = (frontDir.y !== 0 ? p.h : p.w) * CELL_M;
    const parcelWidthM = (frontDir.y !== 0 ? p.w : p.h) * CELL_M;
    const frontBoundaryM = (Math.abs(doorOrd - streetOrd) - 0.5) * CELL_M;
    const backBoundaryM = frontBoundaryM + parcelDepthM;
    const carriagewayEdgeM = ROAD_HALF_CELLS * CELL_M;

    // Building face: a clear pavement strip past the carriageway edge, never in front of
    // the parcel's own boundary.
    const faceM = Math.max(
      carriagewayEdgeM + FRONT_STRIP_M,
      frontBoundaryM + 0.5,
    );
    const availDepthM = backBoundaryM - BACK_MARGIN_M - faceM;
    let depthM = Math.min(meta.depthFrac * parcelDepthM, availDepthM);
    let widthM = Math.min(
      meta.widthFrac * parcelWidthM,
      parcelWidthM - 2 * SIDE_MARGIN_M,
    );

    // Junction pads + ribbon-covered cells: slide the building along its frontage away
    // from the obstruction, then shrink, then give up and leave the parcel open (nothing
    // may stand inside a junction's bound or under any road's ribbon).
    const centreDepthM = faceM + Math.max(depthM, 0) / 2;
    let alongOffM = 0; // metres along the frontage axis from the parcel centre
    let buildable = depthM >= MIN_BODY_M && widthM >= MIN_BODY_M;
    if (buildable && (junctionPads.length > 0 || blocked.size > 0)) {
      const tryPlace = (offM: number, wM: number): boolean => {
        const halfAlong = wM / 2 / CELL_M;
        const halfDepth = depthM / 2 / CELL_M;
        // grid centre for this candidate
        const depthCells = centreDepthM / CELL_M;
        const gx =
          frontDir.y !== 0
            ? parcelCX + offM / CELL_M
            : streetOrd - frontDir.x * depthCells;
        const gy =
          frontDir.y !== 0
            ? streetOrd - frontDir.y * depthCells
            : parcelCY + offM / CELL_M;
        const hx = frontDir.y !== 0 ? halfAlong : halfDepth;
        const hy = frontDir.y !== 0 ? halfDepth : halfAlong;
        if (junctionPads.some((pad) => rectHitsPad(gx, gy, hx, hy, pad)))
          return false;
        if (blocked.size > 0) {
          // every grid cell the footprint covers (slightly inset, mirroring the mesh
          // probes) must be clear of the ribbon coverage
          for (
            let cx = Math.round(gx - hx + 0.05);
            cx <= Math.round(gx + hx - 0.05);
            cx++
          )
            for (
              let cy = Math.round(gy - hy + 0.05);
              cy <= Math.round(gy + hy - 0.05);
              cy++
            )
              if (blocked.has(`${cx},${cy}`)) return false;
        }
        return true;
      };
      let placed = false;
      outer: for (const wM of [widthM, widthM * 0.85, widthM * 0.7]) {
        if (wM < MIN_BODY_M) break;
        const slack = Math.max(0, (parcelWidthM - wM) / 2 - SIDE_MARGIN_M);
        for (let off = 0; off <= slack; off += CELL_M / 2) {
          for (const sgn of off === 0 ? [1] : [-1, 1]) {
            if (tryPlace(sgn * off, wM)) {
              widthM = wM;
              alongOffM = sgn * off;
              placed = true;
              break outer;
            }
          }
        }
      }
      buildable = placed;
    }

    // Grid centre of the building footprint.
    const depthCells = centreDepthM / CELL_M;
    const centerGX =
      frontDir.y !== 0
        ? parcelCX + alongOffM / CELL_M
        : streetOrd - frontDir.x * depthCells;
    const centerGY =
      frontDir.y !== 0
        ? streetOrd - frontDir.y * depthCells
        : parcelCY + alongOffM / CELL_M;

    // Entrance: the surveyed door cell, expressed in the building's local frame (the door
    // stays on the parcel's frontage row; clamp its along-frontage offset inside the shell
    // so a slid building keeps its own door).
    const doorWorldDX = (p.doorX - centerGX) * CELL_M;
    const doorWorldDZ = (p.doorY - centerGY) * CELL_M;
    const doorLocal = worldToLocalOffset(doorWorldDX, doorWorldDZ, facing);
    const entranceLocalX = Math.max(
      -widthM / 2 + DOOR_W_M,
      Math.min(widthM / 2 - DOOR_W_M, doorLocal.x),
    );

    out.push({
      parcelId: p.id,
      businessId: p.business,
      venueType: venueTypeOf(p),
      parcel: { x: p.x, y: p.y, w: p.w, h: p.h },
      centerGX,
      centerGY,
      frontDir,
      facing,
      footprint: {
        w: Math.max(0, widthM),
        d: Math.max(0, depthM),
      },
      storeys: meta.storeys,
      wallHM: meta.storeys * STOREY_M,
      entrance: {
        gx: p.doorX,
        gy: p.doorY,
        localX: entranceLocalX,
        localZ: Math.max(0, depthM) / 2,
      },
      frontStripM: faceM - carriagewayEdgeM,
      buildable,
    });
  }
  return out;
}

/** The bar's stool positions in GRID coords — the SHARED formula: the runtime sends
 *  citizens to exactly the spots the layer renders stools at (the old pair drifted, and
 *  the runtime's copy parked sitters on the carriageway). Stools stand on the frontage
 *  strip, facing the counter at the building's street face. */
export function barStoolGridPositions(
  p: VenuePlacement,
  count = 3,
): { x: number; y: number }[] {
  const seats: { x: number; y: number }[] = [];
  for (let k = 0; k < count; k++) {
    const lx = p.entrance.localX + (k - (count - 1) / 2) * BAR_STOOL_SPACING_M;
    const lz = p.footprint.d / 2 + BAR_STOOL_OFF_M;
    const w = localToWorldOffset(lx, lz, p.facing);
    seats.push({
      x: p.centerGX + w.x / CELL_M,
      y: p.centerGY + w.z / CELL_M,
    });
  }
  return seats;
}

/** Map the live junction zones (whatever generation of the road layer is mounted) to the
 *  no-build pads: prefer the junction-caps `rBound` when present, else the spec-127 slab
 *  `half` plus an apron margin. */
export function junctionZonesToPads(
  zones: readonly {
    cx: number;
    cy: number;
    half?: number;
    rBound?: number;
  }[],
): JunctionPad[] {
  return zones.map((z) => ({
    cx: z.cx,
    cy: z.cy,
    r: (z.rBound ?? (z.half ?? 2) + 1) + 0.5,
  }));
}
