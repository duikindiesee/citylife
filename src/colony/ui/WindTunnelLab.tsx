import React, { useState, useEffect, useRef } from "react";
import {
  DEFAULT_CAR_CURVES,
  calculateAerodynamics,
  generateStreamlines,
  type CarCurveParams,
  type AeroTelemetry,
  type StreamlineParticle,
} from "../car/aerodynamics";
import {
  DEFAULT_ENGINE_CALIBRATION,
  v8FiringFrequencyHz,
  superchargerWhineHz,
  V8AudioSynthesizer,
  type EngineSoundCalibration,
} from "../car/engineSound";

/** One frame at 60 Hz. StreamlineParticle.vx already carries the tunnel speed. */
const FLOW_STEP_SECONDS = 1 / 60;
/** Downstream limit: past this the particle has left the wake and is recycled. */
const WAKE_EXIT_X = -4;
/** Upstream re-entry point, ahead of the car's nose. */
const INTAKE_ENTRY_X = 7;

interface WindTunnelLabProps {
  open: boolean;
  onClose: () => void;
}

export function WindTunnelLab({ open, onClose }: WindTunnelLabProps) {
  const [speedKmH, setSpeedKmH] = useState(160);
  const [curves, setCurves] = useState<CarCurveParams>(DEFAULT_CAR_CURVES());
  const [soundCal, setSoundCal] = useState<EngineSoundCalibration>(
    DEFAULT_ENGINE_CALIBRATION(),
  );
  const [streamlines, setStreamlines] = useState<StreamlineParticle[]>([]);
  const [audioActive, setAudioActive] = useState(false);

  const synthRef = useRef<V8AudioSynthesizer | null>(null);

  const telemetry: AeroTelemetry = calculateAerodynamics(curves, speedKmH);

  useEffect(() => {
    // The component stays mounted while closed, so hooks still run. Without this guard the
    // animation loop would rAF forever and setState every frame on a hidden overlay, which is
    // a background render leak in every session.
    if (!open) return;
    let animId: number;
    let particles = generateStreamlines(60, speedKmH);
    setStreamlines(particles);

    const step = () => {
      particles = particles.map((p) => {
        // vx already encodes tunnel speed and is NEGATIVE: air flows front-to-back
        // over a car that faces +x. Step by it and recycle upstream once a particle
        // clears the wake, or the flow visibly runs backwards.
        let nx = p.x + p.vx * FLOW_STEP_SECONDS;
        if (nx < WAKE_EXIT_X) nx = INTAKE_ENTRY_X;
        return { ...p, x: nx };
      });
      setStreamlines(particles);
      animId = requestAnimationFrame(step);
    };

    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [open, speedKmH]);

  useEffect(() => {
    if (audioActive && synthRef.current) {
      synthRef.current.updateRPM(soundCal);
    }
  }, [soundCal, audioActive]);

  // Exiting the lab must silence the V8. onClose only flips the open flag, and the component
  // stays mounted, so without this the audio graph keeps running behind a hidden overlay.
  useEffect(() => {
    if (open) return;
    if (synthRef.current) synthRef.current.stop();
    setAudioActive(false);
  }, [open]);

  // Same on teardown, so a route change or unmount cannot leave the graph running.
  useEffect(() => {
    return () => {
      if (synthRef.current) synthRef.current.stop();
    };
  }, []);

  const toggleAudio = () => {
    if (!synthRef.current) synthRef.current = new V8AudioSynthesizer();
    if (audioActive) {
      synthRef.current.stop();
      setAudioActive(false);
    } else {
      synthRef.current.start();
      setAudioActive(true);
    }
  };

  const triggerPop = () => {
    if (synthRef.current) synthRef.current.triggerBackfirePop();
  };

  if (!open) return null;

  return (
    <div
      className="wind-tunnel-root"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 999999,
        background: "linear-gradient(135deg, #08101a 0%, #0e1e32 100%)",
        backdropFilter: "blur(16px)",
        color: "#d0e4f7",
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        flexDirection: "column",
        padding: 24,
        overflowY: "auto",
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #1e3650",
          paddingBottom: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <h2 style={{ margin: 0, color: "#00e5ff", fontSize: 22 }}>
            💨 3D Aerodynamics Wind Tunnel Laboratory
          </h2>
          <div style={{ fontSize: 13, color: "#7a9cb8", marginTop: 4 }}>
            Airflow Streamline Simulation, Drag & Downforce Telemetry, and V8 Sound Calibration
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            background: "#ef233c",
            border: "none",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: 6,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          ✕ Exit Tunnel Lab
        </button>
      </div>

      {/* Main Grid: Telemetry Gauges + Streamline Visualiser + Curve Shaping */}
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr 340px", gap: 20 }}>
        {/* Left Column: Real-Time Telemetry & Gauges */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              background: "rgba(14, 24, 38, 0.8)",
              border: "1px solid #1e3650",
              borderRadius: 10,
              padding: 16,
            }}
          >
            <h4 style={{ margin: "0 0 12px 0", color: "#ffd25a", fontSize: 14 }}>
              📊 Aerodynamic Telemetry (Actual Physics)
            </h4>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div
                style={{
                  background: "rgba(0, 229, 255, 0.1)",
                  border: "1px solid #00e5ff",
                  padding: 10,
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: 11, color: "#8ab4d0" }}>Drag Coeff ($C_d$)</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#00e5ff" }}>
                  {telemetry.cd}
                </div>
              </div>

              <div
                style={{
                  background: "rgba(255, 210, 90, 0.1)",
                  border: "1px solid #ffd25a",
                  padding: 10,
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: 11, color: "#8ab4d0" }}>Frontal Area ($A$)</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#ffd25a" }}>
                  {telemetry.frontalAreaM2} <span style={{ fontSize: 12 }}>m²</span>
                </div>
              </div>

              <div
                style={{
                  background: "rgba(239, 35, 60, 0.1)",
                  border: "1px solid #ef233c",
                  padding: 10,
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: 11, color: "#8ab4d0" }}>Drag Force ($F_d$)</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#ef233c" }}>
                  {telemetry.dragForceN} <span style={{ fontSize: 12 }}>N</span>
                </div>
              </div>

              <div
                style={{
                  background: "rgba(76, 201, 240, 0.1)",
                  border: "1px solid #4cc9f0",
                  padding: 10,
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: 11, color: "#8ab4d0" }}>Total Downforce</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#4cc9f0" }}>
                  {telemetry.totalDownforceN} <span style={{ fontSize: 12 }}>N</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: "#8ab4d0" }}>
              Aero efficiency ratio (downforce / drag):{" "}
              <strong style={{ color: "#fff" }}>{telemetry.aeroEfficiency}</strong>
            </div>
          </div>

          {/* Wind Speed Airflow Control */}
          <div
            style={{
              background: "rgba(14, 24, 38, 0.8)",
              border: "1px solid #1e3650",
              borderRadius: 10,
              padding: 16,
            }}
          >
            <h4 style={{ margin: "0 0 10px 0", color: "#00e5ff", fontSize: 14 }}>
              🌪️ Wind Tunnel Air Speed Control
            </h4>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span>Air Velocity:</span>
              <strong style={{ color: "#00e5ff" }}>{speedKmH} km/h</strong>
            </div>
            <input
              type="range"
              min={0}
              max={300}
              value={speedKmH}
              onChange={(e) => setSpeedKmH(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#00e5ff" }}
            />
          </div>
        </div>

        {/* Middle Column: 2D/3D Airflow Streamline Visualiser Canvas */}
        <div
          style={{
            background: "rgba(10, 16, 26, 0.95)",
            border: "1px solid #1e3650",
            borderRadius: 12,
            padding: 16,
            position: "relative",
            minHeight: 380,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ fontSize: 12, color: "#7a9cb8", marginBottom: 8 }}>
            🔴 Red = Stagnation/High Drag | 🟢 Green = Smooth Laminar Flow | 🔵 Blue = Low Pressure/Wake
          </div>

          <div
            style={{
              flex: 1,
              position: "relative",
              background: "#05080e",
              borderRadius: 8,
              border: "1px solid #162a40",
              overflow: "hidden",
            }}
          >
            {/* Simulated Streamline Flow Particles */}
            <svg
              viewBox="0 0 800 360"
              style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
            >
              {/* Grid Lines */}
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0, 229, 255, 0.08)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="800" height="360" fill="url(#grid)" />

              {/* Wind Tunnel Ground Plane */}
              <line x1="0" y1="280" x2="800" y2="280" stroke="#00e5ff" strokeWidth="2" strokeDasharray="6,6" />

              {/* Karoo Kaap V8 Muscle Car Side Profile Contour */}
              <path
                d="M 160 280 L 190 270 L 260 265 L 320 220 L 460 210 L 540 235 L 620 240 L 640 280 Z"
                fill="rgba(212, 117, 25, 0.35)"
                stroke="#ffd25a"
                strokeWidth="3"
              />
              {/* Chrome Supercharger Blower Scoop */}
              <rect x="290" y="195" width="55" height="30" fill="#ffffff" stroke="#00e5ff" strokeWidth="2" rx="4" />
              {/* Rear Wing */}
              <path d="M 580 205 L 630 198 L 640 206 L 590 215 Z" fill="#111" stroke="#00e5ff" strokeWidth="2" />

              {/* Animated Streamline Ribbons */}
              {streamlines.map((p) => {
                const color =
                  p.pressure === "high"
                    ? "#ef233c"
                    : p.pressure === "low"
                    ? "#4cc9f0"
                    : p.pressure === "wake"
                    ? "#9d4edd"
                    : "#52b788";
                const cx = (p.x / 12) * 800;
                const cy = p.y * 320;

                return (
                  <g key={p.id}>
                    <line
                      x1={cx - 16}
                      y1={cy}
                      x2={cx}
                      y2={cy}
                      stroke={color}
                      strokeWidth="2.5"
                      opacity={0.85}
                    />
                    <circle cx={cx} cy={cy} r={3.5} fill={color} />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Right Column: Interactive Curve Shaping Controls & Engine Sound Calibration */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Curve Shaping Controls */}
          <div
            style={{
              background: "rgba(14, 24, 38, 0.8)",
              border: "1px solid #1e3650",
              borderRadius: 10,
              padding: 16,
            }}
          >
            <h4 style={{ margin: "0 0 12px 0", color: "#ffd25a", fontSize: 14 }}>
              🎛️ Shape Car Curves (Live Telemetry)
            </h4>

            {/* Front Splitter Extension */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
                <span>Front Splitter Extension:</span>
                <strong style={{ color: "#ffd25a" }}>
                  {Math.round(curves.splitterAngle * 100)}%
                </strong>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={curves.splitterAngle}
                onChange={(e) =>
                  setCurves({ ...curves, splitterAngle: Number(e.target.value) })
                }
                style={{ width: "100%", accentColor: "#ffd25a" }}
              />
            </div>

            {/* Fastback Rake Slope */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
                <span>Fastback Roof Rake:</span>
                <strong style={{ color: "#00e5ff" }}>
                  {Math.round(curves.fastbackRake * 100)}%
                </strong>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={curves.fastbackRake}
                onChange={(e) =>
                  setCurves({ ...curves, fastbackRake: Number(e.target.value) })
                }
                style={{ width: "100%", accentColor: "#00e5ff" }}
              />
            </div>

            {/* Rear Wing Angle of Attack */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
                <span>Rear Wing Angle:</span>
                <strong style={{ color: "#d880ff" }}>{curves.wingAngleDeg}°</strong>
              </div>
              <input
                type="range"
                min={0}
                max={25}
                value={curves.wingAngleDeg}
                onChange={(e) =>
                  setCurves({ ...curves, wingAngleDeg: Number(e.target.value) })
                }
                style={{ width: "100%", accentColor: "#d880ff" }}
              />
            </div>

            {/* Supercharger Scoop Height */}
            <div>
              <div style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
                <span>Blower Scoop Height:</span>
                <strong style={{ color: "#ef233c" }}>
                  {Math.round(curves.blowerScoopHeight * 100)}%
                </strong>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={curves.blowerScoopHeight}
                onChange={(e) =>
                  setCurves({ ...curves, blowerScoopHeight: Number(e.target.value) })
                }
                style={{ width: "100%", accentColor: "#ef233c" }}
              />
            </div>
          </div>

          {/* Engine Sound Calibration Panel */}
          <div
            style={{
              background: "rgba(14, 24, 38, 0.8)",
              border: "1px solid #1e3650",
              borderRadius: 10,
              padding: 16,
            }}
          >
            <h4 style={{ margin: "0 0 10px 0", color: "#ff9f1c", fontSize: 14 }}>
              🔊 V8 Engine Sound Calibration
            </h4>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                onClick={toggleAudio}
                style={{
                  flex: 1,
                  background: audioActive ? "#ef233c" : "#00e5ff",
                  color: "#000",
                  border: "none",
                  padding: "8px",
                  borderRadius: 6,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {audioActive ? "🔇 Mute V8 Audio" : "🔊 Synthesize V8 Audio"}
              </button>
              <button
                onClick={triggerPop}
                style={{
                  background: "rgba(255, 159, 28, 0.2)",
                  border: "1px solid #ff9f1c",
                  color: "#ff9f1c",
                  padding: "8px",
                  borderRadius: 6,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                💥 Pop
              </button>
            </div>

            <div style={{ fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Engine Speed (Tachometer):</span>
                <strong style={{ color: "#ff9f1c" }}>{soundCal.currentRpm} RPM</strong>
              </div>
              <input
                type="range"
                min={soundCal.idleRpm}
                max={soundCal.maxRpm}
                step={50}
                value={soundCal.currentRpm}
                onChange={(e) =>
                  setSoundCal({ ...soundCal, currentRpm: Number(e.target.value) })
                }
                style={{ width: "100%", accentColor: "#ff9f1c", marginTop: 4 }}
              />

              <div style={{ marginTop: 8, color: "#8ab4d0" }}>
                V8 Firing Freq:{" "}
                <strong style={{ color: "#fff" }}>
                  {Math.round(v8FiringFrequencyHz(soundCal.currentRpm))} Hz
                </strong>{" "}
                | Whine:{" "}
                <strong style={{ color: "#fff" }}>
                  {Math.round(superchargerWhineHz(soundCal.currentRpm))} Hz
                </strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
