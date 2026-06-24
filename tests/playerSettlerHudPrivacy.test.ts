import { describe, expect, it } from "vitest";
import { settlerHudCopy } from "../src/colony/ui/ColonyApp";
import { isPublicSafe } from "../src/colony/newcomers";

describe("player settler HUD privacy", () => {
  it("hides recent settler names from player-scoped HUDs", () => {
    const copy = settlerHudCopy({
      count: 2,
      recent: [
        { id: 731, name: "Mira Ledger" },
        { id: 842, name: "Other Player" },
      ],
      playerScoped: true,
    });

    expect(copy.count).toBe("2");
    expect(copy.recent).toEqual(["#731 Resident", "#842 Resident"]);
    expect(copy.recent.join(" ")).not.toContain("Mira");
    expect(copy.recent.join(" ")).not.toContain("Other Player");
    expect(copy.recent.every(isPublicSafe)).toBe(true);
  });

  it("keeps recent settler names visible for admin HUDs", () => {
    const copy = settlerHudCopy({
      count: 1,
      recent: [{ id: 731, name: "Mira Ledger" }],
      playerScoped: false,
    });

    expect(copy.count).toBe("1");
    expect(copy.recent).toEqual(["#731 Mira Ledger"]);
  });
});
