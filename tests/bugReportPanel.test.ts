import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BugReportPanel,
  bugCaptureLocationFromUi,
} from "../src/colony/ui/BugReportPanel";
import type { ColonyRuntime, ColonyUiState } from "../src/colony/runtime";
import type { WorldSurveyRegistry } from "../src/colony/worldSurvey";

function makeUi(): ColonyUiState {
  return {
    firstPerson: {
      active: true,
      citizenId: "citizen_joe",
      citizenName: "Joe the Crab",
      operatorCitizenId: "citizen_joe",
      stepInCitizenIds: ["citizen_joe"],
      lookPitch: 0,
      mouseSensitivity: "normal",
      sprintCharge: 100,
      guidedTarget: null,
      narration: null,
      narrating: false,
      blockedReason: null,
      view: {
        citizen: {
          id: "citizen_joe",
          displayName: "Joe the Crab",
          householdName: "Crab House",
          homeXY: { x: 10, y: 11 },
          positionXY: { x: 303, y: 302 },
          heading: 0,
          plotName: "Occupied",
        },
      },
    },
  } as unknown as ColonyUiState;
}

describe("BugReportPanel", () => {
  it("renders the capture, report, and queue goal controls without calling the runtime during SSR", () => {
    const html = renderToStaticMarkup(
      React.createElement(BugReportPanel, {
        open: true,
        runtime: {} as ColonyRuntime,
        ui: makeUi(),
        onClose: () => {},
      }),
    );

    expect(html).toContain("Log Bug");
    expect(html).toContain("Capture current view");
    expect(html).toContain('data-bug-action="capture"');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="steps"');
    expect(html).toContain('name="expected"');
    expect(html).toContain('name="actual"');
    expect(html).toContain("Queue as goal");
    expect(html).toContain('data-bug-action="queue-goal"');
  });

  it("derives a surface-frame presence address from the live first-person position", () => {
    const survey = {
      surfaceFrameId: "surface",
      frames: new Map([
        [
          "surface",
          {
            id: "surface",
            kind: "region",
            address: "spatial://citylife/world/seed-4242/region/surface",
            layer: "surface",
            transform: {
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
            grid: {
              origin: { x: -1216, y: 0, z: -1216 },
              width: 608,
              height: 608,
              cellSize: 4,
            },
          },
        ],
      ]),
    } as unknown as WorldSurveyRegistry;

    expect(bugCaptureLocationFromUi(makeUi(), survey)).toEqual({
      frameId: "surface",
      point: { x: -4, y: 0, z: -8 },
    });
  });
});
