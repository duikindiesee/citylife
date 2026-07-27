// ARCADE.2A — proves the Gamehouse venue is wired into the LIVE runtime world layout (not authoring/
// test-only). A seeded ColonyRuntime that fronts the governed kooker_gamehouse plot must, on its seed
// capture, carry the venue's building frame plus the inverse enter/exit door portals anchored on the
// plot's door — so the portals live in the runtime portal lifecycle. The append must preserve the
// plot's ownership + coordinates and must be idempotent (a re-capture never doubles the venue).
import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { resolveGamehousePortalSite } from "../src/colony/spatial/gamehousePortal";
import { GAMEHOUSE_LOCAL_ID } from "../src/colony/spatial/gamehouseInterior";
import {
  createWorldLayoutDocument,
  type WorldLayoutDocumentInput,
} from "../src/colony/spatial/worldLayoutDocument";
import type { GamehousePortalSite } from "../src/colony/spatial/gamehousePortal";

const BUILDING_SUFFIX = `:building:${GAMEHOUSE_LOCAL_ID}`;

/** Find a seed whose surveyed commercial district actually fronts the governed Gamehouse plot, so the
 *  wiring assertion runs against a real seeded world rather than a hand-built fixture. */
function seededRuntimeWithGamehouse(): {
  runtime: ColonyRuntime;
  site: GamehousePortalSite;
  seed: number;
} | null {
  for (let seed = 1; seed <= 800; seed++) {
    const runtime = new ColonyRuntime(seed);
    const district = runtime.commercialDistrict;
    const site = district ? resolveGamehousePortalSite(district) : null;
    if (site) return { runtime, site, seed };
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
    const enter = venuePortals.find((p) =>
      p.toFrameId.includes(BUILDING_SUFFIX),
    )!;
    const exit = venuePortals.find((p) =>
      p.fromFrameId.includes(BUILDING_SUFFIX),
    )!;
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
    const countVenuePortals = (
      doc: ReturnType<ColonyRuntime["captureWorldLayout"]>,
    ) =>
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

// ARCADE.2A — the DELIBERATE existing-world migration boundary. The venue is appended ONLY on the fresh
// seed path (no active layout); a world hydrated from a pre-feature durable layout is carried through
// verbatim and is NOT backfilled with the venue. This is an intentional decision (the flag is globally
// OFF, so an un-migrated world is behaviourally identical for every user today) recorded as a governed
// follow-up rather than a silent gap. These tests LOCK that boundary so a future change is a conscious one.
describe("ARCADE.2A — existing hydrated worlds are intentionally NOT backfilled (governed follow-up)", () => {
  const references = (value: unknown, needle: string): boolean =>
    JSON.stringify(value ?? null).includes(needle);

  it("does not fabricate the venue when re-capturing a hydrated pre-feature world", () => {
    const found = seededRuntimeWithGamehouse();
    expect(found).not.toBeNull();
    const { runtime, seed } = found!;

    // A pre-feature durable layout: the SAME seeded world (its district still fronts the Gamehouse plot),
    // but persisted before the venue existed — so its document carries no venue building/portals/cabinet.
    const seedDoc = runtime.captureWorldLayout();
    // Rebuild through createWorldLayoutDocument so the revision content-hash is recomputed for the
    // venue-free layout (a hand-edited copy would fail the durable digest check on hydration).
    const legacyDoc = createWorldLayoutDocument({
      ...(seedDoc as unknown as WorldLayoutDocumentInput),
      frames: seedDoc.frames.filter((f) => !references(f, GAMEHOUSE_LOCAL_ID)),
      portals: seedDoc.portals.filter(
        (p) => !references(p, GAMEHOUSE_LOCAL_ID),
      ),
      placements: seedDoc.placements.filter(
        (p) => !references(p, GAMEHOUSE_LOCAL_ID),
      ),
    });
    // Sanity: the fixture really is venue-free before hydration.
    expect(legacyDoc.frames.some((f) => f.id.endsWith(BUILDING_SUFFIX))).toBe(
      false,
    );

    // A fresh runtime on the same seed hydrates the legacy layout, then re-captures.
    const revived = new ColonyRuntime(seed);
    revived.hydrateWorldLayout(legacyDoc);
    const recaptured = revived.captureWorldLayout();

    // The boundary: hydration + re-capture never appends the venue to an existing world.
    expect(recaptured.frames.some((f) => f.id.endsWith(BUILDING_SUFFIX))).toBe(
      false,
    );
    expect(
      recaptured.portals.filter(
        (p) =>
          p.fromFrameId.includes(BUILDING_SUFFIX) ||
          p.toFrameId.includes(BUILDING_SUFFIX),
      ),
    ).toHaveLength(0);
  });
});
