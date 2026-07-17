# CityLife

> [!IMPORTANT]
> This README still describes legacy v1/v2 architecture and controls and is not
> the current product contract for the v3 R3F colony. A governed rewrite is in
> progress. Until it is operator-approved, use [the roadmap](docs/ROADMAP.md)
> for current shipped status and verify implementation claims against `main`.

A stylized-3D, agent-driven city that **runs itself** while an **AI mayor governs it** — built to live on a screen and evolve on its own.

> **Origin & tribute.** CityLife grew out of **[CityMind — v1](https://github.com/duikland/citymind)**: an AI-driven city builder where each model reads the rules and writes a script to run the city. The whole idea was sparked by **[Wes Roth](https://www.youtube.com/@WesRoth)** — his benchmark-game video (each AI model generating its own script to play) lodged in my head and wouldn't leave, and his _own_ autonomous city-builder video kicked off this v2. Huge thanks, Wes, for the inspiration and the consistently great content. 🙏
>
> - The original spark: https://www.youtube.com/watch?v=bFO0uAMPx1g&t=844s
> - The video that started v2: https://youtu.be/F_6go08nHv4
>
> **Two builds live in this repo:** the default app (`/`) now loads the **v2 Colony** (a procedural alien-planet colony builder, early Phase A); the **v1 Town** described below lives at **`/town.html`**. Direction docs: [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) (town) · [`docs/TECH-SPEC-v2-COLONY.md`](docs/TECH-SPEC-v2-COLONY.md) (colony) · [`docs/PHASE-B-PROMPT.md`](docs/PHASE-B-PROMPT.md) (next step).

## What it is

- **Layer 1 — the living city** (`src/engine/`): a deterministic, framework-agnostic simulation. Citizens have homes, jobs, wallets and daily routines (sleep → commute → work → shop). Businesses keep their own P&L, produce commodities (ore/lumber/crops/oil/goods), pay wages every **Friday**, and a market discovers prices and GDP. Population grows or shrinks by **migration** driven by jobs + happiness. It runs forever with no AI attached.
- **Layer 2 — the AI mayor** (`src/ai/`): on a **configurable check-in interval (default 10 min)** the governor reads a tiny digest of the city, asks a brain for a small plan, and applies **schema-validated** policy actions (tax, budget, ordinances, zoning). Every decision is logged with its reasoning.
- **Renderer** (`src/render/`): plain three.js — instanced buildings, citizens, **cars + cargo-carrying trucks** driving the road grid, traffic-light posts, trees, a water coastline, day/night sun, and an art pass (ACES tone mapping + bloom). Behind a simple interface so it can be upgraded later.
- **Logistics** (`src/engine/logistics.ts`): a road-tile graph + BFS pathfinding. Cars commute building→building; trucks run a freight cycle (resource → factory → market) carrying visible cargo; soft traffic-light phases pause vehicles at junctions.
- **Runtime** (`src/runtime/`): the fixed-timestep loop, speed control, and the governor's interval timer that ties it all together for the browser.

## The AI brain is swappable

| Provider                 | Status                 | Notes                                                                                           |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------- |
| **Heuristic**            | ✅ built-in, default   | A deterministic rule-based mayor. Always works, no install. Also the fallback if an LLM errors. |
| **Ollama · Gemma (~4B)** | ✅ wired, needs Ollama | Local LLM. Pick it in the AI panel.                                                             |

### Enabling the local Gemma brain

The model runs on **CPU** so the 4 GB GPU stays free for rendering:

```powershell
# install Ollama (https://ollama.com), then:
$env:OLLAMA_NUM_GPU = "0"        # keep the model off the GPU
ollama pull gemma3:4b
ollama serve
```

Then choose **"Ollama · Gemma (local)"** in the AI Mayor panel. If Ollama isn't running, the governor silently falls back to the heuristic mayor.

## Run it

```powershell
npm install
npm run dev        # http://localhost:5188
npm test           # headless engine + governor tests
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

## Using it

- **Watch**: it starts running immediately. Use the speed buttons (1×–60×) up top.
- **Govern**: in the AI Mayor panel set the **check-in interval** (presets 10s/1m/10m/30m or type minutes), pick the brain, toggle `auto`, or hit **Check in now**. The reasoning feed shows what the mayor did and why.

## Status

Phases 0–3 of the spec are functional in MVP form: the city lives, renders in 3D with traffic and an art pass, and the AI governs on a configurable interval. **Done:** agent-based citizens + economy, configurable AI governor, cars/trucks + road-graph logistics, trees/water, tone mapping + bloom. **Next** (see [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) §12): proper A\* with congestion costs, web-worker sim, per-business competing AIs, test-harness model-vs-model meta-game, save/load, TV kiosk mode.
