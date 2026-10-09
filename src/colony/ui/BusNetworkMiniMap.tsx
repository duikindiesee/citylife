import type { ColonyRuntime } from "../runtime";
import type { PresenceReadout } from "../spatial/presenceReadout";
import { useSimSignal } from "../render/useSimSignal";
import { buildBusNetworkMiniMapModel } from "./busNetworkMiniMapModel";

const WIDTH = 200;
const HEIGHT = 132;

type BusNetworkMiniMapProps = {
  runtime: ColonyRuntime;
  /** Server-authenticated wallet state, or City view for an operator. */
  walletLabel: string;
  presenceReadout: PresenceReadout | null;
  /** The map is summoned on demand so it does not cover the driving view. */
  open: boolean;
  onClose: () => void;
};

export function computeBusNetworkMiniMapSignal(runtime: ColonyRuntime): string {
  const isDriving = runtime.isOwnedDriveSeated?.() ?? (runtime as any).ownedDriveSeated;
  const pose = runtime.getOwnedDrivePose?.();
  const walk = runtime.getWalkingCell?.();
  const parked = runtime.getParkedCarPose?.();
  const selfPart = isDriving && pose
    ? `drive:${pose.x.toFixed(2)}:${pose.y.toFixed(2)}`
    : `foot:${walk ? `${walk.x.toFixed(2)}:${walk.y.toFixed(2)}` : "none"}:${parked ? `${parked.x.toFixed(2)}:${parked.y.toFixed(2)}` : "none"}`;
  const peers = Array.from(runtime.sim.state.remoteRacers?.values() ?? []);
  const peerPart = peers
    .map(
      (p) =>
        `${p.participantId}:${p.cell.x.toFixed(2)}:${p.cell.y.toFixed(2)}:${p.carX !== undefined ? `parked:${p.carX.toFixed(2)}` : "none"}`,
    )
    .sort()
    .join(";");
  return `${selfPart}|${peerPart}`;
}

export function BusNetworkMiniMap(props: BusNetworkMiniMapProps) {
  // Keep the signal subscription out of the closed HUD. When open toggles, React
  // mounts/unmounts a separate hooked component instead of changing hook order.
  if (!props.open) return null;
  return <OpenBusNetworkMiniMap {...props} />;
}

