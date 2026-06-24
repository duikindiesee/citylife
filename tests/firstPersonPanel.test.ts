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
    activateFirstPersonInteraction() {
      return true;
    },
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
    mouseSensitivity: "normal",
    sprintCharge: 42,
    guidedTarget: null,
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
      ground: {
        biome: "grass",
        elevation: 0.123,
        isWater: false,
        distToWater: 8,
      },
      nearestRoad: { x: 13, y: 18, distance: 1 },
      nearestBuildings: [{ kind: "house", distance: 7 }],
      clock: { day: 3, hour: 9, minute: 5, isDay: true },
      nearestCivic: [{ kind: "market", distance: 6 }],
      neighbours: [
        { displayName: "Orin Reed", plotName: "Lot 2", distance: 4 },
      ],
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
        targetXY: { x: 13, y: 18 },
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
    expect(html).toContain("Use E");
    expect(html).toContain("Shift sprint");
    expect(html).toContain("Sprint 42%");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Sprint charge 42%"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain("width:42%");
    expect(html).toContain("Blocked");
    expect(html).toContain("Show debug");
    expect(html).not.toContain("Ground");
    expect(html).not.toContain("Neighbours");
    expect(html).not.toContain("grass");
  });

  it("shows concise recovery guidance when sprint charge is depleted", () => {
    const fp = makeFirstPerson();
    fp.sprintCharge = 0;

    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp,
      }),
    );

    expect(html).toContain("Sprint depleted — walk to recover");
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain("width:0%");
    expect(html).not.toContain("Ground");
    expect(html).not.toContain("Neighbours");
  });

  it("shows a low sprint hint before the charge is empty", () => {
    const fp = makeFirstPerson();
    fp.sprintCharge = 12;

    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp,
      }),
    );

    expect(html).toContain("Sprint low — ease off to recover");
    expect(html).not.toContain("Sprint depleted — walk to recover");
  });

  it("shows guided walk target feedback in the player overlay", () => {
    const fp = makeFirstPerson();
    fp.guidedTarget = { label: "road", x: 301, y: 306, remainingDistance: 1.4 };

    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp,
      }),
    );

    expect(html).toContain("Guided walk");
    expect(html).toContain("road");
    expect(html).toContain("301");
    expect(html).toContain("306");
    expect(html).toContain("1.4 units away");
    expect(html).not.toContain("Ground");
    expect(html).not.toContain("Neighbours");
  });

  it("shows the next guided route leg without exposing debug telemetry", () => {
    const fp = makeFirstPerson();
    fp.guidedTarget = {
      label: "road",
      x: 301,
      y: 306,
      remainingDistance: 2.8,
      nextWaypoint: { x: 300, y: 307 },
    } as unknown as ColonyUiState["firstPerson"]["guidedTarget"];

    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp,
      }),
    );

    expect(html).toContain("Next leg");
    expect(html).toContain("300");
    expect(html).toContain("307");
    expect(html).not.toContain("Ground");
    expect(html).not.toContain("Neighbours");
  });

  it("renders the first-person HUD as a mobile-friendly control dock", () => {
    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp: makeFirstPerson(),
      }),
    );

    expect(html).toContain('class="first-person-panel"');
    expect(html).toContain('class="first-person-panel__touch-grid"');
    expect(html).toContain('class="first-person-panel__touch-button"');
    expect(html).toContain('class="first-person-panel__action-button"');
    expect(html).toContain('data-fp-action="exit"');
    expect(html).toContain('aria-label="Exit first-person view"');
    expect(html).toContain('data-fp-action="use"');
    expect(html).toContain('data-fp-action="walk-north"');
    expect(html).toContain('data-fp-action="walk-east"');
    expect(html).toContain('data-fp-action="narrate"');
    expect(html).toContain('aria-label="Walk north"');
    expect(html).toContain('aria-label="Walk east"');
    expect(html).toContain('aria-label="Narrate now"');
    expect(html).toContain(
      'aria-label="Use current action: Talk to Orin Reed"',
    );
    expect(html).toContain("Tap Use to interact");
    expect(html).toContain("Tap arrows to roam");
  });
});
