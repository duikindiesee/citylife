// Colony (v2) tunables. The planet, the seed, the early power loop.
export const COLONY = {
  world: {
    size: 192, // heightfield resolution AND region width in world units (1 cell = 1 unit)
    heightScale: 17, // world-units of relief from sea level to highest peak
    seaLevel: 0.34, // normalised elevation below which is ocean
    planetRadius: 1500, // the "ball" the flat region sits on (apex at y=0)
    coastSearch: 7, // how far a landing site may be from water and still count as coastal
    rivers: 6,
    noise: {
      elevFreq: 2.6,
      elevOctaves: 5,
      mountainFreq: 3.1,
      moistFreq: 1.7,
      moistOctaves: 4,
    },
  },
  time: {
    stepsPerSec: 6, // physics ticks/sec (kept high so motion stays smooth)
    simMinPerStep: 1.5, // sim-minutes per tick — slowed so a sim-day is ~160 real sec at 1x (use 2x/5x)
    dayStartHour: 6,
    dayEndHour: 20,
  },
  power: {
    solarPeakW: 4.5, // peak solar output at noon
    baseLoadW: 1.1, // caravan idle draw
    batteryCapacityWh: 80,
    batteryStartWh: 44,
  },
  seed: {
    colonists: 2,
    name: 'Landing One',
  },
  build: {
    treasuryStart: 24000,
    habitatCost: 1500,
    roadCostPerCell: 35,
    buildTimeHours: 5, // sim-hours to construct one habitat
    growIntervalHours: 8, // colony starts a new build this often (slower, more deliberate growth)
    maxBuildings: 60,
    residentsPerHabitat: 3,
    powerLoadPerHabitat: 0.5,
    growRadius: 22, // cells from the landing the colony will expand into
    solarFarmCost: 2600,
    solarFarmOutput: 9, // kW peak generation
    solarFarmBuildHours: 4,
    powerHeadroom: 0.72, // build a farm when load exceeds this fraction of peak supply
    // workplaces (commercial / industrial) — create jobs
    commercialCost: 1800,
    industrialCost: 2000,
    jobsPerCommercial: 4,
    jobsPerIndustrial: 5,
    commercialLoad: 0.6,
    industrialLoad: 0.9,
    workplaceBuildHours: 5,
    jobDeficitThreshold: 5, // build a workplace when unemployment exceeds this
    // Materials + labour economy (spec 001): construction consumes materials and reserves a crew of
    // free colonists. No build starts without both — so buildings no longer pop up on a bare timer.
    materialsStart: 40, // dropship stockpile; later produced by extraction (quarry/mine)
    matHabitat: 6,
    matCommercial: 8,
    matIndustrial: 10,
    matSolar: 5,
    crewHabitat: 2,
    crewWork: 3,
    crewSolar: 2,
    // Extraction (spec 002): a mine is the cheapest build (so a low-supply colony can still raise it)
    // and produces materials while staffed; output scales with how staffed the colony is.
    matMine: 4,
    crewMine: 2,
    mineCost: 1200,
    mineWorkers: 6, // employment slots; full output needs all filled
    mineOutputPerDay: 5, // materials/day at full staffing
    mineBuildHours: 5,
    materialsLowThreshold: 16, // build a mine when the stockpile drops below this
    // Workshops (spec 003): refine surplus materials into components (2:1) while staffed.
    matWorkshop: 10,
    crewWorkshop: 3,
    workshopCost: 1600,
    workshopWorkers: 5,
    workshopMaterialsIn: 4, // materials/day consumed at full staffing
    workshopComponentsOut: 2, // components/day produced at full staffing (2:1 ratio)
    materialsSurplus: 30, // raise a workshop to refine once the stockpile exceeds this
    // Population (spec 004): settlers immigrate to fill vacant housing when liveable; leave if power dies.
    immigrationPerDay: 6,
    emigrationPerDay: 4,
    // Water Hub (spec 005): first service + first component sink. Waters habitats within range.
    matWaterHub: 6,
    compWaterHub: 8, // components consumed to build (the sink)
    crewWaterHub: 3,
    waterHubCost: 1400,
    waterHubWorkers: 1,
    waterHubRadius: 7, // cells; habitats within this of a hub are watered
    waterHubMaintCompPerDay: 0.5, // ongoing component maintenance
    // Skyfarm Greenhouse (spec 007): food production; output boosted near a Water Hub.
    matGreenhouse: 14,
    compGreenhouse: 12,
    crewGreenhouse: 3,
    greenhouseCost: 1800,
    greenhouseWorkers: 2,
    greenhouseFoodPerDay: 6, // food/day at full staffing
    greenhouseWaterBoost: 1.5, // x output when within a Water Hub radius
    foodPerColonistPerDay: 0.4, // each colonist eats this much per day
    // Ration Depot (spec 008): distribution — carries food from the stockpile to homes in reach.
    matDepot: 12,
    compDepot: 10,
    crewDepot: 3,
    depotCost: 1500,
    depotWorkers: 2,
    rationDepotRadius: 8, // cells; habitats within this of a depot are provisioned
    rationDepotHomes: 8, // max homes one depot can serve
    depotMaintCompPerDay: 1, // ongoing component maintenance
    // Housing evolution (spec 006): homes upgrade tiers when watered + supplied with components.
    housingTierBonus: [0, 2, 5], // capacity ADDED at tier 1 / 2 / 3 (a residents-3 home → 3 / 5 / 8)
    housingUpgradeCost: 3, // components consumed per tier-up — the 2nd component sink
    housingUpgradeIntervalHours: 12, // a watered, supplied home upgrades at most this often
    housingDevolveGraceHours: 24, // an unwatered home steps down a tier after this long dry
    // First Aid Clinic (spec 009): health service — sick workers in uncovered homes produce less.
    matClinic: 14,
    compClinic: 10,
    crewClinic: 3,
    clinicCost: 1600,
    clinicWorkers: 2,
    clinicRadius: 8, // cells; habitats within this of a clinic are kept healthy
    clinicMaintCompPerDay: 1, // ongoing component (medicine) maintenance
    // Holo-Theatre (spec 010): culture service — a cultured colony draws settlers faster.
    matTheatre: 16,
    compTheatre: 14,
    crewTheatre: 3,
    theatreCost: 2200,
    theatreWorkers: 2,
    theatreRadius: 8, // cells; habitats within this of a theatre are cultured
    theatreMaintCompPerDay: 1.5, // ongoing component (media) maintenance — the steepest sink
    cultureDesirabilityBonus: 0.4, // up to +40% immigration at full culture coverage
    theatreReelsPerDay: 0.5, // spec 014 — reels each theatre burns as show media per day
    cultureStarvedFactor: 0.5, // spec 014 — culture bonus multiplier when theatres have run out of reels
    // Civic Pulse Survey Office (spec 011): build + staff to unlock the liveability overlay.
    matSurvey: 18,
    compSurvey: 12,
    crewSurvey: 3,
    surveyCost: 2400,
    surveyWorkers: 2,
    surveyMaintMatPerDay: 1, // sensor / survey-crew upkeep (materials)
    // Skybridge Exchange (spec 012): trade — export surplus goods to neighbouring colonies for treasury.
    matExchange: 16,
    compExchange: 12,
    crewExchange: 3,
    exchangeCost: 2000,
    exchangeWorkers: 2,
    tradeComponentReserve: 20, // keep at least this many components before any are exported
    tradeComponentPrice: 40, // $ earned per exported component
    tradeComponentCapPerDay: 10, // max components one staffed exchange ships per day
    tradeFoodReserve: 30,
    tradeFoodPrice: 12,
    tradeFoodCapPerDay: 15,
    // Reel Foundry (spec 013): refine components into reels, a luxury good the Exchange exports at a premium.
    matFoundry: 16,
    compFoundry: 12,
    crewFoundry: 3,
    foundryCost: 2200,
    foundryWorkers: 2,
    foundryComponentsIn: 2, // components/day consumed at full staffing
    foundryReelsOut: 1, // reels/day produced at full staffing (2:1)
    reelReserve: 2, // keep at least this many reels before exporting
    reelPrice: 120, // $ earned per exported reel (vs $40 for a raw component)
    reelCapPerDay: 6, // max reels one staffed exchange ships per day
    // Broadcast Mast / Kookerverse Courier (spec 016): the colony's own news radio.
    matMast: 16,
    compMast: 12,
    crewMast: 3,
    mastCost: 1800,
    mastWorkers: 2,
    // Brownout Priority Grid (spec 017): an under-powered colony slows its heavy industry.
    brownoutBatteryThreshold: 0.25, // below this battery %, an over-loaded colony browns out
    brownoutProductionFactor: 0.5, // industry output (mines/workshops/foundries/greenhouses) during a brownout
    // Battery Shed (spec 018): buffer buildings that fatten the colony's battery — built from reels.
    matBattery: 10,
    compBattery: 12,
    reelBattery: 3, // luxury reels consumed to build one (reels find a third home: the grid)
    crewBattery: 3,
    batteryCost: 1500,
    batteryShedCapWh: 40, // Wh added to the colony's battery capacity per shed (base cap is 80)
    batteryMaintCompPerDay: 1, // upkeep
    // Smog Drift + Air Scrubber Garden (spec 019): industry fouls nearby homes; gardens clear the air.
    smogRadius: 6, // homes within this of a mine/foundry breathe smog (unless a scrubber covers them)
    scrubberRadius: 8, // an Air Scrubber Garden clears smog within this radius
    pollutionPenalty: 0.3, // liveability a polluted home loses
    matScrubber: 12,
    compScrubber: 8,
    crewScrubber: 3,
    scrubberCost: 1600,
    scrubberWorkers: 2,
    scrubberMaintCompPerDay: 1,
    // Skillhouse Academy (spec 020): trains skilled workers; the advanced trades need them.
    matAcademy: 16,
    compAcademy: 10,
    crewAcademy: 3,
    academyCost: 1800,
    academyWorkers: 2,
    academyTrainPerDay: 2, // skilled workers trained per day per staffed academy
    skilledPerAdvanced: 3, // skilled workers one workshop/foundry wants for full output
    // Skybridge Transit Depot (spec 021): commute capacity; a congested colony slows ALL its production.
    matTransit: 16,
    compTransit: 10,
    crewTransit: 3,
    transitCost: 1800,
    transitWorkers: 2,
    transitBaseCapacity: 8, // workers the founders' walkways carry before any depots
    transitPerDepot: 10, // commute capacity each Transit Depot adds
    transitCongestedFloor: 0.6, // production floor when fully congested
    // Maintenance Sheds (spec 022): working buildings wear as they run; a staffed shed repairs those in
    // range. Past the healthy threshold a worn building loses output — the first mechanic where neglect
    // degrades what you already built. Wear is PER-BUILDING (unlike the colony-wide factors).
    matMaintShed: 12,
    compMaintShed: 8,
    crewMaintShed: 3,
    maintShedCost: 1600,
    maintShedWorkers: 2,
    maintRadius: 8, // cells; a staffed shed repairs every working building within this
    maintShedMaintCompPerDay: 1, // spare-parts upkeep (components)
    wearPerDay: 0.06, // wear a working building accrues per day (fresh → fully worn in ~16 days unserved)
    repairPerDay: 0.5, // wear a covered building sheds per day (net stays pinned near 0 under a shed)
    wearHealthyThreshold: 0.5, // below this a building runs at full output (grace period; new machines)
    maintFloor: 0.25, // most-worn output floor — a worn-out building barely limps until repaired
    wearBuildThreshold: 0.35, // raise a shed once a working building wears past this (before the penalty bites)
    maintShedCovers: 6, // cap: at most ~1 shed per this many working buildings
    // Storehouse Platforms (spec 023): finite storage. Each resource has a cap = a generous founders' hold +
    // what the Storehouse Platforms add; production/trade past a cap is clamped and the overflow is LOST.
    // Bases are deliberately generous so the founding economy is never strangled — the cap bites only at a
    // genuine industrial surplus (e.g. a brownout stalls the workshops while the mines keep digging).
    storeBaseMaterials: 220,
    storeBaseComponents: 150,
    storeBaseFood: 160,
    storeBaseReels: 70,
    storePerMaterials: 120, // capacity one Storehouse Platform adds, per resource
    storePerComponents: 90,
    storePerFood: 90,
    storePerReels: 50,
    matStorehouse: 18,
    compStorehouse: 10,
    crewStorehouse: 3,
    storehouseCost: 1800,
    storehouseWorkers: 2, // stock-keepers: log, stack, guard, rotate
    storehouseMaintCompPerDay: 0.5, // logistics upkeep
    storeBuildThreshold: 0.85, // raise a platform once any stockpile passes this fraction of its cap
    maxStorehouses: 6,
    // Emergency Bellhouse (spec 024): a worn, stressed building can suffer a sudden incident that pauses it; a
    // staffed Bellhouse dispatches crews to resolve it, or the building is left damaged and stored goods are lost.
    // Hazard is gated on wear AND colony stress (brownout/congestion) so normal play stays incident-free.
    matBellhouse: 16,
    compBellhouse: 12,
    reelBellhouse: 2,
    crewBellhouse: 3,
    bellhouseCost: 2200,
    bellhouseWorkers: 2,
    bellhouseCrews: 2, // concurrent incidents one staffed Bellhouse can answer
    bellhouseMaintCompPerDay: 0.5, // foam/alarm-drone upkeep
    maxBellhouses: 3,
    hazardWearThreshold: 0.7, // only buildings worn past this can catch — keeps the founding economy incident-free
    hazardBasePerDay: 0.6, // hazard units/day at full wear while the colony is stressed
    hazardTrigger: 1.0, // hazard a building accumulates before an incident strikes (~2 days of sustained worn+stress)
    incidentMin: 240, // sim-minutes an incident runs before it resolves (crew in time) or hits its consequence
    incidentResolveWearBump: 0.05, // wear a resolved building carries away from the scare
    incidentGoodsLoss: 0.25, // fraction of a stored resource destroyed when an incident goes unanswered
    // Levy Office (spec 025): the colony's first fiscal lever. A staffed office lets the council set a household
    // levy rate; income and immigration desirability scale by it. Inert (factors 1.0) until an office is staffed,
    // so the default (normal / no office) leaves the founding economy exactly as before.
    matLevy: 14,
    compLevy: 10,
    reelLevy: 2,
    crewLevy: 3,
    levyOfficeCost: 2000,
    levyWorkers: 2, // clerks
    levyMaintCompPerDay: 0.5, // ledger supply
    levyIncomeLow: 0.65, // income multiplier at a low levy (normal is 1.0)
    levyIncomeHigh: 1.5, // income multiplier at a high levy
    levyDesireLow: 1.25, // immigration desirability multiplier at a low levy (gentle dues draw settlers)
    levyDesireHigh: 0.7, // immigration desirability multiplier at a high levy (a squeeze repels them)
    // Fever Watch (spec 026): the colony's first population-wide dynamic. An outbreak spreads while the colony is in
    // compounding bad shape (low health AND crowding AND an environmental stressor — smog or brownout) and is
    // contained by a staffed Fever Watch Post. Pressure is a PRODUCT of all three, so a well-kept colony never
    // sees an outbreak and existing play is unaffected.
    matFeverWatch: 12,
    compFeverWatch: 6,
    crewFeverWatch: 3,
    feverWatchCost: 1900,
    feverWatchWorkers: 2, // medics + watch aides
    feverWatchMaintCompPerDay: 0.5, // medical supply
    feverCrowdThreshold: 0.85, // housing occupancy above which crowding starts feeding the fever
    feverSpreadPerDay: 0.4, // outbreak growth per day at full pressure (uncontained)
    feverRecoverPerDay: 0.15, // natural recovery per day when pressure eases (no watch)
    feverContainPerDay: 0.5, // recovery per day while a staffed Fever Watch Post is on it
    feverMax: 0.8, // cap on the share of people unwell
    feverPenalty: 0.6, // production penalty coefficient at a full outbreak (before clinic relief)
    feverClinicRelief: 0.5, // clinics cut up to this fraction of the severity
    feverFloor: 0.4, // production floor under a maxed, unmitigated outbreak
    feverEmigrationWeight: 0.5, // how much a full outbreak drags immigration desirability down
    feverBuildThreshold: 0.08, // raise a Fever Watch Post once the outbreak climbs past this
    maxFeverWatch: 2,
    // Housewares Market (spec 027): carries finished manufactured wares to homes — components as everyday wares,
    // reels as luxury wares. The top housing tier needs luxury wares delivered, so the goods chains finally drive
    // how families live. A new demand sink: the market draws down components (and reels) as it delivers.
    matMarket: 12,
    compMarket: 6,
    crewMarket: 3,
    marketCost: 1800,
    marketWorkers: 2, // clerks + porters
    marketRadius: 8, // cells; homes within this of a market receive wares
    marketHomes: 8, // homes one market can serve (caps the coverage fraction)
    marketWaresCompPerDay: 1, // components delivered as everyday wares, per market per day
    marketLuxuryReelsPerDay: 0.3, // reels delivered as luxury wares, per market per day
    waresDesirabilityBonus: 0.2, // up to +20% immigration when homes are well stocked with wares
    // Ward Post (spec 028): social order. Unrest rises from compounding hardship — high unemployment AND a squeeze
    // (a hard levy or a brownout) — and brings petty disorder: refused levy income, slowed production, fewer settlers.
    // A staffed Ward Post drives it back down. Gated so a well-run, employed colony at a normal levy stays orderly.
    matWard: 10,
    compWard: 6,
    crewWard: 3,
    wardCost: 1800,
    wardWorkers: 2, // wardens
    wardMaintCompPerDay: 0.5, // patrol supply
    unrestMinPop: 4, // a handful of founders never riots
    unrestJoblessThreshold: 0.4, // jobless fraction above which unemployment starts feeding unrest
    unrestSpreadPerDay: 0.5, // unrest growth per day at full pressure (no ward)
    unrestRecoverPerDay: 0.15, // natural calming per day when the squeeze eases
    wardCalmPerDay: 0.5, // calming per day while a staffed Ward Post patrols
    unrestMax: 0.8, // cap on disorder
    unrestIncomeRefusal: 0.5, // share of income refused at a full outbreak of unrest (tax refusal)
    unrestProductionPenalty: 0.4, // production lost at full unrest (vandalism / slowdowns)
    unrestProductionFloor: 0.5, // production floor under a fully restless colony
    unrestDesirabilityWeight: 0.5, // how much full unrest drags immigration desirability down
    unrestBuildThreshold: 0.08, // raise a Ward Post once unrest climbs past this
    maxWard: 3,
    // Pay Office (spec 029): the colony's wage lever — the other half of the ledger. A staffed office lets the council
    // set a colony-wide wage rate; the colony then pays a payroll scaled by employed workers, and the rate trades off
    // against the levy and unrest. Inert (no payroll, no effect) until an office is staffed and the rate is non-standard.
    matPayOffice: 10,
    compPayOffice: 4,
    reelPayOffice: 1,
    crewPayOffice: 3,
    payOfficeCost: 1900,
    payOfficeWorkers: 2, // payroll clerks
    payOfficeMaintCompPerDay: 0.5, // ledger supply
    wagePerWorkerPerDay: 30, // base payroll per employed worker per day at the standard rate
    wageLowFactor: 0.6, // payroll multiplier at a low wage
    wageGenerousFactor: 1.6, // payroll multiplier at a generous wage
    wageDesireLow: 0.85, // immigration desirability multiplier at a low wage
    wageDesireGenerous: 1.2, // immigration desirability multiplier at a generous wage
    wageGenerousCalmPerDay: 0.2, // extra unrest recovery per day at a generous wage (loyal workers)
    // Civic Feast (spec 030): the colony's first POSITIVE timed event. A staffed Feast Deck lets the council fund a
    // Founding Feast — spend treasury + rations + housewares up front, then for a window of days unrest eases and
    // immigration rises. Inert until a deck is built and a feast is called, so existing play is unaffected.
    matFeast: 12,
    compFeast: 8,
    reelFeast: 2,
    crewFeast: 3,
    feastDeckCost: 2000,
    feastWorkers: 2, // stewards
    feastDeckMaintCompPerDay: 0.5,
    feastTreasuryCost: 300, // credits a Founding Feast spends up front
    feastFoodCost: 20, // rations a feast spends
    feastWaresCost: 6, // housewares (components) a feast spends
    feastDurationDays: 3, // how long a feast's lift lasts
    feastUnrestReliefPerDay: 0.3, // extra unrest calming per day while a feast runs
    feastDesirabilityBonus: 0.25, // +25% immigration desirability while a feast runs
    feastAutoTreasuryMargin: 3, // the colony auto-throws a feast only when treasury exceeds the cost by this much
    feastAutoUnrestThreshold: 0.1, // ...and the people are at least this restless
    maxFeastDeck: 2,
    // Skyflax Line (spec 031): the colony's second production chain. A Flax Skimmer Dock gathers skyflax FIBRE from the
    // rims; a Weavery weaves fibre into LINEN (2:1). The top housing tier needs linen on hand, and clinics consume linen
    // as bandage cloth (more during a fever). Inert until a skimmer/weavery is built, so existing play is unaffected.
    matSkimmer: 8,
    crewSkimmer: 3,
    skimmerCost: 1200,
    skimmerWorkers: 2,
    fibreGenPerDay: 5, // skyflax fibre gathered per staffed dock per day (≈ a mine's rate)
    fibreLowThreshold: 12, // raise a Skimmer Dock when the fibre stockpile drops below this
    matWeavery: 10,
    compWeavery: 4,
    crewWeavery: 3,
    weaveryCost: 1600,
    weaveryWorkers: 2,
    weaveryFibreIn: 4, // fibre/day consumed at full staffing
    weaveryLinenOut: 2, // linen/day produced at full staffing (2:1)
    fibreSurplus: 20, // raise a Weavery to weave once fibre exceeds this
    storeBaseFibre: 120, // storage cap (spec 023) — founders' hold for fibre
    storePerFibre: 80,
    storeBaseLinen: 100, // storage cap for linen
    storePerLinen: 60,
    clinicLinenPerDay: 0.5, // linen a clinic uses as bandage cloth per day
    clinicLinenFeverMult: 3, // ...up to this much more at a full fever outbreak
    maxSkimmer: 2,
    // Kookerverse Liaison Office (spec 032): the colony's first external relationship. A staffed office draws Civic
    // Requests from the Kookerverse (send a quota of a good by a deadline); fulfilling raises Standing, missing lowers
    // it. Standing scales immigration and, when very low, feeds a little unrest. Inert with no office (standing neutral).
    matLiaison: 14,
    compLiaison: 12,
    reelLiaison: 4,
    crewLiaison: 3,
    liaisonCost: 2200,
    liaisonWorkers: 2, // liaison clerks
    liaisonMaintCompPerDay: 0.5,
    requestIntervalDays: 4, // cooldown between Civic Requests
    requestDeadlineDays: 3, // days to fulfil a request before it lapses
    standingStart: 0.5, // neutral standing at founding
    standingReward: 0.15, // standing gained per fulfilled request
    standingPenalty: 0.12, // standing lost per missed request
    standingDriftPerDay: 0.05, // standing drifts back toward neutral with no office
    standingDesireLow: 0.8, // immigration desirability multiplier at zero standing
    standingDesireHigh: 1.2, // ...at full standing (neutral 0.5 maps to 1.0)
    lowStandingThreshold: 0.25, // below this, reputational unrest creeps in
    standingUnrestPerDay: 0.1, // unrest added per day at low standing (with an office)
    reqAmountComponents: 15, // Civic Request quota per good
    reqAmountLinen: 10,
    reqAmountReels: 5,
    reqAmountFood: 20,
    // Horizon Spire (spec 033): the colony's first grand, multi-stage monument. Four stages, each a large bundle of
    // goods + treasury and a reserved crew over a long build. Once all four stand, the payoff is permanent (standing,
    // immigration, unrest, feasts). Opt-in: funded only by a council action or a genuine surplus, so it is inert until
    // the colony chooses to raise it — the founding economy and existing play are unaffected.
    spireStageCount: 4,
    spireStageCrew: 6, // colonists tied up while a stage is under construction
    spireStageBuildHours: 48, // sim-hours to raise one stage (far longer than a normal building)
    spireStartColonists: 18, // the colony auto-funds the Spire only once this established
    spireSurplusMargin: 2, // ...and only when every stage resource is stocked at least this many times over
    spireTreasuryMargin: 5000, // ...and treasury sits at least this far above the stage's treasury cost
    spireStandingMult: 1.5, // when complete: standing earned per fulfilled request × this
    spireImmigrationBonus: 1.15, // when complete: a permanent immigration desirability bonus
    spireUnrestReliefPerDay: 0.1, // when complete: a permanent daily unrest relief (pride in the great work)
    spireStageTreasury: [1000, 1500, 1500, 3000],
    spireStageMaterials: [160, 0, 0, 0],
    spireStageComponents: [80, 220, 170, 160],
    spireStageReels: [0, 60, 50, 100],
    spireStageLinen: [0, 120, 140, 0],
    block: 7, // grid block size (bumped 5→7) so the base spreads out and the city feels less cramped
    maxBlockRadius: 7, // how many blocks out from the landing the colony can spread
    pollutionPerIndustrial: 3,
  },

  economy: {
    incomePerColonistPerDay: 150,
    buildingUpkeepPerDay: 14,
    roadUpkeepPerDay: 0.4,
    pollutionPenaltyScale: 320, // income is dragged down as pollution rises (capped)
  },

  traffic: {
    maxCars: 22,
    carSpeed: 14, // lots per sim-hour
    laneOffset: 0.22, // how far cars sit to the LEFT of their travel direction
    maxWaitSteps: 50, // failsafe so a jammed car eventually proceeds (no deadlock)
  },

  render: {
    seed: 4242,
  },
} as const
