import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import { setSolDebugOffsetMs, solNowMs } from "../src/colony/solRuntimeClock";
import { Pt } from "../src/colony/transit/path";
import { setupAuthoritativeRuntime } from "./testAuthorityHelper";
import {
  PASSENGER_SEAT_LOCAL_SLOTS,
  computeSeatedCrabWorldPose,
} from "../src/colony/render/R3FRemoteRacers";

type TransitDriver = { transitTick: () => void };
const tick = (rt: ColonyRuntime) =>
  (rt as unknown as TransitDriver).transitTick();

afterEach(() => setSolDebugOffsetMs(0));

describe("BUS.BOARD.PLAYER.1 & BUS.STOP.WAIT.1 — stop pole card and waiting lifecycle", () => {
  it("surfaces stop card and wait prompt when standing near stop pole furniture without dwelling bus", () => {
    const rt = new ColonyRuntime();
    rt.setPlayerView(false);
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);

    const anchors = rt.busStopAnchors();
    expect(anchors.length).toBeGreaterThan(0);
    const stop0 = anchors[0]!;

    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    expect(ids.length).toBeGreaterThan(0);
    expect(rt.enterFirstPerson(ids[0]!)).toBe(true);

    // Place player at the furniture pole of stop 0
    rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
    tick(rt);

    const fp = rt.getUiState().firstPerson;
    expect(fp.busStop).not.toBeNull();
    expect(fp.busStop?.isNearPole).toBe(true);
    expect(fp.busStop?.stopIndex).toBe(0);
    expect(fp.busStop?.isWaiting).toBe(false);

    // No dwelling bus at initial tick -> canBoard is false with explicit reason
    if (!fp.busStop?.canBoard) {
      expect(fp.busStop?.boardUnavailableReason).toBe("No bus currently at stop");
      expect(fp.view?.interactionPrompt?.label).toBe("Wait for next bus");
    }
  });

  it("queues next bus wait and updates interaction prompt to Cancel wait", () => {
    const rt = new ColonyRuntime();
    rt.setPlayerView(false);
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);

    const anchors = rt.busStopAnchors();
    const stop0 = anchors[0]!;
    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    rt.enterFirstPerson(ids[0]!);

    rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
    tick(rt);

    // Queue wait
    rt.queueNextBus(0);

    const fp = rt.getUiState().firstPerson;
    expect(fp.busStop?.isWaiting).toBe(true);
    expect(fp.view?.interactionPrompt?.label).toBe("Cancel wait");

    // Cancel wait
    rt.cancelBusWait();
    const fpCancelled = rt.getUiState().firstPerson;
    expect(fpCancelled.busStop?.isWaiting).toBe(false);
    expect(fpCancelled.view?.interactionPrompt?.label).toBe("Wait for next bus");
  });

  it("automatically cancels wait if player walks > 4.5 cells away from stop pole", () => {
    const rt = new ColonyRuntime();
    rt.setPlayerView(false);
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);

    const anchors = rt.busStopAnchors();
    const stop0 = anchors[0]!;
    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    rt.enterFirstPerson(ids[0]!);

    rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
    rt.queueNextBus(0);
    expect(rt.getUiState().firstPerson.busStop?.isWaiting).toBe(true);

    // Step away > 4.5 cells from stop0 furniture along verge direction away from road
    rt.debugPlaceFirstPerson(
      stop0.furniture.x + stop0.verge.x * 6.0,
      stop0.furniture.y + stop0.verge.y * 6.0,
    );
    tick(rt);

    const fpFar = rt.getUiState().firstPerson;
    expect(fpFar.busStop).toBeNull();
    // Re-approaching shows waiting was cancelled
    rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
    tick(rt);
    expect(rt.getUiState().firstPerson.busStop?.isWaiting).toBe(false);
  });

  it("automatically boards player when dwelling bus arrives at stop while waiting", () => {
    const rt = new ColonyRuntime();
    rt.setPlayerView(false);
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);

    const anyRt = rt as unknown as {
      busRoute: { loop: Pt[]; stops: Pt[] };
      busFleet: { buses: { id: number; mode: string; dwell: number }[] };
    };
    const anchors = rt.busStopAnchors();
    const stop0 = anchors[0]!;
    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    rt.enterFirstPerson(ids[0]!);

    // Place at stop 0 and queue wait
    rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
    rt.queueNextBus(0);
    expect(rt.getUiState().firstPerson.busStop?.isWaiting).toBe(true);
    expect(rt.fpRidingBusId).toBeNull();

    // Advance sol clock until a service bus dwells at stop 0
    const base = solNowMs();
    let autoBoarded = false;
    for (let i = 0; i < 20000; i++) {
      setSolDebugOffsetMs(base + i * 250 - Date.now());
      tick(rt);

      if (rt.fpRidingBusId !== null) {
        autoBoarded = true;
        break;
      }
    }

    expect(autoBoarded).toBe(true);
    expect(rt.fpRidingBusId).not.toBeNull();
    // Wait is cleared once boarded
    expect(rt.getUiState().firstPerson.busStop).toBeNull();
  }, 120000);

  it("clears waiting state on exitFirstPerson", () => {
    const rt = new ColonyRuntime();
    rt.setPlayerView(false);
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);

    const anchors = rt.busStopAnchors();
    const stop0 = anchors[0]!;
    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    rt.enterFirstPerson(ids[0]!);

    rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
    rt.queueNextBus(0);
    expect(rt.getUiState().firstPerson.busStop?.isWaiting).toBe(true);

    rt.exitFirstPerson();
    expect(rt.getUiState().firstPerson.active).toBe(false);

    // Re-entering first person has no stale wait
    rt.enterFirstPerson(ids[0]!);
    rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
    tick(rt);
    expect(rt.getUiState().firstPerson.busStop?.isWaiting).toBe(false);
  });

  it("multiplayer connected positive: feeds valid bus_boarded through registered callback to commit authoritative seat and UI", () => {
    const rt = new ColonyRuntime();
    rt.setPlayerView(false);
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);

    const anchors = rt.busStopAnchors();
    const stop0 = anchors[0]!;
    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    rt.enterFirstPerson(ids[0]!);

    rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
    rt.queueNextBus(0);

    setupAuthoritativeRuntime(rt, { userId: "operator@test.com" });
    rt.enableMultiplayer("room-1", "ws://synthetic.citylife.invalid/ws");
    const client = rt.getMultiplayerClient()!;

    // Set connected status and state on real client
    (client as any).status = "connected";
    (client as any).currentMode = "walking";
    (client as any).sessionId = "sess-1";
    (client as any).participantId = "part-1";
    (client as any).modeEpoch = 1;

    const sentMessages: any[] = [];
    (client as any).send = (msg: any) => {
      sentMessages.push(msg);
      return true;
    };

    // Advance to bus arrival
    const base = solNowMs();
    let dwellingBusId: number | null = null;
    for (let i = 0; i < 20000; i++) {
      setSolDebugOffsetMs(base + i * 250 - Date.now());
      tick(rt);
      if (sentMessages.length > 0) {
        dwellingBusId = sentMessages[0].busId;
        break;
      }
    }

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toMatchObject({
      type: "request_board_bus",
      busId: dwellingBusId,
      epoch: 1,
    });
    // Wire request sent: local waiting intent cleared so requests do not repeat
    expect((rt as any).fpWaitingBusStopIndex).toBeNull();
    // Local seat NOT assumed before server response
    expect(rt.fpRidingBusId).toBeNull();
    expect(rt.fpRidingSeatIndex).toBeNull();
    expect(rt.getUiState().firstPerson.narration).toContain("Requesting boarding from server...");

    // Feed authoritative bus_boarded event through registered client callback
    (client as any).options.onBusBoarded?.({ busId: dwellingBusId!, seatIndex: 7 });

    // Assert resulting UI, authoritative seat, and pose
    expect(rt.fpRidingBusId).toBe(dwellingBusId);
    expect(rt.fpRidingSeatIndex).toBe(7);
    expect(rt.getUiState().firstPerson.narration).toBe(
      `You board Bus ${dwellingBusId! + 1}. Press E at any stop to step off.`,
    );
    expect(rt.getUiState().firstPerson.busStop).toBeNull();
  }, 120000);

  it("multiplayer connecting & disconnected negatives: fail closed without mutating local seat", () => {
    const rt = new ColonyRuntime();
    rt.setPlayerView(false);
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);

    const anchors = rt.busStopAnchors();
    const stop0 = anchors[0]!;
    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    rt.enterFirstPerson(ids[0]!);

    setupAuthoritativeRuntime(rt, { userId: "operator@test.com" });
    rt.enableMultiplayer("room-1", "ws://synthetic.citylife.invalid/ws");
    const client = rt.getMultiplayerClient()!;

    // 1. Genuinely CONNECTING status
    (client as any).status = "connecting";
    rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
    rt.queueNextBus(0);

    const base = solNowMs();
    for (let i = 0; i < 20000; i++) {
      setSolDebugOffsetMs(base + i * 250 - Date.now());
      tick(rt);
      if (rt.getUiState().firstPerson.narration?.includes("Multiplayer server authority unavailable")) {
        break;
      }
    }
    expect(rt.fpRidingBusId).toBeNull();
    expect(rt.fpRidingSeatIndex).toBeNull();
    expect(rt.getUiState().firstPerson.narration).toBe(
      "Multiplayer server authority unavailable — cannot board bus.",
    );

    // 2. DISCONNECTED status
    (client as any).status = "disconnected";
    rt.cancelBusWait();
    rt.queueNextBus(0);

    for (let i = 0; i < 20000; i++) {
      setSolDebugOffsetMs(base + (20000 + i) * 250 - Date.now());
      tick(rt);
      if (rt.getUiState().firstPerson.narration?.includes("Multiplayer server authority unavailable")) {
        break;
      }
    }
    expect(rt.fpRidingBusId).toBeNull();
    expect(rt.fpRidingSeatIndex).toBeNull();
    expect(rt.getUiState().firstPerson.narration).toBe(
      "Multiplayer server authority unavailable — cannot board bus.",
    );
  }, 120000);

  it("cancellation before arrival: cancelBusWait clears intent so arriving bus does not board", () => {
    const rt = new ColonyRuntime();
    rt.setPlayerView(false);
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);

    const anchors = rt.busStopAnchors();
    const stop0 = anchors[0]!;
    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    rt.enterFirstPerson(ids[0]!);

    rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
    rt.queueNextBus(0);
    expect(rt.getUiState().firstPerson.busStop?.isWaiting).toBe(true);

    // Cancel wait before bus arrives
    rt.cancelBusWait();
    expect(rt.getUiState().firstPerson.busStop?.isWaiting).toBe(false);

    // Advance clock across dwelling service buses
    const base = solNowMs();
    for (let i = 0; i < 20000; i++) {
      setSolDebugOffsetMs(base + i * 250 - Date.now());
      tick(rt);
      // Wait was cancelled, so player never auto-boards
      expect(rt.fpRidingBusId).toBeNull();
    }
    expect(rt.fpRidingBusId).toBeNull();
  }, 120000);

  it("multiplayer error rejection displays capacity / range failure reasons cleanly", () => {
    const rt = new ColonyRuntime();
    rt.setPlayerView(false);
    tick(rt);

    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    rt.enterFirstPerson(ids[0]!);

    // Initialize authoritative multiplayer setup
    setupAuthoritativeRuntime(rt, { userId: "operator@test.com" });
    rt.enableMultiplayer("room-1", "ws://synthetic.citylife.invalid/ws");
    const client = rt.getMultiplayerClient()!;

    // 1. BUS_FULL rejection
    (client as any).options.onError?.({ code: "BUS_FULL", message: "Bus is at full capacity" });
    expect(rt.getUiState().firstPerson.narration).toBe("Bus is at full capacity");
    expect(rt.fpRidingBusId).toBeNull();
    expect(rt.fpRidingSeatIndex).toBeNull();

    // 2. OUT_OF_BOARDING_RANGE rejection
    (client as any).options.onError?.({
      code: "OUT_OF_BOARDING_RANGE",
      message: "Cannot board bus: pedestrian distance exceeds maximum boarding range (12.0m)",
    });
    expect(rt.getUiState().firstPerson.narration).toBe(
      "Cannot board bus: pedestrian distance exceeds maximum boarding range (12.0m)",
    );

    // 3. EPOCH_MISMATCH rejection
    (client as any).options.onError?.({
      code: "EPOCH_MISMATCH",
      message: "Board bus epoch does not match active modeEpoch",
    });
    expect(rt.getUiState().firstPerson.narration).toBe(
      "Board bus epoch does not match active modeEpoch",
    );
  });

  it("stale-session cleanup: clears waiting stop intent on disconnect or fresh session", () => {
    const rt = new ColonyRuntime();
    rt.setPlayerView(false);
    tick(rt);

    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    rt.enterFirstPerson(ids[0]!);

    setupAuthoritativeRuntime(rt, { userId: "operator@test.com" });
    rt.enableMultiplayer("room-1", "ws://synthetic.citylife.invalid/ws");
    const client = rt.getMultiplayerClient()!;

    // Player starts waiting at stop 1
    (rt as any).fpWaitingBusStopIndex = 1;

    // Disconnect event fires
    (client as any).options.onStatusChange?.("disconnected");
    expect((rt as any).fpWaitingBusStopIndex).toBeNull();

    // Re-set waiting, then simulate fresh session
    (rt as any).fpWaitingBusStopIndex = 2;
    (client as any).options.onSessionReady?.("sess-2", "inv-2", "part-2");
    expect((rt as any).fpWaitingBusStopIndex).toBeNull();
  });

  it("seated crab transform matches production bus renderer coordinates and seat slots", () => {
    // Shared production passenger seat slots exported from R3FRemoteRacers.tsx
    expect(PASSENGER_SEAT_LOCAL_SLOTS.length).toBe(10);

    const terrainSize = 256;
    const roadElevation = 1.2;
    const heading = 0.62; // Nonzero heading (~35.5 degrees)

    // Two successive positions along the route
    const busPose1 = { x: 120, y: 280, heading };
    const busPose2 = { x: 125, y: 285, heading };

    // Test distinct seats across both sides and front/back rows:
    // Seat 0 (row 0, left side z=+0.82)
    // Seat 4 (row 4, left side z=+0.82)
    // Seat 5 (row 0, right side z=-0.82)
    // Seat 9 (row 4, right side z=-0.82)
    for (const seatIdx of [0, 4, 5, 9]) {
      const p1 = computeSeatedCrabWorldPose(busPose1, seatIdx, terrainSize, roadElevation);
      const p2 = computeSeatedCrabWorldPose(busPose2, seatIdx, terrainSize, roadElevation);

      // 1. Successive position displacement equals bus movement: (125-120)*4=20m X, (285-280)*4=20m Z
      expect(p2.x - p1.x).toBeCloseTo(20.0, 5);
      expect(p2.z - p1.z).toBeCloseTo(20.0, 5);
      expect(p2.y).toBeCloseTo(p1.y, 5);

      // 2. Facing orientation aligns crab FRONT (+Z) with bus forward (+X) at nonzero heading
      expect(p1.rotationY).toBeCloseTo(-heading + Math.PI / 2, 5);
      expect(p2.rotationY).toBeCloseTo(-heading + Math.PI / 2, 5);

      // 3. Local coordinate check: matches busLayer.ts interior seat positions
      const slot = PASSENGER_SEAT_LOCAL_SLOTS[seatIdx]!;
      const expectedSide = seatIdx < 5 ? 0.82 : -0.82;
      const expectedRow = seatIdx % 5;
      expect(slot.z).toBeCloseTo(expectedSide, 5);
      expect(slot.x).toBeCloseTo(-4.25 + expectedRow * 1.55, 5);
      expect(slot.y).toBe(1.68);

      // 4. DELIBERATE NEGATIVE CONTROL: omitting the bus coach rotation (-heading) drifts from interior
      const unrotatedX = (busPose1.x - terrainSize / 2) * 4 + slot.x;
      const unrotatedZ = (busPose1.y - terrainSize / 2) * 4 + slot.z;
      const drift = Math.hypot(p1.x - unrotatedX, p1.z - unrotatedZ);
      expect(drift, "omitting bus rotation causes substantial drift").toBeGreaterThan(1.0);
    }
  });
});
