# Spec 178 — Multiplayer Free Drive and Racing WebSockets

- status: built
- proposed-by: Antigravity (operator request)
- date: 2026-10-06
- depends-on: Spec 124, Spec 172, Spec 174, Spec 177

## Why (the citizens' and player's case)

Until now, driving in CityLife has been an isolated single-player experience. Players could drive their owned vehicles across the road ribbons and visit the Gearbox Auto Hub, but could not see, cruise alongside, or race other human players.

The Street Rod north-star vision (Phase 1, Epic Street Rod) calls for players to meet at night, hang out, drive down roads together, and race. To realize this, CityLife requires real-time vehicle pose synchronization across the network, connecting through `citylife-server`'s WebSocket engine.

## Acceptance Criteria

1. **Dual Racer Synchronization**: Two human players (e.g. `jamtin@citylife.local` and `jamtin2@citylife.local`) join the same multiplayer session / room code and see each other's vehicles in real-time.
2. **Road Surface Alignment**: Remote racers are rendered directly onto the 3D road ribbon and garage apron surfaces with realistic pitch and roll road curvature alignment.
3. **Player Identity**: A floating 3D nameplate displays each remote racer's username above their vehicle.
4. **Multiplayer HUD**: A dedicated heads-up display indicates network connectivity status, room code, and online roster of connected peers.
5. **E2E Video Recording**: End-to-end verification captures video evidence (`.mp4`) of both racers driving together down the municipal road ribbon.

## Architecture & Mechanics

### 1. WebSocket Session Protocol (`citylife-server`)

The server exposes a low-latency WebSocket gateway registered at `/api/v1/citylife/ws` (with `/ws` rewrite proxy in development).

- **`create_session`**: Creates a new racing lobby with an optional custom invite code or auto-generated 6-character room code.
- **`join_session`**: Joins an existing lobby by session ID or room code (`inviteCode`). If `autoCreate: true` or a custom room code is requested that does not exist, the server automatically initializes the room.
- **`pose` / `peer_pose`**: Clients multicast their vehicle kinematic transform:
  ```ts
  interface RacerPose {
    x: number;       // Grid cell X
    y: number;       // Grid cell Y
    heading: number; // Yaw angle in radians
    speed: number;   // Linear velocity in cells/second
  }
  ```
- **`input`**: Streams driver control inputs (`throttle`, `steer`, `brake`) with monotonic sequence numbers (`seq`). On vehicle exit (`exitOwnedCar`), sends neutralized inputs (`throttle: 0, steer: 0, brake: false, seq: seq + 1`).
- **`snapshot`**: Server multicasts 10Hz authoritative physical simulation snapshots (`peers`, `x/y/z`, `heading`, `speed`, `lastInputSeq`) reconciling client-side prediction.
- **`peer_joined` & `peer_left`**: Broadcasts participant connection and disconnection lifecycle events to all peers in the room.

### 2. Client Networking Layer (`MultiplayerClient`)

Implemented in `src/colony/multiplayer/multiplayerClient.ts`:
- Manages WebSocket lifecycle, approved endpoint boundaries, ping/pong heartbeats, and auto-reconnection.
- Streams driving inputs via `sendInput` with monotonic sequence tracking and reconciles authoritative snapshots (`onSnapshot`).
- Dispatches walking poses via `sendPose` and receives peer updates via `onPeerPose`.
- Emits reactive callbacks (`onPeerJoined`, `onPeerLeft`, `onPeerPose`, `onStatusChange`) wired directly into `ColonyRuntime` and `sim.state.remoteRacers`.

### 3. Sim State & Runtime Integration

- `ColonyState` (`src/colony/sim.ts`) maintains `remoteRacers: Map<string, RemoteRacerState>`.
- `ColonyRuntime` (`src/colony/runtime.ts`):
  - Exposes `enableMultiplayer(roomCode, wsUrl)` and `getMultiplayerClient()`.
  - Dispatches immediate pose updates when `tickOwnedDrive` advances the vehicle or when `teleportCar` relocates the vehicle.
  - Automatically joins rooms when launched with URL query parameters `?room=<CODE>` or `?multiplayer=1`.

### 4. 3D Remote Vehicle Rendering (`R3FRemoteRacers`)

