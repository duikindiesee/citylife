import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
// @ts-ignore
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

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

test.describe("Multiplayer Racing Acceptance (Spec 178)", () => {
  test("two racers driving down a road, seeing each other in game, recording mp4", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

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

    // 3. Open both players into the shared multiplayer room: "racing-cup"
    console.log("Loading Player 1 (jamtin@citylife.local)...");
    await page1.goto("/?room=racing-cup&skipauth=1");

    console.log("Loading Player 2 (jamtin2@citylife.local)...");
    await page2.goto("/?room=racing-cup&skipauth=1");

    // 4. Wait for canvases and colony runtime
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

    // 5. Ensure multiplayer is enabled and connected
    await page1.evaluate(() => {
      const colony = (window as any).__colony;
      if (!colony.getMultiplayerClient() || colony.getMultiplayerClient().getStatus() !== "connected") {
        colony.enableMultiplayer("racing-cup");
      }
    });
    await page2.evaluate(() => {
      const colony = (window as any).__colony;
      if (!colony.getMultiplayerClient() || colony.getMultiplayerClient().getStatus() !== "connected") {
        colony.enableMultiplayer("racing-cup");
      }
    });

    // 6. Verify multiplayer HUD indicators
    await Promise.all([
      page1.waitForSelector('[data-testid="multiplayer-hud"][data-connected="true"]', { timeout: 20_000 }),
      page2.waitForSelector('[data-testid="multiplayer-hud"][data-connected="true"]', { timeout: 20_000 }),
    ]);

    console.log("Both players connected to WebSocket multiplayer server.");

    // 7. Verify peer discovery in colony sim state
    await Promise.all([
      page1.waitForFunction(
        () => (window as any).__colony?.sim?.state?.remoteRacers?.size >= 1,
        undefined,
        { timeout: 20_000 }
      ),
      page2.waitForFunction(
        () => (window as any).__colony?.sim?.state?.remoteRacers?.size >= 1,
        undefined,
        { timeout: 20_000 }
      ),
    ]);

    console.log("Peer discovery verified in simulation state.");

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

    // 9. Place both cars on the road: Player 1, and Player 2 slightly ahead and to the side
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

    // 10. Check 3D scene: Player 1 MUST see Player 2 in their car, and Player 2 MUST see Player 1
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

    // 11. Drive both racers down the road using player driving controls with authoritative progress
    console.log("Starting player driving controls down the road with authoritative progress...");

    const startP1 = { x: roadStart.x + perpX * 0.4, y: roadStart.y + perpY * 0.4 };
    const startP2 = { x: roadStart.x + cosH * 2.5 - perpX * 0.4, y: roadStart.y + sinH * 2.5 - perpY * 0.4 };

    // Apply player forward throttle control to both cars
    await page1.evaluate(() => {
      const colony = (window as any).__colony;
      colony.setOwnedDriveInput({ throttle: true });
    });

    await page2.evaluate(() => {
      const colony = (window as any).__colony;
      colony.setOwnedDriveInput({ throttle: true });
    });

    // Assert authoritative driving movement progress for Player 1 and Player 2
    await page1.waitForFunction((start) => {
      const colony = (window as any).__colony;
      const pose = colony.sim?.state?.operatorCar?.cell || colony.getOwnedDrivePose();
      if (!pose) return false;
      return Math.hypot(pose.x - start.x, pose.y - start.y) > 1.0;
    }, startP1, { timeout: 25_000 });

    await page2.waitForFunction((start) => {
      const colony = (window as any).__colony;
      const pose = colony.sim?.state?.operatorCar?.cell || colony.getOwnedDrivePose();
      if (!pose) return false;
      return Math.hypot(pose.x - start.x, pose.y - start.y) > 1.0;
    }, startP2, { timeout: 25_000 });

    // Assert peer world/map movement: Player 1 observes Player 2 moving, Player 2 observes Player 1 moving
    await page1.waitForFunction((start) => {
      const colony = (window as any).__colony;
      const racers = Array.from(colony.sim?.state?.remoteRacers?.values() || []) as any[];
      const p2 = racers.find((r) => r.username === "jamtin2" || (r.cell && Math.hypot(r.cell.x - start.x, r.cell.y - start.y) > 0.5));
      return !!p2 && !!p2.cell && Math.hypot(p2.cell.x - start.x, p2.cell.y - start.y) > 0.8;
    }, startP2, { timeout: 25_000 });

    await page2.waitForFunction((start) => {
      const colony = (window as any).__colony;
      const racers = Array.from(colony.sim?.state?.remoteRacers?.values() || []) as any[];
      const p1 = racers.find((r) => r.username === "jamtin" || (r.cell && Math.hypot(r.cell.x - start.x, r.cell.y - start.y) > 0.5));
      return !!p1 && !!p1.cell && Math.hypot(p1.cell.x - start.x, p1.cell.y - start.y) > 0.8;
    }, startP1, { timeout: 25_000 });

    // Allow vehicles to continue driving smoothly for 2.5 seconds to capture a clear racing run on video
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Neutralize player inputs on stop
    await page1.evaluate(() => {
      const colony = (window as any).__colony;
      colony.setOwnedDriveInput({ throttle: false, brake: true });
    });
    await page2.evaluate(() => {
      const colony = (window as any).__colony;
      colony.setOwnedDriveInput({ throttle: false, brake: true });
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

    console.log("Acceptance criteria 100% satisfied: Two racers driving down road, seeing each other in game, recorded to MP4.");
  });
});
