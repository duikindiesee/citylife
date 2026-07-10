import { describe, expect, it } from "vitest";
import { CATEGORY_ICONS } from "../src/colony/ui/BuilderPanel";

describe("BuilderPanel HUD icons", () => {
  it("points the v3 builder categories at Joe's generated HUD icon bundle", () => {
    expect(CATEGORY_ICONS.roads.src).toBe("/assets/citylife/builder-icons/64/roads.png");
    expect(CATEGORY_ICONS.zoning.src).toBe("/assets/citylife/builder-icons/64/zoning.png");
    expect(CATEGORY_ICONS.landscaping.src).toBe("/assets/citylife/builder-icons/64/landscaping.png");
    expect(CATEGORY_ICONS.bulldoze.src).toBe("/assets/citylife/builder-icons/64/bulldozer.png");
  });
});
