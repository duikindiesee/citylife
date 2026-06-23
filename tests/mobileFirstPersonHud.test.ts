import { describe, expect, it } from "vitest";
import { hudClassName } from "../src/colony/ui/ColonyApp";

describe("mobile first-person HUD chrome", () => {
  it("marks the side HUD as a mobile drawer while roaming first-person", () => {
    expect(hudClassName(false)).toBe("hud");
    expect(hudClassName(true)).toBe("hud hud--first-person-mobile-drawer");
  });
});
