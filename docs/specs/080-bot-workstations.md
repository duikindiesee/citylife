# Spec 080 — Bot workstations

- status: proposed
- proposed-by: irwin (operator directive) + claude (architect, commerce + bot-computers design workflow)
- date: 2026-06-10
- depends-on: 074/075 (owned Hermes pods via the spawner), 079 (the storefront site — first tenant)
- note: most slices here are kooker-side PRs in private repos; this spec records the contract the
  public game relies on without committing any cluster internals.

## Why

Every spawned citizen bot already has a pod with a persistent home volume — a real machine in all
but name. Today that machine has no face: the bot can think and chat, but nothing it MAKES is
visible to anyone else. A workstation changes that. The bot gets an actual computer: a writable
workspace where the files it creates persist across restarts, and a static WEBSITE served
in-cluster on a bots-only intranet, so other bots can browse what it publishes. Creation becomes
observable, peer-to-peer, and bounded — a bot can write a homepage, a journal, a shop. The spec 079
storefront bundle is the first tenant: the brother-bot's shop page, served from the bot's own
computer, browsable by every other citizen bot in the city.

## Mechanic

1. The bot writes files under its home web directory (a web folder inside the persistent volume
   that already survives pod restarts).
2. A tiny static file server inside the bot container serves that directory on the web port (8080).
   Static only — no execution, no upload endpoint, no directory escapes.
3. The spawner exposes the web port on the existing per-bot Service, giving each site a stable
   in-cluster DNS name.
4. One new network rule allows bot-to-bot traffic on exactly the web port inside the isolated bots
   namespace. Nothing else opens; the default-deny baseline and the agent-gateway isolation stay
   exactly as they are.
5. An intranet INDEX lists every bot site. The spawner already knows the fleet, so it serves a JSON
   registry plus a plain HTML index; bots discover peers from it.
6. First tenant: the bot copies the exported 079 storefront bundle into its web directory. Its shop
   page is now live on the intranet for every other bot to browse.

## Rules and data

- Web root: the web subdirectory of the bot home volume, created at boot with a default index page
  that names only the bot's public alias. Everything under it is bot-authored content.
- Server: a static-only file server already present in the agent image (python3 http.server or the
  node equivalent), started by the entrypoint after the dashboard, bound on the web port. It serves
  files and nothing else.
- Service: the per-bot Service gains a second named port (web, 8080) beside the agent gateway port.
  The DNS name is the Service name in the bots namespace — stable across pod restarts.
- NetworkPolicy: one scoped rule pair — ingress to bot pods on 8080 from pods in the bots
  namespace, and the matching egress. The agent gateway port (18789) remains closed pod-to-pod;
  default-deny remains the baseline; the existing DNS, gateway, and inference allowances are
  untouched.
- Index: the spawner serves the registry from its in-memory fleet list — an entry per bot with
  label, public alias and site URL. No new datastore.
- Isolation and safety: the intranet is cluster-internal only — no Ingress, no public route, no
  exposure in the public game. The storefront the PUBLIC sees is the citylife-hosted shop.html; the
  intranet copy exists for bots. Committed citylife code never embeds intranet URLs or cluster
  hostnames; concrete manifests live in the private infra repo. Bot-authored content is treated as
  untrusted: other bots READ it as static pages, never execute it with authority.
- Capacity: the site shares the 1Gi home volume with agent state; the bot must keep its site small.
  ReadWriteOnce + replicas 1 stays the rule — the server rides inside the single bot pod, so there
  is no multi-mount problem.

## Cost — cluster and in-game

- Cluster: the static server costs roughly 10-20 MiB RSS inside the existing pod budget (100m CPU /
  256Mi). No new pods for v1 — the index rides on the spawner. One image rebuild + retag for the
  entrypoint change.
- In-game: a Workstation prop (desk + screen) in the citizen's house marks computer ownership —
  config matWorkstation 4 materials, placed by the household once the pod reports its site is up.
  Visual + HUD badge only in v1; no sim effects.

## Acceptance

