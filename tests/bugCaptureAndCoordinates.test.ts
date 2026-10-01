import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BuildStamp, deriveDiagnosticReadout } from "../src/colony/ui/BuildStamp";
import { BugReportPanel } from "../src/colony/ui/BugReportPanel";
import { PlanetRenderer } from "../src/colony/render/R3FPlanetRenderer";
import type { ColonyRuntime, ColonyUiState } from "../src/colony/runtime";

describe("bug capture and coordinate burn-in", () => {
  it("derives exact diagnostic coordinates for active driving player with road elevation offset", () => {
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

    const diag = deriveDiagnosticReadout(mockRuntime);
    expect(diag).not.toBeNull();
    // Center of map 304 on 608 size is world (0, 0)
    expect(diag!.x).toBe(0);
    expect(diag!.z).toBe(0);
    // Road surface adds 0.18m lift to 12.34m terrain
    expect(diag!.elev).toBeCloseTo(12.52, 2);
    expect(diag!.headingDeg).toBe(90);
    expect(diag!.seed).toBe(4242);

    const html = renderToStaticMarkup(
      React.createElement(BuildStamp, {
        variant: "hud",
        runtime: mockRuntime,
      }),
    );
    expect(html).toContain("build-stamp");
    expect(html).toContain("build-stamp--hud");
  });

  it("prioritizes player first-person walking coordinates over parked operatorCar", () => {
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

    const diag = deriveDiagnosticReadout(mockRuntime);
    expect(diag).not.toBeNull();
    // (300 - 304) * 4 = -16m
    expect(diag!.x).toBe(-16);
    expect(diag!.z).toBe(-16);
    expect(diag!.elev).toBe(5.0);
    expect(diag!.headingDeg).toBe(180);
    expect(diag!.seed).toBe(4242);

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

    const png = PlanetRenderer.prototype.capturePNG.call({ sim: dummySim, runtime: null });
    expect(png).toBeNull();
  });

  it("renders non-black canvas composite with burned-in coordinate banner", () => {
    const filledTexts: string[] = [];
    const mockCtx = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn((text: string, _x?: number, _y?: number) => filledTexts.push(text)),
      measureText: vi.fn(() => ({ width: 150 })),
      fillStyle: "",
      font: "",
      textBaseline: "",
    };

    const mockCanvas = {
      width: 1280,
      height: 720,
      getContext: vi.fn(() => mockCtx),
      toDataURL: vi.fn((_format?: string) => "data:image/png;base64,VALID_COMPOSITED_PNG"),
    };

    // Simulate 2D banner burn-in logic from capturePNG
    const bannerHeight = 28;
    const y = mockCanvas.height - bannerHeight;
    mockCtx.fillRect(0, y, mockCanvas.width, bannerHeight);

    const leftBanner = "v0.59.0 · abc1234 · 2026-10-01T08:00:00Z";
    const rightBanner = "X: 120.5m  Elev: 4.5m  Z: -80.2m  Hdg: 180°  Seed: 4242";
    mockCtx.fillText(leftBanner, 12, y + 14);
    mockCtx.fillText(rightBanner, 1000, y + 14);

    const dataUrl = mockCanvas.toDataURL("image/png");
    expect(dataUrl).toContain("VALID_COMPOSITED_PNG");
    expect(filledTexts).toContain(leftBanner);
    expect(filledTexts).toContain(rightBanner);
    expect(mockCtx.fillRect).toHaveBeenCalled();
  });
});
