/**
 * UI.VERSION.1 — the small build stamp.
 *
 * LAYOUT CONTRACT: this component carries NO positioning of its own. UI.HUD.OVERLAP.1 (PR 421)
 * and UI.GEO.OVERLAP.1 (PR 432) both exist because separate elements each pinned themselves into
 * the same corner with `position: fixed/absolute` and buried one another. In the game view this
 * is therefore a member of `.hud-corner-rail-left`, and that rail owns where it goes. On the
 * login screen it is a normal in-flow element under the card. Adding a third self-pinning corner
 * element is exactly the defect those two PRs fixed, so it is not done here.
 */
import { buildStampTitle, formatBuildStamp } from "../buildStamp";

export function BuildStamp({
  variant = "hud",
}: {
  readonly variant?: "hud" | "fp" | "login";
}) {
  const text = formatBuildStamp();
  return (
    <div
      className={`build-stamp build-stamp--${variant}`}
      data-testid="build-stamp"
      title={buildStampTitle()}
    >
      {text}
    </div>
  );
}
