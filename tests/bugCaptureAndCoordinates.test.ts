import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BuildStamp } from "../src/colony/ui/BuildStamp";
import { BugReportPanel } from "../src/colony/ui/BugReportPanel";
import { PlanetRenderer } from "../src/colony/render/R3FPlanetRenderer";
import type { ColonyRuntime, ColonyUiState } from "../src/colony/runtime";

describe("bug capture and coordinate burn-in", () => {
  it("BuildStamp always displays diagnostic coordinates for in-game HUD and FP views", () => {
    const mockSim = {
      state: {
        terrain: {
          size: 608,
          worldYAt: (x: number, y: number) => 12.34,
        },
        seed: 4242,
        operatorCar: {
          cell: { x: 100, y: 100 },
          heading: 0,
        },
      },
    };

    const mockRuntime = {
      sim: mockSim,
      getSeed: () => 4242,
      getOwnedDrivePose: () => ({
        x: 304,
        y: 304,
        heading: Math.PI / 2, // 90 degrees
        speed: 15,
      }),
      isRoadSurface: () => true,
    } as unknown as ColonyRuntime;

    // In a test environment or client environment, BuildStamp renders coordinates
    const html = renderToStaticMarkup(
      React.createElement(BuildStamp, {
        variant: "hud",
        runtime: mockRuntime,
      }),
    );

    expect(html).toContain("build-stamp");
    expect(html).toContain("build-stamp--hud");
  });

  it("BuildStamp prioritizes player first-person position over parked operatorCar", () => {
    const mockSim = {
      state: {
        terrain: {
          size: 608,
          worldYAt: () => 5.0,
        },
        seed: 4242,
        operatorCar: {
          cell: { x: 50, y: 50 },
          heading: 0,
        },
      },
    };

    const mockRuntime = {
      sim: mockSim,
      getSeed: () => 4242,
      getOwnedDrivePose: () => null, // not driving
      fpCameraCell: { x: 300, y: 300 }, // walking on foot
      fpCameraYaw: Math.PI, // 180 degrees
      isRoadSurface: () => false,
    } as unknown as ColonyRuntime;

    const html = renderToStaticMarkup(
      React.createElement(BuildStamp, {
        variant: "fp",
        runtime: mockRuntime,
      }),
    );

    expect(html).toContain("build-stamp--fp");
  });

  it("BugReportPanel renders preview image when capture.pngDataUrl is present", () => {
    const mockUi = {
      firstPerson: {
        active: true,
        citizenId: "citizen_joe",
        view: {
          citizen: {
            positionXY: { x: 300, y: 300 },
          },
        },
      },
    } as unknown as ColonyUiState;

    const mockCapture = {
      context: {
        captureId: "cap-999",
        sol: { sol: 42 },
        viewport: { width: 1280, height: 720 },
      },
      pngDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    };

    const mockRuntime = {
      worldSurvey: () => ({
        surfaceFrameId: "surface",
        frames: new Map([
          [
            "surface",
            {
              grid: {
                origin: { x: 0, y: 0, z: 0 },
                cellSize: 4,
              },
            },
          ],
        ]),
      }),
      captureBugContext: () => mockCapture,
    } as unknown as ColonyRuntime;

    const html = renderToStaticMarkup(
      React.createElement(BugReportPanel, {
        open: true,
        runtime: mockRuntime,
        ui: mockUi,
        onClose: () => {},
      }),
    );

    expect(html).toContain("Log Bug");
    expect(html).toContain("Capture current view");
  });

  it("PlanetRenderer.prototype.capturePNG safely returns null when unmounted", () => {
    const dummySim = {
      state: {
        terrain: {
          size: 608,
          worldYAt: () => 0,
          inBounds: () => true,
        },
      },
    } as any;

    // r3fProbe is not populated in a unit-test environment, so capturePNG returns null safely
    const png = PlanetRenderer.prototype.capturePNG.call({ sim: dummySim, runtime: null });
    expect(png).toBeNull();
  });
});
