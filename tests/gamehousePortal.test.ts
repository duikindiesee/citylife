// ARCADE.2A — deterministic tests for wiring the Gamehouse interior to its governed commercial plot.
// Asserts the site resolves from the kooker_gamehouse parcel, produces stable portal metadata, treats
// the plot read-only (ownership + coordinates preserved), and fails closed when no plot exists.
import { describe, expect, it } from "vitest";
import type {
  CommercialDistrict,
  ShopParcel,
} from "../src/colony/commerce/district";
import type {
  WorldLayoutDocumentInput,
  WorldLayoutFrame,
} from "../src/colony/spatial/worldLayoutDocument";
import {
  GAMEHOUSE_BUSINESS_ID,
  GamehousePortalError,
  buildGamehousePortalFragment,
  facingForShopSide,
  resolveGamehousePortalSite,
  withGamehousePortal,
} from "../src/colony/spatial/gamehousePortal";

const ZERO = { x: 0, y: 0, z: 0 } as const;
const IDENTITY = {
  position: ZERO,
  rotation: ZERO,
  scale: { x: 1, y: 1, z: 1 },
} as const;

function surfaceInput(): WorldLayoutDocumentInput {
  return {
    worldId: "gamehouse-portal-fixture",
    seed: 512,
    revision: { number: 0, parentHash: null },
    frames: [
      {
        id: "universe",
        address: "spatial://citylife",
        kind: "universe",
        layer: "deep-space",
        transform: IDENTITY,
      },
      {
        id: "surface",
        address: "spatial://citylife/world/gamehouse-portal-fixture/surface",
        kind: "region",
        layer: "surface",
        parentId: "universe",
        transform: IDENTITY,
        grid: {
          width: 16,
          height: 16,
          cellSize: 4,
          origin: { x: -32, y: 0, z: -32 },
        },
      },
    ],
    placements: [],
    roads: [],
    ways: [],
    terrainEdits: [],
    portals: [],
  };
}

function surfaceFrame(): WorldLayoutFrame {
  return surfaceInput().frames.find((f) => f.id === "surface")!;
}

function gamehouseParcel(overrides: Partial<ShopParcel> = {}): ShopParcel {
  return {
    id: "shop_3",
    kind: "store",
    x: 4,
    y: 8,
    w: 6,
    h: 5,
    side: 1,
    doorX: 6,
    doorY: 9,
    ownerCitizenId: "citizen-7",
    built: true,
    business: GAMEHOUSE_BUSINESS_ID,
    ...overrides,
  };
}

function district(parcels: ShopParcel[]): CommercialDistrict {
  return {
    street: [{ x: 6, y: 8 }],
    parcels,
    crossStreet: [{ x: 8, y: 6 }],
    mallPad: { x: 0, y: 0, w: 2, h: 2 },
    reserve: { x: 0, y: 0, w: 16, h: 16 },
  };
}

describe("ARCADE.2A — resolveGamehousePortalSite reads the governed Gamehouse plot", () => {
  it("derives the door cell + facing from the kooker_gamehouse parcel, read-only", () => {
    const parcel = gamehouseParcel();
    const site = resolveGamehousePortalSite(district([parcel]))!;
    expect(site).not.toBeNull();
    expect(site.parcelId).toBe("shop_3");
    expect(site.business).toBe(GAMEHOUSE_BUSINESS_ID);
    expect(site.entranceCell).toEqual({ x: 6, y: 9 });
    expect(site.facing).toBe("s"); // side +1 fronts +y → south-facing door
    expect(site.built).toBe(true);
    expect(site.ownerCitizenId).toBe("citizen-7");
    // The plot itself is never mutated by resolving the site.
    expect(parcel.ownerCitizenId).toBe("citizen-7");
    expect(parcel.doorX).toBe(6);
    expect(parcel.doorY).toBe(9);
    // Mutating the returned cell must not reach back into the parcel.
    site.entranceCell.x = 99;
    expect(parcel.doorX).toBe(6);
  });

  it("carries a null owner through verbatim and honors an unbuilt plot", () => {
    const site = resolveGamehousePortalSite(
      district([gamehouseParcel({ ownerCitizenId: undefined, built: false })]),
    )!;
    expect(site.ownerCitizenId).toBeNull();
    expect(site.built).toBe(false);
  });

  it("returns null (fail-closed) when the district has no Gamehouse plot", () => {
    const other = gamehouseParcel({ id: "shop_1", business: "plant_lab" });
    expect(resolveGamehousePortalSite(district([other]))).toBeNull();
    expect(resolveGamehousePortalSite(district([]))).toBeNull();
  });

  it("is deterministic — the same district yields byte-identical site metadata", () => {
    const d = district([gamehouseParcel()]);
    expect(JSON.stringify(resolveGamehousePortalSite(d))).toBe(
      JSON.stringify(resolveGamehousePortalSite(d)),
    );
  });

  it("maps street side to facing deterministically", () => {
    expect(facingForShopSide(1)).toBe("s");
    expect(facingForShopSide(-1)).toBe("n");
  });
});

