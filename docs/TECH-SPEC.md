# CityLife — Technical Specification

**Status:** Direction locked. Platform = Web + Three.js. Brain = small local model (Gemma ~4B), swappable.
**Supersedes:** the `citymind` draft (kept as reference) and the 2D sections of the original handover.
**Date:** 30 May 2026

---

## 0. North star

CityLife is a **stylized-3D, agent-driven city that lives on its own and an AI governs**, shown on a TV as an ever-evolving world.

Three reference points define it:

- **Look** — _SimCity BuildIt_: stylized mobile-grade 3D (day/night, water, soft shadows, bright palette). **Not** photoreal AAA. This runs beautifully on a 4 GB GPU and leaves headroom for the sim.
- **Soul** — the Wes Roth / Opus 4.8 demo: ~40 residents living daily routines, hourly wages paid every Friday, businesses with their own P&L + inventory + employees, trucks hauling ore to the copper plant, traffic lights, a commodity market (ore/lumber/crops/oil) with a GDP readout.
- **Skeleton** — the original handover: a frozen **Game API** as the central contract, an AI runtime on top, a test harness, a fixed-tick engine.

### Design pillars

1. **The city runs without AI.** Layer 1 is fully deterministic and self-sustaining.
2. **The AI nudges, it doesn't drive.** Layer 2 makes small, structured, bounded decisions. A 4B model must be enough.
3. **Stylized, not photoreal.** Hold the line at the BuildIt look.
4. **Render and sim are separate.** Sim in a Web Worker; rendering interpolates snapshots at 60 fps.
5. **Everything behind the Game API.** UI, AI, and test harness all consume the identical contract.
6. **Always-on, local-first, free to run.** Local model + IndexedDB; no metered bill for a 24/7 TV city.

---

## 1. The two-layer model (the architectural spine)

```
┌──────────────────────────────────────────────────────────────┐
│ LAYER 2 — AI GOVERNANCE  (occasional, structured, swappable)   │
│   • "Mayor" governor: sets tax / budget / zoning / policy      │
│   • (later) one model per business: price / produce / hire     │
│   • wakes on schedule (every sim-week) or on events            │
│   • emits JSON actions, schema-validated → queued to the API   │
└───────────────▲───────────────────────────┬───────────────────┘
                │ compact metrics digest      │ GameAPI.* actions
┌───────────────┴───────────────────────────▼───────────────────┐
│ LAYER 1 — THE LIVING CITY  (deterministic, 24/7, no AI needed) │
│   citizens · jobs · wages · businesses · market · trucks ·      │
│   cars · traffic lights · power · pollution · happiness         │
│   → runs forever in a Web Worker, emits state snapshots         │
└────────────────────────────────────────────────────────────────┘
```

Layer 1 **must be fun to watch with zero AI attached.** Build it first. Layer 2 sits on top of a city that already works.

---

## 2. Tech stack (concrete)

| Concern              | Choice                                                          | Notes                                                                                                                       |
| -------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Build / app          | **Vite + React + TypeScript**                                   | Evolve the existing draft; convert JS→TS.                                                                                   |
| 3D renderer          | **three.js** via **@react-three/fiber** + **@react-three/drei** | R3F = React-friendly scene graph; drei for camera/controls/helpers.                                                         |
| Post FX              | **@react-three/postprocessing**                                 | Bloom, SSAO, tone mapping, color grade → the BuildIt pop.                                                                   |
| Physics              | none / lightweight kinematic                                    | Agents & vehicles move by interpolation, not rigid-body physics. Add `@react-three/rapier` only if/when we want collisions. |
| Sim thread           | **Web Worker** + **Comlink**                                    | Engine runs off the main thread.                                                                                            |
| Sim↔render transfer | **SharedArrayBuffer** (fallback: structured-clone postMessage)  | Hot agent fields in typed arrays.                                                                                           |
| App state (UI)       | **Zustand**                                                     | Thin; the engine is the source of truth, not React.                                                                         |
| Persistence          | **Dexie.js (IndexedDB)**                                        | City saves, replays, AI run logs. JSON-exportable.                                                                          |
| Local AI             | **Ollama** (OpenAI-compatible at `localhost:11434`)             | Gemma ~4B, **CPU-pinned** (see §8). Swappable for Hermes 4 / Claude.                                                        |
| Tests                | **Vitest**                                                      | Engine + harness unit tests (already wired in the draft).                                                                   |