Mounted inside `R3FPlanetRenderer.tsx` right after `R3FOperatorCar`:
- Visual Mesh: Renders vehicle geometry using `buildCarMesh` based on the remote player's vehicle specification.
- Ground Snapping: Samples continuous surface elevation using `getSmoothRoadY` and `garageApronSurfaceY`.
- Road Alignment: Evaluates multi-point pitch and roll samples along the vehicle chassis, orienting the vehicle to tilt naturally with road gradients.
- Floating Nameplate (`makeRacerPlate`): Generates an illuminated 3D Sprite with canvas-rendered text displaying the player's name above the roof.

### 5. Multiplayer Status HUD (`MultiplayerStatusHUD`)

Mounted in `ColonyApp.tsx`:
- Positioned in the top-right corner (`data-testid="multiplayer-hud"`).
- Displays live connection status (emerald indicator when connected, amber when connecting, ruby indicator when error).
- Lists active room code and all connected peers.
- When in `"error"` status, displays visible actionable failure diagnosis ("Connection Failed: Admission rejected or authoritative neighbourhood unavailable").

### 6. Authoritative Room Neighbourhood Derivation & Negotiation Protocol

Under Server 421 / User #243 authority, rooms bind strictly to published Starter Parcel Manifest neighbourhood keys (`plots[].geometry.neighbourhoodKey` or `plots[].neighbourhoodKey`):
1. **Wire Identity Binding**: `validateAuthoritativeStarterManifest` verifies that the published starter catalogue manifest matches the active world document (`manifest.worldId === active.worldId`, `manifest.layoutRevision === active.revision.contentHash`, and `manifest.layout.revision` wire identity `number`, `contentHash`, `parentHash`). No neighbourhood authority becomes usable while hydration is pending, failed, or superseded.
2. **Canonical Primary Default**: For users with no home or joining a new room without explicit neighbourhood intent, the client deterministically selects the canonical primary default (`validNeighbourhoodKeys[0]`, sorted alphabetically, e.g. `"wood1"` for `seed-4242`).
3. **Explicit Intent Preservation**: If a user explicitly specifies a neighbourhood (via URL query `?neighbourhood=` or programmatic request), `isExplicit` is flagged as `true`. If the requested key is not in the published catalogue, connection fails closed immediately (`status: "error"`).
4. **Bounded Single Room Negotiation**:
   - If an unpinned client (`!explicitNeighbourhood`) joins an existing room hosted in another valid published neighbourhood of the same world (e.g. `"wood2"`), Server 421 responds with `{ type: "error", error: "NEIGHBOURHOOD_MISMATCH", message: "Session belongs to neighbourhood wood2" }`.
   - The client parses the exact message pattern `/^Session belongs to neighbourhood ([a-zA-Z0-9_\-]+)$/`, verifies that the advertised key is present in the published catalogue for the captured request world and revision, sets `hasNegotiatedNeighbourhood = true`, cleanly closes the socket, and reconnects once with the negotiated key.
   - Negotiation is strictly bounded to **once per admission attempt**. If the server repeats the mismatch or advertises an unknown/malformed key, the client fails closed into `"error"` state to prevent infinite loops.
   - If the user had an explicit neighbourhood intent (e.g. explicit `wood2` vs room `wood1`), auto-negotiation does not trigger; the mismatch fails closed.
5. **Visible Actionable Failed State**: On admission rejection or missing neighbourhood authority, `MultiplayerStatusHUD` renders a red indicator and an actionable message ("Connection Failed: Admission rejected or authoritative neighbourhood unavailable"), preventing false connected or hidden HUD states.
6. **Lifecycle Invalidation**: Cached manifest and neighbourhood authority are cleared upon user logout (`setOperatorUserId(null)`), account switch, or world revision replacement (`adoptWorldLayout` / `hydrateWorldLayout`).

## Data & Rules

1. **Coordinate Conversion**: Grid cell coordinates are mapped to 3D world space using standard CityLife scale:
   $$X_{world} = (x_{cell} - \text{terrain.size}/2) \times 4$$
   $$Z_{world} = (y_{cell} - \text{terrain.size}/2) \times 4$$
2. **Frequency**: Outgoing pose updates are capped at 20 Hz.
3. **Disposal**: Unmounted sprites and meshes dispose of geometries and textures to prevent memory leaks (`disposeDeep`).

## Verification & Acceptance