describe("ARCADE.2A — buildGamehousePortalFragment anchors the venue on the plot door", () => {
  it("authors 2 frames, 2 inverse portals and 1 cabinet anchored on the door cell", () => {
    const { site, fragment } = buildGamehousePortalFragment(
      surfaceFrame(),
      district([gamehouseParcel()]),
    );
    expect(fragment.frames).toHaveLength(2);
    expect(fragment.portals).toHaveLength(2);
    expect(fragment.placements).toHaveLength(1);
    expect(site.entranceCell).toEqual({ x: 6, y: 9 });

    const [enter, exit] = fragment.portals;
    // The enter/exit portals are exact inverses — entering then exiting is identity.
    expect(enter!.from).toEqual(exit!.to);
    expect(enter!.to).toEqual(exit!.from);

    // The surface-local door point is the plot's door cell centre in surface grid space.
    // grid origin (-32) + (6 + 0.5) * 4 = -6 on x; (9 + 0.5) * 4 - 32 = 6 on z.
    expect(fragment.entrancePoint).toEqual({ x: -6, y: 0, z: 6 });
  });

  it("is deterministic — identical portal metadata across builds", () => {
    const d = district([gamehouseParcel()]);
    const a = buildGamehousePortalFragment(surfaceFrame(), d);
    const b = buildGamehousePortalFragment(surfaceFrame(), d);
    expect(JSON.stringify(a.fragment)).toBe(JSON.stringify(b.fragment));
    expect(a.fragment.buildingFrameId).toBe(
      "surface:building:kooker-gamehouse",
    );
  });

  it("throws NO_GAMEHOUSE_PARCEL when the district has no Gamehouse plot", () => {
    expect(() =>
      buildGamehousePortalFragment(surfaceFrame(), district([])),
    ).toThrow(GamehousePortalError);
    try {
      buildGamehousePortalFragment(surfaceFrame(), district([]));
    } catch (e) {
      expect((e as GamehousePortalError).code).toBe("NO_GAMEHOUSE_PARCEL");
    }
  });
});

describe("ARCADE.2A — withGamehousePortal appends the venue and preserves the world", () => {
  it("carries every original frame/portal/placement through untouched and in order", () => {
    const input = surfaceInput();
    const out = withGamehousePortal(input, district([gamehouseParcel()]));

    // Originals preserved head-of-list and unchanged.
    expect(out.frames.slice(0, input.frames.length)).toEqual(input.frames);
    expect(out.frames).toHaveLength(input.frames.length + 2);
    expect(out.portals).toHaveLength(input.portals.length + 2);
    expect(out.placements).toHaveLength(input.placements.length + 1); // +1 cabinet

    // The input document object is not mutated.
    expect(input.frames).toHaveLength(2);
    expect(input.portals).toHaveLength(0);
    expect(input.placements).toHaveLength(0);
  });

  it("throws NO_GAMEHOUSE_PARCEL when the district has no Gamehouse plot", () => {
    expect(() => withGamehousePortal(surfaceInput(), district([]))).toThrow(
      GamehousePortalError,
    );
  });
});
