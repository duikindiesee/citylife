import { describe, expect, it } from "vitest";
import { furnitureMarketplaceSellerLabel } from "../src/colony/ui/ColonyApp";
import { isPublicSafe } from "../src/colony/newcomers";

describe("player furniture marketplace HUD privacy", () => {
  it("masks other sellers in player-scoped marketplace rows", () => {
    const label = furnitureMarketplaceSellerLabel({
      sellerCitizenId: "citizen_other",
      viewerCitizenId: "citizen_me",
      sellerDisplayName: "Mira Ledger",
      playerScoped: true,
    });

    expect(label).toBe("another resident");
    expect(label).not.toContain("Mira");
    expect(label).not.toContain("Ledger");
    expect(isPublicSafe(label)).toBe(true);
  });

  it("keeps operator marketplace seller names unrestricted", () => {
    expect(
      furnitureMarketplaceSellerLabel({
        sellerCitizenId: "citizen_other",
        viewerCitizenId: "citizen_me",
        sellerDisplayName: "Mira Ledger",
        playerScoped: false,
      }),
    ).toBe("Mira Ledger");
  });

  it("labels the viewer's own listing as you", () => {
    expect(
      furnitureMarketplaceSellerLabel({
        sellerCitizenId: "citizen_me",
        viewerCitizenId: "citizen_me",
        sellerDisplayName: "Mira Ledger",
        playerScoped: true,
      }),
    ).toBe("you");
  });
});
