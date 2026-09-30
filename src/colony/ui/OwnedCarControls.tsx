import { useCallback, useEffect, useRef } from "react";
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
}: {
  runtime: ColonyRuntime;
  suspended: boolean;
}) {
  const pose = runtime.getOwnedDrivePose();
  const active = !!pose && !suspended;
  const generation = runtime.getOwnedDriveInputGeneration();
  const inputGeneration = useRef(generation);
  const input = useRef<OwnedDriveInput>({});
  const change = useCallback(
    (action: keyof OwnedDriveInput, down: boolean) => {
      const currentGeneration = runtime.getOwnedDriveInputGeneration();
      if (inputGeneration.current !== currentGeneration) {
        input.current = {};
        inputGeneration.current = currentGeneration;
      }
      input.current = { ...input.current, [action]: down };
      runtime.setOwnedDriveInput(input.current);
    },
    [runtime],
  );
  useEffect(() => {
    const clear = () => {
      input.current = {};
      inputGeneration.current = runtime.getOwnedDriveInputGeneration();
      runtime.setOwnedDriveInput({ brake: true });
    };
    if (!active) {
      clear();
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const action = keys[event.code];
      if (!action) return;
      // Holding a key through an authority reset must require a fresh physical press.
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
        style={{ minHeight: 44 }}
      >
        Enter your car
      </button>
    ) : null;
  const onRoad = pose
    ? runtime.sim.state.roadSet.has(
        `${Math.round(pose.x)},${Math.round(pose.y)}`,
      )
    : true;
  const speedKmH = Math.round(Math.abs(pose!.speed) * 3.6);

  return (
    <section
      aria-label="Owned car controls"
      data-testid="owned-car-controls"
      style={{
        background: "rgba(8, 21, 34, 0.85)",
        backdropFilter: "blur(12px)",
        border: `1px solid ${onRoad ? "rgba(90, 230, 255, 0.3)" : "rgba(245, 167, 66, 0.4)"}`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        color: "white",
        padding: 10,
        borderRadius: 12,
      }}
    >
      <div
        style={{
          textAlign: "center",
          fontWeight: 700,
          letterSpacing: "0.05em",
          fontSize: 14,
          marginBottom: 6,
          color: onRoad ? "#5ae6ff" : "#f5a742",
        }}
      >
        {onRoad ? "🏎️ HIGHWAY" : "🏜️ OFF-ROAD"} · {speedKmH} km/h
      </div>
      <button
        data-testid="exit-owned-car"
        onClick={() => runtime.exitOwnedCar()}
        style={{
          width: "100%",
          padding: "6px 10px",
          marginBottom: 8,
          background: "rgba(255, 255, 255, 0.1)",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          color: "#e0f0ff",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        Park and exit
      </button>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 6,
        }}
      >
        {(
          [
            ["left", "Left"],
            ["throttle", "Accelerate"],
            ["brake", "Brake"],
            ["reverse", "Reverse"],
            ["right", "Right"],
          ] as const
        ).map(([action, label]) => (
          <button
            key={action}
            aria-label={label}
            data-drive-action={action}
            style={{
              minHeight: 44,
              minWidth: 44,
              touchAction: "none",
              fontSize: 12,
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              change(action, true);
            }}
            onPointerUp={() => change(action, false)}
            onPointerCancel={() => change(action, false)}
            onLostPointerCapture={() => change(action, false)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