function OpenBusNetworkMiniMap({
  runtime,
  walletLabel,
  presenceReadout,
  onClose,
}: Omit<BusNetworkMiniMapProps, "open">) {
  // The HUD can be memoized independently of the scene. Subscribe to the runtime's 200ms
  // heartbeat while seated or walking so the player marker and peer markers follow live poses on the map.
  const mapSignal = useSimSignal(runtime, () => computeBusNetworkMiniMapSignal(runtime));
  void mapSignal;
  const state = runtime.sim.state;
  const terrain = state.terrain;
  const tSize = terrain?.size ?? 128;
  const depot = runtime.busDepot?.site ?? null;
  const local = presenceReadout?.entries.find((entry) => entry.isLocal) ?? null;
  const isDriving = runtime.isOwnedDriveSeated?.() ?? (runtime as any).ownedDriveSeated;
  const driving = runtime.getOwnedDrivePose?.();
  const mpClient = runtime.getMultiplayerClient();
  const isOnline = mpClient?.getStatus() === "connected";

  let player: { x: number; y: number } | null = null;
  let parkedCar: { x: number; y: number } | null = null;

  if (isDriving && driving) {
    player = { x: driving.x, y: driving.y };
  } else {
    const walkingCell = runtime.getWalkingCell?.() ??
      (local?.resolution === "exact" && local.fix?.withinExtent && local.fix.cell ? local.fix.cell : null);
    if (walkingCell) {
      player = { x: walkingCell.x, y: walkingCell.y };
    }
    const parkedPose = runtime.getParkedCarPose?.();
    if (parkedPose) {
      parkedCar = { x: parkedPose.x, y: parkedPose.y };
    } else if (mpClient?.getParkedCar()) {
      const pc = mpClient.getParkedCar()!;
      parkedCar = {
        x: pc.x / 4 + tSize / 2,
        y: pc.z / 4 + tSize / 2,
      };
    }
  }

  const peers = Array.from(state.remoteRacers?.values() ?? []).map((r) => {
    let peerParked: { x: number; y: number } | null = null;
    if (r.isPedestrian && r.carX !== undefined && r.carZ !== undefined && Number.isFinite(r.carX) && Number.isFinite(r.carZ)) {
      peerParked = {
        x: r.carX / 4 + tSize / 2,
        y: r.carZ / 4 + tSize / 2,
      };
    }
    return {
      participantId: r.participantId,
      username: r.username,
      x: r.cell.x,
      y: r.cell.y,
      parkedCar: peerParked,
    };
  });
  const model = buildBusNetworkMiniMapModel({
    ways: state.roadWays ?? [],
    routeStops: runtime.busRoute?.stops ?? [],
    depot: depot
      ? { x: depot.x + (depot.w - 1) / 2, y: depot.y + (depot.h - 1) / 2 }
      : null,
    buses: runtime.busPoses().map((p, id) => ({ id, x: p.x, y: p.y })),
    peers,
    player,
    parkedCar,
    width: WIDTH,
    height: HEIGHT,
    padding: 8,
  });
  return (
    <aside
      className="bus-network-minimap bus-network-minimap--expanded"
      aria-label="Live bus network map"
      data-expanded="true"
      role="dialog"
      aria-modal="false"
      data-testid="player-map"
    >
      <div className="bus-network-minimap__title">
        <span>CITY MAP</span>
        <span>
          {model.buses.length} BUS{model.buses.length === 1 ? "" : "ES"}
        </span>
        <button
          className="bus-network-minimap__toggle"
          type="button"
          aria-label="Close map"
          aria-expanded="true"
          data-testid="city-map-toggle"
          onClick={onClose}
        >
          Close map
        </button>
      </div>
      <div className="bus-network-minimap__summary">
        <span>{walletLabel}</span>
        <span>{model.player ? "You are here" : "Position unavailable"}</span>
      </div>
      <div className="bus-network-minimap__mode">
        {isOnline
          ? `ONLINE MULTIPLAYER (${mpClient?.getSessionInfo().inviteCode ?? "ACTIVE"})`
          : "LOCAL SESSION"}
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Roads, depot, stops and live buses"
      >
        <rect
          width={WIDTH}
          height={HEIGHT}
          rx="9"
          className="bus-network-minimap__ground"
        />
        {model.roads.map((road, i) => (
          <polyline
            key={`${road.source ?? "road"}-${i}`}
            points={road.points}
            className={
              road.source === "depot-spur"
                ? "bus-network-minimap__spur"
                : "bus-network-minimap__road"
            }
          />
        ))}
        {model.stops.map((stop, i) => (
          <circle
            key={`stop-${i}`}
            cx={stop.x}
            cy={stop.y}
            r="2.4"
            className="bus-network-minimap__stop"
          />
        ))}
        {model.depot && (
          <g aria-label="Bus depot">
            <rect
              x={model.depot.x - 4}
              y={model.depot.y - 4}
              width="8"
              height="8"
              rx="1.5"
              className="bus-network-minimap__depot"
            />
            <text x={model.depot.x + 6} y={model.depot.y + 3}>
              D
            </text>
          </g>
        )}
        {model.player && (
          <g
            aria-label={
              model.player.outOfBounds
                ? "Your current location beyond mapped roads"
                : "Your current location"
            }
            data-testid="city-map-player-marker"
            data-off-map={model.player.outOfBounds ? "true" : "false"}
          >
            <circle
              cx={model.player.x}
              cy={model.player.y}
              r="5.4"
              className={`bus-network-minimap__player-ring${model.player.outOfBounds ? " bus-network-minimap__player-ring--edge" : ""}`}
            />
            <circle
              cx={model.player.x}
              cy={model.player.y}
              r="3"
              className={`bus-network-minimap__player${model.player.outOfBounds ? " bus-network-minimap__player--edge" : ""}`}
            />
          </g>
        )}
        {model.peers.map((peer) => (
          <g
            key={`peer-${peer.participantId}`}
            aria-label={`Peer ${peer.username}`}
            data-testid="city-map-peer-marker"
            data-participant-id={peer.participantId}
            data-off-map={peer.outOfBounds ? "true" : "false"}
          >
            <circle
              cx={peer.x}
              cy={peer.y}
              r="4.8"
              fill="none"
              stroke="#00ffcc"
              strokeWidth="1.2"
              strokeDasharray="2,2"
              opacity="0.85"
            />
            <circle
              cx={peer.x}
              cy={peer.y}
              r="2.6"
              fill="#00ffcc"
            />
          </g>
        ))}
        {model.parkedCars.map((car) => (
          <g
            key={`parked-car-${car.id}`}
            aria-label={car.isLocal ? "Your parked vehicle" : `Parked vehicle of ${car.ownerName}`}
            data-testid="city-map-parked-car-marker"
            data-parked-car-id={car.id}
            data-local={car.isLocal ? "true" : "false"}
            data-off-map={car.outOfBounds ? "true" : "false"}
          >
            <rect
              x={car.x - 3.5}
              y={car.y - 2.5}
              width="7"
              height="5"
              rx="1.2"
              fill={car.isLocal ? "#38bdf8" : "#fbbf24"}
              stroke="#0f172a"
              strokeWidth="0.8"
            />
            <circle
              cx={car.x}
              cy={car.y}
              r="1"
              fill="#ffffff"
            />
          </g>
        ))}
        {model.busClusters.map((cluster) => {
          const label =
            cluster.ids.length === 1
              ? `Bus ${cluster.ids[0]! + 1}`
              : `${cluster.ids.length} buses: ${cluster.ids.map((id) => id + 1).join(", ")}`;
          const accessibleLabel = cluster.outOfBounds
            ? `${label}, at map edge`
            : label;
          return (
            <g
              key={`buses-${cluster.ids.join("-")}`}
              aria-label={accessibleLabel}
              data-bus-count={cluster.ids.length}
              data-off-map={cluster.outOfBounds ? "true" : "false"}
            >
              <circle
                cx={cluster.x}
                cy={cluster.y}
                r={cluster.ids.length > 1 ? 5.5 : 4}
                className={`bus-network-minimap__bus${cluster.outOfBounds ? " bus-network-minimap__bus--edge" : ""}`}
              />
              <text x={cluster.x} y={cluster.y + 1.8} textAnchor="middle">
                {cluster.ids.length > 1
                  ? cluster.ids.length
                  : cluster.ids[0]! + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </aside>
  );
}