- `tests/multiplayerClient.test.ts`: Unit test suite testing connection lifecycle, custom room codes, auto-create, and pose multicasting.
- `tests/multiplayerNeighbourhoodNegotiation.test.ts`: Strict unit and regression suite testing V4 wire identity binding, canonical primary default derivation, explicit selection preservation, bounded single-reconnect room negotiation, repeated mismatch fail-closed controls, and superseded revision isolation.
- `e2e/multiplayerRacing.spec.ts`: Automated multi-context Playwright test:
  - Spawns two independent browser sessions for `jamtin` and `jamtin2`.
  - Both join room `racing-cup`.
  - Asserts `[data-testid="multiplayer-hud"]` reports 2 racers online in both sessions.
  - Asserts `window.__r3fScene` contains `remote-racer-jamtin2` in Player 1's view and `remote-racer-jamtin` in Player 2's view.
  - Drives both cars forward down the road using player driving controls (`setOwnedDriveInput({ throttle: true })`) with server-authoritative progress, asserts peer movement, and neutralizes inputs on stop.
  - Transcodes recorded WebM video into `videos/multiplayer-racing.mp4` via ffmpeg.

## Transit Corridor & Surface Constraint Integration

### 1. Transformed Placement Constraints & Fail-Closed Projection
Child-frame placements (such as kiosks and modular commercial additions) are projected into primary surface coordinates via `projectFootprintVerticesToSurface` within `extractPlacementsConstraints`. If an unknown or unresolvable child-frame reference is encountered, derivation fails closed (`hasUnknownFrame: true`), returning `unknown_frame_in_placement_constraints` to guarantee corrupt or drifting frame graphs never generate unvalidated road corridor paths.

### 2. Shop-Aware Road Connectivity Repair (Spec 148 Continuity)
During municipal orphan road repair:
- `shopCells` are mapped prior to connector routing and included in `roadLandOk` (`!shopCells.has(...)`), preventing `simplifyPath` from pulling straight road segments across surveyed commercial shop footprints.
- Dilated avenue connector strokes are filtered to ensure no cell overlaps shop structures, while 4-connectivity bridge verification ensures true network consolidation (`roadComponents === 1`).

### 3. Opposing Carriageway Separation & Discrimination
To prevent opposing vehicles and coaches from colliding along doubled-back road segments:
- Opposing flows (`diff > 120°`) share a single carriageway centre and offset to their respective lefts, maintaining a verified clearance of $\ge 1.25$ cells (two coaches).
- Controlled negative test inputs (such as the uncorrected $0.23$-cell collision fixture) and same-direction headway discriminators pass through the same classification pipeline to ensure unsafe passes are caught deterministically.

### 4. Verification Status
Normal-boot and hydration strict consumer probes alongside focused unit suites provide uncommitted local source-method verification:
- `tests/roadConnectivity.test.ts`: 6/6 passed (single component, 9998 road cells, shop preservation verified).
- `tests/busStopClear.test.ts`: 9/9 passed (commercial stop sliding and junction clearance).
- `tests/busSharedCarriageway.test.ts`: 2/2 passed (opposing-pair discrimination $\ge 1.25$ cells and $0.23$-cell collision negative control).
- `tests/busFeltSpeed.test.ts`: 7/7 passed (continuing revenue circuit $> 8.32$ m/s, terminal depot return candidly assessed at $\sim 2.26$ m/s with 30s dwell).
- `tests/transitExplicitGeometry.test.ts`: 7/7 passed (rejection, schema verification, and atomic persistence).
- `tests/busRoute.test.ts`: 7/7 passed (route continuity, 6-stop circuit, and loop closure).
- `tests/busHeadway.test.ts` & `tests/busFleetAnchorOrder.test.ts`: 8/8 passed.
- `tests/garageRoadWalkabilityRegression.test.ts` & `tests/garageRebuildAndCollision.test.ts`: 23/23 passed.
- `tests/mallAnchorShell.test.ts`: 3/3 passed.
- `tests/districtDeterminism.test.ts`: 5/5 passed.
- `tests/transitHydration.test.ts`: 29 tests (isolated store resets, non-null baselines, semantic road network preservation, and tight-bounds child-frame fail-closed controls).
- Typecheck & Build: `npm run typecheck` exits 0; `npm run build` exits 0.

Hosted, browser, remote companion, and live multi-context player acceptance remain explicitly open for independent evaluation and are not claimed as pre-cleared.
