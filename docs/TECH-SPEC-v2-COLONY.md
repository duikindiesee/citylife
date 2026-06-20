# CityLife v2 — "Colony": Technical Game-Mechanics Spec

**Status:** Design spec for the v2 pivot. Supersedes the flat-town MVP's _world model_ (the engine architecture, Game API pattern, AI governor, renderer, and agent sim are reused — see §17).
**Premise:** A rocket from Earth lands on a procedurally-generated **alien planet**. You start with nothing but a **caravan, a solar panel and a lithium battery**, and grow a colony into a metropolis. Land, roads, utilities and every building are **planned, queued, paid for, and built by AI** — the city designs and constructs itself; you (or the AI) govern.

---

## 1. Design pillars

1. **Empty start, earned growth.** No pre-built city. Everything is surveyed, claimed, queued, paid for and constructed in sequence.
2. **The planet is a ball; the ground is flat.** Zoom in → a flat buildable surface. Zoom out → a curved planet with your colony a glowing dot on a huge alien world.
3. **Nothing exists until it's built.** Architect designs it → it's paid for → a construction crew drives out and builds it → _then_ residents arrive. You watch it happen.
4. **Every building is an AI-authored artifact.** Designs are generated, stored, versioned, reused, and re-fitted to each plot and slope.
5. **Infrastructure is a first-class simulation.** Roads, power, water, sewage and waste are real networks with sources, capacity, flow and failure. Every building loads every network.
6. **The AI plans, designs, and builds — you can watch or drive.** Surveyor, Planner, Architect, Construction Manager and Mayor are agentic roles over one Game API.

---

## 2. The world — a "locally-flat planet"

### 2.1 The key decision: locally-flat globe, not a true sphere sim

A **true sphere-surface simulation** (roads/parcels/pathfinding on a globe) is a research-grade problem and incompatible with a tile/graph engine. Instead:

- **Gameplay happens on a large flat region** (the "claim"), an `N×N` heightfield (start `256×256`, design for `1024×1024`), in local `(x, z)` coordinates — the engine stays flat, fast and graph-friendly.
- **The "ball" is the zoom-out view.** The flat region is textured onto the cap of a large sphere; as the camera pulls back, terrain → ocean → atmospheric haze → planet curvature, with your colony a lit patch. Far-LOD is visual only — no simulation runs there.
- **"Huge land around the ball"** = the playable region is a small part of a much larger generated terrain skirt that fades into ocean and the planet's curve. Future metros (other landing sites) are other patches on the same globe.

> This gives the exact requested feel — _zoom in, the ground is flat; zoom out, you see the metropolis on a planet_ — while keeping the simulation tractable. True-sphere is logged as a far-future option (§19).

### 2.2 Procedural terrain (mountains, rivers, coast, sea)

Generated from layered noise into a heightfield + classification maps:

- **Elevation:** fractal simplex noise (ridged for mountains) → height `0..1`. Sea level constant → everything below is **ocean/coast**.
- **Hydrology:** rivers traced by downhill flow accumulation from high-moisture cells to the sea; lakes fill local minima. Coastlines emerge where land meets sea level.
- **Moisture & temperature** maps → **biomes** (alien palette: e.g. crystalline highlands, fungal lowlands, ammonia seas). Biome sets ground/flora colours and resource odds.
- **Resource deposits:** ore/lumber-analogue/crops-analogue/oil-analogue/water placed by biome + noise. Surveyed before exploitation.
- **Buildability map (derived):** per-cell slope + water + resource flags → "flat enough to build", "needs grading", "unbuildable (steep/water)". Drives the Land Planner.

All seeded and deterministic (reuse `RNG`). Config-driven so worlds are reproducible and balanceable.

### 2.3 Camera / LOD

Continuous zoom across three regimes: **street** (see into buildings, people, cars — the v1 dollhouse view), **district** (blocks, networks, traffic), **planet** (the ball). Terrain uses a quadtree/clipmap LOD so the near field is detailed and the far field cheap. Sun/day-night + the alien sky are global.

---

## 3. The colony seed (the landing)

