import { describe, expect, it } from "vitest";
import type { Terrain } from "../src/colony/terrain";
import { buildBusLayer } from "../src/colony/render/busLayer";

const route = {
  stops: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
  ],
  loop: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 4, y: 0 },
    { x: 3, y: 1 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
  ],
};

describe("bus layer visual model", () => {
  it("builds a recognizable coach with windows, doors, lights, route board, roof marker, and wheel pairs", () => {
    const layer = buildBusLayer({
      terrain: {} as Terrain,
      route,
      wx: (x) => x,
      wz: (y) => y,
      roadY: () => 0,
    });

    expect(layer).not.toBeNull();
    const names = new Set<string>();
    layer!.group.traverse((object) => {
      if (object.name) names.add(object.name);
    });

    expect(Array.from(names)).toEqual(
      expect.arrayContaining([
        "bus-body",
        "bus-windscreen",
        "bus-side-window-left-0",
        "bus-side-window-right-0",
        "bus-door-left",
        "bus-door-right",
        "bus-route-board-front",
        "bus-headlight-left",
        "bus-tail-light-left",
        "bus-roof-marker",
        "bus-wheel-front-left",
        "bus-wheel-rear-right",
      ]),
    );

    layer!.dispose();
  });
});
