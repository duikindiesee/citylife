// Spec 096 — the Garage HUD. Tune the signed-in player's car: four derived stat bars and the part
// catalog; clicking a part mounts it on its socket (one per socket) or unmounts it, live via
// runtime.mountCarPart / unmountCarPart. Bound to uiState.garage (operator-gated; the panel is only
// rendered when that is non-null). Player-safe labels only; price shows as city coin, never the brand.
import type { ColonyRuntime, ColonyUiState } from "../runtime";

type Garage = NonNullable<ColonyUiState["garage"]>;

const STATS: { key: keyof Garage["stats"]; label: string }[] = [
  { key: "topSpeed", label: "Top speed" },
  { key: "acceleration", label: "Acceleration" },
  { key: "grip", label: "Grip" },
  { key: "braking", label: "Braking" },
];

export function GaragePanel({
  runtime,
  garage,
}: {
  runtime: ColonyRuntime;
  garage: Garage;
}) {
  return (
    <div
      className="garage-panel"
      style={{
        position: "fixed",
        left: 12,
        bottom: 90,
        width: 270,
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
      <span style={{ color: "#ffd25a", fontWeight: 700 }}>
        🔧 Garage · {garage.carName} · ₭{garage.walletK}
      </span>

      <button
        data-build-action="jump-to-car"
        title="Drop into first person beside your parked car"
        onClick={() => runtime.jumpToMyHouse()}
        style={{
          padding: "5px 8px",
          fontSize: 12,
          borderRadius: 6,
          cursor: "pointer",
          border: "1px solid #b6892f",
          background: "rgba(255,210,90,0.16)",
          color: "#ffd25a",
          fontWeight: 700,
        }}
      >
        🚗 Go to my car
      </button>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {STATS.map(({ key, label }) => {
          const pct = Math.round(garage.stats[key] * 100);
          return (
            <div key={key} style={{ fontSize: 11 }}>
              <span style={{ color: "#7ab0d0" }}>{label}</span>
              <div
                role="progressbar"
                aria-label={label}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{
                  height: 5,
                  borderRadius: 999,
                  background: "rgba(122,176,208,0.16)",
                  overflow: "hidden",
                  marginTop: 2,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    borderRadius: 999,
                    background: "linear-gradient(90deg,#6ea8d0,#a0d4f0)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="garage-panel__parts"
        style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
      >
        {garage.parts.map((p) => {
          // unowned -> Buy (spend city coin); owned -> mount/unmount toggle (the Street Rod loop)
          const action: "buy" | "mount" | "unmount" = !p.owned
            ? "buy"
            : p.mounted
              ? "unmount"
              : "mount";
          return (
            <button
              key={p.kind}
              data-build-action={`${action}-${p.kind}`}
              title={`${p.socket} · ${p.category}${p.cost ? ` · ${p.cost} city coin` : ""}`}
              onClick={() => {
                if (action === "buy") runtime.buyCarPart(p.kind);
                else if (action === "mount") runtime.mountCarPart(p.kind);
                else runtime.unmountCarPart(p.kind);
              }}
              style={{
                padding: "3px 7px",
                fontSize: 11,
                borderRadius: 5,
                cursor: "pointer",
                border: `1px solid ${p.mounted ? "#b6892f" : action === "buy" ? "#3a5a2a" : "#1e3a5a"}`,
                background: p.mounted
                  ? "rgba(255,210,90,0.16)"
                  : action === "buy"
                    ? "rgba(120,200,120,0.10)"
                    : "rgba(255,255,255,0.05)",
                color: p.mounted
                  ? "#ffd25a"
                  : action === "buy"
                    ? "#9fd4a6"
                    : "#a0d4f0",
              }}
            >
              {action === "buy"
                ? `🛒 ${p.label} · ${p.cost}`
                : `${p.mounted ? "✓ " : "+ "}${p.label}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
