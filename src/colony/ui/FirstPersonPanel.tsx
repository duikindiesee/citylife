// First-person walk HUD — shows when the operator steps into a citizen.
// The mobile-first layout keeps the world visible: a compact destination strip,
// edge movement joystick, and a small action cluster instead of a blocking report panel.
import { useState } from "react";
import { isPublicSafe } from "../newcomers";
import type { ColonyRuntime } from "../runtime";
import type { ColonyUiState } from "../runtime";

const STEP = 6; // cells per directional tap
const LOW_SPRINT_CHARGE_PERCENT = 20;

function distanceLabel(distance: number): string {
  return `${distance} ${distance === 1 ? "unit" : "units"} away`;
}

function fpActionName(label: string, spoken: string): string {
  if (label === "·") return "narrate";
  return `walk-${spoken.replaceAll(" ", "-")}`;
}

export function nightFriendBannerCopy(
  view: ColonyUiState["firstPerson"]["view"],
): string | null {
  if (!view || view.clock.isDay || view.neighbours.length === 0) return null;
  const names = view.neighbours
    .filter((n) => isPublicSafe(n.displayName))
    .slice(0, 2)
    .map((n) => n.displayName.split(" ")[0])
    .join(", ");
  return names ? `Friend nearby at the night rally: ${names}` : null;
}

const DIR: {
  label: string;
  spoken: string;
  emoji: string;
  dx: number;
  dy: number;
}[] = [
  { label: "NW", spoken: "north west", emoji: "↖", dx: -STEP, dy: -STEP },
  { label: "N", spoken: "north", emoji: "↑", dx: 0, dy: -STEP },
  { label: "NE", spoken: "north east", emoji: "↗", dx: STEP, dy: -STEP },
  { label: "W", spoken: "west", emoji: "←", dx: -STEP, dy: 0 },
  { label: "·", spoken: "now", emoji: "·", dx: 0, dy: 0 },
  { label: "E", spoken: "east", emoji: "→", dx: STEP, dy: 0 },
  { label: "SW", spoken: "south west", emoji: "↙", dx: -STEP, dy: STEP },
  { label: "S", spoken: "south", emoji: "↓", dx: 0, dy: STEP },
  { label: "SE", spoken: "south east", emoji: "↘", dx: STEP, dy: STEP },
];

function destinationLabel(fp: ColonyUiState["firstPerson"]): string {
  if (fp.guidedTarget) return fp.guidedTarget.label;
  const prompt = fp.view?.interactionPrompt;
  if (prompt) return prompt.label;
  return "Free roam";
}

function destinationDistance(fp: ColonyUiState["firstPerson"]): string | null {
  if (fp.guidedTarget) return distanceLabel(fp.guidedTarget.remainingDistance);
  const prompt = fp.view?.interactionPrompt;
  if (prompt) return `${Math.round(prompt.distance)} away`;
  return null;
}

function moodWarning(view: ColonyUiState["firstPerson"]["view"]): string | null {
  if (!view) return null;
  if (view.mood.hungry) return "colony hungry";
  if (view.mood.brownout) return "brownout";
  if (view.mood.fever > 0.4) return "illness spreading";
  return null;
}

function guidanceCaption(fp: ColonyUiState["firstPerson"]): string {
  if (fp.guidedTarget) {
    return `Guiding to ${fp.guidedTarget.label} · ${distanceLabel(fp.guidedTarget.remainingDistance)}`;
  }
  if (fp.narrating) return "Reading the street…";
  if (fp.narration) return fp.narration;
  return `Tap the joystick to roam with ${fp.citizenName?.split(" ")[0] ?? "your citizen"}.`;
}

