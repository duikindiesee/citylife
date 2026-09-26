/** Player HUD controls that remain visible while playing. The menu is unconditional: HUD layout
 * must not depend on an operator-managed feature flag or a player-specific allowlist. */
export interface TopbarPlan {
  readonly showMenu: true;
  readonly showMap: true;
  readonly showBugReport: true;
  readonly showLegacyRally: false;
  readonly showPauseAndSpeed: false;
}

export function planTopbar(): TopbarPlan {
  return {
    showMenu: true,
    showMap: true,
    showBugReport: true,
    showLegacyRally: false,
    showPauseAndSpeed: false,
  };
}
