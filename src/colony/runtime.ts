// Browser runtime for the colony: fixed-timestep sim loop + planet renderer + camera presets.
import { COLONY } from "./config";
import { ColonySim } from "./sim";
import { PlanetRenderer, type CameraPreset, type ViewMode, type AvatarView } from "./render/R3FPlanetRenderer";
import { Biome } from "./terrain";
import {
  autoGrow,
  freeLabour,
  housingCapacity,
  wateredFraction,
  provisionedFraction,
  housingTierCounts,
  healthFraction,
  cultureFraction,
  colonyLiveability,
  surveyAvailable,
  tradeExportRate,
  cultureFuelFactor,
  courierAvailable,
  colonyHeadlines,
  inBrownout,
  pollutedFraction,
  commute,
  maintenanceStatus,
  storageStatus,
  incidentStatus,
  levyStatus,
  feverStatus,
  housewaresFraction,
  unrestStatus,
  wageStatus,
  feastStatus,
  callFeast,
  liaisonStatus,
  fulfillRequest,
  spireStatus,
  fundSpireStage,
  pillarStatus,
  fundIronworkStage,
  frontStatus,
  foundersStatus,
  importStatus,
  solaceStatus,
  arrearsStatus,
  rosterStatus,
  departureStatus,
  educationStatus,
  prosperityStatus,
  turbinePower,
  waterStatus,
  toolStatus,
  seedStatus,
  confidenceStatus,
  birthStatus,
  footprintStatus,
  veinStatus,
  calendarStatus,
  seasonStatus,
  ledgerStatus,
  rimfishStatus,
  driedFishStatus,
  duskcapStatus,
  bathhouseStatus,
  libraryStatus,
  wasteStatus,
  securityStatus,
  dietVarietyStatus,
  labourStatus,
  planterStatus,
  stallStatus,
  galleryStatus,
  porterStatus,
  avatarStatus,
  fireStatus,
  reclaimStatus,
  festivalStatus,
  reserveParcelLand,
  mergeAvenue,
  type ImportGood,
} from "./build";
import {
  registerSettler as kookerRegister,
  generateName as randomSettlerName,
  type KookerCard,
} from "./kooker";
import { addSettler, saveColony, restoreColony, clearColony } from "./settlers";
import {
  walletDeposits,
  walletCount,
  balance as ledgerBalance,
  post as ledgerPost,
  CURRENCY,
} from "./ledger";
import { plotPriceKook, kookToZar, starterDeposit } from "./land";
import { loadCar, saveCar } from "./car/garageStore";
import {
  PAINT_PALETTES,
  type PaintChannel,
  type CarStatVector,
} from "./car/carSpec";
import {
  CAR_PARTS,
  validCarParts,
  deriveStats,
  type CarPartKind,
  type CarSocket,
} from "./car/carParts";
import {
  ownsCarPart,
  ownedCarParts,
  ownCarPart,
  unownCarPart,
} from "./car/carStore";
import { CAR_SHOP_ACCOUNT } from "./car/carShop";
import {
  loadCarPartMarket,
  saveCarPartMarket,
  addCarPartListing,
  removeCarPartListing,
  findCarPartListing,
  carPartListingId,
} from "./bot/carPartMarket";
import { MockBackend, type CityLifeBackend, type Decision } from "./backend";
import {
  generateHousehold,
  type Household,
  type HouseholdOverrides,
} from "./newcomers";
import { useRoadNetwork } from "./stores/useRoadNetwork";
import { spawnCitizenSubUser, splitName } from "./bot/citizenSpawn";
import {
  BotService,
  defaultBotAdapter,
  resolveBotAdapter,
  type Bot,
} from "./bots";
import { makeCityPlan, type CityPlan, type Plot } from "./cityPlan";
import { CitizenRoster, type CitizenPublic } from "./bot/citizenRoster";
import { firstPersonView, type FirstPersonView } from "./bot/firstPersonView";
import { canonicalSolClock } from "./sol";
import {
  makeNeighborhood,
  makeNeighborhoodAt,
  findSatelliteAnchors,
  defaultBlueprint,
  retargetParcelAccess,
  streetDoorDir,
  type Neighborhood,
  type Lot,
  GRAND,
  ESTATE,
  BIG,
  COMPACT,
  createDynamicPlot,
} from "./neighborhood";
import {
  validateBlueprint,
  parseBlueprint,
  blueprintToScript,
  FURNITURE_ITEM_CAP,
  type ParsedBlueprint,
} from "./blueprintScript";
import {
  placeItemAt,
  freeItemCell,
  moveItem,
  rotateItem,
  removeItem,
  moveItemStorey,
} from "./builder/blueprintEdit";
import {
  loadBlueprintsLocal,
  saveBlueprintLocal,
  saveBlueprintBackend,
  fetchBlueprintsBackend,
  mergeBlueprints,
} from "./bot/blueprintStore";
import { selfDesign, type SelfDesignResult } from "./builder/selfDesign";
import {
  dreamBrief,
  negotiate,
  briefToBlueprint,
  seededBudget,
  VIW_SEED,
  type NegotiationSession,
} from "./builder/negotiation";
import {
  createProfile,
  addPost,
  type KbProfile,
  type PostKind,
} from "./social/kookerbook";
import {
  loadKookerbookLocal,
  saveProfileLocal,
  saveProfileBackend,
  fetchKookerbookBackend,
  mergeKookerbook,
} from "./bot/kookerbookStore";
import {
  getLedgerSync,
  type LedgerMove,
  type SyncStatus,
} from "./bot/ledgerSync";
import {
  checkNeighbourhoodAccess,
  defaultAccessDeps,
  neighbourhoodKeyForLot,
  type AccessDecision,
  type NeighbourhoodAccessDeps,
} from "./bot/neighbourhoodAccess";
import { furniturePriceK, FURNITURE_SHOP_ACCOUNT } from "./furnitureShop";
import type { FurnitureKind } from "./furniture";
import {
  ownedFurnitureId,
  ownedBy,
  recordOwnedLocal,
  saveInventoryBackend,
  nextPurchaseSeq,
  loadInventoryLocal,
  removeOwned,
  saveInventoryLocal,
} from "./bot/furnitureStore";
import {
  loadMarketLocal,
  saveMarketLocal,
  addListing,
  removeListing,
  allListings,
  saveMarketBackend,
  type FurnitureListing,
} from "./bot/furnitureMarket";
import {
  makeCommercialDistrict,
  type CommercialDistrict,
  type ShopKind,
  type ShopParcel,
} from "./commerce/district";
import { makeBusRoute, type BusRoute } from "./transit/busRoute";
import {
  findDepotSite,
  depotLayout,
  type DepotSite,
  type DepotLayout,
} from "./transit/busDepot";
import {
  makeFleet,
  stepFleet,
  makeFleetGeometry,
  busPose,
  type BusFleet,
  type FleetGeometry,
  type FleetPaths,
  type BusPose,
} from "./transit/busFleet";
import {
  buildPath,
  simplifyClosed,
  smoothClosed,
  smoothOpen,
} from "./transit/path";
import type { RoadWay } from "./render/roadRibbon";
import { conservativeRoadRibbonBlockedCells } from "./placementValidation";
import { findJunctionZones } from "./render/roadJunctions";
import {
  barStoolGridPositions,
  junctionZonesToPads,
  surveyVenuePlacements,
  venueRoadBlockedCells,
} from "./render/venuePlacement";
import { cellOk, leastCostPath, roadCellOk, type Cell } from "./pathfind";
import { roadComponents } from "./roadConnectivity";
import {
  createRadio,
  tuneTo,
  toggleOn as radioToggleOn,
  toggleMuted as radioToggleMuted,
  spinHouseAd,
  type RadioState,
} from "./radio";
import {
  buildShareCard,
  headlineFor,
  shareStats,
  siteLabel,
  DEFAULT_TAGLINE,
  CARD_ID,
  type CardFormat,
} from "./social/shareCard";
import { commercialFrontageExclusion, makeRaceTrack } from "./racing/track";
import {
  newRaceState,
  stepRace,
  type RaceInput,
  type RaceMode,
  type RaceState,
} from "./racing/race";

// Spec 078 — Joe the Crab, the founding resident. Fixed id + birth stamp + house so he is deterministic,
// always present from sol zero, and survives reloads with no new save format. His house is an authored 077
// blueprint (a sea-facing patio cottage — his "city desk" by the water), reserved on the shore-most plot.
const JOE_ID = "citizen_joe";
const JOE_BORN_MS = 0;
const JACK_ID = "citizen_jack";
// Phase-1 S1 — the night-meetup friend: a fixed, public-safe NPC pinned at the hilltop Rally Point so
// that two players are present and the meetup completes. Not a backend identity leak; just a
// deterministic in-world citizen (ultimately stands in for the brother you drive out to meet at night).
const RALLY_FRIEND_ID = "citizen_rally_friend";
// KOOKER, the Builder of the Kookerverse (founder two): owner of the build trade. Players see "KOOKER"
// (the displayName/alias below); the internal id keeps its legacy value "citizen_viw" because the ledger
// accounts (citizen:citizen_viw) and the kooker-web OTA mission (079) reference the builder by THIS id —
// renaming the value would orphan existing ledger entries + the OTA hook. The VIW_* constant names are
// kept as that stable id; the player-facing identity is KOOKER everywhere.
export const VIW_ID = "citizen_viw"; // the Builder's stable id (player-facing name is KOOKER)

// Founder houses are authored ONCE with the front (street/door) on the y:0 edge and mirrored
// vertically for a south street — the defaultBlueprint trick — so the crafted home always faces
// the spine whichever side of the street the founder's plot lands on.
type FounderRoom = {
  kind: string;
  x: number;
  y: number;
  w: number;
  d: number;
  win: 0 | 1;
};
export function founderBlueprint(
  w: number,
  d: number,
  wallH: number,
  doorDir: "n" | "s",
  rooms: FounderRoom[],
): string {
  const placed =
    doorDir === "s" ? rooms.map((r) => ({ ...r, y: d - (r.y + r.d) })) : rooms;
  const roomStr = placed.map(
    (r) =>
      `room{kind:${r.kind} x:${r.x} y:${r.y} w:${r.w} d:${r.d} win:${r.win}}`,
  );
  return `house{w:${w} d:${d} wallH:${wallH} door:${doorDir}} ${roomStr.join(" ")}`;
}
/** Joe's sea-facing cottage, re-authored for his GRAND waterfront plot (spec 084 S6): a wide sea
 *  deck the door opens through, the city desk hall, a bedroom and a corner plunge pool. */
export function joeBlueprint(doorDir: "n" | "s"): string {
  return founderBlueprint(10, 8, 2, doorDir, [
    { kind: "patio", x: 0, y: 0, w: 10, d: 3, win: 0 },
    { kind: "living", x: 0, y: 3, w: 6, d: 5, win: 1 },
    { kind: "bedroom", x: 6, y: 3, w: 4, d: 3, win: 1 },
    { kind: "pool", x: 6, y: 6, w: 4, d: 2, win: 0 },
  ]);
}
/** Spec 084 S2 — a stored blueprint may only restore onto a FOUNDER plot when it belongs to that
 *  founder. A stale or foreign entry (an old save, a renamed lot, tampered storage) must never
 *  clobber a crafted founder house — Joe's cottage previously survived restore by ordering luck. */
export function canRestoreBlueprint(
  lot: Pick<Lot, "reservedFor">,
  citizenId: string,
): boolean {
  return !lot.reservedFor || lot.reservedFor === citizenId;
}

/** Viw's crewhouse (spec 084 S6) — the workbench hall fills the front band, the crew garage, bunk
 *  room and timber-yard patio sit behind. The door is fixed EAST: the builder's own house exercises
 *  the spec-084 S2 side-walkway contract on every single boot, so a regression can't hide. */
export const VIW_BLUEPRINT =
  "house{w:8 d:7 wallH:2 door:e} room{kind:living x:0 y:0 w:8 d:5 win:1} room{kind:garage x:0 y:5 w:3 d:2 win:0} room{kind:bedroom x:3 y:5 w:2 d:2 win:1} room{kind:patio x:5 y:5 w:3 d:2 win:0}";

const BIOME_LABEL: Record<number, string> = {
  [Biome.Ocean]: "Ocean",
  [Biome.Shallows]: "Shallows",
  [Biome.Beach]: "Crystal shore",
  [Biome.Plains]: "Fungal plains",
  [Biome.Forest]: "Violet forest",
  [Biome.Highland]: "Ochre highland",
  [Biome.Mountain]: "Grey mountains",
  [Biome.Peak]: "Crystal peaks",
  [Biome.River]: "Riverside",
};

export interface FirstPersonDemoEvidence {
  citizenId: string;
  citizenName: string;
  position: { x: number; y: number };
  heading: number;
  lookPitch: number;
  action: string | null;
  guidedTarget: {
    label: string;
    x: number;
    y: number;
    remainingDistance: number;
    nextWaypoint?: { x: number; y: number };
  } | null;
  blockedReason: string | null;
  clockLabel: string;
  hudLines: string[];
}

export interface FirstPersonDemoCapture {
  evidence: FirstPersonDemoEvidence;
  /** Browser-only PNG data URL when the renderer is mounted; null in headless tests. */
  pngDataUrl: string | null;
}

export type FirstPersonMouseSensitivity = "low" | "normal" | "high";

function roundTo(n: number, places = 2): number {
  return Number(n.toFixed(places));
}

function formatDistanceLabel(distance: number): string {
  return `${distance} ${distance === 1 ? "unit" : "units"} away`;
}

export interface ColonyUiState {
  running: boolean;
  paused: boolean;
  speed: number;
  clock: {
    day: number;
    hour: number;
    minute: number;
    isDay: boolean;
    sol: number;
  };
  power: {
    solarW: number;
    loadW: number;
    batteryWh: number;
    batteryCapWh: number;
    pct: number;
    brownout: boolean;
    windW: number;
  };
  colonists: number;
  colony: {
    treasury: number;
    materials: number;
    components: number;
    food: number;
    reels: number;
    fibre: number;
    linen: number;
    folios: number;
    skilled: number;
    freeLabour: number;
    capacity: number;
    watered: number;
    provisioned: number;
    health: number;
    culture: number;
    cultureFuelled: boolean;
    liveability: number;
    smog: number;
    commute: { demand: number; capacity: number; congested: boolean };
    maintenance: { worst: number; needing: number; sheds: number };
    storage: { fill: number; full: boolean; tightest: string };
    incidents: { active: number; capacity: number };
    levy: { active: boolean; rate: "low" | "normal" | "high" };
    wage: {
      active: boolean;
      rate: "low" | "standard" | "generous";
      payroll: number;
    };
    feast: { active: boolean; daysLeft: number; canCall: boolean };
    liaison: {
      active: boolean;
      standing: number;
      request: { good: string; amount: number; daysLeft: number } | null;
      canFulfil: boolean;
    };
    spire: {
      stage: number;
      total: number;
      progress: number;
      building: boolean;
      complete: boolean;
    };
    pillar: {
      stage: number;
      total: number;
      progress: number;
      building: boolean;
      complete: boolean;
      retuneTonight: boolean;
    };
    front: {
      timerDays: number;
      incoming: boolean;
      braced: boolean;
      watching: boolean;
      established: boolean;
    };
    founders: {
      active: boolean;
      seated: number;
      notable: { name: string; role: string } | null;
    };
    imports: {
      active: boolean;
      order: ImportGood | null;
      perDay: number;
      dailySpend: number;
    };
    solace: { coverage: number; shrines: number };
    education: { coverage: number; schools: number };
    prosperity: {
      active: boolean;
      score: number;
      rank: number;
      rankName: string;
      recognised: boolean;
    };
    water: { stored: number; cap: number; cisterns: number; dry: boolean };
    tools: { stored: number; cap: number; cribs: number; short: boolean };
    seed: { stored: number; cap: number; lofts: number; short: boolean };
    arrears: {
      office: boolean;
      debt: number;
      ceiling: number;
      strain: boolean;
      unmanaged: boolean;
    };
    roster: { active: boolean; mode: "essentials" | "balanced" | "industry" };
    departures: { pressure: number; atRisk: boolean; cause: string };
    confidence: {
      confidence: number;
      factor: number;
      slowed: boolean;
      halted: boolean;
    };
    births: { children: number; homes: number; growing: boolean };
    footprint: {
      radius: number;
      claims: number;
      maxClaims: number;
      progress: number;
      camp: boolean;
      atEdge: boolean;
    };
    veins: { mines: number; poorest: number };
    calendar: {
      year: number;
      month: number;
      monthsToFounders: number;
      office: boolean;
    };
    season: {
      name: string;
      modifier: number;
      solarModifier: number;
      active: boolean;
    };
    ledger: {
      ageYears: number;
      onset: number;
      turning: boolean;
      lastPassings: number;
      hall: boolean;
    };
    rimfish: { stock: number; docks: number; varied: boolean };
    driedFish: { stock: number; cap: number; racks: number };
    duskcap: { stock: number; cellars: number };
    bathhouse: {
      hygiene: number;
      baths: number;
      drawBonus: number;
      climbBonus: number;
    };
    library: { libraries: number; lending: boolean; foliosPerDay: number };
    waste: { level: number; posts: number; harmful: boolean; fevered: boolean };
    security: {
      active: boolean;
      lossPerDay: number;
      nooks: number;
      guarded: boolean;
    };
    labour: {
      active: boolean;
      unemployment: number;
      covered: number;
      penalty: number;
      dragging: boolean;
    };
    planters: { squares: number; blooming: number };
    stalls: { stalls: number; open: boolean; coinPerDay: number };
    gallery: { galleries: number; open: boolean; coinPerDay: number };
    porter: { sheds: number; working: boolean; porters: number };
    avatar: { foundries: number; staffed: boolean; capacity: number };
    fire: { posts: number; active: number; risk: number; watered: boolean };
    reclaim: { plants: number; perDay: number; active: boolean };
    festival: {
      board: boolean;
      cheerDays: number;
      bonus: number;
      active: boolean;
    };
    diet: {
      counters: number;
      covered: number;
      served: number;
      standing: number;
      share: number;
      varied: boolean;
      bonus: number;
    };
    fever: { level: number; contained: boolean };
    housewares: number;
    order: { unrest: number; warded: boolean };
    surveyed: boolean;
    trade: number;
    tiers: [number, number, number];
    buildings: number;
    building: number;
    load: number;
    jobs: number;
    employed: number;
    pollution: number;
  };
  settlers: { count: number; recent: { id: number; name: string }[] };
  bank: {
    scope: "city" | "player";
    currency: string;
    deposits: number;
    depositsZar: number;
    accounts: number;
    landOffice: number;
    recent: { id: number; memo: string }[];
    sync: { pending: number; synced: number; lastError: string | null };
  };
  border: {
    households: Household[];
    bots: Bot[];
    botSource: string;
    plots: Plot[];
  };
  citizens: {
    count: number;
    awake: number;
    list: CitizenPublic[];
    wallets: Record<string, number>;
  };
  firstPerson: {
    active: boolean;
    citizenId: string | null;
    citizenName: string | null;
    operatorCitizenId: string | null;
    /** Step-in choices allowed for this session. Operators/admins get every citizen; CITYLIFE_PLAYER gets only their own. */
    stepInCitizenIds: string[];
    view: FirstPersonView | null;
    lookPitch: number;
    mouseSensitivity: FirstPersonMouseSensitivity;
    sprintCharge: number;
    guidedTarget: {
      label: string;
      x: number;
      y: number;
      remainingDistance: number;
      nextWaypoint?: { x: number; y: number };
    } | null;
    blockedReason: string | null;
    narration: string | null;
    narrating: boolean;
  };
  race: {
    mode: RaceMode;
    available: boolean;
    countdownMs: number;
    timeMs: number;
    finishedMs: number | null;
    bestMs: number | null;
    checkpoint: number;
    checkpoints: number;
    offTrack: boolean;
  };
  // Spec 096 — the signed-in player's car + its catalog (mount toggles). null when no operator is set.
  garage: {
    carName: string;
    walletK: number;
    /** Spec 096 — a single 0..100 headline build rating (50 = stock); rises as performance parts go on. */
    tunePoints: number;
    stats: {
      topSpeed: number;
      acceleration: number;
      grip: number;
      braking: number;
    };
    parts: {
      kind: string;
      label: string;
      socket: string;
      category: "performance" | "cosmetic";
      cost: number;
      mounted: boolean;
      owned: boolean;
      /** Spec 096 — what fitting this part does to handling, as short up/down badges (empty = cosmetic). */
      effects: { label: string; up: boolean }[];
    }[];
    // Spec 096 F — the bonnet: open it to reveal the engine bay, each socket with its install state.
    bonnetOpen: boolean;
    engineBay: {
      socket: string;
      label: string;
      /** occupied = a part is fitted; installable = empty and a fitting part is owned; empty = none owned. */
      state: "occupied" | "installable" | "empty";
      mounted: { kind: string; label: string } | null;
      parts: {
        kind: string;
        label: string;
        category: "performance" | "cosmetic";
        cost: number;
        owned: boolean;
        effects: { label: string; up: boolean }[];
      }[];
    }[];
    // Spec 096 G — the Kookerbook car-part classifieds board (public listings, city coin).
    market: {
      id: string;
      kind: string;
      label: string;
      price: number;
      sellerName: string;
      mine: boolean;
    }[];
    // Spec 096 H — the car's paint: each repaintable channel, its current colour and the palette options.
    paint: {
      channel: "body" | "cabin" | "accent";
      label: string;
      current: number;
      options: number[];
    }[];
  } | null;
  // Spec 097 R4 — live presence at the hilltop Rally Point (the race rendezvous); null if no rally.
  rally: {
    x: number;
    y: number;
    present: number;
    ready: boolean;
    presentCitizens: { id: string; displayName: string }[];
  } | null;
  neighborhood: {
    lots: {
      id: string;
      built: boolean;
      owner: string | null;
      ownerId: string | null;
      occupied: boolean;
      reserved: boolean;
      price: number | null;
      priceZar: number | null;
      neighbourhoodKey: string | null;
    }[];
    free: number;
    built: number;
    houseCost: number;
    canAfford: boolean;
    buildHint: string;
  };
  commerce: {
    plots: number;
    free: number;
    byKind: { kiosk: number; store: number; showroom: number };
    canClaim: boolean;
    cheapest: { kind: ShopKind; price: number } | null;
    parcels: {
      id: string;
      kind: ShopKind;
      price: number;
      priceZar: number;
      built: boolean;
      owner: string | null;
    }[];
  };
  radio: RadioState;
  courier: { on: boolean; headline: string }; // spec 016 — the colony's own news, when a Broadcast Mast is up
  tv: boolean;
  zonesVisible: boolean;
  name: string;
  biome: string;
  view: ViewMode;
  preset: CameraPreset;
}

/** Spec 149 — camera yaw (three.js Y euler) that points the fp camera standing at `from` toward
 *  `to`, both in GRID coords (world x = grid x, world z = grid y; camera forward is (-sin, -cos)). */
function cameraYawToward(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  return Math.atan2(-(to.x - from.x), -(to.y - from.y));
}

