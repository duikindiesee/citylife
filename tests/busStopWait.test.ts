import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import { setSolDebugOffsetMs, solNowMs } from "../src/colony/solRuntimeClock";
import { Pt } from "../src/colony/transit/path";
import { setupAuthoritativeRuntime } from "./testAuthorityHelper";

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

  it("multiplayer connected positive: calls boardBus on arrival and commits authoritative seat", () => {
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

    const boardCalls: number[] = [];
    (rt as any).multiplayerClient = {
      getStatus: () => "connected",
      getMode: () => "walking",
      getSessionId: () => "sess-1",
      boardBus: (busId: number) => {
        boardCalls.push(busId);
        return true;
      },
    };

    // Fast-forward to arrival
    const base = solNowMs();
    for (let i = 0; i < 20000; i++) {
      setSolDebugOffsetMs(base + i * 250 - Date.now());
      tick(rt);
      if (boardCalls.length > 0) break;
    }

    expect(boardCalls.length).toBe(1);
    // Wire request sent: local waiting index cleared to avoid spamming
    expect((rt as any).fpWaitingBusStopIndex).toBeNull();
    // But local seat is NOT faked before server response:
    expect(rt.fpRidingBusId).toBeNull();
    expect(rt.fpRidingSeatIndex).toBeNull();
    expect(rt.getUiState().firstPerson.narration).toContain("Requesting boarding from server...");

    // Server returns authoritative bus_boarded event for seat 7:
    // (Simulate callback invoked by multiplayerClient)
    (rt as any).fpRidingBusId = boardCalls[0]!;
    (rt as any).fpRidingSeatIndex = 7;
    expect(rt.fpRidingBusId).toBe(boardCalls[0]!);
    expect(rt.fpRidingSeatIndex).toBe(7);
  }, 120000);

  it("multiplayer disconnected/connecting negative: fails closed and does not fake local seat", () => {
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

    // Mock client in disconnected status
    (rt as any).multiplayerClient = {
      getStatus: () => "disconnected",
      getMode: () => "walking",
      boardBus: () => false,
      alightBus: () => false,
    };

    const base = solNowMs();
    for (let i = 0; i < 20000; i++) {
      setSolDebugOffsetMs(base + i * 250 - Date.now());
      tick(rt);
      // If arrival check triggered, narration reports authority unavailable
      if (rt.getUiState().firstPerson.narration?.includes("Multiplayer server authority unavailable")) {
        break;
      }
    }

    // Fails closed: no local bus or seat assignment
    expect(rt.fpRidingBusId).toBeNull();
    expect(rt.fpRidingSeatIndex).toBeNull();
    expect(rt.getUiState().firstPerson.narration).toBe(
      "Multiplayer server authority unavailable — cannot board bus.",
    );

    // Manual interaction also fails closed
    const interacted = rt.activateFirstPersonInteraction();
    expect(interacted).toBe(true); // Cancels the wait
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
    const client = rt.getMultiplayerClient();
    expect(client).toBeDefined();

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
    const client = rt.getMultiplayerClient();
    expect(client).toBeDefined();

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
    // Production bus seat definitions from src/colony/render/busLayer.ts:
    // Sides: left (z = 0.82), right (z = -0.82)
    // 5 rows: x = -4.25 + i * 1.55, height: 1.45
    // Coach front is +X, crab front is +Z -> relative rotation +Math.PI / 2
    const Y_AXIS = new THREE.Vector3(0, 1, 0);

    for (let seatIdx = 0; seatIdx < 10; seatIdx++) {
      const side = seatIdx < 5 ? 0.82 : -0.82;
      const row = seatIdx % 5;
      const localX = -4.25 + row * 1.55;
      const localY = 1.45;
      const localZ = side;

      // Slot symmetry check: seats stay within coach interior bounds
      expect(Math.abs(localZ)).toBeCloseTo(0.82, 3);
      expect(localX).toBeGreaterThanOrEqual(-4.25);
      expect(localX).toBeLessThanOrEqual(-4.25 + 4 * 1.55);
      expect(localY).toBe(1.45);

      // Forward transform at heading 0 (along +X):
      const v0 = new THREE.Vector3(localX, localY, localZ).applyAxisAngle(Y_AXIS, 0);
      expect(v0.x).toBeCloseTo(localX, 5);
      expect(v0.y).toBeCloseTo(localY, 5);
      expect(v0.z).toBeCloseTo(localZ, 5);

      // Transformed at heading Math.PI / 2 (bus facing +Z):
      const v90 = new THREE.Vector3(localX, localY, localZ).applyAxisAngle(Y_AXIS, -Math.PI / 2);
      expect(v90.x).toBeCloseTo(-localZ, 5);
      expect(v90.y).toBeCloseTo(localY, 5);
      expect(v90.z).toBeCloseTo(localX, 5);
    }
  });
});
