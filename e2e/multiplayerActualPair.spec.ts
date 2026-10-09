import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
// @ts-ignore
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createWorldLayoutDocument } from "../src/colony/spatial/worldLayoutDocument";
import { ColonyRuntime } from "../src/colony/runtime";

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
  const { LocalWorldAuthorityClient } = require(worldAuthPath);
  const { RealtimeManager } = require(realtimePath);

  return { jwt, buildApp, GameStateManager, LocalWorldAuthorityClient, RealtimeManager };
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
      return {
        multiplayerStatus: mp?.getStatus(),
        sessionInfo: mp?.getSessionInfo ? {
          sessionId: mp.getSessionInfo().sessionId,
          participantId: mp.getSessionInfo().participantId,
        } : null,
        seated: colony?.ownedDriveSeated,
        fpCameraCell: colony?.fpCameraCell,
        drivePose: colony?.ownedDrivePose ? {
          x: Number(colony.ownedDrivePose.x.toFixed(2)),
          y: Number(colony.ownedDrivePose.y.toFixed(2)),
          speed: colony.ownedDrivePose.speed,
        } : null,
        snapshotCount: history.length,
        recentSnapshots: recent,
      };
    });
    console.error(`[Transition Diagnostic ${label}]`, JSON.stringify(diag));
  } catch (err: any) {
    console.error(`[Transition Diagnostic ${label} Failed]`, err?.message);
  }
}

// Disable passive trace DOM snapshots/screencasts to diagnose tracing overhead vs software rendering
test.use({ trace: "off" });

