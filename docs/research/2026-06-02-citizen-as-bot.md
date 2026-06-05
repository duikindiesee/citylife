# Citizen-as-bot — the operator's directive becomes the architecture

## The directive

> Use the bot spawner we built to insert a running hermes container into our kind cluster in its own
> bot space so it is dmz from the rest of kooker. Like skoonveld. New kooker citylife user equals
> hermes bot with our hermes-openai-gpt-5.5 inference. Land all city documentation in the container,
> let the bot APIs interact with the world, vision and first-person, snapshots fed into the governor
> loop so the bot can shape the world he lives in.

Six things to wire together:

1. **One real Hermes pod per resident** — spawned via the existing `kooker-bot-spawner` flow.
2. **A real `kooker-user` per resident** — role `CITYLIFE_CITIZEN`, with `botId`, `householdId`,
   `houseId` persisted against that user.
3. **DMZ namespace** — `citylife-citizens`, NetworkPolicy egress only to `kooker-service-ai`
   (the inference choke point) and the citylife backend. No reach into kooker-web, kooker-service-
   ledger, kooker-service-auth, neo4j, eureka, dashboards, or sibling bots.
4. **City docs mounted into each container** — VISUAL-STANDARD, the spec queue, the research, plus a
   per-citizen "this is your world" pack (your house, your neighbours, your view).
5. **Bot APIs to interact with the world** — read state (who lives next door, what's in stock, who
   is hiring), and act (propose a spec, ask for work, request a move).
6. **First-person vision** — the renderer takes a snapshot from the citizen's house; the snapshot is
   passed to the governor loop alongside the bot's reasoning; the governor decides what changes.

## What already exists (we extend, we do not rebuild)

- **`kooker-bot-spawner`** (`D:\infra\kooker-bot-spawner\server.js`) — `POST /bots/provision` already
  creates a PVC, Secret, Deployment, Service per bot. Hermes is a first-class type. The bot pod is
  already wired to talk inference through `kooker-service-ai.kooker.svc.cluster.local:8088/api/v1/ai/route`
  (the choke point), so rate-limiting, metering and the InferenceInterceptor SPI cover it for free.
  Telegram tokens, allowed users and home channel are already supported envs.
- **`bots.ts`** (citylife) — `BotService`, `KookerInferenceBotAdapter`, `MockBotAdapter`, the
  six-turn history cap, the Border Patrol singleton, plot allocation. The adapter is an SPI.
- **`newcomers.ts`** — `generateHousehold(seed)` deterministically generates a fictional, denylist-
  vetted family with lead persona, education, motivation, holdings. This is already the input to
  Border Patrol; it becomes the input to citizen-spawning too.
- **`cityPlan.ts`** — `Plot { id, name, description, assignedTo }`. The assigned plot IS the
  citizen's address.

The new work is the join: take an approved household, mint a kooker user, provision a Hermes pod,
record the pod URL as that household's bot adapter going forward, mount the docs, and add the
first-person view as a sim-engine read.

## Architecture

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                     citylife (browser, :5188)                                  │
│  Border Patrol singleton bot ──> approves Household ──> backend.assignHouse() │
│                                                          │                     │
│  for each Plot row in HUD: "First-person"  ──> PlanetRenderer.capturePNG(at  │
│        citizen.houseXY, lookDir=street) ──> data:image/png base64             │
│                                                          │                     │
│  governor loop (existing :17 cron) ──> reads citizen.lastSeen + asks pod     │
└───────────────────────────────────────────────────────────────────────────────┘
                              │                            │
                              ▼ POST /citylife/citizens    ▼ POST /chat
┌──────────────────────────┐   ┌────────────────────────────────────────────┐
│ kooker-user (existing)   │   │ kooker-service-ai (existing choke point)    │
│  role=CITYLIFE_CITIZEN   │   │  POST /api/v1/ai/route/chat                 │
│  +botId +householdId     │   │  model=hermes-openai-gpt-5.5                │
│  +houseId +pat (gitignor)│   │  Bearer=per-citizen PAT (BOT_PAT)            │
└──────────────────────────┘   └────────────────────────────────────────────┘
                                              │
                                              ▼ (network policy: ONLY this hop)