1. **Touchdown:** a dropship descends to a player/AI-chosen flat-ish coastal-ish site (the Surveyor recommends candidates by buildability + resources + water). The landing pad becomes origin `(0,0)`.
2. **Starting assets (off-grid):**
   - **Caravan = Colony HQ** (command + first shelter; tiny housing/jobs).
   - **Solar panel + lithium battery** = a **micro power grid**: solar generates by day, battery stores for night. This is the entire power network at t=0 (Surviving-Mars-style accumulator start).
   - A small **materials cache** (build the first roads/structures).
3. **Bootstrapping loop:** survey → claim a parcel → grade if needed → queue a building → pay → crew builds it → it draws power from the battery → colonists arrive. Repeat, expanding the grid outward.

Until a structure is connected to power/water it runs on local stores (battery, water tank) or not at all — the early game is an off-grid survival ramp that becomes a serviced city.

---

## 4. Land & parcels — the Land Planner

- **Parcel:** a rectangular (later polygonal) claim with explicit **sizing** (`w × d` in lots). Every building requires a parcel of sufficient size for its artifact's footprint **plus yard/setback**.
- **Yards / setbacks:** purchasable extra parcel area around a building (gardens, lots). The Planner buys land ahead of need; yards raise land value and happiness.
- **Buying land:** parcels are purchased from the **City Planner** (cost scales with area, biome, proximity to existing city and resources). Owned but unbuilt parcels can be **reserved/zoned** (planned R/C/I) before anything is constructed.
- **Terrain shaping (grading):** building on slope costs a **grading** step — flatten the pad (earthworks cost ∝ volume moved) **or** the artifact adapts (stilts/split-level, §7.5). Land shapes are mutable: cut/fill, carve canals, reshape coastline (paid, queued like any job).
- **Property sizing rules** live in config: min footprint + setback per category and density tier, so the Planner can answer "what fits here?" and "what land do I need for X?".

---

## 5. Roads & networks

