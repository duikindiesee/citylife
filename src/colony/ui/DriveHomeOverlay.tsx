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
  useRef,
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
import { serverVehicleKeyOf } from "../car/carAcquisition";
import { getAuthClient } from "../authClient";
import { layoutRevisionsMatch } from "../home/starterProperty";

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

export function DriveHomeOverlay({
  onClose,
  runtime,
}: {
  onClose: () => void;
  runtime?: {
    focusSurveyCell(x: number, y: number): boolean;
    getOwnedDrivePose?(): { x: number; y: number; heading?: number } | null;
    getPhysicalCarPosition?(): { x: number; y: number } | null;
    getActiveLayoutRevisionId?(): string | null;
    worldLayoutDocument?(): any;
    getOperatorUserId?(): string | null;
    getAuthoritativeCar?(): { id: string } | null;
    subscribe?(listener: () => void): () => void;
  };
}) {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [residency, setResidency] = useState<HomeResidency | null>(null);
  const [cursor, setCursor] = useState<Cell | null>(null);
  const [outcome, setOutcome] = useState<ArrivalOutcome | undefined>();
  const [pending, setPending] = useState(false);
  const [garageOpen, setGarageOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [, setRuntimeTick] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const operationSeqRef = useRef(0);
  const currentRuntimeRef = useRef(runtime);
  const lastOperatorRef = useRef(runtime?.getOperatorUserId?.() ?? null);
  const lastRevRef = useRef(runtime?.getActiveLayoutRevisionId?.() ?? null);

  useEffect(() => {
    currentRuntimeRef.current = runtime;
    lastOperatorRef.current = runtime?.getOperatorUserId?.() ?? null;
    lastRevRef.current = runtime?.getActiveLayoutRevisionId?.() ?? null;
    operationSeqRef.current += 1;
    setPending(false);
    setOutcome(undefined);
  }, [runtime]);

  // Subscribe to runtime state changes so physical vehicle movement re-renders guidance, and same-object
  // operator/revision changes immediately invalidate pending arrival operations
  useEffect(() => {
    if (!runtime || typeof runtime.subscribe !== "function") return;
    const unsub = runtime.subscribe(() => {
      setRuntimeTick((t) => t + 1);
      const curOp = runtime.getOperatorUserId?.() ?? null;
      const curRev = runtime.getActiveLayoutRevisionId?.() ?? null;
      if (curOp !== lastOperatorRef.current || curRev !== lastRevRef.current) {
        lastOperatorRef.current = curOp;
        lastRevRef.current = curRev;
        operationSeqRef.current += 1;
        setPending(false);
      }
      setOutcome(undefined);
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [runtime]);

  // Load the authoritative residency (owned/RESIDENT/garage) truth. Fail-soft: a null read (signed out /
  // endpoint absent / malformed) surfaces the retry state and never a client-invented destination.
  useEffect(() => {
    let live = true;
    setPhase("loading");
    const startUserId =
      runtime?.getOperatorUserId?.() ?? getAuthClient().operator?.userId ?? null;
    void (async () => {
      const res = await fetchHomeResidency();
      if (!live || !mountedRef.current) return;
      const currentUserId =
        runtime?.getOperatorUserId?.() ?? getAuthClient().operator?.userId ?? null;
      if (startUserId && currentUserId !== startUserId) {
        setPhase("error");
        return;
      }
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
  }, [reloadToken, runtime]);

  const home = useMemo(
    () => homeTargetCell(residency?.truth ?? null),
    [residency],
  );

  const operatorUserId = runtime?.getOperatorUserId?.();
  const authUserId = getAuthClient().operator?.userId ?? null;
  const runtimeLayoutRevision = runtime?.getActiveLayoutRevisionId?.();
  const truthLayoutRevision = residency?.truth?.layoutRevision;
  const layoutMatches = runtime
    ? Boolean(
        runtimeLayoutRevision &&
          truthLayoutRevision &&
          layoutRevisionsMatch(runtimeLayoutRevision, truthLayoutRevision),
      )
    : true;
  const isOperatorAuthed = runtime
    ? Boolean(operatorUserId && authUserId && operatorUserId === authUserId)
    : Boolean(authUserId);
  const carEligible = Boolean(
    isOperatorAuthed &&
      layoutMatches &&
      (runtime ? runtime.getAuthoritativeCar?.() : true),
  );

  const physicalCarPose = carEligible
    ? (runtime?.getOwnedDrivePose?.() ??
      runtime?.getPhysicalCarPosition?.() ??
      null)
    : null;
  const physicalCarCell: Cell | null = physicalCarPose
    ? { x: Math.round(physicalCarPose.x), y: Math.round(physicalCarPose.y) }
    : null;
  const activeCarCell = physicalCarCell ?? cursor;

  const guidance = useMemo(
    () => computeRouteGuidance(activeCarCell, home),
    [activeCarCell, home],
  );

  const effectiveWithinBounds = useMemo(() => {
    if (!home || !carEligible) return false;
    if (runtime) {
      if (!physicalCarCell) return false;
      return isWithinArrivalBounds(physicalCarCell, home);
    }
    return cursor ? isWithinArrivalBounds(cursor, home) : false;
  }, [home, carEligible, runtime, physicalCarCell, cursor]);

  const resident = residency?.resident === true;
  const garageUnlocked = isHomeGarageUnlocked(residency);

  const move = useCallback((dir: "up" | "down" | "left" | "right") => {
    setCursor((cur) => (cur ? stepCell(cur, dir) : cur));
    // Any movement invalidates a stale "rejected/error" outcome so the button re-derives from position.
    setOutcome(undefined);
  }, []);

  // Smoothly center the 3D camera over the driving cursor as the vehicle moves through the city.
  useEffect(() => {
    if (cursor && runtime) {
      runtime.focusSurveyCell(cursor.x, cursor.y);
    }
  }, [cursor, runtime]);

  const arrive = useCallback(() => {
    if (pending || resident || !home) return;
    if (!carEligible) {
      setOutcome({ kind: "rejected" });
      return;
    }
    if (runtime) {
      if (!physicalCarCell || !isWithinArrivalBounds(physicalCarCell, home)) {
        setOutcome({ kind: "rejected" });
        return;
      }
    }
    if (!effectiveWithinBounds) return;

    const targetCell = physicalCarCell ?? cursor;
    if (!targetCell) return;

    const authClient = getAuthClient();
    const startAuthUserId = authClient.operator?.userId ?? null;
    const startRuntimeUserId = runtime?.getOperatorUserId?.() ?? null;
    if (runtime && (!startAuthUserId || !startRuntimeUserId || startAuthUserId !== startRuntimeUserId)) {
      setOutcome({ kind: "rejected" });
      return;
    }
    const startUserId = startAuthUserId ?? startRuntimeUserId;
    if (!startUserId) {
      setOutcome({ kind: "rejected" });
      return;
    }

    const startRuntimeRev = runtime?.getActiveLayoutRevisionId?.() ?? null;
    const startRevision =
      startRuntimeRev ??
      residency?.truth?.layoutRevision ??
      null;

    const opId = ++operationSeqRef.current;
    const expectedRuntime = runtime;
    const isCurrent = () =>
      mountedRef.current &&
      operationSeqRef.current === opId &&
      currentRuntimeRef.current === expectedRuntime;

    setPending(true);

    const carSpec = runtime?.getAuthoritativeCar?.() ?? null;
    const vehicleKey = carSpec
      ? serverVehicleKeyOf(carSpec.id)
      : (residency?.truth as any)?.vehicleId
        ? String((residency?.truth as any).vehicleId).trim()
        : null;
    const plotId = residency?.truth?.plotId ?? null;
    const frameId = residency?.truth?.frameId ?? null;

    void postHomeArrival(targetCell, residency?.truth ?? null, {
      plotId,
      frameId,
      vehicleKey,
    }).then(async (result) => {
      try {
        if (!isCurrent()) return;
        const midAuthUserId = authClient.operator?.userId ?? null;
        const midRuntimeUserId = expectedRuntime?.getOperatorUserId?.() ?? null;
        if (expectedRuntime && (!midAuthUserId || !midRuntimeUserId || midAuthUserId !== startUserId || midRuntimeUserId !== startUserId)) {
          if (isCurrent()) {
            setOutcome({ kind: "rejected" });
          }
          return;
        }
        if (!midAuthUserId || midAuthUserId !== startUserId) {
          if (isCurrent()) {
            setOutcome({ kind: "rejected" });
          }
          return;
        }

        const midRuntimeRev = expectedRuntime?.getActiveLayoutRevisionId?.() ?? null;
        if (expectedRuntime && startRuntimeRev !== null && midRuntimeRev !== startRuntimeRev) {
          if (result.kind !== "confirmed" && result.kind !== "pending") {
            return;
          }
          if (isCurrent()) setOutcome({ kind: "rejected" });
          return;
        }

        if (result.kind !== "confirmed" && result.kind !== "pending") {
          if (isCurrent()) {
            setOutcome(result);
          }
          return;
        }

        const fresh = await fetchHomeResidency();
        if (!isCurrent()) return;
        const endAuthUserId = authClient.operator?.userId ?? null;
        const endRuntimeUserId = expectedRuntime?.getOperatorUserId?.() ?? null;
        if (expectedRuntime && (!endAuthUserId || !endRuntimeUserId || endAuthUserId !== startUserId || endRuntimeUserId !== startUserId)) {
          if (isCurrent()) setOutcome({ kind: "rejected" });
          return;
        }
        if (!endAuthUserId || endAuthUserId !== startUserId) {
          if (isCurrent()) setOutcome({ kind: "rejected" });
          return;
        }

        const currentRuntimeRev = expectedRuntime?.getActiveLayoutRevisionId?.() ?? null;
        if (expectedRuntime && (!currentRuntimeRev || currentRuntimeRev !== startRevision)) {
          if (isCurrent()) setOutcome({ kind: "rejected" });
          return;
        }

        const freshTruthRev = fresh?.truth?.layoutRevision ?? null;
        if (!freshTruthRev || (startRevision && !layoutRevisionsMatch(freshTruthRev, startRevision))) {
          if (isCurrent()) setOutcome({ kind: "rejected" });
          return;
        }

        if (!fresh || fresh.resident !== true) {
          if (isCurrent()) setOutcome({ kind: "rejected" });
          return;
        }

        const freshPlotId = fresh.truth?.plotId ?? null;
        if (!freshPlotId || (plotId && freshPlotId !== plotId)) {
          if (isCurrent()) setOutcome({ kind: "rejected" });
          return;
        }
        const freshFrameId = fresh.truth?.frameId ?? null;
        if (!freshFrameId || (frameId && freshFrameId !== frameId)) {
          if (isCurrent()) setOutcome({ kind: "rejected" });
          return;
        }

        if (isCurrent()) {
          setResidency(fresh);
          setOutcome(result);
        }
      } catch {
        if (isCurrent()) {
          setOutcome({ kind: "rejected" });
        }
      } finally {
        if (isCurrent()) {
          setPending(false);
        }
      }
    });
  }, [
    pending,
    resident,
    home,
    carEligible,
    runtime,
    physicalCarCell,
    effectiveWithinBounds,
    cursor,
    residency,
  ]);

  const view = arrivalButtonView(resident, effectiveWithinBounds, pending, outcome);

  // Keyboard navigation: WASD or Arrow keys drive the car, Escape exits the guidance HUD.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        onClose();
        return;
      }
      switch (e.code) {
        case "KeyW":
        case "ArrowUp":
          e.preventDefault();
          move("up");
          break;
        case "KeyS":
        case "ArrowDown":
          e.preventDefault();
          move("down");
          break;
        case "KeyA":
        case "ArrowLeft":
          e.preventDefault();
          move("left");
          break;
        case "KeyD":
        case "ArrowRight":
          e.preventDefault();
          move("right");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, move]);

  return (
    <div
      className="drive-home-overlay"
      data-testid="drive-home-overlay"
      style={{
        position: "fixed",
        top: 64,
        right: 20,
        width: 380,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100vh - 96px)",
        zIndex: 82,
        background: "rgba(10, 15, 24, 0.92)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderRadius: 14,
        border: "1px solid rgba(40, 75, 115, 0.8)",
        boxShadow: "0 16px 40px rgba(0, 0, 0, 0.65)",
        overflowY: "auto",
        padding: "16px 14px",
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

      {phase === "ready" && home && activeCarCell && (
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
            data-cell={`${activeCarCell.x},${activeCarCell.y}`}
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
              Car {activeCarCell.x},{activeCarCell.y}
            </span>
            <span style={{ color: "#ffd25a" }}>
              Home {home.x},{home.y}
            </span>
          </div>

          {/* Steer guidance badge for desktop & keyboard players */}
          <div
            style={{
              fontSize: 11,
              color: "#a0d4f0",
              textAlign: "center",
              marginTop: 10,
              padding: "6px 10px",
              background: "rgba(30, 58, 90, 0.4)",
              borderRadius: 6,
              border: "1px solid rgba(58, 90, 106, 0.5)",
            }}
          >
            🎮 Steer with <b style={{ color: "#ffd25a" }}>WASD</b> or{" "}
            <b style={{ color: "#ffd25a" }}>Arrow keys</b>
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