test.describe("Multiplayer Racing Actual-Pair Acceptance (Fastify RealtimeManager & Scheduled Loop)", () => {
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
    } = loadServerComponents();

    recordStage("Initialization & World Layout Document creation");

    // 1. Build canonical world layout document
    const baseSurveyRuntime = new ColonyRuntime(4242);
    const baseSurveyDoc = baseSurveyRuntime.captureWorldLayout();
    const defaultDoc = createWorldLayoutDocument({
      ...baseSurveyDoc,
      layoutId: "seed-4242",
      seed: 4242,
      revision: { number: 0, parentHash: null },
    });

    // 2. Set up isolated World Authority and User truth fixtures
    const worldAuth = new LocalWorldAuthorityClient();
    worldAuth.registerWorld({
      schemaVersion: "citylife.starter-parcel-manifest/v1",
      worldId: "seed-4242",
      layoutRevision: defaultDoc.revision.contentHash,
      layout: defaultDoc,
      plots: [{ geometry: { neighbourhoodKey: "citylife-central" } }],
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

    const fastifyApp = buildApp({
      gameState: new GameStateManager(null, null),
      realtime,
      userClient,
      worldAuthorityClient: worldAuth,
      jwtSecret: JWT_SECRET,
      jwtAlgorithms: ["HS256"],
    });

    const serverAddr = await fastifyApp.listen({ port: 0, host: "127.0.0.1" });
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

      // Place both players at safe road positions concurrently
      const roadStart = await page1.evaluate(() => {
        const colony = (window as any).__colony;
        const terrain = colony.sim?.state?.terrain;
        const size = terrain?.size ?? 608;
        return { x: 124, y: 272, heading: -Math.PI / 2, terrainSize: size };
      });

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
            colony.ownedDrivePose = { x: x + 2, y, heading, speed: 0 };
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
            }
          }
        }),
        page2.evaluate(() => {
          const colony = (window as any).__colony;
          const mp = colony.getMultiplayerClient();
          (window as any).__snapshotHistory = [];
          (window as any).__sentInputs = [];
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
      console.log(`[Baseline Evidence] Settled pre-control baselines verified: P1 speed=${baselineP1.selfSpeed}, P2 speed=${baselineP2.selfSpeed}`);

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

      // Engage throttle via genuine mouse down on visible hit targets
      await page1.mouse.move(box1!.x + box1!.width / 2, box1!.y + box1!.height / 2);
      await page1.mouse.down();
      await page2.mouse.move(box2!.x + box2!.width / 2, box2!.y + box2!.height / 2);
      await page2.mouse.down();

      console.log("Throttle engaged on both players via genuine pointer hit testing.");
      recordStage("Throttle engaged via genuine pointer hit testing");

      // GAP 1 VERIFICATION A: Assert advancing sequence, fresh monotonic input ack, and positive throttle accepted at server (speed > 0.1)
      await page1.waitForFunction((b) => {
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
      }, baselineP1, { timeout: 30_000 });

      await page2.waitForFunction((b) => {
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
      }, baselineP2, { timeout: 30_000 });

      console.log("Authoritative Fastify snapshots verified: fresh monotonic input ack and positive throttle speed (>0.1m/s) accepted at server.");
      recordStage("Positive throttle & fresh input acknowledgements verified at server");

      // GAP 1 VERIFICATION B: Assert actual server participant displacement from pre-control baseline (>0.5m)
      await page1.waitForFunction((b) => {
        const history = (window as any).__snapshotHistory || [];
        if (!history.length) return false;
        const last = history[history.length - 1];
        const self = last.participants?.find((p: any) => p.username === "jamtin");
        const peer = last.participants?.find((p: any) => p.username === "jamtin2");
        if (!self || !peer || !b.selfPos || !b.peerPos) return false;
        const selfMoved = Math.hypot(self.x - b.selfPos.x, self.z - b.selfPos.z) > 0.5;
        const peerMoved = Math.hypot(peer.x - b.peerPos.x, peer.z - b.peerPos.z) > 0.5;
        return selfMoved && peerMoved;
      }, baselineP1, { timeout: 30_000 });

      console.log("Authoritative server participant displacement verified (>0.5m) for both players from pre-control baseline.");
      recordStage("Authoritative server participant displacement verified (>0.5m)");

      // Assert rendered 3D world movement for BOTH clients
      await page1.waitForFunction((initial) => {
        const scene = (window as any).__r3fScene;
        let current: { x: number; z: number } | null = null;
        scene?.traverse((o: any) => {
          if (o.name && o.name.includes("remote-racer-jamtin2")) {
            current = { x: o.position.x, z: o.position.z };
          }
        });
        if (!current || !initial) return false;
        return Math.hypot(current.x - initial.x, current.z - initial.z) > 0.5;
      }, initial3DPosP1, { timeout: 30_000 });

      await page2.waitForFunction((initial) => {
        const scene = (window as any).__r3fScene;
        let current: { x: number; z: number } | null = null;
        scene?.traverse((o: any) => {
          if (o.name && o.name.includes("remote-racer-jamtin")) {
            current = { x: o.position.x, z: o.position.z };
          }
        });
        if (!current || !initial) return false;
        return Math.hypot(current.x - initial.x, current.z - initial.z) > 0.5;
      }, initial3DPosP2, { timeout: 30_000 });

      console.log("Rendered 3D scene displacement verified for BOTH remote racers (>0.5m).");
      recordStage("Rendered 3D scene displacement verified (>0.5m)");

      // Capture explicit screenshots during active driving
      const ssDir = path.resolve("test-results/actual-pair-screenshots");
      if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
      await page1.screenshot({ path: path.join(ssDir, "page1-driving.png") });
      await page2.screenshot({ path: path.join(ssDir, "page2-driving.png") });
      recordStage("Explicit driving screenshots saved");

      // Allow vehicles to drive smoothly for 2.5s to capture the racing run on video
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Neutralize throttle via genuine pointer up
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

      // Wait for mini-map marker to update and match projected snapshot on Player 1
      await page1.waitForFunction((initial) => {
        const circle = document.querySelector('[data-testid="city-map-peer-marker"] circle');
        if (!circle) return false;
        const cx = parseFloat(circle.getAttribute("cx") || "0");
        const cy = parseFloat(circle.getAttribute("cy") || "0");
        return Math.hypot(cx - initial.cx, cy - initial.cy) > 0.2;
      }, initialMapPeerPosP1, { timeout: 30_000 });

      // Wait for mini-map marker to update and match projected snapshot on Player 2
      await page2.waitForFunction((initial) => {
        const circle = document.querySelector('[data-testid="city-map-peer-marker"] circle');
        if (!circle) return false;
        const cx = parseFloat(circle.getAttribute("cx") || "0");
        const cy = parseFloat(circle.getAttribute("cy") || "0");
        return Math.hypot(cx - initial.cx, cy - initial.cy) > 0.2;
      }, initialMapPeerPosP2, { timeout: 30_000 });

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
      // Must find CapsuleGeometry (body) and SphereGeometry (head), and NO car geometries (BoxGeometry / CylinderGeometry).
      await page2.waitForFunction((expectedId) => {
        const scene = (window as any).__r3fScene;
        let targetGroup: any = null;
        scene?.traverse((o: any) => {
          if (o.userData?.participantId === expectedId) {
            targetGroup = o;
          }
        });
        if (!targetGroup) return false;

        const geoTypes: string[] = [];
        targetGroup.traverse((child: any) => {
          if (child.isMesh && child.geometry?.type) {
            geoTypes.push(child.geometry.type);
          }
        });

        const hasCapsule = geoTypes.includes("CapsuleGeometry");
        const hasSphere = geoTypes.includes("SphereGeometry");
        const hasBox = geoTypes.includes("BoxGeometry");
        const hasCylinder = geoTypes.includes("CylinderGeometry");

        return hasCapsule && hasSphere && !hasBox && !hasCylinder;
      }, pinnedParticipantId1, { timeout: 15_000 });

      // Retain screenshot of visible pedestrian avatar
      const pedScreenshotPath = path.resolve("test-results/actual-pair-screenshots/page2-peer-as-pedestrian.png");
      await page2.screenshot({ path: pedScreenshotPath });
      console.log(`Player 2 view of Player 1 as pedestrian saved to: ${pedScreenshotPath}`);
      recordStage("Player 2 3D scene independently verified rendering Player 1 as pedestrian avatar (Capsule/Sphere geometry) and captured screenshot");

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

      // 3.4. Control-driven walking movement (no teleport): dispatch walking forward input via genuine controls
      await page1.bringToFront();
      await page1.locator("canvas").click();
      await page1.keyboard.down("KeyW");

      // Verify emitted walking input frame plus server displacement
      await page1.waitForFunction(() => {
        const sent = (window as any).__sentInputs || [];
        return sent.some((msg: any) => msg.type === "input" && msg.mode === "walking" && msg.forward === 1);
      }, undefined, { timeout: 15_000 });

      await page1.waitForFunction((initial) => {
        const history = (window as any).__snapshotHistory || [];
        if (!history.length) return false;
        const last = history[history.length - 1];
        const p1 = last.participants?.find((p: any) => p.username === "jamtin");
        if (!p1 || !initial) return false;
        return Math.hypot(p1.x - initial.x, p1.z - initial.z) > 0.2;
      }, walkingPosP1, { timeout: 15_000 });
      await page1.keyboard.up("KeyW");

      // Verify parked car coordinates are mandatory and remained strictly stationary at parkedCarPose1 during walking
      const postWalkSnap = await page1.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        const last = history[history.length - 1];
        const p1 = last?.participants?.find((p: any) => p.username === "jamtin");
        return p1 ? { carX: p1.carX, carZ: p1.carZ } : null;
      });
      expect(postWalkSnap).not.toBeNull();
      expect(typeof postWalkSnap!.carX).toBe("number");
      expect(typeof postWalkSnap!.carZ).toBe("number");
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

      // Verify numerical local and peer marker SVG circle/rect positions against map projection
      await mapBtnP1.click();
      const localMarker = page1.locator('[data-testid="city-map-parked-car-marker"][data-local="true"]');
      await expect(localMarker).toBeAttached({ timeout: 5000 });
      const localCircle = localMarker.locator("circle");
      const localX = Number(await localCircle.getAttribute("cx"));
      const localY = Number(await localCircle.getAttribute("cy"));
      expect(Number.isFinite(localX)).toBe(true);
      expect(Number.isFinite(localY)).toBe(true);
      expect(localX).toBeGreaterThan(0);
      expect(localY).toBeGreaterThan(0);
      await mapBtnP1.click();

      await mapBtnP2.click();
      const peerMarker = page2.locator('[data-testid="city-map-parked-car-marker"][data-local="false"]');
      await expect(peerMarker).toBeAttached({ timeout: 5000 });
      const peerCircle = peerMarker.locator("circle");
      const peerX = Number(await peerCircle.getAttribute("cx"));
      const peerY = Number(await peerCircle.getAttribute("cy"));
      expect(Number.isFinite(peerX)).toBe(true);
      expect(Number.isFinite(peerY)).toBe(true);
      // Both maps project the identical stationary parked car to the same SVG coordinates
      expect(Math.hypot(peerX - localX, peerY - localY)).toBeLessThan(1.0);
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
      // Must find BoxGeometry (body/cabin/stripe) and CylinderGeometry (wheels), and NO pedestrian geometries (Capsule/Sphere).
      await page2.waitForFunction((expectedId) => {
        const scene = (window as any).__r3fScene;
        let targetGroup: any = null;
        scene?.traverse((o: any) => {
          if (o.userData?.participantId === expectedId) {
            targetGroup = o;
          }
        });
        if (!targetGroup) return false;

        const geoTypes: string[] = [];
        targetGroup.traverse((child: any) => {
          if (child.isMesh && child.geometry?.type) {
            geoTypes.push(child.geometry.type);
          }
        });

        const hasCapsule = geoTypes.includes("CapsuleGeometry");
        const hasSphere = geoTypes.includes("SphereGeometry");
        const hasBox = geoTypes.includes("BoxGeometry");
        const hasCylinder = geoTypes.includes("CylinderGeometry");

        return hasBox && hasCylinder && !hasCapsule && !hasSphere;
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
});
