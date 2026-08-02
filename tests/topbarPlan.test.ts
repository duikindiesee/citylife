// UI.STATE.1 slice 1 — the topbar plan, both branches pinned (spec 170 §8).
//
// Spec 170's FIRST acceptance criterion is that flag OFF renders today's topbar byte-identically.
// The plan is the decision heart of that promise, so the legacy branch is asserted control by
// control — a later edit that trims "just one" legacy control fails here, by name, rather than
// surfacing as a mystery e2e break (e2e/passwordActivation.spec.ts clicks the inline "Change
// password" button by role and name).
import { describe, expect, it } from "vitest";
import { planTopbar } from "../src/colony/ui/topbarPlan";

describe("UI.STATE.1 — flag OFF is today's topbar, control for control", () => {
  it("keeps every legacy control regardless of race availability", () => {
    for (const raceAvailable of [true, false]) {
      const plan = planTopbar({ hudPlayerStateEnabled: false, raceAvailable });
      expect(plan.showPauseSpeedGroup, "pause/speed").toBe(true);
      expect(plan.showRoadRally, "road rally (disabled-state included)").toBe(
        true,
      );
      expect(plan.showInlineAccountGroup, "account group").toBe(true);
      expect(plan.showInlineSnapshot, "snapshot").toBe(true);
      expect(plan.showMenu, "no menu on legacy").toBe(false);
      expect(plan.spacePausesSim, "space shortcut").toBe(true);
    }
  });
});

describe("UI.STATE.1 — flag ON is the slice-1 cut", () => {
  it("removes the pause/speed group and the Space shortcut together", () => {
    const plan = planTopbar({
      hudPlayerStateEnabled: true,
      raceAvailable: true,
    });
    // The world's clock is not a control (spec 170 §6): the button and its shortcut go as one —
    // removing the button but leaving Space would keep an invisible pause, the worst of both.
    expect(plan.showPauseSpeedGroup).toBe(false);
    expect(plan.spacePausesSim).toBe(false);
  });

  it("collapses the four summoned controls into the menu", () => {
    const plan = planTopbar({
      hudPlayerStateEnabled: true,
      raceAvailable: true,
    });
    expect(plan.showInlineAccountGroup).toBe(false);
    expect(plan.showInlineSnapshot).toBe(false);
    expect(plan.showMenu).toBe(true);
  });

  it("Road Rally becomes contextual: present exactly when a race can start", () => {
    expect(
      planTopbar({ hudPlayerStateEnabled: true, raceAvailable: true })
        .showRoadRally,
    ).toBe(true);
    expect(
      planTopbar({ hudPlayerStateEnabled: true, raceAvailable: false })
        .showRoadRally,
    ).toBe(false);
  });

  it("the pause group and the Space gate can never disagree", () => {
    // Whatever future edits do to the plan, the button and the shortcut must move together.
    for (const hudPlayerStateEnabled of [true, false])
      for (const raceAvailable of [true, false]) {
        const plan = planTopbar({ hudPlayerStateEnabled, raceAvailable });
        expect(plan.spacePausesSim).toBe(plan.showPauseSpeedGroup);
      }
  });
});
