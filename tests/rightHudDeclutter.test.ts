import { describe, expect, it } from "vitest";
import { rightHudDeclutterModel } from "../src/colony/ui/ColonyApp";
import type { ColonyUiState } from "../src/colony/runtime";

const ui = (over: Partial<ColonyUiState> = {}): ColonyUiState =>
  ({
    name: "Landing One",
    biome: "Crystal shore",
    colonists: 16,
    colony: { capacity: 25 },
    citizens: { count: 8 },
    neighborhood: { lots: [{ id: "lot_a" }], built: 2, free: 3 },
    commerce: { plots: 6, free: 2 },
    bank: { currency: "₭", scope: "city", deposits: 4200 },
    border: { queue: [] },
    firstPerson: { operatorCitizenId: "citizen_joe" },
    ...over,
  }) as unknown as ColonyUiState;

describe("right-side HUD declutter", () => {
  it("keeps default right HUD to essentials and hides full panels behind one toggle", () => {
    const model = rightHudDeclutterModel(ui());

    expect(model.defaultCollapsed).toBe(true);
    expect(model.defaultVisibleLabels).toEqual([
      "Landing One",
      "Site: Crystal shore",
      "Pop: 16/25",
    ]);
    expect(model.expandLabel).toBe("Open HUD details");
    expect(model.expandedPanelLabels).toContain("City Bank");
    expect(model.expandedPanelLabels).toContain("Commercial district");
    expect(model.expandedPanelLabels).toContain("Homesteads");
    expect(model.expandedPanelLabels).toContain("Furniture studio");
    expect(model.defaultVisibleLabels.join(" ")).not.toContain("City Bank");
    expect(model.defaultVisibleLabels.join(" ")).not.toContain(
      "Commercial district",
    );
  });
});