┌───────────────────────────────────────────────────────────────────────────────┐
│                        kind cluster, namespace: citylife-citizens             │
│                                                                                │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                     │
│  │ pod: bot-pim-quill-3a   │  │ pod: bot-wren-marrow-7c │   …one per citizen   │
│  │   image: hermes:latest  │  │   image: hermes:latest  │                     │
│  │   PVC: per-bot home     │  │   PVC: per-bot home     │   (persistent       │
│  │   ConfigMap: city-docs  │  │   ConfigMap: city-docs  │    memory across    │
│  │   Telegram: dedicated   │  │   Telegram: dedicated   │    pod restarts)    │
│  │   env: CITIZEN_ID,      │  │   env: CITIZEN_ID,      │                     │
│  │        HOUSE_XY,        │  │        HOUSE_XY,        │                     │
│  │        HERMES_PROFILES  │  │        HERMES_PROFILES  │                     │
│  │   svc: 18789/gateway    │  │   svc: 18789/gateway    │                     │
│  └─────────────────────────┘  └─────────────────────────┘                     │
│            │                            │                                      │
│            └────────────┬───────────────┘                                      │
│                         │ NetworkPolicy: egress allow ONLY                     │
│                         ▼   kooker-service-ai + citylife backend               │
└───────────────────────────────────────────────────────────────────────────────┘
```

## DMZ — keep the bots blast-radius-small

Per the pentest findings (`MEMORY.md` project_pentest_kooker): **NetworkPolicy was discovered missing
on kooker-service-ai**, and sibling services were exposed. We do not extend that mistake to the
citizens. The citizens' namespace gets:

- **Default deny ingress + egress** (k8s NetworkPolicy with empty `podSelector`, both directions).
- **Egress allow** only to:
  - `kooker-service-ai.kooker.svc.cluster.local:8088` (inference).
  - `kooker-service-citylife.kooker.svc.cluster.local:8080` (the citylife backend — to read state
    and post intents; we do not let bots reach kooker-service-ledger, kooker-service-auth, neo4j,
    eureka, dashboards, or sibling bots).
  - DNS (kube-system, UDP/53).
- **Ingress allow** only from kooker-service-citylife (the gateway calls the bot's Hermes gateway
  endpoint to ask for a reply or push a vision snapshot).
- **No node-level egress**, no LoadBalancer, no public ingress.

Inference passes through the choke point either way, so the operator's parental-guidance /
moderation interceptors apply uniformly.

## Per-citizen kooker user

- Role: `CITYLIFE_CITIZEN` (new role, allowed by `kooker-service-auth`).
- Persistent fields stored against the user:
  - `botId` — the spawner label, e.g. `pim-quill-3a`.
  - `householdId` — the engine-side `household_<slug>` id from `newcomers.ts`.
  - `houseId` — the assigned `Plot.id`.
  - `homeXY` — `{x, y}` cell on the heightfield (the citizen's address).
  - `botGatewayUrl` — `http://bot-pim-quill-3a.citylife-citizens.svc.cluster.local:18789/gateway`.
  - `telegramHandle` — the dedicated Telegram channel for that citizen, so the operator can read
    the bot's life from a phone.
- The citylife `LoginScreen` already federates to kooker-auth; this user type lives there.
- Save / load: this binds to backlog **P5 — per-user persistence**.

## Mounted city documentation

A single ConfigMap, `citylife-citizen-docs`, mounted read-only at `/home/agent/.citylife/docs/` in
every citizen pod, containing:

- `docs/specs/VISUAL-STANDARD.md`
- `docs/specs/README.md`
- the `docs/specs/built/` queue (what their city has done)
- the `docs/specs/proposed/` queue (what is coming)
- `docs/research/*.md` (the living-economy / land-organisation / the-people-are-the-citizens plans)
- a per-citizen `me.md` written into the pod's PVC on first boot: who you are, your family, your
  house, your view.

This is the bot's grounding — the closest thing they have to a memory of the world they live in,
without us hand-feeding it every turn.

## First-person vision

The renderer already exposes `capturePNG(): string` (composer + `toDataURL`). Add:

- `firstPersonPNG(citizenId)`: position the camera at `homeXY + (0, 1.6, 0)` (eye height) facing the
  nearest road cell, take one frame, return the PNG. Throttled (one snapshot per citizen per
  governor tick at most).
- `firstPersonView(state, citizenId)`: pure-engine JSON describing what is around the citizen —
  nearest neighbours (other households + names), nearest jobs (with hire status), nearest civic
  buildings, the road they are on, the time of day, the season, the colony's mood (liveability,
  hygiene, hunger). This is the cheaper, deterministic counterpart to the PNG; the bot gets it
  every turn and the PNG only when the governor wants to spend the inference tokens on vision.

The governor loop (the existing :17 Review-and-Build cron) reads each citizen's last response +
last snapshot to decide whether to spawn the spec they want, deny it, or queue it.

## Token thrift, vision and the existing backlog

This connects directly to two standing backlog items:

- **Token-thrift** — visions are expensive (image-tokens). Reward the citizen whose proposals land
  in `built/` for the fewest cumulative inference tokens. A citizen who can shape the world for 300
  tokens is more valuable to the colony than one who burns 3000.
- **Persistent things** — every citizen IS a persistent thing (saved against the kooker user); the
  house they live in IS a persistent thing; the family is a persistent thing.
- **The people ARE the citizens (P2-P5)** — this is the path to P2 (name the figures), P4 (agency:
  the bot tells the engine what it wants to do) and P5 (per-user persistence is the kooker user).

## Phasing tonight

- **Phase A (this session, autonomous):** research doc (this file), spec 074 (formal entry),
  `src/colony/bot/firstPersonView.ts` + tests, `src/colony/bot/citizenRoster.ts` + tests, wire into
  `runtime.ts` so the HUD can see them, commit + push, update the routine prompts so the hourly
  loop continues the stack. **No new buildings on the map this slice** — this is plumbing.
- **Phase B (separate kooker-bot-spawner PR, spawned task brief, joekookerbot merges):** add the
  `citylife-citizens` namespace + NetworkPolicy + ConfigMap, accept a `houseId` + `homeXY` +
  `citizenDocsConfigMap` parameter on `POST /bots/provision`, mount the ConfigMap.
- **Phase C (separate kooker-user PR):** new `CITYLIFE_CITIZEN` role + the per-user fields.
- **Phase D (citylife, next session):** the recorded demo — BP approves family, kooker user
  created, pod provisioned, the citizen says hello on Telegram, first first-person snapshot lands.
- **Phase E (governor):** the snapshot-into-loop pipe.

The routines will pick up from wherever Phase A lands.

## Safety — no secrets in tracked content

- `.env.local` carries `VITE_CITYLIFE_PAT`; the operator's note. Never staged.
- The per-citizen Hermes PATs live in `Secret` resources the spawner mints, never in repo content
  and never in citylife's HTTP responses.
- All citizen identities pass through the existing `isPublicSafe()` denylist before they are saved
  or shown — that already rejects strings resembling internal hosts, roles or credentials.