> The engine layer imports **none** of these — no React, no three, no DOM. It's plain TS so it runs in the worker, in tests, and headless. (Carried over from the handover; non-negotiable.)

---

## 3. Repo structure (`citylife/`)

```
citylife/
├── README.md
├── AGENTS.md                     # rules for coding agents (see §13)
├── package.json  tsconfig.json  vite.config.ts
├── docs/
│   ├── TECH-SPEC.md              # this file
│   ├── game-api.md               # AUTO-GENERATED from src/engine/api.ts
│   └── design-notes.md           # open decisions + tuning log
├── src/
│   ├── engine/                   # ── Layer 1, framework-agnostic ──
│   │   ├── api.ts                # Game API contract  (BUILD FIRST, freeze early)
│   │   ├── world.ts              # grid, lots, buildings, terrain heights
│   │   ├── roadGraph.ts          # nodes/edges, A* pathfinding
│   │   ├── agents.ts             # Citizen model + daily state machine
│   │   ├── business.ts           # P&L, inventory, production recipes, payroll
│   │   ├── market.ts             # commodity supply/demand → prices, GDP
│   │   ├── logistics.ts          # vehicles, trucks, traffic lights, congestion
│   │   ├── services.ts           # power, water, pollution, happiness, risk
│   │   ├── simulation.ts         # tick orchestrator (pass order, §5)
│   │   ├── snapshot.ts           # pack state → SharedArrayBuffer / transferable
│   │   └── config.ts             # ALL tunable constants (no magic numbers in logic)
│   ├── worker/                   # worker host + Comlink bridge
│   ├── render/                   # ── three.js / R3F, behind an interface ──
│   │   ├── Renderer.tsx          # <Canvas>, camera, lights, day/night
│   │   ├── instances/            # InstancedMesh pools: buildings, people, cars
│   │   ├── materials/            # water, terrain, toon/standard materials
│   │   ├── postfx/               # bloom, SSAO, grade
│   │   └── overlays/             # heatmaps (power/pollution/traffic/happiness)
│   ├── ai/                       # ── Layer 2 ──
│   │   ├── LLMProvider.ts        # interface: local Gemma | Hermes4 | Claude
│   │   ├── providers/            # ollama.ts, openaiCompat.ts, anthropic.ts
│   │   ├── governor.ts           # the "Mayor": digest → schema → action
│   │   ├── schema.ts             # JSON action schema + GBNF grammar
│   │   ├── promptBuilder.ts      # compact digest + API menu + win conditions
│   │   └── reasoningLog.ts       # per-decision rationale feed (UI)
│   ├── harness/                  # win/fail conditions, run logging, scoring
│   ├── ui/                       # React: HUD, dashboard, AI panel, toolbar, kiosk
│   └── store/                    # Zustand + Dexie persistence
└── tests/
```

Port the _concepts_ from the draft (`AgentAPI` sandbox, test harness, tick loop). **Replace** `CityEngine.js`'s aggregate `population = rCount * 15` with the agent model — that's the headline change.

---

## 4. Simulation engine — the heart (Layer 1)

### 4.1 Time

- A **sim clock** in sim-minutes. Day = 24 sim-hours, week = 7 days, **payroll runs on Friday**.
- Worker runs a **fixed timestep**: `STEPS_PER_SEC` steps/sec, each step advances `SIM_MIN_PER_STEP` sim-minutes.
- Defaults (in `config.ts`, all tunable): `STEPS_PER_SEC = 20`, `SIM_MIN_PER_STEP = 3` → 60 sim-min per real-sec → **~1 sim-day every 24 real-seconds at 1×**. Speed control 1×–60× scales `STEPS_PER_SEC`.
- Day/night visuals and agent schedules read the sim-hour. (For a calm TV ambience, drop to ~1 sim-day / 5 real-min.)

### 4.2 World

- Grid of **lots** (start **48×48**, design for 128×128). Each lot: zone type, building ref, terrain height, land value, pollution, power/served flags.
- **Terrain** has heights (for the BuildIt hills/water look) — a heightmap, not a flat plane.
- **Buildings** occupy one or more lots; have a `BuildingType`, level (1–3 density), occupancy (residents/jobs), and a door node on the road graph.

