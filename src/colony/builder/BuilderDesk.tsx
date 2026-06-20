// Spec 083 P2 — THE BUILDER DESK: the negotiation, inside the builder. The moving-in citizen's
// DREAM (deterministic from its seed) meets Viw the Builder's quote; the player nudges the budget
// and the two haggle through the spec 083 engine. When they agree, one click loads the agreed brief
// as a real blueprint into the editor (the same script the game will raise). P2 runs the
// DETERMINISTIC dialogue script — P3 swaps inference-authored words onto the identical numbers.
// Every control carries data-build-action so a bot drives the desk exactly like the floor plan.
import { useMemo, useState } from "react";
import {
  dreamBrief,
  negotiate,
  priceBrief,
  briefToBlueprint,
  seededBudget,
  VIW_SEED,
  type Brief,
} from "./negotiation";

function briefLine(b: Brief): string {
  const out = b.outdoor === "none" ? "no yard feature" : `a ${b.outdoor}`;
  return `${b.bedrooms} bed · ${out} · ${b.storeys} storey${b.storeys > 1 ? "s" : ""} · door ${b.doorDir.toUpperCase()}`;
}

const panel: React.CSSProperties = {
  background: "#10141f",
  border: "1px solid #232c3f",
  borderRadius: 8,
  padding: 12,
};
const btn: React.CSSProperties = {
  padding: "3px 9px",
  fontSize: 12,
  background: "#1c2433",
  color: "#dfe7f2",
  border: "1px solid #34415a",
  borderRadius: 4,
  cursor: "pointer",
};

export function BuilderDesk({
  seed,
  zoneW,
  zoneD,
  onAccept,
}: {
  seed: number;
  zoneW: number;
  zoneD: number;
  onAccept: (script: string) => void;
}) {
  // The dream is fixed by the citizen's seed (stable while the player edits the floor plan); the
  // door usually faces the street, which on a homestead is the south edge.
  const dream = useMemo(
    () => dreamBrief(seed, { w: zoneW, d: zoneD }, "s"),
    [seed, zoneW, zoneD],
  );
  const fairPrice = priceBrief(dream);
  // The citizen's seeded purse is the desk's starting point (same allowance the in-engine
  // commission uses); the player slides it to drive the haggle.
  const [budget, setBudget] = useState(() => seededBudget(seed, dream));
  const session = useMemo(
    () => negotiate({ clientSeed: seed, builderSeed: VIW_SEED, dream, budget }),
    [seed, dream, budget],
  );

  return (
    <div
      data-build-area="builder-desk"
      style={{
        ...panel,
        width: 280,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        overflowY: "auto",
      }}
    >
      <b>🛠️ Zinzaar's Builder Desk</b>
      <div style={{ fontSize: 12, opacity: 0.85 }} data-build-area="dream">
        The newcomer dreams of <b>{briefLine(dream)}</b>. Fair build is{" "}
        <b>{fairPrice}</b> city coin.
      </div>
      <div
        style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}
      >
        <span style={{ opacity: 0.7 }}>Budget</span>
        <button
          data-build-action="budget-down"
          style={btn}
          onClick={() => setBudget((b) => Math.max(0, b - 25))}
        >
          −25
        </button>
        <b
          data-build-area="budget-value"
          style={{ minWidth: 56, textAlign: "center" }}
        >
          {budget}
        </b>
        <button
          data-build-action="budget-up"
          style={btn}
          onClick={() => setBudget((b) => b + 25)}
        >
          +25
        </button>
      </div>

      <div
        data-build-area="negotiation"
        style={{ display: "flex", flexDirection: "column", gap: 6 }}
      >
        {session.rounds.map((r, i) => {
          const viw = r.who === "viw";
          return (
            <div
              key={i}
              style={{
                alignSelf: viw ? "flex-start" : "flex-end",
                maxWidth: "92%",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  opacity: 0.55,
                  marginBottom: 1,
                  textAlign: viw ? "left" : "right",
                }}
              >
                {viw ? "🛠️ Zinzaar" : "🙂 newcomer"} · {r.price} coin
              </div>
              <div
                style={{
                  background: viw ? "#172033" : "#1f2b1d",
                  border: `1px solid ${viw ? "#2c3a5c" : "#33502f"}`,
                  borderRadius: 8,
                  padding: "5px 8px",
                  fontSize: 12,
                }}
              >
                {r.text}
              </div>
            </div>
          );
        })}
      </div>

      {session.state === "agreed" ? (
        <div
          data-build-area="deal"
          style={{
            borderTop: "1px solid #232c3f",
            paddingTop: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12 }}>
            🤝 <b>Agreed</b> — {briefLine(session.agreedBrief!)} for{" "}
            <b>{session.agreedPrice}</b> city coin.
          </div>
          <button
            data-build-action="accept-negotiated"
            style={{
              ...btn,
              padding: "6px 12px",
              fontWeight: 700,
              background: "#2c5a35",
              borderColor: "#3f8a4d",
            }}
            onClick={() =>
              onAccept(briefToBlueprint(session.agreedBrief!, seed))
            }
          >
            Load Zinzaar&apos;s design into the editor →
          </button>
        </div>
      ) : (
        <div
          data-build-area="deal"
          style={{
            borderTop: "1px solid #232c3f",
            paddingTop: 8,
            fontSize: 12,
            opacity: 0.85,
          }}
        >
          🚶 No deal this season — raise the budget and Zinzaar will quote
          again.
        </div>
      )}
    </div>
  );
}
