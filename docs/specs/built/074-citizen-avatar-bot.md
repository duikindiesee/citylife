# Spec 074 — Citizen Avatar Bot

- status: built
- proposed-by: irwin (operator directive) + claude (architect)
- date: 2026-06-02
- depends-on: 035 (Founders Hall + roster), 011 (Civic Pulse — liveability the bot can see)

## Why (the citizens' case)

The voices that DESIGN the world — Mara Venn, Saskia Vorster, the Hermes proposers who built every
slice from 6 to 73 — do not live in it. The Border Patrol speaks for a moment then forgets the
family. The pedestrians on the road are now bound to the colonist count (Phase P1, just shipped)
but each one is still nameless. The colony's people need to BE its real, named bots — same model,
same memory, same Telegram channel from one approval to the next sunrise.

## Mechanic

When the Border Patrol approves a household, the colony provisions a **citizen avatar**:

- A new `kooker-user` is created with role **CITYLIFE_CITIZEN**, carrying `householdId`, `houseId`,
  `homeXY`, `botId`, `botGatewayUrl`, `telegramHandle`.
- A Hermes pod is provisioned in the **`citylife-citizens`** k8s namespace via the existing
  `kooker-bot-spawner` (`POST /bots/provision`, `type=hermes`, model `hermes-openai-gpt-5.5`).
- The pod mounts a read-only ConfigMap of city documentation (VISUAL-STANDARD, the spec queue,
  research notes) plus a per-citizen `me.md` written into its PVC on first boot.
- A NetworkPolicy on `citylife-citizens` permits egress only to `kooker-service-ai` (the inference
  choke point) + the citylife backend + DNS — the DMZ that keeps the bots out of the rest of
  kooker.
- The household's `BotAdapter` is swapped from the generic citylife PAT to the **per-citizen
  gateway URL** — every further reply that household gives in the game is the citizen's own bot
  speaking. Telegram becomes the operator's window onto that bot's life.
- A pure-engine `firstPersonView(state, citizenId)` reports what is around the citizen: their
  house, neighbours, nearest jobs, nearest civics, the road they are on, the time, the season,
  the colony mood. A renderer `firstPersonPNG(citizenId)` captures what they actually see — fed
  to the governor loop on a budget (token-thrift applies).
- The governor loop (the existing :17 Review-and-Build cron) reads each awake citizen's latest
  intent + their last vision and can choose to advance their proposed spec, queue it, or deny it.

## Rules & data

- **Construction gate (avatar foundry):** an **Avatar Foundry** building anchors this. Without it,
  approving a household still produces a `Household` and a `Bot` (mock or kooker-PAT adapter), but
  no spawner call is made and no kooker user is created — exactly today's behaviour. Once an
  Avatar Foundry is built and staffed, new approvals fire the spawner.
- **Cost (in-world):** materials 60, components 18, tools 4, reels 2, build crew 6, ongoing
  workers 3. The construction gate matches every other slice.
- **Cost (out-of-game):** one Hermes pod per citizen at 100m CPU / 256Mi RAM (per existing spawner
  defaults). 1 Gi PVC each. Capped at `min(houses_built, MAX_CITIZENS)` where `MAX_CITIZENS` starts
  at 8 — the routine raises the cap as the budget allows.
- **Token thrift signal:** each citizen accumulates `tokensSpentLifetime`. Proposers whose specs
  reach `built/` for the fewest cumulative tokens earn a Thrift Bonus in the colony's coin (signals
  the Token-Thrift backlog item).
- **Visions throttle:** at most one PNG per citizen per governor tick; the JSON view is free and
  refreshes every UI re-render.
- **Persistence:** the Plot, household, bot id, gateway URL, lifetime token spend are saved against
  the kooker user.

## Cost — materials & labour

- **Avatar Foundry:** 60 materials, 18 components, 4 tools, 2 reels, 6 build-crew labour to
  construct; 3 free colonists staff it on completion. Sector: civic.
- **Per citizen avatar:** 0 materials in-game (it is the Foundry's output) — gated only on
  the Foundry being staffed and `pendingHouseholds.length > 0`.

## Acceptance

- A new spec file `docs/specs/proposed/074-citizen-avatar-bot.md` exists in BOTH queues
  (`docs/specs/proposed/` and `D:\infra\projects\citylife-specs\proposed\`).
- `src/colony/bot/firstPersonView.ts` exports `firstPersonView(state, citizenId)` returning a
  typed `FirstPersonView` JSON (house, neighbours, nearest jobs, nearest civics, mood). Tests in
  `tests/bot.firstPerson.test.ts` cover: a citizen sees their house; their nearest non-water road;
  at least one neighbour when colonists > 1; nothing when the citizenId is unknown.
- `src/colony/bot/citizenRoster.ts` exports `CitizenRoster` with `register(household, plot)`,
  `forHousehold(id)`, `list()`, `setBotGatewayUrl(citizenId, url)`. Tests cover registration,
  lookup, idempotency, and that the public roster never leaks any private string (denylist via
  the existing `isPublicSafe`).
- `runtime.ts` exposes the roster + first-person view through `uiState.citizens` (count + named
  list with safe fields only — `{id, displayName, plotName, homeXY, hasPod, telegramHandle?}`).
- ColonyApp HUD: a "Citizens" row showing `${awake}/${roster.length} living`, with an inline
  expand that lists each citizen by name + their plot.
- The build is green (typecheck + tests), live-verified on :5188.
- A short demo script `social-export/citizen-avatar-demo.md` notes how to run the Border Patrol
  approval flow end-to-end against a mock adapter (no Telegram needed for the slice acceptance —
  the recorded demo with real Telegram is the *next* slice).

## Out of scope this slice

- Actual `kooker-user` provisioning (PR against kooker-user repo, joekookerbot merges).
- Actual `POST /bots/provision` call (PR against kooker-bot-spawner, joekookerbot merges).
- The NetworkPolicy + ConfigMap (lives in the kooker-infra repo).
- The governor loop reading vision (the next slice — once we can prove a pod is up).

Those land as their own PRs in their own repos, each with a separate task brief.

## Standing rules respected

- No secrets in tracked content. The citylife PAT stays in `.env.local`; per-citizen PATs live in
  k8s Secrets the spawner mints.
- The existing `isPublicSafe()` denylist guards every citizen identity before it is shown or saved.
- Construction is materials + labour + components + tools + reels gated (the Caesar III rule).
