import React, { useEffect, useState } from "react";
import type { ColonyRuntime } from "../runtime";

interface Props {
  runtime: ColonyRuntime;
}

export function MultiplayerStatusHUD({ runtime }: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    return runtime.subscribe(() => {
      setTick((t) => t + 1);
    });
  }, [runtime]);

  const mp = runtime.getMultiplayerClient();
  const status = mp?.getStatus() ?? "disconnected";
  const info = mp?.getSessionInfo();
  const racers = Array.from(runtime.sim.state.remoteRacers?.values() ?? []);

  if (status === "disconnected") {
    return null;
  }

  return (
    <div
      data-testid="multiplayer-hud"
      data-status={status}
      data-connected={status === "connected" ? "true" : "false"}
      data-room={info?.inviteCode || ""}
      data-peers={racers.length}
      style={{
        position: "fixed",
        top: 56,
        right: 16,
        zIndex: 900,
        backgroundColor: "rgba(10, 18, 30, 0.88)",
        border: "1px solid rgba(80, 200, 255, 0.6)",
        borderRadius: 8,
        padding: "8px 14px",
        color: "#ffffff",
        fontFamily: "monospace",
        fontSize: "13px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor:
              status === "connected"
                ? "#00ff88"
                : status === "error"
                  ? "#ff4444"
                  : "#ffaa00",
            display: "inline-block",
            boxShadow:
              status === "connected"
                ? "0 0 8px #00ff88"
                : status === "error"
                  ? "0 0 8px #ff4444"
                  : "0 0 6px #ffaa00",
          }}
        />
        <strong
          style={{
            color:
              status === "connected"
                ? "#a5d8ff"
                : status === "error"
                  ? "#ff8888"
                  : "#a5d8ff",
          }}
        >
          Multiplayer{" "}
          {status === "connected"
            ? "Active"
            : status === "error"
              ? "Connection Failed"
              : "Connecting..."}
        </strong>
        {info?.inviteCode && (
          <span style={{ color: "#ffd24d" }}>Room: {info.inviteCode}</span>
        )}
      </div>
      {status === "error" && (
        <div style={{ fontSize: "11px", color: "#ffaaaa" }}>
          <span>
            Admission rejected or authoritative neighbourhood unavailable
          </span>
        </div>
      )}
      {status === "connected" && (
        <div style={{ fontSize: "11px", color: "#b0c4de" }}>
          <span>Racers online ({racers.length + 1}): </span>
          <span style={{ color: "#80d0ff" }}>You</span>
          {racers.map((r) => (
            <span
              key={r.participantId}
              data-testid={`multiplayer-peer-${r.username}`}
              data-participant-id={r.participantId}
              style={{ marginLeft: 6, color: "#ffd24d", fontWeight: "bold" }}
            >
              • {r.username}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
