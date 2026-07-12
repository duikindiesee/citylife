# KOOKER — Living-World Roadmap

> The single source of truth for **what we're building and where it sits**. Epics are lanes; each lane drills to its tasks. Product leads; the substrate is _one lane_, not the whole board; the fleet that builds it gets its own track.
>
> **Interactive view:** https://claude.ai/code/artifact/c80b121b-c57a-475a-ae6d-446e5a6477ac > **Last updated:** 2026-07-11 · **Owner:** Irwin (operator) · **Maintained by:** Claude (fleet lead)

## How to read this

- **Three tracks.** `CityLife` (the world people live in) · `Substrate` (the AI backend) · `Fleet` (the bots that build & tend it).
- **Five phases** — the same vocabulary the in-world KOOKER Roadmap HUD already speaks: **Shipped → Merging → Next → Later → Parallel.**
- **Epics → tasks.** Each epic below lists its tasks under the phase they sit in, with the PR / spec reference.
- **Status marks:** ✅ shipped · 🔨 in flight · ○ planned.

**The decluttering principle (why this doc exists):** the live workstream had drifted to hold _the plan itself_ (9 "Agree the solution: S5/G1/G2…" tasks) instead of the work. Here the substrate's S/G/E/W phases live in **one track**; the product epics own the rest; the plan-of-record ([`kooker-living-world-substrate-plan.md`](kooker-living-world-substrate-plan.md)) stays the deep design doc, and _this_ is the flight-board on top of it.

---

## Track 1 — CityLife (the world)

### V3 Renderer (R3F port)

- **Shipped** ✅ R3F PlanetRenderer migration `#227` · finish the port (porters, nameplates, cars) `#256` · delete the legacy renderer, parity tests carry it `#264` · metric world + player proportion `#275` · smooth road ribbons `#252`
- **Merging** 🔨 NaN bounding-sphere boot fix `#259` · ship-PR lane sync into main `#286`

### Roads & Junctions

- **Shipped** ✅ one connected web `#289 · spec148` · honest bridge check `#291` · clean ragged intersections `#290` · no roads on beaches `#279 · spec138` · crowd stands on the ribbon `#280`
- **Merging** 🔨 beach guard stops shattering grazing roads `#288` · drape junction caps over the ground `#272`

### Builder & Furniture ★ _actively building_

- **Shipped** ✅ house builder base — self-design, blueprint edit `#144`
- **Next** ○ multi-level floor plans · interiors (walls, rooms, fit-out) · **custom furniture shop — design your own** · store designed furniture as **virtual inventory**
- **Later** ○ expand what is possible to build (tooling `/loop`)

### Bus System

- **Merging** 🔨 bus depot, fleet schedule, first-person boarding `#282 · spec140` · authored bus depot GLB `#287`

### Commercial & Shops

- **Shipped** ✅ seat & scale commercial venues to plots `#281 · spec140` · stop the street building a red wall `#278`
- **Merging** 🔨 seat painted CommercialBlocks on graded pads `#292` · fix shop placement & scale `lane #281`

### First-person / Player (Colony Slate)

- **Shipped** ✅ viewmodel arms + diegetic HUD `#273` · walker on leveled ground `#253` · column-major heightfield collider `#261`
- **Next** ○ bring back tilting the world camera `#293 · spec148`

### Avatars & Characters

- **Shipped** ✅ Joe animated crab GLB, live in-world `#257` · canonical crab upgrade `#263` · animated tarentaal flocks `#267`
- **Next** ○ Alice the steampunk spider (glb built, pending ship) · self-serve avatar upload (bot PAT + human JWT, one review queue)

### Landmarks & Civic Art

