import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

test("PR#548/PR#547 WebGL Acceptance: Owned home driveway and vehicle chase camera driving & re-entry", async ({
  page,
}) => {
  test.setTimeout(420_000);

  const outputDir = path.resolve("outputs/acceptance");
  fs.mkdirSync(outputDir, { recursive: true });

  console.log("Navigating to CityLife skipauth...");
  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 90000 });
  await page.waitForTimeout(6000);

  // Wait for live probes
  await page.waitForFunction(
    () => !!(window as any).__r3fScene && !!(window as any).__colony && !!(window as any).__r3fCamera,
    undefined,
    { timeout: 30000 },
  );

  console.log("Probes active. Claiming starter home on operator...");
  const claimResult = await page.evaluate(() => {
    const rt = (window as any).__colony;
    if (!rt) return { error: "no runtime" };
    const citizen = rt.citizens.list()[0];
    rt.setOperatorName(citizen.displayName);
    rt.setOperatorUserId("webgl-tester");
    const claimed = rt.claimStarterHome();
    const driveway = rt.getPlayerHomeDriveway();
    return {
      claimed,
      driveway,
      operatorCitizenId: rt.operatorCitizenId(),
    };
  });

  console.log("Claim result:", JSON.stringify(claimResult));
  expect(claimResult.claimed).toBe(true);
  expect(claimResult.driveway).not.toBeNull();
  expect(claimResult.driveway.plotId).toBe("lot_1");

  // Wait for the driveway mesh to be added to the live R3F scene
  await page.waitForFunction(
    () => {
      const scene = (window as any).__r3fScene;
      if (!scene) return false;
      let found = false;
      scene.traverse((obj: any) => {
        if (obj.name === "player-home-driveway") found = true;
      });
      return found;
    },
    undefined,
    { timeout: 30000 },
  );

  // SECTION 1: MEASURE AND BIND DRIVEWAY GEOMETRY & ROAD SEAM FROM ACTUAL RENDERED GEOMETRY
  const drivewayEvidence = await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    const rt = (window as any).__colony;
    const cam = (window as any).__r3fCamera;
    let targetMesh: any = null;
    let ribbonsGroup: any = null;
    scene.traverse((obj: any) => {
      if (obj.name === "player-home-driveway") targetMesh = obj;
      if (obj.name === "RoadRibbons") ribbonsGroup = obj;
    });
    if (!targetMesh) return null;
    const geom = targetMesh.geometry;
    const pos = geom.getAttribute("position");
    const norm = geom.getAttribute("normal");

    // Identify the exact contact edge vertex at northern end (max Z coordinate)
    let maxZ = -Infinity;
    let contactEdgeIdx = -1;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) > maxZ) {
        maxZ = pos.getZ(i);
        contactEdgeIdx = i;
      }
    }

    const contactVertex = {
      index: contactEdgeIdx,
      x: pos.getX(contactEdgeIdx),
      y: pos.getY(contactEdgeIdx),
      z: pos.getZ(contactEdgeIdx),
    };

    // Exact 3D point-to-triangle projection against actual rendered RoadRibbons tarmac triangles
    function closestPointOnTri(
      px: number, py: number, pz: number,
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
    ) {
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      const apx = px - ax, apy = py - ay, apz = pz - az;
      const d1 = abx * apx + aby * apy + abz * apz;
      const d2 = acx * apx + acy * apy + acz * apz;
      if (d1 <= 0 && d2 <= 0) return [ax, ay, az];
      const bpx = px - bx, bpy = py - by, bpz = pz - bz;
      const d3 = abx * bpx + aby * bpy + abz * bpz;
      const d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) return [bx, by, bz];
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return [ax + v * abx, ay + v * aby, az + v * abz];
      }
      const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
      const d5 = abx * cpx + aby * cpy + abz * cpz;
      const d6 = acx * cpx + acy * cpy + acz * cpz;
      if (d6 >= 0 && d5 <= d6) return [cx, cy, cz];
      const vb = d5 * d2 - d1 * d6;
      if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return [ax + w * acx, ay + w * acy, az + w * acz];
      }
      const va = d3 * d6 - d5 * d4;
      if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        return [bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)];
      }
      const denom = 1 / (va + vb + vc);
      const v = vb * denom;
      const w = vc * denom;
      return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
    }

    let minRibbonTriangleDist3D = Infinity;
    let minRibbonTriangleDistXZ = Infinity;
    let closestRibbonPoint: any = null;
    let bestDrivewayVert: any = null;
    let preApronTipDistXZ = Infinity;
    let separatedNegDist3D = Infinity;

    if (ribbonsGroup) {
      ribbonsGroup.traverse((child: any) => {
        if (!child.isMesh || !child.geometry) return;
        if (child.name === "RoadEdgeLines" || child.name === "RoadDashes" || child.name === "RoadJunctionPaint") return;
        const rPos = child.geometry.getAttribute("position");
        if (!rPos) return;
        for (let t = 0; t < rPos.count; t += 3) {
          const ax = rPos.getX(t), ay = rPos.getY(t), az = rPos.getZ(t);
          const nearLot1 = Math.abs(ax + 276) < 30 && Math.abs(az - 40) < 30;
          const nearNeg = Math.abs(ax + 424) < 80 && Math.abs(az + 96) < 80;
          if (!nearLot1 && !nearNeg) continue;
          const bx = rPos.getX(t + 1), by = rPos.getY(t + 1), bz = rPos.getZ(t + 1);
          const cx = rPos.getX(t + 2), cy = rPos.getY(t + 2), cz = rPos.getZ(t + 2);

          // Check all rendered driveway+apron vertices only for nearby ribbon triangles
          if (nearLot1) {
            for (let vi = 0; vi < pos.count; vi++) {
              const vx = pos.getX(vi), vy = pos.getY(vi), vz = pos.getZ(vi);
              const [qx, qy, qz] = closestPointOnTri(vx, vy, vz, ax, ay, az, bx, by, bz, cx, cy, cz);
              const d3 = Math.hypot(vx - qx, vy - qy, vz - qz);
              const dxz = Math.hypot(vx - qx, vz - qz);
              if (d3 < minRibbonTriangleDist3D) {
                minRibbonTriangleDist3D = d3;
                minRibbonTriangleDistXZ = dxz;
                bestDrivewayVert = { index: vi, x: vx, y: vy, z: vz };
                closestRibbonPoint = { x: qx, y: qy, z: qz, meshName: child.name || "RoadRibbons" };
              }
              // Pre-apron tip vertices (at z <= 38.0m, cell 313 northern edge)
              if (vz <= 38.01 && dxz < preApronTipDistXZ) {
                preApronTipDistXZ = dxz;
              }
            }
          }

          // Separated negative control at (-424, 3.0, -96)
          if (nearNeg) {
            const [nx, ny, nz] = closestPointOnTri(-424, 3.0, -96, ax, ay, az, bx, by, bz, cx, cy, cz);
            const nd3 = Math.hypot(-424 - nx, 3.0 - ny, -96 - nz);
            if (nd3 < separatedNegDist3D) separatedNegDist3D = nd3;
          }
        }
      });
    }

    const measuredSeamDelta = Math.abs((bestDrivewayVert?.y ?? contactVertex.y) - (closestRibbonPoint?.y ?? 0));

    // Also acquire vehicle and enter driving mode in the same evaluate pass to avoid extra SwiftShader frame stalls
    const citizenId = rt.operatorCitizenId();
    const userId = "webgl-tester";
    const spec = {
      id: "showroom:karoo-x19-targa",
      name: "Karoo X19 Targa",
      stats: { topSpeed: 0.85, acceleration: 0.8, grip: 0.85, braking: 0.75 },
      paint: { body: 0xd64545, cabin: 0x2a2d33, accent: 0xffd25a },
      parts: [],
    };
    const acquired = rt.acquireCar(spec, citizenId);
    rt.applyVehicleOwnership(userId, ["showroom:karoo-x19-targa"]);
    const enteredFp = rt.enterFirstPerson(citizenId);
    if (!rt.isOwnedDriveSeated()) {
      rt.enterOwnedCar();
    }

    return {
      name: targetMesh.name,
      plotId: targetMesh.userData?.plotId,
      vertexCount: pos?.count,
      contactVertex,
      bestDrivewayVert,
      closestRibbonPoint,
      minRibbonTriangleDist3D,
      minRibbonTriangleDistXZ,
      preApronTipDistXZ,
      separatedNegDist3D,
      measuredSeamDelta,
      firstNormalY: norm?.getY(0),
      visible: targetMesh.visible,
      acquireResult: {
        acquired,
        enteredFp,
        hasStoredCar: rt.hasStoredCar(),
        firstPersonActive: rt.getUiState().firstPerson.active,
        isOwnedDriveSeated: rt.isOwnedDriveSeated(),
        ownedDrivePose: rt.getOwnedDrivePose(),
      },
    };
  });

  console.log("Rendered Driveway & Road Contact Evidence:", JSON.stringify(drivewayEvidence, null, 2));
  expect(drivewayEvidence).not.toBeNull();
  expect(drivewayEvidence!.plotId).toBe("lot_1");
  expect(drivewayEvidence!.vertexCount).toBe(44); // (8 driveway + 3 apron cells) * 4 vertices = 44
  expect(drivewayEvidence!.firstNormalY).toBeGreaterThan(0.9);
  expect(drivewayEvidence!.closestRibbonPoint).not.toBeNull();
  // Positive control: rendered apron contacts rendered road ribbon mesh (< 1cm XZ, < 2cm 3D)
  expect(drivewayEvidence!.minRibbonTriangleDistXZ).toBeLessThan(0.01);
  expect(drivewayEvidence!.minRibbonTriangleDist3D).toBeLessThan(0.02);
  expect(drivewayEvidence!.measuredSeamDelta).toBeLessThan(0.02);
  // Pre-apron negative control & separated negative control
  expect(drivewayEvidence!.preApronTipDistXZ).toBeGreaterThan(8.5);
  expect(drivewayEvidence!.separatedNegDist3D).toBeGreaterThan(50);

  // SECTION 2: ACQUIRE VEHICLE & ENTER FIRST-PERSON DRIVING
  const acquireResult = drivewayEvidence!.acquireResult;
  console.log("Acquire & Drive Mode Preconditions:", JSON.stringify(acquireResult));
  expect(acquireResult.acquired).toBe(true);
  expect(acquireResult.firstPersonActive).toBe(true);
  expect(acquireResult.isOwnedDriveSeated).toBe(true);
  expect(acquireResult.ownedDrivePose).not.toBeNull();

  // Wait for vehicle model and controller frame step
  await page.waitForTimeout(800);

  // Inspect live scene for vehicle model and exterior visibility before moving
  const initialDrivingEvidence = await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    const camera = (window as any).__r3fCamera;
    const rt = (window as any).__colony;
    let exteriorModel: any = null;
    let operatorCarGroup: any = null;
    if (scene) {
      scene.traverse((obj: any) => {
        if (obj.name === "operator-car") operatorCarGroup = obj;
        if (obj.name === "owned-vehicle-model") exteriorModel = obj;
      });
    }

    const drivePose = rt.getOwnedDrivePose();
    const terrain = rt.sim.state.terrain;
    const groundY = terrain.worldY(Math.round(drivePose.x), Math.round(drivePose.y));
    const clearance = camera.position.y - groundY;

    // Convert grid coordinates to canonical 4m world units
    const worldCarX = (drivePose.x - terrain.size / 2) * 4;
    const worldCarZ = (drivePose.y - terrain.size / 2) * 4;
    const cameraDistanceToCar = Math.hypot(camera.position.x - worldCarX, camera.position.z - worldCarZ);

    return {
      hasCarGroup: !!operatorCarGroup,
      carGroupVisible: operatorCarGroup?.visible,
      hasExteriorModel: !!exteriorModel,
      exteriorModelVisible: exteriorModel?.visible,
      vehicleId: exteriorModel?.userData?.vehicleId,
      drivePose: { ...drivePose },
      worldCar: { x: worldCarX, z: worldCarZ },
      cameraPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      cameraDistanceToCar,
      groundY,
      cameraClearance: clearance,
    };
  });

  console.log("Initial Driving Scene Evidence:", JSON.stringify(initialDrivingEvidence));
  expect(initialDrivingEvidence.hasCarGroup).toBe(true);
  expect(initialDrivingEvidence.carGroupVisible).toBe(true);
  expect(initialDrivingEvidence.hasExteriorModel).toBe(true);
  expect(initialDrivingEvidence.exteriorModelVisible).toBe(true);
  expect(initialDrivingEvidence.vehicleId).toBe("showroom:karoo-x19-targa");
  // Camera must maintain terrain clearance above ground and follow at ~6.2m distance
  expect(initialDrivingEvidence.cameraClearance).toBeGreaterThanOrEqual(0.5);
  expect(initialDrivingEvidence.cameraDistanceToCar).toBeCloseTo(6.2, 0.5);

  // SECTION 3: REAL BROWSER DRIVING INPUT (page.keyboard.down / up)
  console.log("Dispatching real browser keyboard input 'KeyW' to canvas...");
  const initialPose = initialDrivingEvidence.drivePose;

  // Press 'KeyW' (FirstPersonController listens on window keydown/keyup)
  await page.keyboard.down("KeyW");

  // Allow browser frame loop to process real keydown events and step simulation
  await page.waitForTimeout(1500);

  // Release key
  await page.keyboard.up("KeyW");

  const postKeyMoveEvidence = await page.evaluate((initPose) => {
    const rt = (window as any).__colony;
    const camera = (window as any).__r3fCamera;
    const nextPose = { ...rt.getOwnedDrivePose() };
    const terrain = rt.sim.state.terrain;

    // Grid coordinate displacement and canonical 4m world displacement
    const gridDeltaX = nextPose.x - initPose.x;
    const gridDeltaY = nextPose.y - initPose.y;
    const gridDelta = Math.hypot(gridDeltaX, gridDeltaY);
    const worldMetresMoved = gridDelta * 4; // 1 grid cell = 4 world metres

    const worldCarX = (nextPose.x - terrain.size / 2) * 4;
    const worldCarZ = (nextPose.y - terrain.size / 2) * 4;
    const groundY = terrain.worldY(Math.round(nextPose.x), Math.round(nextPose.y));
    const clearance = camera.position.y - groundY;
    const cameraDistanceToCar = Math.hypot(camera.position.x - worldCarX, camera.position.z - worldCarZ);

    return {
      initPose,
      nextPose,
      gridDelta,
      worldMetresMoved,
      cameraPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      cameraClearance: clearance,
      cameraDistanceToCar,
    };
  }, initialPose);

  console.log("Real Browser Keyboard Move Evidence:", JSON.stringify(postKeyMoveEvidence));
  // Assert actual vehicle translation happened in response to real browser input
  expect(postKeyMoveEvidence.worldMetresMoved).toBeGreaterThan(0.2);
  // Camera maintains terrain clearance and chase distance relative to the moved car
  expect(postKeyMoveEvidence.cameraClearance).toBeGreaterThanOrEqual(0.5);
  expect(postKeyMoveEvidence.cameraDistanceToCar).toBeCloseTo(6.2, 0.5);

  // Save screenshot of chase camera following the vehicle
  const chaseScreenshotPath = path.join(outputDir, "webgl-chase-camera-view.png");
  await page.screenshot({ path: chaseScreenshotPath });
  console.log("Saved chase camera screenshot to", chaseScreenshotPath);

  // SECTION 4: VEHICLE EXIT AND RE-ENTRY LIFECYCLE WITH CAMERA & EXTERIOR ASSERTIONS
  console.log("Testing vehicle exit & re-entry...");
  const exitResult = await page.evaluate(() => {
    const rt = (window as any).__colony;
    const scene = (window as any).__r3fScene;
    const camera = (window as any).__r3fCamera;
    const exited = rt.exitOwnedCar();

    let exteriorModel: any = null;
    if (scene) {
      scene.traverse((obj: any) => {
        if (obj.name === "owned-vehicle-model") exteriorModel = obj;
      });
    }

    const snap = {
      exited,
      isOwnedDriveSeated: rt.isOwnedDriveSeated(),
      firstPersonActive: rt.getUiState().firstPerson.active,
      ownedDrivePose: rt.getOwnedDrivePose(),
      hasParkedCarPose: !!rt.getParkedCarPose(),
      exteriorModelVisible: exteriorModel?.visible,
      cameraPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    };

    // Immediately re-enter vehicle so next R3F frame attaches chase camera
    rt.enterOwnedCar();
    return snap;
  });

  console.log("Exit Result:", JSON.stringify(exitResult));
  expect(exitResult.exited).toBe(true);
  expect(exitResult.isOwnedDriveSeated).toBe(false);
  expect(exitResult.ownedDrivePose).toBeNull();
  expect(exitResult.hasParkedCarPose).toBe(true); // parked vehicle pose stands in world
  expect(exitResult.exteriorModelVisible).toBe(true); // parked car exterior remains visible

  // Wait 1 R3F frame for FirstPersonController chase camera to attach to vehicle, then capture reEnterResult and frame driveway
  const { reEnterResult, framingNdc } = await page.evaluate(() => {
    const rt = (window as any).__colony;
    const scene = (window as any).__r3fScene;
    const camera = (window as any).__r3fCamera;

    let exteriorModel: any = null;
    let operatorCarGroup: any = null;
    if (scene) {
      scene.traverse((obj: any) => {
        if (obj.name === "operator-car") operatorCarGroup = obj;
        if (obj.name === "owned-vehicle-model") exteriorModel = obj;
      });
    }

    const drivePose = rt.getOwnedDrivePose();
    const terrain = rt.sim.state.terrain;
    const groundY = terrain.worldY(Math.round(drivePose.x), Math.round(drivePose.y));
    const clearance = camera.position.y - groundY;
    const worldCarX = (drivePose.x - terrain.size / 2) * 4;
    const worldCarZ = (drivePose.y - terrain.size / 2) * 4;
    const cameraDistanceToCar = Math.hypot(camera.position.x - worldCarX, camera.position.z - worldCarZ);

    const reEnter = {
      isOwnedDriveSeated: rt.isOwnedDriveSeated(),
      firstPersonActive: rt.getUiState().firstPerson.active,
      ownedDrivePose: { ...drivePose },
      hasExteriorModel: !!exteriorModel,
      exteriorModelVisible: exteriorModel?.visible,
      vehicleId: exteriorModel?.userData?.vehicleId,
      cameraClearance: clearance,
      cameraDistanceToCar,
    };

    // Frame owned home, gate, apron, and road ribbon together for screenshot
    rt.exitOwnedCar();
    const N = terrain.size;
    const wx = (gx: number) => (gx - N / 2) * 4;
    const wz = (gy: number) => (gy - N / 2) * 4;
    const focusY = Math.max(0, terrain.worldY(235, 311));
    const camY = Math.max(0, terrain.worldY(235, 318)) + 1.7;
    rt.fpTeleportRequest = {
      x: 235,
      y: 318.5,
      seq: Date.now(),
    };
    rt.fpLookAtTarget = {
      x: wx(235),
      y: focusY + 0.5,
      z: wz(310),
    };
    camera.position.set(wx(235), camY, wz(318.5));
    camera.lookAt(wx(235), focusY + 0.5, wz(310));
    camera.updateMatrixWorld();

    const projectNdc = (gx: number, gy: number, hOffset: number) => {
      const v = camera.position.clone().set(wx(gx), Math.max(0, terrain.worldY(Math.round(gx), Math.round(gy))) + hOffset, wz(gy));
      v.project(camera);
      return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) };
    };

    return {
      reEnterResult: reEnter,
      framingNdc: {
        houseDoor: projectNdc(235, 306, 2.0),
        gate: projectNdc(235, 311, 1.0),
        apronRoadContact: projectNdc(235, 316.5, 0.2),
      },
    };
  });

  console.log("Re-Entry Result:", JSON.stringify(reEnterResult));
  expect(reEnterResult.isOwnedDriveSeated).toBe(true);
  expect(reEnterResult.firstPersonActive).toBe(true);
  expect(reEnterResult.ownedDrivePose).not.toBeNull();
  expect(reEnterResult.hasExteriorModel).toBe(true);
  expect(reEnterResult.exteriorModelVisible).toBe(true);
  expect(reEnterResult.vehicleId).toBe("showroom:karoo-x19-targa");
  expect(reEnterResult.cameraClearance).toBeGreaterThanOrEqual(0.5);
  expect(reEnterResult.cameraDistanceToCar).toBeCloseTo(6.2, 0.5);

  console.log("Driveway Framing NDC:", JSON.stringify(framingNdc));
  for (const pt of [framingNdc.houseDoor, framingNdc.gate, framingNdc.apronRoadContact]) {
    expect(Math.abs(pt.x)).toBeLessThan(0.85);
    expect(Math.abs(pt.y)).toBeLessThan(0.85);
  }

  const drivewayScreenshotPath = path.join(outputDir, "webgl-driveway-surface.png");
  await page.screenshot({ path: drivewayScreenshotPath });
  console.log("Saved driveway scene screenshot to", drivewayScreenshotPath);
});
