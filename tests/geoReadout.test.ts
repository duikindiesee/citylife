// BUG.GEO.1 — the readout has to be ON SCREEN, and has to stay honest once rendered. These assertions
// fail if the component invents a marker for a subject with no pose, or prints a coordinate the
// visibility policy withheld.
import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GeoReadout } from "../src/colony/ui/GeoReadout";
import type { PresenceReadout } from "../src/colony/spatial/presenceReadout";

const stamp = {
  worldSeed: 4242,
  sol: 812,
  solHour: 6,
  solMinute: 30,
  layoutRevision: null,
};

const exactLocal: PresenceReadout["entries"][number] = {
  subjectId: "me",
  displayName: "Mira Vale",
  subjectKind: "player",
  isLocal: true,
  resolution: "exact",
  frame: {
    frameId: "universe:citylife:world:seed-4242:region:surface",
    address: "spatial://citylife/world/seed-4242/region/surface",
    kind: "region",
  },
  ancestry: [],
  fix: {
    projectionFrameId: "universe:citylife:world:seed-4242:region:surface",
    world: { x: -134, y: 3.5, z: 162 },
    cell: { x: 270.5, y: 344.5 },
    withinExtent: true,
  },
  headingDegrees: 91,
};

const coarseOther: PresenceReadout["entries"][number] = {
  subjectId: "them",
  displayName: "Ada Kell",
  subjectKind: "bot",
  isLocal: false,
  resolution: "coarse",
  frame: {
    frameId:
      "universe:citylife:world:seed-4242:region:surface:building:kooker-hq",
    address:
      "spatial://citylife/world/seed-4242/region/surface/building/kooker-hq",
    kind: "building",
  },
  ancestry: [],
  fix: null,
  headingDegrees: null,
};

function render(readout: PresenceReadout): string {
  return renderToStaticMarkup(React.createElement(GeoReadout, { readout }));
}

describe("GeoReadout", () => {
  it("renders the local marker with grid, world and the reproducibility stamp", () => {
    const html = render({ stamp, entries: [exactLocal], hidden: [] });
    expect(html).toContain("YOU ARE HERE");
    expect(html).toContain("spatial://citylife/world/seed-4242/region/surface");
    expect(html).toContain("grid 270.5, 344.5");
    expect(html).toContain("world -134.0, 3.5, 162.0");
    expect(html).toContain("yaw 91°");
    expect(html).toContain("seed 4242 · sol 812 06:30");
  });

  it("prints no coordinate for a coarse entry", () => {
    const html = render({ stamp, entries: [coarseOther], hidden: [] });
    expect(html).toContain("Ada Kell");
    expect(html).toContain("kooker-hq");
    expect(html).toContain("location coarse");
    expect(html).not.toMatch(/(grid|world) -?\d/);
  });

  it("renders no marker at all when there is no authoritative pose", () => {
    const html = render({
      stamp,
      entries: [],
      hidden: [
        {
          subjectId: "me",
          displayName: "Mira Vale",
          subjectKind: "player",
          isLocal: true,
          reason: "NO_AUTHORITATIVE_POSE",
          detail: "no authoritative presence address for this subject",
        },
      ],
    });
    expect(html).toContain("Position unavailable");
    expect(html).not.toContain("YOU ARE HERE");
    expect(html).not.toContain("geo-readout-marker-me");
    // The invented-origin failure mode: no numeric coordinate may appear anywhere.
    expect(html).not.toMatch(/(grid|world) -?\d/);
  });

  it("shows other subjects as extra markers, not as a different UI", () => {
    const html = render({
      stamp,
      entries: [exactLocal, coarseOther],
      hidden: [],
    });
    expect(html).toContain('data-testid="geo-readout-marker-me"');
    expect(html).toContain('data-testid="geo-readout-marker-them"');
    expect(html).toContain('data-resolution="exact"');
    expect(html).toContain('data-resolution="coarse"');
  });

  it("renders nothing when there is no presence at all", () => {
    expect(render({ stamp, entries: [], hidden: [] })).toBe("");
  });

  it("flags an out-of-extent fix instead of silently trusting it", () => {
    const html = render({
      stamp,
      entries: [
        {
          ...exactLocal,
          fix: {
            ...exactLocal.fix!,
            cell: { x: 900, y: 12 },
            withinExtent: false,
          },
        },
      ],
      hidden: [],
    });
    expect(html).toContain("outside frame extent");
  });
});
