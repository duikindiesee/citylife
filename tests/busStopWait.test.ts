import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import { CITYLIFE_EPOCH_MS } from "../src/colony/sol";
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

afterEach(() => {
  setSolDebugOffsetMs(0);
  vi.useRealTimers();
});

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
    // Wire request sent: local waiting intent remains pending until authoritative confirmation, preventing repeat requests
    expect((rt as any).fpWaitingBusStopIndex).toBe(0);
    expect((rt as any).fpWaitingBoardingPending).toBe(true);
    // Local seat NOT assumed before server response
    expect(rt.fpRidingBusId).toBeNull();
    expect(rt.fpRidingSeatIndex).toBeNull();
    expect(rt.getUiState().firstPerson.narration).toContain("Requesting boarding from server...");

    // Additional tick while pending does not duplicate request
    tick(rt);
    expect(sentMessages.length).toBe(1);

    // Feed authoritative bus_boarded event through registered client callback
    (client as any).options.onBusBoarded?.({ busId: dwellingBusId!, seatIndex: 7 });

    // Assert resulting UI, authoritative seat, and pose
    expect((rt as any).fpWaitingBusStopIndex).toBeNull();
    expect((rt as any).fpWaitingBoardingPending).toBe(false);
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

  it("BUS.STOP.WAIT.1 admission acknowledgement lifecycle: transient vs definitive denials, no flooding, timed backoff, and late admission", () => {
    vi.useFakeTimers();
    try {
      const BASE_WALL_MS = CITYLIFE_EPOCH_MS + 4_756_000;
      vi.setSystemTime(BASE_WALL_MS);

      const rt = new ColonyRuntime();
      rt.setPlayerView(false);
      rt.debugSetSolTimeOfDay(12, 0);
      tick(rt);

      const ids = rt.getUiState().firstPerson.stepInCitizenIds;
      rt.enterFirstPerson(ids[0]!);

      setupAuthoritativeRuntime(rt, { userId: "operator@test.com" });
      rt.enableMultiplayer("room-1", "ws://synthetic.citylife.invalid/ws");
      const client = rt.getMultiplayerClient()!;

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

      const anchors = rt.busStopAnchors();
      const stop0 = anchors[0]!;

      // Advance transit clock to find Stop 0 dwell BEFORE arming wait
      const baseSol = solNowMs();
      let dwellingOffsetMs = 0;
      let foundDwellingBusId: number | null = null;
      for (let i = 0; i < 20000; i++) {
        dwellingOffsetMs = baseSol + i * 250 - Date.now();
        setSolDebugOffsetMs(dwellingOffsetMs);
        tick(rt);
        for (const b of (rt as any).busFleet.buses) {
          const p = rt.busPoseOf(b.id);
          if (p && p.doorsOpen) {
            const dBusToStop = Math.hypot(p.x - stop0.at.x, p.y - stop0.at.y);
            if (dBusToStop <= 4.0) {
              foundDwellingBusId = b.id;
              break;
            }
          }
        }
        if (foundDwellingBusId !== null) break;
      }
      expect(foundDwellingBusId, "a bus must reach Stop 0 dwell").not.toBeNull();
      const busId = foundDwellingBusId!;
      const dwellingSolInstant = solNowMs();

      // Place player at stop 0 and arm wait
      rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
      expect(rt.queueNextBus(0)).toBe(true);
      expect((rt as any).fpWaitingBusStopIndex).toBe(0);
      expect((rt as any).fpWaitingBoardingPending).toBe(false);

      // Helper to keep the verified dwelling bus fixture while advancing fake wall clock
      const tickAtWallTime = (wallMs: number) => {
        vi.setSystemTime(wallMs);
        setSolDebugOffsetMs(dwellingSolInstant - Date.now());
        tick(rt);
      };

      // 1. Initial board request sent at t = BASE_WALL_MS: pending flag set, waiting intent retained
      tickAtWallTime(BASE_WALL_MS);
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]).toMatchObject({ type: "request_board_bus", busId });
      expect((rt as any).fpWaitingBoardingPending).toBe(true);
      expect((rt as any).fpWaitingBusStopIndex).toBe(0);

      // 2. Pending suppresses sends: tick at t = BASE_WALL_MS + 500ms does NOT send duplicate
      tickAtWallTime(BASE_WALL_MS + 500);
      expect(sentMessages.length).toBe(1);

      // 3. Unrelated error (e.g. driving error) does NOT release pending flag
      (client as any).options.onError?.({
        code: "CAR_CONTROLS_LOCKED",
        message: "Cannot control vehicle",
      });
      expect((rt as any).fpWaitingBoardingPending).toBe(true);
      expect((rt as any).fpWaitingBusStopIndex).toBe(0);

      // 4. Transient denial (BUS_NOT_BOARDABLE): clears pending flag but preserves waiting intent
      (client as any).handleMessage({
        type: "error",
        error: "BUS_NOT_BOARDABLE",
        message: "Bus doors closing",
        busId,
        epoch: 1,
        attemptId: sentMessages[0].attemptId,
      });
      expect((rt as any).fpWaitingBoardingPending).toBe(false);
      expect((rt as any).fpWaitingBusStopIndex).toBe(0); // Intent retained!
      expect(rt.getUiState().firstPerson.narration).toBe("Bus doors closing");

      // 5. Denial backoff does not retry early: tick at t = BASE_WALL_MS + 600ms (<1000ms since last send) sends nothing
      tickAtWallTime(BASE_WALL_MS + 600);
      expect(sentMessages.length).toBe(1);

      // 6. Next opportunity at >=1000ms (t = BASE_WALL_MS + 1005ms) sends once and sets pending
      tickAtWallTime(BASE_WALL_MS + 1005);
      expect(sentMessages.length).toBe(2);
      expect((rt as any).fpWaitingBoardingPending).toBe(true);
      expect((rt as any).fpWaitingBusStopIndex).toBe(0);

      // 7. 5s pending timeout: if server drops request, timeout clears pending after 5s and retries
      tickAtWallTime(BASE_WALL_MS + 4000); // 3s later - still pending
      expect(sentMessages.length).toBe(2);
      tickAtWallTime(BASE_WALL_MS + 6015); // >5s later - timeout allows retry
      expect(sentMessages.length).toBe(3);
      expect((rt as any).fpWaitingBoardingPending).toBe(true);

      // Delayed old definitive denial (e.g. BUS_SEATS_DISABLED from attempt 1): must NOT cancel current attempt 3
      (client as any).handleMessage({
        type: "error",
        error: "BUS_SEATS_DISABLED",
        message: "Bus passenger seats are currently disabled on this server",
        busId,
        epoch: 1,
        attemptId: sentMessages[0].attemptId,
      });
      expect((rt as any).fpWaitingBoardingPending, "delayed old definitive denial must not clear active retry attempt 3").toBe(true);
      expect((rt as any).fpWaitingBusStopIndex).toBe(0);

      // 8. Definitive denial (BUS_SEATS_DISABLED) for current attempt 3: clears pending, clears waiting intent, displays narration
      (client as any).handleMessage({
        type: "error",
        error: "BUS_SEATS_DISABLED",
        message: "Bus passenger seats are currently disabled on this server",
        busId,
        epoch: 1,
        attemptId: sentMessages[2].attemptId,
      });
      expect((rt as any).fpWaitingBoardingPending).toBe(false);
      expect((rt as any).fpWaitingBusStopIndex).toBeNull(); // Definitive failure cancels wait!
      expect(rt.getUiState().firstPerson.narration).toBe("Bus passenger seats are currently disabled on this server");

      // Cannot loop: subsequent ticks after 1s never re-send because intent is cleared
      tickAtWallTime(BASE_WALL_MS + 10_000);
      expect(sentMessages.length).toBe(3);

      // 9. Other definitive denials: TRANSIT_UNAVAILABLE, MUST_BE_PEDESTRIAN
      rt.queueNextBus(0);
      tickAtWallTime(BASE_WALL_MS + 12_000);
      expect(sentMessages.length).toBe(4);
      const attempt4 = sentMessages[3].attemptId;
      (client as any).handleMessage({
        type: "error",
        error: "TRANSIT_UNAVAILABLE",
        message: "Transit service unavailable",
        busId,
        epoch: 1,
        attemptId: attempt4,
      });
      expect((rt as any).fpWaitingBusStopIndex).toBeNull();
      expect((rt as any).fpWaitingBoardingPending).toBe(false);
      expect(rt.getUiState().firstPerson.narration).toBe("Transit service unavailable");

      rt.queueNextBus(0);
      tickAtWallTime(BASE_WALL_MS + 14_000);
      expect(sentMessages.length).toBe(5);
      const attempt5 = sentMessages[4].attemptId;
      (client as any).handleMessage({
        type: "error",
        error: "MUST_BE_PEDESTRIAN",
        message: "Player must be on foot to board bus",
        busId,
        epoch: 1,
        attemptId: attempt5,
      });
      expect((rt as any).fpWaitingBusStopIndex).toBeNull();
      expect((rt as any).fpWaitingBoardingPending).toBe(false);
      expect(rt.getUiState().firstPerson.narration).toBe("Player must be on foot to board bus");

      // 10. Local cancel stops future retries, but valid late server admission still commits seat
      rt.queueNextBus(0);
      tickAtWallTime(BASE_WALL_MS + 20_000);
      expect(sentMessages.length).toBe(6); // In-flight request #6 sent
      const attempt6 = sentMessages[5].attemptId;
      expect((rt as any).fpWaitingBoardingPending).toBe(true);

      // Player clicks cancel locally: stops future client retries
      expect(rt.cancelBusWait()).toBe(true);
      expect((rt as any).fpWaitingBusStopIndex).toBeNull();
      expect((rt as any).fpWaitingBoardingPending).toBe(false);

      // Authoritative server was already processing request #6 and admits player:
      // Client cannot locally undo or discard valid server occupancy
      (client as any).handleMessage({
        type: "bus_boarded",
        participantId: "part-1",
        busId,
        seatIndex: 4,
        modeEpoch: 2,
        attemptId: attempt6,
      });
      expect(rt.fpRidingBusId).toBe(busId);
      expect(rt.fpRidingSeatIndex).toBe(4);
      expect(rt.getUiState().firstPerson.narration).toContain(`You board Bus ${busId + 1}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("BUS.STOP.WAIT.1 delayed boarding-denial request provenance: stale cross-bus, timeout retry, same-bus direct board, and unpending errors", () => {
    vi.useFakeTimers();
    try {
      const BASE_WALL_MS = CITYLIFE_EPOCH_MS + 4_756_000;
      vi.setSystemTime(BASE_WALL_MS);

      const rt = new ColonyRuntime();
      rt.setPlayerView(false);
      rt.debugSetSolTimeOfDay(12, 0);
      tick(rt);

      const ids = rt.getUiState().firstPerson.stepInCitizenIds;
      rt.enterFirstPerson(ids[0]!);

      setupAuthoritativeRuntime(rt, { userId: "operator@test.com" });
      rt.enableMultiplayer("room-1", "ws://synthetic.citylife.invalid/ws");
      const client = rt.getMultiplayerClient()!;

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

      const anchors = rt.busStopAnchors();
      const stop0 = anchors[0]!;

      // Find Stop 0 dwell
      const baseSol = solNowMs();
      let dwellingOffsetMs = 0;
      let foundDwellingBusId: number | null = null;
      for (let i = 0; i < 20000; i++) {
        dwellingOffsetMs = baseSol + i * 250 - Date.now();
        setSolDebugOffsetMs(dwellingOffsetMs);
        tick(rt);
        for (const b of (rt as any).busFleet.buses) {
          const p = rt.busPoseOf(b.id);
          if (p && p.doorsOpen) {
            const dBusToStop = Math.hypot(p.x - stop0.at.x, p.y - stop0.at.y);
            if (dBusToStop <= 4.0) {
              foundDwellingBusId = b.id;
              break;
            }
          }
        }
        if (foundDwellingBusId !== null) break;
      }
      expect(foundDwellingBusId, "a bus must reach Stop 0 dwell").not.toBeNull();
      const busId0 = foundDwellingBusId!;
      const dwellingSolInstant0 = solNowMs();

      // Find Stop 1 dwell
      const stop1 = anchors[1]!;
      let dwellingSolInstant1 = 0;
      let foundDwellingBusId1: number | null = null;
      for (let i = 0; i < 20000; i++) {
        const offset = baseSol + i * 250 - Date.now();
        setSolDebugOffsetMs(offset);
        tick(rt);
        for (const b of (rt as any).busFleet.buses) {
          const p = rt.busPoseOf(b.id);
          if (p && p.doorsOpen) {
            const dBusToStop = Math.hypot(p.x - stop1.at.x, p.y - stop1.at.y);
            if (dBusToStop <= 4.0) {
              foundDwellingBusId1 = b.id;
              dwellingSolInstant1 = solNowMs();
              break;
            }
          }
        }
        if (foundDwellingBusId1 !== null) break;
      }
      expect(foundDwellingBusId1, "a bus must reach Stop 1 dwell").not.toBeNull();
      const busId1 = foundDwellingBusId1!;

      const tickAtStop0Dwell = (wallMs: number) => {
        vi.setSystemTime(wallMs);
        setSolDebugOffsetMs(dwellingSolInstant0 - Date.now());
        tick(rt);
      };
      const tickAtStop1Dwell = (wallMs: number) => {
        vi.setSystemTime(wallMs);
        setSolDebugOffsetMs(dwellingSolInstant1 - Date.now());
        tick(rt);
      };

      // 1. Peer finding: unpending wait intent must NOT be cleared by delayed denial
      rt.debugPlaceFirstPerson(stop0.furniture.x, stop0.furniture.y);
      expect(rt.queueNextBus(0)).toBe(true);
      expect((rt as any).fpWaitingBusStopIndex).toBe(0);
      expect((rt as any).fpWaitingBoardingPending).toBe(false);

      // Delayed error arrives BEFORE any board request was sent for this wait
      (client as any).handleMessage({
        type: "error",
        error: "BUS_FULL",
        message: `All 10 passenger seats on bus ${busId0} are occupied`,
        busId: busId0,
        epoch: 1,
        attemptId: 99,
      });
      expect((rt as any).fpWaitingBusStopIndex, "unpending wait must not be cancelled by delayed denial").toBe(0);
      expect((rt as any).fpWaitingBoardingPending).toBe(false);

      // 2. Request 1 sent for busId0 via production auto-board at t = BASE_WALL_MS
      tickAtStop0Dwell(BASE_WALL_MS);
      expect(sentMessages.length).toBe(1);
      const attempt1 = sentMessages[0].attemptId;
      expect(attempt1).toBeGreaterThan(0);
      expect(sentMessages[0]).toMatchObject({
        type: "request_board_bus",
        busId: busId0,
        epoch: 1,
        attemptId: attempt1,
      });
      expect((rt as any).fpWaitingBoardingPending).toBe(true);

      // 3. Same-bus timeout -> retry with delayed prior attempt denial:
      // Advance time > 5000ms: pending timeout clears pending, and >= 1000ms retry triggers attempt 2 for busId0
      tickAtStop0Dwell(BASE_WALL_MS + 6000);
      expect(sentMessages.length).toBe(2);
      const attempt2 = sentMessages[1].attemptId;
      expect(attempt2).toBeGreaterThan(attempt1);
      expect(sentMessages[1]).toMatchObject({
        type: "request_board_bus",
        busId: busId0,
        epoch: 1,
        attemptId: attempt2,
      });
      expect((rt as any).fpWaitingBoardingPending).toBe(true);
      expect((rt as any).fpWaitingInFlightAttemptId).toBe(attempt2);

      // Stale same-bus attempt 1 delayed denial arrives: must NOT clear pending retry attempt 2
      (client as any).handleMessage({
        type: "error",
        error: "BUS_NOT_BOARDABLE",
        message: "Bus doors closing",
        busId: busId0,
        epoch: 1,
        attemptId: attempt1,
      });
      expect((rt as any).fpWaitingBoardingPending, "same-bus stale attempt 1 denial must not clear pending retry attempt 2").toBe(true);
      expect((rt as any).fpWaitingBusStopIndex).toBe(0);

      // Stale uncorrelated server error (missing attemptId) arrives after retry: must NOT clear attempt 2
      (client as any).handleMessage({
        type: "error",
        error: "BUS_FULL",
        message: `All 10 passenger seats on bus ${busId0} are occupied`,
        busId: busId0,
        epoch: 1,
      });
      expect((rt as any).fpWaitingBoardingPending, "uncorrelated error without attemptId must not cancel active retry").toBe(true);

      // Genuine denial for retry attempt 2 arrives: clears pending and waiting intent
      (client as any).handleMessage({
        type: "error",
        error: "BUS_FULL",
        message: `All 10 passenger seats on bus ${busId0} are occupied`,
        busId: busId0,
        epoch: 1,
        attemptId: attempt2,
      });
      expect((rt as any).fpWaitingBoardingPending).toBe(false);
      expect((rt as any).fpWaitingBusStopIndex).toBeNull();
      expect(rt.getUiState().firstPerson.narration).toContain("occupied");

      // 4. Direct Board-button click: player walks up to dwelling bus, clicks board
      expect(rt.activateFirstPersonInteraction()).toBe(true);
      expect(sentMessages.length).toBe(3);
      const attempt3 = sentMessages[2].attemptId;
      expect(attempt3).toBeGreaterThan(attempt2);
      expect(sentMessages[2]).toMatchObject({
        type: "request_board_bus",
        busId: busId0,
        epoch: 1,
        attemptId: attempt3,
      });
      expect((rt as any).fpWaitingBoardingPending).toBe(true);
      expect((rt as any).fpWaitingInFlightAttemptId).toBe(attempt3);

      // Genuine denial for attempt 3 arrives: clears pending and preserves direct button narration
      (client as any).handleMessage({
        type: "error",
        error: "BUS_FULL",
        message: `All 10 passenger seats on bus ${busId0} are occupied`,
        busId: busId0,
        epoch: 1,
        attemptId: attempt3,
      });
      expect((rt as any).fpWaitingBoardingPending).toBe(false);
      expect(rt.getUiState().firstPerson.narration).toContain("occupied");

      // 5. Cross-bus provenance (Stop 0 vs Stop 1) driven entirely by production code:
      rt.debugPlaceFirstPerson(stop1.furniture.x, stop1.furniture.y);
      expect(rt.queueNextBus(1)).toBe(true);
      tickAtStop1Dwell(BASE_WALL_MS + 20_000);
      expect(sentMessages.length).toBe(4);
      const attempt4 = sentMessages[3].attemptId;
      expect(attempt4).toBeGreaterThan(attempt3);
      expect(sentMessages[3]).toMatchObject({
        type: "request_board_bus",
        busId: busId1,
        epoch: 1,
        attemptId: attempt4,
      });
      expect((rt as any).fpWaitingBusStopIndex).toBe(1);
      expect((rt as any).fpWaitingBoardingPending).toBe(true);

      // Delayed BUS_FULL for busId0 arrives through handleMessage
      (client as any).handleMessage({
        type: "error",
        error: "BUS_FULL",
        message: `All 10 passenger seats on bus ${busId0} are occupied`,
        busId: busId0,
        epoch: 1,
        attemptId: attempt1,
      });
      // MoJoJo finding: Stop 1's wait and Bus 1's pending must be retained!
      expect((rt as any).fpWaitingBusStopIndex, "cross-bus delayed denial must not clear wait B").toBe(1);
      expect((rt as any).fpWaitingBoardingPending, "cross-bus delayed denial must not clear pending B").toBe(true);

      // 6. Early producer shapes: BUS_SEATS_DISABLED on current attempt 4 clears wait and sets narration
      (client as any).handleMessage({
        type: "error",
        error: "BUS_SEATS_DISABLED",
        message: "Bus seat feature is disabled",
        busId: busId1,
        epoch: 1,
        attemptId: attempt4,
      });
      expect((rt as any).fpWaitingBusStopIndex).toBeNull();
      expect((rt as any).fpWaitingBoardingPending).toBe(false);
      expect(rt.getUiState().firstPerson.narration).toBe("Bus seat feature is disabled");

      // 7. Cancel then valid late admission commits seat
      expect(rt.queueNextBus(1)).toBe(true);
      tickAtStop1Dwell(BASE_WALL_MS + 40_000);
      expect(sentMessages.length).toBe(5);
      const attempt5 = sentMessages[4].attemptId;
      expect(attempt5).toBeGreaterThan(attempt4);
      expect(sentMessages[4]).toMatchObject({
        type: "request_board_bus",
        busId: busId1,
        epoch: 1,
        attemptId: attempt5,
      });

      expect(rt.cancelBusWait()).toBe(true);
      expect((rt as any).fpWaitingBusStopIndex).toBeNull();
      expect((rt as any).fpWaitingBoardingPending).toBe(false);

      (client as any).handleMessage({
        type: "bus_boarded",
        participantId: "part-1",
        busId: busId1,
        seatIndex: 2,
        modeEpoch: 2,
        attemptId: attempt5,
      });
      expect(rt.fpRidingBusId).toBe(busId1);
      expect(rt.fpRidingSeatIndex).toBe(2);
    } finally {
      vi.useRealTimers();
    }
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
