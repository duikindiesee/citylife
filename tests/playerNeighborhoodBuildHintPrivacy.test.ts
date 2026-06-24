import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { isPublicSafe } from "../src/colony/newcomers";

// Normal player HUDs should not leak city stockpile/material accounting through
// the homestead Build button tooltip, especially for unmatched logins like johndoe.
describe("player neighborhood build hint privacy", () => {
  it("hides stockpile material counts from unmatched player HUDs", () => {
    const rt = new ColonyRuntime(4242);
    rt.sim.state.materials = 0;
    rt.setOperatorName("johndoe");
    rt.setPlayerView(true);

    const hint = rt.getUiState().neighborhood.buildHint;

    expect(hint).toBe(
      "The build crew handles the home build privately for this resident.",
    );
    expect(hint).not.toMatch(/stockpile|materials|short|off-island|\d+\/\d+/i);
    expect(isPublicSafe(hint)).toBe(true);
  });

  it("keeps stockpile material detail for operator HUDs", () => {
    const rt = new ColonyRuntime(4242);
    rt.sim.state.materials = 0;

    expect(rt.getUiState().neighborhood.buildHint).toMatch(
      /stockpile is short \(0\/\d+\)/,
    );
  });
});
