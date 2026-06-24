import { describe, expect, it } from "vitest";
import { canShowBorderControl } from "../src/colony/ui/ColonyApp";

// Player-scope privacy: Border Control contains household applications, bot replies,
// plot assignments, and reset controls. It is an operator surface, not a normal
// player HUD affordance.
describe("player Border Control HUD privacy", () => {
  it("hides the Border Control affordance from player-scoped HUDs", () => {
    expect(canShowBorderControl({ playerScoped: true })).toBe(false);
  });

  it("keeps Border Control available for operator HUDs", () => {
    expect(canShowBorderControl({ playerScoped: false })).toBe(true);
  });
});
