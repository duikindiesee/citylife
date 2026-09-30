import { useCallback, useEffect, useRef, useState } from "react";
import type { ColonyRuntime } from "../runtime";
import type { OwnedDriveInput } from "../car/ownedDriving";

const keys: Record<string, keyof OwnedDriveInput> = {
  KeyW: "throttle",
  ArrowUp: "throttle",
  KeyS: "reverse",
  ArrowDown: "reverse",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "brake",
};

export function OwnedCarControls({
  runtime,
  suspended,
  onOpenRoadMap,
  onOpenChooseHome,
}: {
  runtime: ColonyRuntime;
  suspended: boolean;
  onOpenRoadMap?: () => void;
  onOpenChooseHome?: () => void;
}) {
  const pose = runtime.getOwnedDrivePose();
  const active = !!pose && !suspended;
  const generation = runtime.getOwnedDriveInputGeneration();
  const inputGeneration = useRef(generation);
  const input = useRef<OwnedDriveInput>({});
  const [pressedActions, setPressedActions] = useState<
    Partial<Record<keyof OwnedDriveInput, boolean>>
  >({});
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    let animId: number;
    let lastTime = 0;
    const loop = (t: number) => {
      if (t - lastTime > 60) {
        lastTime = t;
        setTick((n) => n + 1);
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [active]);

  const change = useCallback(
    (action: keyof OwnedDriveInput, down: boolean) => {
      const currentGeneration = runtime.getOwnedDriveInputGeneration();
      if (inputGeneration.current !== currentGeneration) {
        input.current = {};
        inputGeneration.current = currentGeneration;
      }
      input.current = { ...input.current, [action]: down };
      setPressedActions((prev) => ({ ...prev, [action]: down }));
      runtime.setOwnedDriveInput(input.current);
    },
    [runtime],
  );

  useEffect(() => {
    const clear = () => {
      input.current = {};
      inputGeneration.current = runtime.getOwnedDriveInputGeneration();
      setPressedActions({});
      runtime.setOwnedDriveInput({ brake: true });
    };
    if (!active) {
      clear();
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const action = keys[event.code];
      if (!action) return;
      if (event.type === "keydown" && event.repeat) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.type === "keydown" &&
        target?.closest("input, textarea, select, [contenteditable=true]")
      )
        return;
      event.preventDefault();
      change(action, event.type === "keydown");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      clear();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [runtime, active, generation, change]);

  if (!active)
    return !suspended && runtime.canEnterOwnedCar() ? (
      <button
        data-testid="enter-owned-car"
        onClick={() => runtime.enterOwnedCar()}
        style={{
          minHeight: 44,
          padding: "8px 16px",
          background: "linear-gradient(135deg, #1f4266, #0e243a)",
          border: "1px solid rgba(90, 230, 255, 0.4)",
          color: "#e0f0ff",
          borderRadius: 8,
          cursor: "pointer",
          fontWeight: 700,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        }}
      >
        🏎️ Enter your car
      </button>
    ) : null;

  const onRoad = pose ? runtime.isRoadSurface(pose.x, pose.y) : true;
  const speedKmH = Math.round(Math.abs(pose!.speed) * 3.6);

  const hasHome = runtime.hasOperatorHome();
  const homeTarget = runtime.getOperatorHomeTarget();
  const isNavigating = runtime.isGpsNavigating();

  let distanceMeters = 0;
  let navArrow = "⬆️";
  let navInstruction = "Head straight";
  let isNearHome = false;

  if (pose && homeTarget) {
    const dx = homeTarget.x - pose.x;
    const dy = homeTarget.y - pose.y;
    const distCells = Math.hypot(dx, dy);
    distanceMeters = Math.round(distCells * 4);
    isNearHome = distCells <= 3.5;

    const targetAngle = Math.atan2(dx, -dy);
    let diff = targetAngle - pose.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    if (Math.abs(diff) < Math.PI / 6) {
      navArrow = "⬆️";
      navInstruction = `${distanceMeters}m straight ahead`;
    } else if (diff >= Math.PI / 6 && diff < (2 * Math.PI) / 3) {
      navArrow = diff < Math.PI / 3 ? "↗️" : "➡️";
      navInstruction = `Turn right in ${distanceMeters}m`;
    } else if (diff <= -Math.PI / 6 && diff > (-2 * Math.PI) / 3) {
      navArrow = diff > -Math.PI / 3 ? "↖️" : "⬅️";
      navInstruction = `Turn left in ${distanceMeters}m`;
    } else {
      navArrow = "⬇️";
      navInstruction = `Make a U-turn (${distanceMeters}m)`;
    }
  }

  return (
    <section
      aria-label="Owned car controls"
      data-testid="owned-car-controls"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        top: 0,
        pointerEvents: "none",
        zIndex: 55,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "16px clamp(8px, 2vw, 20px)",
        boxSizing: "border-box",
      }}
    >
      {/* Top / Center HUD: Status Badge & Mission / GPS Bar */}
      <div
        style={{
          alignSelf: "center",
          marginTop: "16px",
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            background: "rgba(8, 21, 34, 0.88)",
            backdropFilter: "blur(14px)",
            border: `1.5px solid ${onRoad ? "rgba(90, 230, 255, 0.45)" : "rgba(245, 167, 66, 0.55)"}`,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            color: "white",
            padding: "8px 20px",
            borderRadius: 24,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: "0.08em",
              color: onRoad ? "#5ae6ff" : "#f5a742",
              textShadow: onRoad
                ? "0 0 12px rgba(90, 230, 255, 0.5)"
                : "0 0 12px rgba(245, 167, 66, 0.5)",
            }}
          >
            {onRoad ? "🏎️ HIGHWAY" : "🏜️ OFF-ROAD"}
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 900,
              fontFamily: "monospace",
              color: "#ffffff",
              minWidth: 70,
              textAlign: "right",
            }}
          >
            {speedKmH}{" "}
            <span style={{ fontSize: 12, fontWeight: 600 }}>km/h</span>
          </span>
          <button
            data-testid="exit-owned-car"
            onClick={() => runtime.exitOwnedCar()}
            style={{
              background: "rgba(255, 255, 255, 0.12)",
              border: "1px solid rgba(255, 255, 255, 0.25)",
              color: "#ffffff",
              borderRadius: 14,
              padding: "4px 12px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              marginLeft: 8,
              pointerEvents: "auto",
            }}
            title="Park vehicle and return to foot"
          >
            Park & Exit ✕
          </button>
          {onOpenRoadMap && (
            <button
              data-testid="open-drivable-overlay"
              onClick={onOpenRoadMap}
              style={{
                background: "rgba(0, 240, 255, 0.18)",
                border: "1px solid rgba(0, 240, 255, 0.5)",
                color: "#00f0ff",
                borderRadius: 14,
                padding: "4px 12px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                pointerEvents: "auto",
              }}
              title="Test & visualize drivable road actual on seed 4242"
            >
              🛣️ Road Map
            </button>
          )}
        </div>

        {/* Spec 175: Onboarding Mission Banner if player has not claimed a home yet */}
        {!hasHome && onOpenChooseHome && (
          <div
            data-testid="onboarding-claim-home-banner"
            onClick={onOpenChooseHome}
            style={{
              background:
                "linear-gradient(135deg, rgba(255, 210, 90, 0.22), rgba(15, 25, 40, 0.94))",
              backdropFilter: "blur(14px)",
              border: "1.5px solid rgba(255, 210, 90, 0.8)",
              boxShadow: "0 6px 24px rgba(255, 210, 90, 0.25)",
              color: "#ffd25a",
              padding: "8px 18px",
              borderRadius: 20,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            <span>
              🏡 <strong>Mission:</strong> Claim Your Homestead
            </span>
            <span
              style={{
                background: "#ffd25a",
                color: "#0a101d",
                padding: "3px 10px",
                borderRadius: 12,
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              Select Plot →
            </span>
          </div>
        )}

        {/* Spec 175: Active In-Car GPS Navigation HUD to Owned Homestead */}
        {hasHome && isNavigating && homeTarget && (
          <div
            data-testid="driving-home-gps-hud"
            style={{
              background: isNearHome
                ? "linear-gradient(135deg, rgba(80, 255, 120, 0.25), rgba(10, 30, 20, 0.95))"
                : "linear-gradient(135deg, rgba(0, 240, 255, 0.2), rgba(10, 25, 40, 0.95))",
              backdropFilter: "blur(14px)",
              border: `1.5px solid ${isNearHome ? "rgba(80, 255, 120, 0.8)" : "rgba(0, 240, 255, 0.7)"}`,
              boxShadow: `0 6px 24px ${isNearHome ? "rgba(80, 255, 120, 0.3)" : "rgba(0, 240, 255, 0.25)"}`,
              color: isNearHome ? "#50ff78" : "#00f0ff",
              padding: "8px 18px",
              borderRadius: 20,
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {isNearHome ? (
              <>
                <span>
                  🎉 <strong>ARRIVED AT HOMESTEAD!</strong> Welcome home
                </span>
                <button
                  data-testid="park-at-home-btn"
                  onClick={() => runtime.exitOwnedCar()}
                  style={{
                    background: "#50ff78",
                    color: "#0a1d10",
                    border: "none",
                    borderRadius: 12,
                    padding: "4px 12px",
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  🅿️ Park & Walk In
                </button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 16 }}>{navArrow}</span>
                <span>
                  🏡 <strong>GPS:</strong> {homeTarget.name}
                </span>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 14,
                    color: "#ffffff",
                  }}
                >
                  {distanceMeters}m
                </span>
                <span style={{ fontSize: 11, opacity: 0.85, color: "#a0e0ff" }}>
                  {navInstruction}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom Split Controls: Ergonomic Left (Steering) and Right (Throttle/Brake) Clusters */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          width: "100%",
          paddingBottom: "12px",
        }}
      >
        {/* Left Thumb Cluster: Steering Paddles */}
        <div
          style={{
            pointerEvents: "auto",
            display: "flex",
            gap: "clamp(6px, 1.5vw, 12px)",
            background: "rgba(8, 21, 34, 0.75)",
            backdropFilter: "blur(12px)",
            padding: "8px clamp(8px, 1.8vw, 14px)",
            borderRadius: "28px",
            border: "1px solid rgba(90, 230, 255, 0.3)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            touchAction: "none",
          }}
        >
          <button
            aria-label="Left"
            data-drive-action="left"
            style={{
              width: "clamp(46px, 11vw, 68px)",
              height: "clamp(46px, 11vw, 68px)",
              borderRadius: 20,
              background: pressedActions.left
                ? "linear-gradient(135deg, rgba(90, 230, 255, 0.6), rgba(0, 150, 220, 0.8))"
                : "rgba(255, 255, 255, 0.08)",
              border: `2px solid ${pressedActions.left ? "#5ae6ff" : "rgba(90, 230, 255, 0.4)"}`,
              boxShadow: pressedActions.left
                ? "0 0 20px rgba(90, 230, 255, 0.8)"
                : "none",
              color: "#ffffff",
              fontSize: 26,
              fontWeight: 900,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              userSelect: "none",
              touchAction: "none",
              transform: pressedActions.left ? "scale(0.94)" : "scale(1)",
              transition: "transform 0.08s ease, background 0.08s ease",
            }}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch (_) {}
              change("left", true);
            }}
            onPointerUp={() => change("left", false)}
            onPointerCancel={() => change("left", false)}
            onLostPointerCapture={() => change("left", false)}
            onMouseDown={() => change("left", true)}
            onMouseUp={() => change("left", false)}
            onMouseLeave={() => change("left", false)}
            onTouchStart={() => change("left", true)}
            onTouchEnd={() => change("left", false)}
            onTouchCancel={() => change("left", false)}
          >
            <span>◀</span>
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.05em",
                fontWeight: 700,
                marginTop: 2,
              }}
            >
              LEFT
            </span>
          </button>

          <button
            aria-label="Right"
            data-drive-action="right"
            style={{
              width: "clamp(46px, 11vw, 68px)",
              height: "clamp(46px, 11vw, 68px)",
              borderRadius: 20,
              background: pressedActions.right
                ? "linear-gradient(135deg, rgba(90, 230, 255, 0.6), rgba(0, 150, 220, 0.8))"
                : "rgba(255, 255, 255, 0.08)",
              border: `2px solid ${pressedActions.right ? "#5ae6ff" : "rgba(90, 230, 255, 0.4)"}`,
              boxShadow: pressedActions.right
                ? "0 0 20px rgba(90, 230, 255, 0.8)"
                : "none",
              color: "#ffffff",
              fontSize: 26,
              fontWeight: 900,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              userSelect: "none",
              touchAction: "none",
              transform: pressedActions.right ? "scale(0.94)" : "scale(1)",
              transition: "transform 0.08s ease, background 0.08s ease",
            }}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch (_) {}
              change("right", true);
            }}
            onPointerUp={() => change("right", false)}
            onPointerCancel={() => change("right", false)}
            onLostPointerCapture={() => change("right", false)}
            onMouseDown={() => change("right", true)}
            onMouseUp={() => change("right", false)}
            onMouseLeave={() => change("right", false)}
            onTouchStart={() => change("right", true)}
            onTouchEnd={() => change("right", false)}
            onTouchCancel={() => change("right", false)}
          >
            <span>▶</span>
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.05em",
                fontWeight: 700,
                marginTop: 2,
              }}
            >
              RIGHT
            </span>
          </button>
        </div>

        {/* Right Thumb Cluster: Gas, Brake & Reverse Pedals */}
        <div
          style={{
            pointerEvents: "auto",
            display: "flex",
            gap: "clamp(6px, 1.5vw, 12px)",
            alignItems: "center",
            background: "rgba(8, 21, 34, 0.75)",
            backdropFilter: "blur(12px)",
            padding: "8px clamp(8px, 1.8vw, 14px)",
            borderRadius: "28px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            touchAction: "none",
          }}
        >
          {/* Reverse button */}
          <button
            aria-label="Reverse"
            data-drive-action="reverse"
            style={{
              width: "clamp(40px, 9vw, 58px)",
              height: "clamp(40px, 9vw, 58px)",
              borderRadius: 18,
              background: pressedActions.reverse
                ? "linear-gradient(135deg, rgba(245, 167, 66, 0.7), rgba(200, 100, 20, 0.9))"
                : "rgba(255, 255, 255, 0.08)",
              border: `2px solid ${pressedActions.reverse ? "#f5a742" : "rgba(245, 167, 66, 0.4)"}`,
              boxShadow: pressedActions.reverse
                ? "0 0 16px rgba(245, 167, 66, 0.7)"
                : "none",
              color: "#ffffff",
              fontSize: 18,
              fontWeight: 800,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              userSelect: "none",
              touchAction: "none",
              transform: pressedActions.reverse ? "scale(0.94)" : "scale(1)",
              transition: "transform 0.08s ease, background 0.08s ease",
            }}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch (_) {}
              change("reverse", true);
            }}
            onPointerUp={() => change("reverse", false)}
            onPointerCancel={() => change("reverse", false)}
            onLostPointerCapture={() => change("reverse", false)}
            onMouseDown={() => change("reverse", true)}
            onMouseUp={() => change("reverse", false)}
            onMouseLeave={() => change("reverse", false)}
            onTouchStart={() => change("reverse", true)}
            onTouchEnd={() => change("reverse", false)}
            onTouchCancel={() => change("reverse", false)}
          >
            <span>▼</span>
            <span
              style={{ fontSize: 9, letterSpacing: "0.05em", fontWeight: 700 }}
            >
              REV
            </span>
          </button>

          {/* Brake button */}
          <button
            aria-label="Brake"
            data-drive-action="brake"
            style={{
              width: "clamp(44px, 10vw, 64px)",
              height: "clamp(44px, 10vw, 64px)",
              borderRadius: 20,
              background: pressedActions.brake
                ? "linear-gradient(135deg, rgba(255, 77, 109, 0.7), rgba(180, 20, 50, 0.9))"
                : "rgba(255, 255, 255, 0.08)",
              border: `2px solid ${pressedActions.brake ? "#ff4d6d" : "rgba(255, 77, 109, 0.4)"}`,
              boxShadow: pressedActions.brake
                ? "0 0 20px rgba(255, 77, 109, 0.8)"
                : "none",
              color: "#ffffff",
              fontSize: 20,
              fontWeight: 900,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              userSelect: "none",
              touchAction: "none",
              transform: pressedActions.brake ? "scale(0.94)" : "scale(1)",
              transition: "transform 0.08s ease, background 0.08s ease",
            }}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch (_) {}
              change("brake", true);
            }}
            onPointerUp={() => change("brake", false)}
            onPointerCancel={() => change("brake", false)}
            onLostPointerCapture={() => change("brake", false)}
            onMouseDown={() => change("brake", true)}
            onMouseUp={() => change("brake", false)}
            onMouseLeave={() => change("brake", false)}
            onTouchStart={() => change("brake", true)}
            onTouchEnd={() => change("brake", false)}
            onTouchCancel={() => change("brake", false)}
          >
            <span>■</span>
            <span
              style={{ fontSize: 10, letterSpacing: "0.05em", fontWeight: 700 }}
            >
              BRAKE
            </span>
          </button>

          {/* Throttle (Gas) button */}
          <button
            aria-label="Accelerate"
            data-drive-action="throttle"
            style={{
              width: "clamp(48px, 12vw, 76px)",
              height: "clamp(48px, 12vw, 76px)",
              borderRadius: 24,
              background: pressedActions.throttle
                ? "linear-gradient(135deg, rgba(0, 229, 163, 0.7), rgba(0, 160, 100, 0.9))"
                : "linear-gradient(135deg, rgba(0, 229, 163, 0.2), rgba(0, 160, 100, 0.35))",
              border: `2.5px solid ${pressedActions.throttle ? "#00e5a3" : "rgba(0, 229, 163, 0.6)"}`,
              boxShadow: pressedActions.throttle
                ? "0 0 24px rgba(0, 229, 163, 0.9)"
                : "0 4px 16px rgba(0, 229, 163, 0.25)",
              color: "#ffffff",
              fontSize: 26,
              fontWeight: 900,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              userSelect: "none",
              touchAction: "none",
              transform: pressedActions.throttle ? "scale(0.94)" : "scale(1)",
              transition: "transform 0.08s ease, background 0.08s ease",
            }}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch (_) {}
              change("throttle", true);
            }}
            onPointerUp={() => change("throttle", false)}
            onPointerCancel={() => change("throttle", false)}
            onLostPointerCapture={() => change("throttle", false)}
            onMouseDown={() => change("throttle", true)}
            onMouseUp={() => change("throttle", false)}
            onMouseLeave={() => change("throttle", false)}
            onTouchStart={() => change("throttle", true)}
            onTouchEnd={() => change("throttle", false)}
            onTouchCancel={() => change("throttle", false)}
          >
            <span>▲</span>
            <span
              style={{ fontSize: 11, letterSpacing: "0.05em", fontWeight: 800 }}
            >
              GAS
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
