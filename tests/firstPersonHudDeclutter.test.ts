import { describe, expect, it } from "vitest";
import { firstPersonHudLayout } from "../src/colony/ui/FirstPersonPanel";

describe("first-person HUD declutter contract", () => {
  it("keeps a clear centre and collapses secondary controls at constrained desktop size", () => {
    expect(firstPersonHudLayout(1280, 720)).toEqual(expect.objectContaining({
      clearCenter: true,
      controlsCollapsed: true,
      secondaryCardsCollapsed: true,
      toastLane: "top-center",
      canonicalExitCount: 1,
    }));
  });

  it("uses mobile safe-area edge controls with touch-sized targets", () => {
    const layout = firstPersonHudLayout(390, 844);
    expect(layout.mobile).toBe(true);
    expect(layout.minimumTouchTargetPx).toBeGreaterThanOrEqual(44);
    expect(layout.clearCenter).toBe(true);
  });
});
