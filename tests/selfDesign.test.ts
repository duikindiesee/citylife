import { describe, it, expect } from "vitest";
import { blueprintReport, selfDesign } from "../src/colony/builder/selfDesign";
import { validateBlueprint } from "../src/colony/blueprintScript";
import { defaultBlueprint } from "../src/colony/neighborhood";

// Spec 077 P6 — the bot self-design loop: inspect, mutate once, repeat, capped at three. The same
// closed feedback loop the spec promised a Hermes bot, runnable headlessly and fully deterministic.

const ZONE = { w: 9, d: 6 };
const PLAIN =
  "house{w:6 d:5 wallH:1 door:s} room{kind:living x:0 y:0 w:6 d:5 win:0}";

describe("selfDesign — the capped inspect/mutate bot loop (spec 077 P6)", () => {
  it("blueprintReport surfaces the numbers a bot reasons over", () => {
    const r = blueprintReport(PLAIN, ZONE, 7);
    expect(r.storeys).toBe(1);
    expect(r.rooms).toBe(1);
    expect(r.roomAreas["living"]).toBe(30);
    expect(r.hasOutdoor).toBe(false);
    expect(r.bedrooms).toBe(0);
    expect(r.blockCount).toBeGreaterThan(0);
    expect(r.estMaterials).toBeGreaterThan(0);
  });

  it("improves a plain box into a home: outdoor space + bedroom within the 3-iteration cap", () => {
    const out = selfDesign(PLAIN, ZONE, 7, "s");
    expect(out.iterations.length).toBeGreaterThanOrEqual(1);
    expect(out.iterations.length).toBeLessThanOrEqual(3);
    expect(out.report.hasOutdoor).toBe(true);
    expect(out.report.bedrooms).toBeGreaterThanOrEqual(1);
    expect(validateBlueprint(out.script).ok).toBe(true);
    expect(out.script).not.toBe(PLAIN);
  });

  it("every iteration applied exactly one named mutation with a fresh report", () => {
    const out = selfDesign(PLAIN, ZONE, 7, "s");
    const names = out.iterations.map((i) => i.mutation);
    expect(names[0]).toBe("add-outdoor");
    for (const it2 of out.iterations) {
      expect([
        "add-outdoor",
        "add-bedroom",
        "add-windows",
        "add-storey",
        "grow-living",
      ]).toContain(it2.mutation);
      expect(it2.report.blockCount).toBeGreaterThan(0);
    }
  });

  it("is deterministic — same start, zone, seed and door always yield the identical design", () => {
    const a = selfDesign(PLAIN, ZONE, 1234, "s");
    const b = selfDesign(PLAIN, ZONE, 1234, "s");
    expect(a.script).toBe(b.script);
    expect(a.iterations.map((i) => i.mutation)).toEqual(
      b.iterations.map((i) => i.mutation),
    );
  });

  it("a generated citizen design also self-improves and stays valid (Joe-style run)", () => {
    const start = defaultBlueprint(0x1234abcd, "s");
    const out = selfDesign(start, ZONE, 0x1234abcd, "s");
    expect(validateBlueprint(out.script).ok).toBe(true);
    expect(out.iterations.length).toBeLessThanOrEqual(3);
    // the loop must do SOMETHING for any start that is not already perfect, or stop cleanly
    if (out.script === start) expect(out.iterations.length).toBe(0);
  });
});
