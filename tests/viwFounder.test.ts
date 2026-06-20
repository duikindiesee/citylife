import { describe, it, expect } from "vitest";
import {
  joeBlueprint,
  VIW_BLUEPRINT,
  founderBlueprint,
} from "../src/colony/runtime";
import {
  parseBlueprint,
  validateBlueprint,
} from "../src/colony/blueprintScript";
import {
  compileBlueprint,
  HOUSE_VOXEL_BUDGET,
} from "../src/colony/houseBuilder";

// Spec 083 P0 + 084 S6 — the founder houses of WORLD v2. Joe's GRAND shore cottage is authored
// once (front at y:0) and mirrored for a south street; Viw's crewhouse door is FIXED EAST so the
// spec-084 S2 side-walkway contract is exercised on every boot. The seeding wiring (lot_1/lot_2 by
// water distance, reservations, Kookerbook) is verified live on :5188.

describe("Spec 084 S6 — founder house blueprints", () => {
  it("joe blueprints validate for both street sides; viw validates with his fixed east door", () => {
    for (const dir of ["n", "s"] as const) {
      expect(validateBlueprint(joeBlueprint(dir)).ok, `joe ${dir}`).toBe(true);
    }
    expect(validateBlueprint(VIW_BLUEPRINT).ok).toBe(true);
    expect(parseBlueprint(VIW_BLUEPRINT).doorDir).toBe("e");
  });

  it("the mirror keeps joe sea deck on the door edge both ways", () => {
    const north = parseBlueprint(joeBlueprint("n"));
    const south = parseBlueprint(joeBlueprint("s"));
    const patioN = north.rooms.find((r) => r.kind === "patio")!;
    const patioS = south.rooms.find((r) => r.kind === "patio")!;
    expect(patioN.y).toBe(0); // door:n edge is y 0
    expect(patioS.y + patioS.d).toBe(south.d); // door:s edge is y d-1
  });

  it("viw workbench hall covers the east door wall and the trade pays for two storeys", () => {
    const p = parseBlueprint(VIW_BLUEPRINT);
    const hall = p.rooms.find((r) => r.kind === "living")!;
    expect(hall.x + hall.w).toBe(p.w); // the hall reaches the east edge
    expect(hall.d).toBeGreaterThanOrEqual(Math.ceil(p.d / 2)); // and spans the door row
    expect(p.wallH).toBe(2);
    expect(p.rooms.some((r) => r.kind === "garage")).toBe(true);
  });

  it("both founder houses compile under budget at their GRAND zone size with a real door carved", () => {
    for (const script of [joeBlueprint("s"), VIW_BLUEPRINT]) {
      const compiled = compileBlueprint(script, { w: 23, d: 16, seed: 7 });
      expect(compiled.blocks.some((b) => b.kind === "door")).toBe(true);
      expect(compiled.blocks.length).toBeLessThanOrEqual(HOUSE_VOXEL_BUDGET);
    }
  });

  it("founderBlueprint mirror is stable (n is the authored frame; s mirrors the bands)", () => {
    const rooms = [{ kind: "living", x: 0, y: 1, w: 3, d: 2, win: 1 as const }];
    const south = parseBlueprint(founderBlueprint(4, 5, 1, "s", rooms))
      .rooms[0]!;
    expect(south.y).toBe(5 - (1 + 2));
    const north = parseBlueprint(founderBlueprint(4, 5, 1, "n", rooms))
      .rooms[0]!;
    expect(north.y).toBe(1);
  });
});
