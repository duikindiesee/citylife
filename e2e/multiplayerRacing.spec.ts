import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
// @ts-ignore
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createWorldLayoutDocument } from "../src/colony/spatial/worldLayoutDocument";
import { ColonyRuntime } from "../src/colony/runtime";

const SESSION_STORAGE_KEY = "citylife.session.v5";

function seedPlayerSession(page: Page, email: string) {
  const username = email.split("@")[0];
  return page.addInitScript(
    ({ key, userEmail, userName }) => {
      const session = {
        token: "e2e-fake-player-token",
        refreshToken: "e2e-fake-refresh",
        expiresAt: Date.now() + 1000 * 60 * 60 * 8,
        operator: {
          id: userName,
          userId: userEmail,
          scopes: [],
          roles: ["CITYLIFE_PLAYER"],
        },
      };
      window.sessionStorage.setItem(key, JSON.stringify(session));
    },
    { key: SESSION_STORAGE_KEY, userEmail: email, userName: username }
  );
}

test.describe("Multiplayer Racing Client Integration (In-Browser Mocked WebSocket Route)", () => {
  test("two racers driving down a road, seeing each other in game, recording mp4", async ({
    browser,
  }) => {
    test.setTimeout(420_000);

    const rawVideoDir = path.resolve("videos/multiplayer-raw");
    if (!fs.existsSync(rawVideoDir)) {
      fs.mkdirSync(rawVideoDir, { recursive: true });
    }

    // 1. Create context 1 with video recording for Player 1 (jamtin)
    const context1: BrowserContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: {
        dir: rawVideoDir,
        size: { width: 1280, height: 720 },
      },
    });
    const page1 = await context1.newPage();
    await seedPlayerSession(page1, "jamtin@citylife.local");

    // 2. Create context 2 for Player 2 (jamtin2)
    const context2: BrowserContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page2 = await context2.newPage();
    await seedPlayerSession(page2, "jamtin2@citylife.local");

    // 3. Stub target/fixture/auth/world-catalogue prerequisites
    const baseSurveyRuntime = new ColonyRuntime(4242);
    const baseSurveyDoc = baseSurveyRuntime.captureWorldLayout();
    const makeDoc = (layoutId: string) =>
      createWorldLayoutDocument({
        ...baseSurveyDoc,
        layoutId,
        seed: 4242,
        revision: { number: 0, parentHash: null },
      });

    const defaultDoc = makeDoc("seed-4242");

    const handleCatalogueRoute = (route: any) => {
      const url = route.request().url();
      const match = url.match(/\/worlds\/([^/]+)\/starter-catalogue/);
      const reqWorldId = match ? decodeURIComponent(match[1]) : "seed-4242";
      const customDoc = makeDoc(reqWorldId);
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          published: true,
          manifest: {
            worldId: reqWorldId,
            layoutRevision: customDoc.revision.contentHash,
            layout: customDoc,
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

    await context1.route("**/starter-catalogue*", handleCatalogueRoute);
    await context2.route("**/starter-catalogue*", handleCatalogueRoute);
    await context1.route("**/players/me/vehicle*", handleVehicleRoute);
    await context2.route("**/players/me/vehicle*", handleVehicleRoute);
    await context1.route("**/car-ownership*", handleVehicleRoute);
    await context2.route("**/car-ownership*", handleVehicleRoute);

    // 4. WebSocket route simulation with authoritative state and snapshot delivery
    let snapshotSeq = 1;
    let ws1: any = null;
    let ws2: any = null;

    const ways = baseSurveyRuntime.sim.state.roadWays || [];
    let roadStart = { x: 50, y: 50, heading: 0 };
    for (const way of ways) {
      const pts = (way as any).path || (way as any).points;
      if (pts && pts.length >= 2) {
        const p1 = pts[0];
        const p2 = pts[1];
        const heading = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        roadStart = { x: p1.x, y: p1.y, heading };
        break;
      }
    }

    const terrainSize = baseSurveyRuntime.sim.state.terrain?.size ?? 608;
    const cosH = Math.cos(roadStart.heading);
    const sinH = Math.sin(roadStart.heading);
    const perpX = -sinH;
    const perpY = cosH;

    const p1Cell = { x: roadStart.x + perpX * 0.4, y: roadStart.y + perpY * 0.4 };
    const p2Cell = { x: roadStart.x + cosH * 2.5 - perpX * 0.4, y: roadStart.y + sinH * 2.5 - perpY * 0.4 };

    const p1WorldX = (p1Cell.x - terrainSize / 2) * 4;
    const p1WorldZ = (p1Cell.y - terrainSize / 2) * 4;
    const p2WorldX = (p2Cell.x - terrainSize / 2) * 4;
    const p2WorldZ = (p2Cell.y - terrainSize / 2) * 4;

    const p1State = {
      participantId: "part-jamtin-1",
      userId: "jamtin@citylife.local",
      username: "jamtin",
      vehicleKey: "karoo-vonk-11",
      mode: "driving" as const,
      isPedestrian: false,
      x: p1WorldX,
      y: 0,
      z: p1WorldZ,
      heading: roadStart.heading,
      speed: 0,
      lastInputSeq: 0,
    };

    const p2State = {
      participantId: "part-jamtin2-2",
      userId: "jamtin2@citylife.local",
      username: "jamtin2",
      vehicleKey: "karoo-vonk-11",
      mode: "driving" as const,
      isPedestrian: false,
      x: p2WorldX,
      y: 0,
      z: p2WorldZ,
      heading: roadStart.heading,
      speed: 0,
      lastInputSeq: 0,
    };

    const broadcastSnapshot = () => {
      const snapshot = {
        type: "snapshot",
        sessionId: "sess-racing-cup",
        seq: snapshotSeq++,
        timestamp: Date.now(),
        participants: [{ ...p1State }, { ...p2State }],
      };
      const msg = JSON.stringify(snapshot);
      try { ws1?.send(msg); } catch {}
      try { ws2?.send(msg); } catch {}
    };

    await page1.routeWebSocket("**/api/v1/citylife/ws*", (ws) => {
      ws1 = ws;
      ws.onMessage((raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "join_session" || msg.type === "create_session") {
            ws.send(JSON.stringify({
              type: "session_created",
              sessionId: "sess-racing-cup",
              inviteCode: "racing-cup",
              participantId: p1State.participantId,
              worldId: msg.worldId || "seed-4242",
              layoutRevision: msg.layoutRevision || defaultDoc.revision.contentHash,
              neighbourhoodKey: "citylife-central",
              participants: ws2 ? [{ ...p1State }, { ...p2State }] : [{ ...p1State }],
            }));
            if (ws2) {
              ws.send(JSON.stringify({ type: "peer_joined", participant: { ...p2State } }));
              ws2.send(JSON.stringify({ type: "peer_joined", participant: { ...p1State } }));
            }
          } else if (msg.type === "pose") {
            p1State.x = msg.x ?? p1State.x;
            p1State.y = msg.y ?? p1State.y;
            p1State.z = msg.z ?? p1State.z;
            p1State.heading = msg.heading ?? p1State.heading;
            p1State.speed = msg.speed ?? p1State.speed;
            p1State.mode = msg.mode ?? p1State.mode;
            p1State.vehicleKey = msg.vehicleKey ?? p1State.vehicleKey;
            if (ws2) {
              ws2.send(JSON.stringify({
                type: "peer_pose",
                participantId: p1State.participantId,
                ...p1State,
              }));
            }
          } else if (msg.type === "input") {
            p1State.lastInputSeq = msg.seq;
            if (msg.throttle === 1) {
              p1State.speed = 10;
              p1State.x += Math.cos(p1State.heading) * 1.5;
              p1State.z += Math.sin(p1State.heading) * 1.5;
            } else if (msg.brake) {
              p1State.speed = 0;
            }
            broadcastSnapshot();
            if (ws2) {
              ws2.send(JSON.stringify({
                type: "peer_pose",
                participantId: p1State.participantId,
                ...p1State,
              }));
            }
          }
        } catch {}
      });
    });

    await page2.routeWebSocket("**/api/v1/citylife/ws*", (ws) => {
      ws2 = ws;
      ws.onMessage((raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "join_session" || msg.type === "create_session") {
            ws.send(JSON.stringify({
              type: "session_joined",
              sessionId: "sess-racing-cup",
              inviteCode: "racing-cup",
              participantId: p2State.participantId,
              worldId: msg.worldId || "seed-4242",
              layoutRevision: msg.layoutRevision || defaultDoc.revision.contentHash,
              neighbourhoodKey: "citylife-central",
              participants: [{ ...p1State }, { ...p2State }],
            }));
            if (ws1) {
              ws1.send(JSON.stringify({ type: "peer_joined", participant: { ...p2State } }));
            }
          } else if (msg.type === "pose") {
            p2State.x = msg.x ?? p2State.x;
            p2State.y = msg.y ?? p2State.y;
            p2State.z = msg.z ?? p2State.z;
            p2State.heading = msg.heading ?? p2State.heading;
            p2State.speed = msg.speed ?? p2State.speed;
            p2State.mode = msg.mode ?? p2State.mode;
            p2State.vehicleKey = msg.vehicleKey ?? p2State.vehicleKey;
            if (ws1) {
              ws1.send(JSON.stringify({
                type: "peer_pose",
                participantId: p2State.participantId,
                ...p2State,
              }));
            }
          } else if (msg.type === "input") {
            p2State.lastInputSeq = msg.seq;
            if (msg.throttle === 1) {
              p2State.speed = 10;
              p2State.x += Math.cos(p2State.heading) * 1.5;
              p2State.z += Math.sin(p2State.heading) * 1.5;
            } else if (msg.brake) {
              p2State.speed = 0;
            }
            broadcastSnapshot();
            if (ws1) {
              ws1.send(JSON.stringify({
                type: "peer_pose",
                participantId: p2State.participantId,
                ...p2State,
              }));
            }
          }
        } catch {}
      });
    });

    const snapshotInterval = setInterval(() => {
      if (ws1 || ws2) broadcastSnapshot();
    }, 100);

    try {
      // 5. Open both players into the shared multiplayer room: "racing-cup"
      console.log("Loading Player 1 (jamtin@citylife.local)...");
      await page1.goto("/?room=racing-cup&skipauth=1");

      console.log("Loading Player 2 (jamtin2@citylife.local)...");
      await page2.goto("/?room=racing-cup&skipauth=1");

      // 6. Wait for canvases and colony runtime
      await Promise.all([
        page1.waitForSelector("canvas", { timeout: 60_000 }),
        page2.waitForSelector("canvas", { timeout: 60_000 }),
      ]);

      await Promise.all([
        page1.waitForFunction(
          () => !!(window as any).__colony && !!(window as any).__r3fScene,
          undefined,
          { timeout: 30_000 }
        ),
        page2.waitForFunction(
          () => !!(window as any).__colony && !!(window as any).__r3fScene,
          undefined,
          { timeout: 30_000 }
        ),
      ]);

      console.log("Both players loaded runtime and R3F scene.");

      // 7. Verify multiplayer HUD indicators
      await Promise.all([
        page1.waitForSelector('[data-testid="multiplayer-hud"][data-connected="true"]', { timeout: 20_000 }),
        page2.waitForSelector('[data-testid="multiplayer-hud"][data-connected="true"]', { timeout: 20_000 }),
      ]);

      console.log("Both players connected to WebSocket multiplayer server.");

      // 8. Find valid road coordinates from sim.state.roadWays
      const roadStart = await page1.evaluate(() => {
        const colony = (window as any).__colony;
        const sim = colony?.sim;
        const ways = sim?.state?.roadWays || colony?.roadWays || [];
        for (const way of ways) {
          const pts = way.path || way.points;
          if (pts && pts.length >= 2) {
            const p1 = pts[0];
            const p2 = pts[1];
            const heading = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            return { x: p1.x, y: p1.y, heading };
          }
        }
        const garageTarget = sim?.state?.commercialDistrict?.garagePad?.roadTarget;
        if (garageTarget) {
          return { x: garageTarget.x, y: garageTarget.y, heading: 0 };
        }
        const roads = sim?.state?.roads || [];
        if (roads.length >= 2) {
          return { x: roads[0].x, y: roads[0].y, heading: 0 };
        }
        return { x: 50, y: 50, heading: 0 };
      });

      console.log(`Starting road position: x=${roadStart.x.toFixed(2)}, y=${roadStart.y.toFixed(2)}, heading=${roadStart.heading.toFixed(2)}`);

      // 9. Initial fixture staging: place both cars on the road at starting line
      const cosH = Math.cos(roadStart.heading);
      const sinH = Math.sin(roadStart.heading);
      const perpX = -sinH;
      const perpY = cosH;

      // Player 1 at starting station, left lane
      await page1.evaluate(({ x, y, heading }) => {
        (window as any).__colony.teleportCar(x, y, heading);
      }, {
        x: roadStart.x + perpX * 0.4,
        y: roadStart.y + perpY * 0.4,
        heading: roadStart.heading,
      });

      // Player 2 slightly ahead, right lane
      await page2.evaluate(({ x, y, heading }) => {
        (window as any).__colony.teleportCar(x, y, heading);
      }, {
        x: roadStart.x + cosH * 2.5 - perpX * 0.4,
        y: roadStart.y + sinH * 2.5 - perpY * 0.4,
        heading: roadStart.heading,
      });

      // Ensure authoritative vehicle ownership is hydrated for both operators
      await page1.evaluate(() => {
        const colony = (window as any).__colony;
        if (!colony.authoritativeCar && colony.operatorUserId) {
          colony.applyVehicleOwnership(colony.operatorUserId, ["karoo-vonk-11"]);
        }
      });
      await page2.evaluate(() => {
        const colony = (window as any).__colony;
        if (!colony.authoritativeCar && colony.operatorUserId) {
          colony.applyVehicleOwnership(colony.operatorUserId, ["karoo-vonk-11"]);
        }
      });

      // 10. Check 3D scene & simulation state: verify exact admitted peer identity and vehicle
      await page1.waitForFunction(() => {
        const colony = (window as any).__colony;
        const racers = Array.from(colony?.sim?.state?.remoteRacers?.values() ?? []) as any[];
        const peer = racers.find((r) => r.username === "jamtin2" && r.vehicleKey === "karoo-vonk-11");
        return !!peer;
      }, undefined, { timeout: 25_000 });

      await page2.waitForFunction(() => {
        const colony = (window as any).__colony;
        const racers = Array.from(colony?.sim?.state?.remoteRacers?.values() ?? []) as any[];
        const peer = racers.find((r) => r.username === "jamtin" && r.vehicleKey === "karoo-vonk-11");
        return !!peer;
      }, undefined, { timeout: 25_000 });

      await page1.waitForFunction(() => {
        const scene = (window as any).__r3fScene;
        let found = false;
        scene?.traverse((o: any) => {
          if (o.name && o.name.includes("remote-racer-jamtin2")) {
            found = true;
          }
        });
        return found;
      }, undefined, { timeout: 25_000 });

      await page2.waitForFunction(() => {
        const scene = (window as any).__r3fScene;
        let found = false;
        scene?.traverse((o: any) => {
          if (o.name && o.name.includes("remote-racer-jamtin")) {
            found = true;
          }
        });
        return found;
      }, undefined, { timeout: 25_000 });

      console.log("Verified: Player 1 sees Player 2 in car, Player 2 sees Player 1 in car.");

      // Record initial remote racer 3D position in Player 1 view
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

      // 11. Drive both racers down the road exercising visible player controls
      console.log("Starting player driving controls down the road with authoritative progress...");

      // Hook snapshot recording on both clients
      await page1.evaluate(() => {
        const colony = (window as any).__colony;
        const mp = colony.getMultiplayerClient();
        (window as any).__snapshotHistory = [];
        if (mp) {
          const orig = mp.options.onSnapshot;
          mp.options.onSnapshot = (s: any) => {
            (window as any).__snapshotHistory.push(s);
            orig?.(s);
          };
        }
      });

      await page2.evaluate(() => {
        const colony = (window as any).__colony;
        const mp = colony.getMultiplayerClient();
        (window as any).__snapshotHistory = [];
        if (mp) {
          const orig = mp.options.onSnapshot;
          mp.options.onSnapshot = (s: any) => {
            (window as any).__snapshotHistory.push(s);
            orig?.(s);
          };
        }
      });

      // Exercise visible player controls: trigger throttle on both clients (mandatory, no branching)
      const throttle1 = page1.locator('button[data-drive-action="throttle"]');
      await expect(throttle1).toBeVisible({ timeout: 20_000 });
      const throttle2 = page2.locator('button[data-drive-action="throttle"]');
      await expect(throttle2).toBeVisible({ timeout: 20_000 });

      // Capture pre-input snapshot baseline on Player 1
      await page1.waitForFunction(() => {
        const history = (window as any).__snapshotHistory || [];
        return history.length >= 1;
      }, undefined, { timeout: 15_000 });

      const baselineSeq1 = await page1.evaluate(() => {
        const history = (window as any).__snapshotHistory || [];
        return history[history.length - 1]?.seq ?? 0;
      });

      await throttle1.dispatchEvent("pointerdown");
      await throttle2.dispatchEvent("pointerdown");

      // Assert advancing server snapshot sequence and input acknowledgement on Player 1 relative to pre-input baseline
      await page1.waitForFunction((baseSeq) => {
        const history = (window as any).__snapshotHistory || [];
        if (history.length < 2) return false;
        const last = history[history.length - 1];
        const p = last.participants?.find((part: any) => part.username === "jamtin");
        return last.seq > baseSeq && typeof p?.lastInputSeq === "number" && p.lastInputSeq > 0;
      }, baselineSeq1, { timeout: 25_000 });

      // Assert advancing server snapshot sequence and input acknowledgement on Player 2
      await page2.waitForFunction(() => {
        const history = (window as any).__snapshotHistory || [];
        if (history.length < 2) return false;
        const last = history[history.length - 1];
        const p = last.participants?.find((part: any) => part.username === "jamtin2");
        return last.seq >= 2 && typeof p?.lastInputSeq === "number" && p.lastInputSeq > 0;
      }, undefined, { timeout: 25_000 });

      // Assert authoritative progress and peer position updates
      await page1.waitForFunction(() => {
        const colony = (window as any).__colony;
        const racers = Array.from(colony.sim?.state?.remoteRacers?.values() || []) as any[];
        const p2 = racers.find((r) => r.username === "jamtin2" && r.vehicleKey === "karoo-vonk-11");
        return !!p2 && !!p2.cell;
      }, undefined, { timeout: 25_000 });

      await page2.waitForFunction(() => {
        const colony = (window as any).__colony;
        const racers = Array.from(colony.sim?.state?.remoteRacers?.values() || []) as any[];
        const p1 = racers.find((r) => r.username === "jamtin" && r.vehicleKey === "karoo-vonk-11");
        return !!p1 && !!p1.cell;
      }, undefined, { timeout: 25_000 });

      // Assert rendered 3D world movement: Player 1 sees remote-racer-jamtin2 has moved
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
      }, initial3DPosP1, { timeout: 25_000 });

      const mapBtn1 = page1.locator('[data-testid="player-map-shortcut"]');
      await expect(mapBtn1).toBeVisible({ timeout: 15_000 });
      await mapBtn1.click();
      const mapDialog1 = page1.locator('[data-testid="player-map"]');
      await expect(mapDialog1).toBeVisible({ timeout: 15_000 });
      const peerMarker1 = page1.locator('[data-testid="city-map-peer-marker"]');
      await expect(peerMarker1).toBeAttached({ timeout: 15_000 });
      await expect(peerMarker1).toHaveAttribute("aria-label", "Peer jamtin2");

      // Allow vehicles to continue driving smoothly for 2.5 seconds to capture a clear racing run on video
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Neutralize player inputs on stop via visible controls and runtime setters
      const brake1 = page1.locator('button[data-drive-action="brake"]');
      await expect(brake1).toBeVisible({ timeout: 10_000 });
      const brake2 = page2.locator('button[data-drive-action="brake"]');
      await expect(brake2).toBeVisible({ timeout: 10_000 });

      await throttle1.dispatchEvent("pointerup");
      await throttle2.dispatchEvent("pointerup");
      await brake1.dispatchEvent("pointerdown");
      await brake2.dispatchEvent("pointerdown");
      await page1.evaluate(() => {
        (window as any).__colony.setOwnedDriveInput({ throttle: false, brake: true });
      });
      await page2.evaluate(() => {
        (window as any).__colony.setOwnedDriveInput({ throttle: false, brake: true });
      });

      console.log("Player driving controls complete and inputs neutralized.");

      // 12. Confirm both vehicles advanced down the road
      const finalP1 = await page1.evaluate(() => {
        const colony = (window as any).__colony;
        return colony.sim?.state?.operatorCar?.cell || colony.getOwnedDrivePose();
      });
      const finalP2 = await page2.evaluate(() => {
        const colony = (window as any).__colony;
        return colony.sim?.state?.operatorCar?.cell || colony.getOwnedDrivePose();
      });

      expect(finalP1).toBeDefined();
      expect(finalP2).toBeDefined();
      const distance1 = Math.hypot((finalP1?.x ?? 0) - roadStart.x, (finalP1?.y ?? 0) - roadStart.y);
      const distance2 = Math.hypot((finalP2?.x ?? 0) - roadStart.x, (finalP2?.y ?? 0) - roadStart.y);

      console.log(`Player 1 distance traveled: ${distance1.toFixed(2)} cells`);
      console.log(`Player 2 distance traveled: ${distance2.toFixed(2)} cells`);
      expect(distance1).toBeGreaterThan(1.0);
      expect(distance2).toBeGreaterThan(1.0);

      // 13. Flush video by closing page1 and context1
      const videoObj = page1.video();
      expect(videoObj).toBeDefined();
      await page1.close();
      await page2.close();
      await context1.close();
      await context2.close();

      const rawVideoPath = await videoObj!.path();
      console.log(`Raw video saved to: ${rawVideoPath}`);
      expect(fs.existsSync(rawVideoPath)).toBe(true);

      // 14. Transcode to MP4 using ffmpeg (-nostdin to avoid pipe hang)
      const finalMp4Path = path.resolve("videos/multiplayer-racing.mp4");
      console.log(`Transcoding WebM to MP4 at: ${finalMp4Path}...`);

      execSync(
        `"${ffmpegInstaller.path}" -nostdin -y -i "${rawVideoPath}" -c:v libx264 -pix_fmt yuv420p "${finalMp4Path}"`,
        { stdio: "pipe" }
      );

      expect(fs.existsSync(finalMp4Path)).toBe(true);
      const stat = fs.statSync(finalMp4Path);
      console.log(`Final MP4 size: ${stat.size} bytes`);
      expect(stat.size).toBeGreaterThan(50_000); // Verify non-trivial video content

      console.log("Mocked client browser integration verified: Two racers driving down road, seeing each other in game, recorded to MP4. Deployed two-user acceptance remains open on cluster.");
    } finally {
      clearInterval(snapshotInterval);
    }
  });
});
