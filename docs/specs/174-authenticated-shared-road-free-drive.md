# Spec 174 — Authenticated shared-road free drive (MP.FD.1)

- **Status:** proposed for review. **Design only** — no runtime, gateway or deployment change ships with this spec.
- **Date:** 2026-09-24
- **Tracking:** CityLife issue #529 (Network multiplayer free-drive on shared CityLife roads).
- **Depends on:** #523 (owned-car world driving; merged); #528 (player map/HUD; merged as `69bddc3`); a verified server-readable world/layout/road revision; server-authoritative player and vehicle ownership reads.
- **Design provenance:** the player goal requires at least two signed-in players to drive their own cars on shared roads, see each other in-world and on the map, and preserve identity/isolation through reconnects. Inspected source snapshots: CityLife `a28547e868e6108e271bb3152be85ac2ca696ef0` ([owned-car controller](https://github.com/duikindiesee/citylife/blob/a28547e868e6108e271bb3152be85ac2ca696ef0/src/colony/car/ownedDriving.ts), [presence readout](https://github.com/duikindiesee/citylife/blob/a28547e868e6108e271bb3152be85ac2ca696ef0/src/colony/spatial/presenceReadout.ts)); Kooker Infra `ca00f4ea3a1093b67f9e5576b2ad92310b927fc3` ([APISIX routes](https://github.com/duikindiesee/kooker-infra/blob/ca00f4ea3a1093b67f9e5576b2ad92310b927fc3/manifests/base/apisix-routes/apisix-routes.yaml)); and issue #529. Current client source has local car movement and presence projection but no gameplay transport; the inspected gateway config has an authenticated CityLife HTTP route but no gameplay WSS route, and marks the old Games service retired. This spec is not evidence that any realtime service exists or is deployed.

## Why

Free drive should let friends meet in the actual CityLife world and drive their own cars together. A browser-local avatar, client-supplied account id, cached garage entry, or claimed position must never create another player or vehicle. The existing owned-car controller is a client simulation; networking it safely requires a server authority and a durable world/road identity before clients can share movement.

## Mechanic

An authenticated player creates a **private free-drive session** and shares a short-lived invite code. Joining players must each have a server-confirmed owned car. The server resolves the player's identity, car and session membership; simulates movement; and publishes current vehicle presence only to members of that session. The session has no KCO, purchase, house, race, chat or persistent-world side effects.

The first usable cohort supports up to **8 participants** in one private session. Acceptance must include two independent player accounts and two separate clients. There is no public matchmaking or cross-session presence.

## Rules & data

### Authority and session flow

1. The browser calls authenticated session-control endpoints over HTTPS. A create/join request contains no trusted `userId`, `vehicleId`, balance, ownership claim, pose, world geometry or layout hash.
2. The control plane derives the caller from the validated account token, checks that caller's current vehicle ownership, and resolves the canonical active world and immutable layout/road revision. A player without an owned vehicle is rejected with a stable `CAR_REQUIRED` result and remains on the existing showroom/onboarding path.
3. The host may issue one invite code per intended join, each with at least 128 bits of unpredictable entropy, valid for 5 minutes and usable once. Store only a verifier; never log or include the invite in analytics. A room has one owner and at most 8 members. An account may occupy only one slot and one active session at a time.
4. After create/join, the control plane issues a random, one-use WebSocket ticket, valid for 30 seconds and bound server-side to the authenticated subject, session, owned vehicle, world id and layout revision. The browser sends it as the first WebSocket message, never in a URL, query string, referrer, persistent storage or subprotocol. The realtime service must consume it atomically before sending state; reject expired, replayed, wrong-session, wrong-account, wrong-car or wrong-revision tickets.
5. The realtime service creates one authoritative vehicle entity per `(sessionId, accountId)`. Peer messages use opaque session-local participant ids and public display aliases only; they never expose account ids, emails, auth tokens or another player's private profile data.

### Movement and presence

- The client sends only bounded control intent: monotonic sequence number, throttle `[-1,1]`, steering `[-1,1]`, brake, and protocol version. Maximum encoded input is 512 bytes. The server ignores client coordinates, heading, velocity, car stats, model key and timestamps as authority.
- A dedicated realtime authority runs a fixed 20 Hz movement step. It resolves the canonical owned car and its server-approved stats, validates monotonic input sequence, clamps controls and speed, and checks the full vehicle footprint against the server's road/surface geometry for that exact world revision. Invalid, non-finite, out-of-order or off-road input is discarded or results in a server-controlled stop; it never teleports the car to a client pose.
- Movement and collision bounds must use a shared, deterministic kinematics contract with client prediction. Extract the pure kernel into a versioned shared package or equivalent conformance-tested module before implementation; do not maintain two untested physics copies. The current local `stepOwnedDrive` remains prediction only until the server runs the same verified rule set.
- Each member receives authoritative snapshots at 10 Hz. The client interpolates remote snapshots with a 100 ms buffer; local prediction is reconciled to the server response. Initial release has no car-to-car collision, damage, traffic simulation or race rules. It may not render a remote car from browser-local storage or a synthetic fallback.
- Snapshot presence is session-scoped and ephemeral. It includes an opaque participant id, approved public alias, server-owned vehicle catalogue key, pose, speed, input/snapshot sequence and server timestamp. The player map consumes the same filtered session snapshot and uses the world revision's transform; it cannot create its own presence source.

### Session, reconnect and abuse limits

- One session has at most 8 participants. Limit each participant to 20 movement inputs/s sustained, with a token bucket refill of 20/s and burst capacity of 10; reject payloads over 512 bytes. Heartbeat every 5 seconds; mark the connection stale after 15 seconds without a valid heartbeat.
- Preserve a disconnected member's slot for 30 seconds for reconnect. A reconnect must obtain a fresh one-use ticket for the same account/session/car/world revision. Enforce a unique membership key `(sessionId, accountId)`; a successfully authenticated replacement socket closes the prior socket before state resumes. At expiry, remove the slot and its vehicle from both world and map.
- Check `Origin` against the deployed CityLife origins, use TLS, cap unauthenticated pending sockets per source, and require the first ticket frame within 3 seconds. Origin is a browser-origin guard, not player authentication. Reject malformed protocol versions and close repeated-invalid clients. Never log WebSocket message bodies or ticket values.
- A clean logout/account switch closes the socket and clears all local peer snapshots immediately. Server-side leave/expiry removes membership; changing browser account cannot reuse an old ticket or local presence.
- First deployment uses **one realtime replica with in-memory room state**. Sessions are deliberately non-durable and end on process restart; clients receive an explicit session-ended state and can create/join again. Do not attach the AI cache Redis or the retired Games service. Multi-replica operation requires a separately reviewed shared ephemeral membership/lease design and atomic ticket consumption before enabling replicas >1.

### Transport and hosting

- Proposed control-plane routes, all authenticated and derived from the current account: `POST /api/v1/citylife/players/me/free-drive/sessions` creates a room and returns a one-use invite; `POST /api/v1/citylife/players/me/free-drive/sessions/join` redeems an invite and returns a short-lived ticket; `POST /api/v1/citylife/players/me/free-drive/sessions/{sessionId}/ticket` reissues a ticket only for a verified existing member; `DELETE /api/v1/citylife/players/me/free-drive/sessions/{sessionId}/membership` leaves; and `DELETE /api/v1/citylife/players/me/free-drive/sessions/{sessionId}` closes a room only for its owner.
- Add a dedicated `citylife-realtime` workload for WSS movement; do not overload the retired Games service, the static frontend, or the AI service. Use one WSS path, `/api/v1/citylife/realtime`, behind TLS. The browser WebSocket constructor accepts a URL and optional subprotocols, not arbitrary request headers ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket)); keep identity authentication on the HTTPS control-plane request and consume the one-use ticket as the first WebSocket message.
- Route that exact WSS path through APISIX with WebSocket enabled, origin restrictions and an explicit connection cap. APISIX supports WebSocket on an HTTP route ([route reference](https://apisix.apache.org/docs/ingress-controller/reference/apisix-ingress-controller/api-reference/)); the L4 stream switch is not a prerequisite. APISIX connection limiting can also cap concurrent WebSocket connections ([limit-conn](https://apisix.apache.org/docs/apisix/plugins/limit-conn/)).
- Initial deployment adds no managed database, paid relay, broker or third-party multiplayer platform. It still consumes cluster CPU/memory and may increase node cost. Before implementation is deployed, measure current cluster headroom, load-test 8 simulated participants, set resource requests/limits from those results, and record the marginal hosting-cost decision. If the current cluster cannot meet the measured budget, deployment remains held until an operator accepts the costed capacity plan.
- The currently configured AI Redis is not a session store. No cost or capacity claim is accepted from source configuration alone.

## Cost — materials & labour

No in-world materials or KCO are consumed. Engineering cost is one authenticated control-plane slice, one isolated realtime service, one APISIX route/policy slice, shared movement-kernel conformance, and client session/map wiring. Runtime cost is an additional service workload on existing cluster capacity; exact CPU, memory, node and monthly cost are **unknown until measured**, and are a release gate rather than an assumed zero.

## Acceptance

### Before implementation

1. MoJoJo independently reviews the design and exact head. Record approved or requested changes before implementation starts.
2. Verify the server source of truth for player identity, owned car/stats, canonical world id, layout revision and road footprint. If any required value is browser-only or unversioned, resolve that contract first.
3. Confirm the CityLife control-plane endpoint, APISIX WSS route semantics, connection limits, origin policy, message-body redaction, single-replica restart behaviour, and measured cost/capacity. No existing CityLife gameplay WebSocket path is assumed.

### Automated and deployed player acceptance

1. Protocol tests cover create/join, 8-member cap, current ownership, same-world/layout enforcement, ticket expiry/replay/binding, invalid and out-of-order inputs, speed/off-road bounds, per-session isolation, logout/account switch, stale removal, reconnect replacement and no duplicate vehicle.
2. A deterministic shared-kernel suite proves client prediction/server movement agreement for the same inputs, stats, road geometry and tick sequence.
3. A two-account, two-browser test proves both players join the same private world, each controls only their server-owned car, and each sees the other's live car and map position. The server rejects a third-party vehicle/account claim, a different layout revision, a forged pose and a reused ticket.
4. Disconnect and reconnect both clients; show one vehicle per account throughout, stale removal after the window, and no cross-session visibility. Restart the service and prove both clients receive an explicit ended/rejoin state without fabricated local multiplayer.
5. Load-test 8 participants at the configured 20 Hz/10 Hz rates; require p95 server simulation time below 25 ms and p99 below the 50 ms tick budget, and p95 snapshot age below 300 ms at clients. Retain p50/p95/p99 tick cost, snapshot age, rejected-message counts, CPU/memory, resource requests and the accepted marginal-cost decision.
6. Retain exact deployment/image/config identifiers and inspectable screenshots/video from the actual deployed CityLife interface. Source tests, HTTP status, a local mock, a single browser, or synthetic peer snapshots do not satisfy acceptance.

## Open gates and explicit non-goals

- #528 is merged and supplies the local map, wallet, player marker and bus presence. It does not supply network peers. The multiplayer map view must consume authoritative session snapshots from a future implementation and must not be represented as shipped by this design.
- The canonical production road/layout revision and server-consumable collision surface have not been proven by this design. Until they are, server movement remains unimplemented and no shared-road claim is accepted.
- Race synchronization, voice/text chat, public matchmaking, cross-world travel, persistent room history, purchases and cross-player collision are out of scope.
- This document does not authorize a feature-flag change, infrastructure merge, runtime deployment, release or player-facing launch.
