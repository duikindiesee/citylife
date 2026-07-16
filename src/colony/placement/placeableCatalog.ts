import { BIG, COMPACT, ESTATE, GRAND, type ParcelSize } from "../neighborhood";
import { Biome } from "../terrain";

export type PlacementOrientation = "n" | "s" | "e" | "w";
export type ZonedPlotSize = "COMPACT" | "BIG" | "ESTATE" | "GRAND";
export type PlacementZone = "residential" | "commercial";

export interface PlaceableTerrainPolicy {
  readonly water: "forbid" | "allow" | "require";
  readonly shore: "forbid" | "allow" | "require";
  readonly minBuildability: 0 | 1 | 2;
  readonly minElevation?: number;
  readonly maxElevation?: number;
  readonly maxRelief?: number;
  readonly forbiddenBiomes?: readonly Biome[];
}

export interface PlaceableVerticalPolicy {
  readonly minOffset: number;
  readonly maxOffset: number;
  readonly clearanceBelow: number;
  readonly clearanceAbove: number;
}

export interface PlaceableDefinition {
  readonly id: string;
  readonly kind: "zoned-plot" | "road";
  readonly footprint:
    | {
        readonly type: "front-centred-rectangle";
        readonly width: number;
        readonly depth: number;
      }
    | { readonly type: "supplied-cells" };
  readonly vertical: PlaceableVerticalPolicy;
  readonly terrain: PlaceableTerrainPolicy;
  readonly requiresRoadConnection: boolean;
  readonly renderedRoadClearanceCells: number;
  readonly allowedZones?: readonly PlacementZone[];
}

const PARCEL_SIZES: Readonly<Record<ZonedPlotSize, ParcelSize>> = Object.freeze(
  {
    COMPACT,
    BIG,
    ESTATE,
    GRAND,
  },
);

const PLOT_VERTICAL: PlaceableVerticalPolicy = Object.freeze({
  minOffset: 0,
  // A plot reservation owns the future low-rise building volume as well as the ground.
  maxOffset: 16,
  clearanceBelow: 0,
  clearanceAbove: 2,
});

const ROAD_VERTICAL: PlaceableVerticalPolicy = Object.freeze({
  minOffset: 0,
  maxOffset: 0.5,
  clearanceBelow: 1,
  clearanceAbove: 4.5,
});

const DRY_PLOT_TERRAIN: PlaceableTerrainPolicy = Object.freeze({
  water: "forbid",
  shore: "forbid",
  minBuildability: 1,
  minElevation: 0.2,
  maxRelief: 1.7,
  forbiddenBiomes: Object.freeze([Biome.Mountain, Biome.Peak]),
});

const DRY_ROAD_TERRAIN: PlaceableTerrainPolicy = Object.freeze({
  water: "forbid",
  shore: "forbid",
  minBuildability: 1,
  forbiddenBiomes: Object.freeze([Biome.Mountain, Biome.Peak]),
});

export function parcelSize(name: ZonedPlotSize): ParcelSize {
  return PARCEL_SIZES[name];
}

export function zonedPlotDefinition(
  zone: PlacementZone,
  sizeName: ZonedPlotSize,
): PlaceableDefinition {
  const size = parcelSize(sizeName);
  return Object.freeze({
    id: `zoned-plot:${zone}:${sizeName.toLowerCase()}`,
    kind: "zoned-plot",
    footprint: Object.freeze({
      type: "front-centred-rectangle" as const,
      width: size.W,
      depth: size.D,
    }),
    vertical: PLOT_VERTICAL,
    terrain: DRY_PLOT_TERRAIN,
    requiresRoadConnection: true,
    renderedRoadClearanceCells: 0,
    allowedZones: Object.freeze([zone]),
  });
}

export const ROAD_PLACEABLES: Readonly<
  Record<"street" | "gravel" | "culdesac", PlaceableDefinition>
> = Object.freeze({
  street: Object.freeze({
    id: "road:street",
    kind: "road",
    footprint: Object.freeze({ type: "supplied-cells" as const }),
    vertical: ROAD_VERTICAL,
    terrain: DRY_ROAD_TERRAIN,
    requiresRoadConnection: false,
    renderedRoadClearanceCells: 0,
  }),
  gravel: Object.freeze({
    id: "road:gravel",
    kind: "road",
    footprint: Object.freeze({ type: "supplied-cells" as const }),
    vertical: ROAD_VERTICAL,
    terrain: DRY_ROAD_TERRAIN,
    requiresRoadConnection: false,
    renderedRoadClearanceCells: 0,
  }),
  culdesac: Object.freeze({
    id: "road:culdesac",
    kind: "road",
    footprint: Object.freeze({ type: "supplied-cells" as const }),
    vertical: ROAD_VERTICAL,
    terrain: DRY_ROAD_TERRAIN,
    requiresRoadConnection: false,
    renderedRoadClearanceCells: 0,
  }),
});

export const PLACEABLE_CATALOG = Object.freeze({
  road: ROAD_PLACEABLES,
  zonedPlot: Object.freeze({
    residential: Object.freeze({
      COMPACT: zonedPlotDefinition("residential", "COMPACT"),
      BIG: zonedPlotDefinition("residential", "BIG"),
      ESTATE: zonedPlotDefinition("residential", "ESTATE"),
      GRAND: zonedPlotDefinition("residential", "GRAND"),
    }),
    commercial: Object.freeze({
      COMPACT: zonedPlotDefinition("commercial", "COMPACT"),
      BIG: zonedPlotDefinition("commercial", "BIG"),
      ESTATE: zonedPlotDefinition("commercial", "ESTATE"),
      GRAND: zonedPlotDefinition("commercial", "GRAND"),
    }),
  }),
});
