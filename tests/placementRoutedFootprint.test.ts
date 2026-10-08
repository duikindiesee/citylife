// ROAD.PLACEMENT.DECOUPLE.1 — placement reserves the ROUTED road, not the DRAWN one.
//
// THE DEFECT. `conservativeRoadRibbonBlockedCells` was built from `ribbonCoverage()` — the smoothed
// mesh the renderer draws. Every placement decision in the game was therefore a function of a
// rendering detail, and the blast radius was neither theoretical nor small.
//
// MEASURED on the boot seed. Changing ONLY the ribbon's corner smoothing (PR 436's
// `MAX_CORNER_CUT_CELLS` clamp — a pure rendering fix) moved the bus depot:
//
//   main                       busDepotPad = (181, 299)  12x7
//   main + the smoothing clamp busDepotPad = (491, 237)  7x12     <- 310 cells away, and rotated
//
// because these cells feed `depotBlocked` (runtime.ts:1851) and then `findDepotSite`
// (runtime.ts:1857). A bus was then posed off-road beside the relocated depot, and the whole thing
// surfaced as a failing TRANSIT test three layers from the change that caused it. `runtime.ts`
// imports `roadRibbon` as `import type { RoadWay }`, so the seam is invisible at the import site.
//
// AFTER decoupling, the same experiment:
//
//   decoupled                        busDepotPad = (197, 288) 12x7
//   decoupled + the smoothing clamp  busDepotPad = (197, 288) 12x7   <- identical
//   busSolContinuousMotion with the smoothing clamp: 5/5 pass
//
// The tests below pin the properties that make that true: the footprint is a function of the routed
// path and the carriageway width ONLY, it never under-reserves, and it has no seams.
import { describe, expect, it } from "vitest";
import { routedRoadFootprintCells } from "../src/colony/placementValidation";
import type { RoadWay } from "../src/colony/render/roadRibbon";

/** Terrain stub: bounds only — the footprint rule depends on nothing else about the ground. */
const terrain = {
  inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < 200 && y < 200,
} as never;

function way(
  path: { x: number; y: number }[],
  width = 4,
  kind: RoadWay["kind"] = "street",
): RoadWay {
  return { path, kind, width };
}

