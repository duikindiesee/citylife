import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { CAR_PARTS } from "../src/colony/car/carParts";

// Spec 096 — the Garage HUD shows each part's handling effect as short up/down badges, so fitting a part
// is an informed choice (the core promise: a part changes performance, not just looks). The effect badges
// are a pure derivation of the part's statDeltas, exposed on uiState.garage.parts.
describe("part effect badges (096)", () => {
  it("derives up/down handling badges per part, empty for a cosmetic", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);
    const parts = rt.getUiState().garage!.parts;
    const byKind = (k: string) => parts.find((p) => p.kind === k)!;

    // a blower lifts top speed + acceleration but costs grip (a real trade-off, shown both ways)
    const blower = byKind("blower");
    expect(blower.effects).toEqual([
      { label: "Spd", up: true },
      { label: "Acc", up: true },
      { label: "Grip", up: false },
    ]);

    // drag slicks: more grip + acceleration, a little less top speed
    expect(byKind("slicks").effects).toEqual([
      { label: "Spd", up: false },
      { label: "Acc", up: true },
      { label: "Grip", up: true },
    ]);

    // a pure cosmetic with no handling delta has no badges (the UI prints "cosmetic" instead)
    expect(CAR_PARTS.chrome_pipes.category).toBe("cosmetic");
    expect(byKind("chrome_pipes").effects).toEqual([]);
    expect(byKind("street_tyres").effects).toEqual([]);

    // every performance part shows at least one handling badge. (Badges follow the real statDeltas, not
    // the category label — so a "cosmetic" hood scoop that nudges top speed still shows its badge.)
    for (const p of parts) {
      if (p.category === "performance")
        expect(p.effects.length).toBeGreaterThan(0);
    }
    expect(byKind("hood_scoop").effects).toEqual([{ label: "Spd", up: true }]);
  });
});