export function FirstPersonPanel({
  runtime,
  fp,
}: {
  runtime: ColonyRuntime;
  fp: ColonyUiState["firstPerson"];
}) {
  const [showDebug, setShowDebug] = useState(false);
  if (!fp.active || !fp.citizenId) return null;
  const v = fp.view;
  const nightFriendBanner = nightFriendBannerCopy(v);
  const targetLabel = destinationLabel(fp);
  const targetDistance = destinationDistance(fp);
  const warning = moodWarning(v);

  return (
    <div className="first-person-panel first-person-panel--edge-hud">
      <div className="first-person-panel__destination-strip" role="status">
        <div className="first-person-panel__destination-main">
          <span className="first-person-panel__eyebrow">Joe view</span>
          <b>{fp.citizenName}</b>
        </div>
        <div className="first-person-panel__destination-target">
          <span>{targetLabel}</span>
          {targetDistance && <em>{targetDistance}</em>}
        </div>
        {nightFriendBanner && (
          <div className="first-person-panel__friend-banner">
            {nightFriendBanner}
          </div>
        )}
        {warning && <div className="first-person-panel__warning">⚠ {warning}</div>}
        {fp.blockedReason && (
          <div className="first-person-panel__blocked">Blocked: {fp.blockedReason}</div>
        )}
      </div>

      <div className="first-person-panel__joystick" aria-label="Mobile movement joystick">
        <div className="first-person-panel__touch-grid">
          {DIR.map(({ label, spoken, emoji, dx, dy }) => (
            <button
              className="first-person-panel__touch-button"
              data-fp-action={fpActionName(label, spoken)}
              key={label}
              title={label === "·" ? "Narrate now" : `Walk ${label}`}
              aria-label={label === "·" ? "Narrate now" : `Walk ${spoken}`}
              disabled={fp.narrating}
              onClick={() => {
                if (dx === 0 && dy === 0) void runtime.narrate();
                else runtime.walkStep(dx, dy);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="first-person-panel__sprint" aria-label={`Sprint charge ${Math.round(fp.sprintCharge)}%`}>
          <span>Sprint {Math.round(fp.sprintCharge)}%</span>
          <div
            role="progressbar"
            aria-label={`Sprint charge ${Math.round(fp.sprintCharge)}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fp.sprintCharge)}
          >
            <i style={{ width: `${Math.max(0, Math.min(100, Math.round(fp.sprintCharge)))}%` }} />
          </div>
          {fp.sprintCharge <= 0 ? (
            <em>Sprint depleted — walk to recover</em>
          ) : fp.sprintCharge <= LOW_SPRINT_CHARGE_PERCENT ? (
            <em>Sprint low — ease off to recover</em>
          ) : null}
        </div>
      </div>

      <div className="first-person-panel__action-cluster">
        {v?.interactionPrompt ? (
          <button
            className="first-person-panel__action-button"
            data-fp-action="use"
            aria-label={`Use current action: ${v.interactionPrompt.label}`}
            onClick={() => runtime.activateFirstPersonInteraction()}
          >
            Use E
            <span>{v.interactionPrompt.label}</span>
          </button>
        ) : (
          <div className="first-person-panel__no-action">No nearby action</div>
        )}
        {v && (
          <button
            className="first-person-panel__rally-button"
            data-fp-action="walk-to-rally"
            title="Guided walk to the hilltop rally point"
            aria-label="Walk to the rally point"
            onClick={() => runtime.goToRallyPoint()}
          >
            🏁 Walk to Rally
          </button>
        )}
        {v && (
          <button
            className="first-person-panel__debug-toggle"
            data-fp-action="toggle-debug"
            aria-label="Toggle first-person debug details"
            title="Toggle first-person debug details"
            onClick={() => setShowDebug((open) => !open)}
          >
            Debug
          </button>
        )}
        <button
          className="first-person-panel__exit-button"
          data-fp-action="exit"
          aria-label="Exit first-person view"
          onClick={() => runtime.exitFirstPerson()}
        >
          exit
        </button>
      </div>

      <div className="first-person-panel__guidance-caption">
        {guidanceCaption(fp)}
      </div>

      {v && showDebug && (
        <div className="first-person-panel__debug-panel">
          <div>
            <span>Ground</span> <b>{v.ground.biome}</b> · elev {v.ground.elevation.toFixed(2)}
            {v.ground.isWater ? " 🌊" : ""}
          </div>
          <div>
            <span>Time</span> Day {v.clock.day} · {String(v.clock.hour).padStart(2, "0")}:
            {String(v.clock.minute).padStart(2, "0")} {v.clock.isDay ? "☀" : "🌙"}
          </div>
          {fp.guidedTarget?.nextWaypoint && (
            <div>
              <span>Next leg</span> ({Math.round(fp.guidedTarget.nextWaypoint.x)}, {Math.round(fp.guidedTarget.nextWaypoint.y)})
            </div>
          )}
          {v.nearestCivic.length > 0 && (
            <div>
              <span>Near</span>{" "}
              {v.nearestCivic
                .slice(0, 2)
                .map((b) => `${b.kind} (${Math.round(b.distance)})`)
                .join(", ")}
            </div>
          )}
          {v.neighbours.length > 0 && (
            <div>
              <span>Neighbours</span>{" "}
              {v.neighbours
                .slice(0, 2)
                .map((n) => n.displayName.split(" ")[0])
                .join(", ")}
            </div>
          )}
        </div>
      )}

      <div className="first-person-panel__hint">
        WASD strafe/walk · Shift sprint · arrows turn · Tap Use to interact · Tap arrows to roam
      </div>
    </div>
  );
}
