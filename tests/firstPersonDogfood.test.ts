import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { driveFirstPersonRouteDogfood } from "../src/colony/bot/firstPersonDogfood";

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("first-person route dogfood", () => {
  it("updates first-person yaw and clamps pitch from mouse-look deltas", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.enterFirstPerson(me.id);
    const before = rt.getUiState().firstPerson.view!.citizen.heading;

    expect(rt.applyFirstPersonMouseLook(20, -1000)).toBe(true);

    const ui = rt.getUiState();
    expect(ui.firstPerson.view!.citizen.heading).toBeGreaterThan(before);
    expect(ui.firstPerson.lookPitch).toBeGreaterThan(0);
    expect(ui.firstPerson.lookPitch).toBeLessThanOrEqual(0.9);

    expect(rt.applyFirstPersonMouseLook(0, 4000)).toBe(true);
    expect(rt.getUiState().firstPerson.lookPitch).toBeGreaterThanOrEqual(-0.9);
  });

  it("levels first-person mouse-look pitch without changing yaw", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.enterFirstPerson(me.id);
    rt.applyFirstPersonMouseLook(80, -120);
    const yawAfterLook = rt.getUiState().firstPerson.view!.citizen.heading;
    expect(rt.getUiState().firstPerson.lookPitch).toBeGreaterThan(0);

    expect(rt.levelFirstPersonLook()).toBe(true);

    const ui = rt.getUiState();
    expect(ui.firstPerson.lookPitch).toBe(0);
    expect(ui.firstPerson.view!.citizen.heading).toBeCloseTo(yawAfterLook, 5);
  });

  it("applies the selected first-person mouse sensitivity to yaw and pitch", () => {
    function mouseLookDelta(level: "low" | "normal" | "high") {
      const rt = new ColonyRuntime(4242);
      const me = rt.getUiState().citizens.list[0]!;
      rt.enterFirstPerson(me.id);
      expect(rt.setFirstPersonMouseSensitivity(level)).toBe(true);
      expect(rt.getUiState().firstPerson.mouseSensitivity).toBe(level);
      const before = rt.getUiState().firstPerson.view!.citizen.heading;

      expect(rt.applyFirstPersonMouseLook(40, -40)).toBe(true);

      const ui = rt.getUiState();
      return {
        yawDelta: ui.firstPerson.view!.citizen.heading - before,
        pitch: ui.firstPerson.lookPitch,
      };
    }

    const low = mouseLookDelta("low");
    const normal = mouseLookDelta("normal");
    const high = mouseLookDelta("high");

    expect(low.yawDelta).toBeGreaterThan(0);
    expect(low.yawDelta).toBeLessThan(normal.yawDelta);
    expect(normal.yawDelta).toBeLessThan(high.yawDelta);
    expect(low.pitch).toBeLessThan(normal.pitch);
    expect(normal.pitch).toBeLessThan(high.pitch);
  });

  it("reports when first-person walking is blocked by a completed building", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    const terrain = rt.sim.state.terrain;
    let cell: { x: number; y: number } | null = null;
    for (let y = 1; y < terrain.size - 1 && !cell; y++) {
      for (let x = 1; x < terrain.size - 2 && !cell; x++) {
        if (!terrain.isWater(x, y) && !terrain.isWater(x + 1, y)) cell = { x, y };
      }
    }
    if (!cell) throw new Error("test terrain needs adjacent land cells");
    rt.sim.state.buildings.push({
      id: 99001,
      x: cell.x + 1,
      y: cell.y,
      artifact: { kind: "habitat" },
    } as never);
    rt.enterFirstPerson(me.id);
    const start = { x: cell.x + 0.45, y: cell.y };
    expect(rt.placeFirstPersonDogfood(start, 0)).toBe(true);

    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.25);
    rt.setFpKey("KeyW", false);

    const ui = rt.getUiState();
    expect(ui.firstPerson.view!.citizen.positionXY).toEqual(start);
    expect(ui.firstPerson.blockedReason).toBe("building");
  });

  it("reports when first-person walking is blocked by a reserved parcel footprint", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    const terrain = rt.sim.state.terrain;
    let cell: { x: number; y: number } | null = null;
    for (let y = 1; y < terrain.size - 1 && !cell; y++) {
      for (let x = 1; x < terrain.size - 2 && !cell; x++) {
        if (
          !terrain.isWater(x, y) &&
          !terrain.isWater(x + 1, y) &&
          !rt.sim.state.roadSet.has(`${x + 1},${y}`)
        ) {
          cell = { x, y };
        }
      }
    }
    if (!cell) throw new Error("test terrain needs adjacent non-road land cells");
    rt.sim.state.occupied.add(`${cell.x + 1},${cell.y}`);
    rt.enterFirstPerson(me.id);
    const start = { x: cell.x + 0.45, y: cell.y };
    expect(rt.placeFirstPersonDogfood(start, 0)).toBe(true);

    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.25);
    rt.setFpKey("KeyW", false);

    const ui = rt.getUiState();
    expect(ui.firstPerson.view!.citizen.positionXY).toEqual(start);
    expect(ui.firstPerson.blockedReason).toBe("parcel");
  });

  it("walks faster on roads than off-road terrain", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    const terrain = rt.sim.state.terrain;
    const blocked = (x: number, y: number) => {
      const key = `${x},${y}`;
      return (
        terrain.isWater(x, y) ||
        rt.sim.state.buildings.some(
          (b) => Math.round(b.x) === x && Math.round(b.y) === y,
        ) ||
        (rt.sim.state.occupied.has(key) && !rt.sim.state.roadSet.has(key))
      );
    };
    let roadStart: { x: number; y: number } | null = null;
    for (const road of rt.sim.state.roads) {
      const x = Math.round(road.x);
      const y = Math.round(road.y);
      if (
        x > 0 &&
        x < terrain.size - 2 &&
        y > 0 &&
        y < terrain.size - 1 &&
        rt.sim.state.roadSet.has(`${x},${y}`) &&
        !blocked(x, y) &&
        !blocked(x + 1, y)
      ) {
        roadStart = { x, y };
        break;
      }
    }
    let offRoadStart: { x: number; y: number } | null = null;
    for (let y = 1; y < terrain.size - 1 && !offRoadStart; y++) {
      for (let x = 1; x < terrain.size - 2 && !offRoadStart; x++) {
        if (
          !rt.sim.state.roadSet.has(`${x},${y}`) &&
          !rt.sim.state.roadSet.has(`${x + 1},${y}`) &&
          !blocked(x, y) &&
          !blocked(x + 1, y)
        ) {
          offRoadStart = { x, y };
        }
      }
    }
    if (!roadStart || !offRoadStart) throw new Error("test terrain needs road and off-road lanes");

    rt.enterFirstPerson(me.id);
    expect(rt.placeFirstPersonDogfood(roadStart, 0)).toBe(true);
    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.3);
    rt.setFpKey("KeyW", false);
    const roadAfter = rt.getUiState().firstPerson.view!.citizen.positionXY;
    const roadDistance = distance(roadStart, roadAfter);

    expect(rt.placeFirstPersonDogfood(offRoadStart, 0)).toBe(true);
    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.3);
    rt.setFpKey("KeyW", false);
    const offRoadAfter = rt.getUiState().firstPerson.view!.citizen.positionXY;
    const offRoadDistance = distance(offRoadStart, offRoadAfter);

    expect(roadDistance).toBeGreaterThan(offRoadDistance * 1.1);
    expect(rt.getUiState().firstPerson.blockedReason).toBeNull();
  });

  it("reports when first-person walking is blocked by water", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    const terrain = rt.sim.state.terrain;
    let edge: { land: { x: number; y: number }; water: { x: number; y: number } } | null = null;
    for (let y = 1; y < terrain.size - 1 && !edge; y++) {
      for (let x = 1; x < terrain.size - 1 && !edge; x++) {
        if (terrain.isWater(x, y)) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const wx = x + dx;
          const wy = y + dy;
          if (terrain.isWater(wx, wy)) {
            edge = { land: { x, y }, water: { x: wx, y: wy } };
            break;
          }
        }
      }
    }
    if (!edge) throw new Error("test terrain needs a land/water boundary");
    rt.enterFirstPerson(me.id);
    expect(
      rt.placeFirstPersonDogfood(
        edge.land,
        Math.atan2(edge.water.y - edge.land.y, edge.water.x - edge.land.x),
      ),
    ).toBe(true);

    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(1);
    rt.setFpKey("KeyW", false);

    const ui = rt.getUiState();
    expect(ui.firstPerson.view!.ground.isWater).toBe(false);
    expect(ui.firstPerson.blockedReason).toBe("water");
  });

  it("activates the current first-person action prompt with immediate HUD feedback", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    const other = rt.getUiState().citizens.list.find((c) => c.id !== me.id);
    rt.enterFirstPerson(me.id);
    if (other) {
      expect(rt.placeFirstPersonDogfood({ x: other.homeXY.x + 1, y: other.homeXY.y }, 0)).toBe(true);
    }
    const prompt = rt.getUiState().firstPerson.view!.interactionPrompt;
    expect(prompt).toBeTruthy();
    expect(rt.getUiState().firstPerson.narration).toBeNull();

    expect(rt.activateFirstPersonInteraction()).toBe(true);

    const ui = rt.getUiState().firstPerson;
    expect(ui.narrating).toBe(false);
    expect(ui.narration).toContain(prompt!.targetName);
    expect(ui.narration).toMatch(/talk|visit|inspect|follow/i);
    expect(JSON.stringify({ prompt, narration: ui.narration })).not.toMatch(
      /wallet|token|secret|operator/i,
    );
  });

  it("starts a guided walk when activating a road prompt", () => {
    const rt = new ColonyRuntime(4242);
    rt.sim.state.buildings = [];
    const me = rt.getUiState().citizens.list[0]!;
    const publicCitizens = rt.getUiState().citizens.list;
    const road = rt.sim.state.roads.find((r) =>
      publicCitizens.every((c) => distance(c.homeXY, r) > 30),
    );
    if (!road) throw new Error("test terrain needs a road away from citizens");
    const start = { x: road.x + 1, y: road.y };

    rt.enterFirstPerson(me.id);
    expect(rt.placeFirstPersonDogfood(start, Math.PI)).toBe(true);
    const prompt = rt.getUiState().firstPerson.view!.interactionPrompt;
    expect(prompt?.kind).toBe("road");

    expect(rt.activateFirstPersonInteraction()).toBe(true);

    const ui = rt.getUiState().firstPerson;
    expect(ui.guidedTarget).toEqual({
      label: "road",
      x: Math.round(prompt!.targetXY.x),
      y: Math.round(prompt!.targetXY.y),
    });
    expect(ui.narration).toBe("Guiding you to road.");
    expect(JSON.stringify({ prompt, guidedTarget: ui.guidedTarget })).not.toMatch(
      /wallet|token|secret|operator/i,
    );
  });

  it("clears a guided walk when the player manually takes over movement", () => {
    const rt = new ColonyRuntime(4242);
    rt.sim.state.buildings = [];
    const me = rt.getUiState().citizens.list[0]!;
    const publicCitizens = rt.getUiState().citizens.list;
    const road = rt.sim.state.roads.find((r) =>
      publicCitizens.every((c) => distance(c.homeXY, r) > 30),
    );
    if (!road) throw new Error("test terrain needs a road away from citizens");

    rt.enterFirstPerson(me.id);
    expect(rt.placeFirstPersonDogfood({ x: road.x + 1, y: road.y }, Math.PI)).toBe(true);
    expect(rt.activateFirstPersonInteraction()).toBe(true);
    expect(rt.getUiState().firstPerson.guidedTarget).toBeTruthy();

    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.3);
    rt.setFpKey("KeyW", false);

    const ui = rt.getUiState().firstPerson;
    expect(ui.guidedTarget).toBeNull();
    expect(ui.narration).toBe("Guided walk canceled — manual control resumed.");
  });

  it("advances and clears a guided walk when the target is reached", () => {
    const rt = new ColonyRuntime(4242);
    rt.sim.state.buildings = [];
    const me = rt.getUiState().citizens.list[0]!;
    const publicCitizens = rt.getUiState().citizens.list;
    let start: { x: number; y: number } | null = null;
    let promptTarget: { x: number; y: number } | null = null;

    rt.enterFirstPerson(me.id);
    for (const candidateRoad of rt.sim.state.roads) {
      if (!publicCitizens.every((c) => distance(c.homeXY, candidateRoad) > 30)) continue;
      for (const offset of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        const candidate = { x: candidateRoad.x + offset.x, y: candidateRoad.y + offset.y };
        expect(rt.placeFirstPersonDogfood(candidate, Math.PI)).toBe(true);
        const prompt = rt.getUiState().firstPerson.view!.interactionPrompt;
        if (prompt?.kind === "road" && distance(candidate, prompt.targetXY) > 0.5) {
          start = candidate;
          promptTarget = prompt.targetXY;
          break;
        }
      }
      if (start) break;
    }
    if (!start || !promptTarget) {
      throw new Error("test terrain needs a nearby road target away from the start cell");
    }

    expect(rt.activateFirstPersonInteraction()).toBe(true);
    const target = rt.getUiState().firstPerson.guidedTarget!;
    expect(target).toEqual({
      label: "road",
      x: Math.round(promptTarget.x),
      y: Math.round(promptTarget.y),
    });

    rt.stepFirstPersonDogfood(0.5);
    const movingUi = rt.getUiState().firstPerson;
    expect(distance(movingUi.view!.citizen.positionXY, target)).toBeLessThan(
      distance(start, target),
    );
    expect(movingUi.guidedTarget).toEqual(target);

    rt.stepFirstPersonDogfood(2);
    const arrivedUi = rt.getUiState().firstPerson;
    expect(distance(arrivedUi.view!.citizen.positionXY, target)).toBeLessThan(
      COLONY.firstPerson.guidedArrivalDistance,
    );
    expect(arrivedUi.guidedTarget).toBeNull();
    expect(arrivedUi.narration).toBe("Arrived at road.");
  });

  it.each([
    { kind: "civic", artifactKind: "market" },
    { kind: "building", artifactKind: "habitat" },
  ] as const)(
    "starts a guided walk when activating a $kind prompt",
    ({ kind, artifactKind }) => {
      const rt = new ColonyRuntime(4242);
      rt.sim.state.buildings = [
        {
          id: 9901,
          x: 128,
          y: 128,
          artifact: { kind: artifactKind },
        } as never,
      ];
      const me = rt.getUiState().citizens.list[0]!;

      rt.enterFirstPerson(me.id);
      expect(rt.placeFirstPersonDogfood({ x: 127, y: 128 }, 0)).toBe(true);
      const prompt = rt.getUiState().firstPerson.view!.interactionPrompt;
      expect(prompt?.kind).toBe(kind);

      expect(rt.activateFirstPersonInteraction()).toBe(true);

      const ui = rt.getUiState().firstPerson;
      expect(ui.guidedTarget).toEqual({
        label: prompt!.targetName,
        x: Math.round(prompt!.targetXY.x),
        y: Math.round(prompt!.targetXY.y),
      });
      expect(ui.narration).toBe(`Guiding you to ${prompt!.targetName}.`);
      expect(JSON.stringify({ prompt, guidedTarget: ui.guidedTarget })).not.toMatch(
        /wallet|token|secret|operator/i,
      );
    },
  );

  it("captures deterministic first-person demo evidence for screenshot automation", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.enterFirstPerson(me.id);
    rt.applyFirstPersonMouseLook(12, -6);
    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.25);
    rt.setFpKey("KeyW", false);

    const capture = rt.captureFirstPersonDemo();

    expect(capture).toBeTruthy();
    expect(capture!.pngDataUrl).toBeNull();
    expect(capture!.evidence.citizenId).toBe(me.id);
    expect(capture!.evidence.citizenName).toBe(me.displayName);
    expect(capture!.evidence.position.x).toBeTypeOf("number");
    expect(capture!.evidence.position.y).toBeTypeOf("number");
    expect(capture!.evidence.heading).toBeGreaterThan(0);
    expect(capture!.evidence.lookPitch).toBeGreaterThan(0);
    expect(capture!.evidence.hudLines).toContain(
      capture!.evidence.action ?? "No nearby action",
    );
    expect(JSON.stringify(capture!.evidence)).not.toMatch(/wallet|token|secret|operator/i);
  });

  it("accepts browser KeyboardEvent.code movement names directly", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.enterFirstPerson(me.id);
    const before = rt.getUiState().firstPerson.view!.citizen.positionXY;

    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.25);
    rt.setFpKey("KeyW", false);

    const after = rt.getUiState().firstPerson.view!.citizen.positionXY;
    expect(distance(before, after)).toBeGreaterThan(0.1);
  });

  it("ramps movement speed up and coasts down after release", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;

    const run = driveFirstPersonRouteDogfood(rt, me.id, [
      { label: "start walking", keys: ["w"], seconds: 0.2 },
      { label: "release and coast", keys: [], seconds: 0.2 },
    ]);

    const startDistance = distance(
      run.samples[0]!.before.position,
      run.samples[0]!.after.position,
    );
    const coastDistance = distance(
      run.samples[1]!.before.position,
      run.samples[1]!.after.position,
    );

    expect(startDistance).toBeGreaterThan(0.05);
    expect(startDistance).toBeLessThan(0.68);
    expect(coastDistance).toBeGreaterThan(0.05);
    expect(coastDistance).toBeLessThan(startDistance);
  });

  it("brakes quickly when forward and back are held together", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.enterFirstPerson(me.id);
    const start = rt.getUiState().firstPerson.view!.citizen.positionXY;

    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.3);
    const afterForward = rt.getUiState().firstPerson.view!.citizen.positionXY;
    const poweredDistance = distance(start, afterForward);

    rt.setFpKey("KeyS", true);
    rt.stepFirstPersonDogfood(0.2);
    rt.setFpKey("KeyW", false);
    rt.setFpKey("KeyS", false);
    const afterConflict = rt.getUiState().firstPerson.view!.citizen.positionXY;
    const conflictDistance = distance(afterForward, afterConflict);

    expect(poweredDistance).toBeGreaterThan(0.5);
    expect(conflictDistance).toBeLessThan(poweredDistance * 0.1);
  });

  it("walks farther while Shift sprint is held and returns to normal after release", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    const terrain = rt.sim.state.terrain;
    const blocked = (x: number, y: number) => {
      const key = `${x},${y}`;
      return (
        terrain.isWater(x, y) ||
        rt.sim.state.buildings.some(
          (b) => Math.round(b.x) === x && Math.round(b.y) === y,
        ) ||
        (rt.sim.state.occupied.has(key) && !rt.sim.state.roadSet.has(key))
      );
    };
    let start: { x: number; y: number } | null = null;
    for (const road of rt.sim.state.roads) {
      const x = Math.round(road.x);
      const y = Math.round(road.y);
      if (
        x > 1 &&
        x < terrain.size - 8 &&
        y > 1 &&
        y < terrain.size - 1 &&
        !blocked(x, y) &&
        !blocked(x + 1, y) &&
        !blocked(x + 2, y) &&
        !blocked(x + 3, y) &&
        !blocked(x + 4, y)
      ) {
        start = { x, y };
        break;
      }
    }
    if (!start) throw new Error("test terrain needs a clear sprint lane");

    rt.enterFirstPerson(me.id);
    expect(rt.placeFirstPersonDogfood(start, 0)).toBe(true);
    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.35);
    rt.setFpKey("KeyW", false);
    const walkAfter = rt.getUiState().firstPerson.view!.citizen.positionXY;
    const walkDistance = distance(start, walkAfter);

    expect(rt.placeFirstPersonDogfood(start, 0)).toBe(true);
    rt.setFpKey("ShiftLeft", true);
    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.35);
    rt.setFpKey("KeyW", false);
    rt.setFpKey("ShiftLeft", false);
    const sprintAfter = rt.getUiState().firstPerson.view!.citizen.positionXY;
    const sprintDistance = distance(start, sprintAfter);

    expect(rt.placeFirstPersonDogfood(start, 0)).toBe(true);
    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.35);
    rt.setFpKey("KeyW", false);
    const walkAfterSprintRelease = rt.getUiState().firstPerson.view!.citizen.positionXY;
    const releasedDistance = distance(start, walkAfterSprintRelease);

    expect(sprintDistance).toBeGreaterThan(walkDistance * 1.2);
    expect(releasedDistance).toBeCloseTo(walkDistance, 5);
  });

  it("limits sustained sprint with a recoverable comfort charge", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    const terrain = rt.sim.state.terrain;
    const blocked = (x: number, y: number) => {
      const key = `${x},${y}`;
      return (
        terrain.isWater(x, y) ||
        rt.sim.state.buildings.some(
          (b) => Math.round(b.x) === x && Math.round(b.y) === y,
        ) ||
        (rt.sim.state.occupied.has(key) && !rt.sim.state.roadSet.has(key))
      );
    };
    let start: { x: number; y: number } | null = null;
    for (const road of rt.sim.state.roads) {
      const x = Math.round(road.x);
      const y = Math.round(road.y);
      if (
        x > 1 &&
        x < terrain.size - 16 &&
        y > 1 &&
        y < terrain.size - 1 &&
        Array.from({ length: 14 }, (_, i) => i).every((i) => !blocked(x + i, y))
      ) {
        start = { x, y };
        break;
      }
    }
    if (!start) throw new Error("test terrain needs a long clear sprint lane");

    rt.enterFirstPerson(me.id);
    expect(rt.placeFirstPersonDogfood(start, 0)).toBe(true);
    expect(rt.getUiState().firstPerson.sprintCharge).toBe(100);

    rt.setFpKey("ShiftLeft", true);
    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(3.25);
    const exhaustedUi = rt.getUiState().firstPerson;
    const exhaustedPos = exhaustedUi.view!.citizen.positionXY;
    expect(exhaustedUi.sprintCharge).toBe(0);

    rt.stepFirstPersonDogfood(0.35);
    const exhaustedStepDistance = distance(
      exhaustedPos,
      rt.getUiState().firstPerson.view!.citizen.positionXY,
    );

    rt.setFpKey("ShiftLeft", false);
    rt.stepFirstPersonDogfood(1);
    const recoveredUi = rt.getUiState().firstPerson;
    expect(recoveredUi.sprintCharge).toBeGreaterThan(0);

    rt.setFpKey("ShiftLeft", true);
    rt.stepFirstPersonDogfood(0.35);
    const recoveredSprintDistance = distance(
      recoveredUi.view!.citizen.positionXY,
      rt.getUiState().firstPerson.view!.citizen.positionXY,
    );

    rt.setFpKey("KeyW", false);
    rt.setFpKey("ShiftLeft", false);
    rt.stepFirstPersonDogfood(3);
    expect(rt.getUiState().firstPerson.sprintCharge).toBeGreaterThan(50);

    expect(recoveredSprintDistance).toBeGreaterThan(exhaustedStepDistance * 1.15);
  });

  it("does not carry held movement keys across first-person citizen switches", () => {
    const rt = new ColonyRuntime(4242);
    const [first, second] = rt.getUiState().citizens.list;
    if (!first || !second) throw new Error("test colony needs two citizens");

    expect(rt.enterFirstPerson(first.id)).toBe(true);
    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.3);
    const firstAfterMove = rt.getUiState().firstPerson.view!.citizen.positionXY;

    expect(rt.enterFirstPerson(second.id)).toBe(true);
    const secondBeforeStep = rt.getUiState().firstPerson.view!.citizen.positionXY;
    rt.stepFirstPersonDogfood(0.3);
    const secondAfterStep = rt.getUiState().firstPerson.view!.citizen.positionXY;

    expect(distance(firstAfterMove, secondBeforeStep)).toBeGreaterThan(1);
    expect(secondAfterStep).toEqual(secondBeforeStep);
  });

  it("normalizes diagonal WASD strafing without yawing the camera", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    const terrain = rt.sim.state.terrain;
    const blocked = (x: number, y: number) => {
      const key = `${x},${y}`;
      return (
        terrain.isWater(x, y) ||
        rt.sim.state.buildings.some(
          (b) => Math.round(b.x) === x && Math.round(b.y) === y,
        ) ||
        (rt.sim.state.occupied.has(key) && !rt.sim.state.roadSet.has(key))
      );
    };
    let start: { x: number; y: number } | null = null;
    for (let y = 1; y < terrain.size - 2 && !start; y++) {
      for (let x = 1; x < terrain.size - 2 && !start; x++) {
        if (!blocked(x, y) && !blocked(x + 1, y) && !blocked(x, y + 1) && !blocked(x + 1, y + 1)) {
          start = { x, y };
        }
      }
    }
    if (!start) throw new Error("test terrain needs an open 2x2 walking patch");

    rt.enterFirstPerson(me.id);
    expect(rt.placeFirstPersonDogfood(start, 0)).toBe(true);
    rt.setFpKey("KeyW", true);
    rt.stepFirstPersonDogfood(0.3);
    rt.setFpKey("KeyW", false);
    const forwardAfter = rt.getUiState().firstPerson.view!.citizen.positionXY;
    const forwardDistance = distance(start, forwardAfter);

    expect(rt.placeFirstPersonDogfood(start, 0)).toBe(true);
    rt.setFpKey("KeyW", true);
    rt.setFpKey("KeyD", true);
    rt.stepFirstPersonDogfood(0.3);
    rt.setFpKey("KeyW", false);
    rt.setFpKey("KeyD", false);
    const diagonalUi = rt.getUiState().firstPerson;
    const diagonalAfter = diagonalUi.view!.citizen.positionXY;
    const diagonalDistance = distance(start, diagonalAfter);

    expect(diagonalAfter.x).toBeGreaterThan(start.x);
    expect(diagonalAfter.y).toBeGreaterThan(start.y);
    expect(diagonalDistance).toBeCloseTo(forwardDistance, 5);
    expect(diagonalUi.view!.citizen.heading).toBeCloseTo(0, 5);
    expect(diagonalUi.blockedReason).toBeNull();
  });

  it("walks a deterministic route and samples live view position plus heading", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;

    const run = driveFirstPersonRouteDogfood(rt, me.id, [
      { label: "walk forward", keys: ["w"], seconds: 0.5 },
      { label: "turn right", keys: ["ArrowRight"], seconds: 0.5 },
      { label: "back up", keys: ["s"], seconds: 0.25 },
    ]);

    expect(run.citizenId).toBe(me.id);
    expect(run.samples).toHaveLength(3);
    expect(run.samples[0]!.label).toBe("walk forward");
    expect(distance(run.samples[0]!.before.position, run.samples[0]!.after.position)).toBeGreaterThan(0.5);
    expect(run.samples[1]!.after.heading).toBeGreaterThan(run.samples[1]!.before.heading);
    expect(distance(run.samples[2]!.before.position, run.samples[2]!.after.position)).toBeGreaterThan(0.2);

    for (const sample of run.samples) {
      expect(sample.after.viewPosition.x).toBeCloseTo(sample.after.position.x, 5);
      expect(sample.after.viewPosition.y).toBeCloseTo(sample.after.position.y, 5);
      expect(sample.after.viewHeading).toBeCloseTo(sample.after.heading, 5);
    }
  });
});
