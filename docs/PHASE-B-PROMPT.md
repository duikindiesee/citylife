# CityLife Colony — Phase B prompt (the next step)

> Paste this as the next task. It is self-contained. Read `docs/TECH-SPEC-v2-COLONY.md` (§4–§8) first for the full model.

## Goal

Make the colony **grow from the landing site**. On top of Phase A (planet + caravan + solar + battery), build the **construction loop**:

> claim a parcel → AI **architect** designs a building → it's **queued & paid for** → a **construction crew drives out and builds it in stages** → **colonists arrive by car** → the building draws **power**.

Plus the first **roads** (with the hard road-access rule) and a **power network** extending from the battery.

## What already exists (build on it — do NOT replace)

- `src/colony/terrain.ts` — `Terrain`: heightfield, biomes, `water`, `buildable` (0 blocked / 1 grade / 2 flat), `worldY(x,y)`, `idx(x,y)`, `landing`. Use these for placement/validation.
- `src/colony/sim.ts` — `ColonySim`: clock + day/night, solar→battery power, seed `structures`. **Extend `ColonyState`** with `treasury`, `parcels`, `buildings`, `jobs`, `roads`, and grow `colonists`.
- `src/colony/render/PlanetRenderer.ts` — terrain mesh, ocean, planet ball, structures, day/night, camera presets, view modes. **Add**: roads, parcel ghosts, construction-stage meshes, building meshes. (Renderer runs at `pixelRatio 1` + light bloom — keep new per-frame work modest.)
- `src/colony/runtime.ts` — fixed-timestep loop + `getUiState()`. **Extend** UI state + add control methods.
- `src/colony/ui/ColonyApp.tsx` — HUD + toolbar. **Add** a build menu + construction-queue panel.
- Reuse from v1: `src/engine/rng.ts`; the **GameAPI** contract pattern (`src/engine/api.ts`); the **`LLMProvider` + Governor check-in** machinery (`src/ai/`); the **vehicle/logistics** idea (`src/engine/logistics.ts`) for the construction crew + colonist cars.

## New data models → `src/colony/types.ts`

```ts
interface Parcel {
  id: string;
  x: number;
  y: number;
  w: number;
  d: number;
  zone: "residential" | "commercial" | "industrial" | "civic";
  graded: boolean;
}
interface BuildingArtifact {
  // minimal proc-gen (TECH-SPEC-v2 §7)
  id: string;
  category: Parcel["zone"];
  footprint: { w: number; d: number };
  floors: { poly: { x: number; y: number }[]; height: number }[];
  roof: "flat" | "gable" | "none";
  palette: { wall: string; roof: string };
  capacity: { residents?: number; jobs?: number };
  load: { power: number; water: number; sewage: number; waste: number };
  cost: { materials: number; build: number };
  buildTime: number;
}
interface ConstructionJob {
  id: string;
  parcelId: string;
  artifactId: string;
  stage:
    | "queued"
    | "grading"
    | "foundation"
    | "framing"
    | "envelope"
    | "finishing"
    | "done";
  progress: number;
  paid: boolean;
  crewId?: number;
}
interface RoadSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  tier: "track" | "paved";
}
interface ColonyBuilding {
  id: string;
  parcelId: string;
  artifactId: string;
  served: boolean;
}
```

## Systems to build (engine, framework-agnostic)

1. **Treasury** — add to `ColonyState`; a starting budget. Everything below is paid from it.
2. **Land Planner / parcels** (`src/colony/land.ts`) — `claimParcel(x,y,w,d,zone)`: validate every cell is `buildable !== 0`; cost ∝ area × biome; if any cell is `buildable===1`, allow a `gradeParcel(id)` (extra cost) that marks it flat. Reject overlaps.
3. **Roads** (`src/colony/roads.ts`) — `buildRoad(ax,ay,bx,by)` snapped to the cell grid; pay per length × tier; maintain a road-cell set + graph. **Hard rule:** a parcel must be adjacent to a road cell to host a building (`isRoadAdjacent(parcel)`).
4. **Architect** (`src/colony/architect.ts`) — `designBuilding(category, parcelSize): BuildingArtifact`, procedural per TECH-SPEC-v2 §7 (additive footprint for houses, per-floor inset, palette by biome). Content-hash + cache so designs are reused. (Leave a seam to swap in an LLM that picks style params later.)
5. **Construction pipeline** (`src/colony/construction.ts`) — `queueBuilding(parcelId, artifactId)`: charge `materials+build`; create a `ConstructionJob`. A **construction crew** (vehicle, reuse logistics) spawns at the caravan, drives the road to the parcel, then the job advances `grading→foundation→framing→envelope→finishing→done` over `buildTime`. On `done`: create a `ColonyBuilding`, register its `load`, and **spawn 2–4 colonists** who arrive by car and increment `colonists`.
6. **Power network** (`src/colony/power.ts`) — flood-fill supply from battery/solar (and future plants) along roads/short lines to buildings within range; sum `load`; if `load > solar + batteryDraw`, mark furthest buildings `served=false` (brownout → inactive). Expose served/unserved counts.
7. **AI auto-grow loop (recommended)** — reuse the v1 governor/check-in: each check-in, if budget + power allow, the heuristic Planner claims the next parcel, lays a road to it, the Architect designs a habitat, and it's queued. Result: the colony **builds itself** while you watch. Make the brain swappable (`LLMProvider`) exactly like the v1 Mayor.

## Renderer additions (`PlanetRenderer.ts`)

- Roads: thin ribbons/boxes along segments, following terrain height.
- Parcels: translucent ghost rectangles colored by zone until built.
- Construction: a partial mesh per `job.stage` (slab → frame → shell) + the crew vehicle on site.
- Buildings: build a mesh from `BuildingArtifact` (extrude floor polygons + roof + palette). Reuse the v1 dollhouse builder approach; `openInterior` optional.

## UI additions (`ColonyApp.tsx`)

- A **Build** menu: pick zone, claim a parcel (click or auto), queue a habitat, toggle grading.
- A **Construction queue** panel: jobs with stage + progress bars.
- A **Power** readout: served / total buildings, load vs supply, battery.

## Config → add to `COLONY`

`land` (parcel base cost, grade cost), `roads` (tier cost/length), `construction` (stage durations, crew count, material cost), `architect` (footprint + roof style sets per biome), `power` (per-building load, supply range).

## Acceptance criteria (Phase B is done when)

- From the empty landing, you **or the AI** can: claim a parcel → build a road to it → design + queue a habitat → watch a crew drive out and build it stage-by-stage → see colonists arrive by car → battery load rises.
- Every building is road-connected; unreachable/overlapping/steep parcels are rejected (or require grading).
- **Headless tests** (deterministic by seed): claiming a parcel + running a `ConstructionJob` to `done` adds a `ColonyBuilding`, colonists, and power load; an over-loaded grid produces a brownout.
- `npm run typecheck` clean · `npm run build` clean · all tests green · a daytime screenshot shows a road + at least one built habitat with a colonist car.

## Order

types → land+roads → architect → construction → power → renderer → UI → AI auto-grow → tests + screenshot.

## Guardrails

- Keep `src/colony/*` framework-agnostic **except** `render/` and `ui/`.
- All spend flows through the colony **treasury**; pay for land, grading, roads, construction, and upgrades.
- Reuse v1 `GameAPI`/`LLMProvider`/governor patterns; don't reinvent the AI plumbing.
- The full-ball **Planet** view is GPU-heavy (atmosphere + bloom overdraw) — keep added per-frame work cheap and instanced.
