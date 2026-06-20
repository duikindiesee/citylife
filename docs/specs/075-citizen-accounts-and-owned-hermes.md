# Spec 075 — Citizen accounts and owned Hermes

Status: proposed
Supersedes the single-operator model; builds on Spec 074 (Citizen Avatar Bot) and the kooker
inference choke point.

## Goal

Turn CityLife from a single-operator demo into a multi-tenant product. **Many humans each log in
with a real kooker account, own one or more plots, and each owned plot has its own Hermes agent
that only that human can drive.** Everything stays behind the kooker inference choke point (one
place to meter, moderate, and rate-limit), and every identity is least-privilege — no admin roles.

The arc:

> kooker login → a `CITYLIFE_CITIZEN` account → claim a plot → that plot mints _your_ Hermes
> (a kooker **sub-user** bot) → you, and only you, chat to your brain, metered per owner.

## Decisions (locked)

### D1 — Identity: hybrid (sub-user + own BOT_PAT), not parent-JWT

Each Hermes agent is a first-class kooker **sub-user** linked to its human owner, but it
**authenticates as itself** with its own least-privilege credential. We do **not** use the human's
JWT for bot calls.

| Aspect     | Decision                                                                                       | Why                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity   | Bot = kooker sub-user, `parentUserId = human userId`, role `CITYLIFE_CITIZEN_BOT`              | Real wallet/profile → the bot can own a plot and act in the city economy (jobs, ledger, land). Ownership is a native link, not an ad-hoc field. |
| Auth       | Bot holds its **own** `BOT_PAT` (server-side), exchanges for a short-lived JWT, acts as itself | Least-privilege. A 24/7 bot never carries the human's authority.                                                                                |
| Human      | Logs in as a `CITYLIFE_CITIZEN` (least-privilege), manages only their own plots/bots           | The human's JWT authorizes _their_ actions, never the bot's.                                                                                    |
| Login gate | Sub-users are flagged `botUser=true` and **cannot** log into kooker-web as operators           | Prevents bots becoming shadow admins.                                                                                                           |

Rejected: _parent-JWT for the bot_ — every always-on bot would wield the full human authority (the
over-privilege problem). Rejected: _pure bot-PAT with no user record_ — bots could not hold a wallet
or own land, and ownership/isolation would be an ad-hoc field instead of `parentUserId`.

### D2 — Isolation: owner-scope by default, explicit share-ACL for cross-tenant read

> Every resource — bot, host, plot, metric — carries an `ownerUserId` (for bots, the
> `parentUserId`). List/read returns only the caller's own by default (default-deny cross-tenant).
> Seeing someone else's requires an explicit **share grant** (read-ACL).

This is the single rule that fixes both observed problems:

- **"I should see only their bots"** — the inference metrics / fleet views must filter to the caller.
- **The `joe-mac-mini` host visibility** — seeing your _own_ host is correct; seeing another owner's
  host requires an explicit share ("unless I share the host with read access").

Today's defect: `GET /api/v1/ai/inference/metrics` **requires ADMIN and returns every bot**. That is
the opposite of tenant isolation, and it is why the panel forced an over-privileged (admin) login.

## Data model

```
User (kooker-service-user)
  + botUser: bool         # true for Hermes sub-users; blocks human web login
  + parentUserId: long?   # set on bot sub-users -> the human owner

Plot (citylife-backend)
  plotId, name, zone, x, y
  ownerUserId: long?      # null = available; set on claim
  hermesBotId: string?    # the sub-user/bot bound to this plot

ShareGrant (citylife-backend or kooker-service-auth)
  resourceType (bot|host|plot), resourceId, ownerUserId, granteeUserId, access (read)
```

## Auth flow (who may talk to which Hermes)

```
human browser  --(human kooker JWT)-->  citylife-backend
   citylife-backend: verify JWT  +  assert caller owns the target plot
   --> choke point AS that plot's bot identity (bot PAT stays server-side, never in the browser)
```

- The browser holds only the human's short-lived login JWT — never a PAT.
- The backend maps owner → the bot's server-side identity (generalizes the single nginx-injected PAT
  we ship today into per-owner injection).
- Cross-tenant calls are impossible: ownership is checked before forwarding.

## Capacity & tiers

N citizens = N Hermes = real RAM. The spawner guardrails already exist (`BOT_MEMORY_BUDGET_GI`,
priority class, `/bots/capacity`).

- **Free citizen** → shares a model with per-user memory/context (no dedicated pod).
- **Premium citizen** → dedicated Hermes pod (full Spec-074 path) + DMZ NetworkPolicy.
- Per-owner quota/rate-limit is already enforced by the choke point's Redis limiter.

## Phased delivery

1. **Isolation first (ships now).** Owner-scope `GET /api/v1/ai/inference/metrics`: any authenticated
   caller sees bots they own (admin/share sees more) instead of admin-only-see-all. This alone fixes
   "only their bots" + removes the admin requirement that forced the over-privileged login.
2. **Real login.** Swap `VITE_OPERATOR_PASSCODE` for kooker JWT login; add the `CITYLIFE_CITIZEN`
   role + down-scoped PAT minting (never inherits admin).
3. **Plot registry.** citylife-backend with `ownerUserId`; a "claim a plot" endpoint keyed to userId.
4. **Sub-user provisioning.** On claim, create the `CITYLIFE_CITIZEN_BOT` sub-user (`parentUserId`),
   provision its Hermes via the spawner, persist `hermesBotId` + pod gateway; per-owner auth injection.
5. **Share-ACL + tiers.** ShareGrant store for cross-tenant read; shared-vs-dedicated tiers; lifecycle
   (reclaim a pod when a plot is abandoned).

## Out of scope / non-goals

- No admin roles anywhere in the citizen path. Moderation is the choke point's interceptor, not a
  per-user privilege.
- The human's JWT is never used as a bot's identity.
- No PAT in the browser for the deployed app — credentials live in k8s Secrets / server-side only.
