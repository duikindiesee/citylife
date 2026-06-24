import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

// Spec 097 R4 — presence tracking at the hilltop Rally Point. uiState.rally.present counts avatars
// standing on the rally cell; ready flips true at two present (the race rendezvous condition R5 uses).
describe("rally presence (R4)", () => {
  it("counts avatars present at the rally and flips ready at two", () => {
    const rt = new ColonyRuntime(4242);
    const rally = rt.sim.state.structures.find((s) => s.kind === "rally");
    expect(rally).toBeTruthy();
    expect(rt.getUiState().rally).toBeTruthy();
    expect(rt.getUiState().rally!.ready).toBe(false); // nobody there at boot

    const ids = rt
      .getUiState()
      .citizens.list.slice(0, 2)
      .map((c) => c.id);
    expect(ids.length).toBe(2);
    // place two citizens onto the rally cell (private roster reached via a cast, test-only)
    const roster = (
      rt as unknown as {
        citizens: {
          byId: (id: string) => { pos: { x: number; y: number } } | undefined;
        };
      }
    ).citizens;
    for (const id of ids) {
      const c = roster.byId(id);
      if (c) c.pos = { x: rally!.x, y: rally!.y };
    }

    let ui = rt.getUiState();
    expect(ui.rally!.present).toBeGreaterThanOrEqual(2);
    expect(ui.rally!.ready).toBe(true);
    expect(ui.rally!.x).toBe(rally!.x);
    expect(ui.rally!.y).toBe(rally!.y);

    // walk one away — presence drops, ready clears
    const c0 = roster.byId(ids[0]!);
    if (c0) c0.pos = { x: rally!.x + 40, y: rally!.y + 40 };
    ui = rt.getUiState();
    expect(ui.rally!.present).toBeLessThan(2);
    expect(ui.rally!.ready).toBe(false);
  });

  it("starts a race from the rally only when two are present (R5)", () => {
    const rt = new ColonyRuntime(4242);
    const rally = rt.sim.state.structures.find((s) => s.kind === "rally")!;
    const roster = (
      rt as unknown as {
        citizens: {
          byId: (id: string) => { pos: { x: number; y: number } } | undefined;
        };
      }
    ).citizens;
    const ids = rt
      .getUiState()
      .citizens.list.slice(0, 2)
      .map((c) => c.id);

    // one present -> join refused, no race starts
    const c0 = roster.byId(ids[0]!);
    if (c0) c0.pos = { x: rally.x, y: rally.y };
    expect(rt.getUiState().rally!.present).toBe(1);
    expect(rt.joinRallyRace()).toBe(false);
    expect(rt.getUiState().race.mode).toBe("idle");

    // two present -> join starts the race
    const c1 = roster.byId(ids[1]!);
    if (c1) c1.pos = { x: rally.x, y: rally.y };
    expect(rt.getUiState().rally!.ready).toBe(true);
    expect(rt.joinRallyRace()).toBe(true);
    expect(rt.getUiState().race.mode).not.toBe("idle");

    // a second join while racing is refused (no double-start)
    expect(rt.joinRallyRace()).toBe(false);
  });
});
