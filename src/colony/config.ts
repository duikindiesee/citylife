// Colony (v2) tunables. The planet, the seed, the early power loop.
export const COLONY = {
  world: {
    // Spec 084 S6 — WORLD v2: ~10x the area (608 = 8x76 for clean terrain chunking). heightScale
    // rises by exactly the same x3.17 as the linear size, so per-cell slope statistics — and with
    // them the buildable-mask thresholds — keep their meaning; noise frequencies stay untouched,
    // so the same landforms simply become 3.17x wider. That IS the roomy feel the operator asked
    // for. Everything here re-baselines the seed-4242 layout in ONE commit (the 084 plan).
    size: 608, // heightfield resolution AND region width in world units (1 cell = 1 unit)
    heightScale: 54, // world-units of relief from sea level to highest peak (54/608 == 17/192)
    seaLevel: 0.34, // normalised elevation below which is ocean
    planetRadius: 4800, // the "ball" the flat region sits on (apex at y=0)
    coastSearch: 12, // how far a landing site may be from water and still count as coastal
    rivers: 18,
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
    name: "Landing One",
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
    growRadius: 48, // cells from the landing the colony will expand into (084 S6 — the old town core of the big world)
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
    // Stormwatch Shelter (spec 034): the colony's first EXTERNAL danger. A Cloudsea Front periodically rolls in from
    // beyond the island; a staffed Stormwatch Shelter braces the colony (and the Spire's Sky Beacon warns earlier), so a
    // braced colony takes far less damage than an unprepared one (spoiled goods + a wear spike). Fronts only begin once
    // the colony is established and arrive on a long interval, so early/short play is calm.
    matStormwatch: 14,
    compStormwatch: 10,
    crewStormwatch: 3,
    stormwatchCost: 1800,
    stormwatchWorkers: 2, // watchkeepers
    stormwatchMaintCompPerDay: 0.5,
    frontFirstDelayDays: 8, // sim-days before the first Cloudsea Front can strike (longer than any short play)
    frontIntervalDays: 6, // days between fronts thereafter
    frontMinColonists: 12, // fronts only threaten an established colony, never the founding crew
    frontWarningMin: 720, // the warning window (sim-min) before a front strikes
    spireBeaconWarnMult: 2, // a complete Sky Beacon (033) lengthens the warning by this much
    frontGoodsLoss: 0.3, // fraction of materials + components spoiled by a full-severity front
    frontWearDamage: 0.4, // wear added to every working building by a full-severity front
    frontBraceFactor: 0.25, // a braced colony (staffed Stormwatch) takes only this much of the damage
    maxStormwatch: 2,
    // Founders' Hall (spec 035): a staffed civic hall that seats the colony's notable founders (the real system-authors)
    // as a Living Roster. While seated it gives the colony a face and a memory — modest, lasting bonuses to immigration,
    // standing and order, plus founder-named Courier headlines. Inert with no Hall, so existing play is unaffected.
    matHall: 18,
    compHall: 12,
    crewHall: 3,
    hallCost: 2400,
    hallWorkers: 3, // 2 clerks + a steward
    hallMaintCompPerDay: 0.5,
    foundersDesirabilityBonus: 1.1, // immigration desirability while the Roster is seated
    foundersUnrestRelief: 0.05, // daily unrest relief from pride in the founders
    foundersStandingMult: 1.1, // standing earned per fulfilled request while the Roster is seated
    // Skybridge Import Office (spec 036): the buying side of trade — spend treasury to land a council-chosen good at a
    // premium over the Exchange sell price, capped by storehouse space and by staffing, so local production stays the backbone.
    matImportOffice: 22,
    compImportOffice: 10,
    crewImportOffice: 4,
    importOfficeCost: 2600,
    importOfficeWorkers: 3,
    importOfficeMaintCompPerDay: 0.5,
    importPerDay: 14, // units/day a fully staffed office lands of the order good
    importPremiumMult: 1.6, // the premium imports carry over the Exchange sell price (the prices below already bake it in)
    importPrice: {
      materials: 24,
      components: 64,
      food: 20,
      linen: 90,
      reels: 192,
    }, // $ per imported unit — a premium over local value / export price (comp 40, food 12, reels 120 on the Exchange)
    // Mooring Shrine (spec 037): a small staffed civic shrine that carries Solace to nearby homes — a new home service that
    // lifts desirability and eases unrest, fed by a trickle of linen. Inert with no staffed shrine, so existing play is unchanged.
    matShrine: 10,
    compShrine: 2,
    crewShrine: 4,
    shrineCost: 1200,
    shrineWorkers: 3,
    shrineRadius: 8, // cells; habitats within this of a staffed shrine are consoled
    shrineHomes: 8, // build ~1 shrine per this many homes
    shrineLinenPerDay: 0.4, // linen burned per shrine per day (prayer flags + memorial wraps)
    solaceDesirabilityBonus: 0.12, // up to +12% immigration at full solace coverage
    solaceCalmPerDay: 0.06, // daily unrest relief at full solace coverage
    solaceStarvedFactor: 0.3, // solace dims to this fraction when the shrine has run out of linen
    // Comptroller's Office (spec 039): the colony's debt desk. Without one the treasury floors at 0 (as the engine clamps it);
    // with a staffed one the colony may run a deficit to a ceiling, accruing interest each payday, with strain past half the ceiling.
    matComptroller: 18,
    compComptroller: 4,
    crewComptroller: 4,
    comptrollerCost: 2400,
    comptrollerWorkers: 3,
    comptrollerMaintCompPerDay: 0.5,
    debtCeiling: 5000, // the treasury may fall to -this while a Comptroller's Office stands
    debtInterestPerPayday: 0.03, // fraction of the outstanding debt added on each income day
    debtUnmanagedMult: 2, // interest doubles while the office is unstaffed and the treasury is negative
    arrearsStrainFraction: 0.5, // debt past this fraction of the ceiling stretches the colony
    arrearsStrainDesirabilityFactor: 0.85, // immigration desirability while under arrears strain (settlers slow)
    arrearsUnrestPerDay: 0.03, // extra daily unrest pressure while under arrears strain
    // Roster Office (spec 038): civic labour administration. Once built + staffed it unlocks labour priority by sector —
    // under a shortage (free colonists < open jobs) it fills high-priority sectors first. 'balanced'/no-office = today's even split.
    matRoster: 14,
    compRoster: 4,
    crewRoster: 4,
    rosterCost: 2000,
    rosterWorkers: 3,
    rosterMaintCompPerDay: 0.5,
    // Departure Pressure (spec 041): the flip side of immigration. A colony-wide pressure rises only when liveability stays
    // below the floor (or the colony is deep in arrears) for days, and drains fast when homes are served again. At the
    // threshold a household leaves — population falls toward the founding seed and standing dips. Inert while homes are served.
    departureLiveabilityFloor: 0.4, // distress only builds while colony liveability is below this
    departureRisePerDay: 0.15, // pressure gained per day at full distress (so ~7 days of total failure before anyone leaves)
    departureDrainPerDay: 0.4, // pressure shed per day once homes are decently served (recovery is the default)
    departureArrearsDistress: 0.5, // distress floor contributed by Treasury Arrears strain alone (missed wages)
    departureHouseholdSize: 4, // colonists that leave each time the threshold is crossed
    exodusStandingHit: 0.04, // one-off Kookerverse standing dip when a household departs (the wider world notices)
    // Little Schoolroom (spec 042): a small staffed home-service building that schools nearby homes — a new Education
    // coverage that lifts desirability and lets the Skillhouse Academy train skilled workers faster. Inert with no staffed school.
    matSchool: 18,
    crewSchool: 4,
    schoolCost: 1400,
    schoolWorkers: 3,
    schoolRadius: 8, // cells; habitats within this of a staffed school are schooled
    schoolHomes: 8, // build ~1 school per this many homes
    educationDesirabilityBonus: 0.1, // up to +10% immigration at full education coverage
    educationAcademyBonus: 0.5, // the Academy trains up to +50% faster at full education coverage
    // Census Hall (spec 040): a staffed civic hall that reads the whole colony into one Prosperity score (0..1) + five ranks,
    // from liveability, housing tiers, employment, Kookerverse standing and Treasury solvency. At high ranks it draws settlers
    // faster and flags a milestone. Reads only existing signals; inert with no staffed Hall.
    matCensus: 20,
    compCensus: 4,
    crewCensus: 5,
    censusCost: 2200,
    censusWorkers: 3,
    censusMaintCompPerDay: 0.4,
    prospLiveabilityWeight: 0.3, // weights blend to a 0..1 Prosperity score
    prospTierWeight: 0.2,
    prospEmploymentWeight: 0.2,
    prospStandingWeight: 0.15,
    prospSolvencyWeight: 0.15,
    prosperityImmigrationBonus: 0.2, // immigration lift = this × max(0, score - floor) while a Census Hall stands
    prosperityBonusFloor: 0.6, // no immigration lift below this prosperity
    // Skybound Folios (spec 044): the colony's signature finished export. A staffed Folio House binds 1 reel + 1 linen into
    // 1 folio, which the Exchange sells well above either input. A new stored good; inert with no Folio House.
    matFolio: 18,
    compFolio: 6,
    crewFolio: 6,
    folioCost: 2600,
    folioWorkers: 4,
    foliosPerDay: 3, // folios a fully-staffed Folio House binds per day (slow, exacting work)
    folioPrice: 320, // $ per folio on the Exchange — well above reels (120) or linen
    folioReserve: 5, // keep at least this many folios before any are exported
    folioCapPerDay: 8, // folios an Exchange can ship per day
    storeBaseFolios: 60, // base folio storage; raised by Storehouse Platforms (023)
    storePerFolios: 60,
    // Wind-Shear Turbine Mast (spec 045): a buildable high-output generator that feeds the brownout grid (017) like solar,
    // so generation scales with the colony. Steady output (no daylight), staffing-scaled. Inert with no mast.
    matTurbine: 40,
    compTurbine: 12,
    crewTurbine: 8,
    turbineCost: 3000,
    turbineWorkers: 4,
    turbineOutputW: 4, // steady peak watts a fully-staffed mast adds to the grid (~ one solar peak of 4.5)
    maxTurbines: 6,
    // Mist Condenser Cistern (spec 046): makes water a real stored resource. A staffed cistern condenses cloud-mist into the
    // tank (consuming grid power); once any cistern stands, Water Hubs draw the tank, and a dry tank weakens coverage + adds
    // fever/unrest. Inert with no cistern (the supply factor is 1, so water stays the free coverage it is today).
    matCistern: 18,
    compCistern: 4,
    crewCistern: 4,
    cisternCost: 1800,
    cisternWorkers: 3,
    cisternTankCap: 100, // water units one cistern's tank holds
    cisternFillPerDay: 50, // water a fully-staffed cistern condenses per day (comfortably supplies a colony)
    cisternPowerLoad: 0.8, // heavy grid draw per cistern (competes on the brownout grid)
    waterDrawPerHomePerDay: 0.5, // water each home draws from the tank per day
    waterComfortBuffer: 12, // tank above this → full water coverage; below → coverage fades toward the floor
    waterSupplyFloor: 0.3, // water coverage floor when the tank is bone dry (homes scrape by)
    dryTankFeverPerDay: 0.04, // daily fever pressure while the tank is dry and cisterns stand
    dryTankUnrestPerDay: 0.05, // daily unrest pressure while the tank is dry
    cisternStartCharge: 0.6, // a freshly built cistern starts its tank this full (no construction-day water crash)
    // Tool Crib (spec 047): components finally get a recurring job. A staffed crib turns components into tool-kits; once any crib
    // stands, the tooled workplaces (mine, workshop, skyfarm, maintenance shed, turbine) draw tool-kits as they work, and a dry
    // tool rack weakens their output together toward the floor. Inert with no crib (the tool factor is 1, so output is as today).
    matToolCrib: 18,
    compToolCrib: 6,
    crewToolCrib: 2,
    toolCribCost: 1400,
    toolCribWorkers: 2,
    toolCribPowerLoad: 0.6, // small bench load (a brownout slows tool-kit output)
    toolStockCap: 120, // tool-kits the colony rack holds
    toolCribComponentsPerDay: 2, // components one staffed crib draws per day
    toolKitsPerComponent: 4, // Mara Venn's recipe: 1 component becomes 4 tool-kits
    toolUsePerWorkplacePerDay: 0.6, // tool-kits each working tooled workplace consumes per day
    toolComfortBuffer: 16, // stock above this → full output; below → output fades toward the floor
    toolFloor: 0.5, // output floor for tooled workplaces when the rack is bone dry (bare-handed half-speed)
    toolStartCharge: 0.6, // a freshly built crib starts its rack this full (no construction-day output crash)
    toolCribSpareComponents: 8, // only auto-build a crib when this many components sit spare beyond its build cost
    // Seed Loft (spec 048): food finally needs an input. A staffed loft turns 2 food + 1 water into 3 seed-stock; once any loft
    // stands, the skyfarms draw seed as they grow, and a dry seed bin halves their yield together toward the floor. Inert with no
    // loft (the seed factor is 1, so food grows as today). The water input is soft — drawn from the tank only when cisterns stand.
    matSeedLoft: 8,
    compSeedLoft: 4,
    crewSeedLoft: 2,
    seedLoftCost: 1200,
    seedLoftWorkers: 2,
    seedLoftPowerLoad: 0.3, // light drying-rack load (a brownout slows it)
    seedStockCap: 80, // seed-stock the colony bin holds
    seedLoftBatchesPerDay: 2, // batches one staffed loft dries per day
    seedLoftFoodPerBatch: 2, // food saved into each batch
    seedLoftWaterPerBatch: 1, // water per batch (soft — only drawn when cisterns stand)
    seedPerBatch: 3, // Mara Venn's recipe: each batch yields 3 seed-stock
    seedUsePerFarmPerDay: 0.8, // seed each working skyfarm draws per day
    seedComfortBuffer: 12, // bin above this → full yield; below → yield fades toward the floor
    seedFloor: 0.5, // skyfarm yield floor when the seed bin is bone dry (thin seed, thin harvest)
    seedStartCharge: 0.6, // a freshly built loft starts its bin this full (no construction-day harvest crash)
    seedLoftFoodSurplus: 60, // only auto-build a loft when food sits at least this spare (never tips a marginal colony)
    seedLoftSpareComponents: 6, // and this many components beyond the loft build cost
    // Settler Confidence (spec 049): immigration follows the colony's visible reputation, not just its vacancies. A Confidence
    // rating in [0,1] is read from distress signals; a healthy colony sits at the plateau (factor 1, arrivals as today), deep
    // distress slows arrivals and terrible distress halts them. Survival shortfalls weigh LIGHT (a frontier still draws people, and
    // water/food already gate immigration through desirability), while civic failure — unrest, arrears, stingy wages — weighs heavy
    // and is what actually scares settlers off. Calibrated so any reasonably healthy colony stays at or above the plateau.
    confHungerWeight: 0.1, // homes going unfed knock this much off Confidence
    confThirstWeight: 0.1, // homes going unwatered knock this much off
    confUnrestWeight: 0.35, // disorder is the heaviest deterrent
    confArrearsWeight: 0.25, // a colony in debt strain looks risky
    confWageWeight: 0.2, // a stingy Pay Office dents the colony's name
    confPlateau: 0.7, // Confidence at or above this → full-speed immigration (exactly as today)
    confStop: 0.25, // Confidence at or below this → immigration halts while beds sit empty
    // Household Births (spec 050): the colony can finally grow its own. A mid-tier-or-better home on a fed, watered, calm deck
    // slowly raises a child; children cost half a colonist of food and give no labour until they mature into colonists on a housing
    // vacancy. Neglect drains the pool. Inert until a tier-2 home stands under good conditions (so tier-1/young colonies are
    // unchanged), and slow enough — measured in colony-months — that short runs never trip a birth.
    birthMinTier: 2, // a home must be at least this tier to raise a child (survival before family)
    birthRatePerHomePerDay: 0.02, // children a qualifying home adds per day at full stability (~one child per ~50 days)
    childDependentLoad: 0.5, // a child eats this fraction of a colonist's rations (and gives no labour)
    childMatureFraction: 0.025, // fraction of the pool that grows up per day when there is housing room (~40 days to adulthood)
    childNeglectDrainPerDay: 0.05, // fraction of the pool lost per day while the colony is neglected
    childrenMaxFraction: 0.5, // the children pool is capped at this fraction of the workforce (dependents never dwarf the hands)
    birthCalmUnrest: 0.3, // unrest at or above this zeroes the calm score (a disorderly deck does not raise children)
    birthNeglectStability: 0.5, // below this combined stability the pool drains instead of growing/maturing
    block: 7, // grid block size (bumped 5→7) so the base spreads out and the city feels less cramped
    maxBlockRadius: 10, // how many blocks out from the landing the colony can spread (084 S6 — room on the big world, before any Outer Claim)
    // Survey Camp (spec 051): the colony can finally claim new ground. A staffed camp runs Outer Claims, each raising the effective
    // build radius by one deck-ring onto existing terrain (the cell-finder already skips non-buildable land). Inert with no camp
    // (effective radius == maxBlockRadius), capped at maxClaims so the frontier never runs past the island.
    matSurveyCamp: 20,
    compSurveyCamp: 6,
    crewSurveyCamp: 4,
    surveyCampCost: 1600,
    surveyCampWorkers: 4, // 2 surveyors + 2 deck-wrights, tied to the boundary while they work
    surveyCampPowerLoad: 0.3,
    maxClaims: 4, // most extra deck-rings the colony may claim (base 7 → up to 11)
    claimWorkDays: 6, // colony-days a fully-staffed camp takes to complete one Outer Claim
    matPerClaim: 40, // materials spent to lay each new boundary ring
    compPerClaim: 10, // components spent per claim
    // Vein Ledger (spec 052): ore extraction is finite per site. Each mine starts on a vein worth ~12 colony-months of full staffed
    // output; while staffed it ticks down, and the mine fades by bands (1.0 / 0.8 / 0.6 / 0.4) to a permanent 0.25 floor as it runs
    // dry. Inert until a vein actually thins (a fresh or unrecorded mine reads full), so the materials economy is unchanged early.
    veinLifeDays: 360, // days of full-staffed digging a fresh mine's vein holds (output stays 100% until half is gone, ~6 months)
    veinFloor: 0.25, // an exhausted vein still yields this fraction — a poor pit, never a dead one
    // Founding Calendar (spec 053): the colony learns to count its years. A staffed Calendar Office surfaces the colony's age, and
    // every year-turn (Founders' Day) it eases unrest a little — free and automatic, unlike the council-funded Civic Feast (030).
    // Inert with no office; the lift is small and only annual, so it can never harm anything.
    matCalendar: 10,
    compCalendar: 3,
    reelCalendar: 2, // bound almanacs and printed ledgers — Mara Vell's fine cloth and paper
    crewCalendar: 1,
    calendarCost: 900,
    calendarWorkers: 1, // one clerk keeps the calendar
    calendarPowerLoad: 0.2,
    daysPerYear: 360, // 12 months of 30 days — the colony's year
    daysPerMonth: 30,
    foundersDayUnrestRelief: 0.08, // the small, free morale lift a staffed office gives when a year turns
    // Mild Seasons (spec 054): once a Calendar Office keeps the almanac, skyfarm yield shifts gently by month. The four bands below
    // are weighted (4 + 2 + 2 + 4 months) so the twelve monthly multipliers average to EXACTLY 1.0 — the annual food total is
    // unchanged, the season only moves output around within the year — and they stay in [0.90, 1.10] so seasons can never starve.
    bloomYield: 1.1, // months 1-4 — the growing season
    highsunYield: 1.05, // months 5-6
    greyYield: 0.95, // months 7-8
    frostYield: 0.9, // months 9-12 — the lean season (put food by in the storehouses)
    // Seasonal Solar Angling (spec 057): once the colony keeps a calendar, SOLAR output follows the year too, peaking in Highsun and
    // dipping in Frost. The 4+2+2+4 month weights average to EXACTLY 1.0 (annual solar yield unchanged — redistributed, not reduced),
    // bounded to [0.90, 1.15]. Wind-shear turbines (045) are unaffected. Inert with no Calendar Office (solar flat all year as today).
    solarBloom: 1.05, // months 1-4
    solarHighsun: 1.15, // months 5-6 — the long, strong days
    solarGrey: 0.95, // months 7-8
    solarFrost: 0.9, // months 9-12 — short, thin light (lean on batteries + turbines)
    // The Long Ledger (spec 055): a life has a long span, then a gentle, capped natural turnover. Inert until the colony is past the
    // span (no test or young colony runs that long), softened by good care, and hard-capped so it can never out-pace renewal or
    // empty the colony — passings never exceed half the year's births+arrivals, never exceed a small fraction, never below the crew.
    naturalSpanYears: 60, // no natural passings until the colony is this many years old (the founding generation's long span)
    naturalPassRate: 0.015, // base fraction of colonists who pass per year once past the span
    naturalPassRampPerYear: 0.01, // the rate rises this much per colony-year past the span (an older colony has more elders)
    maxPassFraction: 0.03, // hard ceiling — never more than this fraction of colonists pass in a single year
    carePassFloor: 0.4, // best care (clinics, water, food, order) reduces passings to this fraction of the base — longer lives
    renewalCapFraction: 0.5, // passings never exceed this fraction of the previous year's renewal (births + arrivals); net stays positive
    matHallOfNames: 18,
    compHallOfNames: 5,
    crewHallOfNames: 2,
    hallOfNamesCost: 1500,
    hallOfNamesWorkers: 2, // two attendants keep the Long Ledger
    hallOfNamesPowerLoad: 0.3,
    remembranceRelief: 0.05, // a staffed Hall of Names eases unrest by this after a year that takes someone
    // Rimfish (spec 056): a second food netted from the cloudsea rim, stored separately. Inert with no Cloudsea Net Dock. When on
    // hand, rimfish spares skygrain (colonists take a portion of their meals from it, so the grain lasts longer through a lean
    // season), and the varied table draws settlers a little faster. It is not subject to the skyfarm seasons — that is the buffer.
    matNetDock: 16,
    compNetDock: 5,
    crewNetDock: 6,
    netDockCost: 1400,
    netDockWorkers: 6, // the netters
    netDockPowerLoad: 0.4, // winches
    rimfishPerDay: 6, // rimfish a fully-staffed dock nets per day (modest — supplements, not replaces, skygrain)
    rimfishMealFraction: 0.35, // up to this fraction of a colonist's meals come from rimfish when it is on hand (sparing skygrain)
    rimfishDesirabilityBonus: 0.06, // a varied table (rimfish on offer) draws settlers a little faster
    storeBaseRimfish: 100, // storage cap (spec 023) for rimfish
    storePerRimfish: 70,
    rimfishSurplus: 30, // raise a Net Dock once the colony is large and could feed a varied table
    // Household Waste (spec 058): the everyday filth a growing population makes. A soft waste meter [0,1] fills slowly from occupied
    // homes (more at higher tiers and in warm seasons); below the harmless line nothing happens, above it desirability slips and
    // (higher still) fever rises gently. A staffed Sanitation Post clears it. Inert by default — it rises over colony-months and does
    // nothing below 0.25, so a young colony and every test are unchanged — and capped so it can never empty or sicken the colony badly.
    matSanitation: 16,
    compSanitation: 3,
    crewSanitation: 2,
    sanitationCost: 1200,
    sanitationWorkers: 2, // the drain-keepers
    sanitationPowerLoad: 0.3,
    wasteRisePerDay: 0.004, // base waste a fully-occupied colony makes per day (~60+ days to the harmless line — far longer than any test)
    wasteClearPerPostPerDay: 0.02, // waste a staffed Sanitation Post clears per day
    wasteNaturalDecay: 0.001, // a tiny self-clearing so a depopulated colony drifts clean
    wasteHarmlessBelow: 0.25, // below this the rim copes and nothing happens
    wasteFeverThreshold: 0.5, // at/above this, unhandled filth breeds sickness
    wasteDesirabilityWeight: 0.4, // desirability dampening per unit of waste over the harmless line (max ~0.3 at full filth)
    wasteFeverPerDay: 0.05, // outbreak pressure per day per unit of waste over the fever threshold (gentle, contained by clinics + fever watch)
    wasteOccupancyRef: 20, // homes at which waste generation reaches full pressure (a small colony makes proportionally less)
    wasteTierWeight: 0.15, // higher mean housing tier makes a little more refuse
    wasteWarmSeason: 1.2, // waste ripens faster in Bloom/Highsun (only when a calendar is kept)
    wasteColdSeason: 0.85, // ...and slower in Grey/Frost
    // The Watch Nook (spec 059): a rich, populous, unguarded colony bleeds a slow trickle of treasury to petty theft. Inert below the
    // floors and in any crisis; capped; clamped so it can never create debt; and a staffed Watch Nook (two) cuts it (to zero).
    matWatchNook: 12,
    compWatchNook: 2,
    crewWatchNook: 2,
    watchNookCost: 1000,
    watchNookWorkers: 2, // the watchkeepers
    watchNookPowerLoad: 0.2,
    theftTreasuryFloor: 500, // no theft until the treasury holds more than this (a poor colony has nothing worth taking)
    theftPopFloor: 25, // ...and at least this many colonists (a small colony watches itself)
    theftRatePerDay: 0.00017, // fraction of the treasury skimmed per day when unguarded (~1.5% per ~90-day season)
    theftCapPerDay: 0.28, // hard daily ceiling on theft (~25 per season) so even a vast hoard loses little
    watchSuppressionPerPost: 0.8, // each staffed Watch Nook cuts theft by this (1 Nook → x0.2, 2 → x0)
    // The Variety Ration Counter (spec 060): a staffed service post that rewards a VARIED diet. While built, staffed, powered and fed
    // two foods, the share of the colony it covers earns a Varied Diet standing that gently lifts settler reputation (immigration) and
    // helps served homes climb the ladder. Inert by default: no counter changes nothing; one food earns no bonus and no penalty; a lost
    // staff/grid keeps the standing 5 days then fades. It only ever adds — never pushes a home or the colony below its no-counter base.
    matVarietyCounter: 35, // materials to build
    compVarietyCounter: 8, // components to build
    toolVarietyCounter: 1, // tool-kits to build (the colony's first build that draws the Tool Crib's kits, spec 047)
    crewVarietyCounter: 4, // builders reserved for the construction job
    varietyCounterCost: 900, // treasury to build
    varietyCounterWorkers: 2, // run crew: 1 ration clerk + 1 food handler
    varietyCounterPowerLoad: 0.3, // a low-priority grid load while operating (sheds first in a brownout)
    varietyCounterCapacity: 80, // residents one counter covers
    dietWindowDays: 20, // trailing window over which the diet mix is read
    varietyMinShare: 0.2, // rimfish must be at least this share of recent meals (else it is a token — one-food colony)
    varietyMaxShare: 0.8, // ...and at most this share (else skyfarm is the token) — both foods must genuinely share the table
    dietShortTolerance: 0.1, // recent unmet meals may be up to this share of the table before a shortage disqualifies the bonus
    varietyDesirabilityBonus: 0.04, // immigration desirability lift at full coverage + standing (a colony that eats well reads better)
    evoVarietyNudge: 0.05, // housing-evolution interval shortened by up to this fraction at full coverage + standing (homes climb a touch faster)
    varietyHoldDays: 5, // a Varied Diet standing persists this long after staffing/power is lost, then fades to neutral
    // Rimfish Drying Racks (spec 061): a staffed Industry worksite that dries SURPLUS fresh rimfish into shelf-stable dried rimfish,
    // banked in the storehouses and eaten only after the fresh catch runs out — so fish stays on the table (and the diet stays varied)
    // through a net-dock outage or a lean season. Inert by default: no rack means no dried store and exactly today's fish-meal math.
    matDryRack: 40, // materials to build
    compDryRack: 16, // components to build
    toolDryRack: 4, // tool-kits to build (drying knives + rack fittings, spec 047)
    linenDryRack: 8, // linen to build (drying lines + wrapping cloth, spec 031)
    crewDryRack: 4, // builders reserved for the construction job
    dryRackCost: 1200, // treasury to build
    dryRackWorkers: 2, // run crew (Industry sector): full rate at 2, half at 1, idle at 0
    dryRackPowerLoad: 0.4, // a grid load while operating (sheds first in a brownout)
    dryRackRimfishReserve: 20, // a rack dries only the fresh rimfish ABOVE this reserve, so it never takes a meal the homes need today
    dryRackRimfishPerDay: 12, // fresh rimfish one rack consumes per day at full rate
    dryRackOutputPerDay: 8, // dried rimfish one rack produces per day at full rate (a real trimming loss — 8 per 12 fresh)
    storeBaseDriedFish: 40, // storage cap (spec 023) for dried rimfish
    storePerDriedFish: 40,
    // The Labour Registry Desk (spec 062): a staffed Civic office that surfaces the employment rate and makes CHRONIC unemployment drag
    // the Prosperity Rank (spec 040) — the one place the colony currently looks away. Inert by default: with no Registry the rank is exactly
    // today and idleness does not drag it; the penalty only bites after the idleness persists for the day-count, and clears the same way.
    matRegistry: 20, // materials to build
    compRegistry: 4, // components to build
    toolRegistry: 2, // tool-kits to build (spec 047)
    folioRegistry: 2, // folios to build (spec 044 — the bound ledgers and notices)
    crewRegistry: 4, // builders reserved for the construction job
    registryCost: 700, // treasury to build
    registryWorkers: 2, // run crew (Civic clerks): full strength at 2, half at 1, idle at 0
    registryCapacity: 120, // working-age colonists one staffed Registry keeps on the books
    registryHighPct: 0.1, // unemployment above this for registryHighDays drags the rank by 1
    registrySeverePct: 0.2, // unemployment above this for registrySevereDays drags the rank by 2 instead
    registryClearPct: 0.05, // the penalty clears once unemployment stays below this for registryClearDays
    registryHighDays: 7, // consecutive days above the high line before the -1 bites
    registrySevereDays: 14, // consecutive days above the severe line before the -2 bites
    registryClearDays: 7, // consecutive days below the clear line before the penalty lifts (hysteresis)
    // The Planter Square (spec 063): the colony's first POSITIVE spatial lever — a staffed, watered beautification tile that, while
    // Blooming, lifts the desirability/liveability of homes in its radius and draws settlers. The smog mechanic with the sign flipped.
    // Inert by default: no Planter, or an untended one, changes nothing; it only ever adds, capped, and only to homes already served.
    matPlanter: 14, // materials to build
    compPlanter: 2, // components to build
    toolPlanter: 1, // tool-kits to build (watering-line fittings, spec 047)
    crewPlanter: 3, // builders reserved for the construction job
    planterCost: 400, // treasury to build
    planterWorkers: 1, // a Civic groundskeeper (a light tend; an unstaffed Square is untended)
    planterWaterWarm: 1, // stored water drawn per day in the warm seasons (Bloom/Highsun) — also the no-calendar default
    planterWaterCool: 0.5, // ...and in the cool ones (Grey/Frost)
    planterNearRadius: 4, // homes within this many tiles get the near desirability bonus
    planterFarRadius: 8, // ...and within this, the far bonus (the nearer ring wins per Planter, not additive)
    planterNearBonus: 6, // desirability points to homes in the near ring
    planterFarBonus: 3, // desirability points to homes in the far ring
    planterMaxBonus: 12, // a single home gathers at most this many points from all Planters combined (no cheat-wall)
    planterLiveabilityPerPoint: 0.01, // each desirability point adds this to a served home's liveability (12 pts → +0.12)
    planterImmigrationBonus: 0.08, // immigration desirability lift at full Bloom coverage (a colony that looks cared for draws settlers)
    planterBloomDays: 7, // a Planter Blooms once tended at least this many of the trailing days
    planterBloomCap: 10, // the tended-day counter saturates here (so a 7-of-10 window gives a few days of grace before a Bloom fades)
    // The Market Stall (spec 064): the colony's first DOMESTIC revenue — a staffed Trade stall that sells SURPLUS linen/folios (above a
    // reserve) to its own paid colonists for a little treasury margin. Inert by default: no stall earns exactly as today; it only ever adds
    // coin from genuine surplus, never below the reserve, and only while wages are paid (custom dries up as the treasury sinks into arrears).
    matStall: 10, // materials to build
    compStall: 2, // components to build
    toolStall: 1, // tool-kits to build (spec 047)
    linenStall: 2, // linen to build (awning + counter cloth, spec 031)
    crewStall: 3, // builders reserved for the construction job
    stallCost: 350, // treasury to build
    stallWorkers: 2, // run crew (Trade clerks): full at 2, half at 1, closed at 0
    stallServedCap: 60, // housed colonists one fully-staffed stall serves
    stallServedPerSale: 20, // one sale per this many served colonists per day (60 served → 3 sales/day)
    stallCoinPerSale: 4, // treasury margin per sale
    stallReserve: 10, // the stall never sells linen or folios below this (protects the Exchange's export stock + the top homes)
    // Deck Fires + the Fire-Watch Post (spec 065): the colony's first SPREADING, building-destroying hazard. A Fire-Watch Post watches a
    // district; in-district buildings accumulate fire risk under sustained stress (worn/brownout/warm/industry/full-store/crowded), and the
    // worst ignites. A staffed, WATERED watch drains risk and suppresses sparks; left unwatched, a fire grows spark -> blaze, spreads to a
    // deck-neighbour, then destroys the building. Deterministic (no dice — risk accrues, fire grows on a clock). Inert with no Post.
    matFireWatch: 40, // materials to build
    compFireWatch: 10, // components to build
    toolFireWatch: 3, // tool-kits to build (hooks, axes, pump fittings, spec 047)
    reelFireWatch: 2, // reels to build (hose stock, spec 013)
    linenFireWatch: 6, // linen to build (gasket + hose cloth, spec 031)
    crewFireWatch: 4, // builders reserved for the construction job
    fireWatchCost: 1200, // treasury to build
    fireWatchWorkers: 3, // run crew (Safety sector): full at 3, two-thirds at 2, one-third at 1, no protection at 0
    fireWatchPowerLoad: 0.3, // a small grid load for the pumps
    fireWatchRadius: 6, // a Post watches all buildings within this many deck tiles (its fire district)
    fireWatchWaterPerDay: 6, // stored water a Post draws per day for barrels + drills (spec 046)
    fireRiskPerPoint: 1, // fire risk a building accrues per stressor point per day
    fireIgniteThreshold: 10, // a building ignites once its fire risk reaches this (~2-3 days of sustained stress, unwatched)
    fireWatchDrainPerDay: 8, // fire risk a staffed, watered Post bleeds from a covered building per day (beats normal accrual)
    fireIgnitionWindowDays: 10, // a district lights at most one new spontaneous fire per this many days (spread ignitions are separate)
    fireWornPoints: 1, // stressor: worn past the maintenance line (spec 022)
    fireBrownoutPoints: 1, // stressor: the colony is browning out (spec 017)
    fireWarmPoints: 1, // stressor: warm season — Bloom or Highsun (spec 054)
    fireHazardKindPoints: 2, // stressor: a power/industry/workshop/drying building (hot work)
    fireFullStorePoints: 1, // stressor: a packed store near its cap (spec 023)
    fireCrowdedPoints: 1, // stressor: crowded — many directly adjacent buildings
    fireCrowdedNeighbours: 4, // ...this many or more adjacent buildings counts as crowded
    fireBlazeAt: 720, // sim-minutes burning before a Spark becomes a Blaze (12h)
    fireSpreadAt: 1080, // sim-minutes burning before a Blaze lights its most flammable deck-neighbour (18h)
    fireDestroyAt: 2160, // sim-minutes burning before the building is destroyed (36h)
    fireSuppressStrength: 3, // a fully-staffed, watered Post removes this multiple of real-time fire age per step (so a Spark dies fast)
    fireAdjacency: 1.5, // deck-tile distance counted as a direct neighbour for spread (only direct neighbours catch)
    // The Greywater Reclaimer (spec 066): the water economy's first recycling loop. A staffed, powered utility plant captures a share of
    // the colony's daily water draw as greywater and treats it back into the tanks at a real 2:1 loss. Inert by default; runs on power
    // (halves in a brownout), idles when the tanks are nearly full, and only ever ADDS water — never reducing the tanks or any stockpile.
    matReclaimer: 45, // materials to build
    compReclaimer: 14, // components to build
    toolReclaimer: 3, // tool-kits to build (pump + seal fittings, spec 047)
    reelReclaimer: 2, // reels to build (gasket stock, spec 013)
    crewReclaimer: 4, // builders reserved for the construction job
    reclaimerCost: 1200, // treasury to build
    reclaimerWorkers: 2, // run crew (Logistics): full at 2, half at 1, idle at 0
    reclaimerPowerLoad: 0.4, // a small grid load for the treatment pump (sheds in a brownout)
    reclaimGreywaterPerColonist: 4, // greywater available per colonist per day (a per-capita proxy for the wash/galley/cooling draw)
    reclaimGreywaterCapPerDay: 80, // greywater one plant can treat per day
    reclaimLossRatio: 2, // greywater per unit of stored water returned (2:1 loss — no magic)
    reclaimTankIdleFraction: 0.95, // above this share of tank capacity the plant idles to save filters (and never overfills)
    reclaimBrownoutRate: 0.5, // a brownout halves the return (the heavy pump sheds, spec 017)
    reclaimNoFilterRate: 0.5, // without linen for filters the plant runs at half rate
    reclaimGreywaterPerLinen: 100, // linen consumed for filters per this much greywater treated
    // The Highsun Lantern Supper (spec 067): a once-per-colony-year festival from a staffed Festival Board. On the year's Highsun turn it
    // lays a supper from the colony's own stores (greens + fish + linen + materials, scaled per 20 citizens); its coverage grants a tiered,
    // decaying Lantern Cheer (confidence + a calmer colony + standing). Inert by default; fires at most once a year; never spends below zero.
    matFestBoard: 30, // materials to build
    compFestBoard: 8, // components to build
    toolFestBoard: 2, // tool-kits to build (spec 047)
    linenFestBoard: 6, // linen to build (lantern bunting, spec 031)
    folioFestBoard: 2, // folios to build (planning ledgers, spec 044)
    crewFestBoard: 4, // builders reserved for the construction job
    festBoardCost: 800, // treasury to build
    festBoardWorkers: 1, // a Festival Steward (Civic); unstaffed, the supper does not happen
    festivalMonthStart: 5, // the Highsun window (months 5..6) in which the supper fires
    festivalMonthEnd: 6,
    festCitizensPerTable: 20, // citizens per festival table
    festGreensPerTable: 10, // greens (food) per table
    festFishPerTable: 6, // rimfish (fresh first, then dried) per table
    festLinenPerTable: 1, // linen per table (lanterns)
    festMaterialsPerTable: 2, // materials per table (trestles)
    festFullCoverage: 0.8, // coverage at/above this throws a full supper (the best cheer + standing)
    festPartialCoverage: 0.5, // coverage at/above this throws a modest supper; below this the supper is not held at all (no cost, no cheer)
    festFullCheerBonus: 5, // confidence points the full supper grants (added to settlerConfidence as +0.05)
    festPartialCheerBonus: 2, // ...and the modest supper (+0.02)
    festFullCheerDays: 30, // days the full Lantern Cheer lasts
    festPartialCheerDays: 15, // ...and the modest cheer
    festUnrestRelief: 0.1, // one-time unrest relief a full supper brings (a calmer colony, like Founders' Day)
    festStandingGain: 0.05, // Kookerverse Standing a full supper earns (once per year)
    // The Fungus Cellar (spec 068): a hardy third food (duskcap) grown on the cool dark under-decks — non-seasonal, low-water and power-
    // resilient, so it keeps coming in a Frost or a brownout where the greenhouses falter. Eaten as a third protein course (after rimfish +
    // dried), sparing skygrain, and counting as a varied-table dish (spec 060). Inert with no Cellar: duskcap stays 0 and the food math is unchanged.
    matCellar: 30, // materials to build
    compCellar: 6, // components to build
    toolCellar: 1, // tool-kits to build (bed frames + damp-line fittings, spec 047)
    crewCellar: 4, // builders reserved for the construction job
    cellarCost: 700, // treasury to build
    cellarWorkers: 3, // run crew (Food growers); understaffed grows proportionally less
    cellarPowerLoad: 0.3, // a light grid load for the fans
    duskcapPerDay: 5, // duskcap a fully-staffed Cellar grows per day
    cellarWaterPerDay: 1, // stored water a Cellar draws per day for the damp-line (spec 046)
    cellarPowerFloor: 0.6, // even a brownout leaves the low-draw cellar fans at this fraction (resilient vs the greenhouses)
    cellarDryFloor: 0.5, // a dry damp-line (empty tanks) slows the beds to this fraction
    storeBaseDuskcap: 80, // storage cap (spec 023) for duskcap
    storePerDuskcap: 80,
    // The Steam Bathhouse (spec 069): a staffed health worksite on the cistern line that draws stored water to give the colony a
    // hygiene level (0..1). Hygiene is preventive — it slows how fast fever risk builds (up to bathHygieneRelief at full hygiene), so a
    // clean colony takes fewer and milder fevers than a grimy one. Above all it is a water-demand sink (gives the cisterns + the
    // greywater reclaimer a customer that is not a greenhouse). Inert with no Bathhouse: hygiene stays 0 and the fever math is unchanged.
    matBath: 35, // materials to build
    compBath: 8, // components to build
    toolBath: 1, // tool-kits to build (boiler fittings + pipe runs, spec 047)
    crewBath: 4, // builders reserved for the construction job
    bathCost: 720, // treasury to build
    bathWorkers: 3, // run crew (attendants + a boiler-hand); understaffed washes proportionally fewer
    bathPowerLoad: 0.3, // a light grid load to heat the water
    bathServes: 50, // colonists one Bathhouse keeps clean (coverage = baths*bathServes / colonists, capped at 1)
    bathWaterPerDay: 3, // stored water a Bathhouse draws per day (spec 046 demand sink)
    bathHygieneRelief: 0.4, // at full hygiene the fever-risk buildup runs this much slower (40 percent)
    bathDryFloor: 0.25, // a dry bathhouse (empty tanks) only reaches this hygiene fraction
    bathPowerFloor: 0.5, // even a brownout leaves the boilers throwing this fraction of heat
    // The Clean-Home Standing (spec 070): the bathhouse hygiene (069) becomes two gentle positive levers, tuned in line with the
    // Planter (063, 0.08 draw) and Variety (060, 0.04 draw / 0.05 evolution) levers. Purely positive: both are 0 effect with no Bathhouse.
    hygieneDesirabilityGain: 0.1, // at full hygiene, +10 percent to the settler-draw desirability (a clean colony is more inviting)
    hygieneEvolutionGain: 0.08, // at full hygiene, served homes climb up to 8 percent faster (shortens the housing-upgrade interval)
    // The Folio Library (spec 071): a staffed services building that lends the colony's own folios to the homes as culture — folio-fed
    // the way the holo-theatres are reel-fed (014), so a second culture path that needs no reels. Draws folios/day, the first DOMESTIC
    // demand competing with the export trade. Inert with no Library: no folios drawn, culture exactly as the theatres give it today.
    matLibrary: 40, // materials to build
    compLibrary: 10, // components to build
    toolLibrary: 1, // tool-kits to build (shelving + binding-presses, spec 047)
    crewLibrary: 5, // builders reserved for the construction job
    libraryCost: 800, // treasury to build
    libraryWorkers: 4, // run crew (librarians); unstaffed the shelves go quiet
    libraryPowerLoad: 0.3, // a light grid load for the reading lamps
    libraryRadius: 8, // cells; habitats within this of a staffed, stocked Library get letters-culture (matches the theatre reach)
    libraryFoliosPerDay: 1, // folios a Library draws from the stores per day to lend (the domestic demand vs the export trade)
    // The Skydeck Gallery (spec 072): a staffed trade hall on the mooring deck that earns visitor coin from Kookerverse travellers who
    // come to see a renowned colony. The take scales with the colony's appeal (liveability 011, lifted by a finished Horizon Spire 033
    // and the Prosperity standing 040) and its Trade-sector staffing. Pure revenue. Inert with no Gallery: no visitor coin, treasury unchanged.
    matGallery: 40, // materials to build
    compGallery: 12, // components to build
    toolGallery: 1, // tool-kits to build (the viewing rails + display cases)
    crewGallery: 5, // builders reserved for the construction job
    galleryCost: 900, // treasury to build
    galleryWorkers: 4, // run crew (guides + a curator); unstaffed the hall takes no fares
    galleryPowerLoad: 0.4, // grid load for the lights + the lifts
    galleryVisitorCoin: 30, // coin/day a full-house Gallery takes at full appeal + full staffing
    gallerySpireBonus: 0.25, // appeal lift while the Horizon Spire (033) stands finished (a marquee draw)
    galleryProsperityBonus: 0.15, // appeal lift at full Prosperity (040) standing (renown brings more skiffs)
    galleryAppealCeiling: 1.4, // the take never scales beyond this however renowned
    // Porter Sheds (spec 073): the first EMBODIMENT mechanic — a staffed shed by the road whose porters visibly carry goods between
    // buildings, with goods rendered as piles that grow and shrink. It invents no new good and changes no balance number; it is pure
    // visual life. Inert with no shed. Costs materials + components + tools + a reel (cart harness) to build, 2 porters to run.
    matPorter: 10, // materials to build
    compPorter: 4, // components to build
    toolPorter: 2, // tool-kits to build (handcarts + shoulder-poles)
    reelPorter: 1, // a reel for the cart lashings + harness (Mara Venn's spec)
    crewPorter: 3, // builders reserved for the construction job
    porterCost: 320, // treasury to build
    porterWorkers: 2, // run crew (the porters); unstaffed the carts stand idle
    porterRadius: 8, // cells; a shed's porters serve buildings within this reach
    portersPerShed: 2, // visible carriers a staffed shed puts on the roads
    pilePerMaterials: 8, // one visible materials crate per this much stock (the pile quantisation, spec VISUAL-STANDARD)
    pilePerFood: 8, // one visible food sack per this much stock
    pileMaxUnits: 14, // cap on visible units per good per shed so a full store is a clear heap, not a tower
    // Avatar Foundry (spec 074): the civic hall that mints a citizen avatar — a real Hermes pod in the kooker DMZ — for each
    // approved household. In-engine it is a staffed civic building that GATES the mint and gives first-person vision a home on the
    // map; the pod spawn + kooker user are out-of-process. Costs materials + components + tools + reels + a build crew. One suffices.
    matAvatar: 60, // materials to build
    compAvatar: 18, // components to build (the projection rig + the link desk)
    toolAvatar: 4, // tool-kits to build
    reelAvatar: 2, // reels for the avatar link harness
    crewAvatar: 6, // builders reserved for the construction job
    avatarCost: 1200, // treasury to build
    avatarWorkers: 3, // run crew (the wrights who keep the link desks lit); unstaffed it mints nobody
    avatarPowerLoad: 0.5, // grid load for the projection rig + the link desks
    avatarMaxCitizens: 8, // citizen pods a staffed Foundry may mint (the operator raises this as the cluster budget allows)
    // Neighbourhood voxel homes (spec 075): a citizen raises a block house on their lot. Gated on materials + a free hand.
    matNeighborHouse: 20, // materials to raise a voxel home on a lot
    pollutionPerIndustrial: 3,
  },

  economy: {
    incomePerColonistPerDay: 150,
    buildingUpkeepPerDay: 14,
    // Spec 084 S3 — upkeep follows the road KIND: the paved avenue costs more to keep than the
    // packed-earth street frame; footpaths are nearly free. Lands in the SAME slice that merges
    // the avenue into state.roads, so the treasury never bleeds at a stale flat rate.
    roadUpkeepByKind: { avenue: 1.0, street: 0.4, path: 0.1 },
    // Spec 083/084 — the builder trade's fee seam: 0 keeps construction free until the Kookerverse
    // wallets land; the negotiation engine already prices jobs in city coin on top of this.
    builderFeePerBlock: 0,
    pollutionPenaltyScale: 320, // income is dragged down as pollution rises (capped)
    // Spec 085 — the land economy: priced plots + Kook wallets. 1 ₭ ≈ R25 (operator anchor); a plot
    // costs its buildable area + a waterfront premium; a newcomer arrives with 600-1000 ₭ (R15k-25k,
    // a "Mac Mini starter package") — always enough for the dearest plot plus a modest Viw build.
    land: {
      zarPerKook: 25,
      plotAreaRate: 0.6,
      waterfrontPremium: 120,
      starterDepositMin: 600,
      starterDepositSpread: 400,
    },
  },

  // Spec 079 — the commercial district: shop plots priced in ₭ at a PREMIUM over residential land
  // (a high street is dearer dirt), and the materials to raise each shop kind. The ZAR bridge on the
  // HUD reuses economy.land.zarPerKook so a shop reads in rand like a homestead does.
  commerce: {
    reserveW: 64,
    reserveH: 48,
    reserveFreePrimary: 358,
    reserveFreeFallback: 205,
    mallPadW: 14,
    mallPadH: 10,
    plotPriceK: { kiosk: 220, store: 420, showroom: 720 },
    matByKind: { kiosk: 12, store: 24, showroom: 40 },
  },

  traffic: {
    maxCars: 34, // spec 084 S3 — the avenue joins the drivable network; commuters get room to use it
    carSpeed: 14, // lots per sim-hour (the street base)
    // Spec 084 S3 — cars cruise faster on the paved avenue than on packed earth.
    speedByKind: { avenue: 18, street: 14, path: 8 },
    laneOffset: 0.22, // how far cars sit to the LEFT of their travel direction
    maxWaitSteps: 50, // failsafe so a jammed car eventually proceeds (no deadlock)
  },

  tarentaal: {
    adults: 4,
    chicks: 6,
    anchorOffset: { x: 10, y: 8 },
    landSearchRadius: 18,
    flockRadius: 3.2,
    adultSpeed: 9,
    chickSpeed: 12,
    chaseSpeed: 22,
    chaseStride: 2.8,
    chasePeriodMinutes: 12,
    chickTrailDistance: 1.2,
    roamTurnRate: 0.035,
  },

  firstPerson: {
    maxWalkSpeed: 3.4, // world units/sec once fully accelerated
    walkAcceleration: 10, // units/sec²; gives a visible ramp instead of instant full speed
    walkDeceleration: 8, // units/sec²; releases coast briefly, then settle
    roadWalkSpeedMultiplier: 1.25, // paved/path cells feel easier to roam than grass
    offRoadWalkSpeedMultiplier: 1, // baseline terrain walking multiplier
    sprintWalkSpeedMultiplier: 1.45, // hold Shift to cover long streets faster without changing normal walk
    sprintChargeSeconds: 3, // sustained sprint comfort budget before falling back to normal walk
    sprintRecoverySeconds: 4, // time off Shift to recover a fully exhausted sprint budget
    interactionPromptMaxDistance: {
      citizen: 14,
      civic: 18,
      building: 18,
      road: 8,
    }, // only nearby things become player actions; far citizens should not hide road prompts
    guidedArrivalDistance: 0.05, // close enough to clear a guided-walk target and report arrival
    guidedCollisionSampleStep: 0.25, // max world units between guided-walk guardrail samples so large deterministic steps cannot tunnel through blockers
    turnSpeed: 2.4, // radians/sec for keyboard yaw until mouse-look lands
    mouseSensitivity: 0.0025, // radians per pointer-lock mouse pixel for FPS look
    mouseSensitivityScale: { low: 0.6, normal: 1, high: 1.6 }, // player-facing look sensitivity presets
    maxLookPitch: 0.9, // radians up/down clamp so mouse-look never flips over
  },

  render: {
    seed: 4242,
  },
} as const;
