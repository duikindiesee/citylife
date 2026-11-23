import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

const FRIEND_ID = "citizen_rally_friend";

// Phase-1 S2 — the one-button "Head to the night meetup" (garage -> car -> first person -> drive to the
// rally), plus widening rally presence to carry WHO is present so the Player/UI lane can draw nameplates.
describe("night meetup flow (phase-1 S2)", () => {
  function rosterOf(rt: ColonyRuntime) {
    return (
      rt as unknown as {
        citizens: {
          byId: (id: string) =>
            | {
                pos: { x: number; y: number };
                target: { x: number; y: number };
              }
            | undefined;
        };
      }
    ).citizens;
  }

  it("headToNightMeetup is a no-op without an operator", () => {
    const rt = new ColonyRuntime(4242);
    expect(rt.headToNightMeetup()).toBe(false);
    expect(rt.getUiState().firstPerson.active).toBe(false);
  });

  it("headToNightMeetup drops the operator into first person and guides them to the rally", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list.find((c) => c.id !== FRIEND_ID)!;
    rt.setOperatorName(me.displayName);

    expect(rt.headToNightMeetup()).toBe(true);

    const ui = rt.getUiState();
    expect(ui.firstPerson.active).toBe(true);
    expect(ui.firstPerson.citizenId).toBe(me.id);

    // the operator is now headed for the rally point
    const rally = rt.sim.state.structures.find((s) => s.kind === "rally")!;
    const opc = rosterOf(rt).byId(me.id)!;
    expect(
      Math.hypot(opc.target.x - rally.x, opc.target.y - rally.y),
    ).toBeLessThanOrEqual(3);
  });

  it("headToNightMeetup produces a non-null guidedTarget.nextWaypoint from an occupied doorstep without operatorUserId and steps without building block", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list.find((c) => c.id !== FRIEND_ID)!;
    rt.setOperatorName(me.displayName);

    expect(rt.headToNightMeetup()).toBe(true);
    const initialUi = rt.getUiState().firstPerson;
    expect(initialUi.active).toBe(true);
    expect(initialUi.guidedTarget).toBeTruthy();
    expect(initialUi.guidedTarget?.nextWaypoint).toBeTruthy();

    const startPos = { ...rosterOf(rt).byId(me.id)!.pos };
    for (let i = 0; i < 120; i++) {
      rt.stepFirstPersonDogfood(1 / 60);
    }
    const afterUi = rt.getUiState().firstPerson;
    const afterPos = rosterOf(rt).byId(me.id)!.pos;
    expect(afterUi.blockedReason).not.toBe("building");
    expect(
      Math.hypot(afterPos.x - startPos.x, afterPos.y - startPos.y),
    ).toBeGreaterThan(0.5);
  });

  it("rally.presentCitizens carries the seeded friend by id and public-safe name", () => {
    const rt = new ColonyRuntime(4242);
    const rally = rt.getUiState().rally;
    expect(rally).toBeTruthy();
    const ids = rally!.presentCitizens.map((c) => c.id);
    expect(ids).toContain(FRIEND_ID);
    expect(
      rally!.presentCitizens.find((c) => c.id === FRIEND_ID)!.displayName,
    ).toBe("Cole the Racer");
    // present count stays in lockstep with the list
    expect(rally!.present).toBe(rally!.presentCitizens.length);
  });

  it("rally.presentCitizens lists both the friend and a second avatar at the rally", () => {
    const rt = new ColonyRuntime(4242);
    const rally = rt.sim.state.structures.find((s) => s.kind === "rally")!;
    const me = rt.getUiState().citizens.list.find((c) => c.id !== FRIEND_ID)!;
    const opc = rosterOf(rt).byId(me.id)!;
    opc.pos = { x: rally.x, y: rally.y };

    const ui = rt.getUiState();
    const ids = ui.rally!.presentCitizens.map((c) => c.id);
    expect(ids).toContain(FRIEND_ID);
    expect(ids).toContain(me.id);
    expect(ui.rally!.ready).toBe(true);
  });
});
