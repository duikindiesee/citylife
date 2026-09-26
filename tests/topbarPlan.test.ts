import { describe, expect, it } from "vitest";
import { planTopbar } from "../src/colony/ui/topbarPlan";

describe("player HUD is not gated by an operator feature flag", () => {
  it("always exposes the menu, map shortcut and bug report", () => {
    expect(planTopbar()).toEqual({
      showMenu: true,
      showMap: true,
      showBugReport: true,
      showLegacyRally: false,
      showPauseAndSpeed: false,
    });
  });
});
