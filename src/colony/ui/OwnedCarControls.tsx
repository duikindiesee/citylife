import { useEffect, useRef } from "react";
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
  const input = useRef<OwnedDriveInput>({});
  const change = (action: keyof OwnedDriveInput, down: boolean) => {
    input.current = { ...input.current, [action]: down };
    runtime.setOwnedDriveInput(input.current);
  };
  useEffect(() => {
    const clear = () => {
      input.current = {};
      runtime.setOwnedDriveInput({ brake: true });
    };
    if (!active) {
      clear();
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const action = keys[event.code];
      if (!action) return;
      const target = event.target as HTMLElement | null;
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
  }, [runtime, active]);
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
  return (
    <section
      aria-label="Owned car controls"
      data-testid="owned-car-controls"
      style={{
        background: "#081522",
        color: "white",
        padding: 8,
        borderRadius: 12,
      }}
    >
      <div style={{ textAlign: "center" }}>
        Driving · {Math.round(Math.abs(pose!.speed) * 3.6)} km/h
      </div>
      <button
        data-testid="exit-owned-car"
        onClick={() => runtime.exitOwnedCar()}
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
