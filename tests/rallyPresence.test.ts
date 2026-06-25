import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

const FRIEND_ID = "citizen_rally_friend";

// Spec 097 R4/R5 + phase-1 S1 — presence at the hilltop Rally Point. The night-meetup friend (S1) is
// seeded at the rally, so ONE avatar is present from boot; a single other avatar walking up flips ready
// (two present), which is the rendezvous condition the join-race uses.
describe("rally presence (R4 + S1 friend)", () => {
  function rosterOf(rt: ColonyRuntime) {
    return (
      rt as unknown as {
        citizens: {
          byId: (id: string) => { pos: { x: number; y: number } } | undefined;
        };
      }
    ).citizens;
  }

  it("seeds the friend present and flips ready when a second avatar arrives", () => {
    const rt = new ColonyRuntime(4242);
    const rally = rt.sim.state.structures.find((s) => s.kind === "rally");
    expect(rally).toBeTruthy();
    expect(rt.getUiState().rally).toBeTruthy();
    // S1 — the friend stands at the rally from sol zero: one present, not yet ready.
    expect(rt.getUiState().rally!.present).toBe(1);
    expect(rt.getUiState().rally!.ready).toBe(false);

    const roster = rosterOf(rt);
    const other = rt
      .getUiState()
      .citizens.list.find((c) => c.id !== FRIEND_ID)!;
    expect(other).toBeTruthy();
    const oc = roster.byId(other.id);
    if (oc) oc.pos = { x: rally!.x, y: rally!.y };

    let ui = rt.getUiState();
    expect(ui.rally!.present).toBeGreaterThanOrEqual(2);
    expect(ui.rally!.ready).toBe(true);
    expect(ui.rally!.x).toBe(rally!.x);
    expect(ui.rally!.y).toBe(rally!.y);

    // walk that avatar away — only the friend remains, ready clears
    if (oc) oc.pos = { x: rally!.x + 40, y: rally!.y + 40 };
    ui = rt.getUiState();
    expect(ui.rally!.present).toBe(1);
    expect(ui.rally!.ready).toBe(false);
  });

  it("starts a race from the rally when one player joins the friend (R5 + S1)", () => {
    const rt = new ColonyRuntime(4242);
    const rally = rt.sim.state.structures.find((s) => s.kind === "rally")!;
    const roster = rosterOf(rt);

    // the friend alone — one present — join refused, no race starts
    expect(rt.getUiState().rally!.present).toBe(1);
    expect(rt.joinRallyRace()).toBe(false);
    expect(rt.getUiState().race.mode).toBe("idle");

    // one player joins the friend — two present — join starts the race
    const other = rt
      .getUiState()
      .citizens.list.find((c) => c.id !== FRIEND_ID)!;
    const oc = roster.byId(other.id);
    if (oc) oc.pos = { x: rally.x, y: rally.y };
    expect(rt.getUiState().rally!.ready).toBe(true);
    expect(rt.joinRallyRace()).toBe(true);
    expect(rt.getUiState().race.mode).not.toBe("idle");

    // a second join while racing is refused (no double-start)
    expect(rt.joinRallyRace()).toBe(false);
  });
});
