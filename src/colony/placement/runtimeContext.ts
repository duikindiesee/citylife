import type { CommercialDistrict } from "../commerce/district";
import type { Neighborhood, Parcel } from "../neighborhood";
import { conservativeRoadRibbonBlockedCells } from "../placementValidation";
import type { RoadWay } from "../render/roadRibbon";
import type { ColonyState } from "../sim";
import type { GridBounds } from "../worldSurvey";
import type { PlacementContext } from "./surveyPlacement";

const key = (x: number, y: number): string => `${x},${y}`;

function addBounds(target: Set<string>, bounds: GridBounds): void {
  for (let y = bounds.y; y < bounds.y + bounds.h; y++)
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) target.add(key(x, y));
}

function parcelBounds(parcel: Pick<Parcel, "x" | "y" | "w" | "h">): GridBounds {
  return {
    x: parcel.x - Math.floor((parcel.w - 1) / 2),
    y: parcel.y - Math.floor((parcel.h - 1) / 2),
    w: parcel.w,
    h: parcel.h,
  };
}

function stableHash(tokens: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const token of [...tokens].sort())
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createPlacementContext(input: {
  state: ColonyState;
  neighborhood?: Neighborhood | null;
  commercialDistrict?: CommercialDistrict | null;
  roadWays?: readonly RoadWay[];
}): PlacementContext {
  const { state } = input;
  const logicalRoadCells = new Set(
    state.roads.map((road) => key(road.x, road.y)),
  );
  const renderedRoadCells = conservativeRoadRibbonBlockedCells(
    [...(input.roadWays ?? state.roadWays ?? [])],
    state.terrain,
  );
  const occupiedCells = new Set<string>();
  const reservedCells = new Set<string>();
  const revisionTokens = [`roadsVersion:${state.roadsVersion}`];

  const neighborhood = input.neighborhood ?? state.neighborhood;
  for (const parcel of neighborhood?.parcels ?? []) {
    addBounds(reservedCells, parcelBounds(parcel));
    revisionTokens.push(
      `parcel:${parcel.id}:${parcel.x}:${parcel.y}:${parcel.w}:${parcel.h}:${parcel.built}:${parcel.ownerCitizenId ?? ""}:${parcel.reservedFor ?? ""}`,
    );
  }
  for (const structure of state.structures) {
    // SeedStructure does not yet declare exact dimensions. Reserve the surveyed centre honestly;
    // WB.1d can widen it only after the persisted placeable record owns exact geometry.
    occupiedCells.add(key(structure.x, structure.y));
    revisionTokens.push(
      `structure:${structure.kind}:${structure.x}:${structure.y}`,
    );
  }
  for (const building of state.buildings) {
    occupiedCells.add(key(building.x, building.y));
    revisionTokens.push(`building:${building.id}:${building.x}:${building.y}`);
  }
  const commercial = input.commercialDistrict;
  for (const parcel of commercial?.parcels ?? []) {
    addBounds(reservedCells, parcel);
    revisionTokens.push(
      `commercial:${parcel.id}:${parcel.x}:${parcel.y}:${parcel.w}:${parcel.h}:${parcel.built}:${parcel.ownerCitizenId ?? ""}`,
    );
  }
  if (commercial?.mallPad) {
    addBounds(reservedCells, commercial.mallPad);
    revisionTokens.push(
      `mall:${commercial.mallPad.x}:${commercial.mallPad.y}:${commercial.mallPad.w}:${commercial.mallPad.h}`,
    );
  }
  if (commercial?.garagePad) {
    addBounds(reservedCells, commercial.garagePad);
    revisionTokens.push(
      `garage:${commercial.garagePad.x}:${commercial.garagePad.y}:${commercial.garagePad.w}:${commercial.garagePad.h}`,
    );
  }
  if (state.busDepotPad) {
    addBounds(reservedCells, state.busDepotPad);
    revisionTokens.push(
      `bus-depot:${state.busDepotPad.x}:${state.busDepotPad.y}:${state.busDepotPad.w}:${state.busDepotPad.h}`,
    );
  }
  for (const road of state.roads)
    revisionTokens.push(`road:${road.x}:${road.y}:${road.kind ?? "street"}`);

  return {
    terrain: state.terrain,
    layoutRevision: `layout-v1-${stableHash(revisionTokens)}`,
    logicalRoadCells,
    renderedRoadCells,
    occupiedCells,
    reservedCells,
  };
}
