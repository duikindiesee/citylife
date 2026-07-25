// PLAYER.HOME.1D.S2 — the guided, mobile-ready drive out of the dealership to the player's owned home,
// the bounded arrival check-in, convergence on the server RESIDENT truth, and the home-garage portal. A
// full-screen overlay that:
//
//   • reads the AUTHORITATIVE home truth and guides the driver to the SAME deterministic cell the owned
//     house projects onto (server-derived destination, identical on every device — never client-authored),
//   • drives a mobile first-person/vehicle cursor via on-screen touch D-pad controls; the live guidance is
//     a pure function of where the cursor is, so straying just recomputes toward home (route recovery),
//   • once inside the owned plot cells, submits BOUNDED arrival evidence and is idempotent under a
//     double-tap (a stable Idempotency-Key + an in-flight guard mean one arrival → one RESIDENT
//     transition), then re-fetches the server truth to converge (replay / relogin / second device all land
//     on the same RESIDENT state without re-driving),
//   • opens the home-garage portal ONLY after the server confirms the unlock (RESIDENT + garageUnlocked);
//     everything fails closed on a signed-out / absent / malformed read, showing a retry, never a guess.
//
// The overlay is a thin view over the pure model in driveHome; all the "handle every state" logic lives
// there and is node-tested. It mounts only when the operator UAT gate is open (see ColonyApp) — while dark
// it never renders and the network path is inert.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  fetchHomeResidency,
  postHomeArrival,
  computeRouteGuidance,
  arrivalButtonView,
  arrivalStateColor,
  isHomeGarageUnlocked,
  homeTargetCell,
  dealershipStartCell,
  isWithinArrivalBounds,
  stepCell,
  type Cell,
  type HomeResidency,
  type ArrivalOutcome,
} from "../home/driveHome";

const panelStyle: CSSProperties = {
  background: "rgba(8,14,24,0.92)",
  border: "1px solid #1e3a5a",
  borderRadius: 10,
  color: "#c8dff0",
  fontFamily: "monospace",
};

const controlButtonStyle: CSSProperties = {
  padding: "8px 14px",
  fontSize: 15,
  borderRadius: 8,
  cursor: "pointer",
  border: "1px solid #3a5a6a",
  background: "rgba(8,14,24,0.9)",
  color: "#a0d4f0",
  fontWeight: 700,
};

const dpadButtonStyle: CSSProperties = {
  width: 56,
  height: 56,
  fontSize: 22,
  borderRadius: 10,
  border: "1px solid #3a5a6a",
  background: "rgba(8,14,24,0.9)",
  color: "#a0d4f0",
  fontWeight: 700,
  cursor: "pointer",
  touchAction: "manipulation",
};

type LoadPhase = "loading" | "ready" | "error";

