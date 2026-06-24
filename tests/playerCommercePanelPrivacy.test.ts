import { describe, expect, it } from "vitest";
import { commercePanelCopy } from "../src/colony/ui/ColonyApp";
import type { ColonyUiState } from "../src/colony/runtime";
import { isPublicSafe } from "../src/colony/newcomers";

type CommerceState = ColonyUiState["commerce"];

const commerce: CommerceState = {
  plots: 3,
  free: 1,
  byKind: { kiosk: 1, store: 1, showroom: 1 },
  canClaim: false,
  cheapest: { kind: "kiosk", price: 240 },
  parcels: [
    {
      id: "shop_1",
      kind: "kiosk",
      price: 240,
      priceZar: 6000,
      built: false,
      owner: "Occupied",
    },
  ],
};

describe("player commerce HUD copy privacy", () => {
  it("does not expose aggregate resident affordance copy to player HUDs", () => {
    const copy = commercePanelCopy({
      commerce,
      currency: "₭",
      playerScoped: true,
    });

    expect(copy.claimTitle).toBe("Your wallet cannot open a shop yet");
    expect(copy.claimTitle).not.toMatch(/resident|wealthiest|afford|plot/i);
    expect(isPublicSafe(copy.claimTitle)).toBe(true);
  });

  it("keeps richer operator commerce copy for admin HUDs", () => {
    const copy = commercePanelCopy({
      commerce: { ...commerce, canClaim: true },
      currency: "₭",
      playerScoped: false,
    });

    expect(copy.claimTitle).toBe(
      "The wealthiest resident who can afford it takes the cheapest shop plot",
    );
  });
});