- **Road graph** (extends v1's road graph + BFS/A\*): nodes at intersections, edges with length + tier cost + congestion. Tiers: **track → paved → avenue → highway** (capacity/speed/throughput rise with cost), echoing W&R's gravel→asphalt progression.
- **Planned for expansion:** the Planner lays a **road plan** (ghost segments) sized for projected growth (arterials first, then a fill grid/organic branches), then queues segments for construction. Roads are built by crews and **paid for per segment**.
- **Universal road access (hard rule):** every building must connect to the road graph (a "door" cell adjacent to a road). No road access → cannot be built / goes inactive. The Planner guarantees access before queueing a structure.
- **Utilities ride the roads by default** (CS II / SimCity GlassBox model): laying a road lays a power+water+sewage conduit beneath it. **Dedicated off-road lines** (power lines, pipelines) are also buildable for the colony phase and long hauls (W&R / Surviving Mars model). Each carries one or more utilities with a capacity.

---

## 6. Infrastructure layers (the deep-dive)

We model **four networks** — Power, Water, Sewage, Waste — plus the road network. Each is a graph with **sources**, **distribution**, **per-building load**, a **capacity-limited flow solve**, and **failure effects**. Grounded in how the genre does it:

| System     | Cities: Skylines II                                          | Workers & Resources                          | Surviving Mars                                 | **CityLife adopts**                                                                                    |
| ---------- | ------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Power**  | cables in roads or pylons; many plant types                  | power lines + transformers; plant types      | cables, solar/wind + accumulators, grid faults | Solar+battery start → plants; carried in roads **or** lines; battery storage; brownouts on overload    |
| **Water**  | pipes (11-cell radius); surface + **groundwater** (depletes) | surface intake or **wells**; quality matters | pipe net + **tanks**                           | Source (river/coast/well/desal) → pipes/road conduits → per-building demand → tanks buffer             |
| **Sewage** | shared pipes; **treatment recycles**, or outfall pollutes    | collect → treat / dump / export              | (life-support analogue)                        | Wastewater generated ∝ water use → pipes → treatment plant (clean) or outfall (pollutes coast)         |
| **Waste**  | bins → garbage trucks → waste facilities                     | logistics-hauled                             | —                                              | Per-building garbage accrues → collection trucks → landfill/recycling; overflow drops happiness/health |
| **Roads**  | utilities-in-roads; traffic sim                              | tiers, signage, traffic                      | drone roads                                    | Tiered roads + traffic + buried conduits                                                               |

### 6.1 Per-building load

Every building artifact declares draw/output per tick: `{ power, water, sewage, waste }` (sewage ≈ water in; waste ∝ occupancy/activity). **"Each house influences every network"** — directly from these four numbers, summed over the city.

### 6.2 Flow solve (per network, on change + every K ticks)

1. Build the network graph (road conduits + dedicated lines).
2. **Flood-fill from sources** outward, decrementing remaining source capacity as consumers are served (and pipe/line capacity along the way).
3. Mark each building `served | partially | unserved` per utility; **distance/radius limits** apply (CS-style coverage).
4. **Storage buffers** (battery, water tank) absorb shortfalls for a while, then deplete.
5. **Failure effects** (CS model): no power → building inactive; no water / backed-up sewage → health hit; waste overflow → happiness/health hit; sustained lack → colonists **leave**. Overload → brownouts / pressure drop (partial service).

### 6.3 Visualization = the views (§11)

Per the GlassBox philosophy ("what you see is the simulation"): each network has a **data-layer overlay** showing sources, flow, served/unserved, and bottlenecks.

---

## 7. Buildings as AI-designed artifacts (the headline mechanic)

> _"Every house and building designed by AI as artifacts and stored, modifiable on land shapes."_

### 7.1 The `BuildingArtifact`

A building is **not** a hard-coded mesh — it's a generated, stored, reusable **artifact**: a structured recipe the renderer turns into geometry and the sim reads for function.

```ts
interface BuildingArtifact {
  id: string; // content-hash → dedupe + cache
  version: number;
  name: string;
  category: "residential" | "commercial" | "industrial" | "civic" | "utility";
  style: string; // 'modular-colony', 'alien-organic', 'brick-row'...
  author: "architect-ai" | "player" | "seed";

  // plot requirements (the Land Planner matches these to parcels)
  footprint: { w: number; d: number }; // lot units
  setback: number;
  maxSlope: number; // beyond this → grade or adapt (§7.5)

  // form — the geometry recipe (proc-gen, §7.3)
  floors: FloorSpec[]; // each floor's polygon + height (derived from the one below)
  roof: RoofSpec; // 'flat'|'gable'|'hip'|'dome'|'none'(open dollhouse)
  facade: FacadeGrammar; // window/door rules per wall
  palette: { wall: string; roof: string; trim: string; accent: string };
  openInterior: boolean; // v1 dollhouse cutaway for the street view

  // function
  capacity: { residents?: number; jobs?: number };
  load: { power: number; water: number; sewage: number; waste: number };

  // economy
  cost: { materials: number; build: number };
  buildTime: number; // construction ticks
}

interface FloorSpec {
  polygon: Vec2[];
  height: number;
  inset: number;
}
interface RoofSpec {
  type: "flat" | "gable" | "hip" | "dome" | "none";
  pitch: number;
  material: string;
}
interface FacadeGrammar {
  windowEvery: number;
  doorOnRoadSide: boolean;
  balcony?: boolean;
}
```

### 7.2 The Architect AI

Given `(category, style, parcel size, budget, biome, constraints)`, the Architect produces an artifact. Two-tier, swappable like the Mayor brain:

- **Procedural generator (always-on):** realizes geometry deterministically (grounded in proc-gen research):
  - **Footprint:** _additive growth_ for houses (organic, extensions), _subtractive_ for commercial/industrial (fill the lot).
  - **Per-floor:** each floor's polygon derived from the floor below (inset/setback) — towers taper, houses step.
  - **Facade:** a **shape grammar** places doors (road-facing) and windows at rhythmic intervals.
  - **Roof + palette:** by style/biome.
- **LLM Architect (optional):** a small model chooses _high-level_ parameters — massing, style, palette, character ("low alien dome with a courtyard") — as **structured JSON**, which the procedural generator realizes. The model never emits geometry directly (same safety principle as the Mayor: schema-validated parameters, not raw code/meshes).

### 7.3 Storage & the design library

- Artifacts are **content-hashed and persisted** (IndexedDB via Dexie) in a growing **design library**. Identical requests reuse a cached artifact; the city is a composition of **artifact instances** placed on parcels.
- **Versioned & exportable** as JSON. The library becomes the colony's architectural identity; signature/civic buildings are one-off artifacts.

### 7.4 Modification

Any artifact can be **edited** (by player or AI) → a new version: change massing, palette, capacity, add a wing. Instances can re-point to the new version (a remodel = an _upgrade_ construction job, §8).

### 7.5 Fitting to land shapes

`adapt(artifact, parcel, terrain)` re-fits a design to a specific plot:

- **Trim/extend footprint** to the parcel (within min/max).
- **Slope response:** if terrain slope > `maxSlope`, either flag a **grading** job or morph the artifact (**stilts, split-level, terraced foundation**) so it sits on the real ground.
- **Orient** the door to the nearest road. This is how one design yields many believable, site-specific buildings.

---

## 8. Construction pipeline (queue → pay → build → move-in)

The lifecycle of _every_ structure and upgrade:

```
PLAN      Planner reserves a parcel (zoned R/C/I), ensures road access
DESIGN    Architect produces/【selects an artifact, adapt() to the parcel
QUEUE     job enters the construction queue with a full cost estimate
PAY       treasury is charged (land + design fee + materials + build + utility hookups);
          unpaid jobs wait — nothing builds on credit unless a bond is issued
GRADE     if needed, a crew flattens/【shapes the pad
BUILD     a construction truck/crew drives the roads to the site and builds in stages:
          foundation → framing → envelope → utilities hookup → finishing
          (progress is visible; materials are consumed over buildTime)
CONNECT   building registers its load on power/water/sewage/waste networks
MOVE-IN   colonists arrive (by car / from the spaceport) and occupy it
```

```ts
interface ConstructionJob {
  id: string;
  parcelId: string;
  artifactId: string;
  kind: "new" | "upgrade" | "demolish" | "grade" | "road";
  stage:
    | "queued"
    | "grading"
    | "foundation"
    | "framing"
    | "envelope"
    | "utilities"
    | "finishing"
    | "done";
  progress: number; // 0..1 within stage
  paid: boolean;
  cost: number;
  crewId?: number; // assigned construction vehicle
  materials: Record<string, number>;
}
```

- **Upgrades are first-class jobs** (same pipeline): density up, remodel to a new artifact version, add capacity — queued and paid like a new build.
- **Construction crews** are vehicle agents (extends v1 logistics): a depot dispatches a truck that must **reach the site by road**, occupies it during the build, and returns. Limited crews → a real build throughput the Planner must manage.

---

## 9. Citizens & colony lifecycle

Extends the v1 agent sim:

- Colonists **arrive** (shuttle from the spaceport, then by car to a finished home) only when housing + jobs + basic utilities exist. They **leave** if utilities fail or happiness collapses (CS model).
- Daily routines (home→work→shop→home), wallets, wages, Friday payroll, the commodity economy — all retained, now gated on **serviced** buildings (an unpowered factory employs no one).
- Wellbeing now also depends on **utility coverage** (power/water/sewage/waste) and **yard/landscape** quality.

---

## 10. AI roles (agentic, over one Game API)

The v1 "Mayor" generalizes into a small **org of AI roles**, each heuristic-or-LLM (swappable `LLMProvider`), each acting only through the Game API with schema-validated actions:

| Role                 | Responsibility                                                     | Key API calls                                            |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| **Surveyor**         | Read terrain/resources; recommend landing + expansion sites        | `getTerrain`, `getBuildability`, `getResources`          |
| **City Planner**     | Zone, buy parcels/yards, lay road plans for expansion, set density | `buyParcel`, `zoneParcel`, `planRoad`, `gradeTerrain`    |
| **Architect**        | Design/select building artifacts per plot + budget                 | `designBuilding`, `adaptArtifact`                        |
| **Construction Mgr** | Prioritise & pay the build queue within budget/crews               | `queueBuilding`, `upgradeBuilding`, `setBuildPriority`   |
| **Mayor** (v1)       | Budget, tax, utilities investment, policy                          | `setTaxRate`, `setBudget`, `buildPlant`, `passOrdinance` |

They run on the configurable **check-in routine** (default 10 min, per v1): each role reads a curated digest and emits a small JSON action plan. A "city tick" can fan out to all roles or a single orchestrator.

---

## 11. Views & overlays

Multiple **data layers** (SimCity/GlassBox style), toggled in the toolbar:

- **Terrain/biome**, **buildability** (flat/grade/blocked), **resources**.
- **Zoning — planned vs built** for **Residential / Industrial / Commercial** (ghosted plans over real buildings) — directly answering "see planned infrastructure for R/I/C".
- **Roads & traffic**, **Power grid**, **Water**, **Sewage**, **Waste** — each showing sources, flow, served/unserved, bottlenecks.
- **Land value / happiness**, **construction** (active jobs + crews).

Plus the three zoom regimes (§2.3): street, district, planet.

---

## 12. Economy

You pay for **everything**: land parcels, terrain grading, road segments (per tier), utility lines/plants, **building construction**, **upgrades**, and ongoing **maintenance** of every network. Revenue: taxes (R/C/I), exports of surplus commodities, fees. Bonds for big capital (spaceport, dam). The AI budget balances capex (expansion) vs opex (services) vs reserves — the Mayor's core job, now with far more levers.

---

## 13. New Game API surface (additions to v1)

```ts
// world & land
survey(x, y): TerrainInfo
getBuildability(x, y): 'flat' | 'grade' | 'blocked'
buyParcel(x, y, w, d): ParcelResult
zoneParcel(parcelId, 'residential'|'commercial'|'industrial'|'civic'): Result
gradeTerrain(parcelId): Result            // queues a grading job

// roads & utilities
planRoad(x1,y1,x2,y2, tier): RoutePlan    // ghost; not yet built
buildPlannedRoad(planId): Result          // pay + queue
buildUtility('power'|'water'|'sewage', fromId, toId): Result
buildSource(kind, x, y): Result           // solar, water intake, treatment, landfill...

// design & construction
designBuilding(category, style?, parcelId?): BuildingArtifact   // Architect
queueBuilding(parcelId, artifactId): ConstructionJob            // pay + build
upgradeBuilding(buildingId, newArtifactId): ConstructionJob
demolish(buildingId): Result

// views & sim
setView(layer): Result
setTickSpeed(mult); waitTicks(n)
```

All v1 queries (`getState`, `getDigest`, `getMetrics`, `getHeatmap`) extend to the new systems.

---

## 14. Rendering

- **Planet:** terrain heightmap mesh with biome splat-textures on the near field; the region capped onto a sphere for the zoom-out ball; ocean shader; alien sky/atmosphere.
- **Artifacts → meshes:** a builder turns a `BuildingArtifact` into geometry (extrude floor polygons, place roof, apply facade grammar for windows/doors, palette materials). Instanced where artifacts repeat; the v1 **open-dollhouse** is just `openInterior:true` + roof `none`.
- **Construction:** partially-built meshes per stage (foundation slab → frame → envelope), a crew truck on-site, scaffolding.
- **Networks:** road conduits, pylons/pipes for off-road lines, animated flow on the active data layer.
- Reuses the v1 three.js renderer + ACES/bloom art pass; LOD for scale.

---

## 15. Persistence

IndexedDB (Dexie): the **artifact library**, the world seed + terrain edits, parcels, construction queue, networks, citizens, AI run logs. Full **save/load** and JSON export. A save = seed + diffs (edits, parcels, jobs, artifact instances) → compact.

---

## 16. Phased implementation (evolves v1, doesn't throw it away)

| Phase                             | Scope                                                                                                                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Planet & seed**             | Procedural terrain (mountains/rivers/coast/sea) on the locally-flat globe; 3-regime zoom/LOD; **empty start**; rocket landing → caravan + solar + battery; survey view.                                                                                  |
| **B — Land, roads, construction** | Parcels + Land Planner (sizing, buy, grade); tiered roads planned-for-expansion + road access rule; **procedural Architect** + artifact library + **construction pipeline** (queue→pay→crew builds→move-in); **power** network (solar/battery → plants). |
| **C — Full utilities + views**    | Water, sewage, waste networks + per-building load + flow solve + failure effects; all data-layer overlays incl. planned R/C/I; citizen lifecycle gated on services.                                                                                      |
| **D — AI org + artifacts**        | Surveyor/Planner/Architect/Construction/Mayor roles on the check-in routine; **LLM Architect** (structured params); artifact modification + slope-adaptation; deeper economy.                                                                            |
| **E — Polish & scale**            | Biome/alien art pass, save/load, bonds, multiple landing sites/metros on the globe, replays, TV kiosk.                                                                                                                                                   |

**Recommended first step:** Phase A — stand up the planet + empty start + the caravan/solar/battery seed and the three-zoom camera. It's the foundation everything else sits on, and it's the most visually dramatic ("watch the ball, drop in, start from one caravan").

---

## 17. What changes vs the current code

**Reused as-is (the spine):** framework-agnostic engine pattern, the **Game API** as the single contract, the **`LLMProvider` + governor/check-in** machinery, the **Runtime** loop, the **three.js renderer** + art pass, the **citizen agent sim** + commodity economy, and the **vehicle/logistics** system (→ construction crews + colonist cars).

**Replaced / new:** `world.ts` flat-grid gen → **procedural planet terrain + biomes + hydrology**; pre-populated city → **empty start + construction pipeline**; fixed dollhouse buildings → **`BuildingArtifact` system + Architect + library/storage + adapt()**; **parcels + Land Planner**; **power/water/sewage/waste networks**; **multi-view overlays**; AI **roles** (Planner/Architect/Construction) on top of the Mayor.

This is a multi-stage build, but each phase is playable and the v1 town logic carries forward — the dollhouses, citizens, economy and AI mayor all survive into the colony.

---

## 18. Key tunables (new `config` sections)

`world` (size, sea level, noise octaves, biome thresholds, resource density) · `land` (parcel pricing, grading cost/volume, setback/size per category) · `roads` (tier cost/capacity) · `utilities` (source capacities, per-category load, pipe radius, storage buffers, failure thresholds) · `construction` (stage durations, crew count, material costs) · `architect` (style sets, footprint rules, facade rhythms).

---

## 19. Open decisions

1. **Locally-flat globe (recommended) vs true sphere.** Spec assumes locally-flat; true-sphere is a far-future rewrite.
2. **Architect realism:** pure procedural (ship first) vs LLM-parametrised vs (later) generative-mesh artifacts.
3. **Utilities-in-roads (CS/SimCity, simpler) vs always-separate lines (W&R, deeper).** Spec does roads-by-default **plus** optional dedicated lines — confirm the early-game emphasis.
4. **Sim scale:** when to move the engine into a **Web Worker / SharedArrayBuffer** (needed as parcels + networks + larger maps grow).
5. **Colonist arrival:** continuous immigration vs scheduled **shuttle drops** (more colony-flavoured).
6. **How literal the survival ramp is** (do unserved buildings brown-out gracefully, or is early failure punishing?).

---

## 20. Sources (infra-layer research)

- Cities: Skylines II — [Electricity & Water](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/electricity-water), [Water & sewage wiki](https://skylines.paradoxwikis.com/Water_and_sewage), [City Services](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/city-services-districts-policies)
- Workers & Resources: Soviet Republic — [Infrastructure wiki](https://wiki.hoodedhorse.com/Workers_Resources_Soviet_Republic/Infrastructure), [Water](https://workers-resources.fandom.com/wiki/Water), [Sewage](https://workers-resources.fandom.com/wiki/Sewage)
- Surviving Mars — [Power wiki](https://survivingmars.fandom.com/wiki/Power), [How to Play](https://survivingmars.fandom.com/wiki/How_to_Play_Guide_for_Surviving_Mars)
- SimCity (2013) GlassBox — [Glassbox engine](https://simcity2013wiki.com/wiki/Glassbox), [Wikipedia](<https://en.wikipedia.org/wiki/SimCity_(2013_video_game)>)
- Procedural building generation — [Footprints (devans)](https://martindevans.me/game-development/2016/05/07/Procedural-Generation-For-Dummies-Footprints/), [Real-time floor plans (arXiv 1211.5842)](https://arxiv.org/pdf/1211.5842), [Proc-GS (arXiv 2412.07660)](https://arxiv.org/html/2412.07660v1)

_End of v2 spec. Recommended start: Phase A — the planet, the empty start, and the caravan/solar/battery landing._
