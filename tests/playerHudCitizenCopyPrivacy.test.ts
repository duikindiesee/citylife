import { describe, expect, it } from "vitest";
import { citizenHudCopy } from "../src/colony/ui/ColonyApp";
import { isPublicSafe } from "../src/colony/newcomers";

describe("player HUD citizen copy privacy", () => {
  it("keeps the visible citizen summary public-safe for player HUDs", () => {
    const copy = citizenHudCopy({
      awake: 1,
      count: 3,
      list: [
        { id: "citizen_johndoe", displayName: "johndoe", plotName: "My Cottage" },
        { id: "citizen_joe", displayName: "Joe the Crab", plotName: "Founder House" },
        { id: "citizen_kooker", displayName: "KOOKER the Builder", plotName: "Builder Yard" },
      ],
      playerScoped: true,
    });

    expect(copy.summary).toBe("1/3 living");
    expect(copy.title).toBe(
      "Named residents visible in the city. Other players' private household details stay hidden.",
    );
    expect(copy.summary).not.toContain("Joe");
    expect(copy.summary).not.toContain("KOOKER");
    expect(copy.title).not.toMatch(/DMZ|namespace|kooker-service-ai|Hermes pod|routing|plot/i);
    expect(isPublicSafe(copy.summary)).toBe(true);
    expect(isPublicSafe(copy.title)).toBe(true);
  });

  it("keeps richer operator citizen copy for admin HUDs", () => {
    const copy = citizenHudCopy({
      awake: 2,
      count: 2,
      list: [
        { id: "citizen_joe", displayName: "Joe the Crab", plotName: "Founder House" },
        { id: "citizen_kooker", displayName: "KOOKER the Builder", plotName: "Builder Yard" },
      ],
      playerScoped: false,
    });

    expect(copy.summary).toBe("2/2 living · Joe, KOOKER");
    expect(copy.title).toContain("Joe the Crab at Founder House");
    expect(copy.title).toContain("KOOKER the Builder at Builder Yard");
    expect(copy.title).not.toMatch(/DMZ|namespace|kooker-service-ai/i);
  });
});
