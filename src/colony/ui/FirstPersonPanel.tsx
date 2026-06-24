// First-person walk panel — shows when the operator steps into a citizen.
// Renders a live scene card built from the FirstPersonView snapshot and a compass
// rose of directional controls (WASD / arrow keys also work via ColonyApp).
// After each step the bot narrates what the citizen sees in 1–2 sentences.
import { useState } from "react";
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
  { label: "·", spoken: "now", emoji: "·", dx: 0, dy: 0 }, // centre — no-op / narrate
  { label: "E", spoken: "east", emoji: "→", dx: STEP, dy: 0 },
  { label: "SW", spoken: "south west", emoji: "↙", dx: -STEP, dy: STEP },
  { label: "S", spoken: "south", emoji: "↓", dx: 0, dy: STEP },
  { label: "SE", spoken: "south east", emoji: "↘", dx: STEP, dy: STEP },
];

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

  return (
    <div
      className="first-person-panel"
      style={{
        position: "fixed",
        bottom: 90,
        right: 12,
        width: 290,
        background: "rgba(8,14,24,0.92)",
        border: "1px solid #1e3a5a",
        borderRadius: 10,
        padding: "10px 12px",
        color: "#c8dff0",
        fontFamily: "monospace",
        fontSize: 13,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ color: "#a0d4f0", fontWeight: 700 }}>
          👁 {fp.citizenName}
        </span>
        <button
          data-fp-action="exit"
          style={{
            padding: "2px 8px",
            fontSize: 11,
            background: "rgba(255,255,255,0.07)",
            border: "1px solid #2a4a6a",
            borderRadius: 5,
            color: "#7ab0d0",
            cursor: "pointer",
          }}
          onClick={() => runtime.exitFirstPerson()}
        >
          exit
        </button>
      </div>

      {/* Player overlay */}
      {v && (
        <div
          style={{
            background: "rgba(255,255,255,0.04)",
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {v.interactionPrompt ? (
            <div>
              <div>
                <span style={{ color: "#6ea8d0" }}>Action</span>{" "}
                <b>{v.interactionPrompt.label}</b> ·{" "}
                {Math.round(v.interactionPrompt.distance)} away
              </div>
              <button
                className="first-person-panel__action-button"
                data-fp-action="use"
                aria-label={`Use current action: ${v.interactionPrompt.label}`}
                style={{
                  marginTop: 4,
                  padding: "6px 10px",
                  fontSize: 12,
                  minHeight: 32,
                  background: "rgba(160,212,240,0.12)",
                  border: "1px solid #2a4a6a",
                  borderRadius: 5,
                  color: "#a0d4f0",
                  cursor: "pointer",
                }}
                onClick={() => runtime.activateFirstPersonInteraction()}
              >
                Use E
              </button>
            </div>
          ) : (
            <div style={{ color: "#7ab0d0" }}>No nearby action</div>
          )}
          {fp.blockedReason && (
            <div style={{ color: "#e0a14d" }}>
              <span style={{ color: "#6ea8d0" }}>Blocked</span>{" "}
              {fp.blockedReason}
            </div>
          )}
          {fp.guidedTarget && (
            <div style={{ color: "#9fd4a6" }}>
              <span style={{ color: "#6ea8d0" }}>Guided walk</span>{" "}
              {fp.guidedTarget.label} ({Math.round(fp.guidedTarget.x)},{" "}
              {Math.round(fp.guidedTarget.y)}) ·{" "}
              {distanceLabel(fp.guidedTarget.remainingDistance)}
              {fp.guidedTarget.nextWaypoint && (
                <div>
                  <span style={{ color: "#6ea8d0" }}>Next leg</span> (
                  {Math.round(fp.guidedTarget.nextWaypoint.x)},{" "}
                  {Math.round(fp.guidedTarget.nextWaypoint.y)})
                </div>
              )}
            </div>
          )}
          {(v.mood.hungry || v.mood.brownout || v.mood.fever > 0.4) && (
            <div style={{ color: "#e8905a", marginTop: 2 }}>
              {v.mood.hungry ? "⚠ colony hungry " : ""}
              {v.mood.brownout ? "⚠ brownout " : ""}
              {v.mood.fever > 0.4 ? "⚠ illness spreading" : ""}
            </div>
          )}
          <div style={{ color: "#7ab0d0", marginTop: 2 }}>
            Sprint {Math.round(fp.sprintCharge)}%
            {fp.sprintCharge <= 0 ? (
              <div style={{ color: "#e0a14d" }}>
                Sprint depleted — walk to recover
              </div>
            ) : fp.sprintCharge <= LOW_SPRINT_CHARGE_PERCENT ? (
              <div style={{ color: "#e0a14d" }}>
                Sprint low — ease off to recover
              </div>
            ) : null}
            <div
              role="progressbar"
              aria-label={`Sprint charge ${Math.round(fp.sprintCharge)}%`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fp.sprintCharge)}
              style={{
                marginTop: 3,
                height: 5,
                width: "100%",
                overflow: "hidden",
                borderRadius: 999,
                background: "rgba(122,176,208,0.16)",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(0, Math.min(100, Math.round(fp.sprintCharge)))}%`,
                  borderRadius: 999,
                  background:
                    fp.sprintCharge <= 20
                      ? "#e0a14d"
                      : "linear-gradient(90deg, #6ea8d0, #a0d4f0)",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {v && (
        <button
          style={{
            alignSelf: "flex-start",
            padding: "2px 8px",
            fontSize: 11,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid #1e3a5a",
            borderRadius: 5,
            color: "#7ab0d0",
            cursor: "pointer",
          }}
          onClick={() => setShowDebug((open) => !open)}
        >
          {showDebug ? "Hide debug" : "Show debug"}
        </button>
      )}

      {/* Debug telemetry */}
      {v && showDebug && (
        <div
          style={{
            background: "rgba(255,255,255,0.035)",
            border: "1px solid rgba(110,168,208,0.18)",
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 11,
            lineHeight: 1.6,
          }}
        >
          <div>
            <span style={{ color: "#6ea8d0" }}>Ground</span>{" "}
            <b>{v.ground.biome}</b> · elev {v.ground.elevation.toFixed(2)}
            {v.ground.isWater ? " 🌊" : ""}
          </div>
          <div>
            <span style={{ color: "#6ea8d0" }}>Time</span> Day {v.clock.day} ·{" "}
            {String(v.clock.hour).padStart(2, "0")}:
            {String(v.clock.minute).padStart(2, "0")}{" "}
            {v.clock.isDay ? "☀" : "🌙"}
          </div>
          {v.nearestCivic.length > 0 && (
            <div>
              <span style={{ color: "#6ea8d0" }}>Near</span>{" "}
              {v.nearestCivic
                .slice(0, 2)
                .map((b) => `${b.kind} (${Math.round(b.distance)})`)
                .join(", ")}
            </div>
          )}
          {v.neighbours.length > 0 && (
            <div>
              <span style={{ color: "#6ea8d0" }}>Neighbours</span>{" "}
              {v.neighbours
                .slice(0, 2)
                .map((n) => n.displayName.split(" ")[0])
                .join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Bot narration */}
      <div
        style={{
          minHeight: 38,
          background: "rgba(160,212,240,0.06)",
          borderRadius: 6,
          padding: "6px 8px",
          fontSize: 12,
          fontStyle: "italic",
          color: "#a0d4f0",
          lineHeight: 1.5,
        }}
      >
        {fp.narrating ? (
          <span style={{ opacity: 0.6 }}>…</span>
        ) : fp.narration ? (
          fp.narration
        ) : (
          <span style={{ opacity: 0.4 }}>
            step somewhere to hear what {fp.citizenName?.split(" ")[0]} notices
          </span>
        )}
      </div>

      {/* Compass rose */}
      <div
        className="first-person-panel__touch-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 3,
          alignSelf: "center",
          width: 120,
        }}
      >
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
            style={{
              padding: 0,
              height: 36,
              fontSize: label === "·" ? 18 : 16,
              background:
                label === "·"
                  ? "rgba(160,212,240,0.12)"
                  : "rgba(255,255,255,0.05)",
              border: "1px solid #1e3a5a",
              borderRadius: 5,
              color: fp.narrating ? "#334" : "#a0d4f0",
              cursor: fp.narrating ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {emoji}
          </button>
        ))}
      </div>

      <div
        className="first-person-panel__hint"
        style={{ fontSize: 10, opacity: 0.4, textAlign: "center" }}
      >
        WASD strafe/walk · Shift sprint · arrows turn · Tap Use to interact · Tap arrows to roam
      </div>
    </div>
  );
}
