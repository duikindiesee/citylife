// Spec 081 P0 — ad boards at the commercial zone edge. A PURE, deterministic survey of billboard
// sites at the approaches to the high street, each facing down the strip and advertising one real
// shop (assigned by a deterministic rotation over the surveyed plots). Mirrors the district survey's
// discipline: every cell is gated through cellOk (the shared land contract), collision-checked against
// a blocked set (roads + shop footprints) so a board never lands on a road or a shopfront, and the
// whole thing is a pure function of (district, terrain, blocked, rotation) — no Date.now, no
// Math.random — so it replays identically and is node-testable. The renderer paints the canvas poster
// (adCanvas) onto each board; the async generated-image swap (P2) is runtime data, never sim state.
import { cellOk } from "../pathfind";
import type { Terrain } from "../terrain";
import type { CommercialDistrict } from "./district";

export interface BoardSite {
  id: string;
  /** The board's ground cell (on the open approach beyond a street end). */
  x: number;
  y: number;
  /** Direction the screen faces along the street axis: +1 faces +x, -1 faces -x (always toward the strip). */
  faceX: 1 | -1;
  /** The advertised shop's parcel id, or null for the welcome PSA card when no shops exist. */
  shopId: string | null;
}

const BOARD_COUNT = 3; // adBoardCount default (spec 081)
const APPROACH_MAX = 18; // how far beyond a street end to search outward (room for spaced boards)
const MIN_SPACING = 6; // adBoardSpacing — min cells between any two boards, so none ever sits behind another
const PERP_TRIES = [0, -3, 3, -6, 6]; // perpendicular offsets tried at each approach distance (flanking the centreline)

/** Survey the billboard sites. Boards stand at the two approaches to the high street (its open zone
 *  edges), facing inward down the strip, on dry unclaimed ground. Deterministic in all inputs;
 *  `blocked` is the road + shop-footprint cells a board must avoid. `rotation` is the ad rotation
 *  index (colony state in later phases; 0 at P0) so two clients with the same state show the same ads. */
export function surveyBillboards(
  d: CommercialDistrict,
  t: Terrain,
  blocked: ReadonlySet<string> = new Set(),
  rotation = 0,
): BoardSite[] {
  const street = d.street;
  if (street.length === 0) return [];
  const ys = street[0]!.y; // the high street is a horizontal midline (constant y)
  let minX = Infinity,
    maxX = -Infinity;
  for (const c of street) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
  }
  // The two approaches: just beyond each street end, board screen facing inward (into the strip).
  const ends: { fromX: number; step: 1 | -1; faceX: 1 | -1 }[] = [
    { fromX: minX, step: -1, faceX: 1 }, // left approach -> screen faces +x
    { fromX: maxX, step: 1, faceX: -1 }, // right approach -> screen faces -x
  ];
  const shops = d.parcels.map((p) => p.id);
  const sites: BoardSite[] = [];
  // A candidate is only allowed if it stands MIN_SPACING (Manhattan) clear of every board already
  // placed — this is what stops two boards landing a cell apart (one behind the other).
  const farEnough = (x: number, y: number) =>
    sites.every((s) => Math.abs(s.x - x) + Math.abs(s.y - y) >= MIN_SPACING);
  // Round-robin the two ends, marching outward, so the boards spread to whichever approaches are open.
  for (
    let ring = 2;
    ring <= APPROACH_MAX && sites.length < BOARD_COUNT;
    ring++
  ) {
    for (const e of ends) {
      if (sites.length >= BOARD_COUNT) break;
      const bx = e.fromX + e.step * ring;
      for (const perp of PERP_TRIES) {
        const by = ys + perp;
        if (!cellOk(t, bx, by) || blocked.has(`${bx},${by}`)) continue;
        if (!farEnough(bx, by)) continue; // never stack / sit behind another board
        const shopId = shops.length
          ? shops[(rotation + sites.length) % shops.length]!
          : null;
        sites.push({
          id: `board_${sites.length}`,
          x: bx,
          y: by,
          faceX: e.faceX,
          shopId,
        });
        break;
      }
    }
  }
  return sites;
}