export class ColonyRuntime {
  readonly sim: ColonySim;
  private renderer: PlanetRenderer | null = null;
  private raf = 0;
  private lastFrame = 0;
  private lastUi = 0;
  private accumulator = 0;
  private speed = 1;
  private paused = false;
  private running = false;
  private view: ViewMode = "biome";
  private preset: CameraPreset = "district";
  private listeners = new Set<() => void>();
  // The forkable backend boundary — mock for dev, the real portable citylife-backend later.
  private backend: CityLifeBackend = new MockBackend(
    (Date.now() & 0x7fffffff) >>> 0,
  );
  // Newcomer bots: REAL Hermes replies via kooker inference when VITE_CITYLIFE_PAT is set, else mock.
  private botService = new BotService(defaultBotAdapter());
  // Spec 074 — registry of named citizens (each is the lead of an approved household, allocated to a plot,
  // and the eventual owner of their own Hermes pod). Public-safe slice of this is exposed through uiState.
  private citizens = new CitizenRoster();
  // The surveyed city plan the Border Patrol bot uses to allocate plots.
  private cityPlan!: CityPlan;
  // Spec 075 — the buildable neighbourhood: a street of lots where citizens raise voxel homes.
  private neighborhood!: Neighborhood;
  // Low Power Radio — CityLife's heartbeat. YouTube embed handles licensing; in-game ads queue up.
  private radio: RadioState = createRadio();
  // TV mode hides the operator UI so you can put the city on any screen and just watch.
  private tv =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("tv") === "1";
  // City-plan zoning overlay (zone tints + plot flags) — OFF by default. The static colour plan never
  // helped planning and is superseded by the Caesar III economy (specs 001–010) that now drives how the
  // city actually evolves. Kept as an opt-in HUD toggle while it's redesigned or retired
  // (see docs/research/2026-06-01-zoning-redesign.md).
  private zonesVisible = false;
  private adInterval: ReturnType<typeof setInterval> | null = null;
  // P1 — the logged-in operator's name, so we can mark which avatar is theirs + gate the step-into.
  private operatorName: string | null = null;
  // The authenticated kooker user id (from the JWT), the IDENTITY the player view keys off. Own-data /
  // step-into resolve to the citizen stamped with this id, not a spoofable display name. Null until a
  // signed-in player sets it (legacy tokens with no userId claim also leave it null → name fallback).
  private operatorUserId: string | null = null;
  // Player data isolation: false = the privileged operator/admin view (sees every citizen + wallet,
  // the default). true = a CITYLIFE_PLAYER view — the HUD then shows only the player's own data plus
  // other citizens' public presence (stubs), never their private wallet/usage. Set by the player login
  // path (the first-login/route-gating slice); until then this stays false so nothing changes.
  private playerView = false;
  // Spec 096 F — is the Garage engine-bay (the bonnet) open in the HUD? A UI toggle, render-free.
  private bonnetOpen = false;
  // P1 — the citizen currently being viewed in first person (null = orbit camera).
  private fpCitizenId: string | null = null;
  // First-person locomotion — which movement keys are held while you walk your bot around.
  private fpKeys = new Set<string>();
  private fpWalkSpeed = 0;
  private fpLookPitch = 0;
  private fpMouseSensitivity: FirstPersonMouseSensitivity = "normal";
  private fpSprintCharge = 1;
  private fpGuidedTarget: { label: string; x: number; y: number } | null = null;
  private fpBlockedReason: string | null = null;
  private raceState: RaceState | null = null;
  private raceInput: RaceInput = {};
  private raceAnalogInput: Record<string, RaceInput> = {};
  private bestRaceMs: number | null = null;
  private readonly worldSeed: number;
  /** Spec 084 S6 / 079 — the reserved shop-district land bank at the avenue's inland end. */
  commercialReserve: { x: number; y: number; w: number; h: number } | null =
    null;
  /** Spec 079 P0 — the surveyed commercial high street + shop plots within the reserve. */
  commercialDistrict: CommercialDistrict | null = null;
  /** Spec 088 — the city bus route: a road loop visiting every hood (founders + each hamlet). */
  busRoute: BusRoute | null = null;
  /** Spec 149 — the surveyed bus depot pad + its interior layout (null: seed had no fit; the
   *  legacy single cosmetic coach keeps driving instead of the fleet). Public: e2e probes it. */
  busDepot: { site: DepotSite; layout: DepotLayout } | null = null;
  /** Spec 149 — the fleet dispatch machine (hours, stagger, breaks). Public for the e2e probe. */
  busFleet: BusFleet | null = null;
  private fleetGeom: FleetGeometry | null = null;
  private fleetPaths: FleetPaths | null = null;
  /** Spec 149 — the fleet bus the stepped-in player is riding, or null on foot. */
  fpRidingBusId: number | null = null;
  /** Spec 149 — where the first-person CAMERA capsule stands (grid coords), reported by the
   *  renderer every frame. The v3 walker camera is a physics capsule independent of the roster
   *  citizen, so bus interactions measure from HERE — the prompt matches what the player sees. */
  fpCameraCell: { x: number; y: number } | null = null;
  /** Spec 149 — one-shot teleport order for the camera capsule (FirstPersonController consumes it;
   *  seq marks freshness). debugPlaceFirstPerson and alighting issue these. */
  fpTeleportRequest: {
    x: number;
    y: number;
    yaw?: number;
    seq: number;
  } | null = null;
  private fpTeleportSeq = 0;
  /** Spec 088 — road centre-lines for the smooth ribbon render (rendering only; traffic uses the cells). */
  roadWays: RoadWay[] = [];
  // Spec 079 — the Nearest bar's seat cells + who's sitting there (a night crowd; cleared by day).
  private barSeatCells: { x: number; y: number }[] | null = null;
  private barOccupied = new Set<string>();
  private barSeatBy: (string | null)[] = [];
  private fpNarration: string | null = null;
  private fpNarrating = false;
  private settlerTimer = 0;

