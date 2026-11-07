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
  const partyRace = runtime.getPartyRaceState();

  if (status === "disconnected") {
    return null;
  }

  const myParticipantId = info?.participantId ?? null;
  const myEntrant = partyRace?.entrants.find(
    (e) => e.participantId === myParticipantId,
  );
  const isHost =
    Boolean(partyRace && myParticipantId && partyRace.hostParticipantId === myParticipantId);
  const allReady =
    Boolean(
      partyRace &&
        partyRace.entrants.length >= 2 &&
        partyRace.entrants.every((e) => e.ready),
    );
  const isDriving = info?.mode === "driving";

  return (
    <div
      data-testid="multiplayer-hud"
      data-status={status}
      data-connected={status === "connected" ? "true" : "false"}
      data-room={info?.inviteCode || ""}
      data-peers={racers.length}
      data-party-race-status={partyRace?.status || "none"}
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
        gap: 6,
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
          <span>Admission rejected or authoritative neighbourhood unavailable</span>
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
      {status === "connected" && (
        <div
          data-testid="party-race-panel"
          style={{
            pointerEvents: "auto",
            borderTop: "1px solid rgba(80, 200, 255, 0.25)",
            paddingTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: "11px",
          }}
        >
          {partyRace?.status === "finished" && (
            <div
              data-testid="party-race-result"
              data-winner-user-id={partyRace.winnerUserId || ""}
              style={{
                background: "rgba(0, 255, 136, 0.12)",
                border: "1px solid rgba(0, 255, 136, 0.45)",
                borderRadius: 6,
                padding: "6px 8px",
                color: "#d8ffe8",
              }}
            >
              <div style={{ fontWeight: "bold", color: partyRace.winnerUserId ? "#00ff88" : "#ffaa00" }}>
                🏆 Winner:{" "}
                {partyRace.winnerUserId
                  ? (partyRace.entrants.find((e) => e.userId === partyRace.winnerUserId)?.username ?? partyRace.winnerUserId)
                  : "No Winner (All DNF)"}
              </div>
              {partyRace.entrants.map((e) => {
                const isDnf =
                  (e as any).left ||
                  (e as any).status === "left" ||
                  (e.finishedAtMs !== null && e.place === null);
                return (
                  <div
                    key={e.participantId}
                    data-testid={`party-race-entrant-result-${e.username}`}
                    style={{ color: isDnf ? "#ffaaaa" : undefined }}
                  >
                    {isDnf
                      ? `DNF — ${e.username} (Forfeited)`
                      : `#${e.place ?? "-"} ${e.username} ${
                          e.elapsedMs !== null
                            ? `(${(e.elapsedMs / 1000).toFixed(2)}s)`
                            : ""
                        }`}
                  </div>
                );
              })}
            </div>
          )}

          {(!partyRace ||
            partyRace.status === "cancelled" ||
            partyRace.status === "finished") && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                data-testid="party-race-invite-btn"
                disabled={!isDriving}
                onClick={() => runtime.invitePartyRace()}
                style={{
                  background: isDriving ? "#1b6ca8" : "rgba(255,255,255,0.1)",
                  color: isDriving ? "#ffffff" : "#8899aa",
                  border: "1px solid rgba(80, 200, 255, 0.5)",
                  borderRadius: 4,
                  padding: "3px 8px",
                  cursor: isDriving ? "pointer" : "not-allowed",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                🏁 Invite Party Race
              </button>
            </div>
          )}

          {partyRace?.status === "lobby" && (
            <div
              data-testid="party-race-lobby"
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              <div style={{ color: "#ffd24d", fontWeight: "bold" }}>
                🏁 Party Race Lobby ({partyRace.entrants.length} joined)
              </div>
              {partyRace.entrants.map((e) => (
                <div
                  key={e.participantId}
                  data-testid={`party-race-entrant-${e.username}`}
                  data-ready={e.ready ? "true" : "false"}
                  style={{ color: e.ready ? "#00ff88" : "#ffca40" }}
                >
                  • {e.username}: {e.ready ? "Ready ✓" : "Waiting…"}
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                {!myEntrant && (
                  <button
                    type="button"
                    data-testid="party-race-join-btn"
                    disabled={!isDriving}
                    onClick={() => runtime.joinPartyRace(partyRace.raceId)}
                    style={{
                      background: isDriving ? "#1b6ca8" : "rgba(255,255,255,0.1)",
                      color: "#fff",
                      border: "1px solid rgba(80, 200, 255, 0.5)",
                      borderRadius: 4,
                      padding: "3px 8px",
                      cursor: isDriving ? "pointer" : "not-allowed",
                      fontSize: "11px",
                    }}
                  >
                    Join Party Race
                  </button>
                )}
                {myEntrant && (
                  <button
                    type="button"
                    data-testid="party-race-ready-btn"
                    disabled={!isDriving}
                    onClick={() =>
                      runtime.setPartyRaceReady(!myEntrant.ready, partyRace.raceId)
                    }
                    style={{
                      background: myEntrant.ready ? "#1f7a4c" : "#b87a00",
                      color: "#fff",
                      border: "1px solid rgba(255, 255, 255, 0.35)",
                      borderRadius: 4,
                      padding: "3px 8px",
                      cursor: isDriving ? "pointer" : "not-allowed",
                      fontSize: "11px",
                    }}
                  >
                    {myEntrant.ready ? "Ready ✓" : "Mark Ready"}
                  </button>
                )}
                {isHost && (
                  <button
                    type="button"
                    data-testid="party-race-start-btn"
                    disabled={!allReady}
                    onClick={() => runtime.startPartyRace(partyRace.raceId)}
                    style={{
                      background: allReady ? "#00a86b" : "rgba(255,255,255,0.1)",
                      color: allReady ? "#fff" : "#8899aa",
                      border: "1px solid rgba(0, 255, 136, 0.5)",
                      borderRadius: 4,
                      padding: "3px 8px",
                      cursor: allReady ? "pointer" : "not-allowed",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    Start Race
                  </button>
                )}
                {isHost ? (
                  <button
                    type="button"
                    data-testid="party-race-cancel-btn"
                    onClick={() => runtime.cancelPartyRace(partyRace.raceId)}
                    style={{
                      background: "rgba(255, 68, 68, 0.25)",
                      color: "#ffaaaa",
                      border: "1px solid rgba(255, 68, 68, 0.5)",
                      borderRadius: 4,
                      padding: "3px 8px",
                      cursor: "pointer",
                      fontSize: "11px",
                    }}
                  >
                    Cancel
                  </button>
                ) : (
                  myEntrant && (
                    <button
                      type="button"
                      data-testid="party-race-leave-btn"
                      onClick={() => runtime.leavePartyRace(partyRace.raceId)}
                      style={{
                        background: "rgba(255, 255, 255, 0.12)",
                        color: "#d0d8e0",
                        border: "1px solid rgba(255, 255, 255, 0.3)",
                        borderRadius: 4,
                        padding: "3px 8px",
                        cursor: "pointer",
                        fontSize: "11px",
                      }}
                    >
                      Leave
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {partyRace?.status === "countdown" && (
            <div
              data-testid="party-race-countdown"
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              <div style={{ color: "#ffd24d", fontWeight: "bold" }}>
                🚦 Countdown — Hold at starting line!
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                {isHost ? (
                  <button
                    type="button"
                    data-testid="party-race-cancel-btn"
                    onClick={() => runtime.cancelPartyRace(partyRace.raceId)}
                    style={{
                      background: "rgba(255, 68, 68, 0.25)",
                      color: "#ffaaaa",
                      border: "1px solid rgba(255, 68, 68, 0.5)",
                      borderRadius: 4,
                      padding: "3px 8px",
                      cursor: "pointer",
                      fontSize: "11px",
                    }}
                  >
                    Cancel Race
                  </button>
                ) : (
                  myEntrant && (
                    <button
                      type="button"
                      data-testid="party-race-leave-btn"
                      onClick={() => runtime.leavePartyRace(partyRace.raceId)}
                      style={{
                        background: "rgba(255, 255, 255, 0.12)",
                        color: "#d0d8e0",
                        border: "1px solid rgba(255, 255, 255, 0.3)",
                        borderRadius: 4,
                        padding: "3px 8px",
                        cursor: "pointer",
                        fontSize: "11px",
                      }}
                    >
                      Leave Race
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {(partyRace?.status === "active" || partyRace?.status === "racing") && (
            <div
              data-testid="party-race-active"
              style={{ display: "flex", flexDirection: "column", gap: 3 }}
            >
              <div style={{ color: "#00ff88", fontWeight: "bold" }}>
                🏎️ Party Race Live ({partyRace.checkpoints.length} checkpoints)
              </div>
              {partyRace.entrants.map((e) => {
                const isDnf =
                  (e as any).left ||
                  (e as any).status === "left" ||
                  (e.finishedAtMs !== null && e.place === null);
                return (
                  <div
                    key={e.participantId}
                    data-testid={`party-race-progress-${e.username}`}
                    data-checkpoint-index={e.checkpointIndex}
                    style={{ color: isDnf ? "#ff9999" : undefined }}
                  >
                    • {e.username}:{" "}
                    {isDnf
                      ? "Forfeited (Left)"
                      : e.place !== null
                      ? `Finished #${e.place}`
                      : `CP ${e.checkpointIndex}/${partyRace.checkpoints.length}`}
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {isHost ? (
                  <button
                    type="button"
                    data-testid="party-race-cancel-btn"
                    onClick={() => runtime.cancelPartyRace(partyRace.raceId)}
                    style={{
                      background: "rgba(255, 68, 68, 0.25)",
                      color: "#ffaaaa",
                      border: "1px solid rgba(255, 68, 68, 0.5)",
                      borderRadius: 4,
                      padding: "3px 8px",
                      cursor: "pointer",
                      fontSize: "11px",
                    }}
                  >
                    Cancel Race
                  </button>
                ) : (
                  myEntrant && (
                    <button
                      type="button"
                      data-testid="party-race-leave-btn"
                      onClick={() => runtime.leavePartyRace(partyRace.raceId)}
                      style={{
                        background: "rgba(255, 255, 255, 0.12)",
                        color: "#d0d8e0",
                        border: "1px solid rgba(255, 255, 255, 0.3)",
                        borderRadius: 4,
                        padding: "3px 8px",
                        cursor: "pointer",
                        fontSize: "11px",
                      }}
                    >
                      Leave Race
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