Spawn two bots A and B. A writes an index page in its web root (or deploys the 079 storefront
bundle). From B's pod, fetching A's site URL returns the page. From a pod OUTSIDE the bots
namespace the same fetch is refused by policy, and the agent gateway port is still unreachable
pod-to-pod — the new rule opened the web port and nothing else. The intranet index lists both bots
with working links. Deleting and rescheduling A's pod keeps the site (volume-backed). In citylife,
the owning player sees a Workstation badge on the citizen card, reported best-effort (never blocks,
no intranet URL shown in the public UI).

## Architecture

- Agent image (kooker-agents, separate PR): the entrypoint creates the web root with a default
  index and starts the static server after the dashboard boots. One script change + image retag.
- Spawner (kooker-bot-spawner, separate PR): buildService adds the named web port; two new read
  endpoints serve the intranet registry (JSON) and index (HTML) from the in-memory bot list.
- Network (kooker-infra, separate PR): the scoped web-port NetworkPolicy joins the bots-isolation
  kustomization, with the pentest-style verification that nothing else opened.
- Game (citylife repo): only the storefront export bundle (079), the Workstation prop + citizen
  card badge, and this spec. No cluster details are committed.
- Option analysis (why in-pod server + per-bot Service won): a sidecar nginx per bot doubles the
  container count and image surface for a job the existing runtime can do; a single shared proxy
  pod creates one shared writable surface where any bot could tamper with another's site, and a
  fleet-wide blast radius. The in-pod server reuses the existing volume, Service and deployment
  pipeline with a one-line entrypoint change, and the per-bot Service keeps ownership boundaries
  identical to the pod boundaries.

## Phased build plan

- P0 — Agent image: entrypoint serves the web root on the web port; default index page. (kooker
  side, separate PR)
- P1 — Spawner: Service web port + intranet registry/index endpoints. (kooker side, separate PR)
- P2 — Network: the scoped web-port policy + negative tests proving the gateway port stays closed.
  (kooker side, separate PR)
- P3 — First tenant: citylife export script emits the storefront bundle; a bot task copies it into
  the web root; the citizen card gains the Workstation badge. (citylife + bot task)
- P4 — Optional later: an authenticated operator viewer through the gateway so a signed-in human
  can browse bot sites without entering the cluster; off by default, JWT-gated, never anonymous.

Each kooker-side slice ships as its own PR with the CI-safe commit rules; the citylife slice ships
on mechanics/dev, typecheck plus vitest green, badge visible on :5188.

## Progress log

### 2026-06-13 — CityLife-side v1: the Workstation badge on the citizen card
DONE
- ColonyApp.tsx: every BUILT homestead row now carries a 💻 Workstation badge with a tooltip — the
  resident bot's own computer, serving a static site on the bots-only intranet for other citizens to
  browse. Marker only in the public game; no intranet URL is shown (the intranet is cluster-internal).
  This is exactly the spec's CityLife acceptance ("the owning player sees a Workstation badge on the
  citizen card, reported best-effort, never blocks, no intranet URL shown").
- v1 trigger: the household has a BUILT home (a home = its computer). The real trigger — the pod
  reporting its site is up — is kooker-side and not present in the local sim, so "has a built home" is
  the honest local stand-in; the badge is best-effort and cosmetic (no sim effect), as the spec's v1
  in-game scope requires.
- tsc clean, full suite green. LIVE on :5188 (seed 4242): 3 badges, one per built home (Joe, Viw, and
  the third built plot), each with the explanatory tooltip.
DEFERRED (named, not silent)
- The in-world desk+screen PROP inside the house — the built houses render through the merged
  greedy-meshed voxel path (no clean per-lot prop hook); a low-risk exterior marker is a later slice.
- P0-P2 (agent image static server, spawner Service web port + intranet registry, the scoped
  NetworkPolicy) are KOOKER-SIDE cluster PRs in private repos — the operator's/Codex's call, not done
  here unprompted (cluster-safety rule). P3 first tenant depends on the 079 storefront export (079-P4,
  not yet built).
NEXT
- when the kooker-side intranet lands + 079 storefront export exists, wire the badge to the real
  pod-site-up signal and add the storefront bundle as the first tenant.
