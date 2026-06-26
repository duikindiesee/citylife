// Capture the current Gearbox Auto Hub garage (Jack #180) day+night from a low road-level approach angle.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const EXE = "C:\\Users\\kooker\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const OUT = path.join(__dirname, "qa-garage");
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, headless: false, args: ["--ignore-gpu-blocklist", "--enable-gpu", "--window-size=1320,820"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("console", (m) => { if (m.type() === "error") console.log("PAGE-ERR", m.text().slice(0, 160)); });
  await page.goto("http://127.0.0.1:5191/?skipauth=1", { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__colony && window.__colony.renderer && window.__colony.commercialDistrict, null, { timeout: 40000 });
  await page.waitForTimeout(4500);
  const info = await page.evaluate(() => {
    const rt = window.__colony, r = rt.renderer, t = rt.sim.state.terrain;
    rt.setPaused(true); r.controls.enabled = false; r.controls.update = () => {};
    const cv = document.querySelector("canvas");
    r.renderer.setPixelRatio(1); r.renderer.setSize(cv.clientWidth, cv.clientHeight, false);
    r.camera.aspect = cv.clientWidth / cv.clientHeight; r.camera.updateProjectionMatrix();
    const off = t.size / 2;
    const gp = rt.commercialDistrict.garagePad;
    if (!gp) return { error: "no garagePad" };
    const cx = gp.x + gp.w / 2, cy = gp.y + gp.h / 2;
    const tx = cx - off, tz = cy - off, ty = r.surfaceY ? r.surfaceY(Math.round(cx), Math.round(cy)) : 3;
    const fa = gp.facingAngle;
    const fx = Math.sin(fa), fz = Math.cos(fa); // local +z (road-facing front) in world
    window.__shot = (daylight) => {
      const c = rt.sim.state.clock; c.daylight = daylight; c.isDay = daylight > 0.5; c.hour = daylight > 0.5 ? 12 : 22;
      // stand on the ROAD side, pulled back + up + a 3/4 offset, looking at the showroom/open-bay front
      const dist = Math.max(gp.w, gp.h) * 1.5;
      r.camera.position.set(
        tx + fx * dist + fz * gp.w * 0.35,
        ty + gp.h * 0.95,
        tz + fz * dist - fx * gp.w * 0.35,
      );
      r.camera.lookAt(tx, ty + 1.1, tz);
      r.renderer.render(r.scene, r.camera);
      return cv.toDataURL("image/jpeg", 0.93);
    };
    return { garagePad: { x: gp.x, y: gp.y, w: gp.w, h: gp.h, facingAngle: gp.facingAngle, name: gp.publicName } };
  });
  console.log("garage:", JSON.stringify(info));
  if (!info.error) {
    for (const [name, dl] of [["day", 1], ["night", 0]]) {
      const url = await page.evaluate((dl) => window.__shot(dl), dl);
      fs.writeFileSync(path.join(OUT, `garage-${name}.jpg`), Buffer.from(url.split(",")[1], "base64"));
    }
    console.log("captured to", OUT);
  }
  await browser.close();
})().catch((e) => { console.error("ERR", e && e.message ? e.message : e); process.exit(1); });