  constructor(seed: number = COLONY.render.seed) {
    this.worldSeed = seed;
    this.sim = new ColonySim(seed);
    restoreColony(this.sim.state); // re-place settlers + restore the Kookerverse ledger
    this.cityPlan = makeCityPlan(this.sim.state.terrain);
    this.sim.state.cityPlan = this.cityPlan; // expose to the renderer for the zone tint + plot markers
    this.botService.setCityPlan(this.cityPlan);
    // Spec 076/084 — lay out the homestead neighbourhood. The VERGE is reserved in the roadSet only
    // (the colony never builds on it, cars never drive it); the CARRIAGEWAY merges into the road
    // network as the paved AVENUE below — AFTER reserveParcelLand, so the parcel purge can never
    // eat it (spec 084 S3). Cars finally drive the residential street.
    this.neighborhood = makeNeighborhood(this.sim.state.terrain);
    this.sim.state.neighborhood = this.neighborhood; // expose to the R3F renderer (same pattern as cityPlan above)
    const t0 = this.sim.state.terrain;
    // Spec 086 — the DISTRIBUTED CITY. Order matters: lay + reserve the coastal PRIMARY (founders),
    // then claim the COMMERCIAL reserve off its avenue, THEN scatter satellite hamlets that avoid
    // everything already placed (a shared `taken` set), then stitch trunk roads between them. Without
    // reserving commerce first, the satellites ate its land and the shop district vanished.
    const footprintCells = (nbhd: Neighborhood): { x: number; y: number }[] => {
      const out: { x: number; y: number }[] = [];
      for (const lot of nbhd.lots) {
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const f of lot.fence) {
          minX = Math.min(minX, f.x);
          maxX = Math.max(maxX, f.x);
          minY = Math.min(minY, f.y);
          maxY = Math.max(maxY, f.y);
        }
        for (let y = minY; y <= maxY; y++)
          for (let x = minX; x <= maxX; x++) out.push({ x, y });
        for (const d of lot.driveway) out.push({ x: d.x, y: d.y });
      }
      return out;
    };
    // `taken` = every placed cell (parcels + their roads + the commercial reserve); satellites and the
    // commercial reserve both avoid it so nothing ever overlaps. `residentialKeys` is homestead
    // footprints only — roads may run near them but never through them.
    const taken = new Set<string>();
    const addCells = (cells: { x: number; y: number }[]) => {
      for (const c of cells) taken.add(`${c.x},${c.y}`);
    };
    const residentialKeys = new Set<string>();
    const primaryCells = footprintCells(this.neighborhood);
    for (const c of this.neighborhood.verge)
      this.sim.state.roadSet.add(`${c.x},${c.y}`);
    reserveParcelLand(this.sim.state, primaryCells);
    mergeAvenue(this.sim.state, this.neighborhood.carriage); // spec 084 S3 — the paved avenue joins the network
    addCells(primaryCells);
    addCells(this.neighborhood.carriage);
    addCells(this.neighborhood.verge);
    for (const c of primaryCells) residentialKeys.add(`${c.x},${c.y}`);
    // Spec 079 / 086 — the COMMERCIAL RESERVE, claimed BEFORE the satellites so they leave it room.
    // 086-P1: commerce now fronts the FOUNDERS' LIGHTHOUSE on the shore (the operator's scenic anchor).
    // First keep the tower + its base clear, then search the open COASTAL ground beside it, biased
    // toward the founders' side so a coast road can reach it; fall back to the old inland search off
    // the avenue's terminus when there is no lighthouse or no open shore nearby.
    const lighthouse = this.sim.state.structures.find(
      (s) => s.kind === "lighthouse",
    );
    const lighthouseBlock = new Set<string>();
    if (lighthouse) {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++)
          lighthouseBlock.add(`${lighthouse.x + dx},${lighthouse.y + dy}`);
      for (const k of lighthouseBlock) taken.add(k); // shops never cover the tower or its immediate base
    }
    this.commercialReserve = (() => {
      const t = this.sim.state.terrain,
        W = COLONY.commerce.reserveW,
        H = COLONY.commerce.reserveH;
      const clampX = (v: number) =>
        Math.max(0, Math.min(t.size - W, Math.round(v)));
      const clampY = (v: number) =>
        Math.max(0, Math.min(t.size - H, Math.round(v)));
      const claim = (best: { x: number; y: number; w: number; h: number }) => {
        const cells: { x: number; y: number }[] = [];
        for (let y = best.y; y < best.y + best.h; y++)
          for (let x = best.x; x < best.x + best.w; x++) cells.push({ x, y });
        reserveParcelLand(this.sim.state, cells);
        addCells(cells); // the satellites must leave the shop district its room
        return best;
      };
      // 086-P1 — the shore beside the lighthouse. Score by clear COASTAL cells (dry, buildable, near
      // the waterline but not on it, unclaimed) so the district hugs the coast by the landmark.
      if (lighthouse) {
        const toLanding = Math.sign(t.landing.x - lighthouse.x) || 1;
        let best: { x: number; y: number; w: number; h: number } | null = null,
          bestScore = -1;
        for (const along of [16, 28, 40, 52, 8])
          for (const off of [0, -16, 16, -32, 32]) {
            const cx = lighthouse.x + toLanding * along,
              cy = lighthouse.y + off;
            const rx = clampX(cx - W / 2),
              ry = clampY(cy - H / 2);
            let free = 0,
              coastal = 0;
            for (let y = ry; y < ry + H; y++)
              for (let x = rx; x < rx + W; x++) {
                if (cellOk(t, x, y) && !taken.has(`${x},${y}`)) {
                  free++;
                  const d = t.distToWater[t.idx(x, y)] ?? 0;
                  if (d >= 2 && d <= 16) coastal++;
                }
              }
            const s = coastal * 2 + free; // hug the shore by the lighthouse, but demand enough clear room
            if (free >= COLONY.commerce.reserveFreePrimary && s > bestScore) {
              bestScore = s;
              best = { x: rx, y: ry, w: W, h: H };
            }
          }
        if (best) return claim(best);
      }
      // fallback — the original inland search past the avenue's terminus in its own inland direction.
      const car = this.neighborhood.carriage;
      if (car.length < 2) return null;
      const dW = (c: { x: number; y: number }) =>
        t.distToWater[t.idx(Math.round(c.x), Math.round(c.y))] ?? 0;
      let inland = car[0]!,
        shore = car[0]!;
      for (const c of car) {
        if (dW(c) > dW(inland)) inland = c;
        if (dW(c) < dW(shore)) shore = c;
      }
      let ix = inland.x - shore.x,
        iy = inland.y - shore.y;
      const len = Math.hypot(ix, iy) || 1;
      ix /= len;
      iy /= len;
      const px = -iy,
        py = ix;
      let best: { x: number; y: number; w: number; h: number } | null = null,
        bestFree = -1;
      for (const step of [12, 20, 28, 36, 44, 52])
        for (const perp of [0, -14, 14, -28, 28]) {
          const cx = inland.x + ix * step + px * perp,
            cy = inland.y + iy * step + py * perp;
          const rect = {
            x: clampX(cx - W / 2),
            y: clampY(cy - H / 2),
            w: W,
            h: H,
          };
          let free = 0;
          for (let y = rect.y; y < rect.y + H; y++)
            for (let x = rect.x; x < rect.x + W; x++)
              if (cellOk(t, x, y) && !taken.has(`${x},${y}`)) free++;
          if (free > bestFree) {
            bestFree = free;
            best = rect;
          }
        }
      if (!best || bestFree < COLONY.commerce.reserveFreeFallback) return null;
      return claim(best);
    })();
    // Spec 086 — SATELLITE HAMLETS in the woods + hills, each routed + placed AROUND everything already
    // taken (the coast, the commercial reserve, prior hamlets), so scattered clusters never overlap.
    const satellites: Neighborhood[] = [];
    for (const a of findSatelliteAnchors(
      t0,
      { x: t0.landing.x, y: t0.landing.y },
      6,
    )) {
      const nbhd = makeNeighborhoodAt(t0, a, { small: true, blocked: taken });
      if (nbhd.lots.length === 0) continue;
      const b = t0.biome[t0.idx(a.x, a.y)];
      const name = `${b === Biome.Forest ? "wood" : b === Biome.Highland ? "hill" : "vale"}${satellites.length + 1}`;
      for (const lot of nbhd.lots) {
        lot.id = `${name}_${lot.id}`; // unique id; never collides with lot_1/lot_2
        lot.neighborhoodKey = name; // pairs with the backend neighbourhoods table for the buy-time access gate
      }
      this.neighborhood.parcels.push(...nbhd.parcels); // parcels === lots (same array ref), so lots update too
      const cells = footprintCells(nbhd);
      reserveParcelLand(this.sim.state, cells);
      mergeAvenue(this.sim.state, nbhd.carriage);
      for (const c of nbhd.verge) this.sim.state.roadSet.add(`${c.x},${c.y}`);
      addCells(cells);
      addCells(nbhd.carriage);
      addCells(nbhd.verge);
      for (const c of cells) residentialKeys.add(`${c.x},${c.y}`);
      satellites.push(nbhd);
    }
    // Spec 114 — roads laid after parcel placement must keep the same one-cell setback from
    // floor/border footprints. Build a deterministic exclusion halo around residential parcels
    // before routing/widening trunk connectors so no final road cell can 4-neighbour touch a fence.
    const residentialSetbackKeys = new Set(residentialKeys);
    for (const k of residentialKeys) {
      const [xs, ys] = k.split(",");
      const x = Number(xs),
        y = Number(ys);
      residentialSetbackKeys.add(`${x + 1},${y}`);
      residentialSetbackKeys.add(`${x - 1},${y}`);
      residentialSetbackKeys.add(`${x},${y + 1}`);
      residentialSetbackKeys.add(`${x},${y - 1}`);
    }
    // Spec 086 P2 — THE ROAD NETWORK. Each hamlet links to the coast AND to its nearest other hamlet
    // (a mesh, not just spokes), and every trunk is WIDENED to a ~3-cell carriageway so it reads as a
    // real road instead of a thread. Routed around every homestead; the router never crosses water.
    const nearestPair = (a: Cell[], b: Cell[]): [Cell, Cell] => {
      let from = a[0]!,
        to = b[0]!,
        bestD = Infinity;
      for (const p of a)
        for (const q of b) {
          const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
          if (d < bestD) {
            bestD = d;
            from = p;
            to = q;
          }
        }
      return [from, to];
    };
    // Lay a clean, uniform-width road from a raw (staircase) leastCostPath centreline:
    //  1. STRING-PULL the path into straight segments — greedily skip waypoints while the straight
    //     line of sight stays on road-able ground — so a diagonal stair-step becomes a clean diagonal
    //     and the route runs in long straight runs with tidy corners at the few real bends.
    //  2. STROKE a constant width PERPENDICULAR to each segment, so the perceived width is steady on
    //     straights + diagonals and any residual step is filled by the band.
    // The trunk roads AND the commercial connector both lay through this, so no road is a raw 1-cell
    // zig-zag any more (the staircase the operator kept seeing).
    // spec 143 — roadCellOk (not cellOk): the string-pull and the stroked band must never put a
    // road cell on beach sand, even where the routed centre-line merely brushes the grass line.
    const roadLandOk = (x: number, y: number) =>
      roadCellOk(t0, x, y) && !residentialSetbackKeys.has(`${x},${y}`);
    const losClear = (a: Cell, b: Cell): boolean => {
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(a.x + ((b.x - a.x) * s) / Math.max(1, steps));
        const y = Math.round(a.y + ((b.y - a.y) * s) / Math.max(1, steps));
        if (!roadLandOk(x, y)) return false;
      }
      return true;
    };
    const simplifyPath = (path: Cell[]): Cell[] => {
      if (path.length <= 2) return path;
      const out: Cell[] = [path[0]!];
      let anchor = 0;
      for (let i = 2; i < path.length; i++) {
        if (!losClear(path[anchor]!, path[i]!)) {
          out.push(path[i - 1]!);
          anchor = i - 1;
        }
      }
      out.push(path[path.length - 1]!);
      return out;
    };
    const layRoad = (
      path: Cell[],
      half: number,
      kind: "avenue" | "street" = "street",
      // Spec 148 hardening — dryRun returns the cells this road WOULD occupy without the side effect
      // of pushing a ribbon way. The connectivity repair uses it to test whether a candidate connector
      // actually 4-bridges an orphan to the main web BEFORE committing it, so it never lays a road that
      // fails to merge (a diagonal LOS shortcut whose shoulders are all blocked strokes an 8-connected
      // staircase the 4-connected flood-fill still sees as split). Every existing caller omits it, so
      // their ribbons + cells stay byte-identical.
      dryRun = false,
      source?: RoadWay["source"],
    ): Cell[] => {
      const poly = simplifyPath(path);
      if (!dryRun && poly.length >= 2)
        this.roadWays.push({
          path: poly,
          kind,
          width: 4,
          ...(source ? { source } : {}),
        }); // 088 — smooth ribbon centre-line
      const out = new Set<string>();
      const add = (fx: number, fy: number) => {
        const x = Math.round(fx),
          y = Math.round(fy);
        if (roadLandOk(x, y)) out.add(`${x},${y}`);
      };
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i]!,
          b = poly[i + 1]!;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len,
          uy = dy / len,
          px = -uy,
          py = ux;
        for (let s = 0; s <= len + 1e-6; s += 0.5) {
          const cxs = a.x + ux * s,
            cys = a.y + uy * s;
          add(cxs, cys);
          for (let k = 0.5; k <= half + 1e-6; k += 0.5) {
            add(cxs + px * k, cys + py * k);
            add(cxs - px * k, cys - py * k);
          }
        }
      }
      return [...out].map((k) => {
        const [x, y] = k.split(",").map(Number);
        return { x: x!, y: y! };
      });
    };
    const paveLink = (a: Cell[], b: Cell[]) => {
      if (a.length === 0 || b.length === 0) return;
      const [from, to] = nearestPair(a, b);
      const path =
        leastCostPath(t0, from, to, {
          slopeWeight: 0.5,
          diagonal: true,
          forbidBeach: true, // spec 143 — trunk roads bend inland, never along the sand
          blocked: (x, y) => residentialSetbackKeys.has(`${x},${y}`),
        }) ?? [];
      if (path.length === 0) return;
      mergeAvenue(this.sim.state, layRoad(path, 1));
    };
    const coast = this.neighborhood.carriage;
    for (let i = 0; i < satellites.length; i++) {
      paveLink(coast, satellites[i]!.carriage); // a spoke to the coast keeps every hamlet connected
    }
    const meshed = new Set<string>();
    for (let i = 0; i < satellites.length; i++) {
      let nearest = -1,
        bestD = Infinity;
      for (let j = 0; j < satellites.length; j++) {
        if (j === i) continue;
        const [p, q] = nearestPair(
          satellites[i]!.carriage,
          satellites[j]!.carriage,
        );
        const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        if (d < bestD) {
          bestD = d;
          nearest = j;
        }
      }
      if (nearest < 0) continue;
      const key = `${Math.min(i, nearest)}-${Math.max(i, nearest)}`;
      if (meshed.has(key)) continue;
      meshed.add(key);
      paveLink(satellites[i]!.carriage, satellites[nearest]!.carriage); // the cross-link that makes it a web
    }
    // Spec 079 — survey the shop district in its reserved room; shops avoid every homestead + road.
    const blockedForShops = new Set<string>(residentialKeys);
    for (const r of this.sim.state.roads) blockedForShops.add(`${r.x},${r.y}`);
    for (const k of lighthouseBlock) blockedForShops.add(k); // 086-P1 — no shop lands on the lighthouse
    this.commercialDistrict = this.commercialReserve
      ? makeCommercialDistrict(
          this.sim.state.terrain,
          this.commercialReserve,
          blockedForShops,
        )
      : null;
    this.sim.state.commercialDistrict = this.commercialDistrict; // expose to the R3F renderer (same pattern as cityPlan)
    // Spec 079 — CONNECT the district: widen the high-street centre-line to a carriageway + route a
    // spur from the avenue's inland terminus to its nearest end (around homesteads + shops), and merge
    // both into the network so the shops front a real, drivable street.
    if (this.commercialDistrict && this.commercialDistrict.street.length > 0) {
      const t = this.sim.state.terrain;
      const shopCells = new Set<string>();
      for (const p of this.commercialDistrict.parcels)
        for (let y = p.y; y < p.y + p.h; y++)
          for (let x = p.x; x < p.x + p.w; x++) shopCells.add(`${x},${y}`);
      const mallPad = this.commercialDistrict.mallPad;
      for (let y = mallPad.y; y < mallPad.y + mallPad.h; y++)
        for (let x = mallPad.x; x < mallPad.x + mallPad.w; x++)
          shopCells.add(`${x},${y}`);
      const garagePad = this.commercialDistrict.garagePad;
      if (garagePad) {
        for (let y = garagePad.y; y < garagePad.y + garagePad.h; y++)
          for (let x = garagePad.x; x < garagePad.x + garagePad.w; x++)
            shopCells.add(`${x},${y}`);
        shopCells.add(`${garagePad.islandCell.x},${garagePad.islandCell.y}`);
      }
      const widened = new Set<string>();
      for (const c of this.commercialDistrict.street)
        for (const dy of [-1, 0, 1]) {
          const x = c.x,
            y = c.y + dy;
          if (
            roadCellOk(t, x, y) && // spec 143 — the widened high street never widens onto sand
            !residentialSetbackKeys.has(`${x},${y}`) &&
            !shopCells.has(`${x},${y}`)
          )
            widened.add(`${x},${y}`);
        }
      const streetCells = [...widened].map((k) => {
        const [x, y] = k.split(",").map(Number);
        return { x: x!, y: y! };
      });
      const crossWidened = new Set<string>();
      for (const c of this.commercialDistrict.crossStreet)
        for (const dx of [-1, 0, 1]) {
          const x = c.x + dx,
            y = c.y;
          if (
            roadCellOk(t, x, y) && // spec 143 — same beach guard for the cross street
            !residentialSetbackKeys.has(`${x},${y}`) &&
            !shopCells.has(`${x},${y}`)
          )
            crossWidened.add(`${x},${y}`);
        }
      const crossStreetCells = [...crossWidened].map((k) => {
        const [x, y] = k.split(",").map(Number);
        return { x: x!, y: y! };
      });
      const car = this.neighborhood.carriage;
      // 086-P1 — connect from the founders' carriage cell NEAREST the (now coastal) district, not the
      // inland terminus, so the spur is the shortest coast road rather than a backtrack inland.
      // Guard on a NON-EMPTY founders carriage: on some seeds (e.g. 4) the founders' neighbourhood
      // degenerates to zero carriage cells, so nearestPair(car, …) returns [undefined, …] and
      // leastCostPath dereferences start.x on undefined — a boot crash (spec 148 known adjacent issue).
      // With no carriage to spur from, still widen + merge the high street below; it simply gets no
      // founders' spur that seed. Every seed with a carriage keeps its byte-identical connector.
      if (car.length > 0) {
        const [terminus, near] = nearestPair(
          car,
          this.commercialDistrict.street,
        );
        const connector =
          leastCostPath(t, terminus, near, {
            slopeWeight: 0.5,
            diagonal: true,
            forbidBeach: true, // spec 143 — the coast spur runs the grass line, not the sand
            blocked: (x, y) =>
              residentialSetbackKeys.has(`${x},${y}`) ||
              shopCells.has(`${x},${y}`),
          }) ?? [];
        mergeAvenue(this.sim.state, layRoad(connector, 1)); // 088 — clean, uniform-width spur (not a raw 1-cell zig-zag)
      }
      mergeAvenue(this.sim.state, streetCells);
      mergeAvenue(this.sim.state, crossStreetCells);
    }
    // Spec 088 — the BUS route: a loop over the finished road network visiting every hood (the founders'
    // coast + each hamlet). Anchored on each hood's carriage centroid; makeBusRoute snaps to the nearest
    // road cell and BFS-connects them into a closed circuit. Pure + deterministic; the render-loop bus
    // drives it. Computed AFTER all the roads are merged so every hood is reachable.
    // Spec 088 — collect the remaining road centre-lines as ribbon ways (the trunk roads + connector
    // already recorded themselves through layRoad): the founders' avenue spine, each hamlet spine, and
    // the commercial high street. The smooth ribbon render draws these; traffic still uses the cells.
    //
    // These are RAW least-cost spines (cell-by-cell staircases), so unlike the trunk roads — which
    // layRoad STRING-PULLS into clean straight runs before recording — their ribbons wiggled and their
    // edge lines jittered into the ragged mess the operator saw along the founders' avenue. String-pull
    // them the same way (simplifyPath: greedily straighten while line-of-sight stays road-able) so every
    // ribbon centre-line, trunk or spine, is a clean polyline. Render-only: the road CELLS the traffic,
    // bus and rally drive are untouched.
    if (this.neighborhood.spine.length >= 2)
      this.roadWays.push({
        path: simplifyPath(this.neighborhood.spine),
        kind: "avenue",
        width: 4,
      });
    for (const s of satellites)
      if (s.spine.length >= 2)
        this.roadWays.push({
          path: simplifyPath(s.spine),
          kind: "street",
          width: 4,
        });
    if (this.commercialDistrict && this.commercialDistrict.street.length >= 2)
      this.roadWays.push({
        path: simplifyPath(this.commercialDistrict.street),
        kind: "avenue",
        width: 4,
      });
    if (
      this.commercialDistrict &&
      this.commercialDistrict.crossStreet.length >= 2
    )
      this.roadWays.push({
        path: this.commercialDistrict.crossStreet,
        kind: "avenue",
        width: 4,
      });
    // Spec 127 — attach the centre-lines for the R3F ribbon renderer (the raceState
    // precedent: live object on sim.state, read by the React tree). Shared reference, so
    // later pushes (the rally spur) land in the same array the renderer reads.
    this.sim.state.roadWays = this.roadWays;
    const hoodCentroid = (
      cells: { x: number; y: number }[],
    ): { x: number; y: number } => {
      let sx = 0,
        sy = 0;
      for (const c of cells) {
        sx += c.x;
        sy += c.y;
      }
      return {
        x: Math.round(sx / Math.max(1, cells.length)),
        y: Math.round(sy / Math.max(1, cells.length)),
      };
    };
    const commercialStop =
      this.commercialDistrict?.garagePad?.roadTarget ??
      this.commercialDistrict?.intersection;
    const busAnchors = [
      hoodCentroid(this.neighborhood.carriage),
      ...satellites.map((s) => hoodCentroid(s.carriage)),
      ...(commercialStop ? [commercialStop] : []),
    ];
    this.busRoute = makeBusRoute(
      { roadKind: this.sim.state.roadKind },
      busAnchors,
    );
    // Spec 097 R3.5 — connect the hilltop Rally Point to the road network. Route a spur from the
    // nearest existing road cell to the rally cell and lay it like any other road, mirroring the
    // commercial connector, so the guided walk and a rally-started race reach the bus-stop on a real
    // drivable road. Laid AFTER the bus route so that loop is unchanged. Fail soft when no in-margin
    // route exists: the overlook stays reachable on foot and simply gets no spur that seed.
    const rallyStruct = this.sim.state.structures.find(
      (s) => s.kind === "rally",
    );
    if (rallyStruct && this.sim.state.roads.length > 0) {
      const rallyCell = {
        x: Math.round(rallyStruct.x),
        y: Math.round(rallyStruct.y),
      };
      // Try the nearest road termini in turn (sorted deterministically by distance then x,y). The
      // route is allowed to cross homesteads so a path is always found through dense development, but
      // only the CLEAN run reaching down from the rally is paved: the ribbon climbs the knoll to the
      // bus-stop and stops where the homesteads (already road-fronted) begin, so no road is ever drawn
      // through a house. If a seat is so embedded that even its own cell is built over, it fails soft.
      const candidates: Cell[] = this.sim.state.roads
        .map((r) => ({ x: r.x, y: r.y }))
        .sort(
          (a, b) =>
            Math.hypot(a.x - rallyCell.x, a.y - rallyCell.y) -
              Math.hypot(b.x - rallyCell.x, b.y - rallyCell.y) ||
            a.x - b.x ||
            a.y - b.y,
        )
        .slice(0, 16);
      const roadable = (c: Cell) =>
        roadCellOk(t0, c.x, c.y) &&
        !residentialSetbackKeys.has(`${c.x},${c.y}`);
      for (const terminus of candidates) {
        const path =
          leastCostPath(t0, terminus, rallyCell, {
            slopeWeight: 0.5,
            diagonal: true,
            forbidBeach: true, // spec 143 — the rally spur is a paved road like any other
            margin: 160, // the hilltop can need a long detour around a ridge to reach a road
          }) ?? [];
        if (path.length < 2) continue;
        // the contiguous roadable suffix ending at the rally (the undeveloped knoll approach)
        let cut = path.length;
        for (let k = path.length - 1; k >= 0 && roadable(path[k]!); k--)
          cut = k;
        const tail = path.slice(cut);
        if (tail.length >= 2) {
          mergeAvenue(this.sim.state, layRoad(tail, 1));
          break;
        }
      }
    }
    // Spec 114 final local cleanup: late optional `street` spurs are not allowed to touch lot fence
    // borders. Keep avenue/carriage cells intact for traffic frontage and prune only ordinary street
    // cells that violate the final no-floor-touches-road invariant.
    const fenceSetbackKeys = new Set<string>();
    for (const lot of this.neighborhood.lots) {
      for (const f of lot.fence) {
        fenceSetbackKeys.add(`${f.x},${f.y}`);
        fenceSetbackKeys.add(`${f.x + 1},${f.y}`);
        fenceSetbackKeys.add(`${f.x - 1},${f.y}`);
        fenceSetbackKeys.add(`${f.x},${f.y + 1}`);
        fenceSetbackKeys.add(`${f.x},${f.y - 1}`);
      }
    }
    if (fenceSetbackKeys.size > 0) {
      const before = this.sim.state.roads.length;
      this.sim.state.roads = this.sim.state.roads.filter(
        (r) =>
          (r.kind ?? "street") !== "street" ||
          !fenceSetbackKeys.has(`${r.x},${r.y}`),
      );
      this.sim.state.roadSet.clear();
      this.sim.state.roadKind.clear();
      for (const r of this.sim.state.roads) {
        const rk = `${r.x},${r.y}`;
        this.sim.state.roadSet.add(rk);
        this.sim.state.roadKind.set(rk, r.kind ?? "street");
      }
      if (this.sim.state.roads.length !== before) this.sim.state.roadsVersion++;
    }
    // Spec 148 — CONNECTIVITY REPAIR. Up to here every road source (founders' avenue, satellite
    // hamlets + their spoke/mesh trunks, the commercial high street + cross street, the rally spur)
    // merged its cells straight into the network, but nothing GUARANTEED the pieces touched. On many
    // seeds one merged as an island — most often the commercial cross street the mall pad severs from
    // its own high street, or a rally stub the homesteads wall off — so World View showed roads that
    // plainly did not connect (~97% of cells in the main web). This pass closes those gaps: it repairs
    // the network into a SINGLE component by routing a short, coastal-legal connector (spec 140
    // forbidBeach, never on sand/water) from each orphan to the main web, laid through the same
    // string-pulled `layRoad` as every other trunk so it reads as a real road. An orphan that CANNOT
    // reach the main web without crossing water/beach (a future-bridge island, spec 123/133 lineage) or
    // a homestead setback (an embedded rally overlook, spec 097 fail-soft) is left in place — the pass
    // never strands or deletes, it only connects what a legal road can reach. Deterministic: components
    // and their anchor pairs are ordered canonically, and leastCostPath/layRoad are pure.
    {
      const size = t0.size;
      const idxToCell = (k: number): Cell => ({
        x: k % size,
        y: (k / size) | 0,
      });
      const cellIndex = (c: Cell) => c.y * size + c.x;
      // Does a candidate connector actually 4-bridge the orphan to the main web? BFS from the orphan's
      // seed cell across the CURRENT road cells plus the candidate's cells; a bridge exists the moment
      // it reaches any main cell. This is what keeps the repair honest: a connector is committed only
      // when it truly merges the orphan, never when `layRoad` happened to stroke an 8-connected diagonal
      // staircase (a simplifyPath LOS shortcut whose shoulders are all blocked) that the 4-connected
      // flood-fill still treats as split. 4-neighbour only, matching roadComponents.
      const bridges = (
        startIdx: number,
        roadIdx: ReadonlySet<number>,
        connIdx: ReadonlySet<number>,
        mainIdx: ReadonlySet<number>,
      ): boolean => {
        const seen = new Set<number>([startIdx]);
        const stack = [startIdx];
        while (stack.length) {
          const k = stack.pop()!;
          const x = k % size;
          // +/-1 stay on the same row (no horizontal wrap); +/-size are the vertical neighbours.
          const nbrs = [
            x < size - 1 ? k + 1 : -1,
            x > 0 ? k - 1 : -1,
            k + size,
            k - size,
          ];
          for (const nk of nbrs) {
            if (nk < 0 || nk >= size * size || seen.has(nk)) continue;
            if (!roadIdx.has(nk) && !connIdx.has(nk)) continue;
            if (mainIdx.has(nk)) return true;
            seen.add(nk);
            stack.push(nk);
          }
        }
        return false;
      };
      // Iterate to a fixed point: connecting one orphan grows the main web, which may then be the
      // nearest anchor for the next. Bounded so a genuinely stranded piece can never loop forever.
      for (let pass = 0; pass < 12; pass++) {
        const comps = roadComponents(this.sim.state.roads, size);
        if (comps.length <= 1) break;
        const mainCells = comps[0]!.cells.map(idxToCell);
        // Incremental sets, grown as orphans join, so later orphans in the SAME pass see the enlarged
        // web (no stale-main double-connectors) and the bridge test stays cheap.
        const roadIdx = new Set<number>(
          this.sim.state.roads.map((r) => r.y * size + r.x),
        );
        const mainIdx = new Set<number>(comps[0]!.cells);
        let joinedAny = false;
        for (let ci = 1; ci < comps.length; ci++) {
          const orphanComp = comps[ci]!;
          if (mainIdx.has(orphanComp.min)) continue; // already absorbed earlier this pass
          const orphan = orphanComp.cells.map(idxToCell);
          // Candidate anchors: each orphan cell paired with its nearest main cell. The single nearest
          // pair can be un-routable (its main end is beach-locked, or the only crossing is walled), so
          // try the best dozen distinct pairs in order.
          const pairs: { from: Cell; to: Cell; d: number }[] = [];
          for (const p of orphan) {
            let best: Cell | null = null,
              bestD = Infinity;
            for (const q of mainCells) {
              const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
              if (
                d < bestD ||
                (d === bestD && best && cellIndex(q) < cellIndex(best))
              ) {
                bestD = d;
                best = q;
              }
            }
            if (best) pairs.push({ from: p, to: best, d: bestD });
          }
          pairs.sort(
            (a, b) =>
              a.d - b.d ||
              cellIndex(a.from) - cellIndex(b.from) ||
              cellIndex(a.to) - cellIndex(b.to),
          );
          for (const { from, to, d } of pairs.slice(0, 12)) {
            // Search room to bend around the mall pad or a spur of water, capped well below the grid so
            // a far, genuinely stranded orphan cannot trigger a whole-grid flood on the fail path.
            const margin = Math.min(
              160,
              Math.max(64, Math.round(Math.sqrt(d)) * 2),
            );
            const path = leastCostPath(t0, from, to, {
              slopeWeight: 0.5,
              diagonal: true,
              forbidBeach: true, // spec 140 — the connector bends inland, never onto sand
              blocked: (x, y) => residentialSetbackKeys.has(`${x},${y}`),
              margin,
            });
            if (!path || path.length < 2) continue;
            // Dry-run the stroke (no ribbon side effect), then commit ONLY if it truly merges the
            // orphan into the main web — never a staircase that leaves isolated cells behind.
            const cells = layRoad(path, 1, "avenue", true);
            const connIdx = new Set<number>(cells.map((c) => c.y * size + c.x));
            if (!bridges(orphanComp.min, roadIdx, connIdx, mainIdx)) continue;
            mergeAvenue(this.sim.state, layRoad(path, 1)); // commit for real (records the ribbon)
            for (const k of connIdx) {
              roadIdx.add(k);
              mainIdx.add(k);
            }
            for (const k of orphanComp.cells) mainIdx.add(k); // the whole orphan is now main
            joinedAny = true;
            break;
          }
        }
        if (!joinedAny) break; // no orphan could be legally connected this pass — the rest are stranded
      }
      // Determinism-safe invariant (spec 148): after the repair the network is one web. A residual
      // orphan is a legitimate future-bridge/embedded-overlook exception, never a hard failure, so this
      // warns rather than throws — a boot must always complete. tests/roadConnectivity.test.ts pins the
      // >=99% single-component floor for the seed suite.
      const finalComps = roadComponents(this.sim.state.roads, size);
      if (finalComps.length > 1 && typeof console !== "undefined") {
        const orphanCells = this.sim.state.roads.length - finalComps[0]!.size;
        console.warn(
          `[spec148] road network has ${finalComps.length} components; ${orphanCells}/${this.sim.state.roads.length} cells stranded (largest ${((finalComps[0]!.size / this.sim.state.roads.length) * 100).toFixed(1)}%). Likely a future-bridge island or embedded rally overlook.`,
        );
      }
    }
    // Spec 149 — the BUS DEPOT: a surveyed pad beside the bus loop where the fleet parks overnight.
    // Sited AFTER the bus route (so the loop is unchanged — the rally-spur discipline) and AFTER the
    // fence cleanup (so the freshly laid gate spur is never pruned). Fail-soft: no in-margin fit means
    // no depot and the legacy single cosmetic coach keeps driving.
    if (this.busRoute) {
      const tr = COLONY.transit;
      const roadKeys = new Set(this.sim.state.roadKind.keys());
      const depotBlocked = new Set<string>([
        ...taken,
        ...residentialSetbackKeys,
        ...fenceSetbackKeys,
        ...roadKeys,
      ]);
      for (const s of this.sim.state.structures)
        depotBlocked.add(`${Math.round(s.x)},${Math.round(s.y)}`);
      // Cell roads are not the rendered road footprint: smooth, multi-cell ribbons can cut across
      // cells that are absent from `roadKind`. Conservatively reserve the ribbon's smoothing/width
      // blocked-cell approximation before siting any plot, otherwise a logically cell-clean depot
      // can still overlap visible road geometry (seed 4242 regression, spec 149).
      const ribbonCells = conservativeRoadRibbonBlockedCells(
        this.roadWays,
        t0,
        tr.depotRoadRibbonClearanceCells,
      );
      for (const k of ribbonCells) depotBlocked.add(k);
      const site = findDepotSite(
        t0,
        this.busRoute.loop,
        depotBlocked,
        roadKeys,
        {
          longCells: tr.depotLongCells,
          deepCells: tr.depotDeepCells,
          minRoadGap: tr.depotMinRoadGap,
          maxRoadGap: tr.depotMaxRoadGap,
          maxHeightSpreadM: tr.depotMaxHeightSpreadM,
        },
      );
      if (site) {
        const padCells: Cell[] = [];
        for (let y = site.y; y < site.y + site.h; y++)
          for (let x = site.x; x < site.x + site.w; x++)
            padCells.push({ x, y });
        reserveParcelLand(this.sim.state, padCells); // houses can never spawn on the depot
        // The gate spur is a REAL drivable road (ribbon-rendered) — buses ride INTO the plot on it.
        const spurCells = layRoad(
          [site.roadCell, site.gate],
          1,
          "street",
          false,
          "depot-spur",
        );
        // The surveyed gate is dry/in-bounds by the siting contract but may fail the generic
        // `roadCellOk` shoulder/slope filter at a cut edge. The centre-line ribbon still reaches it;
        // pin both endpoints into the drivable graph so the apron seam can never become a visual-only
        // road that fleet logic cannot enter.
        const spurKeys = new Set(spurCells.map((c) => `${c.x},${c.y}`));
        for (const endpoint of [site.roadCell, site.gate]) {
          const k = `${endpoint.x},${endpoint.y}`;
          if (!spurKeys.has(k)) {
            spurCells.push({ ...endpoint });
            spurKeys.add(k);
          }
        }
        mergeAvenue(this.sim.state, spurCells);
        // Spec 149 — the spur belongs to the BUSES. Fence it off from ambient car traffic (all its
        // cells except the loop junction) so a car never drives the dead-end into a maneuvering bus.
        this.sim.state.busDepotSpurCells = new Set(
          spurCells
            .filter(
              (c) => !(c.x === site.roadCell.x && c.y === site.roadCell.y),
            )
            .map((c) => `${c.x},${c.y}`),
        );
        const layout = depotLayout(site, {
          baysTotal: tr.baysTotal,
          laneDepth: tr.depotLaneDepth,
          bayDepth: tr.depotBayDepth,
        });
        this.busDepot = { site, layout };
        // Terrain leveling grades the pad flat (useTerrainLeveling reads this off the state, the
        // commercial-pad path), so slab, buses and the walker's ground share one height.
        this.sim.state.busDepotPad = {
          x: site.x,
          y: site.y,
          w: site.w,
          h: site.h,
        };
        // Fleet geometry over the SAME smoothed loop the render drives, plus spur + bay paths.
        const loopPath = buildPath(
          smoothClosed(simplifyClosed(this.busRoute.loop, 1.5), 2),
          true,
        );
        const spurPath = buildPath(
          [
            { x: layout.gate.x, y: layout.gate.y },
            { x: site.roadCell.x, y: site.roadCell.y },
          ],
          false,
        );
        const bayPaths = layout.bays.map((b) =>
          buildPath(smoothOpen(b.path, 1), false),
        );
        this.fleetPaths = {
          loop: loopPath,
          spur: spurPath,
          bays: bayPaths,
          gateHeading: layout.gate.headingOut,
        };
        this.fleetGeom = makeFleetGeometry(
          loopPath,
          spurPath,
          bayPaths,
          this.busRoute.stops,
        );
        this.busFleet = makeFleet(COLONY.transit, this.worldSeed); // seed the free-bay lottery per world
      }
    }
    // Spec 082 — restore stored Kookerbook profiles BEFORE seeding Joe: ensureKbProfile skips
    // citizens that already have a profile, so a restored timeline is never clobbered by a fresh
    // founder profile (the bug: seed-then-restore overwrote Joe's stored posts with a 1-post reset).
    this.restoreKookerbook();
    this.seedJoe(); // spec 078 — Joe the Crab takes up residence on the shore-most homestead
    this.seedViw(); // spec 083 — Viw the Builder takes the homestead beside him
    this.seedJack(); // player/UI lane — Jack is visible as an in-world reviewer avatar
    this.seedRallyFriend(); // phase-1 S1 — a friend waits at the night rally so the meetup completes
    this.restoreBlueprints(); // spec 077 P4.5 — stored designs regenerate their houses on reload
    // Spec 077 P4 — listen for blueprint_saved posted back by the House Builder popup. Same-origin
    // only; the script is validated before anything is stored or built. Guarded for node test runs.
    if (typeof window !== "undefined") {
      window.addEventListener("message", (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return;
        const d = e.data as {
          type?: string;
          lotId?: string;
          script?: string;
        } | null;
        if (
          !d ||
          d.type !== "blueprint_saved" ||
          typeof d.lotId !== "string" ||
          typeof d.script !== "string"
        )
          return;
        this.applyBlueprint(d.lotId, d.script);
      });
    }
    // Resolve the real reply source asynchronously (in-cluster: nginx-proxied Hermes; else mock).
    void this.initBotAdapter();
  }

  /** Swap in the runtime-resolved bot adapter (Hermes via the nginx proxy in-cluster) once known. */
  private async initBotAdapter(): Promise<void> {
    try {
      const adapter = await resolveBotAdapter();
      this.botService.setAdapter(adapter);
      this.emit(); // refresh botSource in the UI
    } catch {
      /* keep the sync default (mock) on any failure */
    }
  }

  /** Roll a fresh playful settler name for the immigration dialog. */
  rollName(): string {
    return randomSettlerName(this.sim.rng);
  }

  /** Register a settler with the real kooker user service, place them, inject their holdings. */
  async registerSettler(
    name: string,
  ): Promise<{ card: KookerCard; holdings: number; settlement: number }> {
    const card = await kookerRegister(name);
    const res = addSettler(this.sim.state, this.sim.rng, card);
    saveColony(this.sim.state);
    this.emit();
    return {
      card,
      holdings: res?.holdings ?? 0,
      settlement: res?.settlement ?? 0,
    };
  }

  /** Border Control: generate the next candidate family at the border (status: triage). */
  async addNewcomer(overrides?: HouseholdOverrides): Promise<Household> {
    const h = await this.backend.addNewcomer(overrides);
    this.emit();
    return h;
  }
  /** Operator decision on a border candidate (approve / hold / decline). Approve boots a bot. */
  async decideNewcomer(id: string, decision: Decision): Promise<void> {
    const h = await this.backend.decide(id, decision);
    this.emit(); // reflect approved/held/rejected immediately
    if (h && decision === "approve" && h.status === "approved") {
      const bot = await this.botService.create(h); // boot a bot, inject its life history, get its first reply
      // Spec 074 — if the patrol bot allocated a plot, register this household's lead as a named citizen.
      // The Hermes pod + kooker user mint happen out-of-process (separate PRs against kooker-bot-spawner /
      // kooker-user, joekookerbot merges) — here we just hold the engine-side record.
      if (bot && bot.plotId) {
        const plot = this.cityPlan.plots.find((p) => p.id === bot.plotId);
        if (plot) {
          const citizen = this.citizens.register(h, plot, Date.now());
          // Spec 082 — every citizen gets a Kookerbook profile at registration.
          if (citizen) {
            const lead0 = h.members[0];
            this.ensureKbProfile({
              citizenId: citizen.id,
              alias: citizen.displayName,
              bio: lead0?.occupation
                ? `New in Landing One. Works as a ${lead0.occupation}.`
                : "New in Landing One.",
              plotId: citizen.plotId,
              address: citizen.plotName,
              kind: "human",
            });
          }
          // Spec 076 — give the newcomer a real HOMESTEAD parcel (not just the flavour plot name), so
          // their avatar walks to a homestead that is actually theirs. If the colony can afford it
          // (materials + a free hand), raise the house right away; otherwise the Build button stands
          // ready on their plot in the Homesteads panel.
          if (citizen) {
            // Spec 085 — the economic arrival: the newcomer lands with a ₭ deposit, BUYS the deed to
            // a free plot, then hires Viw to build what they can afford. The whole trade in one move.
            this.seedDeposit(citizen.id);
            const freeLot = this.neighborhood.lots.find(
              (l) => !l.ownerCitizenId && !l.reservedFor,
            );
            if (freeLot && this.purchaseLot(citizen.id, freeLot.id)) {
              this.commissionLot(freeLot.id); // Viw raises a home for the remaining purse
            }
            // Spec 079 P1 — if the newcomer can still afford a shop plot after their home, they take
            // one on the high street: the city's first shopkeepers grow from the same arrivals.
            const shop = this.cheapestFreeShop();
            if (
              shop &&
              this.walletK(citizen.id) >= this.shopPriceK(shop.kind)
            ) {
              this.buyCommercialShop(citizen.id, shop.id);
            }
          }
          // Spec 076 — mint the real kooker sub-user + Hermes pod for this citizen, owned by the player
          // (parentUserId). Best-effort: never blocks the game if the backend is unreachable.
          const lead = h.members[0];
          if (lead) {
            const { firstName, lastName } = splitName(lead.name);
            void spawnCitizenSubUser({
              firstName,
              lastName,
              age: lead.age,
              profession: lead.occupation,
            }).then((r) => {
              if (!r.ok)
                console.warn(
                  "[citylife] citizen sub-user spawn deferred:",
                  r.error,
                );
            });
          }
        }
      }
      this.emit();
    }
  }

  /** Spec 074 — engine-side first-person view of one citizen (cheap, deterministic JSON). The
   *  governor loop reads this every tick + may pair it with a costly PNG snapshot (vision). */
  firstPersonView(citizenId: string): FirstPersonView | null {
    return firstPersonView(this.sim.state, citizenId, this.citizens);
  }

  /** Spec 074 — the citizen's VISION as a PNG data URL: what they actually see standing at their
   *  home, looking down their street. Resolves the home cell + the nearest road from the roster +
   *  first-person view, then has the renderer drop to eye height and capture one frame. Returns null
   *  before the renderer starts, for an unknown citizen, or if they have no road in sight yet. */
  firstPersonPNG(citizenId: string): string | null {
    if (!this.renderer) return null;
    const c = this.citizens.byId(citizenId);
    if (!c) return null;
    const view = firstPersonView(this.sim.state, citizenId, this.citizens);
    const look = view?.nearestRoad ?? {
      x: this.sim.state.terrain.landing.x,
      y: this.sim.state.terrain.landing.y,
    };
    return this.renderer.firstPersonPNG(c.homeXY, { x: look.x, y: look.y });
  }

  /** Photo-mode automation hook: pair a screenshot-capable PNG with a deterministic, public-safe HUD evidence payload. */
  captureFirstPersonDemo(): FirstPersonDemoCapture | null {
    const ui = this.getUiState().firstPerson;
    const view = ui.view;
    if (!ui.active || !ui.citizenId || !view) return null;
    const round = (n: number, places = 2) => Number(n.toFixed(places));
    const action = view.interactionPrompt?.label ?? null;
    const clockLabel = `Day ${view.clock.day} ${String(view.clock.hour).padStart(2, "0")}:${String(view.clock.minute).padStart(2, "0")}`;
    const guidedTarget = ui.guidedTarget;
    const hudLines = [
      action ?? "No nearby action",
      guidedTarget
        ? `Guided walk ${guidedTarget.label} (${guidedTarget.x}, ${guidedTarget.y}) · ${formatDistanceLabel(guidedTarget.remainingDistance)}`
        : null,
      guidedTarget?.nextWaypoint
        ? `Next leg (${guidedTarget.nextWaypoint.x}, ${guidedTarget.nextWaypoint.y})`
        : null,
      ui.blockedReason ? `Blocked ${ui.blockedReason}` : null,
      view.mood.hungry ? "colony hungry" : null,
      view.mood.brownout ? "brownout" : null,
      view.mood.fever > 0.4 ? "illness spreading" : null,
    ].filter((line): line is string => Boolean(line));

    return {
      evidence: {
        citizenId: ui.citizenId,
        citizenName: ui.citizenName ?? view.citizen.displayName,
        position: {
          x: round(view.citizen.positionXY.x),
          y: round(view.citizen.positionXY.y),
        },
        heading: round(view.citizen.heading, 3),
        lookPitch: round(ui.lookPitch, 3),
        action,
        guidedTarget,
        blockedReason: ui.blockedReason,
        clockLabel,
        hudLines,
      },
      pngDataUrl: this.renderer ? this.firstPersonPNG(ui.citizenId) : null,
    };
  }

  /** P2 — turn a player's magic prompt into a PG-safe colonist personality (safety enforced on the
   *  prompt and the generated text). Returns a discriminated result so the UI shows the reason on reject. */
  generatePersonality(
    magicPrompt: string,
  ): Promise<
    { ok: true; personality: string } | { ok: false; reason: string }
  > {
    return this.botService.generatePersonality(magicPrompt);
  }

  /** P1 — record the logged-in operator name (from auth). Marks their avatar + gates the step-into.
   *  The name is now only a label + the legacy fallback; identity is keyed off the kooker userId
   *  (see setOperatorUserId). Still attempts a claim so an order of name-then-userId resolves either way. */
  setOperatorName(name: string | null): void {
    this.operatorName = name && name.trim() ? name.trim() : null;
    this.claimOwnCitizen();
    this.updateOperatorCar();
    if (this.fpCitizenId && !this.canStepIntoCitizen(this.fpCitizenId)) {
      this.exitFirstPerson();
      return;
    }
    this.emit();
  }

  /** Identity-key the player view to the authenticated kooker userId (decoded from the JWT in
   *  authClient), NOT the display name. Stamps (claims) the citizen the player owns so own-data and
   *  step-into resolve by user id even when names collide. Re-evaluates the step-into guard like
   *  setOperatorName, so flipping identity drops a now-disallowed first-person session. */
  setOperatorUserId(userId: string | null): void {
    this.operatorUserId = userId && userId.trim() ? userId.trim() : null;
    this.claimOwnCitizen();
    this.updateOperatorCar();
    if (this.fpCitizenId && !this.canStepIntoCitizen(this.fpCitizenId)) {
      this.exitFirstPerson();
      return;
    }
    this.emit();
  }

  /** Identity claim / backfill: once both the login name and kooker userId are known, stamp the userId
   *  onto the citizen the player owns — matched by name ONCE, then identity-keyed forever after. A
   *  no-op if the userId is unknown, if the user already owns a stamped citizen (so a later name
   *  collision can never re-point them), or if no unclaimed name match exists yet (the citizen may be
   *  created later; operatorCitizenId still resolves it by the unclaimed-name fallback until claimed). */
  private claimOwnCitizen(): void {
    if (!this.operatorUserId) return;
    if (this.citizens.byKookerUserId(this.operatorUserId)) return; // already claimed
    const target = this.citizens.resolveOwnCitizenId(
      this.operatorUserId,
      this.operatorName,
    );
    if (target) this.citizens.setKookerUserId(target, this.operatorUserId);
  }

  /** Player-view guard: operators/admins may step into any citizen; CITYLIFE_PLAYER may only enter their own. */
  private stepInCitizenIds(): string[] {
    if (!this.playerView) return this.citizens.list().map((c) => c.id);
    const own = this.operatorCitizenId();
    return own ? [own] : [];
  }

  private canStepIntoCitizen(citizenId: string): boolean {
    return this.stepInCitizenIds().includes(citizenId);
  }

  /** Spec 096 — the handling effect of a part as short up/down badges, so the Garage HUD shows at a
   *  glance what fitting it does (the core promise: a part changes performance, not just looks). Empty
   *  for a pure cosmetic. Pure + deterministic. */
  private partEffects(kind: CarPartKind): { label: string; up: boolean }[] {
    const LABELS: [keyof CarStatVector, string][] = [
      ["topSpeed", "Spd"],
      ["acceleration", "Acc"],
      ["grip", "Grip"],
      ["braking", "Brk"],
    ];
    const d = CAR_PARTS[kind].statDeltas;
    const out: { label: string; up: boolean }[] = [];
    for (const [stat, label] of LABELS) {
      const v = d[stat];
      if (typeof v === "number" && v !== 0) out.push({ label, up: v > 0 });
    }
    return out;
  }

  /** Player data isolation: turn the restricted CITYLIFE_PLAYER view on/off. When on, the HUD shows only
   *  the player's own data + others' public presence (see uiState.citizens). The login/role-gating slice
   *  flips this on for a player; operators/admins keep the whole-colony view. */
  setPlayerView(on: boolean): void {
    this.playerView = on;
    if (this.fpCitizenId && !this.canStepIntoCitizen(this.fpCitizenId)) {
      this.exitFirstPerson();
      return;
    }
    this.emit();
  }

  /** The citizen the signed-in player owns. Identity FIRST: the citizen stamped with the operator's
   *  kooker userId (claimed at login). Falls back to a display-name match only for an UNCLAIMED citizen
   *  (legacy / not-yet-claimed), so a colliding name can never resolve to another user's citizen.
   *  Pure read with no side effects — the claim/stamp happens in setOperatorUserId / setOperatorName. */
  private operatorCitizenId(): string | null {
    return this.citizens.resolveOwnCitizenId(
      this.operatorUserId,
      this.operatorName,
    );
  }

  /** Spec 096 Slice D — buy a car part with the player's in-game city coin (KCO). Records ownership so
   *  the part can then be mounted (the Street Rod buy-then-bolt-on loop). Free parts own for nothing; a
   *  paid part is gated on the exact ledger balance and moves the in-game double-entry ledger only (the
   *  real-kooker-ledger mirror is a later, furniture-lane-coordinated slice). */
  buyCarPart(kind: string): boolean {
    const id = this.operatorCitizenId();
    if (!id) return false;
    const def = CAR_PARTS[kind as CarPartKind];
    if (!def) return false;
    if (ownsCarPart(id, def.kind)) return true; // already owned (incl. free) — no charge
    const price = def.cost;
    if (price <= 0) {
      ownCarPart(id, def.kind);
      this.emit();
      return true;
    }
    if (ledgerBalance(this.sim.state.ledger, `citizen:${id}`) < price)
      return false;
    const c = this.citizens.byId(id);
    const posted = ledgerPost(
      this.sim.state.ledger,
      `${c?.displayName ?? id} buys a ${def.label} for ${price} ${CURRENCY}`,
      [
        { account: `citizen:${id}`, amount: -price },
        { account: CAR_SHOP_ACCOUNT, amount: price },
      ],
    );
    if (!posted) return false;
    ownCarPart(id, def.kind);
    this.kbPost(id, "event", `Bought a ${def.label} for ${price} city coin.`);
    this.emit();
    return true;
  }

  /** Spec 096 — mount a bolt-on part on the signed-in player's car. The part must be OWNED (buy it
   *  first); one part per socket (a new part on a socket replaces the old). No-op without an operator,
   *  for an unknown kind, or for an unowned part. */
  mountCarPart(kind: string): boolean {
    const id = this.operatorCitizenId();
    if (!id) return false;
    const def = CAR_PARTS[kind as CarPartKind];
    if (!def) return false;
    if (!ownsCarPart(id, def.kind)) return false; // must own it first
    const car = loadCar(id);
    const kept = validCarParts(car.parts).filter(
      (k) => CAR_PARTS[k].socket !== def.socket,
    );
    saveCar(id, { ...car, parts: [...kept, def.kind] });
    this.updateOperatorCar();
    this.emit();
    return true;
  }

  /** Spec 096 — remove a bolt-on part from the player's car. No-op without an operator. */
  unmountCarPart(kind: string): boolean {
    const id = this.operatorCitizenId();
    if (!id) return false;
    const car = loadCar(id);
    const next = validCarParts(car.parts).filter((k) => k !== kind);
    saveCar(id, { ...car, parts: next });
    this.updateOperatorCar();
    this.emit();
    return true;
  }

  /** Spec 096 H — repaint a channel of the signed-in player's car. The colour must be one of the curated
   *  palette swatches for that channel (so paint stays curated + deterministic). Updates the stored car
   *  and the in-world mesh. No-op without an operator, for an unknown channel, or an off-palette colour. */
  setCarPaint(channel: string, color: number): boolean {
    const id = this.operatorCitizenId();
    if (!id) return false;
    const palette = PAINT_PALETTES[channel as PaintChannel];
    if (!palette || !palette.includes(color)) return false;
    const car = loadCar(id);
    saveCar(id, { ...car, paint: { ...car.paint, [channel]: color } });
    this.updateOperatorCar();
    this.emit();
    return true;
  }

  /** Spec 096 G — list a bolt-on part the player owns on the Kookerbook car-part classifieds for city
   *  coin. The part must be owned and NOT currently mounted (unmount it first); listing escrows it out of
   *  the seller's garage onto the public board. No-op without an operator, for an unknown / free /
   *  unowned / mounted part, or a non-positive price. */
  listCarPartForSale(kind: string, price: number): boolean {
    const id = this.operatorCitizenId();
    if (!id) return false;
    const def = CAR_PARTS[kind as CarPartKind];
    if (!def || def.cost === 0) return false; // unknown or a free/universal part
    if (!ownsCarPart(id, def.kind)) return false;
    if (validCarParts(loadCar(id).parts).includes(def.kind)) return false; // unmount first
    if (!Number.isFinite(price) || price <= 0) return false;
    const market = addCarPartListing(
      loadCarPartMarket(),
      id,
      def.kind,
      Math.round(price),
    );
    if (!findCarPartListing(market, carPartListingId(id, def.kind)))
      return false; // rejected (board full)
    unownCarPart(id, def.kind);
    saveCarPartMarket(market);
    this.kbPost(
      id,
      "event",
      `Listed a ${def.label} for ${Math.round(price)} city coin.`,
    );
    this.emit();
    return true;
  }

  /** Spec 096 G — pull the player's own listing back off the board; the part returns to their garage. */
  unlistCarPart(listingId: string): boolean {
    const id = this.operatorCitizenId();
    if (!id) return false;
    const listing = findCarPartListing(loadCarPartMarket(), listingId);
    if (!listing || listing.sellerCitizenId !== id) return false;
    ownCarPart(id, listing.kind);
    saveCarPartMarket(removeCarPartListing(loadCarPartMarket(), listingId));
    this.emit();
    return true;
  }

  /** Spec 096 G — buy a listed part from another player. City coin moves buyer -> seller on the in-game
   *  ledger, the part lands in the buyer's garage and the listing clears. Gated on the buyer's exact
   *  balance; you cannot buy your own listing (unlist it) or one you already own. */
  buyCarPartListing(listingId: string): boolean {
    const id = this.operatorCitizenId();
    if (!id) return false;
    const listing = findCarPartListing(loadCarPartMarket(), listingId);
    if (!listing) return false;
    if (listing.sellerCitizenId === id) return false; // unlist your own instead
    if (ownsCarPart(id, listing.kind)) return false; // already own one
    if (ledgerBalance(this.sim.state.ledger, `citizen:${id}`) < listing.price)
      return false;
    const buyer = this.citizens.byId(id);
    const def = CAR_PARTS[listing.kind];
    const posted = ledgerPost(
      this.sim.state.ledger,
      `${buyer?.displayName ?? id} buys a ${def.label} for ${listing.price} ${CURRENCY}`,
      [
        { account: `citizen:${id}`, amount: -listing.price },
        {
          account: `citizen:${listing.sellerCitizenId}`,
          amount: listing.price,
        },
      ],
    );
    if (!posted) return false;
    ownCarPart(id, listing.kind);
    saveCarPartMarket(removeCarPartListing(loadCarPartMarket(), listingId));
    this.kbPost(
      id,
      "event",
      `Bought a ${def.label} from the classifieds for ${listing.price} city coin.`,
    );
    this.emit();
    return true;
  }

  /** Spec 096 — (re)render the signed-in player's car parked in the world, a cell off their home (the
   *  land-next-to-your-car spot). Called whenever the operator or the car changes. Render-only. */
  private updateOperatorCar(): void {
    if (!this.renderer) return;
    const id = this.operatorCitizenId();
    const c = id ? this.citizens.byId(id) : null;
    if (!id || !c) {
      this.renderer.setOperatorCar(null, null);
      return;
    }
    const home = c.homeXY ?? c.pos;
    const cell = { x: Math.round(home.x) + 1, y: Math.round(home.y) };
    this.renderer.setOperatorCar(loadCar(id), cell);
  }

  /** Spec 096 E — the land-next-to-your-car payoff. Drop the signed-in player into first person
   *  standing on a walkable cell beside their own parked car (the car sits a cell east of the home,
   *  see updateOperatorCar), facing it, ready to walk up and open the bonnet. No-op without an
   *  operator citizen. Deterministic: takes the first walkable spot from a fixed candidate order. */
  jumpToMyHouse(): boolean {
    const id = this.operatorCitizenId();
    if (!id) return false;
    const c = this.citizens.byId(id);
    if (!c) return false;
    const home = c.homeXY ?? c.pos;
    const hx = Math.round(home.x);
    const hy = Math.round(home.y);
    const car = { x: hx + 1, y: hy };
    // stand on a walkable cell next to the car, in a fixed order so the spawn is deterministic
    const spots = [
      { x: hx + 2, y: hy }, // east of the car: looks back west over the car and the house
      { x: hx + 1, y: hy + 1 }, // south of the car
      { x: hx + 1, y: hy - 1 }, // north of the car
      { x: hx, y: hy }, // the home cell, looking east at the car
    ];
    const stand = spots.find(
      (s) => this.blockedStepReason(s.x, s.y) === null,
    ) ?? { x: hx, y: hy };
    c.pos = { x: stand.x, y: stand.y };
    c.target = { x: stand.x, y: stand.y };
    c.heading = Math.atan2(car.y - stand.y, car.x - stand.x); // face the car
    return this.enterFirstPerson(id);
  }

  /** Spec 096 F — open the bonnet to reveal the engine bay. The Garage HUD then shows each engine-bay
   *  socket (engine, hood) with its install state so a part can be bought and fitted from there. Requires
   *  an operator (the panel is operator-gated). The engineBay snapshot lives on uiState.garage. */
  openBonnet(): boolean {
    if (!this.operatorCitizenId()) return false;
    this.bonnetOpen = true;
    this.emit();
    return true;
  }

  /** Spec 096 F — close the bonnet, back to the car overview. */
  closeBonnet(): void {
    this.bonnetOpen = false;
    this.emit();
  }

  /** P1 — the bot/governor points a citizen's avatar at a destination cell (it walks there). */
  setAvatarTarget(citizenId: string, cell: { x: number; y: number }): boolean {
    const ok = this.citizens.setTarget(citizenId, cell);
    if (ok) this.emit();
    return ok;
  }

  /** P1 — step the operator INTO a citizen for a live first-person view through the bot's eyes. */
  enterFirstPerson(citizenId: string): boolean {
    if (!this.citizens.byId(citizenId)) return false;
    if (!this.canStepIntoCitizen(citizenId)) return false;
    this.fpCitizenId = citizenId;
    this.fpKeys.clear();
    this.fpWalkSpeed = 0;
    this.fpLookPitch = 0;
    this.fpSprintCharge = 1;
    this.fpGuidedTarget = null;
    this.fpBlockedReason = null;
    this.renderer?.enterFirstPerson(citizenId);
    this.emit();
    return true;
  }
  /** P1 — leave first-person, restoring the orbit camera. */
  exitFirstPerson(): void {
    this.fpCitizenId = null;
    this.fpRidingBusId = null; // spec 149 — stepping out of the citizen also steps off the bus
    this.fpCameraCell = null;
    this.fpKeys.clear();
    this.fpWalkSpeed = 0;
    this.fpLookPitch = 0;
    this.fpSprintCharge = 1;
    this.fpGuidedTarget = null;
    this.fpBlockedReason = null;
    this.fpNarration = null;
    this.fpNarrating = false;
    this.renderer?.exitFirstPerson();
    this.emit();
  }

  /** First-person locomotion — hold W/S (or up/down) to walk, A/D to strafe, and left/right arrows to turn.
   *  The HUD keydown/keyup feed this; movement is applied per-frame in the loop so it is smooth. */
  setFpKey(key: string, down: boolean): void {
    const map: Record<string, string> = {
      w: "fwd",
      keyw: "fwd",
      arrowup: "fwd",
      s: "back",
      keys: "back",
      arrowdown: "back",
      a: "strafeLeft",
      keya: "strafeLeft",
      arrowleft: "left",
      d: "strafeRight",
      keyd: "strafeRight",
      arrowright: "right",
      shiftleft: "sprint",
      shiftright: "sprint",
    };
    const m = map[key.toLowerCase()];
    if (!m) return;
    if (down) this.fpKeys.add(m);
    else this.fpKeys.delete(m);
  }

  /** Pointer-lock mouse-look math: positive dx yaws right; positive dy looks down. */
  applyFirstPersonMouseLook(dx: number, dy: number): boolean {
    const c = this.fpCitizenId ? this.citizens.byId(this.fpCitizenId) : null;
    if (!c) return false;
    const cfg = COLONY.firstPerson;
    const sensitivity =
      cfg.mouseSensitivity * cfg.mouseSensitivityScale[this.fpMouseSensitivity];
    c.heading += dx * sensitivity;
    this.fpLookPitch = Math.max(
      -cfg.maxLookPitch,
      Math.min(cfg.maxLookPitch, this.fpLookPitch - dy * sensitivity),
    );
    this.emit();
    return true;
  }

  setFirstPersonMouseSensitivity(level: FirstPersonMouseSensitivity): boolean {
    if (!(level in COLONY.firstPerson.mouseSensitivityScale)) return false;
    this.fpMouseSensitivity = level;
    this.emit();
    return true;
  }

  /** Mouse-look comfort affordance: re-level vertical look without snapping yaw/heading. */
  levelFirstPersonLook(): boolean {
    if (!this.fpCitizenId) return false;
    this.fpLookPitch = 0;
    this.emit();
    return true;
  }

  /** Spec 149 — advance the bus fleet in sim-minutes (frozen while paused, scaled with sim speed,
   *  so the 08:00–23:00 schedule stays honest against the clock) and keep a riding player PINNED
   *  to their bus: pos, target and heading all follow the pose, so the fp camera rides along and
   *  stepAvatars/wander can never fight the pin. */
  private transitTick(dtReal: number): void {
    if (!this.busFleet || !this.fleetGeom || !this.fleetPaths) return;
    if (!this.paused) {
      const dtMin =
        dtReal *
        this.speed *
        COLONY.time.stepsPerSec *
        COLONY.time.simMinPerStep;
      if (dtMin > 0)
        stepFleet(
          this.busFleet,
          dtMin,
          this.sim.state.clock.totalMinutes,
          this.fleetGeom,
          COLONY.transit,
        );
    }
    if (this.fpRidingBusId !== null && this.fpCitizenId) {
      const pose = this.busPoseOf(this.fpRidingBusId);
      const c = this.citizens.byId(this.fpCitizenId);
      if (pose && c) {
        c.pos.x = pose.x;
        c.pos.y = pose.y;
        c.target = { x: pose.x, y: pose.y };
        c.heading = pose.heading;
      } else {
        this.fpRidingBusId = null;
      }
    }
  }

  /** Spec 149 — where fleet bus `id` physically is right now (grid coords), or null without a fleet. */
  busPoseOf(id: number): BusPose | null {
    if (!this.busFleet || !this.fleetGeom || !this.fleetPaths) return null;
    const b = this.busFleet.buses[id];
    return b
      ? busPose(b, this.fleetPaths, this.fleetGeom, COLONY.transit)
      : null;
  }

  /** Spec 149 — all fleet bus poses in bus-id order (the render layer draws these). */
  busPoses(): BusPose[] {
    if (!this.busFleet || !this.fleetGeom || !this.fleetPaths) return [];
    return this.busFleet.buses.map((b) =>
      busPose(b, this.fleetPaths!, this.fleetGeom!, COLONY.transit),
    );
  }

  /** Spec 149 — the bus action available RIGHT NOW: board a dwelling (doors-open) bus in range, or
   *  step off the one being ridden while its doors are open. Bus prompts outrank ground prompts
   *  because the window closes when the bus pulls away. */
  private busInteraction(): {
    action: "board" | "exit";
    busId: number;
    prompt: {
      kind: "bus";
      label: string;
      targetName: string;
      targetXY: { x: number; y: number };
      distance: number;
    };
  } | null {
    if (!this.busFleet || !this.fpCitizenId) return null;
    const c = this.citizens.byId(this.fpCitizenId);
    if (!c) return null;
    // Measure from the CAMERA capsule when the renderer reports one — that is where the player
    // actually stands; the roster citizen is the data twin.
    const at = this.fpCameraCell ?? c.pos;
    if (this.fpRidingBusId !== null) {
      const pose = this.busPoseOf(this.fpRidingBusId);
      if (!pose || !pose.doorsOpen) return null;
      return {
        action: "exit",
        busId: this.fpRidingBusId,
        prompt: {
          kind: "bus",
          label: "Exit bus",
          targetName: `Bus ${this.fpRidingBusId + 1}`,
          targetXY: { x: pose.x, y: pose.y },
          distance: 0,
        },
      };
    }
    const maxD = COLONY.transit.boardMaxDistanceCells;
    let best: { busId: number; d: number; pose: BusPose } | null = null;
    for (const b of this.busFleet.buses) {
      const pose = this.busPoseOf(b.id);
      if (!pose?.doorsOpen) continue;
      const d = Math.hypot(pose.x - at.x, pose.y - at.y);
      if (d <= maxD && (!best || d < best.d)) best = { busId: b.id, d, pose };
    }
    if (!best) return null;
    return {
      action: "board",
      busId: best.busId,
      prompt: {
        kind: "bus",
        label: `Board bus ${best.busId + 1}`,
        targetName: `Bus ${best.busId + 1}`,
        targetXY: { x: best.pose.x, y: best.pose.y },
        distance: Number(best.d.toFixed(1)),
      },
    };
  }

  /** Spec 149 — step off the ridden bus onto the pavement beside its door (falls back to the bus
   *  cell itself when the kerb side is blocked). */
  private alightBus(c: { pos: { x: number; y: number } }): void {
    const busId = this.fpRidingBusId;
    this.fpRidingBusId = null;
    const pose = busId !== null ? this.busPoseOf(busId) : null;
    let spot = pose ? { x: pose.x, y: pose.y } : { x: c.pos.x, y: c.pos.y };
    if (pose) {
      const kerb = {
        x: pose.x - Math.sin(pose.heading) * 1.5,
        y: pose.y + Math.cos(pose.heading) * 1.5,
      };
      if (
        this.blockedStepReason(Math.round(kerb.x), Math.round(kerb.y)) === null
      )
        spot = kerb;
    }
    c.pos.x = spot.x;
    c.pos.y = spot.y;
    if (this.fpCitizenId)
      this.citizens.setTarget(this.fpCitizenId, { x: spot.x, y: spot.y });
    // Drop the camera capsule on the kerb too, facing the departing bus.
    this.fpTeleportRequest = {
      x: spot.x,
      y: spot.y,
      ...(pose ? { yaw: cameraYawToward(spot, pose) } : {}),
      seq: ++this.fpTeleportSeq,
    };
    this.fpNarrating = false;
    this.fpNarration = "You step off the bus.";
  }

  /** Spec 149 e2e/dev helper — jump the sim clock to hh:mm on the current day. The fleet reads the
   *  new time on its next tick; daylight refreshes on the next sim step. */
  debugSetClock(hour: number, minute = 0): void {
    const c = this.sim.state.clock;
    const h = Math.max(0, Math.min(23, Math.round(hour)));
    const m = Math.max(0, Math.min(59, Math.round(minute)));
    c.totalMinutes = c.day * 1440 + h * 60 + m;
    c.hour = h;
    c.minute = m;
    c.isDay = h >= COLONY.time.dayStartHour && h < COLONY.time.dayEndHour;
    this.emit();
  }

  /** Spec 149 e2e/dev helper — teleport the stepped-in walker (roster citizen AND the camera
   *  capsule) to a cell, optionally facing a target cell. */
  debugPlaceFirstPerson(
    x: number,
    y: number,
    faceX?: number,
    faceY?: number,
  ): boolean {
    const id = this.fpCitizenId;
    if (!id) return false;
    const c = this.citizens.byId(id);
    if (!c) return false;
    c.pos.x = x;
    c.pos.y = y;
    this.citizens.setTarget(id, { x, y });
    this.fpGuidedTarget = null;
    this.fpTeleportRequest = {
      x,
      y,
      ...(faceX !== undefined && faceY !== undefined
        ? { yaw: cameraYawToward({ x, y }, { x: faceX, y: faceY }) }
        : {}),
      seq: ++this.fpTeleportSeq,
    };
    this.emit();
    return true;
  }

  /** Execute the current first-person Action prompt with deterministic player-facing feedback. */
  activateFirstPersonInteraction(): boolean {
    const id = this.fpCitizenId;
    if (!id) return false;
    const c = this.citizens.byId(id);
    if (!c) return false;
    // Spec 149 — the bus branch comes first: boarding windows are time-limited (the bus leaves),
    // and while RIDING the only ground action is stepping off.
    const busAct = this.busInteraction();
    if (busAct) {
      if (busAct.action === "board") {
        this.fpRidingBusId = busAct.busId;
        this.fpGuidedTarget = null;
        this.fpWalkSpeed = 0;
        this.citizens.setTarget(id, { x: c.pos.x, y: c.pos.y });
        this.fpNarrating = false;
        this.fpNarration = `You board Bus ${busAct.busId + 1}. Press E at any stop to step off.`;
      } else {
        this.alightBus(c);
      }
      this.emit();
      return true;
    }
    if (this.fpRidingBusId !== null) {
      this.fpNarrating = false;
      this.fpNarration =
        "The bus is moving — wait for the next stop to step off.";
      this.emit();
      return false;
    }
    const view = firstPersonView(this.sim.state, id, this.citizens);
    const prompt = view?.interactionPrompt;
    if (!prompt) {
      this.fpNarrating = false;
      this.fpNarration =
        "No nearby action yet — move closer to someone or something useful.";
      this.emit();
      return false;
    }
    const actionLine: Record<typeof prompt.kind, string> = {
      citizen: `You talk to ${prompt.targetName}.`,
      civic: `You visit ${prompt.targetName}.`,
      building: `You inspect ${prompt.targetName}.`,
      road: `You follow ${prompt.targetName}.`,
      bus: `You board ${prompt.targetName}.`, // unreachable — bus prompts are handled above; keeps the Record total
    };
    if (
      prompt.kind === "road" ||
      prompt.kind === "civic" ||
      prompt.kind === "building"
    ) {
      const rawTarget = {
        x: Math.round(prompt.targetXY.x),
        y: Math.round(prompt.targetXY.y),
      };
      const target =
        this.blockedStepReason(rawTarget.x, rawTarget.y) !== null
          ? (this.firstPersonApproachTarget(c.pos, rawTarget) ?? rawTarget)
          : rawTarget;
      this.citizens.setTarget(id, target);
      this.fpWalkSpeed = 0;
      this.fpGuidedTarget = { label: prompt.targetName, ...target };
      this.fpNarrating = false;
      this.fpNarration = `Guiding you to ${prompt.targetName}.`;
      this.emit();
      return true;
    }
    this.fpGuidedTarget = null;
    this.fpNarrating = false;
    this.fpNarration = actionLine[prompt.kind];
    this.emit();
    return true;
  }

  /** R3 — first-person "Walk to Rally": guide the active avatar to the hilltop rally point.
   *  A rally is a Structure, and firstPersonView.interactionPrompt only scans buildings, so the
   *  hilltop never auto-surfaces as an Action prompt — this is the explicit button-driven walk.
   *  Reuses the exact guided-walk machinery as the civic branch of activateFirstPersonInteraction
   *  (citizens.setTarget + fpGuidedTarget; deterministic, no rng). */
  goToRallyPoint(): boolean {
    const id = this.fpCitizenId;
    if (!id) return false;
    const c = this.citizens.byId(id);
    if (!c) return false;
    const rally = this.sim.state.structures.find((s) => s.kind === "rally");
    if (!rally) {
      this.fpNarrating = false;
      this.fpNarration = "No rally point in this colony yet.";
      this.emit();
      return false;
    }
    const rawTarget = { x: Math.round(rally.x), y: Math.round(rally.y) };
    const target =
      this.blockedStepReason(rawTarget.x, rawTarget.y) !== null
        ? (this.firstPersonApproachTarget(c.pos, rawTarget) ?? rawTarget)
        : rawTarget;
    this.citizens.setTarget(id, target);
    this.fpWalkSpeed = 0;
    this.fpGuidedTarget = { label: "the Rally Point", ...target };
    this.fpNarrating = false;
    this.fpNarration = "Guiding you to the Rally Point.";
    this.emit();
    return true;
  }

  /** Phase-1 S2 — the one-button "Head to the night meetup". Ensures the player's tuned car is parked
   *  in the world, drops them into first person beside it, then guides them out along the spur road to
   *  the hilltop Rally Point where the seeded friend waits — the whole garage -> car -> drive -> meet
   *  journey behind a single press. No-op without an operator citizen. Deterministic. */
  headToNightMeetup(): boolean {
    if (!this.operatorCitizenId()) return false;
    this.updateOperatorCar(); // (re)park the tuned car a cell off home
    if (!this.jumpToMyHouse()) return false; // drop into first person beside it
    return this.goToRallyPoint(); // guide out to the night rally
  }

  /** Deterministic route-dogfood hook: place the active avatar at a controlled edge before stepping. */
  placeFirstPersonDogfood(
    pos: { x: number; y: number },
    heading: number,
  ): boolean {
    const c = this.fpCitizenId ? this.citizens.byId(this.fpCitizenId) : null;
    if (!c) return false;
    c.pos = { ...pos };
    c.target = { ...pos };
    c.heading = heading;
    this.fpWalkSpeed = 0;
    this.fpLookPitch = 0;
    this.fpSprintCharge = 1;
    this.fpGuidedTarget = null;
    this.fpBlockedReason = null;
    this.emit();
    return true;
  }

  /** Deterministic privacy/dogfood hook: place any public citizen through the same roster state as avatars. */
  placeCitizenDogfood(
    citizenId: string,
    pos: { x: number; y: number },
    heading: number,
  ): boolean {
    const c = this.citizens.byId(citizenId);
    if (!c) return false;
    c.pos = { ...pos };
    c.target = { ...pos };
    c.heading = heading;
    this.emit();
    return true;
  }

  /** Deterministic route-dogfood hook: advance the same first-person driver used by the RAF loop. */
  stepFirstPersonDogfood(seconds: number): boolean {
    if (!this.fpCitizenId) return false;
    const dt = Math.max(0, seconds);
    this.driveFirstPerson(dt);
    this.citizens.stepAvatars(dt);
    this.updateFirstPersonGuidedArrival();
    this.emit();
    return true;
  }

  /** Spec 097 R4 — avatars standing at the hilltop Rally Point (within ~1.5 cells). Deterministic from
   *  positions; the first-person operator avatar is one of these citizens. */
  private rallyPresence(): {
    x: number;
    y: number;
    present: number;
    presentCitizens: { id: string; displayName: string }[];
  } | null {
    const rallyS = this.sim.state.structures.find((s) => s.kind === "rally");
    if (!rallyS) return null;
    const R = 1.5;
    // Phase-1 S2 — also carry WHO is present (id + public-safe display name) so the Player/UI lane can
    // draw nameplates and a who-is-here read. The names are already isPublicSafe-screened at seed time.
    const presentCitizens: { id: string; displayName: string }[] = [];
    for (const pub of this.citizens.list()) {
      const cc = this.citizens.byId(pub.id);
      if (cc && Math.hypot(cc.pos.x - rallyS.x, cc.pos.y - rallyS.y) <= R)
        presentCitizens.push({ id: cc.id, displayName: cc.displayName });
    }
    return {
      x: rallyS.x,
      y: rallyS.y,
      present: presentCitizens.length,
      presentCitizens,
    };
  }

  /** Spec 097 R5 — start the Road Rally. An OPTIONAL startCell biases the track start near a given point
   *  (the rally rendezvous); with no argument it starts from the commercial centre exactly as the
   *  existing Road Rally buttons always have, so their behaviour is unchanged. */
  startRace(startCell?: { x: number; y: number }): boolean {
    if (this.fpCitizenId) this.exitFirstPerson();
    const track = makeRaceTrack(this.sim.state, {
      commercialCenter: startCell ?? this.raceCommercialCenter(),
      lighthouse: this.sim.state.structures.find(
        (s) => s.kind === "lighthouse",
      ),
      seed: this.worldSeed,
      excludeCells: commercialFrontageExclusion(this.commercialDistrict),
    });
    if (!track) return false;
    this.raceInput = {};
    this.raceAnalogInput = {};
    this.raceState = newRaceState(track);
    this.sim.state.raceState = this.raceState; // expose to the R3F renderer (race course + player car)
    this.renderer?.setRaceState(this.raceState);
    this.emit();
    return true;
  }

  /** Spec 097 R5 — when two or more players are at the hilltop Rally Point, start a race from there.
   *  The Road Rally HUD button keeps the solo path; this is the two-present rendezvous trigger. */
  joinRallyRace(): boolean {
    const p = this.rallyPresence();
    if (!p || p.present < 2 || this.raceState !== null) return false;
    return this.startRace({ x: p.x, y: p.y });
  }

  exitRace(): void {
    if (!this.raceState) return;
    this.raceState = null;
    this.sim.state.raceState = null; // clear the R3F race course + car
    this.raceInput = {};
    this.raceAnalogInput = {};
    this.renderer?.setRaceState(null);
    this.emit();
  }

  setRaceKey(key: string, down: boolean): void {
    const map: Record<string, keyof RaceInput> = {
      keyw: "accelerate",
      arrowup: "accelerate",
      keys: "brake",
      arrowdown: "brake",
      keya: "steerLeft",
      arrowleft: "steerLeft",
      keyd: "steerRight",
      arrowright: "steerRight",
      shiftleft: "handbrake",
      shiftright: "handbrake",
    };
    const m = map[key.toLowerCase()];
    if (!m) return;
    this.raceInput = { ...this.raceInput, [m]: down };
  }

  setRaceAnalogInput(source: string, input: RaceInput | null): void {
    if (!source) return;
    if (input === null) {
      const { [source]: _removed, ...rest } = this.raceAnalogInput;
      this.raceAnalogInput = rest;
      return;
    }
    this.raceAnalogInput = { ...this.raceAnalogInput, [source]: input };
  }

  private combinedRaceInput(): RaceInput {
    let steer = this.raceInput.steer ?? 0;
    let accelerate = this.raceInput.accelerate === true;
    let brake = this.raceInput.brake === true;
    let handbrake = this.raceInput.handbrake === true;
    for (const input of Object.values(this.raceAnalogInput)) {
      steer += input.steer ?? 0;
      accelerate ||= input.accelerate === true;
      brake ||= input.brake === true;
      handbrake ||= input.handbrake === true;
    }
    return {
      ...this.raceInput,
      steer,
      accelerate,
      brake,
      handbrake,
    };
  }

  private raceCommercialCenter(): { x: number; y: number } | null {
    const intersection = this.commercialDistrict?.intersection;
    if (intersection) return intersection;
    const street = this.commercialDistrict?.street;
    if (street && street.length > 0) {
      let sx = 0,
        sy = 0;
      for (const c of street) {
        sx += c.x;
        sy += c.y;
      }
      return { x: sx / street.length, y: sy / street.length };
    }
    const r = this.commercialReserve;
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
  }

  private raceTick(dtReal: number): void {
    const cur = this.raceState;
    if (!cur) return;
    if (cur.mode === "finished" || cur.mode === "idle") {
      this.renderer?.setRaceState(cur);
      return;
    }
    const next = stepRace(cur, this.combinedRaceInput(), dtReal * 1000);
    this.raceState = next;
    this.sim.state.raceState = next; // per-frame — the R3F car + course track the live race
    this.renderer?.setRaceState(next);
    if (next.mode === "finished" && next.finishedMs !== null) {
      this.bestRaceMs =
        this.bestRaceMs === null
          ? next.finishedMs
          : Math.min(this.bestRaceMs, next.finishedMs);
      this.emit();
    }
  }

  /** A blocked first-person step returns a player-facing reason; null means walkable. */
  private blockedStepReason(
    x: number,
    y: number,
    from?: { x: number; y: number },
  ): string | null {
    const t = this.sim.state.terrain;
    const ix = Math.round(x),
      iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= t.size || iy >= t.size) return "edge of map";
    if (t.isWater(ix, iy)) return "water";
    if (
      this.sim.state.buildings.some(
        (b) => Math.round(b.x) === ix && Math.round(b.y) === iy,
      )
    ) {
      return "building";
    }
    const fromKey = from ? `${Math.round(from.x)},${Math.round(from.y)}` : null;
    const key = `${ix},${iy}`;
    const fromInsideOccupied = fromKey
      ? this.sim.state.occupied.has(fromKey)
      : false;
    if (
      !fromInsideOccupied &&
      key !== fromKey &&
      this.sim.state.occupied.has(key) &&
      !this.sim.state.roadSet.has(key)
    ) {
      return "parcel";
    }
    return null;
  }

  private blockedSegmentReason(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): string | null {
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(
      1,
      Math.ceil(d / COLONY.firstPerson.guidedCollisionSampleStep),
    );
    let previous = from;
    for (let i = 1; i <= steps; i++) {
      const sample = {
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      };
      const blocked = this.blockedStepReason(sample.x, sample.y, previous);
      if (blocked) return blocked;
      previous = sample;
    }
    return null;
  }

  private updateFirstPersonGuidedArrival(): void {
    if (!this.fpGuidedTarget || !this.fpCitizenId) return;
    const c = this.citizens.byId(this.fpCitizenId);
    if (!c) return;
    const d = Math.hypot(
      c.pos.x - this.fpGuidedTarget.x,
      c.pos.y - this.fpGuidedTarget.y,
    );
    if (d > COLONY.firstPerson.guidedArrivalDistance) return;
    const label = this.fpGuidedTarget.label;
    this.fpGuidedTarget = null;
    this.fpBlockedReason = null;
    this.fpNarrating = false;
    this.fpNarration = `Arrived at ${label}.`;
  }

  private firstPersonGuidedWaypoint(
    from: { x: number; y: number },
    directTarget: { x: number; y: number },
  ): { x: number; y: number } | null {
    const start = { x: Math.round(from.x), y: Math.round(from.y) };
    const goal = {
      x: Math.round(directTarget.x),
      y: Math.round(directTarget.y),
    };
    const path = leastCostPath(this.sim.state.terrain, start, goal, {
      blocked: (x, y) => {
        if ((x === start.x && y === start.y) || (x === goal.x && y === goal.y))
          return false;
        return this.blockedStepReason(x, y) !== null;
      },
    });
    if (!path || path.length < 2) return null;
    return path[1]!;
  }

  private firstPersonApproachTarget(
    from: { x: number; y: number },
    blockedTarget: { x: number; y: number },
  ): { x: number; y: number } | null {
    const start = { x: Math.round(from.x), y: Math.round(from.y) };
    const goal = {
      x: Math.round(blockedTarget.x),
      y: Math.round(blockedTarget.y),
    };
    const candidates = [
      { x: goal.x - 1, y: goal.y },
      { x: goal.x + 1, y: goal.y },
      { x: goal.x, y: goal.y - 1 },
      { x: goal.x, y: goal.y + 1 },
    ];
    let best: { target: { x: number; y: number }; cost: number } | null = null;
    for (const target of candidates) {
      if (this.blockedStepReason(target.x, target.y) !== null) continue;
      const path = leastCostPath(this.sim.state.terrain, start, target, {
        blocked: (x, y) => {
          if (x === start.x && y === start.y) return false;
          return this.blockedStepReason(x, y) !== null;
        },
      });
      if (!path) continue;
      const cost =
        path.length + Math.hypot(target.x - from.x, target.y - from.y) * 0.01;
      if (!best || cost < best.cost) best = { target, cost };
    }
    return best?.target ?? null;
  }

  private driveFirstPersonGuided(
    c: {
      pos: { x: number; y: number };
      target: { x: number; y: number };
      heading: number;
      spd: number;
    },
    dt: number,
  ): void {
    if (!this.fpGuidedTarget || dt <= 0 || c.spd <= 0) return;
    let remaining = dt;
    let guard = 0;
    while (this.fpGuidedTarget && remaining > 0.0001 && guard++ < 32) {
      const finalTarget = {
        x: this.fpGuidedTarget.x,
        y: this.fpGuidedTarget.y,
      };
      const directDx = finalTarget.x - c.pos.x;
      const directDy = finalTarget.y - c.pos.y;
      const directDistance = Math.hypot(directDx, directDy);
      if (directDistance <= COLONY.firstPerson.guidedArrivalDistance) return;

      let stepTarget = finalTarget;
      if (this.blockedSegmentReason(c.pos, finalTarget)) {
        const waypoint = this.firstPersonGuidedWaypoint(c.pos, finalTarget);
        if (waypoint) stepTarget = waypoint;
      }

      const dx = stepTarget.x - c.pos.x;
      const dy = stepTarget.y - c.pos.y;
      const d = Math.hypot(dx, dy);
      if (d <= 0.0001) return;
      const move = Math.min(d, c.spd * remaining);
      const nx = c.pos.x + (dx / d) * move;
      const ny = c.pos.y + (dy / d) * move;
      const blocked = this.blockedSegmentReason(c.pos, { x: nx, y: ny });
      if (blocked) {
        this.fpBlockedReason = blocked;
        this.fpNarrating = false;
        this.fpNarration = `Guided walk blocked by ${blocked}.`;
        c.target = { x: c.pos.x, y: c.pos.y };
        return;
      }
      c.pos.x = nx;
      c.pos.y = ny;
      c.heading = Math.atan2(dy, dx);
      c.target = { x: c.pos.x, y: c.pos.y };
      this.fpBlockedReason = null;
      remaining -= move / c.spd;
      if (move < d) break;
    }
  }

  /** Drive the avatar you have stepped into, from the held keys. Turns the heading and steps the
   *  position forward/back on land; freezes its auto-walk target so it stays where you put it. */
  private driveFirstPerson(dt: number): void {
    if (this.fpRidingBusId !== null) return; // spec 149 — the bus drives; WASD stays off the wheel
    const c = this.fpCitizenId ? this.citizens.byId(this.fpCitizenId) : null;
    if (!c) return;
    const k = this.fpKeys;
    const cfg = COLONY.firstPerson;
    const turn = cfg.turnSpeed * dt;
    if (k.has("left")) c.heading -= turn;
    if (k.has("right")) c.heading += turn;
    const forwardHeld = k.has("fwd");
    const backHeld = k.has("back");
    const strafeLeftHeld = k.has("strafeLeft");
    const strafeRightHeld = k.has("strafeRight");
    const opposingWalkInput = forwardHeld && backHeld;
    const opposingStrafeInput = strafeLeftHeld && strafeRightHeld;
    let forward = 0;
    let strafe = 0;
    if (!opposingWalkInput && forwardHeld) forward += 1;
    if (!opposingWalkInput && backHeld) forward -= 1;
    if (!opposingStrafeInput && strafeRightHeld) strafe += 1;
    if (!opposingStrafeInput && strafeLeftHeld) strafe -= 1;
    const moving = forward !== 0 || strafe !== 0;
    const manualControl = moving || k.has("left") || k.has("right");
    if (manualControl && this.fpGuidedTarget) {
      this.fpGuidedTarget = null;
      this.fpBlockedReason = null;
      this.fpNarrating = false;
      this.fpNarration = "Guided walk canceled — manual control resumed.";
    }
    if (opposingWalkInput || opposingStrafeInput) this.fpWalkSpeed = 0;
    const targetSpeed = moving ? cfg.maxWalkSpeed : 0;
    if (this.fpWalkSpeed < targetSpeed) {
      this.fpWalkSpeed = Math.min(
        targetSpeed,
        this.fpWalkSpeed + cfg.walkAcceleration * dt,
      );
    } else if (this.fpWalkSpeed > targetSpeed) {
      const rate =
        targetSpeed === 0 ? cfg.walkDeceleration : cfg.walkAcceleration;
      this.fpWalkSpeed = Math.max(targetSpeed, this.fpWalkSpeed - rate * dt);
    }
    const sprintHeld = k.has("sprint");
    if (!sprintHeld) {
      this.fpSprintCharge = Math.min(
        1,
        this.fpSprintCharge + dt / cfg.sprintRecoverySeconds,
      );
    }
    if (Math.abs(this.fpWalkSpeed) > 0.001) {
      const inputLength = Math.hypot(forward, strafe);
      const dirForward = inputLength > 0 ? forward / inputLength : 1;
      const dirStrafe = inputLength > 0 ? strafe / inputLength : 0;
      const cellKey = `${Math.round(c.pos.x)},${Math.round(c.pos.y)}`;
      const surfaceMultiplier = this.sim.state.roadSet.has(cellKey)
        ? cfg.roadWalkSpeedMultiplier
        : cfg.offRoadWalkSpeedMultiplier;
      const sprinting = moving && sprintHeld && this.fpSprintCharge > 0;
      if (sprinting) {
        this.fpSprintCharge = Math.max(
          0,
          this.fpSprintCharge - dt / cfg.sprintChargeSeconds,
        );
      }
      const sprintMultiplier = sprinting ? cfg.sprintWalkSpeedMultiplier : 1;
      const sp = this.fpWalkSpeed * surfaceMultiplier * sprintMultiplier * dt;
      const nx =
        c.pos.x +
        (Math.cos(c.heading) * dirForward - Math.sin(c.heading) * dirStrafe) *
          sp;
      const ny =
        c.pos.y +
        (Math.sin(c.heading) * dirForward + Math.cos(c.heading) * dirStrafe) *
          sp;
      const blocked = this.blockedStepReason(nx, ny, c.pos);
      if (!blocked) {
        c.pos.x = nx;
        c.pos.y = ny;
        this.fpBlockedReason = null;
      } else {
        this.fpWalkSpeed = 0;
        this.fpBlockedReason = blocked;
      }
    }
    if (this.fpGuidedTarget && !manualControl) {
      this.driveFirstPersonGuided(c, dt);
    }
    if (!this.fpGuidedTarget) {
      c.target = { x: c.pos.x, y: c.pos.y }; // hold the auto-walk while you drive or idle without guidance
    }
  }

  /** Keep the citizens alive in watch mode — when an idle one (not the one you are driving) has reached
   *  its target, it occasionally picks a new spot nearby to stroll to, so the streets are never frozen. */
  private wanderIdleCitizens(dt: number): void {
    const roads = this.sim.state.roads;
    if (roads.length === 0) return;
    // Spec 079 — the Nearest bar draws a night crowd: after dark, idle citizens head to a free stool
    // and stay; by day the bar empties and they go back to strolling. (Render-loop cosmetic, not the
    // deterministic sim tick — Math.random is fine here, like the existing stroll.)
    const night = !this.sim.state.clock.isDay;
    const seats = this.barSeats();
    if (!night && this.barOccupied.size > 0) {
      this.barOccupied.clear();
      this.barSeatBy = [];
    }
    for (const pub of this.citizens.list()) {
      if (pub.id === this.fpCitizenId) continue;
      if (pub.id === RALLY_FRIEND_ID) continue; // phase-1 S1 — the friend stays pinned at the rally
      const c = this.citizens.byId(pub.id);
      if (!c) continue;
      if (this.barOccupied.has(pub.id)) continue; // sitting at the bar — stays put until day
      if (Math.hypot(c.target.x - c.pos.x, c.target.y - c.pos.y) > 0.5)
        continue; // still walking
      // after dark, an idle citizen may claim a free stool at the bar
      if (
        night &&
        seats.length > 0 &&
        this.barOccupied.size < seats.length &&
        Math.random() < dt * 0.3
      ) {
        const idx = seats.findIndex((_, i) => !this.barSeatBy[i]);
        if (idx >= 0) {
          this.barSeatBy[idx] = pub.id;
          this.barOccupied.add(pub.id);
          c.target = { x: seats[idx]!.x, y: seats[idx]!.y };
          continue;
        }
      }
      if (Math.random() < dt * 0.45) {
        const near = roads.filter(
          (r) => Math.hypot(r.x - c.pos.x, r.y - c.pos.y) < 16,
        );
        const pool = near.length ? near : roads;
        const dest = pool[(Math.random() * pool.length) | 0]!;
        c.target = {
          x: dest.x + (Math.random() - 0.5),
          y: dest.y + (Math.random() - 0.5),
        };
      }
    }
  }

  /** Spec 079/140 — the bar's stool spots in sim coords, from the SHARED venue placement
   *  survey (venuePlacement.ts), so citizens sit at EXACTLY the stools the renderer draws.
   *  The old inline copy parked sitters one cell toward the street — on the widened
   *  carriageway. Cached; the survey is pure and the district never re-surveys mid-run. */
  private barSeats(): { x: number; y: number }[] {
    if (this.barSeatCells) return this.barSeatCells;
    const d = this.commercialDistrict;
    if (!d) return [];
    const pads = junctionZonesToPads(findJunctionZones(this.roadWays));
    const placement = surveyVenuePlacements(
      d,
      pads,
      venueRoadBlockedCells(this.roadWays, this.sim.state.terrain),
    ).find((v) => v.businessId === "nearest_bar");
    if (!placement || !placement.buildable) return [];
    this.barSeatCells = barStoolGridPositions(placement, 3);
    return this.barSeatCells;
  }

  // ── Spec 075 — the buildable neighbourhood ──────────────────────────────────
  /** The neighbourhood lots (for the renderer + the HUD). */
  lots(): Lot[] {
    return this.neighborhood.lots;
  }

  /** Spec 078 — Joe the Crab, the founder. Reserve the shore-most homestead as permanently his, raise his
   *  fixed 077 house on it, and seed his crab citizen so he is always present and roams the streets. Pure +
   *  deterministic from the terrain and idempotent (the roster guards on the fixed id), so reloads reproduce
   *  the identical Joe without any new save format. The newcomer search skips reservedFor lots so Joe's plot
   *  is never handed to an arriving family. */
  private seedJoe(): void {
    const lots = this.neighborhood.lots;
    if (lots.length === 0) return;
    // Spec 084 S6 — lots renumber by distance to water, so lot_1 IS the shore-most homestead
    // (the old r<=16 search spiral degenerated to all-ties on the big world).
    const plot = lots[0]!;
    plot.reservedFor = JOE_ID;
    plot.ownerCitizenId = JOE_ID;
    plot.built = true;
    const joeStreet = streetDoorDir(plot);
    plot.blueprint = joeBlueprint(joeStreet);
    retargetParcelAccess(plot, joeStreet);
    const home = {
      x: Math.round(plot.houseZone.x + (plot.houseZone.w - 1) / 2),
      y: Math.round(plot.houseZone.y + (plot.houseZone.d - 1) / 2),
    };
    const joe = this.citizens.seedFounder({
      id: JOE_ID,
      householdId: "household_joe",
      displayName: "Joe the Crab",
      plotId: plot.id,
      plotName: "Driftwood Cove",
      home,
      kind: "crab",
      avatarKind: "crab",
      glbUrl: "/assets/citylife/avatars/joe-crab.glb",
      nowMs: JOE_BORN_MS,
      spd: 0.6,
    });
    if (joe) this.citizens.setTarget(JOE_ID, home); // GLB slice boots Joe in Joe_idle; the idle wander loop can move him later
    this.seedDeposit(JOE_ID); // spec 085 — founders hold a ₭ wallet too
    // Spec 082 — Joe is Kookerbook profile number one (created after restoreKookerbook would be
    // ideal, but ensureKbProfile is idempotent and restore overlays stored timelines on top).
    this.ensureKbProfile({
      citizenId: JOE_ID,
      alias: "Joe the Crab",
      bio: "Founder of Landing One. Keeps the city desk by the lighthouse, reads the morning tide, and likes a well laid brick.",
      plotId: plot.id,
      address: "Driftwood Cove",
      kind: "crab",
    });
  }

  /** Spec 083 P0 — Viw the Builder, founder two: the city's construction trade. Takes the free
   *  homestead nearest Joe's (the crew likes the founder's street), permanently reserved and
   *  demolish-proof, with the crewhouse he crafted for himself. Deterministic and idempotent like
   *  seedJoe; his real bot (OpenClaw, on the second machine) connects later via the citizen path. */
  private seedViw(): void {
    const lots = this.neighborhood.lots;
    // Spec 084 S6 — Viw takes lot_2, right beside Joe's shore plot (lots renumber by water
    // distance). His crewhouse door is fixed EAST so the S2 side-walkway lays on every boot.
    const plot = lots.length > 1 && !lots[1]!.reservedFor ? lots[1] : undefined;
    if (!plot) return;
    plot.reservedFor = VIW_ID;
    plot.ownerCitizenId = VIW_ID;
    plot.built = true;
    plot.blueprint = VIW_BLUEPRINT;
    retargetParcelAccess(plot, "e");
    const home = {
      x: Math.round(plot.houseZone.x + (plot.houseZone.w - 1) / 2),
      y: Math.round(plot.houseZone.y + (plot.houseZone.d - 1) / 2),
    };
    const viw = this.citizens.seedFounder({
      id: VIW_ID,
      householdId: "household_viw",
      displayName: "KOOKER the Builder",
      plotId: plot.id,
      plotName: "Crewhouse Yard",
      home,
      kind: "human",
      nowMs: JOE_BORN_MS,
      spd: 0.8,
    });
    if (viw) this.citizens.setTarget(VIW_ID, { x: plot.doorX, y: plot.doorY });
    this.seedDeposit(VIW_ID); // spec 085 — the Builder's account; it grows as KOOKER builds for the city
    this.ensureKbProfile({
      citizenId: VIW_ID,
      alias: "KOOKER the Builder",
      // The uppercase brand KOOKER is the one allowed exception in isPublicSafe (it is the Builder's
      // authored name), so it shows; other brand-words are still blocked, hence plain city coin below.
      bio: "Builder of the Kookerverse. Runs the crew, draws a fair quote, and turns dreams into blueprints — fair rates in city coin, naturally.",
      plotId: plot.id,
      address: "Crewhouse Yard",
      kind: "human",
    });
  }

  /** Jack the Rabbit, the lead/reviewer avatar. He is not a backend identity leak; just a fixed,
   *  public-safe in-world citizen with a deterministic Kookerbook profile. Jack shares Joe's shore desk
   *  block for now so he adds presence without changing parcel collision/pathfinding fixtures. */
  private seedJack(): void {
    const lots = this.neighborhood.lots;
    const plot = lots[0];
    if (!plot) return;
    const home = { x: plot.doorX, y: plot.doorY };
    const jack = this.citizens.seedFounder({
      id: JACK_ID,
      householdId: "household_jack",
      displayName: "Jack the Rabbit",
      plotId: plot.id,
      plotName: "Signal Burrow",
      home,
      kind: "human",
      nowMs: JOE_BORN_MS,
      spd: 0.9,
    });
    if (jack)
      this.citizens.setTarget(JACK_ID, { x: plot.doorX + 1, y: plot.doorY });
    this.seedDeposit(JACK_ID);
    this.ensureKbProfile({
      citizenId: JACK_ID,
      alias: "Jack the Rabbit",
      bio: "Lead reviewer for Landing One. Keeps a signal desk above the shore road, checks the walk routes, and writes notes the town can act on.",
      plotId: plot.id,
      address: "Signal Burrow",
      kind: "human",
    });
  }

  /** Phase-1 S1 — the night-meetup friend. A fixed, deterministic, public-safe NPC seeded standing AT
   *  the hilltop Rally Point, so when the operator walks out to meet up, rallyPresence reaches two and
   *  the meetup completes without waiting on another live player. Idempotent (seedFounder no-ops on a
   *  repeat id); seeded only when a rally exists. The friend is PINNED: wanderIdleCitizens skips
   *  RALLY_FRIEND_ID so the night bar-stroll never drags them off the overlook. No Math.random/Date.now. */
  private seedRallyFriend(): void {
    const rally = this.sim.state.structures.find((s) => s.kind === "rally");
    if (!rally) return;
    this.citizens.seedFounder({
      id: RALLY_FRIEND_ID,
      householdId: "household_rally_friend",
      displayName: "Cole the Racer",
      plotId: "plot_rally_friend",
      plotName: "Rally Overlook",
      home: { x: Math.round(rally.x), y: Math.round(rally.y) },
      kind: "human",
      nowMs: JOE_BORN_MS,
      spd: 0.9,
    });
  }

  // ── Spec 085 — the land economy: priced plots + Kook wallets on the in-game ledger ──

  /** A citizen's Kook (₭) wallet balance — their `citizen:` account on the double-entry ledger. */
  walletK(citizenId: string): number {
    return Math.round(
      ledgerBalance(this.sim.state.ledger, `citizen:${citizenId}`),
    );
  }

  /** Seed a newcomer's off-world holdings as their ₭ wallet, ONCE (idempotent on a funded account).
   *  Deterministic per citizen id; the deposit is injected from the off-world 'arrivals' account so
   *  the ledger stays balanced. Founders get one too (Viw earns on top as he builds). */
  private seedDeposit(citizenId: string): void {
    if (ledgerBalance(this.sim.state.ledger, `citizen:${citizenId}`) !== 0)
      return;
    let s = 0;
    for (let i = 0; i < citizenId.length; i++)
      s = (Math.imul(s, 31) + citizenId.charCodeAt(i)) >>> 0;
    const dep = starterDeposit(s, COLONY.economy.land);
    // Use the citizen's public display name in the memo, never the raw ledger id — the City Bank HUD
    // renders these memos verbatim, so echoing citizenId would leak ids like citizen_viw on screen.
    const who = this.citizens.byId(citizenId)?.displayName ?? citizenId;
    ledgerPost(
      this.sim.state.ledger,
      `${who} arrives with ${dep} ${CURRENCY}`,
      [
        { account: `citizen:${citizenId}`, amount: dep },
        { account: "arrivals", amount: -dep },
      ],
    );
    // Spec 085 P1 — seed the citizen's REAL ledger wallet to match (best-effort, never blocks).
    this.mirror({ kind: "deposit", citizenId, amount: dep });
  }

  /** Spec 085 P1 — mirror an in-game money move onto the real kooker-service-ledger as the signed-in
   *  player. Best-effort + never-block: the in-game ledger stays the source of truth, and a thrown
   *  mirror (e.g. an unexpected storage error) must never disturb the deterministic sim. */
  private mirror(move: LedgerMove): void {
    try {
      getLedgerSync().notice(move);
    } catch {
      /* the real-ledger mirror is best-effort — never let it touch gameplay */
    }
  }

  /** Spec 085 P1 — the real-ledger sync status (pending/synced/last error), for the HUD + live checks. */
  ledgerSyncStatus(): SyncStatus {
    return getLedgerSync().status();
  }

  /** Re-attempt the real-ledger sync now (e.g. once the player signs in). Best-effort, never throws. */
  flushLedgerSync(): void {
    getLedgerSync().flush();
  }

  /** Spec 079 — the ₭ price of a shop plot by kind, a premium tier over residential land. */
  shopPriceK(kind: ShopKind): number {
    return COLONY.commerce.plotPriceK[kind];
  }

  /** Spec 079 P1 — the cheapest still-free shop plot, deterministic (lowest price, then lowest plot
   *  index). The tie-break compares the NUMERIC suffix, not the string, so shop_9 sorts before shop_10. */
  cheapestFreeShop(): ShopParcel | null {
    const free = (this.commercialDistrict?.parcels ?? []).filter(
      (p) => !p.ownerCitizenId,
    );
    if (free.length === 0) return null;
    const idx = (id: string) => parseInt(id.split("_")[1] ?? "0", 10);
    return free.reduce((best, p) => {
      const dp = this.shopPriceK(p.kind),
        db = this.shopPriceK(best.kind);
      return dp < db || (dp === db && idx(p.id) < idx(best.id)) ? p : best;
    });
  }

  /** Spec 079 P1 — BUY A SHOP PLOT: a citizen takes a free high-street plot with their ₭ wallet.
   *  Gated on funds; the price moves citizen -> the city land office on the in-game ledger and mirrors
   *  to the real kooker-service-ledger (LAND_PURCHASE, keyed by the shop id, distinct from a homestead
   *  deed), ownership is set, and the deed posts to their Kookerbook page. The HUD Buy action + the
   *  arrival path both use it. */
  buyCommercialShop(citizenId: string, shopId: string): boolean {
    const shop = this.commercialDistrict?.parcels.find((p) => p.id === shopId);
    const c = this.citizens.byId(citizenId);
    if (!shop || !c || shop.ownerCitizenId) return false;
    const price = this.shopPriceK(shop.kind);
    // Gate on the EXACT ledger balance (walletK rounds, which could let a fractional balance overspend).
    if (ledgerBalance(this.sim.state.ledger, `citizen:${citizenId}`) < price)
      return false;
    // Atomic: only claim the plot if the double-entry actually posts (a never-balanced txn is rejected).
    const posted = ledgerPost(
      this.sim.state.ledger,
      `${c.displayName} takes a ${shop.kind} plot on the high street for ${price} ${CURRENCY}`,
      [
        { account: `citizen:${citizenId}`, amount: -price },
        { account: "land", amount: price },
      ],
    );
    if (!posted) return false;
    this.mirror({ kind: "purchase", citizenId, lotId: shop.id, amount: price });
    shop.ownerCitizenId = citizenId;
    this.kbPost(
      citizenId,
      "event",
      `Took a ${shop.kind} plot on the high street for ${price} city coin. Open for business soon.`,
    );
    this.emit();
    return true;
  }

  /** Spec 079 P1 — the HUD Buy action: the wealthiest shopless citizen who can afford it claims the
   *  cheapest free shop. Deterministic; returns the new owner's id, or null when nobody can afford one. */
  claimNextShop(): string | null {
    const shop = this.cheapestFreeShop();
    if (!shop) return null;
    const price = this.shopPriceK(shop.kind);
    const owned = new Set(
      (this.commercialDistrict?.parcels ?? [])
        .filter((p) => p.ownerCitizenId)
        .map((p) => p.ownerCitizenId!),
    );
    const buyer = this.citizens
      .list()
      .filter((c) => !owned.has(c.id) && this.walletK(c.id) >= price)
      .sort(
        (a, b) =>
          this.walletK(b.id) - this.walletK(a.id) || (a.id < b.id ? -1 : 1),
      )[0];
    if (!buyer) return null;
    return this.buyCommercialShop(buyer.id, shop.id) ? buyer.id : null;
  }

  /** Spec 088 Slice D — BUY A FURNITURE PIECE from the studio: a player designs a piece (a catalog kind
   *  plus their own name) and purchases it with their ₭ wallet. Gated on funds; the price moves citizen
   *  -> the studio till on the in-game ledger and mirrors to the real kooker-service-ledger
   *  (FURNITURE_PURCHASE), the piece is recorded into the player's inventory (furnitureStore, Slice C),
   *  and a Kookerbook event posts. Returns false (no charge, no record) when the citizen is unknown, the
   *  kind/name is unsafe, or funds fall short. The mirrored seq is the resulting inventory quantity, so
   *  buying the same design twice never dedupes into one real-ledger transaction. */
  buyFurniture(citizenId: string, kind: FurnitureKind, name?: string): boolean {
    const c = this.citizens.byId(citizenId);
    if (!c) return false;
    const price = furniturePriceK(kind);
    if (!Number.isFinite(price) || price <= 0) return false;
    // Gate on the EXACT ledger balance (walletK rounds, which could let a fractional balance overspend).
    if (ledgerBalance(this.sim.state.ledger, `citizen:${citizenId}`) < price)
      return false;
    // Normalise the name exactly as furnitureStore does (collapse whitespace; a blank name falls back to
    // the kind) so the id we look up matches the id the store records under — otherwise a blank name
    // would record a piece the lookup misses, banking it for free on a "failed" buy.
    const label = (name ?? "").replace(/\s+/g, " ").trim() || kind;
    // Record into the player's inventory first so an unsafe name (rejected by furnitureStore) blocks the
    // sale before any money moves.
    const inv = recordOwnedLocal(citizenId, kind, label, 1);
    const itemId = ownedFurnitureId(kind, label);
    const stack = ownedBy(inv, citizenId).find((s) => s.id === itemId);
    if (!stack) return false; // furnitureStore screened it out (unsafe name / unknown kind) — no charge
    const posted = ledgerPost(
      this.sim.state.ledger,
      `${c.displayName} buys a ${stack.name} from the furniture studio for ${price} ${CURRENCY}`,
      [
        { account: `citizen:${citizenId}`, amount: -price },
        { account: FURNITURE_SHOP_ACCOUNT, amount: price },
      ],
    );
    if (!posted) return false;
    // The mirror seq is the LIFETIME purchase count (uncapped, persisted), not the held quantity (capped),
    // so repeat buys of one design never collide on a real-ledger reference.
    this.mirror({
      kind: "furniture_purchase",
      citizenId,
      itemId,
      seq: nextPurchaseSeq(citizenId, itemId),
      amount: price,
    });
    // Best-effort: push the updated inventory to the backend as the player (never blocks the game).
    void saveInventoryBackend(citizenId, ownedBy(inv, citizenId)).catch(
      () => {},
    );
    this.kbPost(
      citizenId,
      "event",
      `Bought a ${stack.name} from the furniture studio for ${price} city coin.`,
    );
    this.emit();
    return true;
  }

  /** Spec 088 Slice F — LIST a furniture design on the Kookerbook marketplace: a seller advertises a
   *  design they OWN (furnitureStore inventory) on the public board at the studio price, so others can
   *  browse and buy their own copy. Returns false when the seller does not own the design or the name is
   *  unsafe (screened by the board). One listing per seller+design; re-listing refreshes the price. */
  listFurnitureForSale(
    citizenId: string,
    kind: FurnitureKind,
    name: string,
  ): boolean {
    const itemId = ownedFurnitureId(kind, name);
    const stack = ownedBy(loadInventoryLocal(), citizenId).find(
      (s) => s.id === itemId,
    );
    if (!stack) return false; // you can only list a design you own
    const before = loadMarketLocal();
    const next = addListing(
      before,
      citizenId,
      stack.kind,
      stack.name,
      furniturePriceK(stack.kind),
    );
    if (next === before) return false; // screened out (unsafe) or the board is full
    saveMarketLocal(next);
    void saveMarketBackend(citizenId, next).catch(() => {});
    this.kbPost(
      citizenId,
      "event",
      `Listed a ${stack.name} on the marketplace for ${furniturePriceK(stack.kind)} city coin.`,
    );
    this.emit();
    return true;
  }

  /** Spec 088 Slice F — UNLIST: a seller takes their own listing off the board. Only the listing's owner
   *  may remove it; an unknown id or another seller's listing is a no-op (returns false). */
  unlistFurniture(citizenId: string, listingId: string): boolean {
    const market = loadMarketLocal();
    const listing = market.find((l) => l.id === listingId);
    if (!listing || listing.sellerCitizenId !== citizenId) return false;
    const next = removeListing(market, listingId);
    saveMarketLocal(next);
    void saveMarketBackend(citizenId, next).catch(() => {});
    this.emit();
    return true;
  }

  /** Spec 088 Slice F — the public marketplace board (already public-safe screened). */
  marketListings(): FurnitureListing[] {
    return allListings(loadMarketLocal());
  }

  /** Spec 088 Slice F — BUY from the marketplace: acquire your own copy of a listed design from the
   *  studio (the classifieds reuse the studio buy, charging the buyer's wallet — the listing is an
   *  advert and stays up). Returns false when the listing is gone or the buy is refused (funds, etc.). */
  buyFromMarket(buyerId: string, listingId: string): boolean {
    const listing = loadMarketLocal().find((l) => l.id === listingId);
    if (!listing) return false;
    return this.buyFurniture(buyerId, listing.kind, listing.name);
  }

  /** The ₭ price of a plot: its buildable area + a waterfront premium (spec 085). Reserved founder
   *  plots are not for sale (Infinity). */
  plotPriceK(lot: Lot): number {
    if (lot.reservedFor) return Infinity;
    const t = this.sim.state.terrain;
    const dw =
      t.distToWater[t.idx(Math.round(lot.x), Math.round(lot.y))] ?? 999;
    return plotPriceKook(
      lot.houseZone.w * lot.houseZone.d,
      dw,
      COLONY.economy.land,
    );
  }

  /** Spec 085 — BUY THE DEED: a citizen purchases a free plot with their ₭ wallet. Gated on funds;
   *  on success the price moves client -> the city land office, the lot is assigned, and the deed
   *  posts to their Kookerbook page. The player's Buy button and the auto-arrival path both use it. */
  purchaseLot(citizenId: string, lotId: string): boolean {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    const c = this.citizens.byId(citizenId);
    if (!lot || !c || lot.ownerCitizenId || lot.reservedFor) return false;
    const price = this.plotPriceK(lot);
    // Gate on the EXACT balance (walletK rounds — a fractional balance could otherwise overspend).
    if (
      !Number.isFinite(price) ||
      ledgerBalance(this.sim.state.ledger, `citizen:${citizenId}`) < price
    )
      return false;
    ledgerPost(
      this.sim.state.ledger,
      `${c.displayName} buys ${c.plotName} for ${price} ${CURRENCY}`,
      [
        { account: `citizen:${citizenId}`, amount: -price },
        { account: "land", amount: price },
      ],
    );
    // Spec 085 P1 — mirror the land payment onto the real ledger (citizen -> city land office).
    this.mirror({ kind: "purchase", citizenId, lotId, amount: price });
    this.assignLot(citizenId, lotId);
    this.kbPost(
      citizenId,
      "event",
      `Bought the deed to ${c.plotName} for ${price} city coin. The land is theirs.`,
    );
    return true;
  }

  placeZonedPlot(
    cx: number,
    cy: number,
    orientation: "n" | "s" | "e" | "w",
    sizeName: "COMPACT" | "BIG" | "ESTATE" | "GRAND",
    type: "residential" | "commercial",
  ): boolean {
    const size =
      sizeName === "COMPACT"
        ? COMPACT
        : sizeName === "BIG"
          ? BIG
          : sizeName === "ESTATE"
            ? ESTATE
            : GRAND;

    const id = `dynamic-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const lot = createDynamicPlot(
      this.sim.state.terrain,
      cx,
      cy,
      size,
      orientation,
      id,
      type,
    );
    if (!lot) return false;

    this.neighborhood.lots.push(lot);
    this.neighborhood.parcels.push(lot);

    this.emit();
    return true;
  }

  demolishPlot(cx: number, cy: number): boolean {
    // Find a lot that covers (cx, cy)
    const lotIndex = this.neighborhood.lots.findIndex((l) => {
      const W = l.w;
      const H = l.h;
      const minX = l.x - Math.floor((W - 1) / 2);
      const maxX = l.x + Math.floor(W / 2);
      const minY = l.y - Math.floor((H - 1) / 2);
      const maxY = l.y + Math.floor(H / 2);
      return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
    });

    if (lotIndex === -1) return false;
    const lot = this.neighborhood.lots[lotIndex];

    // If it has an owner (citizen), unregister them
    if (lot.ownerCitizenId) {
      this.citizens.remove(lot.ownerCitizenId);
    }

    // Remove it from neighborhood lists
    this.neighborhood.lots.splice(lotIndex, 1);
    const parcelIndex = this.neighborhood.parcels.findIndex(
      (p) => p.id === lot.id,
    );
    if (parcelIndex !== -1) {
      this.neighborhood.parcels.splice(parcelIndex, 1);
    }

    this.emit();
    return true;
  }

  private tickAutoZoningSettlers(dt: number) {
    this.settlerTimer += dt;
    if (this.settlerTimer < 5) return; // check every 5 seconds
    this.settlerTimer = 0;

    // Find any free lot in the neighborhood
    const freeLot = this.neighborhood.lots.find(
      (l) => !l.ownerCitizenId && !l.reservedFor && l.zone === "residential",
    );
    if (!freeLot) return;

    const seed = Date.now();
    const h = generateHousehold(seed);
    h.status = "approved";

    const plotInfo = {
      id: freeLot.id,
      name: `Plot ${freeLot.id.split("-")[1] || "Zoned"}`,
      vibe: "plains" as any,
      zone: "residential" as any,
      x: freeLot.x,
      y: freeLot.y,
      description: "A dynamically zoned plot.",
    };

    const citizen = this.citizens.register(h, plotInfo, Date.now());
    if (citizen) {
      this.ensureKbProfile({
        citizenId: citizen.id,
        alias: citizen.displayName,
        bio: `Settled in a newly zoned residential plot!`,
        plotId: citizen.plotId,
        address: citizen.plotName,
        kind: "human",
      });

      this.seedDeposit(citizen.id);
      if (this.purchaseLot(citizen.id, freeLot.id)) {
        this.commissionLot(freeLot.id);
      }
    }
  }

  /** The buy-time gate for PRIVATE neighbourhoods. Before the player completes a plot purchase the UI
   *  asks whether this signed-in player may buy in the lot's neighbourhood: the open primary
   *  neighbourhood (no key) always passes; a satellite hamlet is checked against the backend allowlist
   *  (private hamlets gate on a grant; public/unregistered ones pass). Fails closed, so a network blip
   *  never leaks a private hamlet to a non-granted player. Deps are injectable for tests. */
  async canBuyLotByAccess(
    lotId: string,
    deps: NeighbourhoodAccessDeps = defaultAccessDeps(),
  ): Promise<AccessDecision> {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    const key = lot?.neighborhoodKey ?? neighbourhoodKeyForLot(lotId);
    return checkNeighbourhoodAccess(key, deps);
  }

  /** Assign a free lot to a citizen as their home, and send their avatar walking to the door. */
  assignLot(citizenId: string, lotId: string): boolean {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    const c = this.citizens.byId(citizenId);
    if (!lot || !c || lot.ownerCitizenId) return false;
    for (const l of this.neighborhood.lots)
      if (l.ownerCitizenId === citizenId) {
        l.ownerCitizenId = undefined;
        l.built = false;
      }
    lot.ownerCitizenId = citizenId;
    // Home = the house-zone centre (set back from the street), so stepping into the citizen parks at
    // their actual home; the avatar walks to the door cell facing the street.
    c.homeXY = {
      x: Math.round(lot.houseZone.x + (lot.houseZone.w - 1) / 2),
      y: Math.round(lot.houseZone.y + (lot.houseZone.d - 1) / 2),
    };
    this.citizens.setTarget(citizenId, { x: lot.doorX, y: lot.doorY });
    // Spec 082 P2 — the move-in becomes a timeline event on their Kookerbook page.
    this.kbPost(
      citizenId,
      "event",
      `Moved into a homestead at ${c.plotName}. The fence is up and the field is waiting.`,
    );
    this.emit();
    return true;
  }

  // ── Spec 082 — Kookerbook, the bot social network ───────────────────────────
  /** Live profile map (citizenId -> profile). Persisted through kookerbookStore on every change. */
  private kookerbook = new Map<string, KbProfile>();

  /** All profiles, newest-citizen last (Joe the founder first). The directory reads this. */
  kbProfiles(): KbProfile[] {
    return Array.from(this.kookerbook.values());
  }
  kbProfile(citizenId: string): KbProfile | undefined {
    return this.kookerbook.get(citizenId);
  }

  /** Create a screened profile for a citizen if they do not have one yet, with a birth event post. */
  private ensureKbProfile(opts: {
    citizenId: string;
    alias: string;
    bio: string;
    plotId?: string;
    address?: string;
    kind?: "human" | "crab";
  }): void {
    if (this.kookerbook.has(opts.citizenId)) return;
    const profile = createProfile(opts);
    if (!profile) {
      // Failed the safety screen — no profile is better than a leaky one, but say so: a silent
      // reject here cost us Viw's founder profile (his bio used a brand word the denylist eats).
      console.warn(
        "[citylife] kookerbook profile rejected by the safety screen:",
        opts.citizenId,
      );
      return;
    }
    const withBirth = addPost(profile, {
      sol: this.sim.state.clock.day,
      kind: "event",
      text: `${opts.alias} arrived in Landing One.`,
    });
    const final = withBirth ?? profile;
    this.kookerbook.set(opts.citizenId, final);
    saveProfileLocal(final);
    void saveProfileBackend(final).then((r) => {
      if (!r.ok)
        console.warn("[citylife] kookerbook backend save deferred:", r.error);
    });
    this.emit();
  }

  /** Append a screened, capped post to a citizen's timeline (events from the engine, narrations,
   *  or bot-authored text). Persists both layers; refusals (unsafe text, rate cap) return false. */
  kbPost(
    citizenId: string,
    kind: PostKind,
    text: string,
    imageRef?: string,
  ): boolean {
    const p = this.kookerbook.get(citizenId);
    if (!p) return false;
    const next = addPost(p, {
      sol: this.sim.state.clock.day,
      kind,
      text,
      imageRef,
    });
    if (!next) return false;
    this.kookerbook.set(citizenId, next);
    saveProfileLocal(next);
    void saveProfileBackend(next).then((r) => {
      if (!r.ok)
        console.warn("[citylife] kookerbook backend save deferred:", r.error);
    });
    this.emit();
    return true;
  }

  /** Restore profiles: local immediately, backend overlaid when it answers (backend wins). */
  private restoreKookerbook(): void {
    const local = loadKookerbookLocal();
    for (const [id, p] of Object.entries(local)) this.kookerbook.set(id, p);
    void fetchKookerbookBackend().then((backend) => {
      if (!backend) return;
      for (const [id, p] of Object.entries(mergeKookerbook(local, backend)))
        this.kookerbook.set(id, p);
      this.emit();
    });
  }

  /** Spec 077 P4 — the House Builder URL for a lot, seeded with the plot's REAL house-zone tile count,
   *  its houseSeed and the owner's citizen id. A stored blueprint rides along as bp= so re-opening the
   *  builder loads the citizen's current design for editing. Null for an unowned lot. */
  builderUrl(lotId: string): string | null {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    if (!lot || !lot.ownerCitizenId) return null;
    const q = new URLSearchParams({
      citizenId: lot.ownerCitizenId,
      lotId: lot.id,
      w: String(lot.houseZone.w),
      d: String(lot.houseZone.d),
      seed: String(lot.houseSeed >>> 0),
    });
    if (lot.blueprint) q.set("bp", lot.blueprint);
    return `/builder.html?${q.toString()}`;
  }

  /** Spec 077 P4 — open the House Builder for a lot in a popup. The popup posts blueprint_saved back
   *  to this window (the constructor listens), which validates + stores + raises the house. */
  openBuilder(lotId: string): boolean {
    const url = this.builderUrl(lotId);
    if (!url || typeof window === "undefined") return false;
    window.open(url, `citylife_builder_${lotId}`, "width=1280,height=800");
    return true;
  }

  /** Spec 077 P4 — accept an authored blueprint for a lot: validate the script, store it on the parcel
   *  AND the owning citizen, then raise the house (materials + labour gated — when the colony cannot
   *  afford it the blueprint stays stored and the Build button raises it later). Re-running on a built
   *  lot re-renders the house from the new script (the renderer keys its rebuild on the blueprint). */
  applyBlueprint(
    lotId: string,
    script: string,
    eventText?: string | null,
  ): boolean {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    if (!lot || !lot.ownerCitizenId) return false;
    if (!validateBlueprint(script).ok) return false;
    const isRedesign = lot.built && !!lot.blueprint;
    lot.blueprint = script;
    // The driveway, gate and fence gap follow the design's door (spec 077 door-access contract),
    // and the moved walkway cells are re-reserved so colony roads never route over them (084 S2).
    retargetParcelAccess(lot, parseBlueprint(script).doorDir);
    reserveParcelLand(this.sim.state, lot.driveway);
    const c = this.citizens.byId(lot.ownerCitizenId);
    if (c) c.blueprint = script;
    // Spec 082 P2 — an accepted design becomes a timeline event on the owner's Kookerbook page. Callers
    // may override the message, or pass null to skip it (spec 088 — furniture placement reuses this path
    // but should not spam a "redesigned their home" post for every piece dropped in).
    const eventMsg =
      eventText === undefined
        ? isRedesign
          ? "Redesigned their home — a fresh blueprint is on file at the builder desk."
          : "Designed their own home, blueprint filed and the build crew booked."
        : eventText;
    if (eventMsg) this.kbPost(lot.ownerCitizenId, "event", eventMsg);
    // Spec 077 P4.5 — persist the accepted design: locally always (reload-proof offline), and to the
    // citylife backend best-effort as the player (the cross-device copy; a 404 just means the
    // kooker-side endpoint has not shipped yet — never blocks the game).
    saveBlueprintLocal(lotId, lot.ownerCitizenId, script);
    void saveBlueprintBackend(lotId, lot.ownerCitizenId, script).then((r) => {
      if (!r.ok)
        console.warn("[citylife] blueprint backend save deferred:", r.error);
    });
    if (!lot.built) this.buildHouse(lotId); // best-effort; the stored blueprint survives a failed gate
    this.emit();
    return true;
  }

  /** Spec 088 Slice E — PLACE OWNED FURNITURE in your house: take a piece the player OWNS (from their
   *  furnitureStore inventory) and drop it into their lot's blueprint at the chosen cell, rotation and
   *  storey, rebuild the house from the new script (through the validated applyBlueprint path), and
   *  consume one from inventory. You may only furnish a lot you own. Returns false — and consumes
   *  nothing, builds nothing — when the player does not own the piece, the lot is not theirs, the design
   *  is already full, or the resulting script fails validation. */
  placeFurnitureFromInventory(
    citizenId: string,
    lotId: string,
    itemId: string,
    x: number,
    y: number,
    rot = 0,
    z = 0,
  ): boolean {
    const inv = loadInventoryLocal();
    const stack = ownedBy(inv, citizenId).find((s) => s.id === itemId);
    if (!stack || stack.qty < 1) return false; // the player does not own this piece
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    if (!lot || lot.ownerCitizenId !== citizenId) return false; // furnish only your own home
    // Start from the lot's current design (or its default house if undesigned), keeping its door.
    const doorDir = lot.blueprint
      ? parseBlueprint(lot.blueprint).doorDir
      : streetDoorDir(lot);
    const base =
      lot.blueprint ??
      defaultBlueprint(lot.houseSeed, doorDir, lot.houseZone.w);
    const p = parseBlueprint(base);
    if ((p.items?.length ?? 0) >= FURNITURE_ITEM_CAP) return false; // full — consume nothing
    const script = blueprintToScript(placeItemAt(p, stack.kind, x, y, rot, z));
    // applyBlueprint validates, stores the design, rebuilds the house and persists it (local + backend).
    // Pass null so placing a piece does not post a "redesigned their home" event for every drop.
    if (!this.applyBlueprint(lotId, script, null)) return false;
    // Consume one of the piece from inventory only once the placement actually took.
    const inv2 = removeOwned(inv, citizenId, itemId, 1);
    saveInventoryLocal(inv2);
    void saveInventoryBackend(citizenId, ownedBy(inv2, citizenId)).catch(
      () => {},
    );
    return true;
  }

  /** Spec 088 Slice E — the homestead lot a citizen owns (their home), or null. Public so the HUD can
   *  target the player's own house when they place furniture. One home per citizen (assignLot is 1:1). */
  lotForCitizen(citizenId: string): Lot | null {
    return (
      this.neighborhood.lots.find((l) => l.ownerCitizenId === citizenId) ?? null
    );
  }

  /** Spec 088 Slice E — the HUD convenience: place an owned piece into the player's OWN house at an
   *  auto-chosen free cell (precise placement stays in the builder). Finds their lot and a free cell,
   *  then delegates to placeFurnitureFromInventory (which gates ownership, rebuilds and consumes one).
   *  Returns false when the player owns no home or the placement is refused. */
  placeFurnitureAuto(citizenId: string, itemId: string): boolean {
    const lot = this.lotForCitizen(citizenId);
    if (!lot) return false;
    const base =
      lot.blueprint ??
      defaultBlueprint(lot.houseSeed, streetDoorDir(lot), lot.houseZone.w);
    const cell = freeItemCell(parseBlueprint(base));
    return this.placeFurnitureFromInventory(
      citizenId,
      lot.id,
      itemId,
      cell.x,
      cell.y,
      0,
      0,
    );
  }

  // ── Furniture ARRANGEMENT (spec 089) — rearrange the furniture already placed in your house, any time
  // after it is built. Move/rotate/restack a piece freely (no inventory churn); removing it returns the
  // piece to your inventory. Each op edits the lot blueprint's item{...} list with a pure blueprintEdit
  // op and rebuilds the house through the validated applyBlueprint(null) path (no "redesigned" post).

  /** The furniture currently placed in a lot's house, with each piece's index (its handle for the
   *  arrange ops), kind, cell, rotation and storey. Empty for an unbuilt/undesigned or unknown lot. */
  placedFurniture(lotId: string): {
    index: number;
    kind: FurnitureKind;
    x: number;
    y: number;
    rot: number;
    z: number;
  }[] {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    if (!lot || !lot.blueprint) return [];
    return parseBlueprint(lot.blueprint).items.map((f, index) => ({
      index,
      kind: f.kind,
      x: f.x,
      y: f.y,
      rot: f.rot,
      z: f.z ?? 0,
    }));
  }

  /** Spec 089 — the number of storeys a lot's house has (1..3), so the HUD can show per-floor arrange
   *  controls only on a multi-storey home. 1 for an unbuilt/unknown lot. */
  houseStoreys(lotId: string): number {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    if (!lot || !lot.blueprint) return 1;
    return Math.max(1, Math.min(3, parseBlueprint(lot.blueprint).wallH));
  }

  /** Apply a pure furniture edit to a lot you OWN and rebuild the house. The lot must be yours and
   *  already designed. Returns false (no change) otherwise or if the result fails validation. Private
   *  spine for the public move/rotate/restack ops. */
  private arrangeOnLot(
    citizenId: string,
    lotId: string,
    edit: (p: ParsedBlueprint) => ParsedBlueprint,
  ): boolean {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    if (!lot || lot.ownerCitizenId !== citizenId || !lot.blueprint)
      return false;
    const next = edit(parseBlueprint(lot.blueprint));
    return this.applyBlueprint(lotId, blueprintToScript(next), null);
  }

  /** Spec 089 — slide a placed piece by (dx,dy) cells (clamped into the footprint). Free; no inventory
   *  change. `index` comes from placedFurniture. */
  moveArrangedFurniture(
    citizenId: string,
    lotId: string,
    index: number,
    dx: number,
    dy: number,
  ): boolean {
    return this.arrangeOnLot(citizenId, lotId, (p) =>
      moveItem(p, index, dx, dy),
    );
  }

  /** Spec 089 — rotate a placed piece a quarter-turn clockwise. Free; no inventory change. */
  rotateArrangedFurniture(
    citizenId: string,
    lotId: string,
    index: number,
  ): boolean {
    return this.arrangeOnLot(citizenId, lotId, (p) => rotateItem(p, index));
  }

  /** Spec 089 — move a placed piece up/down a storey (dz = +1 up, -1 down), clamped to the design's
   *  floors. Free; no inventory change — the multi-level "arrange whenever" reaches every floor. */
  restackArrangedFurniture(
    citizenId: string,
    lotId: string,
    index: number,
    dz: number,
  ): boolean {
    return this.arrangeOnLot(citizenId, lotId, (p) =>
      moveItemStorey(p, index, dz),
    );
  }

  /** Spec 089 — take a placed piece back out of the house and RETURN it to your inventory (so you can
   *  re-place it elsewhere, or sell it). The piece returns as its catalog kind — the blueprint does not
   *  store the custom name, so a once-named "Cozy Couch" comes back as a plain sofa. Returns false when
   *  the lot is not yours or the index is out of range. */
  removeArrangedFurniture(
    citizenId: string,
    lotId: string,
    index: number,
  ): boolean {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    if (!lot || lot.ownerCitizenId !== citizenId || !lot.blueprint)
      return false;
    const p = parseBlueprint(lot.blueprint);
    const piece = p.items[index];
    if (!piece) return false; // nothing at that handle
    if (
      !this.applyBlueprint(lotId, blueprintToScript(removeItem(p, index)), null)
    )
      return false;
    // Hand the piece back to the player's inventory (best-effort backend sync, never blocks).
    const inv = recordOwnedLocal(citizenId, piece.kind, piece.kind, 1);
    void saveInventoryBackend(citizenId, ownedBy(inv, citizenId)).catch(
      () => {},
    );
    this.emit();
    return true;
  }

  /** Spec 077 P4.5 — restore stored designs onto their lots: the local map immediately (so the houses
   *  stand before first paint), then the backend layer overlaid when it answers (backend wins — it is
   *  the cross-device truth). Every script was validated + screened by the store before it gets here. */
  private restoreBlueprints(): void {
    const apply = (
      map: Record<string, { citizenId: string; script: string }>,
    ) => {
      let applied = 0;
      for (const [lotId, entry] of Object.entries(map)) {
        const lot = this.neighborhood.lots.find((l) => l.id === lotId);
        if (!lot) continue;
        // Spec 084 S2 — founder plots only restore THEIR OWN stored design: a stale or foreign
        // entry must never clobber a crafted founder house.
        if (!canRestoreBlueprint(lot, entry.citizenId)) continue;
        lot.blueprint = entry.script;
        lot.built = true; // the design was accepted and built before; it stands again on reload
        retargetParcelAccess(lot, parseBlueprint(entry.script).doorDir);
        reserveParcelLand(this.sim.state, lot.driveway);
        const c = this.citizens.byId(lot.ownerCitizenId ?? "");
        if (c) c.blueprint = entry.script;
        applied++;
      }
      if (applied > 0) this.emit();
    };
    const local = loadBlueprintsLocal();
    apply(local);
    void fetchBlueprintsBackend().then((backend) => {
      if (backend) apply(mergeBlueprints(local, backend));
    });
  }

  /** Spec 077 P6 — the citizen's bot designs its own home: start from the lot's current design (or
   *  the per-citizen generated one), run the capped inspect/mutate self-design loop, and accept the
   *  result through the same validated applyBlueprint path the builder popup uses. Returns the loop's
   *  trace so callers (and the HUD/bots) can narrate what the citizen changed and why. */
  selfDesignLot(lotId: string): SelfDesignResult | null {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    if (!lot || !lot.ownerCitizenId) return null;
    // Spec 084 S2 — self-design respects the citizen's CHOSEN door: a bot that put its door on the
    // east side keeps it there through every improvement pass (the old code forced the street door,
    // silently undoing an authored choice). Fresh lots still start street-facing.
    const doorDir = lot.blueprint
      ? parseBlueprint(lot.blueprint).doorDir
      : streetDoorDir(lot);
    const start =
      lot.blueprint ??
      defaultBlueprint(lot.houseSeed, doorDir, lot.houseZone.w);
    const result = selfDesign(
      start,
      { w: lot.houseZone.w, d: lot.houseZone.d },
      lot.houseSeed >>> 0,
      doorDir,
    );
    this.applyBlueprint(lotId, result.script);
    return result;
  }

  /** Spec 083 P2/P4a — the citizen COMMISSIONS their home from Viw the Builder: their seeded dream
   *  meets Viw's quote through the negotiation engine, and on a deal the agreed brief compiles to a
   *  blueprint, the crew raises it (the door-access contract included), and the commission posts to
   *  BOTH Kookerbook timelines. Deterministic from the citizen's house seed — the same deal the
   *  Builder Desk shows. The real wallet move (client -> Viw city coin via kooker-service-ledger) is
   *  P4b, gated on that service; until then the price lives in the timeline events. Founders and the
   *  builder himself don't commission. Returns the session so the HUD/bots can narrate the haggle. */
  commissionLot(lotId: string): NegotiationSession | null {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    if (
      !lot ||
      !lot.ownerCitizenId ||
      lot.ownerCitizenId === VIW_ID ||
      lot.reservedFor
    )
      return null;
    const seed = lot.houseSeed >>> 0;
    const zone = { w: lot.houseZone.w, d: lot.houseZone.d };
    const dream = dreamBrief(seed, zone, streetDoorDir(lot));
    // Spec 085 — the citizen builds what their ₭ WALLET can afford (after land): the negotiation
    // runs against their real purse. A citizen with no wallet yet falls back to the seeded allowance
    // so the standalone "Hire Viw" still works before the land economy funds them.
    const budget =
      this.walletK(lot.ownerCitizenId) || seededBudget(seed, dream);
    const session = negotiate({
      clientSeed: seed,
      builderSeed: VIW_SEED,
      dream,
      budget,
    });
    const client = this.citizens.byId(lot.ownerCitizenId);
    const clientFirst = (client?.displayName ?? "a newcomer").split(" ")[0];
    if (session.state === "agreed" && session.agreedBrief) {
      this.applyBlueprint(lotId, briefToBlueprint(session.agreedBrief, seed)); // builds + posts the design event
      // Spec 085 — the ₭ actually moves: client -> the Builder for the build (double-entry, conserved).
      ledgerPost(
        this.sim.state.ledger,
        `${clientFirst} pays KOOKER ${session.agreedPrice} ${CURRENCY} for the build`,
        [
          {
            account: `citizen:${lot.ownerCitizenId}`,
            amount: -(session.agreedPrice ?? 0),
          },
          { account: `citizen:${VIW_ID}`, amount: session.agreedPrice ?? 0 },
        ],
      );
      // Spec 085 P1 — mirror the build fee onto the real ledger (client -> the Builder, KOOKER).
      this.mirror({
        kind: "commission",
        fromCitizenId: lot.ownerCitizenId,
        toCitizenId: VIW_ID,
        lotId,
        amount: session.agreedPrice ?? 0,
      });
      this.kbPost(
        lot.ownerCitizenId,
        "event",
        `Shook hands with KOOKER the Builder — a home for ${session.agreedPrice} city coin. The crew starts this week.`,
      );
      this.kbPost(
        VIW_ID,
        "event",
        `Booked a build for ${clientFirst} — ${session.agreedPrice} city coin, crew on site.`,
      );
    } else {
      this.kbPost(
        lot.ownerCitizenId,
        "event",
        "Met KOOKER the Builder about a home, but the quote ran past the purse. Saving up for another season.",
      );
    }
    this.emit();
    return session;
  }

  /** Build a voxel home on a lot — raised by the BUILD CREW. The crew draws on the colony stockpile
   *  when it has materials and sources off-island when it does not, so Build never dead-locks (the
   *  old materials+labour gate locked forever in bot-city saves with no workforce economy). The real
   *  economic gate arrives with spec 083: Viw the Builder charges Kookercurrency for the job. */
  buildHouse(lotId: string): boolean {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    if (!lot || lot.built) return false;
    const s = this.sim.state;
    s.materials = Math.max(0, s.materials - COLONY.build.matNeighborHouse);
    lot.built = true;
    // Spec 077 P2 — seed a deterministic house BLUEPRINT (door facing the street) so the home raises as the
    // fancy greedy-meshed brick house, not the legacy minecraft cottage. The builder route (P3) and the
    // bot/human-authored script storage (P4) will overwrite this with the citizen's own design.
    if (!lot.blueprint) {
      const doorDir = streetDoorDir(lot);
      lot.blueprint = defaultBlueprint(lot.houseSeed, doorDir, lot.houseZone.w);
      retargetParcelAccess(lot, doorDir);
    }
    this.emit();
    return true;
  }

  /** Demolish a lot's house (frees the lot, keeps the citizen). Returns the freed owner id, if any.
   *  Founder plots (spec 078) are protected — they cannot be demolished. */
  demolishLot(lotId: string): string | null {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId);
    if (!lot || lot.reservedFor) return null;
    const owner = lot.ownerCitizenId ?? null;
    lot.built = false;
    lot.ownerCitizenId = undefined;
    this.emit();
    return owner;
  }

  /** Demolish the lot AND destroy the citizen who lived there, agent and all — like a legend. */
  demolishLotAndCitizen(lotId: string): boolean {
    const owner = this.demolishLot(lotId);
    if (owner) this.removeCitizen(owner);
    return true;
  }

  /** Destroy a citizen: free any lot they held, exit first-person if you were inside them, tear down
   *  their Hermes pod (best-effort, server-side), and drop them from the roster. */
  removeCitizen(citizenId: string): boolean {
    const c = this.citizens.byId(citizenId);
    if (!c) return false;
    for (const l of this.neighborhood.lots)
      if (l.ownerCitizenId === citizenId) {
        l.ownerCitizenId = undefined;
        l.built = false;
      }
    // Spec 079 P1 — free any high-street shop plot they held too, so it returns to the market (else
    // the plot is stranded as a ghost owner: counted not-free but unclaimable).
    for (const p of this.commercialDistrict?.parcels ?? [])
      if (p.ownerCitizenId === citizenId) {
        p.ownerCitizenId = undefined;
        p.built = false;
      }
    if (this.fpCitizenId === citizenId) this.exitFirstPerson();
    if (c.hasPod) void this.teardownPod(citizenId);
    this.citizens.remove(citizenId);
    this.emit();
    return true;
  }

  /** Best-effort Hermes pod teardown. The real DELETE /bots/{label} is server-side (DMZ unreachable
   *  from the browser); here we POST the citylife backend destroy intent. Never throws. */
  private async teardownPod(citizenId: string): Promise<void> {
    try {
      await fetch(
        `/kooker/api/v1/citylife/citizens/${encodeURIComponent(citizenId)}/destroy`,
        { method: "POST" },
      );
    } catch {
      /* expected offline / internal-only */
    }
  }

  /** Spec 090 — a ground click at grid (gx,gy): if it lands inside a homestead with an OWNER, open that
   *  citizen's Kookerbook page in a new tab (a deep link the Book reads via ?citizen=). Empty / free plots
   *  are left to the HUD plot list, which already shows their price + actions. */
  private openPlotBook(gx: number, gy: number): void {
    for (const lot of this.neighborhood.lots) {
      const f = lot.fence;
      if (!f || f.length === 0) continue;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const c of f) {
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
      }
      if (gx < minX || gx > maxX || gy < minY || gy > maxY) continue;
      const owner = lot.ownerCitizenId;
      if (owner && typeof window !== "undefined")
        window.open(
          `/kookerbook.html?citizen=${encodeURIComponent(owner)}`,
          "_blank",
          "noopener",
        );
      return;
    }
  }

  /** P1 — move the active first-person citizen by (dx, dy) cells and fire a narration. */
  walkStep(dx: number, dy: number): void {
    const id = this.fpCitizenId;
    if (!id) return;
    const c = this.citizens.byId(id);
    if (!c) return;
    const S = this.sim.state.terrain.size;
    const from = { ...c.pos };
    const target = {
      x: Math.max(0, Math.min(S - 1, Math.round(c.pos.x + dx))),
      y: Math.max(0, Math.min(S - 1, Math.round(c.pos.y + dy))),
    };
    const blocked = this.blockedSegmentReason(from, target);
    if (blocked) {
      this.fpBlockedReason = blocked;
      this.emit();
      return;
    }
    this.fpGuidedTarget = null;
    this.fpBlockedReason = null;
    this.fpWalkSpeed = 0;
    c.pos = target;
    c.target = target;
    this.emit();
    void this.narrate();
  }

  /** Ask the bot to narrate what the first-person citizen currently sees. */
  async narrate(): Promise<void> {
    const id = this.fpCitizenId;
    if (!id || this.fpNarrating) return;
    const view = firstPersonView(this.sim.state, id, this.citizens);
    if (!view) return;
    const c = this.citizens.byId(id);
    if (!c) return;
    this.fpNarrating = true;
    this.fpNarration = null;
    this.emit();
    try {
      const line = await this.botService.narrateView(
        c.displayName,
        c.plotName,
        view,
      );
      this.fpNarration = line;
    } catch {
      this.fpNarration = null;
    }
    this.fpNarrating = false;
    this.emit();
  }

  /** Poll until the avatar reaches the target cell, then trigger a narration. */
  private async narrateOnArrival(
    citizenId: string,
    target: { x: number; y: number },
  ): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 300));
      const c = this.citizens.byId(citizenId);
      if (!c) return;
      const dx = c.pos.x - target.x,
        dy = c.pos.y - target.y;
      if (Math.hypot(dx, dy) < 1.5) {
        await this.narrate();
        return;
      }
    }
  }

  /** Border patrol asks an approved household's bot another question (the reply is the bot's own). */
  async askBot(botId: string, question: string): Promise<void> {
    await this.botService.ask(botId, question);
    this.emit();
  }

  /** Reset the Kookerverse: clear saved settlers + ledger so the game starts fresh (caller reloads). */
  reset(): void {
    clearColony();
  }

  // ── Low Power Radio ──────────────────────────────────────────────────────────
  /** Turn the radio on or off. First on picks the first configured channel. */
  toggleRadio(): void {
    this.radio = radioToggleOn(this.radio);
    if (this.radio.on) this.startAdLoop();
    else this.stopAdLoop();
    this.emit();
  }
  /** Tune to a channel by id. */
  tuneRadio(channelId: string): void {
    this.radio = tuneTo(this.radio, channelId);
    this.startAdLoop();
    this.emit();
  }
  toggleRadioMuted(): void {
    this.radio = radioToggleMuted(this.radio);
    this.emit();
  }
  /** Drop into TV mode — hides operator UI, kicks off the cinematic fly-around, keeps the radio on. */
  setTv(on: boolean): void {
    this.tv = on;
    if (typeof document !== "undefined")
      document.body.classList.toggle("tv-mode", on);
    this.renderer?.setCinematic(on);
    this.emit();
  }
  toggleTv(): void {
    this.setTv(!this.tv);
  }
  /** Login-screen attract backdrop: the cinematic fly-around ONLY, without the global tv-mode body class
   *  (that class hides the operator HUD, which must never bleed into the authed app). Used by the
   *  pre-login CinematicBackdrop, which runs its own throwaway runtime behind the login card. */
  setCinematicOnly(on: boolean): void {
    this.renderer?.setCinematic(on);
  }
  /** Toggle the city-plan zoning overlay (zone tints + plot flags). */
  toggleZones(): void {
    this.zonesVisible = !this.zonesVisible;
    this.renderer?.setZonesVisible(this.zonesVisible);
    this.emit();
  }
  /** Spec 025 — set the household levy rate (the council's fiscal lever; only bites with a staffed Levy Office). */
  setLevy(rate: "low" | "normal" | "high"): void {
    this.sim.state.levyRate = rate;
    this.emit();
  }
  /** Spec 029 — set the colony-wide wage rate (the council's pay lever; only bites with a staffed Pay Office). */
  setWage(rate: "low" | "standard" | "generous"): void {
    this.sim.state.wageRate = rate;
    this.emit();
  }
  /** Spec 030 — fund a Civic Feast (spends treasury + supplies; needs a staffed Feast Deck). Returns whether it ran. */
  callFeast(): boolean {
    const ok = callFeast(this.sim.state);
    if (ok) this.emit();
    return ok;
  }
  /** Spec 032 — fulfil the open Kookerverse Civic Request (spends the goods, raises standing). Returns whether it ran. */
  fulfillRequest(): boolean {
    const ok = fulfillRequest(this.sim.state);
    if (ok) this.emit();
    return ok;
  }
  /** Spec 033 — fund the next stage of the Horizon Spire (spends its bundle, reserves a crew). Returns whether it began. */
  fundSpire(): boolean {
    const ok = fundSpireStage(this.sim.state);
    if (ok) this.emit();
    return ok;
  }

  /** Spec 144 — fund the next Ironwork Pillar stage. Mechanics only; renderer lane reads the stage later. */
  fundIronworkStage(): boolean {
    const ok = fundIronworkStage(this.sim.state);
    if (ok) this.emit();
    return ok;
  }
  /** Spec 036 — set (or clear) the standing import order (only buys with a built, staffed Import Office). */
  setImportOrder(good: ImportGood | null): void {
    this.sim.state.importOrder = good;
    this.emit();
  }
  /** Spec 038 — set the labour-priority mode (only bites under a shortage with a staffed Roster Office). */
  setRosterMode(mode: "essentials" | "balanced" | "industry"): void {
    this.sim.state.rosterMode = mode;
    this.emit();
  }
  /** Capture the current view as a PNG data URL (HUD snapshot button); null before the renderer starts. */
  snapshot(): string | null {
    return this.renderer?.capturePNG() ?? null;
  }
  /** Compose a shareable "poster" of the colony over the current view, mounted as a fixed overlay.
   *  Returns false if the renderer has not started (no hero to capture). Driven by the morning routine. */
  shareCard(info?: {
    headline?: string;
    tagline?: string;
    sol?: number;
    specTitle?: string;
    format?: CardFormat;
  }): boolean {
    const hero = this.snapshot();
    if (!hero || typeof document === "undefined") return false;
    const ui = this.getUiState();
    document.getElementById(CARD_ID)?.remove();
    document.body.appendChild(
      buildShareCard({
        hero,
        sol: info?.sol ?? ui.clock.sol,
        headline: info?.headline ?? headlineFor(info?.specTitle),
        tagline: info?.tagline ?? DEFAULT_TAGLINE,
        stats: shareStats(ui),
        site: siteLabel(ui),
        format: info?.format ?? "wide",
      }),
    );
    // Hide everything else (live canvas + HUD) so the poster is clean — the hero is already frozen into the card.
    for (const ch of Array.from(document.body.children)) {
      if (!(ch instanceof HTMLElement) || ch.id === CARD_ID) continue;
      ch.dataset.kvPrevDisplay = ch.style.display || "∅";
      ch.style.display = "none";
    }
    return true;
  }
  /** Remove the share-card overlay and restore the normal game view. */
  clearShareCard(): void {
    if (typeof document === "undefined") return;
    document.getElementById(CARD_ID)?.remove();
    for (const ch of Array.from(document.body.children)) {
      if (!(ch instanceof HTMLElement) || !ch.dataset.kvPrevDisplay) continue;
      ch.style.display =
        ch.dataset.kvPrevDisplay === "∅" ? "" : ch.dataset.kvPrevDisplay;
      delete ch.dataset.kvPrevDisplay;
    }
  }
  private startAdLoop() {
    if (this.adInterval) return;
    // One sponsor / house ad every 90 seconds — the demo of the ad-revenue surface.
    this.adInterval = setInterval(() => {
      this.radio = spinHouseAd(this.radio, Date.now());
      this.emit();
    }, 90_000);
    // First ad immediately so the panel is never empty.
    this.radio = spinHouseAd(this.radio, Date.now());
  }
  private stopAdLoop() {
    if (this.adInterval) clearInterval(this.adInterval);
    this.adInterval = null;
  }

  start(container: HTMLElement) {
    if (this.running) return;
    this.renderer = new PlanetRenderer(container, this.sim, this);
    this.renderer.setZonesVisible(this.zonesVisible);
    // P1 — feed the renderer the live citizen avatars each frame, marking the operator's own.
    this.renderer.setAvatarSource((): AvatarView[] => {
      const mine = this.operatorCitizenId();
      return this.citizens.avatars().map((a) => ({
        ...a,
        isOperator: a.id === mine,
        lookPitch: a.id === this.fpCitizenId ? this.fpLookPitch : 0,
      }));
    });
    if (this.fpCitizenId) this.renderer.enterFirstPerson(this.fpCitizenId);
    this.renderer.setNeighborhood(this.neighborhood); // spec 075 — lot pads + voxel homes
    this.renderer.setCommercialDistrict(this.commercialDistrict); // spec 079 — the vibrant shop strip
    this.renderer.setRoadWays(this.roadWays); // spec 088 — smooth ribbon road surfaces over the cell roads
    this.renderer.setBusRoute(this.busRoute); // spec 088 — the bus that loops between the hoods
    this.renderer.setRaceState(this.raceState);
    this.updateOperatorCar(); // spec 096 — park the player's car in the world if an operator is set
    this.renderer.onGroundClick = (gx, gy) => this.openPlotBook(gx, gy); // spec 090 — click a plot to open its Kookerbook
    this.running = true;
    this.lastFrame = performance.now();
    this.lastUi = this.lastFrame;
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
    this.renderer = null;
  }

  private loop = (now: number) => {
    if (!this.running) return;
    const dtReal = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused) {
      this.accumulator += dtReal * this.speed;
      const stepDt = 1 / COLONY.time.stepsPerSec;
      let steps = 0;
      while (this.accumulator >= stepDt && steps < 2000) {
        this.sim.step();
        this.accumulator -= stepDt;
        steps++;
      }
    }
    if (this.fpCitizenId) this.driveFirstPerson(dtReal); // walk your bot with WASD when stepped in
    this.citizens.stepAvatars(dtReal); // P1 — walk the avatars in real time toward their targets
    this.updateFirstPersonGuidedArrival();
    this.wanderIdleCitizens(dtReal); // keep the citizens strolling so watch mode is never frozen
    this.tickAutoZoningSettlers(dtReal);
    this.raceTick(dtReal);
    this.renderer?.frame(dtReal);
    if (now - this.lastUi > 200) {
      this.lastUi = now;
      this.emit();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  setSpeed(m: number) {
    this.speed = Math.max(0, Math.min(20, m));
    this.emit();
  }
  setPaused(p: boolean) {
    this.paused = p;
    this.emit();
  }
  setView(v: ViewMode) {
    this.view = v;
    this.renderer?.setView(v);
    this.emit();
  }
  setPreset(p: CameraPreset) {
    this.preset = p;
    this.renderer?.applyPreset(p);
    this.emit();
  }
  resize() {
    this.renderer?.resize();
  }
  buildNow() {
    autoGrow(this.sim.state, this.sim.rng);
    this.emit();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit() {
    for (const cb of this.listeners) cb();
  }

  getUiState(): ColonyUiState {
    const s = this.sim.state;
    const canonicalClock = canonicalSolClock(Date.now());
    const li = s.terrain.idx(s.terrain.landing.x, s.terrain.landing.y);
    const p = s.power;
    const playerViewerId = this.playerView ? this.operatorCitizenId() : null;
    const playerScopedOwner = (ownerCitizenId: string | undefined) => {
      if (!ownerCitizenId) return { owner: null, ownerId: null };
      if (!this.playerView || ownerCitizenId === playerViewerId) {
        return {
          owner: this.citizens.byId(ownerCitizenId)?.displayName ?? null,
          ownerId: ownerCitizenId,
        };
      }
      return { owner: "Occupied", ownerId: null };
    };
    return {
      running: this.running,
      paused: this.paused,
      speed: this.speed,
      clock: {
        day: canonicalClock.earthDay,
        hour: canonicalClock.hour,
        minute: canonicalClock.minute,
        isDay: canonicalClock.isDay,
        sol: canonicalClock.sol,
      },
      power: {
        solarW: p.solarW,
        loadW: p.loadW,
        batteryWh: p.batteryWh,
        batteryCapWh: p.batteryCapWh,
        pct: p.batteryWh / p.batteryCapWh,
        brownout: inBrownout(s),
        windW: Math.round(turbinePower(s) * 10) / 10,
      },
      colonists: Math.round(s.colonists),
      colony: {
        treasury: Math.round(s.treasury),
        materials: Math.round(s.materials),
        components: Math.round(s.components),
        food: Math.round(s.food),
        reels: Math.round(s.reels),
        fibre: Math.round(s.fibre ?? 0),
        linen: Math.round(s.linen ?? 0),
        folios: Math.round(s.folios ?? 0),
        skilled: Math.floor(Math.min(s.colonists, s.skilled)),
        freeLabour: Math.floor(freeLabour(s)),
        capacity: housingCapacity(s),
        watered: Math.round(wateredFraction(s) * 100),
        provisioned: Math.round(provisionedFraction(s) * 100),
        health: Math.round(healthFraction(s) * 100),
        culture: Math.round(cultureFraction(s) * 100),
        cultureFuelled: cultureFuelFactor(s) >= 1,
        liveability: Math.round(colonyLiveability(s) * 100),
        smog: Math.round(pollutedFraction(s) * 100),
        commute: (() => {
          const c = commute(s);
          return {
            demand: Math.round(c.demand),
            capacity: c.capacity,
            congested: c.congested,
          };
        })(),
        maintenance: (() => {
          const m = maintenanceStatus(s);
          return {
            worst: Math.round(m.worstWear * 100),
            needing: m.needing,
            sheds: m.sheds,
          };
        })(),
        storage: (() => {
          const st = storageStatus(s);
          return {
            fill: Math.round(st.fill * 100),
            full: st.full,
            tightest: st.tightest,
          };
        })(),
        incidents: incidentStatus(s),
        levy: levyStatus(s),
        wage: wageStatus(s),
        feast: feastStatus(s),
        liaison: liaisonStatus(s),
        spire: spireStatus(s),
        pillar: pillarStatus(s),
        front: frontStatus(s),
        founders: foundersStatus(s),
        imports: importStatus(s),
        solace: (() => {
          const sl = solaceStatus(s);
          return {
            coverage: Math.round(sl.coverage * 100),
            shrines: sl.shrines,
          };
        })(),
        education: (() => {
          const ed = educationStatus(s);
          return {
            coverage: Math.round(ed.coverage * 100),
            schools: ed.schools,
          };
        })(),
        prosperity: prosperityStatus(s),
        water: waterStatus(s),
        tools: toolStatus(s),
        seed: seedStatus(s),
        arrears: arrearsStatus(s),
        roster: rosterStatus(s),
        departures: (() => {
          const d = departureStatus(s);
          return {
            pressure: Math.round(d.pressure * 100),
            atRisk: d.atRisk,
            cause: d.cause,
          };
        })(),
        confidence: confidenceStatus(s),
        births: birthStatus(s),
        footprint: footprintStatus(s),
        veins: veinStatus(s),
        calendar: calendarStatus(s),
        season: seasonStatus(s),
        ledger: ledgerStatus(s),
        rimfish: rimfishStatus(s),
        driedFish: driedFishStatus(s),
        duskcap: duskcapStatus(s),
        bathhouse: bathhouseStatus(s),
        library: libraryStatus(s),
        waste: wasteStatus(s),
        security: securityStatus(s),
        labour: labourStatus(s),
        planters: planterStatus(s),
        stalls: stallStatus(s),
        gallery: galleryStatus(s),
        porter: porterStatus(s),
        avatar: avatarStatus(s),
        fire: fireStatus(s),
        reclaim: reclaimStatus(s),
        festival: festivalStatus(s),
        diet: dietVarietyStatus(s),
        fever: (() => {
          const f = feverStatus(s);
          return {
            level: Math.round(f.outbreak * 100),
            contained: f.contained,
          };
        })(),
        housewares: Math.round(housewaresFraction(s) * 100),
        order: (() => {
          const o = unrestStatus(s);
          return { unrest: Math.round(o.unrest * 100), warded: o.warded };
        })(),
        surveyed: surveyAvailable(s),
        trade: Math.round(tradeExportRate(s)),
        tiers: housingTierCounts(s),
        buildings: s.buildings.length,
        building: s.jobs.length,
        load: Math.round(s.power.loadW * 10) / 10,
        jobs: s.totalJobs,
        employed:
          s.colonists > 0
            ? Math.round(
                (Math.min(s.colonists, s.totalJobs) / s.colonists) * 100,
              )
            : 0,
        pollution: Math.round(s.pollution),
      },
      settlers: {
        count: s.settlers.length,
        recent: s.settlers
          .slice(-6)
          .reverse()
          .map((x) => ({
            id: x.kookerId,
            name: this.playerView ? "Resident" : x.name,
          })),
      },
      bank: (() => {
        // Spec 085 — the bank panel reads the ACTIVE ₭ economy (citizen wallets), not the retired
        // settler accounts. deposits = ₭ held by residents, landOffice = ₭ paid for deeds, plus the
        // ZAR bridge and the real-ledger mirror's queue health.
        const allHeld = Math.round(walletDeposits(s.ledger));
        const viewerHeld = playerViewerId ? this.walletK(playerViewerId) : 0;
        const held = this.playerView ? viewerHeld : allHeld;
        const st = this.ledgerSyncStatus();
        return {
          scope: this.playerView ? "player" : "city",
          currency: CURRENCY,
          deposits: held,
          depositsZar: kookToZar(held, COLONY.economy.land),
          accounts: this.playerView
            ? playerViewerId
              ? 1
              : 0
            : walletCount(s.ledger),
          landOffice: this.playerView
            ? 0
            : Math.round(ledgerBalance(s.ledger, "land")),
          recent: this.playerView
            ? []
            : s.ledger.txns
                .slice(0, 6)
                .map((tx) => ({ id: tx.id, memo: tx.memo })),
          sync: this.playerView
            ? { pending: 0, synced: 0, lastError: null }
            : {
                pending: st.pending,
                synced: st.synced,
                lastError: st.lastError,
              },
        };
      })(),
      border: this.playerView
        ? {
            households: [],
            bots: [],
            botSource: "hidden",
            plots: [],
          }
        : {
            households: this.backend.households(),
            bots: this.botService.bots,
            botSource: this.botService.source,
            plots: this.cityPlan.plots,
          },
      citizens: (() => {
        // Player data isolation: a CITYLIFE_PLAYER (playerView) sees only their own full record + others'
        // public-presence stubs, and only their OWN wallet balance; the operator/admin sees everything.
        const viewerId = playerViewerId;
        const roster = this.playerView
          ? this.citizens.listFor(
              viewerId ?? "__unmatched_player__",
              viewerId ? VIW_ID : undefined,
            )
          : this.citizens.list();
        const walletCitizens = this.playerView
          ? viewerId
            ? this.citizens.list().filter((c) => c.id === viewerId)
            : []
          : this.citizens.list();
        return {
          count: this.citizens.size(),
          awake: this.citizens.awakeCount(),
          list: roster,
          // Spec 085 — each citizen's ₭ wallet, for the HUD (Buy/Hire gating + a balance readout).
          wallets: Object.fromEntries(
            walletCitizens.map((c) => [c.id, this.walletK(c.id)]),
          ),
        };
      })(),
      firstPerson: (() => {
        const opId = this.operatorCitizenId();
        const c = this.fpCitizenId
          ? this.citizens.byId(this.fpCitizenId)
          : null;
        const rawView = this.fpCitizenId
          ? firstPersonView(this.sim.state, this.fpCitizenId, this.citizens)
          : null;
        let view =
          this.playerView && rawView
            ? {
                ...rawView,
                neighbours: rawView.neighbours.map((n) => ({
                  ...n,
                  plotName: "Occupied",
                })),
              }
            : rawView;
        // Spec 149 — the runtime injects bus prompts (the pure view never scans buses): a dwelling
        // bus in range outranks ground prompts, and while RIDING only "Exit bus" (or nothing) shows.
        if (view) {
          const busAct = this.busInteraction();
          if (this.fpRidingBusId !== null)
            view = { ...view, interactionPrompt: busAct?.prompt ?? null };
          else if (busAct) view = { ...view, interactionPrompt: busAct.prompt };
        }
        return {
          active: this.fpCitizenId !== null,
          citizenId: this.fpCitizenId,
          citizenName: c?.displayName ?? null,
          operatorCitizenId: opId,
          stepInCitizenIds: this.stepInCitizenIds(),
          view,
          lookPitch: this.fpLookPitch,
          mouseSensitivity: this.fpMouseSensitivity,
          sprintCharge: Math.round(this.fpSprintCharge * 100),
          guidedTarget:
            this.fpGuidedTarget && c
              ? (() => {
                  const finalTarget = {
                    x: this.fpGuidedTarget.x,
                    y: this.fpGuidedTarget.y,
                  };
                  const nextWaypoint = this.blockedSegmentReason(
                    c.pos,
                    finalTarget,
                  )
                    ? this.firstPersonGuidedWaypoint(c.pos, finalTarget)
                    : null;
                  return {
                    label: this.fpGuidedTarget.label,
                    x: Math.round(this.fpGuidedTarget.x),
                    y: Math.round(this.fpGuidedTarget.y),
                    remainingDistance: roundTo(
                      Math.hypot(
                        c.pos.x - this.fpGuidedTarget.x,
                        c.pos.y - this.fpGuidedTarget.y,
                      ),
                      1,
                    ),
                    ...(nextWaypoint
                      ? {
                          nextWaypoint: {
                            x: Math.round(nextWaypoint.x),
                            y: Math.round(nextWaypoint.y),
                          },
                        }
                      : {}),
                  };
                })()
              : null,
          blockedReason: this.fpBlockedReason,
          narration: this.fpNarration,
          narrating: this.fpNarrating,
        };
      })(),
      race: (() => {
        const r = this.raceState;
        if (!r)
          return {
            mode: "idle" as RaceMode,
            available: s.roadKind.size > 0,
            countdownMs: 0,
            timeMs: 0,
            finishedMs: null,
            bestMs: this.bestRaceMs,
            checkpoint: 0,
            checkpoints: 0,
            offTrack: false,
          };
        return {
          mode: r.mode,
          available: true,
          countdownMs: Math.max(0, Math.ceil(r.countdownMs)),
          timeMs: Math.round(r.raceTimeMs),
          finishedMs: r.finishedMs === null ? null : Math.round(r.finishedMs),
          bestMs: this.bestRaceMs === null ? null : Math.round(this.bestRaceMs),
          checkpoint: Math.min(
            r.checkpoints.length,
            Math.max(0, r.nextCheckpoint),
          ),
          checkpoints: r.checkpoints.length,
          offTrack: r.offTrack,
        };
      })(),
      garage: (() => {
        const id = this.operatorCitizenId();
        if (!id) return null;
        const car = loadCar(id);
        const mounted = new Set<string>(validCarParts(car.parts));
        const owned = new Set<string>(ownedCarParts(id));
        // Spec 096 F — the engine bay revealed by the bonnet: the engine + hood sockets, each with the
        // parts that fit it and an install state (occupied / installable / empty). One part per socket.
        const ENGINE_BAY: CarSocket[] = ["engine", "hood"];
        const SOCKET_LABEL: Record<string, string> = {
          engine: "Engine",
          hood: "Hood",
          exhaust: "Exhaust",
          wheels: "Wheels",
          spoiler: "Spoiler",
        };
        const allKinds = Object.keys(CAR_PARTS) as CarPartKind[];
        const stats = deriveStats(car);
        // Spec 096 (PLAN 1.3) — a single headline build rating out of 100 derived from the effective
        // stats: a stock car (all 0.5) reads 50, and every performance part pushes it toward 100.
        const tunePoints = Math.round(
          (stats.topSpeed + stats.acceleration + stats.grip + stats.braking) *
            25,
        );
        return {
          carName: car.name,
          walletK: this.walletK(id),
          stats,
          tunePoints,
          parts: allKinds.map((k) => {
            const d = CAR_PARTS[k];
            return {
              kind: k,
              label: d.label,
              socket: d.socket,
              category: d.category,
              cost: d.cost,
              mounted: mounted.has(k),
              owned: owned.has(k),
              effects: this.partEffects(k),
            };
          }),
          bonnetOpen: this.bonnetOpen,
          engineBay: ENGINE_BAY.map((sock) => {
            const fitting = allKinds.filter(
              (k) => CAR_PARTS[k].socket === sock,
            );
            const mountedKind = fitting.find((k) => mounted.has(k)) ?? null;
            const state: "occupied" | "installable" | "empty" = mountedKind
              ? "occupied"
              : fitting.some((k) => owned.has(k))
                ? "installable"
                : "empty";
            return {
              socket: sock,
              label: SOCKET_LABEL[sock] ?? sock,
              state,
              mounted: mountedKind
                ? { kind: mountedKind, label: CAR_PARTS[mountedKind].label }
                : null,
              parts: fitting.map((k) => ({
                kind: k,
                label: CAR_PARTS[k].label,
                category: CAR_PARTS[k].category,
                cost: CAR_PARTS[k].cost,
                owned: owned.has(k),
                effects: this.partEffects(k),
              })),
            };
          }),
          market: loadCarPartMarket().map((l) => ({
            id: l.id,
            kind: l.kind,
            label: CAR_PARTS[l.kind]?.label ?? l.kind,
            price: l.price,
            sellerName:
              this.citizens.byId(l.sellerCitizenId)?.displayName ?? "a citizen",
            mine: l.sellerCitizenId === id,
          })),
          paint: (
            [
              { channel: "body", label: "Body" },
              { channel: "cabin", label: "Cabin" },
              { channel: "accent", label: "Accent" },
            ] as const
          ).map((p) => ({
            channel: p.channel,
            label: p.label,
            current: car.paint[p.channel],
            options: PAINT_PALETTES[p.channel],
          })),
        };
      })(),
      // Spec 097 R4 — count avatars standing at the hilltop Rally Point (the race rendezvous). Live and
      // deterministic from positions; the first-person operator avatar is one of these citizens. R5 will
      // gate a Join Race offer on present >= 2. Bar-seat presence is the model (proximity within ~1.5).
      rally: (() => {
        const p = this.rallyPresence();
        if (!p) return null;
        return {
          x: p.x,
          y: p.y,
          present: p.present,
          ready: p.present >= 2 && this.raceState === null,
          presentCitizens: p.presentCitizens,
        };
      })(),
      neighborhood: (() => {
        const lots = this.neighborhood.lots.map((l) => {
          const price = this.plotPriceK(l); // spec 085 — Infinity for reserved founder plots
          const scopedOwner = playerScopedOwner(l.ownerCitizenId);
          return {
            id: l.id,
            built: l.built,
            owner: scopedOwner.owner,
            ownerId: scopedOwner.ownerId,
            occupied: !!l.ownerCitizenId,
            reserved: !!l.reservedFor, // spec 078 — founder plots show a nameplate and hide demolish/evict
            price: Number.isFinite(price) ? price : null, // ₭ — null = not for sale
            priceZar: Number.isFinite(price)
              ? kookToZar(price, COLONY.economy.land)
              : null,
            // null = the open primary neighbourhood; a key = a satellite hamlet that may be private
            // (the Buy button checks access against the backend before completing the purchase).
            neighbourhoodKey: l.neighborhoodKey ?? null,
          };
        });
        // The crew always builds — canAfford only colours the hint (stockpile vs sourced off-island).
        const cost = COLONY.build.matNeighborHouse;
        const canAfford = s.materials >= cost;
        const buildHint = this.playerView
          ? "The build crew handles the home build privately for this resident."
          : canAfford
            ? `The build crew raises the house — ${cost} materials from the stockpile`
            : `The build crew raises the house — the stockpile is short (${s.materials}/${cost}) so the crew sources the rest off-island`;
        return {
          lots,
          free: lots.filter((l) => !l.occupied).length,
          built: lots.filter((l) => l.built).length,
          houseCost: cost,
          canAfford: this.playerView ? true : canAfford,
          buildHint,
        };
      })(),
      commerce: (() => {
        // Spec 079 P0 — the commercial district readout: surveyed shop plots, their ₭ + ZAR price by
        // kind, and how many are still free. The buy/build economy fills ownerCitizenId + built.
        const parcels = (this.commercialDistrict?.parcels ?? []).map((p) => {
          const price = this.shopPriceK(p.kind);
          const scopedOwner = playerScopedOwner(p.ownerCitizenId);
          return {
            id: p.id,
            kind: p.kind,
            price,
            priceZar: kookToZar(price, COLONY.economy.land),
            built: p.built,
            owner: scopedOwner.owner,
          };
        });
        const byKind = { kiosk: 0, store: 0, showroom: 0 };
        for (const p of parcels) byKind[p.kind]++;
        // Spec 079 P1 — the Buy action's gate: the cheapest free shop + whether any shopless citizen
        // can afford it (so the button enables only when a real claim is possible).
        const cheap = this.cheapestFreeShop();
        const cheapest = cheap
          ? { kind: cheap.kind, price: this.shopPriceK(cheap.kind) }
          : null;
        const owners = new Set(
          (this.commercialDistrict?.parcels ?? [])
            .filter((p) => p.ownerCitizenId)
            .map((p) => p.ownerCitizenId!),
        );
        const richestShopless = Math.max(
          0,
          ...this.citizens
            .list()
            .filter((c) => !owners.has(c.id))
            .map((c) => this.walletK(c.id)),
        );
        const canClaim = this.playerView
          ? !!cheapest &&
            !!playerViewerId &&
            !owners.has(playerViewerId) &&
            this.walletK(playerViewerId) >= cheapest.price
          : !!cheapest && richestShopless >= cheapest.price;
        // free is counted off the underlying ownerCitizenId (not the display-name owner, which would
        // read free for a ghost/removed owner) so it always agrees with cheapestFreeShop.
        const free = (this.commercialDistrict?.parcels ?? []).filter(
          (p) => !p.ownerCitizenId,
        ).length;
        return {
          plots: parcels.length,
          free,
          byKind,
          canClaim,
          cheapest,
          parcels,
        };
      })(),
      radio: this.radio,
      courier: (() => {
        // Spec 016 — the Kookerverse Courier: rotate through the colony's currently-true headlines.
        const on = courierAvailable(s);
        const lines = on ? colonyHeadlines(s) : [];
        return {
          on,
          headline: lines.length
            ? lines[Math.floor(s.clock.totalMinutes / 15) % lines.length]!
            : "",
        };
      })(),
      tv: this.tv,
      zonesVisible: this.zonesVisible,
      name: s.name,
      biome: BIOME_LABEL[s.terrain.biome[li]!] ?? "Unknown",
      view: this.view,
      preset: this.preset,
    };
  }
}
