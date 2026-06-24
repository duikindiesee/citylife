import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

// Spec 096 E — "jump into your house, land next to your car". jumpToMyHouse steps the signed-in player
// into first person as their OWN citizen, standing beside their parked car. The beside-the-car spawn
// and facing are verified live on 5191; here we cover the deterministic, renderer-free behaviour: the
// operator gate and that the player enters first person as themselves.
describe("jump to my car (096 E)", () => {
  it("drops the signed-in player into first person as their own citizen", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);
    expect(rt.getUiState().firstPerson.active).toBe(false);

    expect(rt.jumpToMyHouse()).toBe(true);
    const fp = rt.getUiState().firstPerson;
    expect(fp.active).toBe(true);
    expect(fp.citizenId).not.toBeNull();
    // you land in your OWN avatar, not someone else's
    expect(fp.citizenId).toBe(fp.operatorCitizenId);
  });

  it("is a no-op without an operator citizen", () => {
    const rt = new ColonyRuntime(4242);
    expect(rt.jumpToMyHouse()).toBe(false);
    expect(rt.getUiState().firstPerson.active).toBe(false);
  });
});
