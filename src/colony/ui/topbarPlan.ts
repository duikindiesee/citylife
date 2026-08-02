// UI.STATE.1 slice 1 — WHICH topbar controls exist, as a pure decision (spec 170 §8).
//
// The operator's complaint is measured: ~24 persistent elements on screen at once, up to 14
// interactive controls in this one bar, collapsing to a hidden-scrollbar strip under 760px. Slice 1
// is the smallest visible cut — the topbar only — and this module is its decision heart, pure and
// node-testable, so "flag OFF is byte-identical to today" is an assertion rather than a hope.
//
// THE THREE SLICE-1 CHANGES, exactly as spec 170 §8 lists them:
//   1. The pause/speed group and the Space shortcut go. Measured (spec 170 §6): they gate only the
//      legacy citizen-sim accumulator — the clock, the sky and the buses all read canonical sol time,
//      so the pause button never stopped the clock it sits beside. The world's time is an auditable
//      real measurement (operator decision), and nothing in the player HUD may claim otherwise.
//      The runtime methods STAY as debug API (a dev screenshot fixture calls setSpeed(0)).
//   2. Ask Kooker / Change password / Log out / snapshot collapse into a ☰ menu.
//   3. Road Rally is hidden unless available — the disabled-button state becomes absence.
//
// Everything else in the bar (clock, Log Bug, Join Race, BuilderPanel) is untouched in BOTH branches:
// Join Race is already contextual, and the BuilderPanel buttons are located by role/title in four e2e
// specs, so slice 1 deliberately does not go near them.
export interface TopbarInputs {
  /** The fail-closed `hud-player-state-v1` decision (hudPlayerStateAvailable). */
  readonly hudPlayerStateEnabled: boolean;
  /** `ui.race.available` — whether the Road Rally can actually start here. */
  readonly raceAvailable: boolean;
}

export interface TopbarPlan {
  /** The ❚❚ / 1× 2× 5× group. Legacy: always. New HUD: never — the world never stops. */
  readonly showPauseSpeedGroup: boolean;
  /** The Road Rally button. Legacy: always (disabled when unavailable). New HUD: only when it works. */
  readonly showRoadRally: boolean;
  /** The inline Ask Kooker / Change password / Log out group. New HUD: lives in the ☰ menu instead. */
  readonly showInlineAccountGroup: boolean;
  /** The inline 📷 snapshot button (shares a group with Log Bug, which stays in both branches). */
  readonly showInlineSnapshot: boolean;
  /** The ☰ menu that absorbs the four collapsed controls. Legacy: absent. */
  readonly showMenu: boolean;
  /** Whether the Space key toggles the citizen-sim pause. Follows the pause group exactly. */
  readonly spacePausesSim: boolean;
}

export function planTopbar(inputs: TopbarInputs): TopbarPlan {
  if (!inputs.hudPlayerStateEnabled) {
    // The legacy bar, control for control. tests/topbarPlan.test.ts pins every field of this branch,
    // because "flag OFF is byte-identical to today" is spec 170's first acceptance criterion.
    return {
      showPauseSpeedGroup: true,
      showRoadRally: true,
      showInlineAccountGroup: true,
      showInlineSnapshot: true,
      showMenu: false,
      spacePausesSim: true,
    };
  }
  return {
    showPauseSpeedGroup: false,
    showRoadRally: inputs.raceAvailable,
    showInlineAccountGroup: false,
    showInlineSnapshot: false,
    showMenu: true,
    spacePausesSim: false,
  };
}
