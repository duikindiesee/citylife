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
- Displays live connection status (emerald indicator when connected, amber when connecting).
- Lists active room code and all connected peers.

## Data & Rules

1. **Coordinate Conversion**: Grid cell coordinates are mapped to 3D world space using standard CityLife scale:
   $$X_{world} = (x_{cell} - \text{terrain.size}/2) \times 4$$
   $$Z_{world} = (y_{cell} - \text{terrain.size}/2) \times 4$$
2. **Frequency**: Outgoing pose updates are capped at 20 Hz.
3. **Disposal**: Unmounted sprites and meshes dispose of geometries and textures to prevent memory leaks (`disposeDeep`).

## Verification & Acceptance

- `tests/multiplayerClient.test.ts`: Unit test suite testing connection lifecycle, custom room codes, auto-create, and pose multicasting.
- `e2e/multiplayerRacing.spec.ts`: Automated multi-context Playwright test:
  - Spawns two independent browser sessions for `jamtin` and `jamtin2`.
  - Both join room `racing-cup`.
  - Asserts `[data-testid="multiplayer-hud"]` reports 2 racers online in both sessions.
  - Asserts `window.__r3fScene` contains `remote-racer-jamtin2` in Player 1's view and `remote-racer-jamtin` in Player 2's view.
  - Drives both cars forward down the road using player driving controls (`setOwnedDriveInput({ throttle: true })`) with server-authoritative progress, asserts peer movement, and neutralizes inputs on stop.
  - Transcodes recorded WebM video into `videos/multiplayer-racing.mp4` via ffmpeg.