export function DriveHomeOverlay({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [residency, setResidency] = useState<HomeResidency | null>(null);
  const [cursor, setCursor] = useState<Cell | null>(null);
  const [outcome, setOutcome] = useState<ArrivalOutcome | undefined>();
  const [pending, setPending] = useState(false);
  const [garageOpen, setGarageOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Load the authoritative residency (owned/RESIDENT/garage) truth. Fail-soft: a null read (signed out /
  // endpoint absent / malformed) surfaces the retry state and never a client-invented destination.
  useEffect(() => {
    let live = true;
    setPhase("loading");
    void (async () => {
      const res = await fetchHomeResidency();
      if (!live) return;
      setResidency(res);
      if (!res || !homeTargetCell(res.truth)) {
        setPhase("error");
        return;
      }
      // Seed the driving cursor at the deterministic dealership exit — unless the server already says the
      // player is RESIDENT, in which case a second device / relogin converges without re-driving.
      setCursor((cur) => {
        if (cur) return cur;
        if (res.resident) return homeTargetCell(res.truth);
        return dealershipStartCell(res.truth);
      });
      setPhase("ready");
    })();
    return () => {
      live = false;
    };
  }, [reloadToken]);

  const home = useMemo(
    () => homeTargetCell(residency?.truth ?? null),
    [residency],
  );
  const guidance = useMemo(
    () => computeRouteGuidance(cursor, home),
    [cursor, home],
  );
  const withinBounds = useMemo(
    () => (cursor && home ? isWithinArrivalBounds(cursor, home) : false),
    [cursor, home],
  );
  const resident = residency?.resident === true;
  const garageUnlocked = isHomeGarageUnlocked(residency);

  const move = useCallback((dir: "up" | "down" | "left" | "right") => {
    setCursor((cur) => (cur ? stepCell(cur, dir) : cur));
    // Any movement invalidates a stale "rejected/error" outcome so the button re-derives from position.
    setOutcome(undefined);
  }, []);

  const arrive = useCallback(() => {
    if (pending || resident || !cursor || !withinBounds) return;
    setPending(true);
    void postHomeArrival(cursor, residency?.truth ?? null).then((result) => {
      setOutcome(result);
      if (result.kind === "confirmed" || result.kind === "pending") {
        // Reconcile against a FRESH re-fetch of the server truth (never a local guess) — this is what the
        // garage unlock and the RESIDENT convergence bind to.
        void fetchHomeResidency().then((fresh) => {
          if (fresh) setResidency(fresh);
          setPending(false);
        });
      } else {
        setPending(false);
      }
    });
  }, [pending, resident, cursor, withinBounds, residency]);

  const view = arrivalButtonView(resident, withinBounds, pending, outcome);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="drive-home-overlay"
      data-testid="drive-home-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 82,
        background: "#0a0f16",
        overflowY: "auto",
        padding: "16px 14px 96px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          ...panelStyle,
          padding: "8px 12px",
          fontSize: 13,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ color: "#ffd25a", fontWeight: 700 }}>🚗 Drive home</span>
        <button
          data-build-action="drive-home-exit"
          data-testid="drive-home-exit"
          onClick={onClose}
          title="Leave the drive-home guidance"
          style={{ ...controlButtonStyle, padding: "6px 10px", fontSize: 13 }}
        >
          ✕ Exit
        </button>
      </div>

      {phase === "loading" && (
        <div
          data-testid="drive-home-loading"
          style={{
            ...panelStyle,
            marginTop: 10,
            padding: 16,
            fontSize: 13,
            color: "#7ab0d0",
          }}
        >
          ⏳ Finding your home…
        </div>
      )}

      {phase === "error" && (
        <div
          data-testid="drive-home-error"
          style={{ ...panelStyle, marginTop: 10, padding: 16, fontSize: 13 }}
        >
          <div style={{ color: "#e07a7a", marginBottom: 10 }}>
            Couldn't find your owned home. Buy a home first, then come back.
          </div>
          <button
            data-build-action="drive-home-retry"
            data-testid="drive-home-retry"
            onClick={() => setReloadToken((t) => t + 1)}
            style={controlButtonStyle}
          >
            ↻ Retry
          </button>
        </div>
      )}

      {phase === "ready" && home && cursor && (
        <>
          {/* Live, mobile-ready driving guidance — a pure function of the cursor + server destination. */}
          <div
            data-testid="drive-home-guidance"
            data-heading={guidance.heading ?? ""}
            data-distance={String(guidance.distance)}
            data-arrived={guidance.arrived ? "true" : "false"}
            style={{
              ...panelStyle,
              marginTop: 10,
              padding: 16,
              fontSize: 15,
              color: guidance.arrived ? "#9fd4a6" : "#c8dff0",
              fontWeight: 700,
            }}
          >
            {guidance.heading ? `${guidance.heading} · ` : ""}
            {guidance.instruction}
          </div>

          {/* Where the car is + where home is (both server-derived) — display only. */}
          <div
            data-testid="drive-home-cursor"
            data-cell={`${cursor.x},${cursor.y}`}
            data-home={`${home.x},${home.y}`}
            style={{
              ...panelStyle,
              marginTop: 10,
              padding: "8px 12px",
              fontSize: 12,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span style={{ color: "#7ab0d0" }}>
              Car {cursor.x},{cursor.y}
            </span>
            <span style={{ color: "#ffd25a" }}>
              Home {home.x},{home.y}
            </span>
          </div>

          {/* Mobile first-person / vehicle controls — a touch D-pad that drives the car cursor. */}
          <div
            data-testid="drive-home-controls"
            style={{
              marginTop: 10,
              display: "grid",
              gridTemplateColumns: "repeat(3, 56px)",
              gridTemplateRows: "repeat(3, 56px)",
              gap: 6,
              justifyContent: "center",
            }}
          >
            <span />
            <button
              data-build-action="drive-move"
              data-testid="drive-up"
              aria-label="Drive north"
              onClick={() => move("up")}
              style={{ ...dpadButtonStyle, gridColumn: 2, gridRow: 1 }}
            >
              ▲
            </button>
            <span />
            <button
              data-build-action="drive-move"
              data-testid="drive-left"
              aria-label="Drive west"
              onClick={() => move("left")}
              style={{ ...dpadButtonStyle, gridColumn: 1, gridRow: 2 }}
            >
              ◀
            </button>
            <span style={{ gridColumn: 2, gridRow: 2 }} />
            <button
              data-build-action="drive-move"
              data-testid="drive-right"
              aria-label="Drive east"
              onClick={() => move("right")}
              style={{ ...dpadButtonStyle, gridColumn: 3, gridRow: 2 }}
            >
              ▶
            </button>
            <span />
            <button
              data-build-action="drive-move"
              data-testid="drive-down"
              aria-label="Drive south"
              onClick={() => move("down")}
              style={{ ...dpadButtonStyle, gridColumn: 2, gridRow: 3 }}
            >
              ▼
            </button>
            <span />
          </div>

          {/* Bounded arrival check-in — enabled only once inside the owned plot cells. */}
          <button
            data-build-action="drive-home-arrive"
            data-testid="drive-home-arrive"
            data-arrival-state={view.state}
            disabled={view.disabled}
            onClick={arrive}
            title="Check in at your home — the server confirms you are inside your owned plot"
            style={{
              marginTop: 12,
              width: "100%",
              padding: "12px 16px",
              fontSize: 15,
              borderRadius: 8,
              border: `1px solid ${view.disabled ? "#3a4a5a" : "#b6892f"}`,
              background: view.disabled
                ? "rgba(255,255,255,0.05)"
                : "rgba(182,137,47,0.18)",
              color: arrivalStateColor(view.state),
              cursor: view.disabled ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {view.label}
          </button>

          {/* RESIDENT — the server-confirmed home-garage portal. Opens ONLY on the authoritative unlock. */}
          {resident && (
            <div
              data-testid="drive-home-resident"
              style={{
                ...panelStyle,
                marginTop: 12,
                padding: 16,
                fontSize: 13,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <span style={{ color: "#9fd4a6", fontWeight: 700, fontSize: 15 }}>
                ✓ You live here now
              </span>
              <button
                data-build-action="home-garage-portal"
                data-testid="home-garage-portal"
                data-garage-unlocked={garageUnlocked ? "true" : "false"}
                disabled={!garageUnlocked}
                onClick={() => {
                  if (isHomeGarageUnlocked(residency)) setGarageOpen(true);
                }}
                title="Open your home garage"
                style={{
                  ...controlButtonStyle,
                  border: `1px solid ${garageUnlocked ? "#b6892f" : "#3a4a5a"}`,
                  color: garageUnlocked ? "#ffd25a" : "#7a90a0",
                  cursor: garageUnlocked ? "pointer" : "not-allowed",
                }}
              >
                🏠🚗 {garageUnlocked ? "Open home garage" : "Garage locked"}
              </button>
              {garageOpen && garageUnlocked && (
                <div
                  data-testid="home-garage-open"
                  style={{
                    ...panelStyle,
                    padding: 12,
                    fontSize: 13,
                    color: "#c8dff0",
                  }}
                >
                  🏠🚗 Your home garage is open — park your car and head inside.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
