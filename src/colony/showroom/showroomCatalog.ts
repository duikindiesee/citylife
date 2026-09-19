// PLAYER.GARAGE.1 — the showroom's vehicle catalog: existing procedural CarSpec vehicles under the
// approved fictional Karoo Motors marque (operator decision 2026-07-21). No real manufacturer name,
// badge or trade dress may ever appear here; names must pass the public-safety screen. Prices are
// PLANNED display values from the accepted scenario-B economy baseline — nothing here can debit KCO.
import type { CarSpec, CarStatVector } from "../car/carSpec";

export interface ShowroomVehicle {
  /** The procedural car the plinth renders. */
  readonly spec: CarSpec;
  /** Public marque + model name (fictional, screened). */
  readonly publicName: string;
  /** Player-facing class line on the specification card. */
  readonly vehicleClass: string;
  /** PLANNED price in KCO for display only — acquisition is preview-only in this slice. */
  readonly plannedPriceK: number;
  /** One-line character blurb for the card. */
  readonly blurb: string;
  /** Optional custom 3D model asset URL (e.g. GLB) rendered on the plinth. */
  readonly glbUrl?: string;
  /** Optional scale factor for presentation on the showroom plinth. Defaults to 0.56 if glbUrl provided. */
  readonly presentationScale?: number;
  /** Optional rotation offset [x, y, z] in radians. */
  readonly rotationOffset?: readonly [number, number, number];
}

const VONK_STATS: CarStatVector = {
  topSpeed: 0.38,
  acceleration: 0.42,
  grip: 0.55,
  braking: 0.5,
};

const KAAP_STATS: CarStatVector = {
  topSpeed: 0.82,
  acceleration: 0.78,
  grip: 0.6,
  braking: 0.62,
};

const X19_STATS: CarStatVector = {
  topSpeed: 0.65,
  acceleration: 0.62,
  grip: 0.85,
  braking: 0.72,
};

/** The showroom catalog vehicles. Order is the carousel order. */
export const SHOWROOM_VEHICLES: readonly ShowroomVehicle[] = [
  {
    spec: {
      id: "showroom:karoo-vonk-11",
      name: "Karoo Vonk 1.1",
      stats: VONK_STATS,
      paint: { body: 0x4d8be0, cabin: 0x2a2d33, accent: 0xf4f4f0 },
      parts: [],
    },
    publicName: "Karoo Vonk 1.1",
    vehicleClass: "Compact starter hatch",
    plannedPriceK: 250,
    blurb: "An honest little hatch: cheap to run, happy on gravel.",
    glbUrl: "/assets/citylife/cars/karoo_vonk.glb",
    presentationScale: 0.54,
    rotationOffset: [0, -Math.PI / 2, 0],
  },
  {
    spec: {
      id: "showroom:karoo-kaap-gt-v8",
      name: "Karoo Kaap GT-V8",
      stats: KAAP_STATS,
      paint: { body: 0xd64545, cabin: 0x1f3a52, accent: 0xffd25a },
      parts: [],
    },
    publicName: "Karoo Kaap GT-V8",
    vehicleClass: "Heritage V8 coupe",
    plannedPriceK: 2400,
    blurb: "The aspirational eight — thunder for the coast road.",
    glbUrl: "/assets/citylife/cars/karoo_kaap_gt.glb",
    presentationScale: 0.48,
    rotationOffset: [0, -Math.PI / 2, 0],
  },
  {
    spec: {
      id: "showroom:karoo-x19-targa",
      name: "Karoo X19 Targa",
      stats: X19_STATS,
      paint: { body: 0xf5cf0a, cabin: 0x08080a, accent: 0x111115 },
      parts: [],
    },
    publicName: "Karoo X19 Targa",
    vehicleClass: "Heritage sports targa",
    plannedPriceK: 950,
    blurb:
      "A mid-engine wedge targa: agile poise, pop-up lights, built for the winding mountain pass.",
    glbUrl: "/assets/citylife/cars/fiat_x19.glb",
    presentationScale: 0.56,
    rotationOffset: [0, -Math.PI / 2, 0],
  },
] as const;

export interface ShowroomCardStat {
  readonly label: string;
  readonly pct: number;
}

export interface ShowroomCardModel {
  readonly name: string;
  readonly vehicleClass: string;
  readonly priceLabel: string;
  readonly stats: readonly ShowroomCardStat[];
  readonly blurb: string;
  /** Always true in this slice — the acquire action is preview-only and never posts anywhere. */
  readonly acquirePreviewOnly: true;
}

/** Pure card view-model so the specification card content is testable without a DOM. */
export function showroomCardModel(v: ShowroomVehicle): ShowroomCardModel {
  return {
    name: v.publicName,
    vehicleClass: v.vehicleClass,
    priceLabel: `₭${v.plannedPriceK} · planned`,
    stats: [
      { label: "Top speed", pct: Math.round(v.spec.stats.topSpeed * 100) },
      {
        label: "Acceleration",
        pct: Math.round(v.spec.stats.acceleration * 100),
      },
      { label: "Grip", pct: Math.round(v.spec.stats.grip * 100) },
      { label: "Braking", pct: Math.round(v.spec.stats.braking * 100) },
    ],
    blurb: v.blurb,
    acquirePreviewOnly: true,
  };
}
