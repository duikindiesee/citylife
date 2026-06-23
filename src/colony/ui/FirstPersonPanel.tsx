// First-person walk panel — shows when the operator steps into a citizen.
// Renders a live scene card built from the FirstPersonView snapshot and a compass
// rose of directional controls (WASD / arrow keys also work via ColonyApp).
// After each step the bot narrates what the citizen sees in 1–2 sentences.
import type { ColonyRuntime } from "../runtime";
import type { ColonyUiState } from "../runtime";

const STEP = 6; // cells per directional tap

const DIR: { label: string; emoji: string; dx: number; dy: number }[] = [
  { label: "NW", emoji: "↖", dx: -STEP, dy: -STEP },
  { label: "N", emoji: "↑", dx: 0, dy: -STEP },
  { label: "NE", emoji: "↗", dx: STEP, dy: -STEP },
  { label: "W", emoji: "←", dx: -STEP, dy: 0 },
  { label: "·", emoji: "·", dx: 0, dy: 0 }, // centre — no-op / narrate
  { label: "E", emoji: "→", dx: STEP, dy: 0 },
  { label: "SW", emoji: "↙", dx: -STEP, dy: STEP },
  { label: "S", emoji: "↓", dx: 0, dy: STEP },
  { label: "SE", emoji: "↘", dx: STEP, dy: STEP },
];

export function FirstPersonPanel({
  runtime,
  fp,
}: {
  runtime: ColonyRuntime;
  fp: ColonyUiState["firstPerson"];
}) {
  if (!fp.active || !fp.citizenId) return null;
  const v = fp.view;

  return (
    <div
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

      {/* Scene card */}
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
          {v.interactionPrompt && (
            <div>
              <span style={{ color: "#6ea8d0" }}>Action</span>{" "}
              <b>{v.interactionPrompt.label}</b> ·{" "}
              {Math.round(v.interactionPrompt.distance)} away
            </div>
          )}
          {(v.mood.hungry || v.mood.brownout || v.mood.fever > 0.4) && (
            <div style={{ color: "#e8905a", marginTop: 2 }}>
              {v.mood.hungry ? "⚠ colony hungry " : ""}
              {v.mood.brownout ? "⚠ brownout " : ""}
              {v.mood.fever > 0.4 ? "⚠ illness spreading" : ""}
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
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 3,
          alignSelf: "center",
          width: 120,
        }}
      >
        {DIR.map(({ label, emoji, dx, dy }) => (
          <button
            key={label}
            title={label === "·" ? "Narrate now" : `Walk ${label}`}
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

      <div style={{ fontSize: 10, opacity: 0.4, textAlign: "center" }}>
        WASD · arrow keys · click arrows above
      </div>
    </div>
  );
}
