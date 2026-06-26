import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { ColonyRuntime, ColonyUiState } from "../runtime";
import {
  gyroSteerFromOrientation,
  type OrientationLike,
} from "../racing/race";

export type MobileRallyControlAction =
  | "steer-left"
  | "steer-right"
  | "throttle"
  | "brake-reverse";

type RaceUiState = ColonyUiState["race"];

type MotionPermissionDeviceOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const GYRO_SOURCE = "gyro";

const MOBILE_RALLY_CONTROLS: {
  action: MobileRallyControlAction;
  keyCode: string;
  label: string;
  ariaLabel: string;
  className: string;
}[] = [
  {
    action: "steer-left",
    keyCode: "KeyA",
    label: "←",
    ariaLabel: "Steer left",
    className: "race-mobile-controls__button--steer",
  },
  {
    action: "throttle",
    keyCode: "KeyW",
    label: "Throttle",
    ariaLabel: "Hold throttle",
    className: "race-mobile-controls__button--throttle",
  },
  {
    action: "brake-reverse",
    keyCode: "KeyS",
    label: "Brake",
    ariaLabel: "Brake or reverse",
    className: "race-mobile-controls__button--brake",
  },
  {
    action: "steer-right",
    keyCode: "KeyD",
    label: "→",
    ariaLabel: "Steer right",
    className: "race-mobile-controls__button--steer",
  },
];

export function shouldShowMobileRallyControls(
  race: RaceUiState,
  isTouch: boolean,
): boolean {
  return isTouch && (race.mode === "countdown" || race.mode === "running");
}

export function mobileRallyControlKeyCode(
  action: MobileRallyControlAction,
): string {
  return MOBILE_RALLY_CONTROLS.find((control) => control.action === action)!
    .keyCode;
}

function releaseControl(runtime: ColonyRuntime, keyCode: string): void {
  runtime.setRaceKey(keyCode, false);
}

function pressControl(runtime: ColonyRuntime, keyCode: string): void {
  runtime.setRaceKey(keyCode, true);
}

function captureTouch(e: PointerEvent<HTMLButtonElement>): void {
  e.preventDefault();
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId);
  } catch {
    // Synthetic/browser-proof events may not be eligible for pointer capture; the held key still works.
  }
}

function orientationFromEvent(e: DeviceOrientationEvent): OrientationLike {
  return { gamma: e.gamma, beta: e.beta };
}

async function requestMotionPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const ctor = window.DeviceOrientationEvent as
    | MotionPermissionDeviceOrientationEvent
    | undefined;
  if (!ctor) return false;
  if (typeof ctor.requestPermission !== "function") return true;
  try {
    return (await ctor.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function RaceMobileControls({
  race,
  runtime,
  isTouch,
}: {
  race: RaceUiState;
  runtime: ColonyRuntime;
  isTouch: boolean;
}) {
  const [gyroEnabled, setGyroEnabled] = useState(false);
  const [gyroPermissionDenied, setGyroPermissionDenied] = useState(false);
  const baselineRef = useRef<OrientationLike | null>(null);
  const latestOrientationRef = useRef<OrientationLike | null>(null);

  useEffect(() => {
    if (!gyroEnabled || typeof window === "undefined") return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      const orientation = orientationFromEvent(e);
      latestOrientationRef.current = orientation;
      if (!baselineRef.current) baselineRef.current = orientation;
      runtime.setRaceAnalogInput(GYRO_SOURCE, {
        steer: gyroSteerFromOrientation(orientation, baselineRef.current),
      });
    };
    window.addEventListener("deviceorientation", onOrientation);
    return () => {
      window.removeEventListener("deviceorientation", onOrientation);
      runtime.setRaceAnalogInput(GYRO_SOURCE, null);
    };
  }, [gyroEnabled, runtime]);

  useEffect(() => {
    if (race.mode === "idle" || race.mode === "finished") {
      setGyroEnabled(false);
      runtime.setRaceAnalogInput(GYRO_SOURCE, null);
    }
  }, [race.mode, runtime]);

  if (!shouldShowMobileRallyControls(race, isTouch)) return null;

  const enableGyro = async () => {
    const permitted = await requestMotionPermission();
    if (!permitted) {
      setGyroPermissionDenied(true);
      setGyroEnabled(false);
      runtime.setRaceAnalogInput(GYRO_SOURCE, null);
      return;
    }
    setGyroPermissionDenied(false);
    baselineRef.current = latestOrientationRef.current;
    setGyroEnabled(true);
  };

  const disableGyro = () => {
    setGyroEnabled(false);
    runtime.setRaceAnalogInput(GYRO_SOURCE, null);
  };

  const recenterGyro = () => {
    baselineRef.current = latestOrientationRef.current;
    runtime.setRaceAnalogInput(GYRO_SOURCE, { steer: 0 });
  };

  return (
    <div
      className="race-mobile-controls"
      role="group"
      aria-label="Mobile Road Rally driving controls"
    >
      <div className="race-mobile-controls__hint">
        Hold throttle · steer left/right · brake to reverse
      </div>
      <div className="race-mobile-controls__gyro" data-race-gyro="panel">
        <button
          type="button"
          className={gyroEnabled ? "on" : ""}
          data-race-action="gyro-toggle"
          aria-pressed={gyroEnabled}
          aria-label={gyroEnabled ? "Turn gyro steering off" : "Turn gyro steering on"}
          onClick={() => {
            if (gyroEnabled) disableGyro();
            else void enableGyro();
          }}
        >
          Gyro steer {gyroEnabled ? "on" : "off"}
        </button>
        <button
          type="button"
          data-race-action="gyro-recenter"
          aria-label="Recenter gyro steering"
          disabled={!gyroEnabled}
          onClick={recenterGyro}
        >
          Recenter
        </button>
        {gyroPermissionDenied && (
          <span className="race-mobile-controls__gyro-warning">
            Motion permission denied
          </span>
        )}
      </div>
      <div className="race-mobile-controls__grid">
        {MOBILE_RALLY_CONTROLS.map((control) => (
          <button
            key={control.action}
            type="button"
            className={`race-mobile-controls__button ${control.className}`}
            data-race-action={control.action}
            aria-label={control.ariaLabel}
            title={control.ariaLabel}
            onPointerDown={(e) => {
              captureTouch(e);
              pressControl(runtime, control.keyCode);
            }}
            onPointerUp={() => releaseControl(runtime, control.keyCode)}
            onPointerCancel={() => releaseControl(runtime, control.keyCode)}
            onPointerLeave={() => releaseControl(runtime, control.keyCode)}
            onBlur={() => releaseControl(runtime, control.keyCode)}
          >
            {control.label}
          </button>
        ))}
      </div>
    </div>
  );
}
