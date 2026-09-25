import type { ColonyRuntime } from "../runtime";
import { useState } from "react";
import type { PresenceReadout } from "../spatial/presenceReadout";
import { useSimSignal } from "../render/useSimSignal";
import { buildBusNetworkMiniMapModel } from "./busNetworkMiniMapModel";

const WIDTH = 200;
const HEIGHT = 132;

export function BusNetworkMiniMap({
  runtime,
  walletLabel,
  presenceReadout,
}: {
  runtime: ColonyRuntime;
  /** Server-authenticated wallet state, or City view for an operator. */
  walletLabel: string;
  presenceReadout: PresenceReadout | null;
}) {
  const [expanded, setExpanded] = useState(false);
  // The HUD can be memoized independently of the scene. Subscribe to the runtime's 200ms
  // heartbeat while seated so the player marker follows the live car pose on the map.
  const drivePosition = useSimSignal(runtime, () => {
    const pose = runtime.getOwnedDrivePose();
    return pose
      ? `drive:${pose.x.toFixed(2)}:${pose.y.toFixed(2)}`
      : "drive:parked";
  });
  void drivePosition;
  const state = runtime.sim.state;
  const depot = runtime.busDepot?.site ?? null;
  const local = presenceReadout?.entries.find((entry) => entry.isLocal) ?? null;
  // While seated, the car pose is the player's actual location. On foot, use the already-authorized
  // exact presence projection; never guess from a spawn/home or draw a coarse position as exact.
  const driving = (
    runtime as ColonyRuntime & {
      getOwnedDrivePose?: () => { x: number; y: number } | null;
    }
  ).getOwnedDrivePose?.();
  const player = driving
    ? { x: driving.x, y: driving.y }
    : local?.resolution === "exact" && local.fix?.withinExtent && local.fix.cell
      ? { x: local.fix.cell.x, y: local.fix.cell.y }
      : null;
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
      className={`bus-network-minimap${expanded ? " bus-network-minimap--expanded" : ""}`}
      aria-label="Live bus network map"
      data-expanded={expanded ? "true" : "false"}
    >
      <div className="bus-network-minimap__title">
        <span>CITY MAP</span>
        <span>
          {model.buses.length} BUS{model.buses.length === 1 ? "" : "ES"}
        </span>
        <button
          className="bus-network-minimap__toggle"
          type="button"
          aria-label={expanded ? "Collapse city map" : "Expand city map"}
          aria-expanded={expanded}
          data-testid="city-map-toggle"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Close map" : "Open map"}
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
