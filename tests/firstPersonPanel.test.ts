import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FirstPersonPanel } from "../src/colony/ui/FirstPersonPanel";
import type { ColonyUiState, ColonyRuntime } from "../src/colony/runtime";

function makeRuntime(): ColonyRuntime {
  return {
    exitFirstPerson() {},
    narrate() {},
    walkStep() {},
  } as unknown as ColonyRuntime;
}

function makeFirstPerson(): ColonyUiState["firstPerson"] {
  return {
    active: true,
    citizenId: "citizen-1",
    citizenName: "Mira Vale",
    operatorCitizenId: null,
    stepInCitizenIds: ["citizen-1"],
    lookPitch: 0,
    narration: "The plaza is calm.",
    narrating: false,
    blockedReason: "water",
    view: {
      citizen: {
        id: "citizen-1",
        displayName: "Mira Vale",
        householdName: "Vale House",
        homeXY: { x: 12, y: 18 },
        positionXY: { x: 12.4, y: 18.1 },
        heading: 0,
        plotName: "Lot 1",
      },
      ground: { biome: "grass", elevation: 0.123, isWater: false, distToWater: 8 },
      nearestRoad: { x: 13, y: 18, distance: 1 },
      nearestBuildings: [{ kind: "house", distance: 7 }],
      clock: { day: 3, hour: 9, minute: 5, isDay: true },
      nearestCivic: [{ kind: "market", distance: 6 }],
      neighbours: [{ displayName: "Orin Reed", plotName: "Lot 2", distance: 4 }],
      mood: {
        liveability: 0.5,
        hungry: false,
        brownout: false,
        fever: 0,
        unrest: 0,
        hygiene: 1,
      },
      interactionPrompt: {
        kind: "citizen",
        label: "Talk to Orin Reed",
        targetName: "Orin Reed",
        distance: 4,
      },
    },
  } as ColonyUiState["firstPerson"];
}

describe("FirstPersonPanel immersive HUD", () => {
  it("keeps player overlay concise and hides debug telemetry by default", () => {
    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp: makeFirstPerson(),
      }),
    );

    expect(html).toContain("Action");
    expect(html).toContain("Talk to Orin Reed");
    expect(html).toContain("Blocked");
    expect(html).toContain("Show debug");
    expect(html).not.toContain("Ground");
    expect(html).not.toContain("Neighbours");
    expect(html).not.toContain("grass");
  });
});
