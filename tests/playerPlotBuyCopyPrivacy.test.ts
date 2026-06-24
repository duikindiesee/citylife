import { describe, expect, it } from "vitest";
import { buyPlotButtonTitle } from "../src/colony/ui/ColonyApp";
import { isPublicSafe } from "../src/colony/newcomers";

describe("player plot buy HUD copy privacy", () => {
  it("does not expose another citizen name or wallet amount to player HUDs", () => {
    const title = buyPlotButtonTitle({
      playerScoped: true,
      canBuy: false,
      buyerName: "KOOKER the Builder",
      wallet: 0,
      price: 230,
    });

    expect(title).toBe("Your wallet cannot buy this home site yet");
    expect(title).not.toMatch(/KOOKER|Builder|wallet \d|price \d|plot/i);
    expect(isPublicSafe(title)).toBe(true);
  });

  it("keeps richer operator plot buy copy for admin HUDs", () => {
    const title = buyPlotButtonTitle({
      playerScoped: false,
      canBuy: false,
      buyerName: "KOOKER the Builder",
      wallet: 0,
      price: 230,
    });

    expect(title).toBe(
      "KOOKER the Builder can't afford this plot (wallet 0 ₭, price 230 ₭)",
    );
  });
});
