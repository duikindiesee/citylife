# Spec 167 — Local neighbourhood console and bot households

- status: proposed
- proposed-by: operator
- date: 2026-07-31
- depends-on: specs 152, 153, and 156; public bot-factory contracts

## Why

A player should be able to connect CityLife to a neighbourhood running on hardware they control,
without turning the browser into an infrastructure console or copying secrets into chat. Bots in that
neighbourhood should have an understandable place in the world: the player's house, with rooms and
work anchors that fit the building players can see from outside.

This specification defines the boundary before implementation. It does not claim that the local
connector, vault adapters, Cloudflare adapter, or bot-household projection has shipped.

## Player experience

The protected CityLife console presents a small, calm workflow:

1. Create a pending neighbourhood connection.
2. Install or open the local connector on the player's server.
3. Complete a short-lived, one-time pairing proof.
4. Verify runtime, vault, and optional DNS capabilities individually.
5. Choose which declared bots may appear in which house rooms or work anchors.

The console reports desired state, observed state, last successful contact, and actionable failure
codes. It never displays raw credentials, a Docker socket path, Kubernetes credentials, vault
locators, or secret values.

## Trust boundary

```text
CityLife browser
  -> authenticated CityLife backend
    -> mutually authenticated local connector
      -> local runtime adapter (Docker or Kubernetes)
      -> local vault adapter
      -> optional Cloudflare DNS or tunnel adapter

CityLife spatial registry
  <- safe bot presence and building-plan projections
```

The browser is presentation and user intent only. The CityLife backend owns account authorization,
connection records, capability policy, audit events, and short-lived commands. The connector owns
local runtime access and invokes allowlisted adapters. Each adapter gets only the capability needed
for its operation.

The local connector initiates or maintains the outbound control channel. No general inbound Docker,
Kubernetes, vault, or shell port is exposed to CityLife. Loss of authentication, an expired command,
a stale revision, or an unavailable provider fails closed and leaves the running neighbourhood
untouched.

## Connection contract

A connection record contains only public or non-secret control data:

- stable connection and neighbourhood IDs;
- owner reference resolved by the backend, never asserted by the browser;
- connector public identity and supported protocol version;
- declared capabilities such as runtime observation, scoped lifecycle, vault status, or DNS record
  management;
- desired and observed revisions;
- last successful contact and safe health codes; and
- revocation state.

Pairing proofs and command tokens are short-lived, single-purpose, replay-resistant, and stored only
where required by the backend and connector. A connection can be revoked without deleting the
player's local data or stopping unrelated containers.

## Vault request

The first implementation request is a provider-neutral local vault boundary. A bot or deployment
contract names a logical secret reference such as `neighbourhood/runtime/login`; it never carries
the value.

The connector may support adapters for:

- the operating-system keychain or Secret Service;
- 1Password, Bitwarden, or Vaultwarden;
- HashiCorp Vault;
- Kubernetes Secrets, preferably reconciled through External Secrets Operator; and
- optional provider adapters such as Doppler or Infisical.

CityLife and bots may receive only safe metadata:

- whether the logical reference exists;
- whether it was verified as usable;
- when it was last rotated, when the provider exposes that information; and
- a stable, non-sensitive error code.

They do not receive the secret value or a provider-specific locator. The connector resolves the
logical reference at execution time and gives the value directly to the scoped adapter or workload.
Logs redact command inputs, provider responses, environment values, and tokens.

The existing infrastructure pattern—host-managed values injected into Kubernetes Secrets and
consumed through `secretKeyRef`—is a valid initial adapter. HashiCorp Vault and External Secrets
Operator remain requested adapters until their implementation and rotation behaviour are proven.

## Cloudflare and local DNS

DNS and tunnel setup is an optional connector capability. The CityLife console may request and show
the status of an allowlisted record or tunnel route, but the Cloudflare credential remains in the
local vault and is resolved by the connector.

The adapter is constrained by an operator-approved account, zone, record suffix, record types, and
operations. It must not offer arbitrary API calls. Desired changes show a preview and require an
explicit player confirmation; observed state is read back after application. Every create, update,
verification, failure, and revocation produces a redacted audit event.

Public examples use names below `example.invalid`. A real hostname is runtime configuration and is
never committed to this repository.

## Bot household and building-plan rules

A container does not literally run inside the scene. CityLife projects its safe presence and status
onto a spatial anchor inside the player's house; execution and data stay on the local server.

The house is governed by one authoritative building plan:

- the exterior footprint, wall outline, roof envelope, floor heights, entrances, and parcel setbacks
  define the legal volume;
- every room polygon, stair, doorway, furniture footprint, and bot work anchor must fit within that
  volume and preserve declared clearance;
- interior and exterior views resolve the same building, floor, room, and anchor IDs;
- extending the interior requires an accepted building-plan revision rather than a renderer-only
  offset; and
- placement uses the survey and collision rules from spec 152.

A household assignment references a bot identity, neighbourhood, home, room, and work anchor. It may
expose display-safe capability and health summaries but not prompts, private data, tokens, filesystem
paths, container identifiers, or host details.

## State and audit

Desired state and observed state are separate. A command carries the last observed revision and an
idempotency key. The connector rejects stale or repeated mutations without applying them twice.

Audit events contain timestamp, actor class, connection ID, capability, operation, outcome, and safe
reason code. They exclude personal data, secret values, provider locators, raw command payloads, and
workload content. Retention is configurable and bounded.

## Cost

- CityLife backend storage for connection and audit metadata;
- a small local connector process and its runtime/vault/DNS adapters;
- local compute, memory, storage, and network usage chosen by the player; and
- in-world material, labour, parcel, and clearance costs for changes to the house plan.

No recurring AI inference is required merely to keep a connection alive or project status into the
house.

## Delivery phases

1. Publish generic schemas and safety gates in the bot factory.
2. Implement backend connection, capability, revision, revocation, and audit records.
3. Add the protected CityLife console against a fake connector.
4. Implement the local connector with runtime observation and one vault adapter.
5. Add a constrained Cloudflare adapter with preview, confirmation, and read-after-write checks.
6. Project bots into house anchors backed by the authoritative building plan.
7. Complete threat modelling, failure drills, upgrade/rollback tests, and player acceptance before
   enabling mutations by default.

## Acceptance

- A player can pair and revoke one local neighbourhood without exposing a raw secret to the browser.
- An unavailable or untrusted connector cannot mutate infrastructure or alter the rendered world.
- A vault reference can be verified and consumed at runtime without its value appearing in CityLife,
  bot memory, logs, repository history, or API responses.
- DNS operations are limited to the configured zone, suffix, record types, and operation set, and are
  fully auditable without sensitive payloads.
- A bot presence resolves to one stable household anchor while its container and data remain local.
- Every room and anchor validates inside the authoritative exterior building envelope.
- Existing neighbourhoods continue running during connector, backend, or CityLife outages.
- Public tests and fixtures contain no secrets, personal data, private hostnames, or real runtime
  identities.

## Open questions

- Which vault adapter is the first supported baseline on macOS, Linux, and Kubernetes?
- Which connector transport offers the simplest revocation and offline recovery while staying
  outbound-only?
- Which building-plan constraints are player-editable, and which are fixed by parcel or structure
  type?
- What audit retention and export controls should the player be able to configure?
