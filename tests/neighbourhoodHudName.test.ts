import { describe, expect, it } from "vitest";
import {
  CITYLIFE_NEIGHBOURHOOD_NAMES,
  nearestNeighbourhoodLabel,
} from "../src/colony/neighbourhoodNames";

describe("HUD neighbourhood names", () => {
  it("uses the required public neighbourhood names", () => {
    expect(CITYLIFE_NEIGHBOURHOOD_NAMES).toEqual([
      "Kookerbos Woods",
      "Driftwood Shore",
      "Lantern Hollow",
      "Crewhouse Quarter",
      "Saltkern Bay",
      "Ridgeline",
    ]);
  });

  it("reports when the player is in the nearest neighbourhood", () => {
    const copy = nearestNeighbourhoodLabel(
      { x: 102, y: 100 },
      [
        { name: "Crewhouse Quarter", x: 100, y: 100, radius: 20 },
        { name: "Ridgeline", x: 200, y: 200, radius: 20 },
      ],
    );

    expect(copy).toEqual({ name: "Crewhouse Quarter", relation: "in" });
  });

  it("reports near when the player is closest but outside the neighbourhood radius", () => {
    const copy = nearestNeighbourhoodLabel(
      { x: 140, y: 100 },
      [{ name: "Driftwood Shore", x: 100, y: 100, radius: 20 }],
    );

    expect(copy).toEqual({ name: "Driftwood Shore", relation: "near" });
  });
});