describe("ROAD.PLACEMENT.DECOUPLE.1 — the reserved footprint", () => {
  it("covers the full carriageway width along a straight way", () => {
    const cells = routedRoadFootprintCells(
      [
        way(
          [
            { x: 50, y: 50 },
            { x: 60, y: 50 },
          ],
          4,
        ),
      ],
      terrain,
    );
    // width 4 => half 2. Every cell within 2 of the centre-line, along its length, must be reserved.
    for (let x = 50; x <= 60; x++)
      for (let dy = -2; dy <= 2; dy++)
        expect(cells.has(`${x},${50 + dy}`), `cell ${x},${50 + dy}`).toBe(true);
  });

  it("does not reserve the whole county", () => {
    const cells = routedRoadFootprintCells(
      [
        way(
          [
            { x: 50, y: 50 },
            { x: 60, y: 50 },
          ],
          4,
        ),
      ],
      terrain,
    );
    // Well clear of a half-width-2 road: must be free, or plots can never be sited near a street.
    expect(cells.has("55,45")).toBe(false);
    expect(cells.has("55,56")).toBe(false);
    expect(cells.has("40,50")).toBe(false);
  });

  it("leaves no seam on a diagonal run", () => {
    // Half-cell stepping exists for exactly this: a coarse step lets a diagonal slip gaps between
    // stamps, and a gap in the reservation is a cell a plot can be built on top of the road.
    const cells = routedRoadFootprintCells(
      [
        way(
          [
            { x: 20, y: 20 },
            { x: 60, y: 60 },
          ],
          4,
        ),
      ],
      terrain,
    );
    for (let i = 0; i <= 40; i++)
      expect(cells.has(`${20 + i},${20 + i}`), `diagonal cell ${20 + i}`).toBe(
        true,
      );
  });

  it("follows a string-pulled polyline with few points", () => {
    // `way.path` is string-pulled (runtime simplifyPath), so a hundred-cell road can be three points.
    // The footprint must follow the SEGMENTS, not just stamp the vertices.
    const cells = routedRoadFootprintCells(
      [
        way(
          [
            { x: 10, y: 100 },
            { x: 90, y: 100 },
            { x: 90, y: 180 },
          ],
          4,
        ),
      ],
      terrain,
    );
    expect(cells.has("50,100")).toBe(true); // mid first segment
    expect(cells.has("90,140")).toBe(true); // mid second segment
    expect(cells.has("90,100")).toBe(true); // the corner itself
  });

  it("widens with the carriageway", () => {
    const narrow = routedRoadFootprintCells(
      [
        way(
          [
            { x: 50, y: 50 },
            { x: 60, y: 50 },
          ],
          2,
        ),
      ],
      terrain,
    );
    const wide = routedRoadFootprintCells(
      [
        way(
          [
            { x: 50, y: 50 },
            { x: 60, y: 50 },
          ],
          8,
        ),
      ],
      terrain,
    );
    expect(wide.size).toBeGreaterThan(narrow.size);
    expect(narrow.has("55,54")).toBe(false);
    expect(wide.has("55,54")).toBe(true);
  });

  it("dilates by the clearance argument", () => {
    const bare = routedRoadFootprintCells(
      [
        way(
          [
            { x: 50, y: 50 },
            { x: 60, y: 50 },
          ],
          4,
        ),
      ],
      terrain,
    );
    const verged = routedRoadFootprintCells(
      [
        way(
          [
            { x: 50, y: 50 },
            { x: 60, y: 50 },
          ],
          4,
        ),
      ],
      terrain,
      2,
    );
    expect(verged.size).toBeGreaterThan(bare.size);
    for (const k of bare) expect(verged.has(k), `verge lost ${k}`).toBe(true);
  });

  it("stays inside the terrain bounds", () => {
    const cells = routedRoadFootprintCells(
      [
        way(
          [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
          ],
          6,
        ),
      ],
      terrain,
    );
    for (const k of cells) {
      const [x, y] = k.split(",").map(Number);
      expect(
        x! >= 0 && y! >= 0 && x! < 200 && y! < 200,
        `out of bounds ${k}`,
      ).toBe(true);
    }
  });

  it("is deterministic and additive across ways", () => {
    const a = way(
      [
        { x: 50, y: 50 },
        { x: 60, y: 50 },
      ],
      4,
    );
    const b = way(
      [
        { x: 50, y: 90 },
        { x: 60, y: 90 },
      ],
      4,
    );
    const both = routedRoadFootprintCells([a, b], terrain);
    const justA = routedRoadFootprintCells([a], terrain);
    const justB = routedRoadFootprintCells([b], terrain);
    expect(both.size).toBe(justA.size + justB.size);
    expect(routedRoadFootprintCells([a, b], terrain)).toEqual(both);
  });

  it("handles a degenerate single-point way without throwing", () => {
    const cells = routedRoadFootprintCells(
      [way([{ x: 30, y: 30 }], 4)],
      terrain,
    );
    expect(cells.has("30,30")).toBe(true);
  });

  it("depends on the routed path and width ONLY — the invariant the depot move violated", () => {
    // Two ways with identical routed geometry but different `kind` (which is what drives rendering
    // width/appearance downstream) must reserve exactly the same cells. If a rendering attribute ever
    // creeps back into this function, this fails.
    const asStreet = routedRoadFootprintCells(
      [
        way(
          [
            { x: 40, y: 40 },
            { x: 70, y: 55 },
          ],
          4,
          "street",
        ),
      ],
      terrain,
    );
    const asAvenue = routedRoadFootprintCells(
      [
        way(
          [
            { x: 40, y: 40 },
            { x: 70, y: 55 },
          ],
          4,
          "avenue",
        ),
      ],
      terrain,
    );
    expect(asAvenue).toEqual(asStreet);
  });
});
