import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { execSync } from "child_process";
// @ts-ignore
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createWorldLayoutDocument } from "../src/colony/spatial/worldLayoutDocument";
import { ColonyRuntime } from "../src/colony/runtime";
import { WorldLayoutBootCoordinator, WorldLayoutBootError } from "../src/colony/worldLayoutBoot";
import { MultiplayerClient } from "../src/colony/multiplayer/multiplayerClient";

import { createRequire } from "module";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadServerComponents() {
  function findServerDir(): string {
    if (process.env.CITYLIFE_SERVER_DIR) {
      const custom = path.resolve(process.env.CITYLIFE_SERVER_DIR);
      if (fs.existsSync(custom)) return custom;
    }
    const candidates = [
      path.resolve(process.cwd(), "citylife-server"),
      path.resolve(process.cwd(), "../citylife-server"),
      path.resolve(__dirname, "../../citylife-server"),
      path.resolve(__dirname, "../citylife-server"),
      path.resolve(process.cwd(), "../citylife-server-transit-geometry-candidate"),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.existsSync(path.join(cand, "dist/app.js"))) {
        return cand;
      }
    }
    for (const cand of candidates) {
      if (fs.existsSync(cand)) return cand;
    }
    throw new Error(
      `citylife-server checkout not found. Searched: ${candidates.join(", ")}. ` +
      `Set CITYLIFE_SERVER_DIR or check out citylife-server as sibling.`
    );
  }

  const serverDir = findServerDir();
  const jwtPath = path.join(serverDir, "node_modules/jsonwebtoken");
  const appPath = path.join(serverDir, "dist/app.js");
  const gameStatePath = path.join(serverDir, "dist/gameState.js");
  const worldAuthPath = path.join(serverDir, "dist/worldAuthorityClient.js");
  const realtimePath = path.join(serverDir, "dist/realtime.js");

  if (!fs.existsSync(appPath) || !fs.existsSync(jwtPath)) {
    throw new Error(
      `citylife-server at ${serverDir} is missing dependencies or build artifacts (run 'npm ci && npm run build' in ${serverDir}).`
    );
  }

  const jwt = require(jwtPath);
  const { buildApp } = require(appPath);
  const { GameStateManager } = require(gameStatePath);
  const {
    LocalWorldAuthorityClient,
    CANONICAL_PHYSICAL_OBSTACLES_4242,
    PHYSICAL_COLLIDERS_SCHEMA_VERSION,
    computePhysicalCollidersContentHash,
  } = require(worldAuthPath);
  const { RealtimeManager, extractRoadGeometry, extractWalkabilityAuthority, isFootprintClear, OWNED_DRIVING_CONFIG } = require(realtimePath);
  const wsPath = path.join(serverDir, "node_modules/ws");
  const WebSocket = require(wsPath);
  const solPath = path.join(serverDir, "dist/transit/sol.js");
  const { CITYLIFE_EPOCH_MS } = fs.existsSync(solPath) ? require(solPath) : { CITYLIFE_EPOCH_MS: 1_780_092_000_000 };

  return {
    serverDir,
    jwt,
    buildApp,
    GameStateManager,
    LocalWorldAuthorityClient,
    RealtimeManager,
    extractRoadGeometry,
    extractWalkabilityAuthority,
    isFootprintClear,
    OWNED_DRIVING_CONFIG,
    WebSocket,
    CANONICAL_PHYSICAL_OBSTACLES_4242,
    PHYSICAL_COLLIDERS_SCHEMA_VERSION,
    computePhysicalCollidersContentHash,
    CITYLIFE_EPOCH_MS,
  };
}

const SESSION_STORAGE_KEY = "citylife.session.v5";
const JWT_SECRET = "synthetic-actual-pair-secret-999";

function seedPlayerSession(page: Page, email: string, token: string, numericId: number, wsUrl: string) {
  const username = email.split("@")[0];
  return page.addInitScript(
    ({ key, userEmail, userName, jwtToken, idNum, customWs }) => {
      const session = {
        token: jwtToken,
        refreshToken: "e2e-fake-refresh",
        expiresAt: Date.now() + 1000 * 60 * 60 * 8,
        operator: {
          id: String(idNum),
          userId: String(idNum),
          name: userName,
          scopes: [],
          roles: ["CITYLIFE_PLAYER"],
        },
      };
      window.sessionStorage.setItem(key, JSON.stringify(session));
      (window as any).__customMultiplayerWsUrl = customWs;

      // Intercept and record WebSocket lifecycle events for failure diagnosis (hygienic: no query params/tokens)
      const OrigWs = window.WebSocket;
      (window as any).__wsEvents = [];
      (window as any).__exitWireHistory = [];
      const WrappedWs = function (url: string | URL, protocols?: string | string[]) {
        const ws = new OrigWs(url, protocols);
        let sanitizedEndpoint = "";
        try {
          const parsed = new URL(String(url), window.location.href);
          sanitizedEndpoint = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
        } catch {
          sanitizedEndpoint = "[invalid-url]";
        }
        (window as any).__wsEvents.push({ type: "created", endpoint: sanitizedEndpoint, time: Date.now() });

        const origSend = ws.send.bind(ws);
        ws.send = (payload: any) => {
          try {
            const parsed = typeof payload === "string" ? JSON.parse(payload) : null;
            if (parsed && (parsed.type === "exit_vehicle" || parsed.type === "board_vehicle")) {
              (window as any).__exitWireHistory.push({
                dir: "sent",
                msgType: parsed.type,
                epoch: typeof parsed.epoch === "number" ? parsed.epoch : undefined,
                time: Date.now(),
              });
            }
          } catch {}
          return origSend(payload);
        };

        ws.addEventListener("open", () => {
          (window as any).__wsEvents.push({ type: "open", time: Date.now() });
        });
        ws.addEventListener("close", (ev) => {
          (window as any).__wsEvents.push({ type: "close", code: ev.code, reason: ev.reason, wasClean: ev.wasClean, time: Date.now() });
        });
        ws.addEventListener("error", () => {
          (window as any).__wsEvents.push({ type: "error", time: Date.now() });
        });
        ws.addEventListener("message", (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (
              data.type === "error" ||
              data.type === "peer_left" ||
              data.type === "session_admitted" ||
              data.type === "vehicle_exited" ||
              data.type === "vehicle_boarded" ||
              data.type === "peer_mode_changed"
            ) {
              const eventRecord = {
                type: "msg",
                msgType: data.type,
                epoch: typeof data.epoch === "number" ? data.epoch : undefined,
                operation: typeof data.operation === "string" ? data.operation : undefined,
                mode: typeof data.mode === "string" ? data.mode : undefined,
                participantId: typeof data.participantId === "string" ? data.participantId : undefined,
                error: typeof data.error === "string" ? data.error : undefined,
                message: typeof data.message === "string" ? data.message : undefined,
                time: Date.now(),
              };
              (window as any).__wsEvents.push(eventRecord);
              if (data.type === "vehicle_exited" || data.type === "vehicle_boarded" || data.type === "peer_mode_changed" || data.type === "error") {
                (window as any).__exitWireHistory.push({
                  dir: "recv",
                  msgType: data.type,
                  epoch: typeof data.epoch === "number" ? data.epoch : undefined,
                  operation: typeof data.operation === "string" ? data.operation : undefined,
                  error: typeof data.error === "string" ? data.error : undefined,
                  time: Date.now(),
                });
              }
            }
          } catch {}
        });
        return ws;
      } as any;
      WrappedWs.prototype = OrigWs.prototype;
      WrappedWs.CONNECTING = OrigWs.CONNECTING;
      WrappedWs.OPEN = OrigWs.OPEN;
      WrappedWs.CLOSING = OrigWs.CLOSING;
      WrappedWs.CLOSED = OrigWs.CLOSED;
      window.WebSocket = WrappedWs;
    },
    { key: SESSION_STORAGE_KEY, userEmail: email, userName: username, jwtToken: token, idNum: numericId, customWs: wsUrl }
  );
}

async function dumpTransitionDiagnostics(page: Page, label: string) {
  try {
    const diag = await page.evaluate(() => {
      const colony = (window as any).__colony;
      const mp = colony?.getMultiplayerClient();
      const history = (window as any).__snapshotHistory || [];
      const recent = history.slice(-3).map((s: any) => ({
        seq: s.seq,
        count: s.participants?.length,
        parts: s.participants?.map((p: any) => ({
          id: p.participantId,
          user: p.username,
          isPedestrian: p.isPedestrian,
          mode: p.mode,
          x: typeof p.x === "number" ? Number(p.x.toFixed(2)) : undefined,
          z: typeof p.z === "number" ? Number(p.z.toFixed(2)) : undefined,
        })),
      }));
      const rawEvents = (window as any).__wsEvents || [];
      const sentInputs = (window as any).__sentInputs || [];
      const exitWire = (window as any).__exitWireHistory || [];
      return {
        multiplayerStatus: mp?.getStatus(),
        sessionInfo: mp?.getSessionInfo ? {
          sessionId: mp.getSessionInfo().sessionId,
          participantId: mp.getSessionInfo().participantId,
        } : null,
        modeEpoch: mp?.getModeEpoch ? mp.getModeEpoch() : null,
        seated: colony?.ownedDriveSeated,
        fpCameraCell: colony?.fpCameraCell,
        drivePose: colony?.ownedDrivePose ? {
          x: Number(colony.ownedDrivePose.x.toFixed(2)),
          y: Number(colony.ownedDrivePose.y.toFixed(2)),
          speed: colony.ownedDrivePose.speed,
        } : null,
        snapshotCount: history.length,
        recentSnapshots: recent,
        sentMessages: sentInputs.slice(-5),
        exitWireHistory: exitWire.slice(-10),
        wsEvents: rawEvents.slice(-5).map((e: any) => ({
          type: e.type,
          endpoint: e.endpoint,
          code: e.code,
          reason: e.reason,
          msgType: e.msgType,
          error: e.error,
          message: e.message,
        })),
      };
    });
    console.error(`[Transition Diagnostic ${label}]`, JSON.stringify(diag));
  } catch (err: any) {
    console.error(`[Transition Diagnostic ${label} Failed]`, err?.message);
  }
}

// Respect explicit CITYLIFE_TRACE setting while defaulting to "off" to avoid unconditional passive trace overhead
test.use({
  trace: (process.env.CITYLIFE_TRACE as "off" | "on" | "retain-on-failure" | "on-first-retry") || "off",
});

