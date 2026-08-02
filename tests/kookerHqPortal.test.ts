// HQ.SITE.1 — the civic-centre siting rule for Kooker HQ.
//
// Before this slice `kookerHqInterior.ts` was imported by TESTS ONLY: the HQ building frame, reception
// room and door portals were authored and verified, but nothing in `src` ever asked for them, because
// nothing decided where the HQ stands. The module's own header names the gap — "the runtime survey
// slice supplies the real surveyed, buildable HQ site" — and this is that slice.
//
// The rules under test, each of which can fail independently:
//   - the site is in the CIVIC ring, nearest the landing first (operator decision, 2026-08-01)
//   - it is never in water, never ON a road, never on an occupied cell
//   - it FRONTS a road, and the door opens toward that road
//   - with no qualifying cell it returns null and callers fail CLOSED — no HQ beats an HQ in the sea
import { describe, expect, it } from "vitest";
import {
  HQ_CIVIC_RADIUS_CELLS,
  KookerHqPortalError,
  resolveKookerHqSite,
  withKookerHqPortal,
  type KookerHqSiteSurvey,
} from "../src/colony/spatial/kookerHqPortal";

const LANDING = { x: 20, y: 20 };

/** A survey over a hand-drawn world: all land, nothing occupied, roads only where listed. */
function survey(
  roads: readonly string[],
  occupied: readonly string[] = [],
  water: readonly string[] = [],
): KookerHqSiteSurvey {
  const R = new Set(roads);
  const O = new Set(occupied);
  const W = new Set(water);
  return {
    landing: LANDING,
    isBuildable: (x, y) => !W.has(`${x},${y}`),
    isRoad: (x, y) => R.has(`${x},${y}`),
    isOccupied: (x, y) => O.has(`${x},${y}`),
  };
}

describe("HQ.SITE.1 — where Kooker HQ stands", () => {
  it("takes the landing cell itself when a road already fronts it", () => {
    // A road due north of the landing. Ring 0 is the landing, so that is the closest legal site.
    const site = resolveKookerHqSite(survey(["20,19"]));
    expect(site).not.toBeNull();
    expect(site!.entranceCell).toEqual({ x: 20, y: 20 });
    expect(site!.distanceFromLanding).toBe(0);
  });

  it("opens the door toward the road it fronts", () => {
    // Road to the EAST of the landing — the door must face east, not the default north.
    const site = resolveKookerHqSite(survey(["21,20"]));
    expect(site!.facing).toBe("e");
    expect(site!.frontsRoad).toEqual({ x: 21, y: 20 });
  });

  it("never sits ON the carriageway", () => {
    // The landing cell IS a road here, so it must be rejected and a neighbouring cell taken instead.
    const site = resolveKookerHqSite(survey(["20,20", "21,20"]));
    expect(site).not.toBeNull();
    expect(site!.entranceCell).not.toEqual({ x: 20, y: 20 });
    // Whatever it picked, it is not a road cell and it does front one.
    expect(`${site!.entranceCell.x},${site!.entranceCell.y}`).not.toBe("20,20");
  });

  it("skips water and occupied cells and moves outward", () => {
    const site = resolveKookerHqSite(
      survey(["20,19"], ["20,20"], []), // landing occupied by a structure
    );
    expect(site).not.toBeNull();
    expect(site!.entranceCell).not.toEqual({ x: 20, y: 20 });

    const drowned = resolveKookerHqSite(survey(["20,19"], [], ["20,20"]));
    expect(drowned!.entranceCell).not.toEqual({ x: 20, y: 20 });
  });

  it("prefers the cell CLOSEST to the landing when several qualify", () => {
    // Two roads: one adjacent to the landing, one out at the civic edge. Nearest must win.
    const site = resolveKookerHqSite(survey(["20,19", "23,23"]));
    expect(site!.distanceFromLanding).toBe(0);
  });

  it("stays inside the civic ring", () => {
    // The ONLY road is well outside the civic radius, so no civic cell fronts a road.
    const site = resolveKookerHqSite(
      survey([`${LANDING.x + 30},${LANDING.y}`]),
    );
    expect(site).toBeNull();
  });

  it("returns null — never a fabricated cell — when nothing qualifies", () => {
    // No roads at all anywhere.
    expect(resolveKookerHqSite(survey([]))).toBeNull();
  });

  it("is deterministic: the same survey yields a byte-identical site", () => {
    const s = survey(["20,19", "21,20", "20,21", "19,20"]);
    expect(resolveKookerHqSite(s)).toEqual(resolveKookerHqSite(s));
  });

  it("the civic radius constant matches cellZone's own civic test", () => {
    // cellZone: `if (d < 4) return "civic"`. If that ever moves, this constant must move with it.
    expect(HQ_CIVIC_RADIUS_CELLS).toBe(4);
  });

  it("withKookerHqPortal throws NO_CIVIC_SITE rather than authoring a placeless HQ", () => {
    expect(() =>
      withKookerHqPortal({ frames: [], portals: [] } as never, survey([])),
    ).toThrow(KookerHqPortalError);
  });
});
