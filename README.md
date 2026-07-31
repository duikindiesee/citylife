# CityLife

CityLife is a browser-based 3D world where players can drive, build, visit places, and grow a
neighbourhood over time. The current application is the React Three Fiber world on `/`; older
experiments remain available only where they are still useful as explicit legacy entry points.

The project is developed in public, with product decisions and implementation contracts kept next
to the code in [`docs/`](docs/README.md).

## What is in the current build

- a procedural island world with terrain, ocean, roads, neighbourhoods, houses, commercial sites,
  landmarks, and nested building interiors;
- third-person walking and driving, road rallies, traffic, buses, stops, and route behaviour;
- an authenticated player experience with persisted world and player state;
- builder, blueprint, GLB, placement-survey, and showroom tooling;
- a deterministic simulation core with Vitest coverage; and
- an authoritative spatial registry that gives parcels, buildings, rooms, doors, seats, roads, and
  portals stable addresses.

CityLife is no longer configured around an Ollama or Gemma mayor. Any future agent runtime is an
external, capability-scoped service and is not a browser-side model setup step.

## Local neighbourhoods

The next neighbourhood boundary is being specified, not advertised as shipped. A player will be
able to link a local Docker or Kubernetes neighbourhood through a CityLife console and a local
connector. Bots may then appear at declared work anchors inside the player's house while their
containers, data, and secrets remain on the local server.

The proposed design has three hard rules:

1. The house is a building plan. Its interior rooms and anchors must fit within its authoritative
   exterior footprint and height envelope.
2. The browser never receives a container socket, DNS token, tunnel credential, or raw vault value.
   CityLife talks to its backend; the backend talks to a narrowly scoped local connector.
3. A secret is represented by a provider-neutral vault reference and safe status metadata. Its value
   stays inside the selected local secret provider.

See [Spec 167 — Local neighbourhood console and bot households](docs/specs/167-local-neighbourhood-console-and-bot-households.md)
for the proposed contract and delivery phases.

## Run locally

Requirements: a current Node.js LTS release and npm.

```bash
npm ci
npm run dev
```

Open [http://localhost:5188](http://localhost:5188).

Before submitting a change, run:

```bash
npm run typecheck
npm test
npm run build
```

## Entry points

| Route | Purpose |
| --- | --- |
| `/` | Current CityLife world |
| `/builder.html` | World and asset builder tools |
| `/kookerbook.html` | In-world reference experience |
| `/town.html` | Legacy town build retained for reference |

## Architecture at a glance

- `src/colony/` owns the current world, simulation, persistence, gameplay, and product systems.
- `src/render/` owns shared rendering primitives.
- `src/engine/` contains the legacy deterministic town engine still covered by tests.
- `docs/specs/` contains numbered mechanics and system contracts.
- `docs/TECH-SPEC-v2-COLONY.md` and `docs/VISION-open-world.md` describe the technical and product
  direction; the numbered specs govern individual slices.

Start with the [documentation index](docs/README.md), then read [`AGENTS.md`](AGENTS.md) before making
changes. `main` is protected: changes ship through a reviewed pull request with tests and the matching
documentation update.

## Security and privacy

Do not commit credentials, personal data, private hostnames, runtime state, or player content. Public
examples use reserved identifiers and `.invalid` domains. Local neighbourhood integrations must fail
closed, use least-privilege capabilities, keep secrets server-side, and expose only the minimum safe
status required by the console.

## Project status

The repository version is recorded in [`package.json`](package.json). Shipped work, active phases,
and proposals are tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`docs/specs/`](docs/specs/).
