import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  RaceMobileControls,
  mobileRallyControlKeyCode,
  shouldShowMobileRallyControls,
} from "../src/colony/ui/RaceMobileControls";
import type { ColonyUiState } from "../src/colony/runtime";
import { newRaceState, stepRace } from "../src/colony/racing/race";
import type { RaceTrack } from "../src/colony/racing/track";

const race = (mode: ColonyUiState["race"]["mode"]): ColonyUiState["race"] => ({
  mode,
  available: true,
  countdownMs: mode === "countdown" ? 3000 : 0,
  timeMs: 0,
  finishedMs: null,
  bestMs: null,
  checkpoint: 1,
  checkpoints: 4,
  offTrack: false,
});

const manualTrack = (): RaceTrack => ({
  path: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ],
  checkpoints: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ],
  length: 3,
  loop: false,
  seed: 7,
  roadsVersion: 1,
  roadKinds: {
    "0,0": "street",
    "1,0": "street",
    "2,0": "street",
    "3,0": "street",
  },
});

describe("mobile Road Rally driving controls", () => {
  it("are touch-only and only shown while a rally is countdown or running", () => {
    expect(shouldShowMobileRallyControls(race("idle"), true)).toBe(false);
    expect(shouldShowMobileRallyControls(race("finished"), true)).toBe(false);
    expect(shouldShowMobileRallyControls(race("countdown"), false)).toBe(false);
    expect(shouldShowMobileRallyControls(race("countdown"), true)).toBe(true);
    expect(shouldShowMobileRallyControls(race("running"), true)).toBe(true);
  });

  it("renders large accessible touch controls for steering, throttle, and brake/reverse", () => {
    const runtime = { setRaceKey: () => undefined } as never;
    const html = renderToStaticMarkup(
      React.createElement(RaceMobileControls, {
        race: race("running"),
        runtime,
        isTouch: true,
      }),
    );

    expect(html).toContain("race-mobile-controls");
    expect(html).toContain('data-race-action="steer-left"');
    expect(html).toContain('data-race-action="steer-right"');
    expect(html).toContain('data-race-action="throttle"');
    expect(html).toContain('data-race-action="brake-reverse"');
    expect(html).toContain('aria-label="Steer left"');
    expect(html).toContain('aria-label="Hold throttle"');
    expect(html).toContain('aria-label="Brake or reverse"');
    expect(html).toContain("Hold throttle");
    expect(html).toContain('data-race-action="gyro-toggle"');
    expect(html).toContain('data-race-action="gyro-recenter"');
    expect(html).toContain("Gyro steer off");
  });

  it("maps touch actions to the exact keyboard codes read by the race driver", () => {
    expect(mobileRallyControlKeyCode("throttle")).toBe("KeyW");
    expect(mobileRallyControlKeyCode("brake-reverse")).toBe("KeyS");
    expect(mobileRallyControlKeyCode("steer-left")).toBe("KeyA");
    expect(mobileRallyControlKeyCode("steer-right")).toBe("KeyD");
  });

  it("drives through the same race input shape as keyboard acceleration and braking", () => {
    let accelerated = stepRace(newRaceState(manualTrack()), {}, 3000);
    accelerated = stepRace(
      accelerated,
      {
        [mobileRallyControlKeyCode("throttle") === "KeyW"
          ? "accelerate"
          : "brake"]: true,
      },
      400,
    );
    expect(accelerated.car.speed).toBeGreaterThan(0);

    const braked = stepRace(accelerated, { brake: true }, 400);
    expect(braked.car.speed).toBeLessThan(accelerated.car.speed);
  });
});