### 4.3 Citizen (agent) model

The core structure. Hot fields live in typed arrays (SoA) for cache efficiency and cheap transfer; cold fields in a parallel object array.

```ts
interface Citizen {
  id: number;
  homeId: number; // building
  workId: number | null; // business/building (job)
  wallet: number; // personal balance sheet
  wagePerHour: number;
  // needs 0..100, decay over time, drive decisions:
  energy: number;
  hunger: number;
  money: number;
  fun: number;
  state:
    | "Sleeping"
    | "Commuting"
    | "Working"
    | "Shopping"
    | "Leisure"
    | "JobHunting"
    | "Home";
  posX: number;
  posY: number; // world position (interpolated by renderer)
  path: number[] | null; // road-graph node ids
  vehicleId: number | null;
}
```

- **Behavior = schedule + utility nudges**, NOT an LLM per citizen (that's the cheap, scalable choice that lets it run 24/7). A template day (sleep 22–06, commute, work 08–17, shop/leisure) is modulated by needs: low `hunger` → seek shop/food; low `money` + no job → `JobHunting`; weekend → leisure.
- **Migration replaces the old growth curve:** citizens move _in_ when jobs are plentiful + happiness high; move _out_ when unemployed/broke/unhappy. Population is the emergent count of resident agents — the SimCity→Sims shift.

### 4.4 Business model

```ts
interface Business {
  id: number;
  buildingId: number;
  kind: BusinessKind; // mine, sawmill, farm, oil, factory, shop...
  cash: number;
  inventory: Record<Commodity, number>;
  recipe: {
    inputs: Partial<Record<Commodity, number>>;
    outputs: Partial<Record<Commodity, number>>;
    laborHours: number;
  };
  employees: number[]; // citizen ids
  wageOffer: number;
  price: Record<Commodity, number>;
  pnl: {
    revenue: number;
    cogs: number;
    wages: number;
    overhead: number;
    profit: number;
  }; // per period
}
```

- Each period a business: buys inputs at market price → produces outputs (gated by labor present + inputs) → sells → pays **wages on Friday** → banks profit. Bankrupt businesses close; their employees become `JobHunting`.
- This is the unit an LLM will later run (price/produce/hire) — the video's roadmap.

### 4.5 Market & economy

- Commodities: **ore, lumber, crops, oil** (+ intermediate/finished goods later).
- Per period, per commodity: `supply` = total produced, `demand` = total consumption/orders. Price moves toward equilibrium:
  `price *= clamp((demand / max(supply, ε))^K, 0.5, 2.0)` with smoothing — a simple, _legible_ model a 4B model and a human can both reason about.
- **GDP** = Σ value-added across businesses per period (revenue − intermediate inputs). Charts: GDP, prices, freight/production (match the video's HUD).

### 4.6 Logistics

- **Road graph**: nodes = intersections/road tiles, edges = segments with `cost = length × (1 + congestion)`.
- **A\*** pathfinding for commuters (cars) and freight (trucks). Trucks carry out **physical tasks**: e.g. load ore at the mine/dock → drive to the copper plant → unload (exactly the demo's truck behavior).
- **Traffic lights** = state machines at intersections that gate edge entry. **Congestion** = per-edge vehicle count feeding back into edge cost (and into the traffic heatmap).

### 4.7 Tick pass order (one sim-step)

```
1. TIME      advance clock; fire day/week/Friday boundaries
2. AGENTS    decay needs; (re)choose state; request paths
3. MOVEMENT  advance vehicles/agents along paths; traffic-light gating; update congestion
4. PRODUCE   businesses consume inputs + labor → outputs
5. MARKET    clear supply/demand → update prices; compute GDP
6. FINANCE   Friday payroll; taxes to treasury; maintenance; business P&L
7. SERVICES  power/water reach; pollution spread; happiness; risk events
8. MIGRATE   citizens in/out based on jobs + happiness
9. SNAPSHOT  pack state → SharedArrayBuffer; post delta to main thread
```

### 4.8 Performance

- Start **40 agents** (match the demo); architecture targets **~1,000**.
- SoA typed arrays; fixed timestep; sim decoupled from render. The worker never touches the DOM.
- Headless mode (no renderer) for benchmarking + the test harness (resolves handover open-decision #4).

---

## 5. Rendering — the SimCity BuildIt look (Layer-1 view)

The renderer sits **behind an interface** (`Renderer.tsx` is one implementation) so it can be upgraded without touching the engine.

- **Camera:** perspective, tilted ~35–45° (BuildIt's pseudo-iso), orbit + pan + zoom (drei `MapControls`). Optional slight tilt-shift for the "toy city" feel.
- **Buildings/props:** **InstancedMesh** pools per building type — thousands of meshes, few draw calls. Start with primitive massing (boxes + rooflines) and good lighting; swap in a modular low-poly kit later (§11) behind the same interface.
- **Citizens & vehicles:** instanced low-poly meshes; positions **interpolated** between sim snapshots for smooth 60 fps motion independent of the 20 Hz sim.
- **Lighting:** one directional "sun" driven by the sim-hour (day/night arc + color temperature), soft shadow map, ambient/hemisphere fill, baked AO on building meshes.
- **Water:** animated shader (BuildIt's signature) on lakes/rivers/coast from the terrain heightmap; auto-bridge roads crossing water.
- **Greenery:** instanced trees as green buffers (the aesthetic the reference calls out).
- **Post FX:** bloom (sun glints), SSAO (contact shadows), ACES tone mapping, a bright color grade. This is what sells "premium" without expensive geometry.
- **Overlays (Phase 2):** heatmaps for power/pollution/traffic/happiness/land-value as a shader pass over the ground.

**4 GB GPU budget:** target 1080p/60 (cap at 60). Lean on instancing, a texture atlas, frustum culling, 2–3 LODs, shadow-map resolution ≤ 2048. The GPU is for _pixels only_ — the AI model does **not** touch it (§8).

---

## 6. The Game API (the frozen contract — build first)

One object consumed identically by UI, AI, and harness. Every mutator returns `{ ok, cost?, error?, delta? }`. **Auto-generate `docs/game-api.md` from these TS types** so docs never drift.

```ts
interface GameAPI {
  // ── queries ──
  getState(): CitySnapshot; // compact: metrics + counts, not the full grid
  getDigest(): MetricsDigest; // tiny summary built FOR the AI (see §7)
  getTile(x: number, y: number): TileInfo;
  getCitizen(id: number): Citizen;
  getBusiness(id: number): Business;
  getMarket(): Record<
    Commodity,
    { price: number; supply: number; demand: number }
  >;
  getHeatmap(
    type: "power" | "pollution" | "traffic" | "happiness" | "land_value",
  ): Float32Array;
  getMetrics(nTicks: number): TimeSeries; // for trend charts / AI

  // ── zoning & building ──
  zone(x: number, y: number, type: ZoneType, density?: 1 | 2 | 3): Result;
  zoneRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    type: ZoneType,
  ): Result;
  placeBuilding(x: number, y: number, id: BuildingId): Result; // power_plant, fire, hospital, water_tower...

  // ── infrastructure ──
  buildRoad(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    kind?: RoadKind,
  ): Result; // pathfinds route
  buildPipeline(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    kind: "power" | "water" | "sewer",
  ): Result;

  // ── policy & budget ──
  setTaxRate(zone: ZoneType, rate: number): Result; // 0..0.25
  setBudget(cat: BudgetCategory, amount: number): Result;
  passOrdinance(id: OrdinanceId): Result;
  issueBond(amount: number, termYears: number): Result;

  // ── sim control ──
  setTickSpeed(mult: number): Result; // 1..60
  waitTicks(n: number): Promise<void>; // for script pacing
}
```

> Freeze the **shape** before building UI or AI. Changing it is deliberate and regenerates the docs. (Carried straight from the handover — still the most important rule.)

---

## 7. AI governance (Layer 2) — designed for a 4B model

The whole trick: **make every decision small enough that a 4B model is plenty, and let the simulation carry the intelligence.**

### 7.1 Swappable provider

```ts
interface LLMProvider {
  name: string;
  decide(prompt: string, schema: JSONSchema, grammar?: GBNF): Promise<object>;
}
// providers/ollama.ts (default, local Gemma) | openaiCompat.ts (Hermes 4) | anthropic.ts (Claude)
```

Same interface for all three. Swap by config. Benchmark Gemma vs Hermes 4 vs Claude _as mayors_ with the harness (§9) — **that** is the "game of games" you wanted: model-vs-model, strategy-vs-strategy.

### 7.2 The Mayor governor

- **Cadence:** wakes every sim-week (scheduled) **and** on events (treasury deficit, blackout, happiness < threshold, bankruptcy spike).
- **Input:** a **`MetricsDigest`** — a _tiny_ hand-built summary (population, treasury, Δpop, happiness, unemployment, top 3 problems, market prices, current tax/budget). **Never the full grid.** Small models reason far better over a curated digest than a wall of state.
- **Output:** a short **JSON action list** validated against `schema.ts`, decoding constrained by a **GBNF grammar** so a 4B model literally cannot emit malformed/illegal actions:
  ```json
  [
    {
      "action": "setTaxRate",
      "args": ["residential", 0.08],
      "why": "unemployment high, attract residents"
    },
    {
      "action": "setBudget",
      "args": ["safety", 1200],
      "why": "crime rising downtown"
    }
  ]
  ```
- Actions are queued to `GameAPI.*` and applied on the next tick. The `why` strings stream to the **reasoning feed** (the signature UI element) tagged with the tick.

**JSON-not-JS (resolves handover open-decision #3):** with a 4B model, schema-constrained JSON is far safer and more reliable than AI-authored executable JavaScript. No sandbox-escaping arbitrary code; just a validated action menu.

### 7.3 Per-business AI (later — the demo's roadmap)

Each business gets a micro-context (its P&L, inventory, local prices) and returns price/production/hiring as constrained JSON. N businesses = N cheap calls. This is where "AI models run businesses and compete" lives — and where a local model's low cost shines.

---

## 8. Running the brain on a 4 GB box (the "if we can" — we can)

**The constraint:** the 3D city already wants ~0.5–1.5 GB VRAM. A 4B model at Q4 wants ~2.5–3 GB VRAM. **Both won't fit in 4 GB at once.**

**The resolution: pin the model to CPU; the GPU renders only.**

- Run **Gemma ~4B at Q4_K_M via Ollama**, forced to **CPU** (`num_gpu: 0`). Weights live in system RAM (~3 GB), GPU stays 100% for pixels.
- CPU inference of a 4B/Q4 model ≈ **8–20 tok/s**. A governance decision is ~100–300 tokens → a **few seconds**.
- That's totally fine because decisions are **infrequent and async**: the sim keeps ticking in the worker while the call is in flight; the action is queued when it returns. **No stall, ever.**
- Today that's **Gemma 3 4B** (real, strong, instruction-tuned); slot in **Gemma 4** when it lands — the `LLMProvider` interface makes the swap a one-liner.
- **Local-first also resolves handover open-decision #5:** no API keys, no proxy, nothing metered. A remote self-hosted model (e.g. Hermes 4 behind an OpenAI-compatible endpoint) and Claude are the same interface for when you want bigger reasoning on demand.

---

## 9. Test harness & the meta-game

From the handover, lightly updated for agents. Monitors metrics each tick against win/fail conditions; logs timestamped results; supports **parallel headless runs**.

- **Starter suite:** reach 1,000 residents by tick T (fail < 200); stay solvent; happiness ≥ 0.60 rolling; service coverage; no catastrophic fires.
- **Prosperity suite:** 10k residents at >75% prosperity sustained; income > costs for 20 ticks zero-debt; avg residential pollution < 30.
- **Run record:** run id, **which model/provider was mayor**, personality preset, tick-by-tick log, pass/fail per condition, weighted score, replay file.
- **The meta-game:** run Gemma vs Hermes 4 vs Claude (and personality presets — "Growth maximiser", "Eco mayor", "Low-tax", "Welfare state", "Industrial") on the same seed, score them side by side. This is CityLife's "game of games."

---

## 10. Persistence & the always-on TV mode

- **Dexie/IndexedDB:** city saves, autosave, AI run logs, replays. JSON export/import.
- **Replays:** the action+event log replays at any speed (re-watch a run).
- **Kiosk mode:** a full-screen, chrome-less ambient view for the TV. Run it on a mini-PC / NUC / spare box plugged into the TV, browser in kiosk mode pointed at the local URL; the sim runs 24/7, the local model governs, IndexedDB persists across restarts. Optional **headless catch-up** so a closed tab "simulates forward" on resume.

---

## 11. Art pipeline — "evolve our own artwork"

The renderer interface means art can level up without touching the sim:

1. **Now (day 1):** primitive massing (boxes, simple roofs) + great lighting/post-FX. Looks surprisingly good immediately.
2. **Soon:** a **modular low-poly kit** (free Kenney city packs, or a Synty-style purchased kit) as glTF, one texture atlas, instanced. This alone gets you ~80% of the BuildIt look.
3. **Evolve:** commission or **AI-generate** custom 3D assets (text-to-3D → glTF) for signature buildings/landmarks as the city's identity grows. Swap them in lot-by-lot.

Keep all meshes low-poly + instanced; the _lighting, water, and post-processing_ do the heavy lifting for "premium," not polygon count — which is exactly why a 4 GB card suffices.

---

## 12. Build phases (re-cut for this project)

| Phase                            | Scope                                                                                                                                            | Outcome                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| **0 — Repo + slice**             | Stand up `citylife/`, TS engine skeleton, R3F canvas, **one citizen** walks home→job→home and gets paid Friday, rendered in 3D.                  | The vertical slice proves the architecture. |
| **1 — Living city**              | 40 agents, businesses + P&L, commodity market + GDP, roads + A\* + trucks + traffic lights, day/night, instanced buildings. Self-running, no AI. | A city that's fun to watch on its own.      |
| **2 — Systems + look**           | Power/water/pollution/happiness, services, risk events, heatmaps/overlays, water shader, modular art kit, the full Game API frozen + auto-docs.  | The SimCity BuildIt look + depth.           |
| **3 — AI governance**            | `LLMProvider` + local Gemma (CPU), the Mayor governor, schema/grammar, reasoning feed, agent-config UI.                                          | The AI runs the city.                       |
| **4 — Harness + meta-game + TV** | Win/fail suites, parallel headless runs, model-vs-model scoring, replays, kiosk mode, per-business AI.                                           | The "game of games" on your TV.             |

### First vertical slice (Phase 0 — the next concrete step)

A single citizen, a single home, a single workplace, a 3 km of road, a 3D scene:

1. Engine: `world` + `roadGraph` + one `Citizen` with the daily state machine + Friday payroll.
2. Worker: tick at 20 Hz, post snapshots.
3. Render: R3F canvas, ground, two boxes (home/work), one instanced "person" interpolating along the path, a day/night sun.
4. HUD: clock, the citizen's wallet ticking up on Friday.

When that loop is alive, every later system is "add more of the same."

---

## 13. Resolved decisions & `AGENTS.md` rules

**Handover open decisions, now resolved by the locked direction:**

1. Renderer → **three.js / R3F (3D)**, behind a swappable interface. _(was Canvas2D vs PixiJS)_
2. Population growth → **emergent from agents** (migration on jobs+happiness), not a logistic curve. Weights still in `config.ts`.
3. AI action format → **schema + grammar-constrained JSON**, not AI-authored JS (safer for a 4B model).
4. Parallel/headless runs → **yes**, first-class (benchmarking models as mayors).
5. AI key handling → **local-first** (Ollama, no keys/proxy); remote providers behind the same interface.

**Rules for coding agents (seed `AGENTS.md` with these):**

- `src/engine/` imports no React/three/DOM. Plain TS only — it runs in a worker and in tests.
- `src/engine/api.ts` is the frozen contract; change it deliberately and regenerate `docs/game-api.md`.
- All tunable numbers live in `src/engine/config.ts`. No magic numbers in logic.
- Sim and render are decoupled: the worker never touches the DOM; the renderer never mutates engine state — only via `GameAPI`.
- The GPU renders; the LLM runs on CPU. Never load the model onto the GPU.
- Round every number shown in the UI.
- Build Layer 1 so it's watchable with **zero** AI before writing any Layer 2.

---

_End of spec. Start at §12 "First vertical slice." The Game API (§6) and the engine skeleton are the first code to write._