test.describe("Multiplayer Racing Actual-Pair Acceptance (Fastify RealtimeManager & Scheduled Loop)", () => {
  test("fails closed with CANONICAL_STAGING_UNAVAILABLE when world lacks reviewed staging metadata", async () => {
    const {
      jwt,
      buildApp,
      GameStateManager,
      LocalWorldAuthorityClient,
      RealtimeManager,
      WebSocket,
    } = loadServerComponents();

    const baseSurveyRuntime = new ColonyRuntime(4242);
    const baseSurveyDoc = baseSurveyRuntime.captureWorldLayout();
    const defaultDoc = createWorldLayoutDocument({
      ...baseSurveyDoc,
      layoutId: "seed-4242",
      seed: 4242,
      revision: { number: 0, parentHash: null },
    });

    const worldAuth = new LocalWorldAuthorityClient();
    // Register without hubSpawn or layout.garagePad.roadTarget to test fail-closed invariant
    worldAuth.registerWorld({
      schemaVersion: "citylife.starter-parcel-manifest/v1",
      worldId: "seed-4242",
      layoutRevision: defaultDoc.revision.contentHash,
      layout: defaultDoc,
      plots: [{ geometry: { neighbourhoodKey: "citylife-central" } }],
    });

    const userClient = {
      async getVehicleTruth(userId: string) {
        return {
          owned: true,
          status: "OWNED",
          vehicleKey: "karoo-vonk-11",
          storage: "local-drive",
          onboardingState: "COMPLETED",
        };
      },
    };

    const realtime = new RealtimeManager({
      userClient,
      worldAuthorityClient: worldAuth,
      enableSimulationTimer: false,
    });

    const fastifyApp = buildApp({
      gameState: new GameStateManager(null, null),
      realtime,
      userClient,
      worldAuthorityClient: worldAuth,
      jwtSecret: JWT_SECRET,
      jwtAlgorithms: ["HS256"],
    });

    const serverAddr = await fastifyApp.listen({ port: 0, host: "127.0.0.1" });
    const wsUrl = serverAddr.replace(/^http/, "ws") + "/api/v1/citylife/ws";
    const token = jwt.sign(
      { userId: 70001, id: 70001, sub: 70001, type: "access", roles: ["CITYLIFE_PLAYER"], username: "jamtin" },
      JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );

    try {
      const clientWs = new WebSocket(`${wsUrl}?token=${token}`, {
        headers: { origin: "https://citylife.kooker.co.za" },
      });
      const receivedMessages: any[] = [];
      const receivedErrors: any[] = [];
      let closeEvent: { code: number; reason: string } | null = null;

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          clientWs.close();
          resolve();
        }, 5000);
        clientWs.on("message", (data: any) => {
          try {
            const msg = JSON.parse(data.toString());
            receivedMessages.push(msg);
            if (msg.type === "error") {
              receivedErrors.push(msg);
            }
          } catch {}
        });
        clientWs.on("open", () => {
          clientWs.send(
            JSON.stringify({
              type: "create_session",
              protocolVersion: 2,
              worldId: "seed-4242",
              layoutRevision: `wl:v1:0:${defaultDoc.revision.contentHash}`,
              neighbourhoodKey: "citylife-central",
              mode: "driving",
              vehicleKey: "karoo-vonk-11",
            })
          );
        });
        clientWs.on("close", (code: number, reason: Buffer) => {
          closeEvent = { code, reason: reason?.toString("utf8") ?? "" };
          clearTimeout(timer);
          resolve();
        });
      });

      console.log(
        "[Admission Negative Wire Proof] Sanitized received messages:",
        JSON.stringify(receivedMessages.map((m) => ({ type: m.type, error: m.error, message: m.message })))
      );
      if (closeEvent) {
        console.log(`[Admission Negative Wire Proof] WebSocket closed: code=${(closeEvent as any).code}, reason=${(closeEvent as any).reason}`);
      }

      const stagingErr = receivedErrors.find((e: any) => e.error === "CANONICAL_STAGING_UNAVAILABLE");
      expect(stagingErr).toBeDefined();
      expect(stagingErr.message).toContain("Canonical world catalogue lacks reviewed vehicle staging truth");
      console.log("[Admission Negative Proof] Verified server fail-closed on missing staging metadata:", stagingErr);
    } finally {
      await fastifyApp.close();
    }
  });

  test("fails closed with CANONICAL_TRANSIT_UNAVAILABLE when starter catalogue lacks transit companion under multiplayer boot policy", async () => {
    const baseSurveyRuntime = new ColonyRuntime(4242);
    const baseSurveyDoc = baseSurveyRuntime.captureWorldLayout();
    const defaultDoc = createWorldLayoutDocument({
      ...baseSurveyDoc,
      layoutId: "seed-4242",
      seed: 4242,
      revision: { number: 0, parentHash: null },
    });

    let hydrated = false;
    let saved = false;
    const store = {
      async load() {
        return null;
      },
      async save() {
        saved = true;
        return {
          status: "saved" as const,
          revision: {
            layoutRevision: "rev-1",
            worldId: "seed-4242",
            sequence: 1,
            document: defaultDoc,
            persistedAt: Date.now(),
          },
        };
      },
      async history() {
        return [];
      },
    };

    const coordinator = new WorldLayoutBootCoordinator({
      worldId: "seed-4242",
      store,
      requireRemoteAuthority: true,
      requireTransitAuthority: true,
      remoteLoader: {
        async loadRemoteStarterCatalogue() {
          return {
            published: true,
            manifest: {
              worldId: "seed-4242",
              layoutRevision: defaultDoc.revision.contentHash,
              layout: defaultDoc,
              // Deliberately omitted transit companion
            },
          };
        },
      },
      runtime: {
        captureWorldLayout: () => baseSurveyDoc,
        hydrateWorldLayout: () => {
          hydrated = true;
        },
        exportCanonicalTransitAuthority: (doc) =>
          baseSurveyRuntime.exportCanonicalTransitAuthority(doc),
      },
    });

    await expect(coordinator.boot()).rejects.toThrow(WorldLayoutBootError);
    await expect(coordinator.boot()).rejects.toMatchObject({
      code: "CANONICAL_TRANSIT_UNAVAILABLE",
    });
    expect(hydrated, "Hydration must NOT occur when transit companion is absent").toBe(false);
    expect(saved, "Persistent save must NOT occur when transit companion is absent").toBe(false);
  });

  test("paired 80b server: recoverable MODE_MISMATCH maintains participant and socket, and next valid input succeeds", async () => {
    // Scope Disclosure: Real pinned 80b Fastify HTTP/WebSocket server running on local loopback (127.0.0.1)
    // with synthetic JWT authentication and in-memory local WorldAuthority fixtures.
    const {
      jwt,
      buildApp,
      GameStateManager,
      LocalWorldAuthorityClient,
      RealtimeManager,
      WebSocket: ServerWebSocket,
      CANONICAL_PHYSICAL_OBSTACLES_4242,
      PHYSICAL_COLLIDERS_SCHEMA_VERSION,
      computePhysicalCollidersContentHash,
    } = loadServerComponents();

    // Qualification / Scope Disclosure: Rev 0 generated from ColonyRuntime(4242) base survey
    // represents a local-source synthetic verification fixture. It does NOT clear reviewed R1
    // canonical publication or deployed acceptance. R1 transit-route loop alignment remains a
    // required dependency under ROAD/catalogue/BUSsync owners.
    const baseSurveyRuntime = new ColonyRuntime(4242);
    const defaultDoc = createWorldLayoutDocument({
      ...baseSurveyRuntime.captureWorldLayout(),
      layoutId: "seed-4242",
      seed: 4242,
      revision: { number: 0, parentHash: null },
    });

    const surfaceFrame = defaultDoc.frames.find((f: any) => f.layer === "surface") || defaultDoc.frames[0];
    const canonicalTransitAuthority = baseSurveyRuntime.exportCanonicalTransitAuthority(defaultDoc);
    expect(
      canonicalTransitAuthority,
      "Base survey runtime must physically export canonical transit authority for defaultDoc",
    ).not.toBeNull();

    const physicalColliders = {
      schemaVersion: PHYSICAL_COLLIDERS_SCHEMA_VERSION,
      worldId: "seed-4242",
      layoutRevision: defaultDoc.revision.contentHash,
      frameId: surfaceFrame.id,
      obstacles: CANONICAL_PHYSICAL_OBSTACLES_4242,
      contentHash: computePhysicalCollidersContentHash({
        schemaVersion: PHYSICAL_COLLIDERS_SCHEMA_VERSION,
        worldId: "seed-4242",
        layoutRevision: defaultDoc.revision.contentHash,
        frameId: surfaceFrame.id,
        obstacles: CANONICAL_PHYSICAL_OBSTACLES_4242,
      }),
    };

    const walkableCells = new Set<string>();
    for (let x = 120; x <= 180; x++) {
      for (let y = 250; y <= 280; y++) {
        walkableCells.add(`${x},${y}`);
      }
    }
    const walkability = {
      schemaVersion: "citylife.walkability/v1",
      frameId: surfaceFrame.id,
      walkableCells,
    };

    const worldAuth = new LocalWorldAuthorityClient();
    worldAuth.registerWorld({
      schemaVersion: "citylife.starter-parcel-manifest/v1",
      worldId: "seed-4242",
      layoutRevision: defaultDoc.revision.contentHash,
      layout: defaultDoc,
      plots: [{ geometry: { neighbourhoodKey: "citylife-central" } }],
      hubSpawn: { x: 139, y: 265, heading: 0 },
      physicalColliders,
      walkability,
      transit: canonicalTransitAuthority,
    });

    const userClient = {
      async getVehicleTruth(userId: string) {
        return {
          owned: true,
          status: "OWNED",
          vehicleKey: "karoo-vonk-11",
          storage: "local-drive",
          onboardingState: "COMPLETED",
        };
      },
    };

    const realtime = new RealtimeManager({
      userClient,
      worldAuthorityClient: worldAuth,
      enableSimulationTimer: true,
      simulationIntervalMs: 50,
    });

    const fastifyApp = buildApp({
      gameState: new GameStateManager(null, null),
      realtime,
      userClient,
      worldAuthorityClient: worldAuth,
      jwtSecret: JWT_SECRET,
      jwtAlgorithms: ["HS256"],
      allowedWsOrigins: ["https://citylife.kooker.co.za"],
    });

    const serverAddr = await fastifyApp.listen({ port: 0, host: "127.0.0.1" });
    const wsUrl = serverAddr.replace(/^http/, "ws") + "/api/v1/citylife/ws";

    const token = jwt.sign(
      { userId: 80001, id: 80001, sub: 80001, type: "access", roles: ["CITYLIFE_PLAYER"], username: "pairtester" },
      JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" },
    );

    // Provide browser-like Origin header for Node WebSocket client
    const OriginalWebSocket = globalThis.WebSocket;
    class NodeTestWebSocket extends ServerWebSocket {
      constructor(url: string | URL, protocols?: any) {
        super(url, protocols, {
          headers: {
            origin: "https://citylife.kooker.co.za",
          },
        });
      }
    }
    (globalThis as any).WebSocket = NodeTestWebSocket;

    const errorEvents: { code: string; message: string }[] = [];
    const snapshots: any[] = [];
    const client = new MultiplayerClient({
      url: wsUrl,
      token,
      userId: "80001",
      username: "pairtester",
      roomCode: "pair-mismatch-room",
      worldId: "seed-4242",
      layoutRevision: `wl:v1:0:${defaultDoc.revision.contentHash}`,
      neighbourhoodKey: "citylife-central",
      autoCreate: true,
      onError: (err) => {
        errorEvents.push(err);
      },
      onSnapshot: (snap) => {
        snapshots.push(snap);
      },
    });

    try {
      await client.connect();

      // 1. Wait for admission (session_joined)
      const timeoutAt = Date.now() + 5000;
      while (client.getStatus() !== "connected" && Date.now() < timeoutAt) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(client.getStatus()).toBe("connected");
      const initialSessionId = client.getSessionInfo().sessionId;
      const initialParticipantId = client.getSessionInfo().participantId;
      expect(initialSessionId).toBeDefined();
      expect(initialParticipantId).toBeDefined();

      const initialMode = client.getMode();
      const initialEpoch = client.getModeEpoch();

      // 1. Prime valid NEUTRAL seq: 1 in admitted mode and current epoch
      const validSeq1 = 1;
      let neutralSent = false;
      if (initialMode === "walking") {
        neutralSent = client.sendWalkingInput({
          seq: validSeq1,
          epoch: initialEpoch,
          forward: 0,
          strafe: 0,
          heading: 0,
        });
      } else {
        neutralSent = client.sendDrivingInput({
          seq: validSeq1,
          epoch: initialEpoch,
          throttle: 0,
          steer: 0,
          brake: false,
        });
      }
      expect(neutralSent, "Client must transmit prime valid neutral input").toBe(true);

      // Wait bounded for authoritative snapshot ack 1
      const ack1Timeout = Date.now() + 5000;
      let ack1Snapshot: any = null;
      while (Date.now() < ack1Timeout) {
        ack1Snapshot = snapshots.find((snap) =>
          snap.participants.some(
            (p: any) =>
              (p.participantId === initialParticipantId || p.userId === "80001") &&
              p.lastInputSeq === validSeq1,
          ),
        );
        if (ack1Snapshot) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(
        ack1Snapshot,
        "Server must broadcast authoritative snapshot ack 1 for prime valid neutral input",
      ).toBeDefined();

      const ack1Part = ack1Snapshot.participants.find(
        (p: any) => p.participantId === initialParticipantId || p.userId === "80001",
      );
      expect(ack1Part.lastInputSeq).toBe(validSeq1);
      expect(ack1Part.mode).toBe(initialMode);
      expect(ack1Part.modeEpoch).toBe(initialEpoch);
      const initialAckX = ack1Part.x;
      const initialAckY = ack1Part.y;
      const initialAckZ = ack1Part.z;

      // 2. Transmit mismatched input (wrong mode, high seq 101) directly over wire
      const mismatchedMode = initialMode === "walking" ? "driving" : "walking";
      const rawSent = (client as any).send({
        type: "input",
        mode: mismatchedMode,
        seq: 101,
        epoch: initialEpoch,
        throttle: 1,
        steer: 0,
        brake: false,
        forward: 1,
        strafe: 0,
        heading: 0,
      });
      expect(rawSent).toBe(true);

      // 3. Wait bounded for pinned server to respond with MODE_MISMATCH
      const errTimeout = Date.now() + 5000;
      while (!errorEvents.some((e) => e.code === "MODE_MISMATCH") && Date.now() < errTimeout) {
        await new Promise((r) => setTimeout(r, 20));
      }

      const mismatchError = errorEvents.find((e) => e.code === "MODE_MISMATCH");
      expect(mismatchError).toBeDefined();
      expect(mismatchError?.code).toBe("MODE_MISMATCH");

      // Invariant: client connection is NOT torn down; status remains connected, session and epoch intact
      expect(client.getStatus()).toBe("connected");
      expect(client.getSessionInfo().sessionId).toBe(initialSessionId);
      expect(client.getSessionInfo().participantId).toBe(initialParticipantId);
      expect(client.getMode()).toBe(initialMode);
      expect(client.getModeEpoch()).toBe(initialEpoch);

      // Verify server did NOT consume seq 101 (lastInputSeq remains 1, not 101)
      const latestSnapshot = snapshots[snapshots.length - 1];
      const latestPart = latestSnapshot?.participants.find(
        (p: any) => p.participantId === initialParticipantId || p.userId === "80001",
      );
      if (latestPart) {
        expect(latestPart.lastInputSeq).toBe(validSeq1);
        expect(latestPart.mode).toBe(initialMode);
      }

      // 4. Send subsequent valid nextseq 2 with actual non-neutral movement
      const validSeq2 = 2;
      let nonNeutralSent = false;
      if (initialMode === "walking") {
        nonNeutralSent = client.sendWalkingInput({
          seq: validSeq2,
          epoch: initialEpoch,
          forward: 1,
          strafe: 0,
          heading: 0,
        });
      } else {
        nonNeutralSent = client.sendDrivingInput({
          seq: validSeq2,
          epoch: initialEpoch,
          throttle: 1,
          steer: 0,
          brake: false,
        });
      }
      expect(nonNeutralSent).toBe(true);

      // 5. Wait bounded for fresh authoritative snapshot ack 2
      const ack2Timeout = Date.now() + 5000;
      let ack2Snapshot: any = null;
      while (Date.now() < ack2Timeout) {
        ack2Snapshot = snapshots.find((snap) =>
          snap.participants.some(
            (p: any) =>
              (p.participantId === initialParticipantId || p.userId === "80001") &&
              p.lastInputSeq === validSeq2,
          ),
        );
        if (ack2Snapshot) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(
        ack2Snapshot,
        "Server must broadcast authoritative snapshot ack 2 confirming accepted next valid sequence",
      ).toBeDefined();

      const ack2Part = ack2Snapshot.participants.find(
        (p: any) => p.participantId === initialParticipantId || p.userId === "80001",
      );
      expect(ack2Part.lastInputSeq).toBe(validSeq2);
      expect(ack2Part.mode).toBe(initialMode);
      expect(ack2Part.modeEpoch).toBe(initialEpoch);

      // Assert actual non-neutral movement occurred
      const displacement = Math.hypot(
        ack2Part.x - initialAckX,
        (ack2Part.z ?? ack2Part.y) - (initialAckZ ?? initialAckY),
      );
      expect(
        displacement > 0 || ack2Part.speed > 0,
        `Valid non-neutral input must produce displacement or speed (displacement=${displacement}, speed=${ack2Part.speed})`,
      ).toBe(true);

      expect(client.getStatus()).toBe("connected");
      expect(client.getSessionInfo().sessionId).toBe(initialSessionId);
      expect(errorEvents.filter((e) => e.code === "MODE_MISMATCH")).toHaveLength(1);
    } finally {
      (globalThis as any).WebSocket = OriginalWebSocket;
      client.disconnect();
      realtime.dispose();
      await fastifyApp.close();
    }
  });

  test("paired 80b server: fatal authentication negative control terminates connection with code 4401", async () => {
    const { jwt, buildApp, GameStateManager, LocalWorldAuthorityClient, RealtimeManager, WebSocket: ServerWebSocket } =
      loadServerComponents();

    const baseSurveyRuntime = new ColonyRuntime(4242);
    const defaultDoc = createWorldLayoutDocument({
      ...baseSurveyRuntime.captureWorldLayout(),
      layoutId: "seed-4242",
      seed: 4242,
      revision: { number: 0, parentHash: null },
    });

    const worldAuth = new LocalWorldAuthorityClient();
    worldAuth.registerWorld({
      schemaVersion: "citylife.starter-parcel-manifest/v1",
      worldId: "seed-4242",
      layoutRevision: defaultDoc.revision.contentHash,
      layout: defaultDoc,
      plots: [{ geometry: { neighbourhoodKey: "citylife-central" } }],
      hubSpawn: { x: 139, y: 265, heading: 0 },
    });

    const realtime = new RealtimeManager({
      userClient: { async getVehicleTruth() { return { owned: false }; } },
      worldAuthorityClient: worldAuth,
      enableSimulationTimer: false,
    });

    const fastifyApp = buildApp({
      gameState: new GameStateManager(null, null),
      realtime,
      worldAuthorityClient: worldAuth,
      jwtSecret: JWT_SECRET,
      jwtAlgorithms: ["HS256"],
      allowedWsOrigins: ["https://citylife.kooker.co.za"],
    });

    const serverAddr = await fastifyApp.listen({ port: 0, host: "127.0.0.1" });
    const wsUrl = serverAddr.replace(/^http/, "ws") + "/api/v1/citylife/ws";

    const expiredToken = jwt.sign(
      { userId: 80002, id: 80002, sub: 80002, type: "access", roles: ["CITYLIFE_PLAYER"], username: "expiredtester" },
      JWT_SECRET,
      { algorithm: "HS256", expiresIn: "-1h" },
    );

    let ws: any = null;
    try {
      ws = new ServerWebSocket(
        `${wsUrl}?token=${expiredToken}&room=pair-room-fatal&worldId=seed-4242&neighbourhood=citylife-central&mode=walking`,
        {
          headers: {
            origin: "https://citylife.kooker.co.za",
          },
        },
      );

      const closeEvent = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("Timeout waiting for expired token WebSocket close"));
        }, 5000);
        ws.on("close", (code: number, reason: any) => {
          clearTimeout(timer);
          resolve({ code, reason: reason?.toString("utf8") ?? "" });
        });
        ws.on("error", () => {});
      });

      // Pinned server closes with 4401 for expired token
      expect(closeEvent.code).toBe(4401);
      expect(ws.readyState).toBe(3); // CLOSED
    } finally {
      try {
        ws?.terminate?.();
        ws?.close?.();
      } catch {}
      realtime.dispose();
      await fastifyApp.close();
    }
  });

  test("paired server: queryless cookie authentication, failure controls, and authoritative shared-bus seating between two distinct principals", async () => {
    // Qualification / Scope Disclosure:
    // Pinned Fastify HTTP/WebSocket server running on local loopback (127.0.0.1) with real built dist/app.js (c617b0b).
    // This harness uses local synthetic component geometry and staging walkability covering the transit depot gate
    // (cell 135,356) and stop verge to test multi-principal bus seating, peer poses, and cookie session lifecycle.
    // Reviewed R1 canonical world publication and deployed multi-player acceptance remain separate.
    const {
      serverDir,
      jwt,
      buildApp,
      GameStateManager,
      LocalWorldAuthorityClient,
      RealtimeManager,
      WebSocket: ServerWebSocket,
      CANONICAL_PHYSICAL_OBSTACLES_4242,
      PHYSICAL_COLLIDERS_SCHEMA_VERSION,
      computePhysicalCollidersContentHash,
      CITYLIFE_EPOCH_MS,
    } = loadServerComponents();

    const baseSurveyRuntime = new ColonyRuntime(4242);
    const defaultDoc = createWorldLayoutDocument({
      ...baseSurveyRuntime.captureWorldLayout(),
      layoutId: "seed-4242",
      seed: 4242,
      revision: { number: 0, parentHash: null },
    });

    const surfaceFrame = defaultDoc.frames.find((f: any) => f.layer === "surface") || defaultDoc.frames[0];
    const canonicalTransitAuthority = baseSurveyRuntime.exportCanonicalTransitAuthority(defaultDoc);
    expect(
      canonicalTransitAuthority,
      "Base survey runtime must physically export canonical transit authority for defaultDoc",
    ).not.toBeNull();

    const physicalColliders = {
      schemaVersion: PHYSICAL_COLLIDERS_SCHEMA_VERSION,
      worldId: "seed-4242",
      layoutRevision: defaultDoc.revision.contentHash,
      frameId: surfaceFrame.id,
      obstacles: CANONICAL_PHYSICAL_OBSTACLES_4242,
      contentHash: computePhysicalCollidersContentHash({
        schemaVersion: PHYSICAL_COLLIDERS_SCHEMA_VERSION,
        worldId: "seed-4242",
        layoutRevision: defaultDoc.revision.contentHash,
        frameId: surfaceFrame.id,
        obstacles: CANONICAL_PHYSICAL_OBSTACLES_4242,
      }),
    };

    // Staging walkability: cover hub and depot gate/stop verge (135, 356)
    const walkableCells = new Set<string>();
    for (let x = 120; x <= 160; x++) {
      for (let y = 240; y <= 370; y++) {
        walkableCells.add(`${x},${y}`);
      }
    }
    const walkability = {
      schemaVersion: "citylife.walkability/v1",
      frameId: surfaceFrame.id,
      walkableCells,
    };

    const worldAuth = new LocalWorldAuthorityClient();
    worldAuth.registerWorld({
      schemaVersion: "citylife.starter-parcel-manifest/v1",
      worldId: "seed-4242",
      layoutRevision: defaultDoc.revision.contentHash,
      layout: defaultDoc,
      plots: [{ geometry: { neighbourhoodKey: "citylife-central" } }],
      hubSpawn: { x: 135, y: 356, heading: 0 },
      physicalColliders,
      walkability,
      transit: canonicalTransitAuthority,
    });

    // Distinct vehicle ownership truth per principal
    const userClient = {
      async getVehicleTruth(userId: string) {
        if (userId === "80001") {
          return {
            owned: false,
            status: null,
            vehicleKey: null,
            storage: null,
            onboardingState: "NONE",
          };
        }
        if (userId === "80002") {
          return {
            owned: false,
            status: null,
            vehicleKey: null,
            storage: null,
            onboardingState: "NONE",
          };
        }
        return {
          owned: false,
          status: null,
          vehicleKey: null,
          storage: null,
          onboardingState: "NONE",
        };
      },
    };

    const realtime = new RealtimeManager({
      userClient,
      worldAuthorityClient: worldAuth,
      enableSimulationTimer: false,
      enableBusSync: true,
      enableBusSeats: true,
      staleTimeoutMs: 30000,
    });

    // Establish pre-board baseline sol time at 5:02 AM (CITYLIFE_EPOCH_MS + 4_530_000)
    // where bus 0 has departed bay into depot-stop-out with doors open
    const baseSolNow = CITYLIFE_EPOCH_MS + 4_530_000;
    let mockNow = baseSolNow;
    realtime.setMockSolNowMs(() => mockNow);

    const fastifyApp = buildApp({
      gameState: new GameStateManager(null, null),
      realtime,
      userClient,
      worldAuthorityClient: worldAuth,
      jwtSecret: JWT_SECRET,
      jwtAlgorithms: ["HS256"],
      allowedWsOrigins: ["https://citylife.kooker.co.za"],
    });

    const serverAddr = await fastifyApp.listen({ port: 0, host: "127.0.0.1" });
    const baseUrl = serverAddr;
    const wsUrl = serverAddr.replace(/^http/, "ws") + "/api/v1/citylife/ws";
    expect(wsUrl).not.toContain("token=");
    expect(wsUrl).not.toContain("jwt=");

    let unauthWs: any = null;

    try {
      // 1. Negative Control: Queryless WebSocket connection without cookie fails closed before admission
      const noCookieClosePromise = new Promise<{ code: number }>((resolve) => {
        unauthWs = new ServerWebSocket(wsUrl, {
          headers: { origin: "https://citylife.kooker.co.za" },
        });
        unauthWs.on("close", (code: number) => resolve({ code }));
        unauthWs.on("error", () => {});
      });
      const noCookieClose = await noCookieClosePromise;
      expect(noCookieClose.code).toBe(4401);

      // 2. Negative Control: ensureCookieAuth lifecycle failure halts admission fail-closed
      const badCookieClient = new MultiplayerClient({
        url: wsUrl,
        userId: "80099",
        username: "BadCookieTester",
        useCookieAuth: true,
        ensureCookieAuth: async () => {
          const res = await fetch(`${baseUrl}/api/v1/citylife/auth/cookie`, {
            method: "POST",
            headers: {
              authorization: "Bearer invalid-signature-token",
              origin: "https://citylife.kooker.co.za",
            },
          });
          return res.ok;
        },
        worldId: "seed-4242",
        layoutRevision: `wl:v1:0:${defaultDoc.revision.contentHash}`,
        neighbourhoodKey: "citylife-central",
        roomCode: "shared-bus-room",
        autoCreate: false,
      });
      await badCookieClient.connect();
      expect(badCookieClient.getStatus()).toBe("error");
      badCookieClient.disconnect();

      // 3. Cookie Issuance: Principal A (80001) & Principal B (80002)
      const tokenA = jwt.sign(
        { userId: 80001, id: 80001, sub: 80001, type: "access", roles: ["CITYLIFE_PLAYER"], username: "AliceBus" },
        JWT_SECRET,
        { algorithm: "HS256", expiresIn: "1h" },
      );
      const cookieResA = await fetch(`${baseUrl}/api/v1/citylife/auth/cookie`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenA}`,
          origin: "https://citylife.kooker.co.za",
        },
      });
      expect(cookieResA.status).toBe(200);
      const setCookieA = cookieResA.headers.get("set-cookie") || "";
      expect(setCookieA).toContain("jwt=");
      expect(setCookieA).toContain("Max-Age=3599");
      const cookieHeaderA = setCookieA.split(";")[0];

      const tokenB = jwt.sign(
        { userId: 80002, id: 80002, sub: 80002, type: "access", roles: ["CITYLIFE_PLAYER"], username: "BobBus" },
        JWT_SECRET,
        { algorithm: "HS256", expiresIn: "1h" },
      );
      const cookieResB = await fetch(`${baseUrl}/api/v1/citylife/auth/cookie`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenB}`,
          origin: "https://citylife.kooker.co.za",
        },
      });
      expect(cookieResB.status).toBe(200);
      const setCookieB = cookieResB.headers.get("set-cookie") || "";
      expect(setCookieB).toContain("jwt=");
      expect(setCookieB).toContain("Max-Age=3599");
      const cookieHeaderB = setCookieB.split(";")[0];

      // 4. Cookie Clear verification:
      // Scope Disclosure: Cookie clear tombstones the browser cookie storage for subsequent requests;
      // it does not revoke an already copied/extracted in-memory JWT or forcibly terminate active WebSocket sessions.
      const clearRes = await fetch(`${baseUrl}/api/v1/citylife/auth/clear`, {
        method: "POST",
        headers: { origin: "https://citylife.kooker.co.za" },
      });
      expect(clearRes.status).toBe(200);
      const clearCookie = clearRes.headers.get("set-cookie") || "";
      expect(clearCookie).toContain("jwt=");
      expect(clearCookie).toContain("Max-Age=0");

      // 5. Connect Principal A via queryless cookie WebSocket and join session as walking
      // Conditional adapter proof:
      // In this Node.js / Playwright worker context, ServerWebSocket subclasses manually inject
      // the HTTP Cookie header into native ws connection headers to emulate standard browser cookie attachment.
      // Deployed browser BFF/WS ingress path and reverse-proxy cookie forwarding remain separate proofs.
      let client1BoardAck: any = null;
      let client1AlightAck: any = null;
      let client2BoardAck: any = null;
      let client2ReceivedPeerPoses: any[] = [];

      class PrincipalAWebSocket extends ServerWebSocket {
        constructor(url: string | URL, protocols?: any) {
          super(url, protocols, {
            headers: {
              origin: "https://citylife.kooker.co.za",
              cookie: cookieHeaderA,
            },
          });
        }
      }

      class PrincipalBWebSocket extends ServerWebSocket {
        constructor(url: string | URL, protocols?: any) {
          super(url, protocols, {
            headers: {
              origin: "https://citylife.kooker.co.za",
              cookie: cookieHeaderB,
            },
          });
        }
      }

      const OriginalWebSocket = globalThis.WebSocket;
      (globalThis as any).WebSocket = PrincipalAWebSocket;

      const clientA = new MultiplayerClient({
        url: wsUrl,
        userId: "80001",
        username: "AliceBus",
        useCookieAuth: true,
        ensureCookieAuth: async () => {
          const res = await fetch(`${baseUrl}/api/v1/citylife/auth/cookie`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${tokenA}`,
              origin: "https://citylife.kooker.co.za",
            },
          });
          return res.ok;
        },
        worldId: "seed-4242",
        layoutRevision: `wl:v1:0:${defaultDoc.revision.contentHash}`,
        neighbourhoodKey: "citylife-central",
        roomCode: "shared-bus-room",
        autoCreate: true,
        onBusBoarded: (ack) => {
          client1BoardAck = ack;
        },
        onBusAlighted: (ack) => {
          client1AlightAck = ack;
        },
      });

      await clientA.connect();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Client A connection timed out")), 5000);
        const check = () => {
          if (clientA.getStatus() === "connected") {
            clearTimeout(timeout);
            resolve();
          } else if (clientA.getStatus() === "error") {
            clearTimeout(timeout);
            reject(new Error("Client A entered error status"));
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      expect(clientA.getStatus()).toBe("connected");
      expect(clientA.getMode()).toBe("walking");
      expect(clientA.getSeatedBusId()).toBeNull();
      const initialParticipantIdA = clientA.getSessionInfo().participantId;
      const initialSessionId = clientA.getSessionInfo().sessionId;
      expect(initialParticipantIdA).toBeDefined();
      expect(initialSessionId).toBeDefined();

      // Retrieve transit runner and session from RealtimeManager
      const session = (realtime as any).sessions.get(initialSessionId)!;
      expect(session).toBeDefined();
      const runner = realtime.getSessionTransitRunner(initialSessionId)!;
      expect(runner).toBeDefined();

      // Bus 0 must be in depot-stop-out dwelling with doors open
      runner.getBusState(0).mode = "depot-stop-out";
      realtime.stepSimulation(0.05);
      const bus0InitialPose = runner.getBusWorldPose(0, session.originX, session.originZ, session.cellMetres)!;
      expect(bus0InitialPose).toBeDefined();
      expect(bus0InitialPose.doorsOpen).toBe(true);
      expect(bus0InitialPose.speed).toBe(0);
      expect(bus0InitialPose.atStop).toBe(true);

      // Ensure participant A position on server is in close boarding range (<= 12m)
      const partA = session.participants.get(initialParticipantIdA)!;
      partA.x = bus0InitialPose.x + 1.0;
      partA.z = bus0InitialPose.z + 1.0;

      // 6. Connect Principal B into the same room
      (globalThis as any).WebSocket = PrincipalBWebSocket;
      const clientB = new MultiplayerClient({
        url: wsUrl,
        userId: "80002",
        username: "BobBus",
        useCookieAuth: true,
        ensureCookieAuth: async () => {
          const res = await fetch(`${baseUrl}/api/v1/citylife/auth/cookie`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${tokenB}`,
              origin: "https://citylife.kooker.co.za",
            },
          });
          return res.ok;
        },
        worldId: "seed-4242",
        layoutRevision: `wl:v1:0:${defaultDoc.revision.contentHash}`,
        neighbourhoodKey: "citylife-central",
        roomCode: "shared-bus-room",
        autoCreate: true,
        onBusBoarded: (ack) => {
          client2BoardAck = ack;
        },
        onPeerPose: (pid, pose) => {
          client2ReceivedPeerPoses.push({ pid, ...pose });
        },
      });

      await clientB.connect();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Client B connection timed out")), 5000);
        const check = () => {
          if (clientB.getStatus() === "connected") {
            clearTimeout(timeout);
            resolve();
          } else if (clientB.getStatus() === "error") {
            clearTimeout(timeout);
            reject(new Error("Client B entered error status"));
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      expect(clientB.getStatus()).toBe("connected");
      expect(clientB.getMode()).toBe("walking");
      const initialParticipantIdB = clientB.getSessionInfo().participantId;
      expect(initialParticipantIdB).toBeDefined();

      const partB = session.participants.get(initialParticipantIdB)!;
      partB.x = bus0InitialPose.x + 2.0;
      partB.z = bus0InitialPose.z + 1.0;

      // 7. Principal A boards bus 0
      expect(clientA.boardBus(0)).toBe(true);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Client A boardBus timed out")), 5000);
        const check = () => {
          if (client1BoardAck !== null) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      expect(client1BoardAck.busId).toBe(0);
      expect(typeof client1BoardAck.seatIndex).toBe("number");
      expect(client1BoardAck.seatIndex).toBeGreaterThanOrEqual(0);
      expect(clientA.getMode()).toBe("riding_bus");
      expect(clientA.getSeatedBusId()).toBe(0);
      expect(clientA.getSeatIndex()).toBe(client1BoardAck.seatIndex);
      expect(runner.getOccupiedSeats(0)).toBe(1);

      // Step simulation so peer receives updated mode and pose
      realtime.stepSimulation(0.05);

      // 8. Principal B boards bus 0 and receives distinct random available seat
      expect(clientB.boardBus(0)).toBe(true);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Client B boardBus timed out")), 5000);
        const check = () => {
          if (client2BoardAck !== null) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      expect(client2BoardAck.busId).toBe(0);
      expect(typeof client2BoardAck.seatIndex).toBe("number");
      expect(client2BoardAck.seatIndex).toBeGreaterThanOrEqual(0);
      expect(client2BoardAck.seatIndex).not.toBe(client1BoardAck.seatIndex);
      expect(clientB.getMode()).toBe("riding_bus");
      expect(clientB.getSeatedBusId()).toBe(0);
      expect(clientB.getSeatIndex()).toBe(client2BoardAck.seatIndex);
      expect(runner.getOccupiedSeats(0)).toBe(2);

      // 9. Peer pose assertion: Principal B receives riding pose of Principal A
      realtime.stepSimulation(0.05);
      const peerPoseOfA = client2ReceivedPeerPoses.find(
        (p) => p.pid === initialParticipantIdA || p.mode === "riding_bus"
      );
      expect(peerPoseOfA).toBeDefined();
      expect(peerPoseOfA.seatedBusId).toBe(0);
      expect(peerPoseOfA.seatIndex).toBe(client1BoardAck.seatIndex);
      expect(peerPoseOfA.mode).toBe("riding_bus");

      // 10. Simulation displacement: Step forward sol time so bus 0 moves out along its route
      const displacedSolTime = CITYLIFE_EPOCH_MS + 4_545_000;
      mockNow = displacedSolTime;
      realtime.stepSimulation(0.05);

      const displacedBus0Pose = runner.getBusWorldPose(0, session.originX, session.originZ, session.cellMetres)!;
      const busDisplacement = Math.hypot(displacedBus0Pose.x - bus0InitialPose.x, displacedBus0Pose.z - bus0InitialPose.z);
      expect(busDisplacement).toBeGreaterThan(5.0);

      // Verify participant A on server has synchronized riding coordinates following the bus
      expect(partA.seatedBusId).toBe(0);
      expect(partA.seatIndex).toBe(client1BoardAck.seatIndex);
      const riderDeltaFromBus = Math.hypot(partA.x - displacedBus0Pose.x, partA.z - displacedBus0Pose.z);
      expect(riderDeltaFromBus).toBeLessThan(1.0);

      // 11. Reconnect control: Simulate transport drop of Client A and verify seat retention
      (globalThis as any).WebSocket = PrincipalAWebSocket;
      const rawWsA = (clientA as any).ws;
      rawWsA.close();
      await new Promise((r) => setTimeout(r, 100));

      // Seat occupancy must remain 2 during reconnect window
      expect(runner.getOccupiedSeats(0)).toBe(2);

      // Reconnect Client A with queryless cookie WebSocket
      await clientA.connect();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Client A reconnect timed out")), 5000);
        const check = () => {
          if (clientA.getStatus() === "connected") {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      expect(clientA.getStatus()).toBe("connected");
      expect(clientA.getMode()).toBe("riding_bus");
      expect(clientA.getSeatedBusId()).toBe(0);
      expect(clientA.getSeatIndex()).toBe(client1BoardAck.seatIndex);
      expect(runner.getOccupiedSeats(0)).toBe(2);

      // 12. Safe Alight control:
      // Return bus to dwelling stop with doors open for alight validation
      runner.getBusState(0).mode = "depot-stop-out";
      realtime.stepSimulation(0.05);

      expect(clientA.alightBus()).toBe(true);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Client A alightBus timed out")), 5000);
        const check = () => {
          if (client1AlightAck !== null) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      expect(client1AlightAck).toBeDefined();
      expect(Number.isFinite(client1AlightAck.x)).toBe(true);
      expect(Number.isFinite(client1AlightAck.z)).toBe(true);
      expect(clientA.getMode()).toBe("walking");
      expect(clientA.getSeatedBusId()).toBeNull();
      expect(clientA.getSeatIndex()).toBeNull();

      // Occupancy drops to 1 (Client A vacated, Client B remains seated)
      expect(runner.getOccupiedSeats(0)).toBe(1);

      // Authoritative alight coordinate verification against walkableCells
      const originX = session.originX ?? 0;
      const originZ = session.originZ ?? 0;
      const cellMetres = session.cellMetres ?? 4;
      const alightCellX = Math.round((client1AlightAck.x - originX) / cellMetres);
      const alightCellZ = Math.round((client1AlightAck.z - originZ) / cellMetres);
      expect(walkableCells.has(`${alightCellX},${alightCellZ}`)).toBe(true);

      // Clean disconnect
      clientA.disconnect();
      clientB.disconnect();
      (globalThis as any).WebSocket = OriginalWebSocket;
    } finally {
      try {
        unauthWs?.terminate?.();
      } catch {}
      realtime.dispose();
      await fastifyApp.close();
    }
  });

  test("two racers driving down road against proposed Fastify server, verified in 3D and minimap, recording mp4", async ({
    browser,
  }) => {
    test.setTimeout(420_000);

    const startTestTime = Date.now();
    const stageTimings: { stage: string; elapsedMs: number; deltaMs: number }[] = [];
    let lastStageTime = startTestTime;
    function recordStage(stage: string) {
      const now = Date.now();
      const elapsedMs = now - startTestTime;
      const deltaMs = now - lastStageTime;
      lastStageTime = now;
      stageTimings.push({ stage, elapsedMs, deltaMs });
      console.log(`[STAGE TIMING] +${(deltaMs / 1000).toFixed(2)}s (total: ${(elapsedMs / 1000).toFixed(2)}s): ${stage}`);
    }

    const rawVideoDir = path.resolve("videos/multiplayer-actual-pair-raw");
    if (!fs.existsSync(rawVideoDir)) {
      fs.mkdirSync(rawVideoDir, { recursive: true });
    }

    const {
      jwt,
      buildApp,
      GameStateManager,
      LocalWorldAuthorityClient,
      RealtimeManager,
      extractRoadGeometry,
      extractWalkabilityAuthority,
      isFootprintClear,
      OWNED_DRIVING_CONFIG,
      CANONICAL_PHYSICAL_OBSTACLES_4242,
      PHYSICAL_COLLIDERS_SCHEMA_VERSION,
      computePhysicalCollidersContentHash,
    } = loadServerComponents();

    recordStage("Initialization & World Layout Document creation");

    // 1. Build canonical world layout document (Qualification: Rev 0 generated from
    // ColonyRuntime(4242) base survey is a local synthetic verification fixture;
    // R1 route/depot correction is required under ROAD/catalogue/BUSsync owners).
    const baseSurveyRuntime = new ColonyRuntime(4242);
    const baseSurveyDoc = baseSurveyRuntime.captureWorldLayout();
    const sortedFrames = [...baseSurveyDoc.frames].sort((a: any, b: any) =>
      a.layer === "surface" ? -1 : b.layer === "surface" ? 1 : 0
    );
    const defaultDoc = createWorldLayoutDocument({
      ...baseSurveyDoc,
      frames: sortedFrames,
      layoutId: "seed-4242",
      seed: 4242,
      revision: { number: 0, parentHash: null },
    });

    const canonicalTransitAuthority = baseSurveyRuntime.exportCanonicalTransitAuthority(defaultDoc);
    expect(
      canonicalTransitAuthority,
      "Base survey runtime must physically export canonical transit authority for defaultDoc",
    ).not.toBeNull();

    const surfaceFrame = defaultDoc.frames.find((f: any) => f.layer === "surface") || defaultDoc.frames[0];
    const physicalColliders = {
      schemaVersion: PHYSICAL_COLLIDERS_SCHEMA_VERSION,
      worldId: "seed-4242",
      layoutRevision: defaultDoc.revision.contentHash,
      frameId: surfaceFrame.id,
      obstacles: CANONICAL_PHYSICAL_OBSTACLES_4242,
      contentHash: computePhysicalCollidersContentHash({
        schemaVersion: PHYSICAL_COLLIDERS_SCHEMA_VERSION,
        worldId: "seed-4242",
        layoutRevision: defaultDoc.revision.contentHash,
        frameId: surfaceFrame.id,
        obstacles: CANONICAL_PHYSICAL_OBSTACLES_4242,
      }),
    };

    // 2. Set up isolated World Authority and User truth fixtures with explicit deterministic vehicle staging contract
    const worldAuth = new LocalWorldAuthorityClient();
    const STAGING_CELL = { x: 139, y: 265, heading: 0 };

    // Assert reviewed canonical road network membership in runtime for both staging lanes
    expect(
      baseSurveyRuntime.sim.state.roadSet.has(`${STAGING_CELL.x},${STAGING_CELL.y}`),
      `Reviewed canonical vehicle staging cell (${STAGING_CELL.x}, ${STAGING_CELL.y}) must be on runtime road network`
    ).toBe(true);
    expect(
      baseSurveyRuntime.sim.state.roadSet.has(`${STAGING_CELL.x},${STAGING_CELL.y + 1}`),
      `Reviewed canonical vehicle staging cell for peer (${STAGING_CELL.x}, ${STAGING_CELL.y + 1}) must be on runtime road network`
    ).toBe(true);

    // Assert serialized road geometry extraction and full vehicle footprint clearance against complete physical truth
    const stagingGeom = extractRoadGeometry(
      { layout: defaultDoc, physicalColliders },
      { layout: defaultDoc, physicalColliders }
    );
    expect(
      stagingGeom.hasGeometry,
      "Canonical world document must provide usable surface frame geometry"
    ).toBe(true);
    expect(
      stagingGeom.roadSet.has(`${STAGING_CELL.x},${STAGING_CELL.y}`),
      `Serialized canonical catalogue road geometry must contain staging cell (${STAGING_CELL.x}, ${STAGING_CELL.y})`
    ).toBe(true);
    expect(
      stagingGeom.roadSet.has(`${STAGING_CELL.x},${STAGING_CELL.y + 1}`),
      `Serialized canonical catalogue road geometry must contain peer staging cell (${STAGING_CELL.x}, ${STAGING_CELL.y + 1})`
    ).toBe(true);

    const footprintClear1 = isFootprintClear(
      STAGING_CELL.x,
      STAGING_CELL.y,
      STAGING_CELL.heading,
      stagingGeom.gridWidth,
      stagingGeom.gridHeight,
      stagingGeom.obstacleSet,
      stagingGeom.obstacleBoxes,
      OWNED_DRIVING_CONFIG.halfLengthMetres,
      OWNED_DRIVING_CONFIG.halfWidthMetres,
      stagingGeom.cellMetres
    );
    expect(
      footprintClear1,
      `Vehicle staging cell (${STAGING_CELL.x}, ${STAGING_CELL.y}) must have clear full vehicle footprint against obstacles`
    ).toBe(true);

    const footprintClear2 = isFootprintClear(
      STAGING_CELL.x,
      STAGING_CELL.y + 1,
      STAGING_CELL.heading,
      stagingGeom.gridWidth,
      stagingGeom.gridHeight,
      stagingGeom.obstacleSet,
      stagingGeom.obstacleBoxes,
      OWNED_DRIVING_CONFIG.halfLengthMetres,
      OWNED_DRIVING_CONFIG.halfWidthMetres,
      stagingGeom.cellMetres
    );
    expect(
      footprintClear2,
      `Peer vehicle staging cell (${STAGING_CELL.x}, ${STAGING_CELL.y + 1}) must have clear full vehicle footprint against obstacles`
    ).toBe(true);

    // Assert reviewed straight corridor along driving heading has clear road and footprint for both lanes (steps 0..8)
    for (let step = 0; step <= 8; step++) {
      const stepX = STAGING_CELL.x + step;
      expect(
        stagingGeom.roadSet.has(`${stepX},${STAGING_CELL.y}`),
        `Corridor step ${step} lane 1 (${stepX}, ${STAGING_CELL.y}) must be on road network`
      ).toBe(true);
      expect(
        stagingGeom.roadSet.has(`${stepX},${STAGING_CELL.y + 1}`),
        `Corridor step ${step} lane 2 (${stepX}, ${STAGING_CELL.y + 1}) must be on road network`
      ).toBe(true);
      expect(
        isFootprintClear(stepX, STAGING_CELL.y, STAGING_CELL.heading, stagingGeom.gridWidth, stagingGeom.gridHeight, stagingGeom.obstacleSet, stagingGeom.obstacleBoxes, OWNED_DRIVING_CONFIG.halfLengthMetres, OWNED_DRIVING_CONFIG.halfWidthMetres, stagingGeom.cellMetres),
        `Corridor step ${step} lane 1 must have clear full vehicle footprint`
      ).toBe(true);
      expect(
        isFootprintClear(stepX, STAGING_CELL.y + 1, STAGING_CELL.heading, stagingGeom.gridWidth, stagingGeom.gridHeight, stagingGeom.obstacleSet, stagingGeom.obstacleBoxes, OWNED_DRIVING_CONFIG.halfLengthMetres, OWNED_DRIVING_CONFIG.halfWidthMetres, stagingGeom.cellMetres),
        `Corridor step ${step} lane 2 must have clear full vehicle footprint`
      ).toBe(true);
    }

    const walkableCells = new Set<string>();
    const terrain = baseSurveyRuntime.sim.state.terrain;
    for (let cx = 120; cx <= 180; cx++) {
      for (let cy = 250; cy <= 280; cy++) {
        const isWater = terrain && typeof terrain.isWater === "function" ? terrain.isWater(cx, cy) : false;
        const isObstacle = stagingGeom.obstacleSet.has(`${cx},${cy}`);
        if (!isWater && !isObstacle) {
          walkableCells.add(`${cx},${cy}`);
        }
      }
    }

    // Explicitly assert that the intended exit and walking cells around vehicle staging lanes are verified walkable
    expect(
      walkableCells.has(`${STAGING_CELL.x},${STAGING_CELL.y}`),
      `Intended exit cell for lane 1 (${STAGING_CELL.x}, ${STAGING_CELL.y}) must be verified walkable against terrain and obstacles`
    ).toBe(true);
    expect(
      walkableCells.has(`${STAGING_CELL.x},${STAGING_CELL.y + 1}`),
      `Intended exit cell for lane 2 (${STAGING_CELL.x}, ${STAGING_CELL.y + 1}) must be verified walkable against terrain and obstacles`
    ).toBe(true);

    const walkabilityAuthorityCheck = extractWalkabilityAuthority(
      {
        layout: defaultDoc,
        walkability: {
          schemaVersion: "citylife.walkability/v1",
          frameId: surfaceFrame.id,
          walkableCells,
        },
      },
      defaultDoc
    );
    expect(walkabilityAuthorityCheck, "Walkability authority must extract cleanly from canonical layout").not.toBeNull();

    worldAuth.registerWorld({
      schemaVersion: "citylife.starter-parcel-manifest/v1",
      worldId: "seed-4242",
      layoutRevision: defaultDoc.revision.contentHash,
      layout: defaultDoc,
      physicalColliders,
      walkability: {
        schemaVersion: "citylife.walkability/v1",
        frameId: surfaceFrame.id,
        walkableCells,
      },
      transit: canonicalTransitAuthority,
      plots: [{ geometry: { neighbourhoodKey: "citylife-central" } }],
      hubSpawn: STAGING_CELL,
    });

    const userClient = {
      async getVehicleTruth(userId: string) {
        // Authoritative User truth: both players own karoo-vonk-11
        if (userId === "70001" || userId === "70002") {
          return {
            owned: true,
            status: "OWNED",
            vehicleKey: "karoo-vonk-11",
            storage: "local-drive",
            onboardingState: "COMPLETED",
          };
        }
        return {
          owned: false,
          status: null,
          vehicleKey: null,
          storage: null,
          onboardingState: "NONE",
        };
      },
    };

    // 3. Instantiate proposed RealtimeManager with active 10Hz scheduled loop
    const realtime = new RealtimeManager({
      userClient,
      worldAuthorityClient: worldAuth,
      enableSimulationTimer: true, // Actual proposed scheduled loop
      staleTimeoutMs: 60_000,
    });

    const origHandleConnection = realtime.handleConnection.bind(realtime);
    realtime.handleConnection = (socket: any, authUser: any) => {
      socket.on("close", (code: number, reason: Buffer | string) => {
        console.log(`[Diagnostic Server Socket Close] user=${authUser.username || authUser.id}: code=${code}, reason=${reason?.toString()}`);
      });
      return origHandleConnection(socket, authUser);
    };

    const e2ePort = Number(process.env.CITYLIFE_E2E_PORT) || 5191;
    const fastifyApp = buildApp({
      gameState: new GameStateManager(null, null),
      realtime,
      userClient,
      worldAuthorityClient: worldAuth,
      jwtSecret: JWT_SECRET,
      jwtAlgorithms: ["HS256"],
      allowedWsOrigins: [
        "https://citylife.kooker.co.za",
        `http://127.0.0.1:${e2ePort}`,
        `http://localhost:${e2ePort}`,
      ],
    });

    const serverPort = Number(process.env.CITYLIFE_PORT) || 9010;
    const serverAddr = await fastifyApp.listen({ port: serverPort, host: "127.0.0.1" });
    const actualWsUrl = serverAddr.replace(/^http/, "ws") + "/api/v1/citylife/ws";
    console.log(`Proposed Fastify server listening at: ${serverAddr} (ws: ${actualWsUrl})`);

    // 4. Generate valid JWT tokens with numeric IDs
    const token1 = jwt.sign(
      { userId: 70001, id: 70001, sub: 70001, type: "access", roles: ["CITYLIFE_PLAYER"], username: "jamtin" },
      JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    const token2 = jwt.sign(
      { userId: 70002, id: 70002, sub: 70002, type: "access", roles: ["CITYLIFE_PLAYER"], username: "jamtin2" },
      JWT_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );

    recordStage("Fastify server listening & JWTs issued");

    try {
      // 5. Create context 1 with video recording for Player 1 (jamtin)
      const context1: BrowserContext = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: {
          dir: rawVideoDir,
          size: { width: 1280, height: 720 },
        },
      });
      const page1 = await context1.newPage();
      await seedPlayerSession(page1, "jamtin@citylife.local", token1, 70001, actualWsUrl);

      // 6. Create context 2 for Player 2 (jamtin2)
      const context2: BrowserContext = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      const page2 = await context2.newPage();
      await seedPlayerSession(page2, "jamtin2@citylife.local", token2, 70002, actualWsUrl);

      // 7. Stub HTTP catalogue and vehicle ownership endpoints with isolated fixtures
      const handleCatalogueRoute = (route: any) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            published: true,
            manifest: {
              worldId: "seed-4242",
              layoutRevision: defaultDoc.revision.contentHash,
              layout: defaultDoc,
              physicalColliders,
              transit: canonicalTransitAuthority,
              walkability: {
                schemaVersion: "citylife.walkability/v1",
                frameId: surfaceFrame.id,
                walkableCells: Array.from(walkableCells),
              },
              plots: [{ geometry: { neighbourhoodKey: "citylife-central" } }],
            },
          }),
        });
      };

      const handleVehicleRoute = (route: any) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            owned: true,
            status: "OWNED",
            vehicleKey: "karoo-vonk-11",
            ownedVehicleKeys: ["karoo-vonk-11"],
            hasVehicle: true,
            carKey: "karoo-vonk-11",
          }),
        });
      };

      const handleAssetsRoute = (route: any) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        });
      };

      await context1.route("**/starter-catalogue*", handleCatalogueRoute);
      await context2.route("**/starter-catalogue*", handleCatalogueRoute);
      await context1.route("**/players/me/vehicle*", handleVehicleRoute);
      await context2.route("**/players/me/vehicle*", handleVehicleRoute);
      await context1.route("**/car-ownership*", handleVehicleRoute);
      await context2.route("**/car-ownership*", handleVehicleRoute);
      await context1.route("**/api/v1/assets*", handleAssetsRoute);
      await context2.route("**/api/v1/assets*", handleAssetsRoute);

      recordStage("Contexts & HTTP route mocks configured");

      // 8. Load both players concurrently with direct ephemeral WebSocket endpoint
      const targetQuery = `/?room=racing-actual&skipauth=1&ws=${encodeURIComponent(actualWsUrl)}`;

      console.log("Loading Player 1 and Player 2 concurrently...");
      await Promise.all([
        page1.goto(targetQuery),
        page2.goto(targetQuery),
      ]);
      await Promise.all([
        page1.waitForSelector("canvas", { timeout: 60_000 }),
        page2.waitForSelector("canvas", { timeout: 60_000 }),
      ]);
      await Promise.all([
        page1.waitForFunction(() => !!(window as any).__colony && !!(window as any).__r3fScene, undefined, { timeout: 60_000 }),
        page2.waitForFunction(() => !!(window as any).__colony && !!(window as any).__r3fScene, undefined, { timeout: 60_000 }),
      ]);

      recordStage("Both players loaded runtime & R3F canvas");

      // Bounded diagnosis: Query and record effective WebGL renderer on both contexts
      const getGlInfo = (page: Page) =>
        page.evaluate(() => {
          const canvas = document.querySelector("canvas");
          const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
          if (!gl) return { error: "no-gl-context" };
          const ext = gl.getExtension("WEBGL_debug_renderer_info");
          return {
            unmaskedVendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
            unmaskedRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
            vendor: gl.getParameter(gl.VENDOR),
            renderer: gl.getParameter(gl.RENDERER),
          };
        });

      const [glInfo1, glInfo2] = await Promise.all([getGlInfo(page1), getGlInfo(page2)]);
      console.log(`[WebGL Diagnostic] Page 1: Vendor=${glInfo1.unmaskedVendor || glInfo1.vendor}, Renderer=${glInfo1.unmaskedRenderer || glInfo1.renderer}`);
      console.log(`[WebGL Diagnostic] Page 2: Vendor=${glInfo2.unmaskedVendor || glInfo2.vendor}, Renderer=${glInfo2.unmaskedRenderer || glInfo2.renderer}`);

      recordStage("WebGL renderer diagnostic recorded");

      // Wait for both players to establish direct WebSocket connection with proposed Fastify server concurrently
      await Promise.all([
        page1.waitForSelector('[data-testid="multiplayer-hud"][data-connected="true"]', {
          timeout: 60_000,
        }),
        page2.waitForSelector('[data-testid="multiplayer-hud"][data-connected="true"]', {
          timeout: 60_000,
        }),
      ]);

      console.log("Both players connected to proposed Fastify multiplayer server via direct browser WebSockets.");
      recordStage("Fastify direct WebSocket connections established");

      // Place both players at safe road positions concurrently derived from fixture staging contract
      const roadStart = await page1.evaluate((staging) => {
        const colony = (window as any).__colony;
        const terrain = colony.sim?.state?.terrain;
        const size = terrain?.size ?? 608;
        return { x: staging.x, y: staging.y, heading: staging.heading, terrainSize: size };
      }, STAGING_CELL);

      await Promise.all([
        page1.evaluate(
          ({ x, y, heading }) => {
            const colony = (window as any).__colony;
            colony.ownedDrivePose = { x, y, heading, speed: 0 };
            colony.ownedDriveSeated = true;
            colony.emit();
          },
          roadStart
        ),
        page2.evaluate(
          ({ x, y, heading }) => {
            const colony = (window as any).__colony;
            colony.ownedDrivePose = { x, y: y + 1, heading, speed: 0 };
            colony.ownedDriveSeated = true;
            colony.emit();
          },
          roadStart
        ),
      ]);

      recordStage("Safe road positions initialized for both players");

      // Verify mutual peer awareness in 3D scene concurrently
      await Promise.all([
        page1.waitForFunction(() => {
          const scene = (window as any).__r3fScene;
          let found = false;
          scene?.traverse((o: any) => {
            if (o.name && o.name.includes("remote-racer-jamtin2")) {
              found = true;
            }
          });
          return found;
        }, undefined, { timeout: 30_000 }),
        page2.waitForFunction(() => {
          const scene = (window as any).__r3fScene;
          let found = false;
          scene?.traverse((o: any) => {
            if (o.name && o.name.includes("remote-racer-jamtin")) {
              found = true;
            }
          });
          return found;
        }, undefined, { timeout: 30_000 }),
      ]);

      console.log("Verified mutual peer awareness: Player 1 and Player 2 rendered in 3D scene.");
      recordStage("Mutual 3D peer awareness verified");

      // Hook snapshot recording on both clients
      await Promise.all([
        page1.evaluate(() => {
          const colony = (window as any).__colony;
          const mp = colony.getMultiplayerClient();
          (window as any).__snapshotHistory = [];
          (window as any).__sentInputs = [];
          (window as any).__blurEvents = [];
          window.addEventListener("blur", () => {
            (window as any).__blurEvents.push({ type: "blur", time: Date.now() });
          });
          document.addEventListener("visibilitychange", () => {
            (window as any).__blurEvents.push({ type: "visibilitychange", state: document.visibilityState, time: Date.now() });
          });
          if (mp) {
            const orig = mp.options.onSnapshot;
            mp.options.onSnapshot = (s: any) => {
              (window as any).__snapshotHistory.push(s);
              orig?.(s);
            };
            if (mp.ws) {
              const origSend = mp.ws.send.bind(mp.ws);
              mp.ws.send = (data: any) => {
                try {
                  (window as any).__sentInputs.push(JSON.parse(data));
                } catch {}
                return origSend(data);
              };
              (window as any).__closeEvents = [];
              mp.ws.addEventListener("close", (e: any) => {
                (window as any).__closeEvents.push({ code: e.code, reason: e.reason, wasClean: e.wasClean, time: Date.now() });
              });
              mp.ws.addEventListener("error", (e: any) => {
                (window as any).__closeEvents.push({ type: "error", message: e?.message ?? "ws error", time: Date.now() });
              });
            }
          }
        }),
        page2.evaluate(() => {
          const colony = (window as any).__colony;
          const mp = colony.getMultiplayerClient();
          (window as any).__snapshotHistory = [];
          (window as any).__sentInputs = [];
          (window as any).__blurEvents = [];
          window.addEventListener("blur", () => {
            (window as any).__blurEvents.push({ type: "blur", time: Date.now() });
          });
          document.addEventListener("visibilitychange", () => {
            (window as any).__blurEvents.push({ type: "visibilitychange", state: document.visibilityState, time: Date.now() });
          });
          if (mp) {
            const orig = mp.options.onSnapshot;
            mp.options.onSnapshot = (s: any) => {
              (window as any).__snapshotHistory.push(s);
              orig?.(s);
            };
            if (mp.ws) {
              const origSend = mp.ws.send.bind(mp.ws);
              mp.ws.send = (data: any) => {
                try {
                  (window as any).__sentInputs.push(JSON.parse(data));
                } catch {}
                return origSend(data);
              };
              (window as any).__closeEvents = [];
              mp.ws.addEventListener("close", (e: any) => {
                (window as any).__closeEvents.push({ code: e.code, reason: e.reason, wasClean: e.wasClean, time: Date.now() });
              });
              mp.ws.addEventListener("error", (e: any) => {
                (window as any).__closeEvents.push({ type: "error", message: e?.message ?? "ws error", time: Date.now() });
              });
            }
          }
        }),
      ]);

      // Open mini-maps on both clients via genuine locator pointer hit testing
      recordStage("Opening mini-maps on both clients via genuine locator pointer hit testing");
      const mapBtn1 = page1.locator('[data-testid="player-map-shortcut"]');
      await expect(mapBtn1).toBeVisible({ timeout: 20_000 });
      await mapBtn1.click();
      recordStage("Player 1 map shortcut clicked");

      const mapBtn2 = page2.locator('[data-testid="player-map-shortcut"]');
      await expect(mapBtn2).toBeVisible({ timeout: 20_000 });
      await mapBtn2.click();
      recordStage("Player 2 map shortcut clicked");

      const mapDialog1 = page1.locator('[data-testid="player-map"]');
      await expect(mapDialog1).toBeVisible({ timeout: 20_000 });
      const mapDialog2 = page2.locator('[data-testid="player-map"]');
      await expect(mapDialog2).toBeVisible({ timeout: 20_000 });

      const peerMarker1 = page1.locator('[data-testid="city-map-peer-marker"]');
      await expect(peerMarker1).toBeAttached({ timeout: 20_000 });
      await expect(peerMarker1).toHaveAttribute("aria-label", "Peer jamtin2");

      const peerMarker2 = page2.locator('[data-testid="city-map-peer-marker"]');
      await expect(peerMarker2).toBeAttached({ timeout: 20_000 });
      await expect(peerMarker2).toHaveAttribute("aria-label", "Peer jamtin");

      recordStage("Mini-maps opened and peer markers attached on both clients via genuine hit testing");

      // Record initial remote racer 3D positions
      const initial3DPosP1 = await page1.evaluate(() => {
        const scene = (window as any).__r3fScene;
        let pos: { x: number; z: number } | null = null;
        scene?.traverse((o: any) => {
          if (o.name && o.name.includes("remote-racer-jamtin2")) {
            pos = { x: o.position.x, z: o.position.z };
          }
        });
        return pos;
      });
      expect(initial3DPosP1).not.toBeNull();

      const initial3DPosP2 = await page2.evaluate(() => {
        const scene = (window as any).__r3fScene;
        let pos: { x: number; z: number } | null = null;
        scene?.traverse((o: any) => {
          if (o.name && o.name.includes("remote-racer-jamtin")) {
            pos = { x: o.position.x, z: o.position.z };
          }
        });
        return pos;
      });
      expect(initial3DPosP2).not.toBeNull();

      // Read initial mini-map marker coordinates
      const initialMapPeerPosP1 = await page1.evaluate(() => {
        const circle = document.querySelector('[data-testid="city-map-peer-marker"] circle');
        if (!circle) return null;
        return {
          cx: parseFloat(circle.getAttribute("cx") || "0"),
          cy: parseFloat(circle.getAttribute("cy") || "0"),
        };
      });
      expect(initialMapPeerPosP1).not.toBeNull();

      const initialMapPeerPosP2 = await page2.evaluate(() => {
        const circle = document.querySelector('[data-testid="city-map-peer-marker"] circle');
        if (!circle) return null;
        return {
          cx: parseFloat(circle.getAttribute("cx") || "0"),
          cy: parseFloat(circle.getAttribute("cy") || "0"),
        };
      });
      expect(initialMapPeerPosP2).not.toBeNull();

      // GAP 1 FIX: Capture settled authoritative participant positions and sequence baselines BEFORE controls
      const baselineP1 = await page1.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const self = last?.participants?.find((p: any) => p.username === "jamtin");
        const peer = last?.participants?.find((p: any) => p.username === "jamtin2");
        return {
          seq: last?.seq ?? 0,
          selfInputSeq: self?.lastInputSeq ?? 0,
          peerInputSeq: peer?.lastInputSeq ?? 0,
          selfSpeed: self?.speed ?? 0,
          peerSpeed: peer?.speed ?? 0,
          selfPos: self ? { x: self.x, z: self.z } : null,
          peerPos: peer ? { x: peer.x, z: peer.z } : null,
        };
      });

      const baselineP2 = await page2.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const self = last?.participants?.find((p: any) => p.username === "jamtin2");
        const peer = last?.participants?.find((p: any) => p.username === "jamtin");
        return {
          seq: last?.seq ?? 0,
          selfInputSeq: self?.lastInputSeq ?? 0,
          peerInputSeq: peer?.lastInputSeq ?? 0,
          selfSpeed: self?.speed ?? 0,
          peerSpeed: peer?.speed ?? 0,
          selfPos: self ? { x: self.x, z: self.z } : null,
          peerPos: peer ? { x: peer.x, z: peer.z } : null,
        };
      });

      // Retain evidence that pre-controls baseline is settled (zero speed, stable positions)
      expect(Math.abs(baselineP1.selfSpeed)).toBeLessThan(0.01);
      expect(Math.abs(baselineP1.peerSpeed)).toBeLessThan(0.01);
      expect(Math.abs(baselineP2.selfSpeed)).toBeLessThan(0.01);
      expect(Math.abs(baselineP2.peerSpeed)).toBeLessThan(0.01);
      console.log(`[Baseline Evidence Full] P1: ${JSON.stringify(baselineP1)}, P2: ${JSON.stringify(baselineP2)}`);

      recordStage("Settled pre-controls baseline recorded");

      // Exercise visible player controls: trigger throttle on both clients using genuine pointer hit testing
      const throttle1 = page1.locator('button[data-drive-action="throttle"]');
      await expect(throttle1).toBeVisible({ timeout: 20_000 });
      const box1 = await throttle1.boundingBox();
      expect(box1).not.toBeNull();

      const throttle2 = page2.locator('button[data-drive-action="throttle"]');
      await expect(throttle2).toBeVisible({ timeout: 20_000 });
      const box2 = await throttle2.boundingBox();
      expect(box2).not.toBeNull();

      // 1. Diagnose elementFromPoint at each throttle centre after maps are open
      const hit1 = await page1.evaluate((b) => {
        const cx = b!.x + b!.width / 2;
        const cy = b!.y + b!.height / 2;
        const el = document.elementFromPoint(cx, cy);
        return {
          cx, cy,
          tag: el?.tagName,
          driveAction: el?.getAttribute("data-drive-action"),
          testId: el?.getAttribute("data-testid"),
          closestDriveAction: el?.closest("[data-drive-action]")?.getAttribute("data-drive-action"),
          closestMap: el?.closest('[data-testid="player-map"]')?.tagName ?? null,
        };
      }, box1);

      const hit2 = await page2.evaluate((b) => {
        const cx = b!.x + b!.width / 2;
        const cy = b!.y + b!.height / 2;
        const el = document.elementFromPoint(cx, cy);
        return {
          cx, cy,
          tag: el?.tagName,
          driveAction: el?.getAttribute("data-drive-action"),
          testId: el?.getAttribute("data-testid"),
          closestDriveAction: el?.closest("[data-drive-action]")?.getAttribute("data-drive-action"),
          closestMap: el?.closest('[data-testid="player-map"]')?.tagName ?? null,
        };
      }, box2);
      console.log(`[Diagnostic Hit Test] P1: ${JSON.stringify(hit1)}, P2: ${JSON.stringify(hit2)}`);

      // 2. Pre-down document focus and visibility state
      const focusPre = await Promise.all([
        page1.evaluate(() => ({ hasFocus: document.hasFocus(), visibilityState: document.visibilityState })),
        page2.evaluate(() => ({ hasFocus: document.hasFocus(), visibilityState: document.visibilityState })),
      ]);
      console.log(`[Diagnostic Focus Pre-Down] P1: ${JSON.stringify(focusPre[0])}, P2: ${JSON.stringify(focusPre[1])}`);

      // Engage throttle via genuine mouse down on visible hit targets
      await page1.mouse.move(box1!.x + box1!.width / 2, box1!.y + box1!.height / 2);
      await page1.mouse.down();

      const focusAfterP1Down = await Promise.all([
        page1.evaluate(() => ({ hasFocus: document.hasFocus(), visibilityState: document.visibilityState })),
        page2.evaluate(() => ({ hasFocus: document.hasFocus(), visibilityState: document.visibilityState })),
      ]);
      console.log(`[Diagnostic Focus After P1 Down] P1: ${JSON.stringify(focusAfterP1Down[0])}, P2: ${JSON.stringify(focusAfterP1Down[1])}`);

      await page2.mouse.move(box2!.x + box2!.width / 2, box2!.y + box2!.height / 2);
      await page2.mouse.down();

      const focusAfterP2Down = await Promise.all([
        page1.evaluate(() => ({ hasFocus: document.hasFocus(), visibilityState: document.visibilityState })),
        page2.evaluate(() => ({ hasFocus: document.hasFocus(), visibilityState: document.visibilityState })),
      ]);
      console.log(`[Diagnostic Focus After P2 Down] P1: ${JSON.stringify(focusAfterP2Down[0])}, P2: ${JSON.stringify(focusAfterP2Down[1])}`);

      console.log("Throttle engaged on both players via genuine pointer hit testing.");
      recordStage("Throttle engaged via genuine pointer hit testing");

      // Sample post-down state after 1.5s
      await page1.waitForTimeout(1500);
      const postDownSampling = await Promise.all([
        page1.evaluate((b) => {
          const colony = (window as any).__colony;
          const sent = (window as any).__sentInputs || [];
          const hist = (window as any).__snapshotHistory || [];
          const blurs = (window as any).__blurEvents || [];
          const lastSnap = hist[hist.length - 1];
          const selfSnap = lastSnap?.participants?.find((p: any) => p.username === "jamtin");
          return {
            player: "jamtin (P1)",
            hasFocus: document.hasFocus(),
            visibilityState: document.visibilityState,
            blurEvents: blurs,
            heldDriveInput: colony?.ownedDriveInput ?? "unavailable",
            sentInputsCount: sent.length,
            lastSentInputs: sent.slice(-3).map((inp: any) => ({
              type: inp.type,
              seq: inp.seq,
              epoch: inp.epoch,
              mode: inp.mode,
              throttle: inp.throttle,
              steer: inp.steer,
              brake: inp.brake,
            })),
            snapshotsCount: hist.length,
            lastServerSeq: lastSnap?.seq,
            baselineSeq: b.seq,
            seqAdvancing: lastSnap ? lastSnap.seq > b.seq : false,
            serverSelfSpeed: selfSnap?.speed,
            speedPositive: typeof selfSnap?.speed === "number" && selfSnap.speed > 0.1,
            serverSelfLastInputSeq: selfSnap?.lastInputSeq,
            baselineInputSeq: b.selfInputSeq,
            inputSeqAdvancing: typeof selfSnap?.lastInputSeq === "number" && selfSnap.lastInputSeq > b.selfInputSeq,
            snapshotTimestamp: lastSnap?.timestamp,
            snapshotAgeMs: lastSnap?.timestamp ? Date.now() - lastSnap.timestamp : null,
            clientStatus: colony?.getMultiplayerClient?.()?.getStatus?.(),
            sessionInfo: colony?.getMultiplayerClient?.()?.getSessionInfo?.(),
            modeEpoch: colony?.getMultiplayerClient?.()?.getModeEpoch?.(),
            closeEvents: (window as any).__closeEvents || [],
          };
        }, baselineP1),
        page2.evaluate((b) => {
          const colony = (window as any).__colony;
          const sent = (window as any).__sentInputs || [];
          const hist = (window as any).__snapshotHistory || [];
          const blurs = (window as any).__blurEvents || [];
          const lastSnap = hist[hist.length - 1];
          const selfSnap = lastSnap?.participants?.find((p: any) => p.username === "jamtin2");
          return {
            player: "jamtin2 (P2)",
            hasFocus: document.hasFocus(),
            visibilityState: document.visibilityState,
            blurEvents: blurs,
            heldDriveInput: colony?.ownedDriveInput ?? "unavailable",
            sentInputsCount: sent.length,
            lastSentInputs: sent.slice(-3).map((inp: any) => ({
              type: inp.type,
              seq: inp.seq,
              epoch: inp.epoch,
              mode: inp.mode,
              throttle: inp.throttle,
              steer: inp.steer,
              brake: inp.brake,
            })),
            snapshotsCount: hist.length,
            lastServerSeq: lastSnap?.seq,
            baselineSeq: b.seq,
            seqAdvancing: lastSnap ? lastSnap.seq > b.seq : false,
            serverSelfSpeed: selfSnap?.speed,
            speedPositive: typeof selfSnap?.speed === "number" && selfSnap.speed > 0.1,
            serverSelfLastInputSeq: selfSnap?.lastInputSeq,
            baselineInputSeq: b.selfInputSeq,
            inputSeqAdvancing: typeof selfSnap?.lastInputSeq === "number" && selfSnap.lastInputSeq > b.selfInputSeq,
            snapshotTimestamp: lastSnap?.timestamp,
            snapshotAgeMs: lastSnap?.timestamp ? Date.now() - lastSnap.timestamp : null,
            clientStatus: colony?.getMultiplayerClient?.()?.getStatus?.(),
            sessionInfo: colony?.getMultiplayerClient?.()?.getSessionInfo?.(),
            modeEpoch: colony?.getMultiplayerClient?.()?.getModeEpoch?.(),
            closeEvents: (window as any).__closeEvents || [],
          };
        }, baselineP2),
      ]);
      console.log(`[Diagnostic State 1.5s Post-Down] P1:\n${JSON.stringify(postDownSampling[0], null, 2)}`);
      console.log(`[Diagnostic State 1.5s Post-Down] P2:\n${JSON.stringify(postDownSampling[1], null, 2)}`);

      console.log(`[Diagnostic Server Session Count] count=${(realtime as any).sessions?.size ?? 0}`);
      for (const [sId, sess] of (realtime as any).sessions.entries()) {
        console.log(`[Diagnostic Server Session] ${sId}: participants=${sess.participants.size}`);
        for (const [pId, p] of sess.participants.entries()) {
          console.log(`[Diagnostic Server Participant]   ${p.username} (${pId}): lastInputSeq=${p.lastInputSeq}, speed=${p.speed}, pos=(${p.x}, ${p.z}), buffered=${(p.socket as any).bufferedAmount ?? 0}, lastSeenAgoMs=${Date.now() - p.lastSeenAt}`);
        }
      }

      // GAP 1: Concurrently assert advancing sequence, fresh monotonic input ack, positive throttle (speed > 0.1),
      // server participant displacement (>0.5m), 3D rendered displacement (>0.5m), and mini-map peer marker displacement (>0.2px)
      // across both clients under active throttle.
      await Promise.all([
        // GAP 1 VERIFICATION A: Assert advancing sequence, fresh monotonic input ack, and positive throttle accepted at server (speed > 0.1)
        page1.waitForFunction((b) => {
          const colony = (window as any).__colony;
          const mp = colony?.getMultiplayerClient();
          if (mp && mp.getStatus() !== "connected") {
            return false; // Positive cached history must not pass after authority lost
          }
          const history = (window as any).__snapshotHistory || [];
          if (!history.length) return false;
          const last = history[history.length - 1];
          const self = last.participants?.find((p: any) => p.username === "jamtin");
          return (
            last.seq > b.seq &&
            typeof self?.lastInputSeq === "number" &&
            self.lastInputSeq > b.selfInputSeq &&
            typeof self?.speed === "number" &&
            self.speed > 0.1
          );
        }, baselineP1, { timeout: 30_000 }),

        page2.waitForFunction((b) => {
          const colony = (window as any).__colony;
          const mp = colony?.getMultiplayerClient();
          if (mp && mp.getStatus() !== "connected") {
            return false; // Positive cached history must not pass after authority lost
          }
          const history = (window as any).__snapshotHistory || [];
          if (!history.length) return false;
          const last = history[history.length - 1];
          const self = last.participants?.find((p: any) => p.username === "jamtin2");
          return (
            last.seq > b.seq &&
            typeof self?.lastInputSeq === "number" &&
            self.lastInputSeq > b.selfInputSeq &&
            typeof self?.speed === "number" &&
            self.speed > 0.1
          );
        }, baselineP2, { timeout: 30_000 }),

        // GAP 1 VERIFICATION B: Assert actual server participant displacement from pre-control baseline (>0.5m)
        page1.waitForFunction((b) => {
          const history = (window as any).__snapshotHistory || [];
          if (!history.length) return false;
          const last = history[history.length - 1];
          const self = last.participants?.find((p: any) => p.username === "jamtin");
          const peer = last.participants?.find((p: any) => p.username === "jamtin2");
          if (!self || !peer || !b.selfPos || !b.peerPos) return false;
          const selfMoved = Math.hypot(self.x - b.selfPos.x, self.z - b.selfPos.z) > 0.5;
          const peerMoved = Math.hypot(peer.x - b.peerPos.x, peer.z - b.peerPos.z) > 0.5;
          return selfMoved && peerMoved;
        }, baselineP1, { timeout: 30_000 }),

        // Assert rendered 3D world movement for BOTH clients
        page1.waitForFunction((initial) => {
          const scene = (window as any).__r3fScene;
          let current: { x: number; z: number } | null = null;
          scene?.traverse((o: any) => {
            if (o.name && o.name.includes("remote-racer-jamtin2")) {
              current = { x: o.position.x, z: o.position.z };
            }
          });
          if (!current || !initial) return false;
          return Math.hypot(current.x - initial.x, current.z - initial.z) > 0.5;
        }, initial3DPosP1, { timeout: 30_000 }),

        page2.waitForFunction((initial) => {
          const scene = (window as any).__r3fScene;
          let current: { x: number; z: number } | null = null;
          scene?.traverse((o: any) => {
            if (o.name && o.name.includes("remote-racer-jamtin")) {
              current = { x: o.position.x, z: o.position.z };
            }
          });
          if (!current || !initial) return false;
          return Math.hypot(current.x - initial.x, current.z - initial.z) > 0.5;
        }, initial3DPosP2, { timeout: 30_000 }),

        // Assert mini-map peer marker displacement (>0.2px) achieved under active controls on BOTH clients BEFORE braking
        page1.waitForFunction((initial) => {
          const circle = document.querySelector('[data-testid="city-map-peer-marker"] circle');
          if (!circle) return false;
          const cx = parseFloat(circle.getAttribute("cx") || "0");
          const cy = parseFloat(circle.getAttribute("cy") || "0");
          return Math.hypot(cx - initial.cx, cy - initial.cy) > 0.2;
        }, initialMapPeerPosP1, { timeout: 30_000 }),

        page2.waitForFunction((initial) => {
          const circle = document.querySelector('[data-testid="city-map-peer-marker"] circle');
          if (!circle) return false;
          const cx = parseFloat(circle.getAttribute("cx") || "0");
          const cy = parseFloat(circle.getAttribute("cy") || "0");
          return Math.hypot(cx - initial.cx, cy - initial.cy) > 0.2;
        }, initialMapPeerPosP2, { timeout: 30_000 }),
      ]);

      console.log("Authoritative Fastify snapshots verified: fresh monotonic input ack and positive throttle speed (>0.1m/s) accepted at server.");
      console.log("Authoritative server participant displacement verified (>0.5m) for both players from pre-control baseline.");
      console.log("Rendered 3D scene displacement verified for BOTH remote racers (>0.5m).");
      recordStage("Authoritative server and 3D/map displacement verified under active throttle");

      // Neutralize throttle immediately via genuine pointer up to bound vehicle travel within safe dry road corridor
      await page1.mouse.up();
      await page2.mouse.up();

      // Engage brake via genuine pointer down
      const brake1 = page1.locator('button[data-drive-action="brake"]');
      await expect(brake1).toBeVisible({ timeout: 10_000 });
      const brakeBox1 = await brake1.boundingBox();
      if (brakeBox1) {
        await page1.mouse.move(brakeBox1.x + brakeBox1.width / 2, brakeBox1.y + brakeBox1.height / 2);
        await page1.mouse.down();
      }

      const brake2 = page2.locator('button[data-drive-action="brake"]');
      await expect(brake2).toBeVisible({ timeout: 10_000 });
      const brakeBox2 = await brake2.boundingBox();
      if (brakeBox2) {
        await page2.mouse.move(brakeBox2.x + brakeBox2.width / 2, brakeBox2.y + brakeBox2.height / 2);
        await page2.mouse.down();
      }

      // Wait until both participants come to a settled stop (speed < 0.01) at the server
      await Promise.all([
        page1.waitForFunction(() => {
          const history = (window as any).__snapshotHistory || [];
          if (!history.length) return false;
          const last = history[history.length - 1];
          const self = last.participants?.find((p: any) => p.username === "jamtin");
          const peer = last.participants?.find((p: any) => p.username === "jamtin2");
          return self && peer && Math.abs(self.speed) < 0.01 && Math.abs(peer.speed) < 0.01;
        }, undefined, { timeout: 15_000 }),
        page2.waitForFunction(() => {
          const history = (window as any).__snapshotHistory || [];
          if (!history.length) return false;
          const last = history[history.length - 1];
          const self = last.participants?.find((p: any) => p.username === "jamtin2");
          const peer = last.participants?.find((p: any) => p.username === "jamtin");
          return self && peer && Math.abs(self.speed) < 0.01 && Math.abs(peer.speed) < 0.01;
        }, undefined, { timeout: 15_000 }),
      ]);

      await page1.mouse.up();
      await page2.mouse.up();
      recordStage("Driving controls neutralized and both vehicles brought to a settled stop");

      // Capture explicit screenshots of settled vehicles
      const ssDir = path.resolve("test-results/actual-pair-screenshots");
      if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
      await page1.screenshot({ path: path.join(ssDir, "page1-driving.png") });
      await page2.screenshot({ path: path.join(ssDir, "page2-driving.png") });
      recordStage("Explicit driving/settled screenshots saved");

      // Verify settled vehicle positions remain strictly within the validated dry road corridor
      // converting canonical world metres to grid cell units via authoritative terrain frame (tSize, cellMetres = 4),
      // with finite bounds validation, proper y/z units, and terrain/exit candidate inspection.
      const settledCorridorInspection = await page1.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const self = last?.participants?.find((p: any) => p.username === "jamtin");
        const peer = last?.participants?.find((p: any) => p.username === "jamtin2");
        const colony = (window as any).__colony;
        const terrain = colony?.sim?.state?.terrain;
        const tSize = typeof terrain?.size === "number" && Number.isFinite(terrain.size) ? terrain.size : 512;
        const cellMetres = 4;

        if (!self || !peer) return null;

        // Convert authoritative server snapshot world metres to canonical grid cells
        const selfCellFromWorld = {
          x: self.x / cellMetres + tSize / 2,
          y: self.z / cellMetres + tSize / 2,
        };
        const peerCellFromWorld = {
          x: peer.x / cellMetres + tSize / 2,
          y: peer.z / cellMetres + tSize / 2,
        };

        // Correlated live runtime cell poses
        const selfRuntimePose = colony?.getOwnedDrivePose?.();
        const selfRuntimeCell = selfRuntimePose ? { x: selfRuntimePose.x, y: selfRuntimePose.y } : null;
        const peerRacer = colony?.sim?.state?.remoteRacers?.get(peer.participantId);
        const peerRuntimeCell = peerRacer?.cell ? { x: peerRacer.cell.x, y: peerRacer.cell.y } : null;

        // Inspect terrain and exit candidates around Player 1 settled position
        const roundedX = Math.round(selfCellFromWorld.x);
        const roundedY = Math.round(selfCellFromWorld.y);
        const isSelfWater = terrain?.isWater ? terrain.isWater(roundedX, roundedY) : false;
        const selfBlockedReason = colony?.blockedStepReason ? colony.blockedStepReason(roundedX, roundedY) : null;

        // Check candidate exit cells within 1-cell radius as used by exitOwnedCar
        const candidateOffsets = [
          { dx: 0, dy: 1 },
          { dx: 0, dy: -1 },
          { dx: 1, dy: 0 },
          { dx: -1, dy: 0 },
          { dx: 1, dy: 1 },
          { dx: 1, dy: -1 },
          { dx: -1, dy: 1 },
          { dx: -1, dy: -1 },
        ];
        const validExitCandidates = candidateOffsets
          .map((off) => ({ x: roundedX + off.dx, y: roundedY + off.dy }))
          .filter((c) => {
            if (c.x < 2 || c.x >= tSize - 2 || c.y < 2 || c.y >= tSize - 2) return false;
            const water = terrain?.isWater ? terrain.isWater(c.x, c.y) : false;
            const blocked = colony?.blockedStepReason ? colony.blockedStepReason(c.x, c.y) : null;
            return !water && blocked === null;
          });

        return {
          selfWorld: { x: self.x, z: self.z },
          peerWorld: { x: peer.x, z: peer.z },
          selfCellFromWorld,
          peerCellFromWorld,
          selfRuntimeCell,
          peerRuntimeCell,
          tSize,
          cellMetres,
          selfTerrain: {
            roundedCell: { x: roundedX, y: roundedY },
            isWater: isSelfWater,
            blockedReason: selfBlockedReason,
          },
          validExitCandidatesCount: validExitCandidates.length,
          validExitCandidates,
        };
      });

      expect(settledCorridorInspection, "Settled corridor inspection payload must be present").not.toBeNull();

      // Finite bounds validation on both world and grid frames
      expect(Number.isFinite(settledCorridorInspection!.selfWorld.x)).toBe(true);
      expect(Number.isFinite(settledCorridorInspection!.selfWorld.z)).toBe(true);
      expect(Number.isFinite(settledCorridorInspection!.peerWorld.x)).toBe(true);
      expect(Number.isFinite(settledCorridorInspection!.peerWorld.z)).toBe(true);
      expect(Number.isFinite(settledCorridorInspection!.selfCellFromWorld.x)).toBe(true);
      expect(Number.isFinite(settledCorridorInspection!.selfCellFromWorld.y)).toBe(true);
      expect(Number.isFinite(settledCorridorInspection!.peerCellFromWorld.x)).toBe(true);
      expect(Number.isFinite(settledCorridorInspection!.peerCellFromWorld.y)).toBe(true);

      // Verify correlation between converted snapshot coordinates and live runtime cell pose
      if (settledCorridorInspection!.selfRuntimeCell) {
        expect(
          Math.hypot(
            settledCorridorInspection!.selfCellFromWorld.x - settledCorridorInspection!.selfRuntimeCell.x,
            settledCorridorInspection!.selfCellFromWorld.y - settledCorridorInspection!.selfRuntimeCell.y,
          ),
        ).toBeLessThan(0.5);
      }
      if (settledCorridorInspection!.peerRuntimeCell) {
        expect(
          Math.hypot(
            settledCorridorInspection!.peerCellFromWorld.x - settledCorridorInspection!.peerRuntimeCell.x,
            settledCorridorInspection!.peerCellFromWorld.y - settledCorridorInspection!.peerRuntimeCell.y,
          ),
        ).toBeLessThan(0.5);
      }

      // Assert lower and upper corridor bounds in grid cells (dry road pavement is between cell 135 and 162)
      expect(settledCorridorInspection!.selfCellFromWorld.x).toBeGreaterThanOrEqual(139);
      expect(settledCorridorInspection!.selfCellFromWorld.x).toBeLessThanOrEqual(155);
      expect(settledCorridorInspection!.peerCellFromWorld.x).toBeGreaterThanOrEqual(139);
      expect(settledCorridorInspection!.peerCellFromWorld.x).toBeLessThanOrEqual(155);

      // Assert proper y/z units along the road corridor (corridor centerline y = 265)
      expect(Math.abs(settledCorridorInspection!.selfCellFromWorld.y - 265)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(settledCorridorInspection!.peerCellFromWorld.y - 265)).toBeLessThanOrEqual(1.5);

      const expectedWorldZ =
        (265 - settledCorridorInspection!.tSize / 2) * settledCorridorInspection!.cellMetres;
      expect(Math.abs(settledCorridorInspection!.selfWorld.z - expectedWorldZ)).toBeLessThanOrEqual(6.0);
      expect(Math.abs(settledCorridorInspection!.peerWorld.z - expectedWorldZ)).toBeLessThanOrEqual(6.0);

      // Inspect hydrated terrain and ensure valid exit candidates exist at parked cell
      expect(settledCorridorInspection!.selfTerrain.isWater).toBe(false);
      expect(settledCorridorInspection!.selfTerrain.blockedReason).toBeNull();
      expect(settledCorridorInspection!.validExitCandidatesCount).toBeGreaterThan(0);

      console.log(
        `Corridor qualification verified: P1 settled at cell (${settledCorridorInspection!.selfCellFromWorld.x.toFixed(2)}, ${settledCorridorInspection!.selfCellFromWorld.y.toFixed(2)}) / world (${settledCorridorInspection!.selfWorld.x.toFixed(2)}m, ${settledCorridorInspection!.selfWorld.z.toFixed(2)}m). Water=false, blocked=null, ${settledCorridorInspection!.validExitCandidatesCount} passable exit candidates available.`,
      );
      recordStage("Settled vehicle positions qualified within dry corridor bounds with hydrated terrain verification");

      // Verify numerical alignment between settled 3D rendered position and received Fastify snapshot for BOTH peers (< 0.5m)
      await Promise.all([
        page1.waitForFunction(() => {
          const history = (window as any).__snapshotHistory || [];
          const last = history[history.length - 1];
          const part2 = last?.participants?.find((p: any) => p.username === "jamtin2");
          const scene = (window as any).__r3fScene;
          let pos3d: { x: number; z: number } | null = null;
          scene?.traverse((o: any) => {
            if (o.name && o.name.includes("remote-racer-jamtin2")) {
              pos3d = { x: o.position.x, z: o.position.z };
            }
          });
          if (!part2 || !pos3d) return false;
          return Math.hypot(pos3d.x - part2.x, pos3d.z - part2.z) < 0.5;
        }, undefined, { timeout: 10_000 }),
        page2.waitForFunction(() => {
          const history = (window as any).__snapshotHistory || [];
          const last = history[history.length - 1];
          const part1 = last?.participants?.find((p: any) => p.username === "jamtin");
          const scene = (window as any).__r3fScene;
          let pos3d: { x: number; z: number } | null = null;
          scene?.traverse((o: any) => {
            if (o.name && o.name.includes("remote-racer-jamtin")) {
              pos3d = { x: o.position.x, z: o.position.z };
            }
          });
          if (!part1 || !pos3d) return false;
          return Math.hypot(pos3d.x - part1.x, pos3d.z - part1.z) < 0.5;
        }, undefined, { timeout: 10_000 }),
      ]);

      const alignmentP1 = await page1.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const part2 = last?.participants?.find((p: any) => p.username === "jamtin2");
        const scene = (window as any).__r3fScene;
        let pos3d: { x: number; z: number } | null = null;
        scene?.traverse((o: any) => {
          if (o.name && o.name.includes("remote-racer-jamtin2")) {
            pos3d = { x: o.position.x, z: o.position.z };
          }
        });
        return { part2, pos3d };
      });
      expect(alignmentP1.part2).toBeDefined();
      expect(alignmentP1.pos3d).toBeDefined();
      const distP1 = Math.hypot(alignmentP1.pos3d!.x - alignmentP1.part2.x, alignmentP1.pos3d!.z - alignmentP1.part2.z);
      console.log(`Player 1 settled rendered 3D vs snapshot delta: ${distP1.toFixed(4)}m`);
      expect(distP1).toBeLessThan(0.5); // Strict 0.5m gate verified at settled stop

      const alignmentP2 = await page2.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const part1 = last?.participants?.find((p: any) => p.username === "jamtin");
        const scene = (window as any).__r3fScene;
        let pos3d: { x: number; z: number } | null = null;
        scene?.traverse((o: any) => {
          if (o.name && o.name.includes("remote-racer-jamtin")) {
            pos3d = { x: o.position.x, z: o.position.z };
          }
        });
        return { part1, pos3d };
      });
      expect(alignmentP2.part1).toBeDefined();
      expect(alignmentP2.pos3d).toBeDefined();
      const distP2 = Math.hypot(alignmentP2.pos3d!.x - alignmentP2.part1.x, alignmentP2.pos3d!.z - alignmentP2.part1.z);
      console.log(`Player 2 settled rendered 3D vs snapshot delta: ${distP2.toFixed(4)}m`);
      expect(distP2).toBeLessThan(0.5); // Strict 0.5m gate verified at settled stop

      recordStage("Settled 3D rendered position vs Fastify snapshot numerical alignment verified (<0.5m)");

      // GAP 2 FIX: Compare numeric map marker coordinates with documented projection of received authoritative participant
      const checkMapProjection = async (page: Page, peerUsername: string, initialPos: { cx: number; cy: number }) => {
        return page.evaluate(({ username, initial }) => {
          const circle = document.querySelector('[data-testid="city-map-peer-marker"] circle');
          if (!circle) return { ok: false, error: "Marker circle not found" };

          const cx = parseFloat(circle.getAttribute("cx") || "0");
          const cy = parseFloat(circle.getAttribute("cy") || "0");

          const markerDisplacement = Math.hypot(cx - initial.cx, cy - initial.cy);

          const colony = (window as any).__colony;
          const terrain = colony.sim?.state?.terrain;
          const size = terrain?.size ?? 608;
          const history = (window as any).__snapshotHistory || [];
          const last = history[history.length - 1];
          const peer = last?.participants?.find((p: any) => p.username === username);
          if (!peer) return { ok: false, error: "Peer not in latest snapshot" };

          const peerCell = { x: peer.x / 4 + size / 2, y: peer.z / 4 + size / 2 };

          const ways = colony.sim?.state?.roadWays ?? [];
          const stops = colony.busRoute?.stops ?? [];
          const depot = colony.busDepot?.site
            ? { x: colony.busDepot.site.x + (colony.busDepot.site.w - 1) / 2, y: colony.busDepot.site.y + (colony.busDepot.site.h - 1) / 2 }
            : null;
          const network = [...ways.flatMap((w: any) => w.path), ...stops, ...(depot ? [depot] : [])];
          const xs = network.map((p: any) => p.x);
          const ys = network.map((p: any) => p.y);
          const rawMinX = xs.length ? Math.min(...xs) : 0;
          const rawMaxX = xs.length ? Math.max(...xs) : 1;
          const rawMinY = ys.length ? Math.min(...ys) : 0;
          const rawMaxY = ys.length ? Math.max(...ys) : 1;
          const spanX = Math.max(1, rawMaxX - rawMinX);
          const spanY = Math.max(1, rawMaxY - rawMinY);
          const drawableW = Math.max(1, 200 - 16);
          const drawableH = Math.max(1, 132 - 16);
          const scale = Math.min(drawableW / spanX, drawableH / spanY);
          const usedW = spanX * scale;
          const usedH = spanY * scale;
          const ox = 8 + (drawableW - usedW) / 2;
          const oy = 8 + (drawableH - usedH) / 2;
          const expectedX = Math.min(200 - 8, Math.max(8, ox + (peerCell.x - rawMinX) * scale));
          const expectedY = Math.min(132 - 8, Math.max(8, oy + (peerCell.y - rawMinY) * scale));

          const projectionDelta = Math.hypot(cx - expectedX, cy - expectedY);

          return {
            ok: true,
            cx,
            cy,
            expectedX,
            expectedY,
            markerDisplacement,
            projectionDelta,
          };
        }, { username: peerUsername, initial: initialPos });
      };

      // Bounded diagnosis: Query live status, last seq, peer marker coordinates, expected projection, and ws events BEFORE wait
      const diagP1 = await page1.evaluate((initial) => {
        const colony = (window as any).__colony;
        const mp = colony?.getMultiplayerClient();
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const circle = document.querySelector('[data-testid="city-map-peer-marker"] circle');
        const cx = circle ? parseFloat(circle.getAttribute("cx") || "0") : null;
        const cy = circle ? parseFloat(circle.getAttribute("cy") || "0") : null;
        const racers = Array.from(colony?.sim?.state?.remoteRacers?.entries() ?? []).map(([k, v]: [any, any]) => ({
          id: k,
          user: v.username,
          cell: v.cell,
          heading: v.heading,
          speed: v.speed,
        }));
        const rawEvents = (window as any).__wsEvents || [];
        const sInfo = mp?.getSessionInfo ? mp.getSessionInfo() : null;
        return {
          status: mp?.getStatus(),
          sessionInfo: sInfo ? { sessionId: sInfo.sessionId, participantId: sInfo.participantId, inviteCode: sInfo.inviteCode } : null,
          lastSeq: last?.seq,
          snapshotParticipants: last?.participants?.map((p: any) => ({
            id: p.participantId,
            user: p.username,
            x: p.x,
            z: p.z,
            speed: p.speed,
          })),
          remoteRacers: racers,
          initialMapPos: initial,
          currentMapPos: cx !== null ? { cx, cy } : null,
          displacement: cx !== null && initial ? Math.hypot(cx - initial.cx, cy - initial.cy) : null,
          wsEvents: rawEvents.map((e: any) => ({
            type: e.type,
            endpoint: e.endpoint,
            code: e.code,
            reason: e.reason,
            msgType: e.msgType,
            error: e.error,
          })),
        };
      }, initialMapPeerPosP1);
      console.log("[Diagnostic Map P1 before wait]:", JSON.stringify(diagP1));

      const diagP2 = await page2.evaluate((initial) => {
        const colony = (window as any).__colony;
        const mp = colony?.getMultiplayerClient();
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const circle = document.querySelector('[data-testid="city-map-peer-marker"] circle');
        const cx = circle ? parseFloat(circle.getAttribute("cx") || "0") : null;
        const cy = circle ? parseFloat(circle.getAttribute("cy") || "0") : null;
        const racers = Array.from(colony?.sim?.state?.remoteRacers?.entries() ?? []).map(([k, v]: [any, any]) => ({
          id: k,
          user: v.username,
          cell: v.cell,
          heading: v.heading,
          speed: v.speed,
        }));
        const rawEvents = (window as any).__wsEvents || [];
        const sInfo = mp?.getSessionInfo ? mp.getSessionInfo() : null;
        return {
          status: mp?.getStatus(),
          sessionInfo: sInfo ? { sessionId: sInfo.sessionId, participantId: sInfo.participantId, inviteCode: sInfo.inviteCode } : null,
          lastSeq: last?.seq,
          snapshotParticipants: last?.participants?.map((p: any) => ({
            id: p.participantId,
            user: p.username,
            x: p.x,
            z: p.z,
            speed: p.speed,
          })),
          remoteRacers: racers,
          initialMapPos: initial,
          currentMapPos: cx !== null ? { cx, cy } : null,
          displacement: cx !== null && initial ? Math.hypot(cx - initial.cx, cy - initial.cy) : null,
          wsEvents: rawEvents.map((e: any) => ({
            type: e.type,
            endpoint: e.endpoint,
            code: e.code,
            reason: e.reason,
            msgType: e.msgType,
            error: e.error,
          })),
        };
      }, initialMapPeerPosP2);
      console.log("[Diagnostic Map P2 before wait]:", JSON.stringify(diagP2));

      // Verify numeric mini-map marker projection matches authoritative snapshot on both clients (<0.5px subpixel tolerance, displacement >0.2px)

      const mapResultP1 = await checkMapProjection(page1, "jamtin2", initialMapPeerPosP1!);
      expect(mapResultP1.ok).toBe(true);
      console.log(`Player 1 map marker: cx=${mapResultP1.cx?.toFixed(2)}, expected=${mapResultP1.expectedX?.toFixed(2)}, delta=${mapResultP1.projectionDelta?.toFixed(3)}px`);
      expect(mapResultP1.markerDisplacement).toBeGreaterThan(0.2);
      expect(mapResultP1.projectionDelta).toBeLessThan(0.5); // Justified subpixel tolerance <0.5px

      const mapResultP2 = await checkMapProjection(page2, "jamtin", initialMapPeerPosP2!);
      expect(mapResultP2.ok).toBe(true);
      console.log(`Player 2 map marker: cx=${mapResultP2.cx?.toFixed(2)}, expected=${mapResultP2.expectedX?.toFixed(2)}, delta=${mapResultP2.projectionDelta?.toFixed(3)}px`);
      expect(mapResultP2.markerDisplacement).toBeGreaterThan(0.2);
      expect(mapResultP2.projectionDelta).toBeLessThan(0.5); // Justified subpixel tolerance <0.5px

      console.log("Numeric mini-map peer marker projection verified on BOTH clients within justified subpixel tolerance (<0.5px).");
      recordStage("Numeric mini-map peer marker projections verified on both clients");

      // Close mini-map modals on both players via genuine pointer click so that the 3D scene
      // is not obscured by the map overlay during peer avatar / car mode transition visual inspection
      const closeMapP1 = page1.locator('[data-testid="city-map-toggle"]');
      if (await closeMapP1.isVisible()) {
        await closeMapP1.click();
      }
      const closeMapP2 = page2.locator('[data-testid="city-map-toggle"]');
      if (await closeMapP2.isVisible()) {
        await closeMapP2.click();
      }
      recordStage("Mini-maps closed to enable unobstructed 3D scene visual capture");

      // Next bounded slice: prove the SAME mounted participant changes driving -> walking -> driving
      // through actual game controls, with exact participantId pinning, peer car/pedestrian mesh inspection,
      // and peer membership and parked-vehicle pose checks in both views.
      recordStage("Starting driving -> walking -> driving transition via actual game controls");

      // Capture authoritative participant IDs and parked car pose baseline before transition
      const preTransitionP1 = await page1.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const p1 = last?.participants?.find((p: any) => p.username === "jamtin");
        const p2 = last?.participants?.find((p: any) => p.username === "jamtin2");
        return {
          participantCount: last?.participants?.length ?? 0,
          p1: p1 ? { participantId: p1.participantId, x: p1.x, y: p1.y, z: p1.z, heading: p1.heading, isPedestrian: p1.isPedestrian } : null,
          p2: p2 ? { participantId: p2.participantId, x: p2.x, y: p2.y, z: p2.z, heading: p2.heading, isPedestrian: p2.isPedestrian } : null,
        };
      });

      const preTransitionP2 = await page2.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const p1 = last?.participants?.find((p: any) => p.username === "jamtin");
        const p2 = last?.participants?.find((p: any) => p.username === "jamtin2");
        return {
          participantCount: last?.participants?.length ?? 0,
          p1: p1 ? { participantId: p1.participantId, x: p1.x, y: p1.y, z: p1.z, heading: p1.heading, isPedestrian: p1.isPedestrian } : null,
          p2: p2 ? { participantId: p2.participantId, x: p2.x, y: p2.y, z: p2.z, heading: p2.heading, isPedestrian: p2.isPedestrian } : null,
        };
      });

      expect(preTransitionP1.participantCount).toBe(2);
      expect(preTransitionP2.participantCount).toBe(2);
      expect(preTransitionP1.p1?.participantId).toBeDefined();
      expect(preTransitionP1.p2?.participantId).toBeDefined();
      expect(preTransitionP1.p1?.participantId).toBe(preTransitionP2.p1?.participantId);
      expect(preTransitionP1.p2?.participantId).toBe(preTransitionP2.p2?.participantId);
      expect(preTransitionP1.p1?.isPedestrian).toBe(false);
      expect(preTransitionP1.p2?.isPedestrian).toBe(false);

      const pinnedParticipantId1 = preTransitionP1.p1!.participantId;
      const pinnedParticipantId2 = preTransitionP1.p2!.participantId;
      const parkedCarPose1 = {
        x: preTransitionP1.p1!.x,
        y: preTransitionP1.p1!.y,
        z: preTransitionP1.p1!.z,
      };

      console.log(`Pre-transition pinned participant IDs: P1=${pinnedParticipantId1}, P2=${pinnedParticipantId2}`);
      console.log(`Pre-transition parked car pose: x=${parkedCarPose1.x.toFixed(2)}, z=${parkedCarPose1.z.toFixed(2)}`);

      // 1. Player 1 exits vehicle via genuine pointer click on "Park & Exit"
      const exitBtn1 = page1.locator('[data-testid="exit-owned-car"]');
      await expect(exitBtn1).toBeVisible({ timeout: 10_000 });
      await exitBtn1.click();
      recordStage("Player 1 clicked Park & Exit");

      // 2. Verify authoritative server snapshot reflects Player 1 walking / pedestrian mode
      // while strictly pinning participantId, retaining 2-peer membership, and checking walking proximity to parked car
      try {
        await Promise.all([
          page1.waitForFunction((expected) => {
            const history = (window as any).__snapshotHistory || [];
            const last = history[history.length - 1];
            if (!last || last.participants?.length !== 2) return false;
            const p1 = last.participants.find((p: any) => p.username === "jamtin");
            const p2 = last.participants.find((p: any) => p.username === "jamtin2");
            return (
              p1?.participantId === expected.p1Id &&
              p2?.participantId === expected.p2Id &&
              p1.isPedestrian === true &&
              p2.isPedestrian === false
            );
          }, { p1Id: pinnedParticipantId1, p2Id: pinnedParticipantId2 }, { timeout: 15_000 }),
          page2.waitForFunction((expected) => {
            const history = (window as any).__snapshotHistory || [];
            const last = history[history.length - 1];
            if (!last || last.participants?.length !== 2) return false;
            const p1 = last.participants.find((p: any) => p.username === "jamtin");
            const p2 = last.participants.find((p: any) => p.username === "jamtin2");
            return (
              p1?.participantId === expected.p1Id &&
              p2?.participantId === expected.p2Id &&
              p1.isPedestrian === true &&
              p2.isPedestrian === false
            );
          }, { p1Id: pinnedParticipantId1, p2Id: pinnedParticipantId2 }, { timeout: 15_000 }),
        ]);
      } catch (err) {
        await dumpTransitionDiagnostics(page1, "Page 1 Park & Exit");
        await dumpTransitionDiagnostics(page2, "Page 2 Park & Exit");
        throw err;
      }
      recordStage("Authoritative server snapshot verified Player 1 in walking/pedestrian mode with pinned participantId and retained peer membership");

      // Also verify walking position on server is in legitimate proximity to parked car (< 16m)
      const walkingPosP1 = await page1.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const p1 = last?.participants?.find((p: any) => p.username === "jamtin");
        return p1 ? { x: p1.x, z: p1.z } : null;
      });
      expect(walkingPosP1).toBeDefined();
      const exitDistFromParked = Math.hypot(walkingPosP1!.x - parkedCarPose1.x, walkingPosP1!.z - parkedCarPose1.z);
      console.log(`Player 1 exit walking position distance from parked car: ${exitDistFromParked.toFixed(2)}m`);
      expect(exitDistFromParked).toBeLessThan(16); // Legitimate exit distance (< 16m)

      // 3. Observe mounted child geometry/model identity independently on Player 2 for Player 1:
      // Must find pedestrian crab visual (group named pedestrian-crab-*, vertex-colored crab mesh),
      // correct mode ("walking") / isPedestrian (true) on target group userData, and NO car geometries (BoxGeometry / CylinderGeometry).
      await page2.waitForFunction((expectedId) => {
        const scene = (window as any).__r3fScene;
        let targetGroup: any = null;
        scene?.traverse((o: any) => {
          if (o.userData?.participantId === expectedId) {
            targetGroup = o;
          }
        });
        if (!targetGroup) return false;

        const isPedestrian = targetGroup.userData?.isPedestrian === true;
        const isWalking = targetGroup.userData?.mode === "walking";

        let hasCrabMesh = false;
        let hasCrabGroup = false;
        const geoTypes: string[] = [];
        targetGroup.traverse((child: any) => {
          if (child.name && typeof child.name === "string" && child.name.startsWith("pedestrian-crab-")) {
            hasCrabGroup = true;
          }
          if (child.isMesh && child.geometry) {
            if (child.geometry.type) geoTypes.push(child.geometry.type);
            if (child.geometry.attributes?.color && child.geometry.attributes?.position?.count > 0) {
              hasCrabMesh = true;
            }
          }
        });

        const hasBox = geoTypes.includes("BoxGeometry");
        const hasCylinder = geoTypes.includes("CylinderGeometry");

        return isPedestrian && isWalking && hasCrabGroup && hasCrabMesh && !hasBox && !hasCylinder;
      }, pinnedParticipantId1, { timeout: 15_000 });

      // Retain screenshot of visible pedestrian avatar
      const pedScreenshotPath = path.resolve("test-results/actual-pair-screenshots/page2-peer-as-pedestrian.png");
      await page2.screenshot({ path: pedScreenshotPath });
      console.log(`Player 2 view of Player 1 as pedestrian saved to: ${pedScreenshotPath}`);
      recordStage("Player 2 3D scene independently verified rendering Player 1 as pedestrian crab avatar (vertex-colored crab geometry) and captured screenshot");

      // 3.1. Observe that in Player 2's 3D scene, BOTH the walking pedestrian avatar AND the stationary parked car visual coexist
      await page2.waitForFunction(() => {
        const scene = (window as any).__r3fScene;
        let foundParkedCar = false;
        scene?.traverse((o: any) => {
          if (o.name && o.name.includes("remote-parked-car-jamtin")) {
            foundParkedCar = true;
          }
        });
        return foundParkedCar;
      }, undefined, { timeout: 15_000 });
      console.log("Player 2 3D scene verified rendering both Player 1 pedestrian avatar AND Player 1 stationary parked car visual.");

      // 3.2. Check mini-map on Player 2: peer parked car marker is owner-scoped (data-local="false") alongside walking peer marker
      const mapBtnP2 = page2.locator('[data-testid="player-map-shortcut"]');
      await mapBtnP2.click();
      const peerParkedMarker = page2.locator('[data-testid="city-map-parked-car-marker"][data-local="false"]');
      await expect(peerParkedMarker).toBeAttached({ timeout: 10_000 });
      await expect(peerParkedMarker).toHaveAttribute("data-parked-car-id", `peer-parked-${pinnedParticipantId1}`);
      await expect(peerParkedMarker).toHaveAttribute("aria-label", "Parked vehicle of jamtin");
      await mapBtnP2.click(); // close map

      // 3.3. Check mini-map on Player 1: local parked car marker is owner-scoped (data-local="true") alongside walking player
      const mapBtnP1 = page1.locator('[data-testid="player-map-shortcut"]');
      await mapBtnP1.click();
      const localParkedMarker = page1.locator('[data-testid="city-map-parked-car-marker"][data-local="true"]');
      await expect(localParkedMarker).toBeAttached({ timeout: 10_000 });
      await expect(localParkedMarker).toHaveAttribute("data-parked-car-id", "local-parked-car");
      await expect(localParkedMarker).toHaveAttribute("aria-label", "Your parked vehicle");
      await mapBtnP1.click(); // close map

      // 3.4. Control-driven walking movement (no teleport): dispatch walking forward & strafe via genuine controls
      // across both nominal and rotated-camera orientations, asserting actual directional vectors against live server
      await page1.bringToFront();
      await page1.locator("canvas").click();

      // Helper to release a walking key, capture release-time input baseline, match subsequent neutral packet seq,
      // and require server snapshot acknowledgement of that neutral packet (lastInputSeq >= neutralSeq) with speed === 0
      const releaseAndSettleWalkingKey = async (key: string) => {
        const releaseBaseline = await page1.evaluate(() => {
          const sent = (window as any).__sentInputs || [];
          const history = (window as any).__snapshotHistory || [];
          const last = history[history.length - 1];
          return {
            releaseInputCount: sent.length,
            releaseSnapSeq: typeof last?.seq === "number" && Number.isFinite(last.seq) ? last.seq : 0,
          };
        });

        await page1.keyboard.up(key);

        const neutralSeqHandle = await page1.waitForFunction((b) => {
          const sent = (window as any).__sentInputs || [];
          const fresh = sent.slice(b.releaseInputCount);
          const match = fresh.find(
            (msg: any) =>
              msg.type === "input" &&
              msg.mode === "walking" &&
              msg.forward === 0 &&
              msg.strafe === 0 &&
              typeof msg.seq === "number" &&
              Number.isFinite(msg.seq),
          );
          return match ? match.seq : false;
        }, releaseBaseline, { timeout: 15_000 });
        const neutralSeq = await neutralSeqHandle.jsonValue();
        expect(typeof neutralSeq).toBe("number");
        expect(Number.isFinite(neutralSeq)).toBe(true);

        await page1.waitForFunction((expected) => {
          const history = (window as any).__snapshotHistory || [];
          if (!history.length) return false;
          const last = history[history.length - 1];
          if (!last || typeof last.seq !== "number" || !Number.isFinite(last.seq) || last.seq <= expected.releaseSnapSeq) {
            return false;
          }
          const p1 = last.participants?.find((p: any) => p.username === "jamtin");
          if (!p1 || typeof p1.speed !== "number" || !Number.isFinite(p1.speed) || p1.speed !== 0) {
            return false;
          }
          return typeof p1.lastInputSeq === "number" && Number.isFinite(p1.lastInputSeq) && p1.lastInputSeq >= expected.neutralSeq;
        }, { releaseSnapSeq: releaseBaseline.releaseSnapSeq, neutralSeq }, { timeout: 15_000 });
      };

      // Step 3.4.1: Forward walking at heading ~ 0 (facing +X) with per-step fresh input and snapshot baseline
      const b0 = await page1.evaluate(() => {
        const sent = (window as any).__sentInputs || [];
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const p1 = last?.participants?.find((p: any) => p.username === "jamtin");
        if (
          !last ||
          typeof last.seq !== "number" ||
          !Number.isFinite(last.seq) ||
          !p1 ||
          typeof p1.x !== "number" ||
          !Number.isFinite(p1.x) ||
          typeof p1.z !== "number" ||
          !Number.isFinite(p1.z)
        ) {
          return null;
        }
        return {
          inputCount: sent.length,
          snapSeq: last.seq,
          x: p1.x,
          z: p1.z,
          lastInputSeq: typeof p1.lastInputSeq === "number" && Number.isFinite(p1.lastInputSeq) ? p1.lastInputSeq : -1,
        };
      });
      expect(b0, "Step 3.4.1 initial participant baseline authority must be present and finite").not.toBeNull();
      expect(Number.isFinite(b0!.snapSeq)).toBe(true);
      expect(Number.isFinite(b0!.x)).toBe(true);
      expect(Number.isFinite(b0!.z)).toBe(true);

      await page1.keyboard.down("KeyW");
      // Assert fresh input frame emitted after keydown (cannot match historical packets)
      await page1.waitForFunction((b) => {
        const sent = (window as any).__sentInputs || [];
        const fresh = sent.slice(b.inputCount);
        const match = fresh.find((msg: any) => msg.type === "input" && msg.mode === "walking" && msg.forward === 1 && msg.strafe === 0);
        if (match && typeof match.seq === "number") {
          (window as any).__lastMatchedWalkingInputSeq = match.seq;
          return true;
        }
        return false;
      }, b0, { timeout: 15_000 });

      // Assert newer server snapshot advancing sequence with correct directional vector (+X)
      await page1.waitForFunction((b) => {
        const history = (window as any).__snapshotHistory || [];
        if (!history.length) return false;
        const last = history[history.length - 1];
        if (!last || typeof last.seq !== "number" || !Number.isFinite(last.seq) || last.seq <= b.snapSeq) {
          return false;
        }
        const p1 = last.participants?.find((p: any) => p.username === "jamtin");
        if (!p1 || typeof p1.x !== "number" || !Number.isFinite(p1.x) || typeof p1.z !== "number" || !Number.isFinite(p1.z)) {
          return false;
        }
        const dx = p1.x - b.x;
        const dz = p1.z - b.z;
        // Forward at heading 0 moves strictly along +X; lateral drift in Z is small
        return dx > 0.25 && Math.abs(dz) < 0.15;
      }, b0, { timeout: 15_000 });
      await releaseAndSettleWalkingKey("KeyW");

      // Step 3.4.2: Strafe right at heading ~ 0 (moving +Z) with fresh baseline
      const b1 = await page1.evaluate(() => {
        const sent = (window as any).__sentInputs || [];
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const p1 = last?.participants?.find((p: any) => p.username === "jamtin");
        if (
          !last ||
          typeof last.seq !== "number" ||
          !Number.isFinite(last.seq) ||
          !p1 ||
          typeof p1.x !== "number" ||
          !Number.isFinite(p1.x) ||
          typeof p1.z !== "number" ||
          !Number.isFinite(p1.z)
        ) {
          return null;
        }
        return {
          inputCount: sent.length,
          snapSeq: last.seq,
          x: p1.x,
          z: p1.z,
          lastInputSeq: typeof p1.lastInputSeq === "number" && Number.isFinite(p1.lastInputSeq) ? p1.lastInputSeq : -1,
        };
      });
      expect(b1, "Step 3.4.2 initial participant baseline authority must be present and finite").not.toBeNull();
      expect(Number.isFinite(b1!.snapSeq)).toBe(true);
      expect(Number.isFinite(b1!.x)).toBe(true);
      expect(Number.isFinite(b1!.z)).toBe(true);

      await page1.keyboard.down("KeyD");
      // Assert fresh strafe input frame emitted after keydown
      await page1.waitForFunction((b) => {
        const sent = (window as any).__sentInputs || [];
        const fresh = sent.slice(b.inputCount);
        const match = fresh.find((msg: any) => msg.type === "input" && msg.mode === "walking" && msg.forward === 0 && msg.strafe === 1);
        if (match && typeof match.seq === "number") {
          (window as any).__lastMatchedWalkingInputSeq = match.seq;
          return true;
        }
        return false;
      }, b1, { timeout: 15_000 });

      // Assert newer server snapshot advancing sequence with correct strafe vector (+Z)
      await page1.waitForFunction((b) => {
        const history = (window as any).__snapshotHistory || [];
        if (!history.length) return false;
        const last = history[history.length - 1];
        if (!last || typeof last.seq !== "number" || !Number.isFinite(last.seq) || last.seq <= b.snapSeq) {
          return false;
        }
        const p1 = last.participants?.find((p: any) => p.username === "jamtin");
        if (!p1 || typeof p1.x !== "number" || !Number.isFinite(p1.x) || typeof p1.z !== "number" || !Number.isFinite(p1.z)) {
          return false;
        }
        const dx = p1.x - b.x;
        const dz = p1.z - b.z;
        // Strafe right at heading 0 moves strictly along +Z; lateral drift in X is small
        return dz > 0.25 && Math.abs(dx) < 0.15;
      }, b1, { timeout: 15_000 });
      await releaseAndSettleWalkingKey("KeyD");

      // Step 3.4.3: Rotate camera via real controller controls (ArrowRight turning in place toward heading ~ pi/2)
      // Bounded real-control aiming: pulses ArrowRight in discrete bounded intervals rather than an open-ended
      // key-down hold, bounding input and observation overshoot while preserving genuine controller keyboard dispatch.
      const aimStartTime = Date.now();
      const pulseDiagnostics: {
        attempt: number;
        headingBefore: number;
        pulseKey: string;
        pulseMs: number;
        keyDownElapsedMs: number;
        headingAfter: number;
      }[] = [];
      let settledAimHeading = 0;
      let aimSettled = false;

      for (let attempt = 0; attempt < 25; attempt++) {
        const h = await page1.evaluate(() => {
          const colony = (window as any).__colony;
          return colony?.getFirstPersonWireHeading?.() ?? 0;
        });
        if (h >= 1.30 && h <= 1.85) {
          settledAimHeading = h;
          aimSettled = true;
          break;
        }

        const pulseKey = h < 1.30 ? "ArrowRight" : "ArrowLeft";
        const remaining = Math.abs(1.57 - h);
        const pulseMs = remaining > 0.6 ? 100 : 35;

        const pulseStart = Date.now();
        await page1.keyboard.down(pulseKey);
        await page1.waitForTimeout(pulseMs);
        await page1.keyboard.up(pulseKey);
        const keyElapsed = Date.now() - pulseStart;
        await page1.waitForTimeout(30);

        const hAfter = await page1.evaluate(() => {
          const colony = (window as any).__colony;
          return colony?.getFirstPersonWireHeading?.() ?? 0;
        });
        pulseDiagnostics.push({
          attempt,
          headingBefore: h,
          pulseKey,
          pulseMs,
          keyDownElapsedMs: keyElapsed,
          headingAfter: hAfter,
        });
      }

      const rotHeading = await page1.evaluate(() => {
        const colony = (window as any).__colony;
        return colony?.getFirstPersonWireHeading?.() ?? 0;
      });
      const aimDurationMs = Date.now() - aimStartTime;
      console.log(
        `[Diagnostic Aiming] settled=${aimSettled} finalHeading=${rotHeading.toFixed(4)} rad in ${aimDurationMs}ms across ${pulseDiagnostics.length} pulses:`,
        JSON.stringify(pulseDiagnostics),
      );
      if (!aimSettled) {
        console.warn(
          `[Diagnostic Aiming Warning] loop exhausted 25 attempts without settling in [1.30, 1.85]; final heading=${rotHeading.toFixed(4)}`,
        );
      }
      console.log(`Rotated camera wire heading achieved: ${rotHeading.toFixed(4)} rad`);
      expect(rotHeading).toBeGreaterThanOrEqual(1.20);
      expect(rotHeading).toBeLessThanOrEqual(2.00);

      // Step 3.4.4: Rotated-yaw forward walking (heading ~ pi/2 -> forward moves along +Z) with fresh baseline
      const b2 = await page1.evaluate(() => {
        const sent = (window as any).__sentInputs || [];
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const p1 = last?.participants?.find((p: any) => p.username === "jamtin");
        if (
          !last ||
          typeof last.seq !== "number" ||
          !Number.isFinite(last.seq) ||
          !p1 ||
          typeof p1.x !== "number" ||
          !Number.isFinite(p1.x) ||
          typeof p1.z !== "number" ||
          !Number.isFinite(p1.z)
        ) {
          return null;
        }
        return {
          inputCount: sent.length,
          snapSeq: last.seq,
          x: p1.x,
          z: p1.z,
          lastInputSeq: typeof p1.lastInputSeq === "number" && Number.isFinite(p1.lastInputSeq) ? p1.lastInputSeq : -1,
        };
      });
      expect(b2, "Step 3.4.4 initial participant baseline authority must be present and finite").not.toBeNull();
      expect(Number.isFinite(b2!.snapSeq)).toBe(true);
      expect(Number.isFinite(b2!.x)).toBe(true);
      expect(Number.isFinite(b2!.z)).toBe(true);

      await page1.keyboard.down("KeyW");
      // Assert fresh input frame with rotated heading emitted after keydown
      await page1.waitForFunction((b) => {
        const sent = (window as any).__sentInputs || [];
        const fresh = sent.slice(b.baseline.inputCount);
        const match = fresh.find((msg: any) => msg.type === "input" && msg.mode === "walking" && msg.forward === 1 && Math.abs(msg.heading - b.h) < 0.25);
        if (match && typeof match.seq === "number") {
          (window as any).__lastMatchedWalkingInputSeq = match.seq;
          return true;
        }
        return false;
      }, { baseline: b2, h: rotHeading }, { timeout: 15_000 });

      // Assert newer server snapshot advancing sequence with correct rotated forward vector (+Z)
      await page1.waitForFunction((b) => {
        const history = (window as any).__snapshotHistory || [];
        if (!history.length) return false;
        const last = history[history.length - 1];
        if (!last || typeof last.seq !== "number" || !Number.isFinite(last.seq) || last.seq <= b.snapSeq) {
          return false;
        }
        const p1 = last.participants?.find((p: any) => p.username === "jamtin");
        if (!p1 || typeof p1.x !== "number" || !Number.isFinite(p1.x) || typeof p1.z !== "number" || !Number.isFinite(p1.z)) {
          return false;
        }
        const dx = p1.x - b.x;
        const dz = p1.z - b.z;
        // Forward with heading in [1.2, 2.0] moves strongly in +Z (sin(h) > 0.9)
        return dz > 0.25 && dz > Math.abs(dx);
      }, b2, { timeout: 15_000 });
      await releaseAndSettleWalkingKey("KeyW");

      // Step 3.4.5: Rotated-yaw strafe walking (heading ~ pi/2 -> strafe right moves along -X) with fresh baseline
      const b3 = await page1.evaluate(() => {
        const sent = (window as any).__sentInputs || [];
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const p1 = last?.participants?.find((p: any) => p.username === "jamtin");
        if (
          !last ||
          typeof last.seq !== "number" ||
          !Number.isFinite(last.seq) ||
          !p1 ||
          typeof p1.x !== "number" ||
          !Number.isFinite(p1.x) ||
          typeof p1.z !== "number" ||
          !Number.isFinite(p1.z)
        ) {
          return null;
        }
        return {
          inputCount: sent.length,
          snapSeq: last.seq,
          x: p1.x,
          z: p1.z,
          lastInputSeq: typeof p1.lastInputSeq === "number" && Number.isFinite(p1.lastInputSeq) ? p1.lastInputSeq : -1,
        };
      });
      expect(b3, "Step 3.4.5 initial participant baseline authority must be present and finite").not.toBeNull();
      expect(Number.isFinite(b3!.snapSeq)).toBe(true);
      expect(Number.isFinite(b3!.x)).toBe(true);
      expect(Number.isFinite(b3!.z)).toBe(true);

      await page1.keyboard.down("KeyD");
      // Assert fresh input frame with rotated strafe emitted after keydown
      await page1.waitForFunction((b) => {
        const sent = (window as any).__sentInputs || [];
        const fresh = sent.slice(b.baseline.inputCount);
        const match = fresh.find((msg: any) => msg.type === "input" && msg.mode === "walking" && msg.forward === 0 && msg.strafe === 1 && Math.abs(msg.heading - b.h) < 0.25);
        if (match && typeof match.seq === "number") {
          (window as any).__lastMatchedWalkingInputSeq = match.seq;
          return true;
        }
        return false;
      }, { baseline: b3, h: rotHeading }, { timeout: 15_000 });

      // Assert newer server snapshot advancing sequence with correct rotated strafe vector (-X)
      await page1.waitForFunction((b) => {
        const history = (window as any).__snapshotHistory || [];
        if (!history.length) return false;
        const last = history[history.length - 1];
        if (!last || typeof last.seq !== "number" || !Number.isFinite(last.seq) || last.seq <= b.snapSeq) {
          return false;
        }
        const p1 = last.participants?.find((p: any) => p.username === "jamtin");
        if (!p1 || typeof p1.x !== "number" || !Number.isFinite(p1.x) || typeof p1.z !== "number" || !Number.isFinite(p1.z)) {
          return false;
        }
        const dx = p1.x - b.x;
        const dz = p1.z - b.z;
        // Strafe right with heading in [1.2, 2.0] moves strongly in -X (vx = -sin(h)*speed < -0.9*speed)
        return dx < -0.25 && -dx > Math.abs(dz);
      }, b3, { timeout: 15_000 });
      await releaseAndSettleWalkingKey("KeyD");
      recordStage("Real-controller forward, strafe, rotated-yaw forward, and rotated-yaw strafe directional vectors verified on live server");

      // Verify parked car coordinates are mandatory and remained strictly stationary at parkedCarPose1 during walking
      const postWalkSnap = await page1.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const p1 = last?.participants?.find((p: any) => p.username === "jamtin");
        return p1 ? { x: p1.x, z: p1.z, carX: p1.carX, carZ: p1.carZ } : null;
      });
      expect(postWalkSnap).not.toBeNull();
      expect(typeof postWalkSnap!.x).toBe("number");
      expect(typeof postWalkSnap!.z).toBe("number");
      expect(typeof postWalkSnap!.carX).toBe("number");
      expect(typeof postWalkSnap!.carZ).toBe("number");
      expect(Number.isFinite(postWalkSnap!.x)).toBe(true);
      expect(Number.isFinite(postWalkSnap!.z)).toBe(true);
      expect(Number.isFinite(postWalkSnap!.carX)).toBe(true);
      expect(Number.isFinite(postWalkSnap!.carZ)).toBe(true);
      expect(Math.hypot(postWalkSnap!.carX! - parkedCarPose1.x, postWalkSnap!.carZ! - parkedCarPose1.z)).toBeLessThan(0.01);

      // Verify 3D world parked car mesh position remains stationary on Player 2
      const peer3dParkedCar = await page2.evaluate(() => {
        const scene = (window as any).__r3fScene;
        let pos: { x: number; y: number; z: number } | null = null;
        scene?.traverse((o: any) => {
          if (o.name && o.name.includes("remote-parked-car-jamtin")) {
            pos = { x: o.position.x, y: o.position.y, z: o.position.z };
          }
        });
        return pos;
      });
      expect(peer3dParkedCar).not.toBeNull();
      expect(Math.hypot(peer3dParkedCar!.x - parkedCarPose1.x, peer3dParkedCar!.z - parkedCarPose1.z)).toBeLessThan(0.01);

      // Assert actual walking 3D world object / camera coordinates against authoritative server snapshot pose with bounded render tolerance
      const peer3dPedestrian = await page2.evaluate((expectedId) => {
        const scene = (window as any).__r3fScene;
        let pos: { x: number; y: number; z: number } | null = null;
        scene?.traverse((o: any) => {
          if (o.userData?.participantId === expectedId) {
            pos = { x: o.position.x, y: o.position.y, z: o.position.z };
          }
        });
        return pos;
      }, pinnedParticipantId1);
      expect(peer3dPedestrian).not.toBeNull();
      const pedDistP2 = Math.hypot(peer3dPedestrian!.x - postWalkSnap!.x, peer3dPedestrian!.z - postWalkSnap!.z);
      console.log(`Player 2 rendered peer pedestrian 3D avatar vs server snapshot delta: ${pedDistP2.toFixed(4)}m`);
      expect(pedDistP2).toBeLessThan(0.5);

      // Verify local walking cell in world meters aligns with authoritative server snapshot (<0.5m)
      await page1.waitForFunction((expected) => {
        const colony = (window as any).__colony;
        const walkCell = colony?.getWalkingCell?.();
        if (!walkCell) return false;
        const tSize = colony?.sim?.state?.terrain?.size ?? 128;
        const walkWorld = { x: (walkCell.x - tSize / 2) * 4, z: (walkCell.y - tSize / 2) * 4 };
        const dist = Math.hypot(walkWorld.x - expected.x, walkWorld.z - expected.z);
        return dist < 0.5;
      }, { x: postWalkSnap!.x, z: postWalkSnap!.z }, { timeout: 10_000 });

      const localWalkingProbe = await page1.evaluate(() => {
        const cam = (window as any).__r3fCamera;
        const colony = (window as any).__colony;
        const camPos = cam ? { x: cam.position.x, y: cam.position.y, z: cam.position.z } : null;
        const walkCell = colony?.getWalkingCell?.();
        const tSize = colony?.sim?.state?.terrain?.size ?? 128;
        const walkWorld = walkCell ? { x: (walkCell.x - tSize / 2) * 4, z: (walkCell.y - tSize / 2) * 4 } : null;
        return { camPos, walkWorld };
      });
      expect(localWalkingProbe.walkWorld).not.toBeNull();
      const localWorldDist = Math.hypot(localWalkingProbe.walkWorld!.x - postWalkSnap!.x, localWalkingProbe.walkWorld!.z - postWalkSnap!.z);
      console.log(`Player 1 local walking cell in world meters vs server snapshot delta: ${localWorldDist.toFixed(4)}m`);
      expect(localWorldDist).toBeLessThan(0.5);
      if (localWalkingProbe.camPos) {
        const localCamDist = Math.hypot(localWalkingProbe.camPos.x - postWalkSnap!.x, localWalkingProbe.camPos.z - postWalkSnap!.z);
        console.log(`Player 1 local camera position vs server snapshot delta: ${localCamDist.toFixed(4)}m`);
        expect(localCamDist).toBeLessThan(1.0);
      }

      // Compute mathematical SVG projection expectations from exact accepted server snapshot and map bounds
      const mapProjection = await page1.evaluate(() => {
        const colony = (window as any).__colony;
        const state = colony?.sim?.state;
        const ways = state?.roadWays ?? [];
        const stops = colony?.busRoute?.stops ?? [];
        const depot = colony?.busDepot?.site ?? null;
        const network = [
          ...ways.flatMap((w: any) => w.path),
          ...stops,
          ...(depot ? [{ x: depot.x + (depot.w - 1) / 2, y: depot.y + (depot.h - 1) / 2 }] : []),
        ];
        const xs = network.map((p: any) => p.x);
        const ys = network.map((p: any) => p.y);
        const rawMinX = xs.length ? Math.min(...xs) : 0;
        const rawMaxX = xs.length ? Math.max(...xs) : 1;
        const rawMinY = ys.length ? Math.min(...ys) : 0;
        const rawMaxY = ys.length ? Math.max(...ys) : 1;
        const spanX = Math.max(1, rawMaxX - rawMinX);
        const spanY = Math.max(1, rawMaxY - rawMinY);
        const width = 200;
        const height = 132;
        const padding = 8;
        const drawableW = Math.max(1, width - padding * 2);
        const drawableH = Math.max(1, height - padding * 2);
        const scale = Math.min(drawableW / spanX, drawableH / spanY);
        const usedW = spanX * scale;
        const usedH = spanY * scale;
        const ox = padding + (drawableW - usedW) / 2;
        const oy = padding + (drawableH - usedH) / 2;
        const tSize = state?.terrain?.size ?? 128;
        return { rawMinX, rawMinY, spanX, spanY, scale, ox, oy, width, height, padding, tSize };
      });
      expect(mapProjection).not.toBeNull();
      const tSize = mapProjection!.tSize;
      const expectedParkedCell = {
        x: postWalkSnap!.carX / 4 + tSize / 2,
        y: postWalkSnap!.carZ / 4 + tSize / 2,
      };
      const expectedPedCell = {
        x: postWalkSnap!.x / 4 + tSize / 2,
        y: postWalkSnap!.z / 4 + tSize / 2,
      };
      const projectPoint = (cell: { x: number; y: number }) => {
        const rawX = mapProjection!.ox + (cell.x - mapProjection!.rawMinX) * mapProjection!.scale;
        const rawY = mapProjection!.oy + (cell.y - mapProjection!.rawMinY) * mapProjection!.scale;
        return {
          x: Math.min(mapProjection!.width - mapProjection!.padding, Math.max(mapProjection!.padding, rawX)),
          y: Math.min(mapProjection!.height - mapProjection!.padding, Math.max(mapProjection!.padding, rawY)),
        };
      };
      const expectedParkedSvg = projectPoint(expectedParkedCell);
      const expectedPedSvg = projectPoint(expectedPedCell);

      // Verify numerical local and peer marker SVG circle/rect positions against calculated map projection
      await mapBtnP1.click();
      const localMarker = page1.locator('[data-testid="city-map-parked-car-marker"][data-local="true"]');
      await expect(localMarker).toBeAttached({ timeout: 5000 });
      const localCircle = localMarker.locator("circle");
      const localX = Number(await localCircle.getAttribute("cx"));
      const localY = Number(await localCircle.getAttribute("cy"));
      expect(Number.isFinite(localX)).toBe(true);
      expect(Number.isFinite(localY)).toBe(true);
      expect(localX).toBeGreaterThan(0);
      expect(Math.hypot(localX - expectedParkedSvg.x, localY - expectedParkedSvg.y)).toBeLessThan(1.0);

      const localPlayerMarker = page1.locator('[data-testid="city-map-player-marker"]');
      await expect(localPlayerMarker).toBeAttached({ timeout: 5000 });
      const localPlayerCircle = localPlayerMarker.locator("circle").first();
      const localPlayerX = Number(await localPlayerCircle.getAttribute("cx"));
      const localPlayerY = Number(await localPlayerCircle.getAttribute("cy"));
      expect(Number.isFinite(localPlayerX)).toBe(true);
      expect(Number.isFinite(localPlayerY)).toBe(true);
      expect(localPlayerX).toBeGreaterThan(0);
      expect(localPlayerY).toBeGreaterThan(0);
      expect(Math.hypot(localPlayerX - expectedPedSvg.x, localPlayerY - expectedPedSvg.y)).toBeLessThan(1.0);
      await mapBtnP1.click();

      await mapBtnP2.click();
      const peerMarker = page2.locator('[data-testid="city-map-parked-car-marker"][data-local="false"]');
      await expect(peerMarker).toBeAttached({ timeout: 5000 });
      const peerCircle = peerMarker.locator("circle");
      const peerX = Number(await peerCircle.getAttribute("cx"));
      const peerY = Number(await peerCircle.getAttribute("cy"));
      expect(Number.isFinite(peerX)).toBe(true);
      expect(Number.isFinite(peerY)).toBe(true);
      // Assert peer parked car marker against mathematical projection of accepted server snapshot
      expect(Math.hypot(peerX - expectedParkedSvg.x, peerY - expectedParkedSvg.y)).toBeLessThan(1.0);
      // Both maps project the identical stationary parked car to the same SVG coordinates
      expect(Math.hypot(peerX - localX, peerY - localY)).toBeLessThan(1.0);

      const peerPlayerMarker = page2.locator(`[data-testid="city-map-peer-marker"][data-participant-id="${pinnedParticipantId1}"]`);
      await expect(peerPlayerMarker).toBeAttached({ timeout: 5000 });
      const peerPlayerCircle = peerPlayerMarker.locator("circle").first();
      const peerPlayerX = Number(await peerPlayerCircle.getAttribute("cx"));
      const peerPlayerY = Number(await peerPlayerCircle.getAttribute("cy"));
      expect(Number.isFinite(peerPlayerX)).toBe(true);
      expect(Number.isFinite(peerPlayerY)).toBe(true);
      // Assert peer walking player marker against mathematical projection of accepted server snapshot
      expect(Math.hypot(peerPlayerX - expectedPedSvg.x, peerPlayerY - expectedPedSvg.y)).toBeLessThan(1.0);
      // Both maps project the identical walking pedestrian to the same SVG coordinates
      expect(Math.hypot(peerPlayerX - localPlayerX, peerPlayerY - localPlayerY)).toBeLessThan(1.0);
      await mapBtnP2.click();

      // 4. Player 1 re-enters vehicle via genuine pointer click on "Enter your car"
      const enterBtn1 = page1.locator('[data-testid="enter-owned-car"]');
      await expect(enterBtn1).toBeVisible({ timeout: 10_000 });
      await enterBtn1.click();
      recordStage("Player 1 clicked Enter your car");

      // 5. Verify authoritative server snapshot reflects Player 1 restored to driving mode
      // with exact pinned participantId, retained peer membership, and parked vehicle pose restored
      try {
        await Promise.all([
          page1.waitForFunction((expected) => {
            const history = (window as any).__snapshotHistory || [];
            const last = history[history.length - 1];
            if (!last || last.participants?.length !== 2) return false;
            const p1 = last.participants.find((p: any) => p.username === "jamtin");
            const p2 = last.participants.find((p: any) => p.username === "jamtin2");
            return (
              p1?.participantId === expected.p1Id &&
              p2?.participantId === expected.p2Id &&
              p1.isPedestrian === false &&
              p2.isPedestrian === false
            );
          }, { p1Id: pinnedParticipantId1, p2Id: pinnedParticipantId2 }, { timeout: 15_000 }),
          page2.waitForFunction((expected) => {
            const history = (window as any).__snapshotHistory || [];
            const last = history[history.length - 1];
            if (!last || last.participants?.length !== 2) return false;
            const p1 = last.participants.find((p: any) => p.username === "jamtin");
            const p2 = last.participants.find((p: any) => p.username === "jamtin2");
            return (
              p1?.participantId === expected.p1Id &&
              p2?.participantId === expected.p2Id &&
              p1.isPedestrian === false &&
              p2.isPedestrian === false
            );
          }, { p1Id: pinnedParticipantId1, p2Id: pinnedParticipantId2 }, { timeout: 15_000 }),
        ]);
      } catch (err) {
        await dumpTransitionDiagnostics(page1, "Page 1 Car Re-entry");
        await dumpTransitionDiagnostics(page2, "Page 2 Car Re-entry");
        throw err;
      }
      recordStage("Authoritative server snapshot verified Player 1 restored to driving mode with pinned participantId and retained peer membership");

      // Verify parked vehicle pose authority: Player 1 returned exactly to parked position
      const reenteredPosP1 = await page1.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const p1 = last?.participants?.find((p: any) => p.username === "jamtin");
        return p1 ? { x: p1.x, z: p1.z } : null;
      });
      expect(reenteredPosP1).toBeDefined();
      const reenterDistFromParked = Math.hypot(reenteredPosP1!.x - parkedCarPose1.x, reenteredPosP1!.z - parkedCarPose1.z);
      console.log(`Player 1 re-entered driving position delta from parked pose: ${reenterDistFromParked.toFixed(3)}m`);
      expect(reenterDistFromParked).toBeLessThan(0.5); // Exact parked position restored (< 0.5m)

      // 6. Observe mounted child geometry/model identity independently on Player 2 for Player 1:
      // Must find BoxGeometry (body/cabin/stripe) and CylinderGeometry (wheels), correct driving mode, and NO pedestrian crab visuals/geometries.
      await page2.waitForFunction((expectedId) => {
        const scene = (window as any).__r3fScene;
        let targetGroup: any = null;
        scene?.traverse((o: any) => {
          if (o.userData?.participantId === expectedId) {
            targetGroup = o;
          }
        });
        if (!targetGroup) return false;

        const isNotPedestrian = targetGroup.userData?.isPedestrian === false;
        const isDriving = targetGroup.userData?.mode === "driving";

        let hasCrab = false;
        const geoTypes: string[] = [];
        targetGroup.traverse((child: any) => {
          if (child.name && typeof child.name === "string" && (child.name.startsWith("pedestrian-crab-") || child.name.startsWith("seated-crab-"))) {
            hasCrab = true;
          }
          if (child.isMesh && child.geometry?.type) {
            geoTypes.push(child.geometry.type);
          }
        });

        const hasBox = geoTypes.includes("BoxGeometry");
        const hasCylinder = geoTypes.includes("CylinderGeometry");

        return isNotPedestrian && isDriving && hasBox && hasCylinder && !hasCrab;
      }, pinnedParticipantId1, { timeout: 15_000 });

      // Retain screenshot of visible car model
      const carScreenshotPath = path.resolve("test-results/actual-pair-screenshots/page2-peer-as-car.png");
      await page2.screenshot({ path: carScreenshotPath });
      console.log(`Player 2 view of Player 1 restored as car saved to: ${carScreenshotPath}`);
      recordStage("Player 2 3D scene independently verified rendering Player 1 as car model (Box/Cylinder geometry) and captured screenshot");

      // 6.1 Verify 3D parked car visual is cleared from Player 2's scene after Player 1 re-enters car
      await page2.waitForFunction(() => {
        const scene = (window as any).__r3fScene;
        let foundParkedCar = false;
        scene?.traverse((o: any) => {
          if (o.name && o.name.includes("remote-parked-car-jamtin")) {
            foundParkedCar = true;
          }
        });
        return !foundParkedCar;
      }, undefined, { timeout: 15_000 });

      // 6.2 Verify mini-map parked car markers are cleared on both players after boarding
      const mapBtnP2Post = page2.locator('[data-testid="player-map-shortcut"]');
      await mapBtnP2Post.click();
      await expect(page2.locator('[data-testid="city-map-parked-car-marker"]')).toHaveCount(0);
      await mapBtnP2Post.click();

      const mapBtnP1Post = page1.locator('[data-testid="player-map-shortcut"]');
      await mapBtnP1Post.click();
      await expect(page1.locator('[data-testid="city-map-parked-car-marker"]')).toHaveCount(0);
      await mapBtnP1Post.click();
      recordStage("Verified parked car cleared from 3D world and mini-map on both players after boarding");

      // 7. Re-engage throttle to prove controls and simulation loop continuation after re-entry
      const throttleReentry1 = page1.locator('button[data-drive-action="throttle"]');
      await expect(throttleReentry1).toBeVisible({ timeout: 10_000 });
      const tbReentryBox = await throttleReentry1.boundingBox();
      if (tbReentryBox) {
        await page1.mouse.move(tbReentryBox.x + tbReentryBox.width / 2, tbReentryBox.y + tbReentryBox.height / 2);
        await page1.mouse.down();
      }
      await page1.waitForFunction(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const self = last?.participants?.find((p: any) => p.username === "jamtin");
        return self && self.speed > 0.05;
      }, undefined, { timeout: 15_000 });
      await page1.mouse.up();
      recordStage("Driving controls & server simulation loop re-verified after car re-entry");

      // Flush video by closing pages and contexts
      const videoObj = page1.video();
      expect(videoObj).toBeDefined();
      await page1.close();
      await page2.close();
      await context1.close();
      await context2.close();

      const rawVideoPath = await videoObj!.path();
      console.log(`Raw video saved to: ${rawVideoPath}`);
      expect(fs.existsSync(rawVideoPath)).toBe(true);

      // Transcode to MP4 using ffmpeg (-nostdin to avoid pipe hang)
      const finalMp4Path = path.resolve("videos/multiplayer-actual-pair.mp4");
      console.log(`Transcoding WebM to MP4 at: ${finalMp4Path}...`);

      execSync(
        `"${ffmpegInstaller.path}" -nostdin -y -i "${rawVideoPath}" -c:v libx264 -pix_fmt yuv420p "${finalMp4Path}"`,
        { stdio: "pipe" }
      );

      expect(fs.existsSync(finalMp4Path)).toBe(true);
      const stat = fs.statSync(finalMp4Path);
      console.log(`Final MP4 size: ${stat.size} bytes`);
      expect(stat.size).toBeGreaterThan(50_000);

      recordStage("MP4 video transcoded and verified");

      // Write diagnostic per-stage timings
      const timingsPath = path.resolve("test-results/actual-pair-per-stage-timings.json");
      fs.writeFileSync(timingsPath, JSON.stringify({
        glInfo1,
        glInfo2,
        stageTimings,
      }, null, 2));

      console.log(
        "Proposed Fastify actual-pair acceptance verified: RealtimeManager with active 10Hz simulation loop, pure physics stepOwnedDrive, direct browser WebSockets, settled pre-control baseline with fresh monotonic input ack, positive throttle accepted at server, actual server participant displacement, mutual 3D awareness, numeric mini-map projection equality (<0.5px), and recorded MP4. Trusted canonical starting-position authority and deployed authenticated acceptance remain explicitly open."
      );
    } finally {
      await fastifyApp.close();
      console.log("Proposed Fastify server cleanly closed.");
    }
  });

  test("two browser players bus stop wait, board into distinct seats, ride as mounted seated crabs, and alight safely", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const {
      jwt,
      buildApp,
      GameStateManager,
      LocalWorldAuthorityClient,
      RealtimeManager,
      extractRoadGeometry,
      extractWalkabilityAuthority,
      CANONICAL_PHYSICAL_OBSTACLES_4242,
      PHYSICAL_COLLIDERS_SCHEMA_VERSION,
      computePhysicalCollidersContentHash,
      CITYLIFE_EPOCH_MS,
    } = loadServerComponents();

    // 1. Build canonical world layout and register transit + walkability authority
    const baseSurveyRuntime = new ColonyRuntime(4242);
    const defaultDoc = createWorldLayoutDocument({
      ...baseSurveyRuntime.captureWorldLayout(),
      layoutId: "seed-4242",
      seed: 4242,
      revision: { number: 0, parentHash: null },
    });
    const surfaceFrame = defaultDoc.frames.find((f: any) => f.layer === "surface") || defaultDoc.frames[0];
    const canonicalTransitAuthority = baseSurveyRuntime.exportCanonicalTransitAuthority(defaultDoc);
    expect(canonicalTransitAuthority).not.toBeNull();

    const physicalColliders = {
      schemaVersion: PHYSICAL_COLLIDERS_SCHEMA_VERSION,
      worldId: "seed-4242",
      layoutRevision: defaultDoc.revision.contentHash,
      frameId: surfaceFrame.id,
      obstacles: CANONICAL_PHYSICAL_OBSTACLES_4242,
      contentHash: computePhysicalCollidersContentHash({
        schemaVersion: PHYSICAL_COLLIDERS_SCHEMA_VERSION,
        worldId: "seed-4242",
        layoutRevision: defaultDoc.revision.contentHash,
        frameId: surfaceFrame.id,
        obstacles: CANONICAL_PHYSICAL_OBSTACLES_4242,
      }),
    };

    const stagingGeom = extractRoadGeometry(
      { layout: defaultDoc, physicalColliders },
      { layout: defaultDoc, physicalColliders },
    );
    expect(stagingGeom.hasGeometry).toBe(true);

    // Canonical walkability filtered against terrain water and physical collider obstacles
    // covering Stop 0 corridor (x: 115..145, y: 265..295) and Stop 1 kerb corridor (x: 435..455, y: 125..150)
    const walkableCells = new Set<string>();
    const terrain = baseSurveyRuntime.sim.state.terrain;
    const addCanonicalWalkableWindow = (x0: number, x1: number, y0: number, y1: number) => {
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const isWater = terrain && typeof terrain.isWater === "function" ? terrain.isWater(cx, cy) : false;
          const isObstacle = stagingGeom.obstacleSet.has(`${cx},${cy}`);
          if (!isWater && !isObstacle) {
            walkableCells.add(`${cx},${cy}`);
          }
        }
      }
    };
    addCanonicalWalkableWindow(115, 145, 265, 295);
    addCanonicalWalkableWindow(435, 455, 125, 150);

    const walkabilityAuthorityCheck = extractWalkabilityAuthority(
      {
        layout: defaultDoc,
        walkability: {
          schemaVersion: "citylife.walkability/v1",
          frameId: surfaceFrame.id,
          walkableCells,
        },
      },
      defaultDoc,
    );
    expect(walkabilityAuthorityCheck).not.toBeNull();

    // Canonical road spawn on Stop 0 approach avenue (cell 126, 273 heading south PI/2; ~9.2 cells north of Stop 0 at (124, 281.89))
    // so both Player 1 (at y=273) and Player 2 (after driving south to y~277.4) exit outside the 3.0-cell Stop 0 anchor radius
    const HUB_SPAWN = { x: 126, y: 273, heading: Math.PI / 2 };
    expect(stagingGeom.roadSet.has(`${HUB_SPAWN.x},${HUB_SPAWN.y}`)).toBe(true);
    expect(walkableCells.has(`${HUB_SPAWN.x - 1},${HUB_SPAWN.y}`)).toBe(true);

    const worldAuth = new LocalWorldAuthorityClient();
    worldAuth.registerWorld({
      schemaVersion: "citylife.starter-parcel-manifest/v1",
      worldId: "seed-4242",
      layoutRevision: defaultDoc.revision.contentHash,
      layout: defaultDoc,
      plots: [{ geometry: { neighbourhoodKey: "citylife-central" } }],
      hubSpawn: HUB_SPAWN,
      physicalColliders,
      walkability: {
        schemaVersion: "citylife.walkability/v1",
        frameId: surfaceFrame.id,
        walkableCells,
      },
      transit: canonicalTransitAuthority,
    });

    const userClient = {
      async getVehicleTruth(userId: string) {
        if (userId === "70001" || userId === "70002") {
          return {
            owned: true,
            status: "OWNED",
            vehicleKey: "karoo-vonk-11",
            storage: "local-drive",
            onboardingState: "COMPLETED",
          };
        }
        return {
          owned: false,
          status: null,
          vehicleKey: null,
          storage: null,
          onboardingState: "NONE",
        };
      },
    };

    const realtime = new RealtimeManager({
      userClient,
      worldAuthorityClient: worldAuth,
      enableSimulationTimer: true,
      enableBusSync: true,
      enableBusSeats: true,
      staleTimeoutMs: 60_000,
    });

    // Baseline sol time: 5:02 AM (Bus 0 still in depot before reaching Stop 0)
    const baseSolNow = CITYLIFE_EPOCH_MS + 4_530_000;
    let mockNow = baseSolNow;
    realtime.setMockSolNowMs(() => mockNow);

    const e2ePort = Number(process.env.CITYLIFE_E2E_PORT) || 5191;
    const serverPort = Number(process.env.CITYLIFE_PORT) || 9010;
    const BUS_JWT_SECRET = crypto.randomUUID();
    const fastifyApp = buildApp({
      gameState: new GameStateManager(null, null),
      realtime,
      userClient,
      worldAuthorityClient: worldAuth,
      jwtSecret: BUS_JWT_SECRET,
      jwtAlgorithms: ["HS256"],
      allowedWsOrigins: [
        "https://citylife.kooker.co.za",
        `http://127.0.0.1:${e2ePort}`,
        `http://localhost:${e2ePort}`,
      ],
    });

    const serverAddr = await fastifyApp.listen({ port: serverPort, host: "127.0.0.1" });
    const actualWsUrl = serverAddr.replace(/^http/, "ws") + "/api/v1/citylife/ws";

    const cachedCatalogueBody = JSON.stringify({
      published: true,
      manifest: {
        worldId: "seed-4242",
        layoutRevision: defaultDoc.revision.contentHash,
        layout: defaultDoc,
        physicalColliders,
        transit: canonicalTransitAuthority,
        walkability: {
          schemaVersion: "citylife.walkability/v1",
          frameId: surfaceFrame.id,
          walkableCells: Array.from(walkableCells),
        },
        plots: [{ geometry: { neighbourhoodKey: "citylife-central" } }],
      },
    });
    const cachedVehicleBody = JSON.stringify({
      owned: true,
      status: "OWNED",
      vehicleKey: "karoo-vonk-11",
      ownedVehicleKeys: ["karoo-vonk-11"],
      hasVehicle: true,
      carKey: "karoo-vonk-11",
    });

    let context1: BrowserContext | null = null;
    let context2: BrowserContext | null = null;

    try {
      const token1 = jwt.sign(
        { userId: 70001, id: 70001, sub: 70001, type: "access", roles: ["CITYLIFE_PLAYER"], username: "jamtin" },
        BUS_JWT_SECRET,
        { algorithm: "HS256", expiresIn: "1h" },
      );
      const token2 = jwt.sign(
        { userId: 70002, id: 70002, sub: 70002, type: "access", roles: ["CITYLIFE_PLAYER"], username: "jamtin2" },
        BUS_JWT_SECRET,
        { algorithm: "HS256", expiresIn: "1h" },
      );

      context1 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page1 = await context1.newPage();
      await seedPlayerSession(page1, "jamtin@citylife.local", token1, 70001, actualWsUrl);

      context2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page2 = await context2.newPage();
      await seedPlayerSession(page2, "jamtin2@citylife.local", token2, 70002, actualWsUrl);

      const handleCatalogueRoute = (route: any) =>
        route.fulfill({ status: 200, contentType: "application/json", body: cachedCatalogueBody });
      const handleVehicleRoute = (route: any) =>
        route.fulfill({ status: 200, contentType: "application/json", body: cachedVehicleBody });
      const handleAssetsRoute = (route: any) =>
        route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      const handleEmptyJsonRoute = (route: any) =>
        route.fulfill({ status: 200, contentType: "application/json", body: "{}" });

      // Do NOT intercept /api/v1/citylife/auth/cookie — let Vite's proxy forward directly to Fastify
      // on 127.0.0.1:9010 so real Set-Cookie headers populate the browser cookie jar for WebSocket upgrade.
      await context1.route("**/starter-catalogue*", handleCatalogueRoute);
      await context2.route("**/starter-catalogue*", handleCatalogueRoute);
      await context1.route("**/players/me/vehicle*", handleVehicleRoute);
      await context2.route("**/players/me/vehicle*", handleVehicleRoute);
      await context1.route("**/car-ownership*", handleVehicleRoute);
      await context2.route("**/car-ownership*", handleVehicleRoute);
      await context1.route("**/api/v1/assets*", handleAssetsRoute);
      await context2.route("**/api/v1/assets*", handleAssetsRoute);
      await context1.route("**/api/ledger/**", handleEmptyJsonRoute);
      await context2.route("**/api/ledger/**", handleEmptyJsonRoute);
      await context1.route("**/api/v1/social/**", handleEmptyJsonRoute);
      await context2.route("**/api/v1/social/**", handleEmptyJsonRoute);
      await context1.route("**/api/v1/citylife/blueprints*", handleAssetsRoute);
      await context2.route("**/api/v1/citylife/blueprints*", handleAssetsRoute);
      await context1.route("**/api/v1/citylife/players/me/feature-flags/**", handleEmptyJsonRoute);
      await context2.route("**/api/v1/citylife/players/me/feature-flags/**", handleEmptyJsonRoute);

      const targetQuery = `/?room=bus-actual-pair&skipauth=1&ws=${encodeURIComponent(actualWsUrl)}`;
      await Promise.all([page1.goto(targetQuery), page2.goto(targetQuery)]);
      await Promise.all([
        page1.waitForSelector("canvas", { timeout: 60_000 }),
        page2.waitForSelector("canvas", { timeout: 60_000 }),
      ]);
      await Promise.all([
        page1.waitForFunction(() => !!(window as any).__colony && !!(window as any).__r3fScene, undefined, { timeout: 60_000 }),
        page2.waitForFunction(() => !!(window as any).__colony && !!(window as any).__r3fScene, undefined, { timeout: 60_000 }),
      ]);
      await Promise.all([
        page1.waitForSelector('[data-testid="multiplayer-hud"][data-connected="true"]', { timeout: 60_000 }),
        page2.waitForSelector('[data-testid="multiplayer-hud"][data-connected="true"]', { timeout: 60_000 }),
      ]);

      // Verify real HttpOnly cookie was set in both browser contexts via normal BFF proxy (/api/v1/citylife/auth/cookie)
      const [cookies1, cookies2] = await Promise.all([context1.cookies(), context2.cookies()]);
      const redactCookies = (list: typeof cookies1) =>
        list.map((c) => ({
          name: c.name,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
          hasValue: Boolean(c.value && c.value.length > 0),
        }));
      console.log("[Bus Auth Cookie Metadata] P1:", JSON.stringify(redactCookies(cookies1)));
      console.log("[Bus Auth Cookie Metadata] P2:", JSON.stringify(redactCookies(cookies2)));

      const wsCookie1 = cookies1.find((c) => c.name === "jwt" && c.path === "/api/v1/citylife/ws");
      const wsCookie2 = cookies2.find((c) => c.name === "jwt" && c.path === "/api/v1/citylife/ws");
      expect(wsCookie1).toBeDefined();
      expect(wsCookie1?.httpOnly).toBe(true);
      expect(wsCookie1?.secure).toBe(true);
      expect(wsCookie1?.sameSite).toBe("Strict");
      expect(Boolean(wsCookie1?.value)).toBe(true);
      expect(wsCookie2).toBeDefined();
      expect(wsCookie2?.httpOnly).toBe(true);
      expect(wsCookie2?.secure).toBe(true);
      expect(wsCookie2?.sameSite).toBe("Strict");
      expect(Boolean(wsCookie2?.value)).toBe(true);

      const [webglDiag1, webglDiag2] = await Promise.all([
        page1.evaluate(() => {
          const canvas = document.querySelector("canvas");
          const gl = (canvas?.getContext("webgl2") || canvas?.getContext("webgl")) as WebGLRenderingContext | null;
          const dbg = gl ? gl.getExtension("WEBGL_debug_renderer_info") : null;
          return {
            glVersion: gl ? gl.getParameter(gl.VERSION) : null,
            unmaskedVendor: gl && dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
            unmaskedRenderer: gl && dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
          };
        }),
        page2.evaluate(() => {
          const canvas = document.querySelector("canvas");
          const gl = (canvas?.getContext("webgl2") || canvas?.getContext("webgl")) as WebGLRenderingContext | null;
          const dbg = gl ? gl.getExtension("WEBGL_debug_renderer_info") : null;
          return {
            glVersion: gl ? gl.getParameter(gl.VERSION) : null,
            unmaskedVendor: gl && dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
            unmaskedRenderer: gl && dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
          };
        }),
      ]);
      console.log(
        "[Mounted Bus Renderer & Env Diagnostic]:",
        JSON.stringify({
          hardwareWebglEnv: process.env.CITYLIFE_HARDWARE_WEBGL ?? "default-enabled",
          traceFlagMode: process.env.CITYLIFE_TRACE || "off",
          page1Webgl: webglDiag1,
          page2Webgl: webglDiag2,
        }),
      );

      // Synchronize client sol clocks with server baseline (baseSolNow) and attach bounded snapshot/error/transition listeners
      // including automatic instrumentation of replacement WebSocket instances across reconnects
      const attachListenersAndSyncClock = async (p: Page, targetMs: number) => {
        await p.evaluate((ms) => {
          const colony = (window as any).__colony;
          colony.debugSetSolNowMs(ms);
          const mp = colony.getMultiplayerClient();
          const MAX_DIAG_TAIL = 32;
          (window as any).__snapshotCount = 0;
          (window as any).__lastSnapshot = null;
          (window as any).__snapshotHistory = [];
          (window as any).__mpErrors = [];
          (window as any).__sentTransitions = [];
          (window as any).__recvTransitions = [];
          (window as any).__socketInstanceSeq = 0;
          (window as any).__clickHandlerTimings = [];

          document.addEventListener(
            "pointerdown",
            (ev) => {
              const target = ev.target as HTMLElement | null;
              const btn = target?.closest?.("[data-testid],[data-fp-action]") as HTMLElement | null;
              if (btn) {
                const arr = (window as any).__clickHandlerTimings;
                arr.push({
                  event: "pointerdown",
                  testId: btn.getAttribute("data-testid") || btn.getAttribute("data-fp-action"),
                  atMs: Date.now(),
                });
                if (arr.length > MAX_DIAG_TAIL) arr.splice(0, arr.length - MAX_DIAG_TAIL);
              }
            },
            true,
          );
          document.addEventListener(
            "click",
            (ev) => {
              const target = ev.target as HTMLElement | null;
              const btn = target?.closest?.("[data-testid],[data-fp-action]") as HTMLElement | null;
              if (btn) {
                const arr = (window as any).__clickHandlerTimings;
                arr.push({
                  event: "click",
                  testId: btn.getAttribute("data-testid") || btn.getAttribute("data-fp-action"),
                  atMs: Date.now(),
                });
                if (arr.length > MAX_DIAG_TAIL) arr.splice(0, arr.length - MAX_DIAG_TAIL);
              }
            },
            true,
          );

          const hookWsTransport = (ws: any) => {
            if (!ws || ws.__hookedBusWs) return;
            ws.__hookedBusWs = true;
            const socketInstanceId = ++(window as any).__socketInstanceSeq;
            ws.__socketInstanceId = socketInstanceId;
            const origSend = ws.send.bind(ws);
            ws.send = (data: any) => {
              try {
                const parsed = JSON.parse(typeof data === "string" ? data : String(data));
                if (
                  parsed?.type === "exit_vehicle" ||
                  parsed?.type === "board_vehicle" ||
                  parsed?.type === "board_bus" ||
                  parsed?.type === "alight_bus"
                ) {
                  const sent = (window as any).__sentTransitions;
                  sent.push({
                    atMs: Date.now(),
                    socketInstanceId,
                    type: parsed.type,
                    epoch: parsed.epoch ?? null,
                    mode: parsed.mode ?? null,
                    seq: parsed.seq ?? null,
                  });
                  if (sent.length > MAX_DIAG_TAIL) {
                    sent.splice(0, sent.length - MAX_DIAG_TAIL);
                  }
                }
              } catch {}
              return origSend(data);
            };
            ws.addEventListener("message", (ev: any) => {
              try {
                const parsed = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
                if (
                  parsed?.type === "vehicle_exited" ||
                  parsed?.type === "vehicle_boarded" ||
                  parsed?.type === "bus_boarded" ||
                  parsed?.type === "bus_alighted" ||
                  parsed?.type === "peer_mode_changed" ||
                  parsed?.type === "error" ||
                  parsed?.type === "session_reconnected"
                ) {
                  const recv = (window as any).__recvTransitions;
                  recv.push({
                    atMs: Date.now(),
                    socketInstanceId,
                    type: parsed.type,
                    participantId: parsed.participantId ?? null,
                    mode: parsed.mode ?? null,
                    modeEpoch: parsed.modeEpoch ?? null,
                    isPedestrian: parsed.isPedestrian ?? null,
                    x: Number.isFinite(parsed.x) ? Number(parsed.x.toFixed(3)) : null,
                    z: Number.isFinite(parsed.z) ? Number(parsed.z.toFixed(3)) : null,
                    heading: Number.isFinite(parsed.heading) ? Number(parsed.heading.toFixed(3)) : null,
                    carX: Number.isFinite(parsed.carX) ? Number(parsed.carX.toFixed(3)) : null,
                    carZ: Number.isFinite(parsed.carZ) ? Number(parsed.carZ.toFixed(3)) : null,
                    carHeading: Number.isFinite(parsed.carHeading) ? Number(parsed.carHeading.toFixed(3)) : null,
                    error: parsed.error ?? parsed.code ?? null,
                    message: parsed.message ?? null,
                  });
                  if (recv.length > MAX_DIAG_TAIL) {
                    recv.splice(0, recv.length - MAX_DIAG_TAIL);
                  }
                }
              } catch {}
            });
          };

          if (mp && !mp.__hookedBusTest) {
            mp.__hookedBusTest = true;
            const origSnap = mp.options.onSnapshot;
            mp.options.onSnapshot = (s: any) => {
              const t0 = performance.now();
              (window as any).__snapshotCount = ((window as any).__snapshotCount || 0) + 1;
              (window as any).__lastSnapshot = s;
              const hist = (window as any).__snapshotHistory;
              hist.push(s);
              if (hist.length > MAX_DIAG_TAIL) {
                hist.splice(0, hist.length - MAX_DIAG_TAIL);
              }
              origSnap?.(s);
              (window as any).__lastSnapshotHandlerMs = Number((performance.now() - t0).toFixed(3));
            };
            const origErr = mp.options.onError;
            mp.options.onError = (e: any) => {
              const errs = (window as any).__mpErrors;
              errs.push({
                atMs: Date.now(),
                code: e?.code ?? e?.error ?? null,
                message: e?.message ?? null,
              });
              if (errs.length > MAX_DIAG_TAIL) {
                errs.splice(0, errs.length - MAX_DIAG_TAIL);
              }
              origErr?.(e);
            };
            hookWsTransport(mp.ws);
            const origConnect = mp.connect.bind(mp);
            mp.connect = (...args: any[]) => {
              const prevWs = mp.ws;
              const res = origConnect(...args);
              if (res && typeof res.then === "function") {
                return res.then((val: any) => {
                  if (mp.ws && mp.ws !== prevWs) {
                    hookWsTransport(mp.ws);
                  }
                  return val;
                });
              }
              if (mp.ws && mp.ws !== prevWs) {
                hookWsTransport(mp.ws);
              }
              return res;
            };
          }
        }, targetMs);
      };
      await Promise.all([
        attachListenersAndSyncClock(page1, baseSolNow),
        attachListenersAndSyncClock(page2, baseSolNow),
      ]);

      // Separate Player 2's vehicle slightly forward along the road via real keyboard throttle (KeyW)
      // from y=273 to y~277.4 so the two parked cars sit at distinct road coordinates while BOTH stay
      // outside Stop 0's 3.0-cell boarding/pole radius (Stop 0 at=(124, 281.890625), furniture=(121.75, 281.890625))
      await page2.bringToFront();
      await page2.keyboard.down("KeyW");
      await page2.waitForFunction(() => {
        const last = (window as any).__lastSnapshot;
        const p2 = last?.participants?.find((x: any) => x.username === "jamtin2");
        return p2 && p2.z > (273.35 - 304) * 4;
      }, undefined, { timeout: 15_000, polling: 50 });
      await page2.keyboard.up("KeyW");
      await page2.keyboard.down("Space");
      await page2.waitForFunction(() => {
        const last = (window as any).__lastSnapshot;
        const p2 = last?.participants?.find((x: any) => x.username === "jamtin2");
        return p2 && Math.abs(p2.speed) < 0.05;
      }, undefined, { timeout: 15_000, polling: 100 });
      await page2.keyboard.up("Space");

      // Both players click real UI "Park & Exit" button to transition from driving to walking
      const exitBtn1 = page1.locator('[data-testid="exit-owned-car"]');
      const exitBtn2 = page2.locator('[data-testid="exit-owned-car"]');
      await expect(exitBtn1).toBeVisible({ timeout: 10_000 });
      await expect(exitBtn2).toBeVisible({ timeout: 10_000 });

      const inspectExitHitAndPreState = async (p: Page, btn: typeof exitBtn1) => {
        const box = await btn.boundingBox();
        return p.evaluate((b) => {
          const colony = (window as any).__colony;
          const cx = b ? b.x + b.width / 2 : -1;
          const cy = b ? b.y + b.height / 2 : -1;
          const el = b ? document.elementFromPoint(cx, cy) : null;
          return {
            hitTarget: el
              ? {
                  tag: el.tagName,
                  testId: el.getAttribute("data-testid"),
                  closestExitTestId: el.closest('[data-testid="exit-owned-car"]')?.getAttribute("data-testid") ?? null,
                }
              : null,
            preOwnedDriveSeated: colony?.isOwnedDriveSeated?.() ?? null,
            preOwnedDrivePose: colony?.getOwnedDrivePose?.() ?? null,
            preClientMode: colony?.getMultiplayerClient?.()?.getMode?.() ?? null,
            preModeEpoch: colony?.getMultiplayerClient?.()?.getModeEpoch?.() ?? null,
          };
        }, box);
      };
      const [preExit1, preExit2] = await Promise.all([
        inspectExitHitAndPreState(page1, exitBtn1),
        inspectExitHitAndPreState(page2, exitBtn2),
      ]);
      console.log("[Exit4018 Pre-Click Diagnostic] P1:", JSON.stringify(preExit1));
      console.log("[Exit4018 Pre-Click Diagnostic] P2:", JSON.stringify(preExit2));

      const collectClientExitDiag = (p: Page) =>
        p.evaluate(() => {
          const colony = (window as any).__colony;
          const mp = colony?.getMultiplayerClient?.();
          const hist = (window as any).__snapshotHistory || [];
          const last = (window as any).__lastSnapshot ?? hist[hist.length - 1];
          return {
            snapshotCount: (window as any).__snapshotCount ?? hist.length,
            snapshotTailLength: hist.length,
            lastSnapshotSeq: last?.seq ?? null,
            lastSnapshotTimestamp: last?.timestamp ?? null,
            lastSnapshotHandlerMs: (window as any).__lastSnapshotHandlerMs ?? null,
            lastSnapshotParticipants: (last?.participants || []).map((pt: any) => ({
              participantId: pt.participantId ?? null,
              username: pt.username ?? null,
              alias: pt.alias ?? null,
              mode: pt.mode ?? null,
              isPedestrian: pt.isPedestrian ?? null,
              modeEpoch: pt.modeEpoch ?? null,
              x: Number.isFinite(pt.x) ? Number(pt.x.toFixed(3)) : null,
              z: Number.isFinite(pt.z) ? Number(pt.z.toFixed(3)) : null,
              heading: Number.isFinite(pt.heading) ? Number(pt.heading.toFixed(3)) : null,
              carX: Number.isFinite(pt.carX) ? Number(pt.carX.toFixed(3)) : null,
              carZ: Number.isFinite(pt.carZ) ? Number(pt.carZ.toFixed(3)) : null,
              carHeading: Number.isFinite(pt.carHeading) ? Number(pt.carHeading.toFixed(3)) : null,
              hasFiniteCarTuple:
                Number.isFinite(pt.carX) && Number.isFinite(pt.carZ) && Number.isFinite(pt.carHeading),
            })),
            socketState: {
              status: mp?.getStatus?.() ?? null,
              readyState: mp?.ws?.readyState ?? null,
              socketInstanceId: mp?.ws?.__socketInstanceId ?? null,
              clientMode: mp?.getMode?.() ?? null,
              modeEpoch: mp?.getModeEpoch?.() ?? null,
            },
            localState: {
              ownedDriveSeated: colony?.isOwnedDriveSeated?.() ?? null,
              ownedDrivePose: colony?.getOwnedDrivePose?.() ?? null,
              parkedCarPose: colony?.getParkedCarPose?.() ?? null,
              walkingCell: colony?.getWalkingCell?.() ?? null,
              blockedReason: colony?.fpBlockedReason ?? null,
            },
            clickHandlerTimings: (window as any).__clickHandlerTimings || [],
            sentTransitions: (window as any).__sentTransitions || [],
            recvTransitions: (window as any).__recvTransitions || [],
            mpErrors: (window as any).__mpErrors || [],
          };
        });

      let click1StartMs: number | null = null;
      let click1EndMs: number | null = null;
      let click1Error: string | null = null;
      let click2StartMs: number | null = null;
      let click2EndMs: number | null = null;
      let click2Error: string | null = null;
      let predicateStartMs: number | null = null;
      let predicateEndMs: number | null = null;
      let predicateError: string | null = null;

      try {
        await page1.bringToFront();
        click1StartMs = Date.now();
        try {
          await exitBtn1.click();
          click1EndMs = Date.now();
        } catch (err: any) {
          click1EndMs = Date.now();
          click1Error = err?.message ?? String(err);
          throw err;
        }

        await page2.bringToFront();
        click2StartMs = Date.now();
        try {
          await exitBtn2.click();
          click2EndMs = Date.now();
        } catch (err: any) {
          click2EndMs = Date.now();
          click2Error = err?.message ?? String(err);
          throw err;
        }

        // Wait for authoritative server transition to mode === "walking" with retained full parked car tuple
        predicateStartMs = Date.now();
        try {
          await Promise.all([
            page1.waitForFunction(() => {
              const last = (window as any).__lastSnapshot;
              const p = last?.participants?.find((x: any) => x.username === "jamtin");
              return (
                p?.isPedestrian === true &&
                p?.mode === "walking" &&
                Number.isFinite(p?.carX) &&
                Number.isFinite(p?.carZ) &&
                Number.isFinite(p?.carHeading)
              );
            }, undefined, { timeout: 15_000, polling: 100 }),
            page2.waitForFunction(() => {
              const last = (window as any).__lastSnapshot;
              const p = last?.participants?.find((x: any) => x.username === "jamtin2");
              return (
                p?.isPedestrian === true &&
                p?.mode === "walking" &&
                Number.isFinite(p?.carX) &&
                Number.isFinite(p?.carZ) &&
                Number.isFinite(p?.carHeading)
              );
            }, undefined, { timeout: 15_000, polling: 100 }),
          ]);
          predicateEndMs = Date.now();
        } catch (err: any) {
          predicateEndMs = Date.now();
          predicateError = err?.message ?? String(err);
          throw err;
        }
      } finally {
        const [diag1, diag2] = await Promise.all([
          collectClientExitDiag(page1).catch(() => null),
          collectClientExitDiag(page2).catch(() => null),
        ]);
        const timingBreakdown = {
          click1StartMs,
          click1EndMs,
          click1DurationMs: click1StartMs !== null && click1EndMs !== null ? click1EndMs - click1StartMs : null,
          click1Error,
          click2StartMs,
          click2EndMs,
          click2DurationMs: click2StartMs !== null && click2EndMs !== null ? click2EndMs - click2StartMs : null,
          click2Error,
          predicateStartMs,
          predicateEndMs,
          predicateDurationMs:
            predicateStartMs !== null && predicateEndMs !== null ? predicateEndMs - predicateStartMs : null,
          predicateError,
          p1PointerDownAtMs:
            diag1?.clickHandlerTimings?.find((t: any) => t.event === "pointerdown" && t.testId === "exit-owned-car")?.atMs ?? null,
          p1DomClickAtMs:
            diag1?.clickHandlerTimings?.find((t: any) => t.event === "click" && t.testId === "exit-owned-car")?.atMs ?? null,
          p1ExitSendAtMs: diag1?.sentTransitions?.find((t: any) => t.type === "exit_vehicle")?.atMs ?? null,
          p1ExitAckAtMs: diag1?.recvTransitions?.find((t: any) => t.type === "vehicle_exited")?.atMs ?? null,
          p2PointerDownAtMs:
            diag2?.clickHandlerTimings?.find((t: any) => t.event === "pointerdown" && t.testId === "exit-owned-car")?.atMs ?? null,
          p2DomClickAtMs:
            diag2?.clickHandlerTimings?.find((t: any) => t.event === "click" && t.testId === "exit-owned-car")?.atMs ?? null,
          p2ExitSendAtMs: diag2?.sentTransitions?.find((t: any) => t.type === "exit_vehicle")?.atMs ?? null,
          p2ExitAckAtMs: diag2?.recvTransitions?.find((t: any) => t.type === "vehicle_exited")?.atMs ?? null,
        };
        const serverSessionsDiag: any[] = [];
        for (const [sId, sess] of (realtime as any).sessions.entries()) {
          serverSessionsDiag.push({
            sessionId: sId,
            snapshotSeq: sess.snapshotSeq ?? 0,
            hasTerrainAuthority: Boolean(sess.hasTerrainAuthority),
            walkableCellsCount: sess.walkability?.walkableCells?.size ?? 0,
            participants: Array.from(sess.participants.values()).map((pt: any) => ({
              participantId: pt.participantId,
              username: pt.username,
              mode: pt.isPedestrian ? "walking" : "driving",
              isPedestrian: pt.isPedestrian,
              modeEpoch: pt.modeEpoch,
              x: Number.isFinite(pt.x) ? Number(pt.x.toFixed(3)) : null,
              z: Number.isFinite(pt.z) ? Number(pt.z.toFixed(3)) : null,
              heading: Number.isFinite(pt.heading) ? Number(pt.heading.toFixed(3)) : null,
              carX: Number.isFinite(pt.carX) ? Number(pt.carX.toFixed(3)) : null,
              carZ: Number.isFinite(pt.carZ) ? Number(pt.carZ.toFixed(3)) : null,
              carHeading: Number.isFinite(pt.carHeading) ? Number(pt.carHeading.toFixed(3)) : null,
              hasFiniteCarTuple:
                Number.isFinite(pt.carX) && Number.isFinite(pt.carZ) && Number.isFinite(pt.carHeading),
            })),
          });
        }
        console.log("[Exit4018 Timing Breakdown]:", JSON.stringify(timingBreakdown));
        console.log("[Exit4018 Post-Click Server Diagnostic]:", JSON.stringify(serverSessionsDiag));
        console.log("[Exit4018 Post-Click Client P1 Diagnostic]:", JSON.stringify(diag1));
        console.log("[Exit4018 Post-Click Client P2 Diagnostic]:", JSON.stringify(diag2));
      }

      if (process.env.BUS_EXIT_DIAG_ONLY === "1") {
        throw new Error(
          "[Exit4018 Diagnostic Replay Only] Boundary reached; failing intentionally so diagnostic-only replay can never report full-journey pass.",
        );
      }

      // 1A. DISTANT-POLE NEGATIVE CONTROL:
      // Verify both players' post-exit foot cells are genuinely outside Stop 0's configured 3.0-cell anchor radius
      // (min(distance to stop.furniture, distance to stop.at) > 3.0), with finite numeric coordinates and finite computed distance.
      const measureStop0MinDistance = async (p: Page) =>
        p.evaluate(() => {
          const colony = (window as any).__colony;
          const stop = colony?.busStopAnchors?.()?.[0];
          const cell = colony?.getWalkingCell?.();
          if (
            !stop ||
            !cell ||
            !Number.isFinite(cell.x) ||
            !Number.isFinite(cell.y) ||
            !Number.isFinite(stop.furniture?.x) ||
            !Number.isFinite(stop.furniture?.y) ||
            !Number.isFinite(stop.at?.x) ||
            !Number.isFinite(stop.at?.y)
          ) {
            return { minDist: NaN, dFurn: NaN, dAt: NaN, cell: cell ?? null, stopAt: stop?.at ?? null, stopFurniture: stop?.furniture ?? null };
          }
          const dFurn = Math.hypot(cell.x - stop.furniture.x, cell.y - stop.furniture.y);
          const dAt = Math.hypot(cell.x - stop.at.x, cell.y - stop.at.y);
          return {
            minDist: Math.min(dFurn, dAt),
            dFurn,
            dAt,
            cell,
            stopAt: stop.at,
            stopFurniture: stop.furniture,
          };
        });

      let [distP1, distP2] = await Promise.all([measureStop0MinDistance(page1), measureStop0MinDistance(page2)]);
      expect(Number.isFinite(distP1.minDist)).toBe(true);
      expect(Number.isFinite(distP2.minDist)).toBe(true);
      if (distP2.minDist <= 3.1) {
        await page2.bringToFront();
        await page2.locator("canvas").first().click({ position: { x: 200, y: 200 } });
        const keySStartDiag = await page2.evaluate(() => {
          const colony = (window as any).__colony;
          const last = (window as any).__lastSnapshot;
          const self = last?.participants?.find((x: any) => x.username === "jamtin2");
          return {
            walkingCell: colony?.getWalkingCell?.() ?? null,
            wireHeading: colony?.getFirstPersonWireHeading?.() ?? null,
            blockedReason: colony?.fpBlockedReason ?? null,
            sentInputSeq: colony?.multiplayerInputSeq ?? null,
            serverPos: self ? { x: self.x, z: self.z, heading: self.heading, lastInputSeq: self.lastInputSeq } : null,
          };
        });
        await page2.keyboard.down("KeyS");
        try {
          await page2.waitForFunction(
            () => {
              const colony = (window as any).__colony;
              const stop = colony?.busStopAnchors?.()?.[0];
              const cell = colony?.getWalkingCell?.();
              if (
                !stop ||
                !cell ||
                !Number.isFinite(cell.x) ||
                !Number.isFinite(cell.y) ||
                !Number.isFinite(stop.furniture?.x) ||
                !Number.isFinite(stop.furniture?.y) ||
                !Number.isFinite(stop.at?.x) ||
                !Number.isFinite(stop.at?.y)
              ) {
                return false;
              }
              const dFurn = Math.hypot(cell.x - stop.furniture.x, cell.y - stop.furniture.y);
              const dAt = Math.hypot(cell.x - stop.at.x, cell.y - stop.at.y);
              const minDist = Math.min(dFurn, dAt);
              return Number.isFinite(minDist) && minDist > 3.5;
            },
            undefined,
            { timeout: 10_000, polling: 100 },
          );
        } finally {
          await page2.keyboard.up("KeyS").catch(() => {});
          const keySEndDiag = await page2.evaluate(() => {
            const colony = (window as any).__colony;
            const last = (window as any).__lastSnapshot;
            const self = last?.participants?.find((x: any) => x.username === "jamtin2");
            return {
              walkingCell: colony?.getWalkingCell?.() ?? null,
              wireHeading: colony?.getFirstPersonWireHeading?.() ?? null,
              blockedReason: colony?.fpBlockedReason ?? null,
              sentInputSeq: colony?.multiplayerInputSeq ?? null,
              serverPos: self ? { x: self.x, z: self.z, heading: self.heading, lastInputSeq: self.lastInputSeq } : null,
            };
          }).catch(() => null);
          console.log("[Distant-Pole KeyS Walk Diagnostic]:", JSON.stringify({ start: keySStartDiag, end: keySEndDiag }));
        }
        distP2 = await measureStop0MinDistance(page2);
      }
      expect(Number.isFinite(distP1.minDist)).toBe(true);
      expect(Number.isFinite(distP2.minDist)).toBe(true);
      expect(distP1.minDist).toBeGreaterThan(3.0);
      expect(distP2.minDist).toBeGreaterThan(3.0);

      const stopCard1 = page1.locator('[data-testid="bus-stop-card"]');
      const stopCard2 = page2.locator('[data-testid="bus-stop-card"]');
      await expect(stopCard1).toHaveCount(0);
      await expect(stopCard2).toHaveCount(0);

      // 1B. PARKED CAR RETENTION & REAL UI CAR RE-ENTRY PROOF:
      // Verify remote parked cars are mounted in 3D scenes and Player 1 can re-enter and re-exit their parked car via UI
      await Promise.all([
        page1.waitForFunction(() => {
          const scene = (window as any).__r3fScene;
          let found = false;
          scene?.traverse((o: any) => {
            if (o.name === "remote-parked-car-jamtin2") found = true;
          });
          return found;
        }, undefined, { timeout: 15_000, polling: 100 }),
        page2.waitForFunction(() => {
          const scene = (window as any).__r3fScene;
          let found = false;
          scene?.traverse((o: any) => {
            if (o.name === "remote-parked-car-jamtin") found = true;
          });
          return found;
        }, undefined, { timeout: 15_000, polling: 100 }),
      ]);

      await page1.bringToFront();
      const enterCarBtn1 = page1.locator('[data-testid="enter-owned-car"]');
      await expect(enterCarBtn1).toBeVisible({ timeout: 10_000 });
      await enterCarBtn1.click();

      await page1.waitForFunction(() => {
        const last = (window as any).__lastSnapshot;
        const p1 = last?.participants?.find((x: any) => x.username === "jamtin");
        return p1?.mode === "driving" && p1?.isPedestrian === false;
      }, undefined, { timeout: 15_000, polling: 100 });

      // Exit car again via real UI button to proceed on foot to Stop 0
      await expect(exitBtn1).toBeVisible({ timeout: 10_000 });
      await exitBtn1.click();
      await page1.waitForFunction(() => {
        const last = (window as any).__lastSnapshot;
        const p1 = last?.participants?.find((x: any) => x.username === "jamtin");
        return (
          p1?.mode === "walking" &&
          p1?.isPedestrian === true &&
          Number.isFinite(p1?.carX) &&
          Number.isFinite(p1?.carZ) &&
          Number.isFinite(p1?.carHeading)
        );
      }, undefined, { timeout: 15_000, polling: 100 });

      // Capture authoritative server AND local runtime parked car tuples after final park
      const [parkedCarsInitial, localParkedP1, localParkedP2] = await Promise.all([
        page1.evaluate(() => {
          const last = (window as any).__lastSnapshot;
          const p1 = last?.participants?.find((x: any) => x.username === "jamtin");
          const p2 = last?.participants?.find((x: any) => x.username === "jamtin2");
          return {
            p1: { carX: p1.carX, carZ: p1.carZ, carHeading: p1.carHeading },
            p2: { carX: p2.carX, carZ: p2.carZ, carHeading: p2.carHeading },
          };
        }),
        page1.evaluate(() => (window as any).__colony.getParkedCarPose()),
        page2.evaluate(() => (window as any).__colony.getParkedCarPose()),
      ]);
      expect(Math.hypot(parkedCarsInitial.p1.carX - parkedCarsInitial.p2.carX, parkedCarsInitial.p1.carZ - parkedCarsInitial.p2.carZ)).toBeGreaterThan(2.0);
      expect(localParkedP1).not.toBeNull();
      expect(Number.isFinite(localParkedP1.x)).toBe(true);
      expect(Number.isFinite(localParkedP1.y)).toBe(true);
      expect(Number.isFinite(localParkedP1.heading)).toBe(true);
      expect(localParkedP2).not.toBeNull();
      expect(Number.isFinite(localParkedP2.x)).toBe(true);
      expect(Number.isFinite(localParkedP2.y)).toBe(true);
      expect(Number.isFinite(localParkedP2.heading)).toBe(true);

      // 2. REAL KEYBOARD WALK TO SERVED STOP 0 POLE:
      // Stop 0 anchor is at: (124, 281.890625), furniture: (121.75, 281.890625).
      // Both players exit on the avenue at x=126.35 facing south (heading = PI/2).
      // Phase A: Walk south along the avenue (KeyW) until cellY >= stop.at.y - 0.35 (~281.54).
      // Phase B: Step west across the kerb toward the pole (KeyD at heading = PI/2) until dAt <= 2.6 && dFurn <= 2.8.
      const collectWalkDiag = (p: Page, username: string) =>
        p.evaluate((u) => {
          const colony = (window as any).__colony;
          const tSize = colony?.sim?.state?.terrain?.size ?? 608;
          const stop = colony?.busStopAnchors?.()?.[0];
          const last = (window as any).__lastSnapshot;
          const self = last?.participants?.find((x: any) => x.username === u);
          const serverCell =
            self && Number.isFinite(self.x) && Number.isFinite(self.z)
              ? { x: Number((self.x / 4 + tSize / 2).toFixed(3)), y: Number((self.z / 4 + tSize / 2).toFixed(3)) }
              : null;
          const localCell = colony?.getWalkingCell?.() ?? null;
          const dAt =
            serverCell && stop?.at ? Number(Math.hypot(serverCell.x - stop.at.x, serverCell.y - stop.at.y).toFixed(3)) : null;
          const dFurn =
            serverCell && stop?.furniture
              ? Number(Math.hypot(serverCell.x - stop.furniture.x, serverCell.y - stop.furniture.y).toFixed(3))
              : null;
          return {
            username: u,
            localWalkingCell: localCell,
            wireHeading: Number.isFinite(colony?.getFirstPersonWireHeading?.())
              ? Number(colony.getFirstPersonWireHeading().toFixed(3))
              : null,
            blockedReason: colony?.fpBlockedReason ?? null,
            clientSentInputSeq: colony?.multiplayerInputSeq ?? null,
            serverLastInputSeq: self?.lastInputSeq ?? null,
            serverCell,
            serverHeading: Number.isFinite(self?.heading) ? Number(self.heading.toFixed(3)) : null,
            dAt,
            dFurn,
          };
        }, username);

      const walkPlayerToStop0 = async (p: Page, username: string) => {
        await p.bringToFront();
        const canvas = p.locator("canvas").first();
        await canvas.click({ position: { x: 200, y: 200 } });
        const startDiag = await collectWalkDiag(p, username);
        expect(startDiag.localWalkingCell).not.toBeNull();
        expect(Number.isFinite(startDiag.localWalkingCell.x)).toBe(true);
        expect(Number.isFinite(startDiag.localWalkingCell.y)).toBe(true);
        expect(Number.isFinite(startDiag.wireHeading)).toBe(true);
        const startSeq = startDiag.serverLastInputSeq ?? 0;

        try {
          // Phase A: Walk south along the avenue (KeyW) until aligned in Y with Stop 0 (cellY >= stop.at.y - 0.35)
          await p.keyboard.down("KeyW");
          try {
            await p.waitForFunction(
              ({ u, minSeq }) => {
                const colony = (window as any).__colony;
                const tSize = colony?.sim?.state?.terrain?.size ?? 608;
                const stop = colony?.busStopAnchors?.()?.[0];
                const last = (window as any).__lastSnapshot;
                const self = last?.participants?.find((x: any) => x.username === u);
                if (!self || !stop || (self.lastInputSeq ?? 0) <= minSeq) return false;
                const cellY = self.z / 4 + tSize / 2;
                return Number.isFinite(cellY) && cellY >= stop.at.y - 0.35;
              },
              { u: username, minSeq: startSeq },
              { timeout: 20_000, polling: 50 },
            );
          } finally {
            await p.keyboard.up("KeyW").catch(() => {});
          }

          // Phase B: Step west toward the Stop 0 pole (KeyD at heading = PI/2, plus KeyW if cellY < stop.at.y - 0.2)
          // until authoritative server cell satisfies both dAt <= 2.6 and dFurn <= 2.8
          const midDiag = await collectWalkDiag(p, username);
          const midSeq = midDiag.serverLastInputSeq ?? startSeq;
          await p.keyboard.down("KeyD");
          try {
            await p.waitForFunction(
              ({ u, minSeq }) => {
                const colony = (window as any).__colony;
                const tSize = colony?.sim?.state?.terrain?.size ?? 608;
                const stop = colony?.busStopAnchors?.()?.[0];
                const last = (window as any).__lastSnapshot;
                const self = last?.participants?.find((x: any) => x.username === u);
                if (!self || !stop || (self.lastInputSeq ?? 0) <= minSeq) return false;
                const cellX = self.x / 4 + tSize / 2;
                const cellY = self.z / 4 + tSize / 2;
                const dFurn = Math.hypot(cellX - stop.furniture.x, cellY - stop.furniture.y);
                const dAt = Math.hypot(cellX - stop.at.x, cellY - stop.at.y);
                return Number.isFinite(dAt) && Number.isFinite(dFurn) && dAt <= 2.6 && dFurn <= 2.8;
              },
              { u: username, minSeq: midSeq },
              { timeout: 15_000, polling: 50 },
            );
          } finally {
            await p.keyboard.up("KeyD").catch(() => {});
          }
        } finally {
          await p.keyboard.up("KeyD").catch(() => {});
          await p.keyboard.up("KeyW").catch(() => {});
          const endDiag = await collectWalkDiag(p, username).catch(() => null);
          console.log(`[WalkToStop0 Diagnostic ${username}]:`, JSON.stringify({ start: startDiag, end: endDiag }));
        }
      };

      await walkPlayerToStop0(page1, "jamtin");
      await walkPlayerToStop0(page2, "jamtin2");

      if (process.env.BUS_WALK_DIAG_ONLY === "1") {
        throw new Error(
          "[WalkToStop0 Diagnostic Replay Only] Boundary reached; failing intentionally so diagnostic-only replay can never report full-journey pass.",
        );
      }

      // 3. SERVED POLE BUTTON & REASONS + WAIT / CANCEL LIFECYCLE:
      await expect(stopCard1).toBeVisible({ timeout: 15_000 });
      await expect(stopCard1).toHaveAttribute("data-stop-index", "0");
      await expect(stopCard1).toHaveAttribute("data-can-board", "false");

      const stopStatus1 = page1.locator('[data-testid="bus-stop-status"]');
      await expect(stopStatus1).toBeVisible();
      await expect(stopStatus1).toContainText("No bus currently at stop");

      const waitBtn1 = page1.locator('[data-fp-action="wait-next-bus"]');
      await expect(waitBtn1).toBeVisible();

      const stopCardScreenshot = path.resolve("test-results/actual-pair-screenshots/page1-stop-card-idle.png");
      await page1.screenshot({ path: stopCardScreenshot });

      // Click Wait -> verify waiting state and Cancel button
      await page1.bringToFront();
      await waitBtn1.click();
      await expect(stopCard1).toHaveAttribute("data-waiting", "true");
      await expect(stopStatus1).toContainText("Waiting for next bus");

      const cancelBtn1 = page1.locator('[data-fp-action="cancel-wait-bus"]');
      await expect(cancelBtn1).toBeVisible();

      // Click Cancel -> verify return to idle state
      await cancelBtn1.click();
      await expect(stopCard1).toHaveAttribute("data-waiting", "false");
      await expect(waitBtn1).toBeVisible();

      // Re-arm Wait on Player 1 (to prove auto-board on arrival) while leaving Player 2 idle (to click "Board Bus 1" button on arrival)
      await waitBtn1.click();
      await expect(stopCard1).toHaveAttribute("data-waiting", "true");
      await expect(stopCard2).toBeVisible({ timeout: 15_000 });
      await expect(stopCard2).toHaveAttribute("data-waiting", "false");

      // 4. BUS ARRIVAL AT STOP 0 & REAL UI BOARDING INTO DISTINCT SEATS:
      const sessions = Array.from((realtime as any).sessions.values()) as any[];
      expect(sessions.length).toBeGreaterThan(0);
      const session = sessions[0]!;
      const runner = realtime.getSessionTransitRunner(session.id);
      expect(runner).toBeDefined();

      // Advance canonical sol clock to Stop 0 service dwell (CITYLIFE_EPOCH_MS + 4_756_000)
      const stop0DwellNow = CITYLIFE_EPOCH_MS + 4_756_000;
      mockNow = stop0DwellNow;

      // Bounded poll for server transit runner to tick into Stop 0 dwell BEFORE advancing client clocks
      await expect
        .poll(() => {
          const p = runner!.getBusWorldPose(0, session.originX, session.originZ, session.cellMetres);
          return Boolean(
            p &&
            p.busId === 0 &&
            p.doorsOpen === true &&
            Number.isFinite(p.speed) &&
            p.speed === 0 &&
            p.atStop === true
          );
        }, { timeout: 5_000 })
        .toBe(true);

      await Promise.all([
        page1.evaluate((ms) => (window as any).__colony.debugSetSolNowMs(ms), stop0DwellNow),
        page2.evaluate((ms) => (window as any).__colony.debugSetSolNowMs(ms), stop0DwellNow),
      ]);

      const stop0BusPose = runner!.getBusWorldPose(0, session.originX, session.originZ, session.cellMetres)!;
      expect(stop0BusPose).toBeDefined();
      expect(stop0BusPose.busId).toBe(0);
      expect(stop0BusPose.doorsOpen).toBe(true);
      expect(Number.isFinite(stop0BusPose.speed)).toBe(true);
      expect(stop0BusPose.speed).toBe(0);
      expect(stop0BusPose.atStop).toBe(true);
      expect(Number.isFinite(stop0BusPose.x)).toBe(true);
      expect(Number.isFinite(stop0BusPose.y)).toBe(true);
      expect(Number.isFinite(stop0BusPose.z)).toBe(true);
      expect(Number.isFinite(stop0BusPose.heading)).toBe(true);

      // Verify server pose is within served Stop 0 anchor radius
      const stop0Anchor = runner!.stopAnchors[0]!;
      expect(stop0Anchor).toBeDefined();
      const stop0WorldX = session.originX + stop0Anchor.at.x * session.cellMetres;
      const stop0WorldZ = session.originZ + stop0Anchor.at.y * session.cellMetres;
      const distToStop0 = Math.hypot(stop0BusPose.x - stop0WorldX, stop0BusPose.z - stop0WorldZ);
      expect(Number.isFinite(distToStop0)).toBe(true);
      expect(distToStop0).toBeLessThanOrEqual(3.0 * session.cellMetres);

      // Player 1 auto-boards from wait-next-bus queue; Player 2 clicks the real UI "Board Bus 1" button
      await page2.bringToFront();
      const boardBtn2 = page2.locator('[data-fp-action="board-dwelling-bus"]');
      await expect(boardBtn2).toBeVisible({ timeout: 15_000 });
      await expect(stopCard2).toHaveAttribute("data-can-board", "true");
      await boardBtn2.click();

      // Verify both clients are admitted to mode === "riding_bus" on Bus 0 in distinct seats
      await Promise.all([
        page1.waitForFunction(() => {
          const mp = (window as any).__colony?.getMultiplayerClient();
          return mp?.getMode() === "riding_bus" && mp?.getSeatedBusId() === 0 && typeof mp?.getSeatIndex() === "number";
        }, undefined, { timeout: 15_000, polling: 100 }),
        page2.waitForFunction(() => {
          const mp = (window as any).__colony?.getMultiplayerClient();
          return mp?.getMode() === "riding_bus" && mp?.getSeatedBusId() === 0 && typeof mp?.getSeatIndex() === "number";
        }, undefined, { timeout: 15_000, polling: 100 }),
      ]);

      const [seatP1, pidP1] = await page1.evaluate(() => {
        const mp = (window as any).__colony?.getMultiplayerClient();
        return [mp?.getSeatIndex(), mp?.getSessionInfo()?.participantId];
      });
      const [seatP2, pidP2] = await page2.evaluate(() => {
        const mp = (window as any).__colony?.getMultiplayerClient();
        return [mp?.getSeatIndex(), mp?.getSessionInfo()?.participantId];
      });
      expect(typeof seatP1).toBe("number");
      expect(typeof seatP2).toBe("number");
      expect(typeof pidP1).toBe("string");
      expect(typeof pidP2).toBe("string");
      expect(pidP1).toBeTruthy();
      expect(pidP2).toBeTruthy();
      expect(seatP1).not.toBe(seatP2);
      expect(pidP1).not.toBe(pidP2);
      expect(runner!.getOccupiedSeats(0)).toBe(2);

      // 5. MOUNTED SEATED CRAB PEERS & COACH-DERIVED 3D SEAT TRANSFORM PROOF (X, Y, Z & ORIENTATION):
      const verifySeatedCrabAndTransform = async (
        viewerPage: Page,
        peerUsername: string,
        expectedSeat: number,
        expectedPid: string,
      ) => {
        try {
          return await viewerPage.waitForFunction(
            ({ u, seat, expPid }) => {
              const scene = (window as any).__r3fScene;
              if (!scene) return false;
              let peerGroup: any = null;
              let parkedCarGroup: any = null;
              let coachGroup: any = null;
              scene.traverse((o: any) => {
                if (o.name === `remote-racer-${u}` && o.userData?.username === u) peerGroup = o;
                if (o.name === `remote-parked-car-${u}` && o.userData?.username === u) parkedCarGroup = o;
                if (o.name === "bus-coach-0") coachGroup = o;
              });
              if (!peerGroup || !coachGroup) return false;
              // Coexistence negative control: parked car and racer both present; selected racer must not have parked:true
              if (peerGroup.userData?.parked === true) return false;
              if (!parkedCarGroup || parkedCarGroup.userData?.parked !== true) return false;
              if (peerGroup.userData?.participantId !== expPid) {
                return false;
              }
              if (peerGroup.userData?.mode !== "riding_bus" || peerGroup.userData?.seatIndex !== seat) {
                return false;
              }

              const isHierarchyVisible = (obj: any): boolean => {
                let curr = obj;
                while (curr) {
                  if (curr.visible === false) return false;
                  curr = curr.parent;
                }
                return true;
              };
              if (!isHierarchyVisible(peerGroup)) return false;

              let seatedCrabChild: any = null;
              peerGroup.traverse((child: any) => {
                if (typeof child.name === "string" && child.name.startsWith("seated-crab-")) {
                  seatedCrabChild = child;
                }
              });
              if (!seatedCrabChild || !isHierarchyVisible(seatedCrabChild)) return false;

              // Compare directly against the actual rendered bus-coach-0 and bus-seat-* mesh in the 3D scene
              coachGroup.updateMatrixWorld(true);
              const sideName = seat < 5 ? "left" : "right";
              const rowIdx = seat % 5;
              const seatMeshName = `bus-seat-${sideName}-${rowIdx}`;
              let seatMesh: any = null;
              coachGroup.traverse((child: any) => {
                if (child.name === seatMeshName) seatMesh = child;
              });
              if (!seatMesh) return false;

              // Compare directly against the cushion surface of the rendered bus-seat-* mesh in the 3D scene (+0.25m in seat local Y)
              const cushionSurfaceWorld = seatMesh.localToWorld(peerGroup.position.clone().set(0, 0.25, 0));
              const horizErr = Math.hypot(peerGroup.position.x - cushionSurfaceWorld.x, peerGroup.position.z - cushionSurfaceWorld.z);
              const vertErrFromCushion = Math.abs(peerGroup.position.y - cushionSurfaceWorld.y);
              // In local coach space, cushion top surface is at local y = ~1.68m (invariant under coach pitch/roll)
              const localPos = coachGroup.worldToLocal(peerGroup.position.clone());
              const heightAboveCoachFloor = localPos.y;
              const expectedRotY = coachGroup.rotation.y + Math.PI / 2;
              const rotDiff = Math.abs(
                Math.atan2(Math.sin(peerGroup.rotation.y - expectedRotY), Math.cos(peerGroup.rotation.y - expectedRotY)),
              );

              (window as any).__lastSeatedCrabDiag = {
                u,
                seat,
                expPid,
                horizErr,
                vertErrFromCushion,
                heightAboveCoachFloor,
                rotDiff,
                coachRot: { x: coachGroup.rotation.x, y: coachGroup.rotation.y, z: coachGroup.rotation.z },
                peerPos: { x: peerGroup.position.x, y: peerGroup.position.y, z: peerGroup.position.z },
                cushionSurfaceWorld: { x: cushionSurfaceWorld.x, y: cushionSurfaceWorld.y, z: cushionSurfaceWorld.z },
                isPeerVisible: isHierarchyVisible(peerGroup),
                isCrabVisible: isHierarchyVisible(seatedCrabChild),
                pidMatches: peerGroup.userData?.participantId === expPid,
                seatMatches: peerGroup.userData?.seatIndex === seat,
                modeMatches: peerGroup.userData?.mode === "riding_bus",
              };

              return (
                horizErr < 0.25 &&
                vertErrFromCushion < 0.20 &&
                heightAboveCoachFloor > 1.60 &&
                heightAboveCoachFloor < 1.76 &&
                rotDiff < 0.05
              );
            },
            { u: peerUsername, seat: expectedSeat, expPid: expectedPid },
            { timeout: 15_000, polling: 100 },
          );
        } catch (err) {
          const diag = await viewerPage.evaluate(() => (window as any).__lastSeatedCrabDiag).catch(() => null);
          console.error(`[SeatedCrab Diagnostic Failure ${peerUsername}]:`, JSON.stringify(diag));
          throw err;
        }
      };

      await Promise.all([
        verifySeatedCrabAndTransform(page2, "jamtin", seatP1, pidP1),
        verifySeatedCrabAndTransform(page1, "jamtin2", seatP2, pidP2),
      ]);

      // Separately assert remote parked car presence and finite location in 3D scene
      const [parkedP1Pos, parkedP2Pos] = await Promise.all([
        page2.evaluate(() => {
          let pos: { x: number; y: number; z: number } | null = null;
          (window as any).__r3fScene?.traverse((o: any) => {
            if (o.name === "remote-parked-car-jamtin" && o.userData?.parked === true) {
              pos = { x: o.position.x, y: o.position.y, z: o.position.z };
            }
          });
          return pos;
        }),
        page1.evaluate(() => {
          let pos: { x: number; y: number; z: number } | null = null;
          (window as any).__r3fScene?.traverse((o: any) => {
            if (o.name === "remote-parked-car-jamtin2" && o.userData?.parked === true) {
              pos = { x: o.position.x, y: o.position.y, z: o.position.z };
            }
          });
          return pos;
        }),
      ]);
      expect(parkedP1Pos).not.toBeNull();
      expect(Number.isFinite(parkedP1Pos!.x)).toBe(true);
      expect(Number.isFinite(parkedP1Pos!.y)).toBe(true);
      expect(Number.isFinite(parkedP1Pos!.z)).toBe(true);
      expect(parkedP2Pos).not.toBeNull();
      expect(Number.isFinite(parkedP2Pos!.x)).toBe(true);
      expect(Number.isFinite(parkedP2Pos!.y)).toBe(true);
      expect(Number.isFinite(parkedP2Pos!.z)).toBe(true);

      // Capture seated crab 3D world positions at Stop 0 before departure
      const seatedPosAtStop0 = await Promise.all([
        page2.evaluate(() => {
          let pos: { x: number; y: number; z: number } | null = null;
          (window as any).__r3fScene?.traverse((o: any) => {
            if (o.name === "remote-racer-jamtin" && o.userData?.username === "jamtin" && o.userData?.parked !== true) {
              pos = { x: o.position.x, y: o.position.y, z: o.position.z };
            }
          });
          return pos!;
        }),
        page1.evaluate(() => {
          let pos: { x: number; y: number; z: number } | null = null;
          (window as any).__r3fScene?.traverse((o: any) => {
            if (o.name === "remote-racer-jamtin2" && o.userData?.username === "jamtin2" && o.userData?.parked !== true) {
              pos = { x: o.position.x, y: o.position.y, z: o.position.z };
            }
          });
          return pos!;
        }),
      ]);

      // Verify the two distinct seats produce distinct 3D world positions on the same coach
      expect(
        Math.hypot(seatedPosAtStop0[0].x - seatedPosAtStop0[1].x, seatedPosAtStop0[0].z - seatedPosAtStop0[1].z),
      ).toBeGreaterThan(0.5);

      await page2.evaluate((targetPos) => {
        (window as any).__colony?.setFirstPersonLookAt({
          x: targetPos.x,
          y: targetPos.y + 0.30,
          z: targetPos.z,
        });
      }, seatedPosAtStop0[0]);
      await page2.waitForTimeout(300);

      const seatedCrabScreenshot = path.resolve("test-results/actual-pair-screenshots/page2-peer-as-seated-crab.png");
      await page2.screenshot({ path: seatedCrabScreenshot });

      // Verify ordinary player look control (ArrowRight) turns camera view while position/seat stays fixed
      const preLookYaw = await page2.evaluate(() => (window as any).__colony?.fpCameraYaw ?? 0);
      const preLookPos = await page2.evaluate(() => {
        const cam = (window as any).__r3fCamera;
        return { x: cam.position.x, y: cam.position.y, z: cam.position.z };
      });
      await page2.keyboard.press("ArrowRight", { delay: 100 });
      await page2.waitForTimeout(100);
      const postLookYaw = await page2.evaluate(() => (window as any).__colony?.fpCameraYaw ?? 0);
      const postLookPos = await page2.evaluate(() => {
        const cam = (window as any).__r3fCamera;
        return { x: cam.position.x, y: cam.position.y, z: cam.position.z };
      });
      expect(postLookYaw).not.toBe(preLookYaw);
      expect(Math.hypot(postLookPos.x - preLookPos.x, postLookPos.z - preLookPos.z)).toBeLessThan(0.01);

      // 6. NONZERO MOVING BUS + SEATED PEER DISPLACEMENT & UNSAFE MOVING-BUS EXIT NEGATIVE:
      // Advance canonical sol clock past Stop 0 dwell so Bus 0 closes doors and moves along the loop
      const movingBusNow = CITYLIFE_EPOCH_MS + 4_792_000;
      mockNow = movingBusNow;
      await Promise.all([
        page1.evaluate((ms) => (window as any).__colony.debugSetSolNowMs(ms), movingBusNow),
        page2.evaluate((ms) => (window as any).__colony.debugSetSolNowMs(ms), movingBusNow),
      ]);

      // Bounded poll for server transit runner to tick Bus 0 into moving state with closed doors
      await expect
        .poll(() => {
          const p = runner!.getBusWorldPose(0, session.originX, session.originZ, session.cellMetres);
          return Boolean(
            p &&
            p.busId === 0 &&
            p.doorsOpen === false &&
            Number.isFinite(p.speed) &&
            p.speed > 0 &&
            p.atStop === false
          );
        }, { timeout: 5_000 })
        .toBe(true);

      // Verify both seated peers displaced > 25m in 3D scene
      await Promise.all([
        page2.waitForFunction(
          (startPos) => {
            let cur: { x: number; z: number } | null = null;
            (window as any).__r3fScene?.traverse((o: any) => {
              if (o.name === "remote-racer-jamtin" && o.userData?.username === "jamtin" && o.userData?.parked !== true) {
                cur = { x: o.position.x, z: o.position.z };
              }
            });
            return cur !== null && Math.hypot(cur.x - startPos.x, cur.z - startPos.z) > 25.0;
          },
          seatedPosAtStop0[0],
          { timeout: 15_000, polling: 100 },
        ),
        page1.waitForFunction(
          (startPos) => {
            let cur: { x: number; z: number } | null = null;
            (window as any).__r3fScene?.traverse((o: any) => {
              if (o.name === "remote-racer-jamtin2" && o.userData?.username === "jamtin2" && o.userData?.parked !== true) {
                cur = { x: o.position.x, z: o.position.z };
              }
            });
            return cur !== null && Math.hypot(cur.x - startPos.x, cur.z - startPos.z) > 25.0;
          },
          seatedPosAtStop0[1],
          { timeout: 15_000, polling: 100 },
        ),
      ]);

      // Verify coach-derived seat transform (X, Y, Z & orientation) still holds while moving along the loop
      await Promise.all([
        verifySeatedCrabAndTransform(page2, "jamtin", seatP1, pidP1),
        verifySeatedCrabAndTransform(page1, "jamtin2", seatP2, pidP2),
      ]);

      const movingBusPose = runner!.getBusWorldPose(0, session.originX, session.originZ, session.cellMetres)!;
      expect(movingBusPose).toBeDefined();
      expect(movingBusPose.busId).toBe(0);
      expect(movingBusPose.doorsOpen).toBe(false);
      expect(Number.isFinite(movingBusPose.speed)).toBe(true);
      expect(movingBusPose.speed).toBeGreaterThan(0);
      expect(movingBusPose.atStop).toBe(false);

      // Unsafe moving-bus exit negative:
      // 1) "Exit bus" prompt button [data-fp-action="use"] is NOT rendered while doors are closed
      await expect(page1.locator('[data-fp-action="use"]')).toHaveCount(0);
      // 2) Pressing KeyE while riding moving bus sets moving-bus refusal narration and keeps player seated
      await page1.bringToFront();
      await page1.keyboard.press("KeyE");
      const movingNarration = await page1.evaluate(() => (window as any).__colony.getUiState().firstPerson.narration);
      expect(movingNarration).toContain("The bus is moving — wait for the next stop to step off.");
      // 3) Server also rejects direct alight_bus wire request while bus doors are closed / moving
      await page1.evaluate(() => {
        (window as any).__mpErrors = [];
        (window as any).__colony.getMultiplayerClient().alightBus();
      });
      await page1.waitForFunction(() => ((window as any).__mpErrors || []).length > 0, undefined, {
        timeout: 10_000,
        polling: 100,
      });
      const movingAlightErr = await page1.evaluate(() => (window as any).__mpErrors[0]);
      expect(movingAlightErr?.code).toBe("BUS_NOT_BOARDABLE");
      expect(movingAlightErr?.message).toContain("bus is in motion or doors are closed");
      expect(runner!.getOccupiedSeats(0)).toBe(2);

      // 7. REAL WEBSOCKET DISCONNECT & RECONNECT SEAT OCCUPANCY + RENDER + PARKED CAR TUPLE RESTORATION:
      const preReconnectInfo = await page1.evaluate(() => {
        const mp = (window as any).__colony.getMultiplayerClient();
        return {
          sessionId: mp.getSessionInfo().sessionId,
          participantId: mp.getSessionInfo().participantId,
          seatIndex: mp.getSeatIndex(),
        };
      });
      expect(preReconnectInfo.seatIndex).toBe(seatP1);

      // Close Player 1's active WebSocket transport and reconnect
      await page1.evaluate(() => {
        const mp = (window as any).__colony.getMultiplayerClient();
        mp.ws?.close();
      });
      await page1.waitForSelector('[data-testid="multiplayer-hud"][data-connected="false"]', { timeout: 15_000 });
      await page1.evaluate(() => {
        const mp = (window as any).__colony.getMultiplayerClient();
        mp.connect();
      });
      await page1.waitForSelector('[data-testid="multiplayer-hud"][data-connected="true"]', { timeout: 30_000 });

      // Wait for Player 1 to be re-admitted and receive fresh snapshot in riding_bus mode
      await page1.waitForFunction(
        (expected) => {
          const mp = (window as any).__colony?.getMultiplayerClient();
          const info = mp?.getSessionInfo();
          return (
            mp?.getStatus() === "connected" &&
            info?.sessionId === expected.sessionId &&
            info?.participantId === expected.participantId &&
            mp?.getMode() === "riding_bus" &&
            mp?.getSeatedBusId() === 0 &&
            mp?.getSeatIndex() === expected.seatIndex
          );
        },
        preReconnectInfo,
        { timeout: 15_000, polling: 100 },
      );

      expect(runner!.getOccupiedSeats(0)).toBe(2);
      expect(session.participants.size).toBe(2);

      // Verify full parked-car tuple (x, y, heading) and mounted 3D seated-crab transforms are preserved after real reconnect
      const postReconnectParkedP1 = await page1.evaluate(() => (window as any).__colony.getParkedCarPose());
      expect(postReconnectParkedP1).not.toBeNull();
      expect(postReconnectParkedP1.x).toBeCloseTo(localParkedP1.x, 3);
      expect(postReconnectParkedP1.y).toBeCloseTo(localParkedP1.y, 3);
      expect(postReconnectParkedP1.heading).toBeCloseTo(localParkedP1.heading, 3);

      await Promise.all([
        verifySeatedCrabAndTransform(page2, "jamtin", seatP1, preReconnectInfo.participantId),
        verifySeatedCrabAndTransform(page1, "jamtin2", seatP2, pidP2),
      ]);

      // 8. SAFE SERVED-STOP ALIGHT VIA REAL UI CONTROL AT STOP 1:
      // Advance canonical sol clock to Stop 1 dwell (CITYLIFE_EPOCH_MS + 4_980_000, pos=(444.00, 136.24), doorsOpen=true)
      const stop1DwellNow = CITYLIFE_EPOCH_MS + 4_980_000;
      mockNow = stop1DwellNow;
      await Promise.all([
        page1.evaluate((ms) => (window as any).__colony.debugSetSolNowMs(ms), stop1DwellNow),
        page2.evaluate((ms) => (window as any).__colony.debugSetSolNowMs(ms), stop1DwellNow),
      ]);

      // Bounded poll for server transit runner to tick Bus 0 into Stop 1 dwell before asserting doorsOpen/speed
      await expect
        .poll(() => {
          const p = runner!.getBusWorldPose(0, session.originX, session.originZ, session.cellMetres);
          return Boolean(
            p &&
            p.busId === 0 &&
            p.doorsOpen === true &&
            Number.isFinite(p.speed) &&
            p.speed === 0 &&
            p.atStop === true
          );
        }, { timeout: 5_000 })
        .toBe(true);

      const stop1BusPose = runner!.getBusWorldPose(0, session.originX, session.originZ, session.cellMetres)!;
      expect(stop1BusPose).toBeDefined();
      expect(stop1BusPose.busId).toBe(0);
      expect(stop1BusPose.doorsOpen).toBe(true);
      expect(Number.isFinite(stop1BusPose.speed)).toBe(true);
      expect(stop1BusPose.speed).toBe(0);
      expect(stop1BusPose.atStop).toBe(true);
      expect(Number.isFinite(stop1BusPose.x)).toBe(true);
      expect(Number.isFinite(stop1BusPose.y)).toBe(true);
      expect(Number.isFinite(stop1BusPose.z)).toBe(true);
      expect(Number.isFinite(stop1BusPose.heading)).toBe(true);

      // Verify server pose is within served Stop 1 anchor radius
      const stop1Anchor = runner!.stopAnchors[1]!;
      expect(stop1Anchor).toBeDefined();
      const stop1WorldX = session.originX + stop1Anchor.at.x * session.cellMetres;
      const stop1WorldZ = session.originZ + stop1Anchor.at.y * session.cellMetres;
      const distToStop1 = Math.hypot(stop1BusPose.x - stop1WorldX, stop1BusPose.z - stop1WorldZ);
      expect(Number.isFinite(distToStop1)).toBe(true);
      expect(distToStop1).toBeLessThanOrEqual(3.0 * session.cellMetres);

      // Real UI "Exit bus" button [data-fp-action="use"] appears on both pages when doors open at Stop 1
      const exitBusBtn1 = page1.locator('[data-fp-action="use"]');
      const exitBusBtn2 = page2.locator('[data-fp-action="use"]');
      await expect(exitBusBtn1).toBeVisible({ timeout: 15_000 });
      await expect(exitBusBtn1).toContainText("Exit bus");
      await expect(exitBusBtn2).toBeVisible({ timeout: 15_000 });
      await expect(exitBusBtn2).toContainText("Exit bus");

      // Player 1 clicks real UI "Exit bus" button
      await page1.bringToFront();
      await exitBusBtn1.click();

      await page1.waitForFunction(() => {
        const mp = (window as any).__colony?.getMultiplayerClient();
        return mp?.getMode() === "walking" && mp?.getSeatedBusId() === null;
      }, undefined, { timeout: 15_000, polling: 100 });
      expect(runner!.getOccupiedSeats(0)).toBe(1);

      // In Player 2's scene: Player 1 transitions from seated-crab to pedestrian-crab at Stop 1 kerb
      await page2.waitForFunction(
        (expectedPid) => {
          const scene = (window as any).__r3fScene;
          let p1Group: any = null;
          scene?.traverse((o: any) => {
            if (o.name === "remote-racer-jamtin" && o.userData?.username === "jamtin" && o.userData?.parked !== true) {
              p1Group = o;
            }
          });
          if (!p1Group) return false;
          if (p1Group.userData?.participantId !== expectedPid) return false;
          if (p1Group.userData?.isPedestrian !== true || p1Group.userData?.mode !== "walking") return false;

          const isHierarchyVisible = (obj: any): boolean => {
            let curr = obj;
            while (curr) {
              if (curr.visible === false) return false;
              curr = curr.parent;
            }
            return true;
          };
          if (!isHierarchyVisible(p1Group)) return false;

          let hasPedCrab = false;
          let hasSeatedCrab = false;
          let pedCrabChild: any = null;
          p1Group.traverse((child: any) => {
            if (typeof child.name === "string") {
              if (child.name.startsWith("pedestrian-crab-")) {
                hasPedCrab = true;
                pedCrabChild = child;
              }
              if (child.name.startsWith("seated-crab-")) hasSeatedCrab = true;
            }
          });
          if (!hasPedCrab || hasSeatedCrab || !pedCrabChild) return false;
          return isHierarchyVisible(pedCrabChild);
        },
        preReconnectInfo.participantId,
        { timeout: 15_000, polling: 100 },
      );

      // Compute exact authoritative common exit candidate coordinates from Stop 1 bus pose
      const cellMetres = session.cellMetres || 4;
      const vergeOffsetMetres = 2.25 * cellMetres;
      const vergeX = -Math.sin(stop1BusPose.heading);
      const vergeZ = Math.cos(stop1BusPose.heading);
      const stop1AlightCandX = stop1BusPose.x + vergeX * vergeOffsetMetres;
      const stop1AlightCandZ = stop1BusPose.z + vergeZ * vergeOffsetMetres;

      // Capture exact Player 1 finite walking state at exit candidate (no 0,0 defaults)
      const p1InitialWalking = await page1.evaluate((expectedPid) => {
        const last = (window as any).__lastSnapshot;
        const p = last?.participants?.find((x: any) => x.username === "jamtin" && x.participantId === expectedPid);
        if (!p || p.mode !== "walking" || p.isPedestrian !== true) return null;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.heading)) return null;
        return {
          participantId: p.participantId,
          x: p.x,
          z: p.z,
          heading: p.heading,
          speed: p.speed ?? 0,
          lastInputSeq: p.lastInputSeq ?? 0,
          snapshotSeq: last.seq ?? 0,
        };
      }, preReconnectInfo.participantId);
      expect(p1InitialWalking).not.toBeNull();
      expect(p1InitialWalking!.participantId).toBe(preReconnectInfo.participantId);
      const distFromCand = Math.hypot(p1InitialWalking!.x - stop1AlightCandX, p1InitialWalking!.z - stop1AlightCandZ);
      expect(distFromCand).toBeLessThanOrEqual(0.1);

      // 8A. OCCUPANCY NEGATIVE CONTROL:
      // While Player 1 is stationary at the common bus exit point (candX, candZ),
      // Player 2 attempts to alight via real UI "Exit bus" button.
      // Server must reject with ALIGHT_BLOCKED ("Cannot alight bus: alight position is obstructed or not walkable").
      await page2.bringToFront();
      await page2.evaluate(() => {
        (window as any).__mpErrors = [];
      });
      await exitBusBtn2.click();

      await page2.waitForFunction(
        () => {
          const errs = (window as any).__mpErrors || [];
          return errs.some((e: any) => e.code === "ALIGHT_BLOCKED");
        },
        undefined,
        { timeout: 10_000, polling: 50 },
      );
      const blockedAlightErr = await page2.evaluate(() => {
        const errs = (window as any).__mpErrors || [];
        return errs.find((e: any) => e.code === "ALIGHT_BLOCKED");
      });
      expect(blockedAlightErr?.code).toBe("ALIGHT_BLOCKED");
      expect(blockedAlightErr?.message).toContain("alight position is obstructed");

      // Production feedback: rejection message is visible in runtime narration state and edge-HUD guidance caption
      await page2.waitForFunction(() => {
        const narration = (window as any).__colony?.getUiState()?.firstPerson?.narration;
        return typeof narration === "string" && /alight position is obstructed|exit path is blocked/i.test(narration);
      }, undefined, { timeout: 5_000, polling: 50 });
      const p2Narration = await page2.evaluate(() => {
        return (window as any).__colony?.getUiState()?.firstPerson?.narration;
      });
      expect(p2Narration).toMatch(/alight position is obstructed|exit path is blocked/i);

      const guidanceCaption2 = page2.locator(".first-person-panel__guidance-caption");
      await expect(guidanceCaption2).toBeVisible({ timeout: 5_000 });
      await expect(guidanceCaption2).toContainText(/alight position is obstructed|exit path is blocked/i);

      // Verify Player 2 remains seated on Bus 0 and occupied seat count is still 1
      const p2StillRiding = await page2.evaluate(() => {
        const mp = (window as any).__colony?.getMultiplayerClient();
        return {
          mode: mp?.getMode(),
          seatedBusId: mp?.getSeatedBusId(),
        };
      });
      expect(p2StillRiding.mode).toBe("riding_bus");
      expect(p2StillRiding.seatedBusId).toBe(0);
      expect(runner!.getOccupiedSeats(0)).toBe(1);

      // 8B. PLAYER 1 STEPS AWAY ALONG THE KERB:
      // Focus Player 1 canvas and walk forward (KeyW) until Player 1 is >= 0.8m from the exit candidate,
      // requiring a newer snapshot and input sequence acknowledgement from the server.
      await page1.bringToFront();
      const canvas1 = page1.locator("canvas").first();
      await canvas1.click({ position: { x: 200, y: 200 } });

      const startInputSeq = p1InitialWalking!.lastInputSeq;
      const startSnapSeq = p1InitialWalking!.snapshotSeq;

      await page1.keyboard.down("KeyW");
      try {
        await page1.waitForFunction(
          ({ pid, candPos, minInputSeq, minSnapSeq }) => {
            const last = (window as any).__lastSnapshot;
            if (!last || (last.seq ?? 0) <= minSnapSeq) return false;
            const p = last?.participants?.find((x: any) => x.username === "jamtin" && x.participantId === pid);
            if (!p || p.mode !== "walking" || p.isPedestrian !== true) return false;
            if ((p.lastInputSeq ?? 0) <= minInputSeq) return false;
            if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
            const dist = Math.hypot(p.x - candPos.x, p.z - candPos.z);
            return dist >= 0.8;
          },
          {
            pid: preReconnectInfo.participantId,
            candPos: { x: stop1AlightCandX, z: stop1AlightCandZ },
            minInputSeq: startInputSeq,
            minSnapSeq: startSnapSeq,
          },
          { timeout: 10_000, polling: 50 },
        );
      } finally {
        await page1.keyboard.up("KeyW").catch(() => {});
      }

      // Recheck authoritative clearance immediately before P2 retry (not swallowed):
      await page1.waitForFunction(
        ({ pid, candPos }) => {
          const last = (window as any).__lastSnapshot;
          const p = last?.participants?.find((x: any) => x.username === "jamtin" && x.participantId === pid);
          if (!p || p.mode !== "walking" || p.isPedestrian !== true || p.speed !== 0) return false;
          if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
          const dist = Math.hypot(p.x - candPos.x, p.z - candPos.z);
          return dist >= 0.8;
        },
        {
          pid: preReconnectInfo.participantId,
          candPos: { x: stop1AlightCandX, z: stop1AlightCandZ },
        },
        { timeout: 5_000, polling: 50 },
      );

      const p1ClearedState = await page1.evaluate(
        ({ pid, candPos }) => {
          const last = (window as any).__lastSnapshot;
          const p = last?.participants?.find((x: any) => x.username === "jamtin" && x.participantId === pid);
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
          return {
            participantId: p.participantId,
            x: p.x,
            z: p.z,
            speed: p.speed,
            distFromExit: Math.hypot(p.x - candPos.x, p.z - candPos.z),
            snapshotSeq: last.seq ?? 0,
          };
        },
        {
          pid: preReconnectInfo.participantId,
          candPos: { x: stop1AlightCandX, z: stop1AlightCandZ },
        },
      );
      expect(p1ClearedState).not.toBeNull();
      expect(p1ClearedState!.participantId).toBe(preReconnectInfo.participantId);
      expect(p1ClearedState!.speed).toBe(0);
      expect(p1ClearedState!.distFromExit).toBeGreaterThanOrEqual(0.8);

      const seqBeforeP2Alight = p1ClearedState!.snapshotSeq;

      // 8C. PLAYER 2 RETRIES ALIGHT DURING SERVED DWELL:
      // Common exit point is now authoritatively cleared by Player 1.
      await page2.bringToFront();
      await page2.evaluate(() => {
        (window as any).__mpErrors = [];
      });
      await exitBusBtn2.click();

      await page2.waitForFunction(() => {
        const mp = (window as any).__colony?.getMultiplayerClient();
        return mp?.getMode() === "walking" && mp?.getSeatedBusId() === null;
      }, undefined, { timeout: 15_000, polling: 100 });
      expect(runner!.getOccupiedSeats(0)).toBe(0);

      // In Player 1's scene: Player 2 transitions from seated-crab to pedestrian-crab at Stop 1 kerb (with ancestor/child visibility)
      await page1.waitForFunction(
        (expectedPid) => {
          const scene = (window as any).__r3fScene;
          let p2Group: any = null;
          scene?.traverse((o: any) => {
            if (o.name === "remote-racer-jamtin2" && o.userData?.username === "jamtin2" && o.userData?.parked !== true) {
              p2Group = o;
            }
          });
          if (!p2Group) return false;
          if (p2Group.userData?.participantId !== expectedPid) return false;
          if (p2Group.userData?.isPedestrian !== true || p2Group.userData?.mode !== "walking") return false;

          const isHierarchyVisible = (obj: any): boolean => {
            let curr = obj;
            while (curr) {
              if (curr.visible === false) return false;
              curr = curr.parent;
            }
            return true;
          };
          if (!isHierarchyVisible(p2Group)) return false;

          let hasPedCrab = false;
          let hasSeatedCrab = false;
          let pedCrabChild: any = null;
          p2Group.traverse((child: any) => {
            if (typeof child.name === "string") {
              if (child.name.startsWith("pedestrian-crab-")) {
                hasPedCrab = true;
                pedCrabChild = child;
              }
              if (child.name.startsWith("seated-crab-")) hasSeatedCrab = true;
            }
          });
          if (!hasPedCrab || hasSeatedCrab || !pedCrabChild) return false;
          return isHierarchyVisible(pedCrabChild);
        },
        pidP2,
        { timeout: 15_000, polling: 100 },
      );

      // Await authoritative newer snapshot on Page 1 and Page 2 containing BOTH walking players after Stop 1 alight
      await Promise.all([
        page1.waitForFunction(
          (minSeq) => {
            const last = (window as any).__lastSnapshot;
            if (!last || (last.seq ?? 0) <= minSeq) return false;
            const p1 = last?.participants?.find((x: any) => x.username === "jamtin");
            const p2 = last?.participants?.find((x: any) => x.username === "jamtin2");
            return (
              p1?.mode === "walking" &&
              p1?.seatedBusId === null &&
              p2?.mode === "walking" &&
              p2?.seatedBusId === null &&
              Number.isFinite(p1?.carX) &&
              Number.isFinite(p1?.carZ) &&
              Number.isFinite(p1?.carHeading) &&
              Number.isFinite(p2?.carX) &&
              Number.isFinite(p2?.carZ) &&
              Number.isFinite(p2?.carHeading)
            );
          },
          seqBeforeP2Alight,
          { timeout: 15_000, polling: 100 },
        ),
        page2.waitForFunction(
          (minSeq) => {
            const last = (window as any).__lastSnapshot;
            if (!last || (last.seq ?? 0) <= minSeq) return false;
            const p1 = last?.participants?.find((x: any) => x.username === "jamtin");
            const p2 = last?.participants?.find((x: any) => x.username === "jamtin2");
            return p1?.mode === "walking" && p2?.mode === "walking";
          },
          seqBeforeP2Alight,
          { timeout: 15_000, polling: 100 },
        ),
      ]);

      // Verify both players alighted onto walkable kerb cells at Stop 1 and retained their full parked car tuples (server + local runtime)
      const [finalAlightState, finalLocalCarP1, finalLocalCarP2] = await Promise.all([
        page1.evaluate(() => {
          const colony = (window as any).__colony;
          const tSize = colony?.sim?.state?.terrain?.size ?? 608;
          const last = (window as any).__lastSnapshot;
          const p1 = last?.participants?.find((x: any) => x.username === "jamtin");
          const p2 = last?.participants?.find((x: any) => x.username === "jamtin2");
          return {
            p1Cell: { x: Math.round(p1.x / 4 + tSize / 2), y: Math.round(p1.z / 4 + tSize / 2) },
            p2Cell: { x: Math.round(p2.x / 4 + tSize / 2), y: Math.round(p2.z / 4 + tSize / 2) },
            p1Car: { carX: p1.carX, carZ: p1.carZ, carHeading: p1.carHeading },
            p2Car: { carX: p2.carX, carZ: p2.carZ, carHeading: p2.carHeading },
          };
        }),
        page1.evaluate(() => (window as any).__colony.getParkedCarPose()),
        page2.evaluate(() => (window as any).__colony.getParkedCarPose()),
      ]);
      expect(walkableCells.has(`${finalAlightState.p1Cell.x},${finalAlightState.p1Cell.y}`)).toBe(true);
      expect(walkableCells.has(`${finalAlightState.p2Cell.x},${finalAlightState.p2Cell.y}`)).toBe(true);
      expect(finalAlightState.p1Car.carX).toBeCloseTo(parkedCarsInitial.p1.carX, 2);
      expect(finalAlightState.p1Car.carZ).toBeCloseTo(parkedCarsInitial.p1.carZ, 2);
      expect(finalAlightState.p1Car.carHeading).toBeCloseTo(parkedCarsInitial.p1.carHeading, 2);
      expect(finalAlightState.p2Car.carX).toBeCloseTo(parkedCarsInitial.p2.carX, 2);
      expect(finalAlightState.p2Car.carZ).toBeCloseTo(parkedCarsInitial.p2.carZ, 2);
      expect(finalAlightState.p2Car.carHeading).toBeCloseTo(parkedCarsInitial.p2.carHeading, 2);
      expect(finalLocalCarP1.x).toBeCloseTo(localParkedP1.x, 2);
      expect(finalLocalCarP1.y).toBeCloseTo(localParkedP1.y, 2);
      expect(finalLocalCarP1.heading).toBeCloseTo(localParkedP1.heading, 2);
      expect(finalLocalCarP2.x).toBeCloseTo(localParkedP2.x, 2);
      expect(finalLocalCarP2.y).toBeCloseTo(localParkedP2.y, 2);
      expect(finalLocalCarP2.heading).toBeCloseTo(localParkedP2.heading, 2);

      // Turn each alighted player toward the peer using look controls so peers are unoccluded and visible in screenshots
      await page2.bringToFront();
      await page2.evaluate(() => {
        const scene = (window as any).__r3fScene;
        let p: any = null;
        scene?.traverse((o: any) => {
          if (o.name === "remote-racer-jamtin" && o.userData?.username === "jamtin" && o.userData?.parked !== true) p = o;
        });
        if (p) {
          (window as any).__colony?.setFirstPersonLookAt({ x: p.position.x, y: p.position.y + 0.35, z: p.position.z });
        }
      });
      await page2.waitForTimeout(300);
      const alightedScreenshot = path.resolve("test-results/actual-pair-screenshots/page2-peer-alighted-pedestrian.png");
      await page2.screenshot({ path: alightedScreenshot });

      await page1.bringToFront();
      await page1.evaluate(() => {
        const scene = (window as any).__r3fScene;
        let p: any = null;
        scene?.traverse((o: any) => {
          if (o.name === "remote-racer-jamtin2" && o.userData?.username === "jamtin2" && o.userData?.parked !== true) p = o;
        });
        if (p) {
          (window as any).__colony?.setFirstPersonLookAt({ x: p.position.x, y: p.position.y + 0.35, z: p.position.z });
        }
      });
      await page1.waitForTimeout(300);
      const alightedScreenshot1 = path.resolve("test-results/actual-pair-screenshots/page1-peer-alighted-pedestrian.png");
      await page1.screenshot({ path: alightedScreenshot1 });
    } finally {
      if (context1) {
        await context1.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
        await context1.close().catch(() => {});
      }
      if (context2) {
        await context2.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
        await context2.close().catch(() => {});
      }
      await fastifyApp.close();
      console.log("Bus journey Fastify server cleanly closed.");
    }
  });
});
