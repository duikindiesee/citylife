/**
 * UI.VERSION.1 — the small build stamp.
 *
 * LAYOUT CONTRACT: this component carries NO positioning of its own. UI.HUD.OVERLAP.1 (PR 421)
 * and UI.GEO.OVERLAP.1 (PR 432) both exist because separate elements each pinned themselves into
 * the same corner with `position: fixed/absolute` and buried one another. In the game view this
 * is therefore a member of `.hud-corner-rail-left`, and that rail owns where it goes. On the
 * login screen it is a normal in-flow element under the card. Adding a third self-pinning corner
 * element is exactly the defect those two PRs fixed, so it is not done here.
 */
import React, { useEffect, useState } from "react";
import {
  buildStampParts,
  buildStampTitle,
  formatBuildStamp,
} from "../buildStamp";
import type { ColonyRuntime } from "../runtime";

export interface BuildStampProps {
  readonly variant?: "hud" | "fp" | "login";
  readonly runtime?: ColonyRuntime;
}

export function deriveDiagnosticReadout(runtime?: ColonyRuntime): {
  x: number;
  elev: number;
  z: number;
  headingDeg: number;
  seed: number;
} | null {
  if (!runtime) return null;
  const sim = runtime.sim;
  if (!sim) return null;
  const t = sim.state.terrain;
  const seed = runtime.getSeed?.() ?? sim.state.seed ?? 4242;
  const drivePose = runtime.getOwnedDrivePose?.();
  const fpCell = (runtime as any).fpCameraCell;
  const fpCitizenId = (runtime as any)?.fpCitizenId;
  const citizen =
    fpCitizenId && typeof (runtime as any)?.citizen === "function"
      ? (runtime as any).citizen(fpCitizenId)
      : null;
  const citizenPos = citizen?.positionXY ?? citizen?.pos;
  const opCar = sim.state.operatorCar;

  // Prioritize active player (driving > first-person/walking > citizen > parked operator car)
  const cellX =
    drivePose?.x ?? fpCell?.x ?? citizenPos?.x ?? opCar?.cell?.x ?? t.size / 2;
  const cellY =
    drivePose?.y ?? fpCell?.y ?? citizenPos?.y ?? opCar?.cell?.y ?? t.size / 2;
  const headingRad = drivePose
    ? drivePose.heading
    : fpCell
      ? ((runtime as any).fpCameraYaw ?? 0)
      : opCar
        ? opCar.heading
        : 0;

  const worldX = (cellX - t.size / 2) * 4;
  const worldZ = (cellY - t.size / 2) * 4;
  const elev = runtime.isRoadSurface?.(cellX, cellY)
    ? t.worldYAt(cellX, cellY) + 0.18
    : t.worldYAt(cellX, cellY);
  const headingDeg = Math.round(
    ((((headingRad * 180) / Math.PI) % 360) + 360) % 360,
  );

  return {
    x: Math.round(worldX * 10) / 10,
    elev: Math.round(elev * 100) / 100,
    z: Math.round(worldZ * 10) / 10,
    headingDeg,
    seed,
  };
}

export function BuildStamp({ variant = "hud", runtime }: BuildStampProps) {
  const parts = buildStampParts();
  const text = formatBuildStamp(parts);

  const [diag, setDiag] = useState<{
    x: number;
    elev: number;
    z: number;
    headingDeg: number;
    seed: number;
  } | null>(null);

  useEffect(() => {
    if (!runtime) return;
    const updateDiag = () => {
      setDiag(deriveDiagnosticReadout(runtime));
    };

    updateDiag();
    const interval = window.setInterval(updateDiag, 250);
    return () => window.clearInterval(interval);
  }, [runtime]);

  // Always show coordinates for in-game views so any screen capture captures exact coordinates
  const showDiag = Boolean(
    runtime && typeof window !== "undefined" && variant !== "login",
  );

  return (
    <div
      className={`build-stamp build-stamp--${variant}`}
      data-testid="build-stamp"
      title={buildStampTitle(parts)}
      style={{
        display: "inline-flex",
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "nowrap",
        gap: "6px",
        fontFamily: "monospace",
        fontSize: "10.5px",
        lineHeight: "1.2",
        color: "rgba(255, 255, 255, 0.75)",
        background: "rgba(10, 16, 26, 0.78)",
        padding: "3px 8px",
        borderRadius: "4px",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        pointerEvents: "auto",
        userSelect: "text",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontWeight: 600, color: "#6fe3ff" }}>{text}</span>
      {parts.builtAt && (
        <span style={{ opacity: 0.65, fontSize: "10px" }} title="Build timestamp">
          {parts.builtAt}
        </span>
      )}
      {showDiag && diag && (
        <span
          data-testid="diagnostic-readout"
          style={{
            fontSize: "10px",
            color: "#ffda79",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            marginLeft: "2px",
          }}
        >
<<<<<<< HEAD
          <span>
            X: <b>{diag.x}m</b>
          </span>
          <span>
            Elev: <b>{diag.elev}m</b>
          </span>
          <span>
            Z: <b>{diag.z}m</b>
          </span>
          <span>
            Hdg: <b>{diag.headingDeg}°</b>
          </span>
          <span>
            Seed: <b>{diag.seed}</b>
          </span>
        </div>
=======
          <span style={{ opacity: 0.35 }}>|</span>
          <span>X: <b>{diag.x}m</b></span>
          <span>Elev: <b>{diag.elev}m</b></span>
          <span>Z: <b>{diag.z}m</b></span>
          <span>Hdg: <b>{diag.headingDeg}°</b></span>
          <span>Seed: <b>{diag.seed}</b></span>
        </span>
>>>>>>> 3cfa36a (fix(hud): footer single line versioning, road crosswalk clearance and transit backlog)
      )}
    </div>
  );
}
