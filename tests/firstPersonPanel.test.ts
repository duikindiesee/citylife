import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FirstPersonPanel } from "../src/colony/ui/FirstPersonPanel";
import * as buildStampModule from "../src/colony/buildStamp";
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

    expect(html).toContain(
      'class="first-person-panel first-person-panel--edge-hud"',
    );
    expect(html).toContain('class="first-person-panel__destination-strip"');
    expect(html).toContain("Talk to Orin Reed");
    expect(html).toContain("Use E");
    expect(html).not.toContain("Shift sprint");
    expect(html).toContain("Sprint 42%");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Sprint charge 42%"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain("width:42%");
    expect(html).toContain("Blocked: water");
    expect(html).toContain("Help / Controls");
    expect(html).toContain("HUD details");
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
    const content = html.replace(
      /<div class="build-stamp[^>]*>.*?<\/div>/s,
      "",
    );
    expect(content).not.toContain("301");
    expect(content).not.toContain("306");
    expect(content).not.toContain("Ground");
    expect(content).not.toContain("Neighbours");
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
    const content = html.replace(
      /<div class="build-stamp[^>]*>.*?<\/div>/s,
      "",
    );
    expect(content).not.toContain("Next leg");
    expect(content).not.toContain("300");
    expect(content).not.toContain("307");
    expect(content).not.toContain("Ground");
    expect(content).not.toContain("Neighbours");
  });

  it("does not present offline city residents as online friends", () => {
    const fp = makeFirstPerson();
    if (!fp.view) throw new Error("expected first-person view");
    fp.view.clock.isDay = false;
    fp.view.neighbours = [
      { displayName: "Cole the Racer", plotName: "Occupied", distance: 2 },
    ];
    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, { runtime: makeRuntime(), fp }),
    );
    expect(html).not.toContain("Friend nearby at the night rally");
    expect(html).not.toContain("Cole the Racer");
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
    expect(html).not.toContain("Tap Use to interact");
    expect(html).not.toContain("Tap arrows to roam");
  });

  it("renders a KOOKER beacon Roadmap selector when the operator is near KOOKER", () => {
    const fp = makeFirstPerson();
    if (!fp.view) throw new Error("expected first-person view");
    fp.view.interactionPrompt = {
      kind: "citizen",
      label: "Talk to KOOKER the Builder",
      targetName: "KOOKER the Builder",
      targetXY: { x: 216, y: 337 },
      distance: 2.4,
    };

    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp,
        onOpenRoadmap: () => {},
      }),
    );

    expect(html).toContain('data-roadmap-action="open-from-kooker-beacon"');
    expect(html).toContain(
      'aria-label="Open CityLife roadmap from KOOKER beacon"',
    );
    expect(html).toContain("Roadmap");
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
    expect(html).toContain('class="first-person-panel__joystick"');
    expect(html).toContain('aria-label="Mobile movement joystick"');
    expect(html).toContain('class="first-person-panel__action-cluster"');
    expect(html).toContain('class="first-person-panel__guidance-caption"');
    expect(html).toContain('data-fp-action="toggle-details"');
    expect(html).toContain('data-fp-action="toggle-help"');
    expect(html).not.toContain('class="first-person-panel__debug-panel"');

    // Isolate visible HUD content from incidental <BuildStamp> ISO metadata timestamps (e.g. .226Z)
    const content = html.replace(
      /<div class="build-stamp[^>]*>.*?<\/div>/s,
      "",
    );

    expect(content).not.toContain("Rally Point");
    expect(content).not.toContain("201.1 units away");
    expect(content).not.toContain("Cole the Racer");
    expect(content).not.toContain("Guiding to Rally Point");
    expect(content).not.toContain('data-fp-action="walk-to-rally"');
    expect(content).not.toContain("Next leg");
    expect(content).not.toContain("226");
    expect(content).not.toContain("349");
    expect(content).not.toContain("(425");
    expect(content).not.toContain("326)");
    expect(content).not.toContain("Show debug");
  });

  it("renders non-rally guided target in destination strip and caption (positive control for guidedTarget)", () => {
    const fp = makeFirstPerson();
    fp.guidedTarget = {
      label: "Market Square",
      x: 226,
      y: 349,
      remainingDistance: 45.2,
      nextWaypoint: { x: 226, y: 349 },
    } as unknown as ColonyUiState["firstPerson"]["guidedTarget"];

    const html = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp,
      }),
    );

    expect(html).toContain('class="first-person-panel__destination-target"');
    expect(html).toContain("Market Square");
    expect(html).toContain("45.2 units away");
    expect(html).toContain("Guiding to Market Square · 45.2 units away");

    // Waypoint coordinates and debug telemetry remain hidden even when guiding is active
    const content = html.replace(
      /<div class="build-stamp[^>]*>.*?<\/div>/s,
      "",
    );
    expect(content).not.toContain("Next leg");
    expect(content).not.toContain("226");
    expect(content).not.toContain("349");
  });

  it("distinguishes incidental build timestamp collisions ending in .226Z from semantic waypoint leakage", () => {
    const fp = makeFirstPerson();
    if (!fp.view) throw new Error("expected first-person view");
    fp.view.clock.isDay = false;
    fp.guidedTarget = {
      label: "Rally Point",
      x: 425,
      y: 326,
      remainingDistance: 201.1,
      nextWaypoint: { x: 226, y: 349 },
    } as unknown as ColonyUiState["firstPerson"]["guidedTarget"];

    // Force build timestamp to reproduce the exact hosted collision: milliseconds ending in .226Z
    const buildStampSpy = vi
      .spyOn(buildStampModule, "buildStampParts")
      .mockReturnValue({
        version: "0.60.3",
        sha: "7664cea",
        builtAt: "2026-10-13T00:54:58.226Z",
      });

    try {
      const html = renderToStaticMarkup(
        React.createElement(FirstPersonPanel, {
          runtime: makeRuntime(),
          fp,
        }),
      );

      // Verify the simulated hosted timestamp is present in the build metadata
      expect(html).toContain(
        'title="Build timestamp">2026-10-13T00:54:58.226Z</span>',
      );
      // Demonstrates that raw unisolated html contains the substring "226" due strictly to metadata
      expect(html).toContain("226");

      // Verify that semantic player HUD content cleanly isolates this metadata and never leaks waypoints
      const content = html.replace(
        /<div class="build-stamp[^>]*>.*?<\/div>/s,
        "",
      );
      expect(content).not.toContain("226");
      expect(content).not.toContain("349");
      expect(content).not.toContain("(425");
      expect(content).not.toContain("326)");
      expect(content).not.toContain("Next leg");
      expect(content).not.toContain("Rally Point");
      expect(content).not.toContain("201.1 units away");

      // Negative control: verify that if a waypoint coordinate WERE leaked into the HUD narration, content catches it
      const leakedFp = {
        ...fp,
        narration: "Approaching waypoint 226 now.",
      };
      const leakedHtml = renderToStaticMarkup(
        React.createElement(FirstPersonPanel, {
          runtime: makeRuntime(),
          fp: leakedFp,
        }),
      );
      const leakedContent = leakedHtml.replace(
        /<div class="build-stamp[^>]*>.*?<\/div>/s,
        "",
      );
      expect(leakedContent).toContain("226");
    } finally {
      buildStampSpy.mockRestore();
    }
  });

  it("renders bus stop card with boarding, waiting, and unavailable status states", () => {
    const baseFp = makeFirstPerson();

    // 1. Idle near stop pole with no bus dwelling
    const idleFp = {
      ...baseFp,
      busStop: {
        anchor: {
          arc: 100,
          at: { x: 10, y: 10 },
          cell: { x: 10, y: 10 },
          furniture: { x: 8, y: 10 },
          heading: 0,
          verge: { x: -1, y: 0 },
        },
        stopIndex: 0,
        stopName: "Market Square",
        furnitureXY: { x: 8, y: 10 },
        distance: 1.2,
        isNearPole: true,
        canBoard: false,
        boardUnavailableReason: "No bus currently at stop",
        dwellingBusId: null,
        isWaiting: false,
      },
    };
    const idleHtml = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp: idleFp,
      }),
    );
    expect(idleHtml).toContain('data-testid="bus-stop-card"');
    expect(idleHtml).toContain("Market Square");
    expect(idleHtml).toContain("Free fare");
    expect(idleHtml).toContain("No bus currently at stop");
    expect(idleHtml).toContain("Wait for next bus");

    // 2. Waiting for next bus
    const waitingFp = {
      ...baseFp,
      busStop: {
        ...idleFp.busStop,
        isWaiting: true,
      },
    };
    const waitingHtml = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp: waitingFp,
      }),
    );
    expect(waitingHtml).toContain("Waiting for next bus — will board automatically on arrival");
    expect(waitingHtml).toContain("Cancel wait");

    // 3. Dwelling bus ready to board
    const boardFp = {
      ...baseFp,
      busStop: {
        ...idleFp.busStop,
        canBoard: true,
        dwellingBusId: 2,
        boardUnavailableReason: null,
      },
    };
    const boardHtml = renderToStaticMarkup(
      React.createElement(FirstPersonPanel, {
        runtime: makeRuntime(),
        fp: boardFp,
      }),
    );
    expect(boardHtml).toContain("Bus 3 doors open — ready to board");
    expect(boardHtml).toContain("Board Bus 3");
  });
});
