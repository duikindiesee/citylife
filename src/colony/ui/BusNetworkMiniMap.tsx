import type { ColonyRuntime } from "../runtime";
import { buildBusNetworkMiniMapModel } from "./busNetworkMiniMapModel";

const WIDTH = 200;
const HEIGHT = 132;

export function BusNetworkMiniMap({ runtime }: { runtime: ColonyRuntime }) {
  const state = runtime.sim.state;
  const depot = runtime.busDepot?.site ?? null;
  const model = buildBusNetworkMiniMapModel({
    ways: state.roadWays ?? [],
    routeStops: runtime.busRoute?.stops ?? [],
    depot: depot
      ? { x: depot.x + (depot.w - 1) / 2, y: depot.y + (depot.h - 1) / 2 }
      : null,
    buses: runtime.busPoses().map((p, id) => ({ id, x: p.x, y: p.y })),
    width: WIDTH,
    height: HEIGHT,
    padding: 8,
  });
  return (
    <aside className="bus-network-minimap" aria-label="Live bus network map">
      <div className="bus-network-minimap__title">
        <span>BUS NETWORK</span>
        <span>{model.buses.length} LIVE</span>
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
        {model.busClusters.map((cluster) => {
          const label =
            cluster.ids.length === 1
              ? `Bus ${cluster.ids[0]! + 1}`
              : `${cluster.ids.length} buses: ${cluster.ids.map((id) => id + 1).join(", ")}`;
          return (
            <g
              key={`buses-${cluster.ids.join("-")}`}
              aria-label={label}
              data-bus-count={cluster.ids.length}
            >
              <circle
                cx={cluster.x}
                cy={cluster.y}
                r={cluster.ids.length > 1 ? 5.5 : 4}
                className="bus-network-minimap__bus"
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
