import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ROADMAP_PHASE_ORDER,
  isKookerBeaconPrompt,
  roadmapGroups,
} from "../src/colony/roadmap";
import { RoadmapPanel } from "../src/colony/ui/RoadmapPanel";

describe("Spec 112 Roadmap HUD", () => {
  it("binds the HUD to src/colony/roadmap.ts in the canonical phase order", () => {
    const groups = roadmapGroups();
    expect(groups.map((g) => g.phase)).toEqual(ROADMAP_PHASE_ORDER);
    expect(groups.map((g) => g.label)).toEqual([
      "Shipped",
      "Merging",
      "Next",
      "Later",
      "Parallel",
    ]);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("recognises the KOOKER beacon prompt and ignores unrelated prompts", () => {
    expect(
      isKookerBeaconPrompt({
        label: "Talk to KOOKER the Builder",
        targetName: "KOOKER the Builder",
      }),
    ).toBe(true);
    expect(
      isKookerBeaconPrompt({ label: "Talk to Cole", targetName: "Cole" }),
    ).toBe(false);
  });

  it("renders a bot-drivable, mobile-safe roadmap dialog with selectors", () => {
    const html = renderToStaticMarkup(
      React.createElement(RoadmapPanel, { open: true, onClose: () => {} }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="CityLife roadmap"');
    expect(html).toContain('data-roadmap-panel="open"');
    expect(html).toContain('data-roadmap-action="close"');
    for (const phase of ROADMAP_PHASE_ORDER) {
      expect(html).toContain(`data-roadmap-phase="${phase}"`);
    }
    expect(html).toContain("Mobile Road Rally touch controls");
    expect(html).toContain("KOOKER beacon Roadmap HUD");
    expect(html).toContain("MoJoJo / Floyd / Jack review lanes");
  });

  it("does not render when closed", () => {
    const html = renderToStaticMarkup(
      React.createElement(RoadmapPanel, { open: false, onClose: () => {} }),
    );
    expect(html).toBe("");
  });
});
