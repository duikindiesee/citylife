import { describe, expect, it } from "vitest";
import { lotHudCopy } from "../src/colony/ui/ColonyApp";
import { isPublicSafe } from "../src/colony/newcomers";

describe("player neighborhood HUD privacy", () => {
  it("uses home-site copy instead of plot ownership terms for player HUDs", () => {
    const copy = lotHudCopy({
      id: "lot_7",
      owner: "Occupied",
      built: false,
      reserved: false,
      price: 240,
      priceZar: 1200,
      playerScoped: true,
    });

    expect(copy.label).toBe("Home site 7 · Occupied");
    expect(copy.title).toBe("Home site price 240 ₭ (≈ R1,200) — larger and shore-side sites cost more");
    expect(`${copy.label} ${copy.title}`).not.toMatch(/plot|Other Player|Mira Ledger/i);
    expect(isPublicSafe(copy.label)).toBe(true);
    expect(isPublicSafe(copy.title ?? "")).toBe(true);
  });

  it("keeps plot terminology for operator HUDs", () => {
    const copy = lotHudCopy({
      id: "lot_7",
      owner: "Mira Ledger",
      built: false,
      reserved: false,
      price: 240,
      priceZar: 1200,
      playerScoped: false,
    });

    expect(copy.label).toBe("Plot 7 · Mira");
    expect(copy.title).toBe("Plot price 240 ₭ (≈ R1,200) — bigger and shore-ward land costs more");
  });
});
