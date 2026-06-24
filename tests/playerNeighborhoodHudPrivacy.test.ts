import { describe, expect, it } from "vitest";
import {
  homesteadActionVisibility,
  homesteadHudTitle,
  lotHudCopy,
  workstationMarkerTitle,
} from "../src/colony/ui/ColonyApp";
import { isPublicSafe } from "../src/colony/newcomers";

describe("player neighborhood HUD privacy", () => {
  it("masks raw owner names before player HUDs render home sites", () => {
    const copy = lotHudCopy({
      id: "lot_7",
      owner: "Mira Ledger",
      built: false,
      reserved: false,
      price: 240,
      priceZar: 1200,
      playerScoped: true,
    });

    expect(copy.label).toBe("Home site 7 · Occupied");
    expect(copy.title).toBe(
      "Home site price 240 ₭ (≈ R1,200) — larger and shore-side sites cost more",
    );
    expect(`${copy.label} ${copy.title}`).not.toMatch(
      /plot|Other Player|Mira Ledger|Mira/i,
    );
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
    expect(copy.title).toBe(
      "Plot price 240 ₭ (≈ R1,200) — bigger and shore-ward land costs more",
    );
  });

  it("hides operator-only homestead mechanics from player HUD help copy", () => {
    const title = homesteadHudTitle({ playerScoped: true });

    expect(title).toBe(
      "Homesteads show available home sites, finished homes, and player-safe build actions.",
    );
    expect(title).not.toMatch(/Hermes|agent|evict|Assign|demolish|intranet/i);
    expect(isPublicSafe(title)).toBe(true);
  });

  it("keeps full homestead mechanics in operator HUD help copy", () => {
    const title = homesteadHudTitle({ playerScoped: false });

    expect(title).toContain("Assign a citizen to a homestead");
    expect(title).toContain("Raze-and-evict");
    expect(title).toContain("Hermes agent");
  });

  it("hides other residents' homestead management buttons from player HUDs", () => {
    const actions = homesteadActionVisibility({
      playerScoped: true,
      ownerId: "citizen_other",
      operatorCitizenId: "citizen_viewer",
      occupied: true,
      built: true,
      reserved: false,
    });

    expect(actions).toEqual({
      showDesign: false,
      showCommission: false,
      showBuild: false,
      showDemolish: false,
      showEvict: false,
    });
    expect(Object.keys(actions).join(" ")).not.toMatch(
      /owner|wallet|ledger|plot/i,
    );
    expect(isPublicSafe(Object.keys(actions).join(" "))).toBe(true);
  });

  it("keeps operator homestead management buttons unrestricted", () => {
    const actions = homesteadActionVisibility({
      playerScoped: false,
      ownerId: "citizen_other",
      operatorCitizenId: null,
      occupied: true,
      built: true,
      reserved: false,
    });

    expect(actions).toEqual({
      showDesign: true,
      showCommission: false,
      showBuild: false,
      showDemolish: true,
      showEvict: true,
    });
  });

  it("hides workstation infrastructure details from player HUD help copy", () => {
    const title = workstationMarkerTitle({ playerScoped: true });

    expect(title).toBe(
      "This home has a resident workstation for public in-city activity.",
    );
    expect(title).not.toMatch(
      /bot|intranet|cluster|internal|Hermes|agent|URL/i,
    );
    expect(isPublicSafe(title)).toBe(true);
  });

  it("keeps workstation infrastructure details in operator HUD help copy", () => {
    const title = workstationMarkerTitle({ playerScoped: false });

    expect(title).toContain("bots-only intranet");
    expect(title).toContain("cluster-internal");
  });
});
