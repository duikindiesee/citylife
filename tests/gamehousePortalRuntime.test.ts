// ARCADE.2A — proves the Gamehouse venue is wired into the LIVE runtime world layout (not authoring/
// test-only). A seeded ColonyRuntime that fronts the governed kooker_gamehouse plot must, on its seed
// capture, carry the venue's building frame plus the inverse enter/exit door portals anchored on the
// plot's door — so the portals live in the runtime portal lifecycle. The append must preserve the
// plot's ownership + coordinates and must be idempotent (a re-capture never doubles the venue).
import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { resolveGamehousePortalSite } from "../src/colony/spatial/gamehousePortal";
import { GAMEHOUSE_LOCAL_ID } from "../src/colony/spatial/gamehouseInterior";
import type { GamehousePortalSite } from "../src/colony/spatial/gamehousePortal";

const BUILDING_SUFFIX = `:building:${GAMEHOUSE_LOCAL_ID}`;

/** Find a seed whose surveyed commercial district actually fronts the governed Gamehouse plot, so the
 *  wiring assertion runs against a real seeded world rather than a hand-built fixture. */
function seededRuntimeWithGamehouse(): {
  runtime: ColonyRuntime;
  site: GamehousePortalSite;
} | null {
  for (let seed = 1; seed <= 800; seed++) {
    const runtime = new ColonyRuntime(seed);
    const district = runtime.commercialDistrict;
    const site = district ? resolveGamehousePortalSite(district) : null;
    if (site) return { runtime, site };
  }
  return null;
}

describe("ARCADE.2A — the Gamehouse venue is wired into the live runtime world layout", () => {
  it("appends the venue building + inverse enter/exit portals on the governed plot door", () => {
    const found = seededRuntimeWithGamehouse();
    // A seed within range must front the Gamehouse — otherwise the wiring can never be exercised live.
    expect(found).not.toBeNull();
    const { runtime, site } = found!;

    const doc = runtime.captureWorldLayout();

    // The venue building frame is present in the live layout.
    const building = doc.frames.find((f) => f.id.endsWith(BUILDING_SUFFIX));
    expect(building).toBeDefined();

    // Exactly the enter/exit door portal pair connects the surface to the venue's building graph.
    const venuePortals = doc.portals.filter(
      (p) =>
        p.fromFrameId.includes(BUILDING_SUFFIX) ||
        p.toFrameId.includes(BUILDING_SUFFIX),
    );
    expect(venuePortals).toHaveLength(2);

    // One enters (surface → venue) and one exits (venue → surface); they are exact inverses, so
    // entering then exiting returns the player to the governed plot without moving coordinates.
    const enter = venuePortals.find((p) => p.toFrameId.includes(BUILDING_SUFFIX))!;
    const exit = venuePortals.find((p) => p.fromFrameId.includes(BUILDING_SUFFIX))!;
    expect(enter).toBeDefined();
    expect(exit).toBeDefined();
    expect(enter.fromFrameId).toBe(exit.toFrameId);
    expect(enter.toFrameId).toBe(exit.fromFrameId);
    expect(enter.from).toEqual(exit.to);
    expect(enter.to).toEqual(exit.from);

    // Ownership + door coordinates on the governed plot are untouched by wiring the venue.
    const parcel = runtime.commercialDistrict!.parcels.find(
      (p) => p.business === "kooker_gamehouse",
    )!;
    expect(parcel.doorX).toBe(site.entranceCell.x);
    expect(parcel.doorY).toBe(site.entranceCell.y);
    expect(parcel.ownerCitizenId ?? null).toBe(site.ownerCitizenId);
  });

  it("is idempotent — a re-capture of the seed layout never doubles the venue", () => {
    const found = seededRuntimeWithGamehouse();
    expect(found).not.toBeNull();
    const { runtime } = found!;

    const first = runtime.captureWorldLayout();
    const second = runtime.captureWorldLayout();
    const countVenuePortals = (doc: ReturnType<ColonyRuntime["captureWorldLayout"]>) =>
      doc.portals.filter(
        (p) =>
          p.fromFrameId.includes(BUILDING_SUFFIX) ||
          p.toFrameId.includes(BUILDING_SUFFIX),
      ).length;
    const countBuildingFrames = (
      doc: ReturnType<ColonyRuntime["captureWorldLayout"]>,
    ) => doc.frames.filter((f) => f.id.endsWith(BUILDING_SUFFIX)).length;

    expect(countVenuePortals(first)).toBe(2);
    expect(countVenuePortals(second)).toBe(2);
    expect(countBuildingFrames(first)).toBe(1);
    expect(countBuildingFrames(second)).toBe(1);
  });
});
