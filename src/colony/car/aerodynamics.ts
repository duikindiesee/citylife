// Spec 096 — Aerodynamics Physics & Telemetry Engine for Wind Tunnel Testing.
// Computes real-time Drag Coefficient (Cd), Frontal Cross-Section Area (A), Aerodynamic Drag Force (Fd),
// Downforce (FL), and Particle Streamline Velocity Fields based on interactive car curve parameters.

export interface CarCurveParams {
  /** Front splitter extension length (0.0 to 1.0, default 0.4). Higher = more front downforce. */
  splitterAngle: number;
  /** Roof chop / fastback slope taper (0.0 to 1.0, default 0.3). Higher = smoother rear flow, lower Cd. */
  fastbackRake: number;
  /** Rear wing tilt angle of attack in degrees (0 to 25 deg, default 12). Higher = more rear downforce. */
  wingAngleDeg: number;
  /** Supercharger scoop height (0.0 to 1.0, default 0.6). Higher = higher frontal area & drag. */
  blowerScoopHeight: number;
}

export interface AeroTelemetry {
  /** Drag Coefficient (Cd), e.g. 0.31 - 0.44 */
  cd: number;
  /** Projected Frontal Area (A) in m^2, e.g. 2.1 m^2 */
  frontalAreaM2: number;
  /** Aerodynamic Drag Force in Newtons (Fd = 0.5 * rho * v^2 * A * Cd) */
  dragForceN: number;
  /** Front axle downforce in Newtons at current speed */
  frontDownforceN: number;
  /** Rear axle downforce in Newtons at current speed */
  rearDownforceN: number;
  /** Total net downforce in Newtons */
  totalDownforceN: number;
  /** Aerodynamic efficiency ratio (Downforce / Drag) */
  aeroEfficiency: number;
}

/** Standard air density at sea level in kg/m^3 */
const RHO_AIR = 1.225;

export function DEFAULT_CAR_CURVES(): CarCurveParams {
  return {
    splitterAngle: 0.4,
    fastbackRake: 0.35,
    wingAngleDeg: 12,
    blowerScoopHeight: 0.5,
  };
}

/** Calculate real aerodynamic telemetry for a car given curve parameters and air speed (km/h). */
export function calculateAerodynamics(
  params: CarCurveParams,
  speedKmH: number,
): AeroTelemetry {
  // Convert speed to m/s
  const vMs = (speedKmH * 1000) / 3600;

  // Base frontal area: 2.0 m^2 base + scoop height contribution
  const frontalAreaM2 = 2.0 + params.blowerScoopHeight * 0.28;

  // Base Cd calculation based on curves
  // Fastback rake reduces rear wake drag (-0.08 max reduction)
  // Blower scoop adds frontal drag (+0.07 max increase)
  // Rear wing angle adds drag (+0.004 per degree)
  // Front splitter adds small drag (+0.02 max)
  const baseCd = 0.34;
  const cd = Math.max(
    0.26,
    Math.min(
      0.55,
      baseCd -
        params.fastbackRake * 0.08 +
        params.blowerScoopHeight * 0.07 +
        params.wingAngleDeg * 0.0045 +
        params.splitterAngle * 0.02,
    ),
  );

  // Aerodynamic Drag Force: Fd = 0.5 * rho * v^2 * A * Cd
  const dragForceN = 0.5 * RHO_AIR * Math.pow(vMs, 2) * frontalAreaM2 * cd;

  // Downforce calculations
  // Front splitter downforce: scales with splitter extension and v^2
  const frontDownforceN =
    0.5 * RHO_AIR * Math.pow(vMs, 2) * (0.35 * params.splitterAngle);

  // Rear wing downforce: scales with wing angle of attack (sin) and v^2
  const wingRad = (params.wingAngleDeg * Math.PI) / 180;
  const rearDownforceN =
    0.5 * RHO_AIR * Math.pow(vMs, 2) * (0.65 * Math.sin(wingRad));

  const totalDownforceN = frontDownforceN + rearDownforceN;
  const aeroEfficiency = dragForceN > 0 ? totalDownforceN / dragForceN : 0;

  return {
    cd: Number(cd.toFixed(3)),
    frontalAreaM2: Number(frontalAreaM2.toFixed(2)),
    dragForceN: Math.round(dragForceN),
    frontDownforceN: Math.round(frontDownforceN),
    rearDownforceN: Math.round(rearDownforceN),
    totalDownforceN: Math.round(totalDownforceN),
    aeroEfficiency: Number(aeroEfficiency.toFixed(2)),
  };
}

export interface StreamlineParticle {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  pressure: "high" | "laminar" | "low" | "wake";
}

/** Generate wind tunnel particle velocity streamlines flowing over the car. */
export function generateStreamlines(
  count: number,
  speedKmH: number,
): StreamlineParticle[] {
  const particles: StreamlineParticle[] = [];
  const speedScale = speedKmH / 100;

  for (let i = 0; i < count; i++) {
    const x = 3.0 + (i % 10) * 0.4;
    const y = 0.1 + Math.random() * 1.2;
    const z = (Math.random() - 0.5) * 1.6;

    let pressure: "high" | "laminar" | "low" | "wake" = "laminar";
    if (y < 0.45 && Math.abs(z) < 0.5 && x > 0.5) pressure = "high";
    else if (x < -0.8) pressure = "wake";
    else if (y > 0.7) pressure = "low";

    particles.push({
      id: i,
      x,
      y,
      z,
      vx: -(1.2 + Math.random() * 0.4) * speedScale,
      vy: (Math.random() - 0.5) * 0.05,
      vz: (Math.random() - 0.5) * 0.05,
      pressure,
    });
  }

  return particles;
}
