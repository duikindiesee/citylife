import type { ColonyRuntime } from "../runtime";
import type { PresenceReadout } from "../spatial/presenceReadout";
import { useSimSignal } from "../render/useSimSignal";
import {
  buildBusNetworkMiniMapModel,
  resolveLocalPlayerMapPosition,
} from "./busNetworkMiniMapModel";

const WIDTH = 200;
const HEIGHT = 132;

type BusNetworkMiniMapProps = {
  runtime: ColonyRuntime;
  /** Server-authenticated wallet state, or City view for an operator. */
  walletLabel: string;
  presenceReadout: PresenceReadout | null;
  /** True only for an authenticated player in the interactive view; hides personal position on logout/preview. */
  playerLocationAuthorized: boolean;
  /** The map is summoned on demand so it does not cover the driving view. */
  open: boolean;
  onClose: () => void;
};

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
  playerLocationAuthorized,
  onClose,
}: Omit<BusNetworkMiniMapProps, "open">) {
  // The HUD can be memoized independently of the scene. Subscribe to the runtime's 200ms
  // heartbeat while seated so the player marker follows the live car pose on the map.
  const playerPosition = useSimSignal(runtime, () => {
    const pose = runtime.getOwnedDrivePose();
    const firstPerson = runtime.getUiState().firstPerson;
    const camera =
      firstPerson.operatorCitizenId !== null &&
      firstPerson.citizenId === firstPerson.operatorCitizenId
        ? runtime.fpCameraCell
        : null;
    return pose
      ? `drive:${pose.x.toFixed(2)}:${pose.y.toFixed(2)}:${camera?.x.toFixed(2) ?? "?"}:${camera?.y.toFixed(2) ?? "?"}`
      : camera
        ? `camera:${camera.x.toFixed(2)}:${camera.y.toFixed(2)}`
        : "camera:unknown";
  });
  void playerPosition;
  const state = runtime.sim.state;
  const depot = runtime.busDepot?.site ?? null;
  const firstPerson = runtime.getUiState().firstPerson;
  const operatorCitizenId = firstPerson.operatorCitizenId;
  const ownPresence = operatorCitizenId
    ? presenceReadout?.entries.find(
        (entry) => entry.subjectId === operatorCitizenId,
      ) ?? null
    : null;
  const ownCamera =
    operatorCitizenId !== null &&
    firstPerson.citizenId === operatorCitizenId
      ? runtime.fpCameraCell
      : null;
  // The capsule/camera is the live local position while walking, and the owned drive pose is the
  // live car position while seated. Camera and presence fallbacks are bound to the authenticated
  // account's citizen id, not `isLocal`, which can mean an inspected citizen in operator view.
  // Never infer a current position from a spawn/home anchor or another citizen's marker.
  const player = resolveLocalPlayerMapPosition({
    playerLocationAuthorized,
    operatorCitizenId,
    activeCitizenId: firstPerson.citizenId,
    drivePose: runtime.getOwnedDrivePose(),
    cameraCell: ownCamera,
    exactOwnPresence:
      ownPresence?.resolution === "exact" &&
      ownPresence.fix?.withinExtent &&
      ownPresence.fix.cell
        ? {
            subjectId: ownPresence.subjectId,
            cell: {
              x: ownPresence.fix.cell.x,
              y: ownPresence.fix.cell.y,
            },
          }
        : null,
  });
  const model = buildBusNetworkMiniMapModel({
    ways: state.roadWays ?? [],
    routeStops: runtime.busRoute?.stops ?? [],
    depot: depot
      ? { x: depot.x + (depot.w - 1) / 2, y: depot.y + (depot.h - 1) / 2 }
      : null,
    buses: runtime.busPoses().map((p, id) => ({ id, x: p.x, y: p.y })),
    player,
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
      <div className="bus-network-minimap__mode">LOCAL SESSION</div>
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