- **Shipped** ✅ benches, lamps, fountains render in v3 `#251` · Horizon Spire monument `spec033` · Ironwork Pillar "The Escapement" spec `#258 · spec116`
- **Next** ○ pillar render slice `ironworkPillarProps` (gated on Irwin's visual sign-off)

---

## Track 2 — The Substrate (the backend) · _one lane, not the whole board_

### Task API & Workstreams (S1–S6) ★

- **Shipped** ✅ S1 domain nodes + generalized scope overlap · S2 registration + live 409 hard-block · S3 tasks: create · claim · report · events
- **Next** ○ S4 kooker-web board (this roadmap, live) · S5 fleet crons pull from the Task API
- **Later** ○ S6 Antigravity registers its stream

### Role-gated task/epic creation (S3.5)

- **Next** ○ `TaskCreatePolicy` + per-role capability table · Riaan files work via role, not GitHub write (see plan Part 10)

### Living World (G1–G3)

- **Later** ○ G1 pilot NPC — plot allocation as tasks · G2 life-events as tasks, cost-governed · G3 citizen pods claim like bots + in-game chat

### Memory & Federation (E1–E4)

- **Later** ○ E1 memories + the collective library · E2 games inside games · E3 Irwin's people (the WHY)
- **Parallel** ○ E4 friends' agents → the federated city (north star)

---

## Track 3 — The Fleet (the bots)

### Concierge (Alice)

- **Shipped** ✅ vision fixed end-to-end `#194/#196` · Ask-Kooker public + private Q&A gate `PR179/393` · quiet-in-groups unless tagged, fleet-wide `blueprints#8`
- **Merging** 🔨 log-a-question skill → operator review queue

### Fleet, Release & Access

- **Shipped** ✅ release pipeline self-heals (node-version-bump) `workflows#46` · role-based access + blueprint sharing `#198`
- **Merging** 🔨 kooker-hermes-base image + mind presets
- **Later** ○ fleet console — cockpit + single pane (W-track)

---

## The APIs we need (one surface per job)

| Surface                         | Base · auth                                     | Key routes                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Swarm / Task API**            | `/api/swarm/**` · PAT self-auth (OwnerResolver) | `POST workstreams` (409 on overlap) · `GET workstreams/tasks/next?dryRun` · `POST …/tasks` + `…/claim` + `…/{id}/report` · `POST personas` · `GET worlds/{id}/events`            |
| **Backoffice / Board**          | `/api/v1/ai/backoffice/**` · JWT + role         | `GET roadmaps` (epics, ordering — the board reads this) · `GET/POST blueprints`                                                                                                  |
| **Concierge Q&A**               | `/api/v1/ai/qa/**` · `/api/public/qa/**`        | `POST qa/ask` (COLLABORATOR) · `public/qa/ask` (no-auth, scrubbed) · `GET qa/review` · `POST qa/{id}/answer {makePublic}`                                                        |
| **Inference router**            | `/api/v1/ai/route/**`                           | `POST route/chat` — per-owner rate-limit → interceptors → billing · ModelPolicy per identity                                                                                     |
| **Identity & Economy**          | `/kooker/api/**`                                | `POST auth/basic` → JWT + roles · `POST users` (settler, 750 KCO) · `citylife/neighbourhoods · plots · KCO ledger`                                                               |
| **Builder & Furniture** _(NEW)_ | the surface the builder lane needs              | `furniture/design → inventory` (store a designed item) · `builder/blueprint` (multi-level floor plans, edit, publish) · `inventory` (a citizen owns & places what they designed) |

_Live status:_ `GET /api/swarm/workstreams` and `…/workstreams/roadmaps` are up (S3). `GET /api/v1/ai/backoffice/roadmaps` and an epics endpoint are the **S4 gap** — building them makes kooker-web's `Workstreams.jsx` render this board from live data. The **Builder & Furniture** surface is the newest need, driven by the custom-furniture-with-inventory work.

---

## How this stops being a doc and becomes the live board

1. **S4 backend** — a `GET /api/v1/ai/backoffice/roadmaps` (+ epic create/order) that returns Roadmap → Epic → Task. Owner: Joe.
2. **kooker-web** — evolve `src/pages/Workstreams.jsx` (already renders the graph as bot-swimlanes × lifecycle) to add this **epic-timelanes × phase** view with drill-to-tasks, matching the artifact. Owner: Jack.
3. **Declutter** — the 9 "Agree the solution" plan-as-tasks are parked; product epics seed under a `CityLife` roadmap distinct from the `Substrate` roadmap.

## For agents working a lane

Find your epic above. When you open a PR, it _is_ a task under that epic — reference the epic name in the PR body so the board can group it. Keep the substrate work in the Substrate track; keep product work in CityLife. Don't seed plan text as tasks — the plan lives in the plan-of-record; the board holds work.
