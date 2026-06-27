import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FirstPersonPanel,
  nightFriendBannerCopy,
} from "../src/colony/ui/FirstPersonPanel";
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
    neighbourhood: { name: "Driftwood Shore", relation: "in" },
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

    expect(html).toContain(
      'class="first-person-panel first-person-panel--edge-hud"',
    );
    expect(html).toContain('class="first-person-panel__destination-strip"');
    expect(html).toContain("Talk to Orin Reed");
    expect(html).toContain("Use E");
    expect(html).toContain("Shift sprint");
    expect(html).toContain("Sprint 42%");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Sprint charge 42%"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain("width:42%");
    expect(html).toContain("Blocked: water");
    expect(html).toContain("Debug");
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

    expect(html).toContain('class="first-person-panel__destination-strip"');
    expect(html).toContain("road");
    expect(html).toContain("1.4 units away");
    expect(html).toContain("Guiding to road · 1.4 units away");
    expect(html).not.toContain("301");
    expect(html).not.toContain("306");
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

    expect(html).toContain("road");
    expect(html).toContain("2.8 units away");
    expect(html).toContain("Guiding to road · 2.8 units away");
    expect(html).not.toContain("Next leg");
    expect(html).not.toContain("300");
    expect(html).not.toContain("307");
    expect(html).not.toContain("Ground");
    expect(html).not.toContain("Neighbours");
  });

  it("shows a night-only friend banner from nearby public names", () => {
    const fp = makeFirstPerson();
    if (!fp.view) throw new Error("expected first-person view");
    fp.view.clock.isDay = false;
    fp.view.neighbours = [
      { displayName: "Orin Reed", plotName: "Occupied", distance: 4 },
      { displayName: "Mara Lane", plotName: "Occupied", distance: 5 },
      { displayName: "Third Friend", plotName: "Occupied", distance: 6 },
    ];

    expect(nightFriendBannerCopy(fp.view)).toBe(
      "Friend nearby at the night rally: Orin, Mara",
    );

    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp,
      }),
    );
    expect(html).toContain("Friend nearby at the night rally: Orin, Mara");
    expect(html).not.toContain("Third");
  });

  it("screens unsafe neighbour names from the night friend banner", () => {
    const fp = makeFirstPerson();
    if (!fp.view) throw new Error("expected first-person view");
    fp.view.clock.isDay = false;
    fp.view.neighbours = [
      { displayName: "Hermes token keeper", plotName: "Occupied", distance: 4 },
      { displayName: "Orin Reed", plotName: "Occupied", distance: 5 },
    ];

    expect(nightFriendBannerCopy(fp.view)).toBe(
      "Friend nearby at the night rally: Orin",
    );
  });

  it("hides the friend banner by day and when nobody is nearby", () => {
    const fp = makeFirstPerson();
    if (!fp.view) throw new Error("expected first-person view");
    expect(nightFriendBannerCopy(fp.view)).toBeNull();
    fp.view.clock.isDay = false;
    fp.view.neighbours = [];
    expect(nightFriendBannerCopy(fp.view)).toBeNull();
  });

  it("renders the first-person HUD as a mobile-friendly control dock", () => {
    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp: makeFirstPerson(),
      }),
    );

    expect(html).toContain(
      'class="first-person-panel first-person-panel--edge-hud"',
    );
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

  it("keeps mobile first-person controls on the edges with a compact destination strip", () => {
    const fp = makeFirstPerson();
    if (!fp.view) throw new Error("expected first-person view");
    fp.view.clock.isDay = false;
    fp.view.neighbours = [
      { displayName: "Cole the Racer", plotName: "Occupied", distance: 2 },
    ];
    fp.guidedTarget = {
      label: "Rally Point",
      x: 425,
      y: 326,
      remainingDistance: 201.1,
      nextWaypoint: { x: 226, y: 349 },
    } as unknown as ColonyUiState["firstPerson"]["guidedTarget"];

    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp,
      }),
    );

    expect(html).toContain(
      'class="first-person-panel first-person-panel--edge-hud"',
    );
    expect(html).toContain('class="first-person-panel__destination-strip"');
    expect(html).toContain("Rally Point");
    expect(html).toContain("201.1 units away");
    expect(html).toContain("Friend nearby at the night rally: Cole");
    expect(html).toContain('class="first-person-panel__joystick"');
    expect(html).toContain('aria-label="Mobile movement joystick"');
    expect(html).toContain('class="first-person-panel__action-cluster"');
    expect(html).toContain('class="first-person-panel__guidance-caption"');
    expect(html).toContain("Guiding to Rally Point · 201.1 units away");
    expect(html).toContain('class="first-person-panel__debug-toggle"');
    expect(html).not.toContain("Next leg");
    expect(html).not.toContain("226");
    expect(html).not.toContain("349");
    expect(html).not.toContain("(425");
    expect(html).not.toContain("326)");
    expect(html).not.toContain("Show debug");
  });
});
