// v10: LIVE production mall-pad anchor massing QA for citylife.kooker.co.za v0.17.14+
// Captures clean GL canvas frames via live prod bundle + QA-only AuthGate route patch.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const EXE = 'C:\\Users\\kooker\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe';
const URL = 'https://citylife.kooker.co.za/?skipauth=1&floydMallAnchorQA=1';
const OUT = path.join(__dirname, 'qa-frames', 'prod-mall-anchor-live');
fs.mkdirSync(OUT, { recursive: true });

function safeName(s) { return String(s).replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-'); }

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: false,
    args: ['--ignore-gpu-blocklist','--enable-gpu','--window-size=1320,820'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  await page.route('**/assets/index-*.js', async (route) => {
    const resp = await route.fetch();
    let body = await resp.text();
    const version = (body.match(/VITE_APP_VERSION:`([^`]+)`/) || [])[1] || 'unknown';
    const needle = 'return u&&f&&(p||m)?(0,$.jsx)($.Fragment,{children:e}):a?null:r?';
    const repl = 'return (p||m)?(0,$.jsx)($.Fragment,{children:e}):a?null:r?';
    if (!body.includes(needle)) throw new Error('AuthGate patch needle not found in live bundle');
    body = body.replace(needle, repl);
    console.log(`Live bundle version=${version}; patched AuthGate only for QA runtime hooks.`);
    await route.fulfill({ response: resp, body, headers: { ...resp.headers(), 'content-type': 'application/javascript' } });
  });

  page.on('console', msg => console.log(`[browser:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[pageerror] ${err.stack || err}`));

  await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__colony?.renderer && window.__colony?.sim?.state?.terrain, null, { timeout: 60000 });
  await page.waitForTimeout(8000);

  const inspection = await page.evaluate(() => {
    const rt = window.__colony, r = rt.renderer, s = rt.sim.state;
    const d = r.commercialDistrict;
    const N = s.terrain.size;
    const level = r.terrainLevel;
    const surf = (x,y) => r.surfaceY ? r.surfaceY(x,y) : (level?.get?.(y*N+x) ?? s.terrain.worldY(x,y));
    const mall = d?.mallPad || { x:99, y:248, w:14, h:10 };
    const mx0 = mall.x, mx1 = mall.x + mall.w - 1, my0 = mall.y, my1 = mall.y + mall.h - 1;
    const mallCorners = [[mx0,my0],[mx1,my0],[mx0,my1],[mx1,my1]].map(([x,y]) => ({x,y,raw:s.terrain.worldY(x,y),surface:surf(x,y),level:level?.get?.(y*N+x) ?? null}));
    const wx = x => x - N / 2, wz = y => y - N / 2;
    const near = [];
    r.scene.updateMatrixWorld(true);
    r.scene.traverse(o => {
      const n = o.name || '';
      const e = o.matrixWorld?.elements;
      if (!e) return;
      const pos = { x: e[12] || 0, y: e[13] || 0, z: e[14] || 0 };
      const inMallArea = pos.x >= wx(mx0)-8 && pos.x <= wx(mx1)+8 && pos.z >= wz(my0)-8 && pos.z <= wz(my1)+8;
      const named = /mall|anchor|commercial|shop|label|business|pad/i.test(n);
      if (inMallArea || named) near.push({ name:n, type:o.type, x:+pos.x.toFixed(2), y:+pos.y.toFixed(2), z:+pos.z.toFixed(2), visible:o.visible, children:o.children?.length || 0, inMallArea });
    });
    return {
      title: document.title, href: location.href,
      appVersion: [...document.scripts].map(s=>s.src).find(Boolean) || null,
      N, reserve: d?.reserve || null, mallPad: mall, parcelCount: d?.parcels?.length ?? null,
      terrainLevelSize: level?.size ?? null, clock: s.clock, mallCorners,
      nearMallOrNamedObjects: near.slice(0, 400),
    };
  });
  fs.writeFileSync(path.join(OUT, 'inspection.json'), JSON.stringify(inspection, null, 2));
  console.log('INSPECTION');
  console.log(JSON.stringify({reserve: inspection.reserve, mallPad: inspection.mallPad, parcelCount: inspection.parcelCount, terrainLevelSize: inspection.terrainLevelSize, mallCorners: inspection.mallCorners, nearCount: inspection.nearMallOrNamedObjects.length}, null, 2));
  console.log('near objects sample:', inspection.nearMallOrNamedObjects.slice(0,40).map(o=>`${o.type}:${o.name||'(unnamed)'}@${o.x},${o.y},${o.z}${o.inMallArea?'*':''}`).join(' | '));

  await page.evaluate(() => {
    const rt = window.__colony, r = rt.renderer;
    rt.setPaused?.(true);
    if (r.controls) { r.controls.enabled = false; r.controls.update = () => {}; }
    const cv = document.querySelector('canvas');
    r.renderer.setPixelRatio(1);
    r.renderer.setSize(cv.clientWidth, cv.clientHeight, false);
    r.camera.aspect = cv.clientWidth / cv.clientHeight;
    r.camera.updateProjectionMatrix();
  });

  async function shot(name, pos, look, daylight) {
    await page.evaluate(({p,l,dl}) => {
      const rt = window.__colony, r = rt.renderer, c = rt.sim.state.clock;
      rt.setPaused?.(true);
      c.daylight = dl; c.isDay = dl === 1; c.hour = dl === 1 ? 12 : 22;
      if (r.controls) { r.controls.enabled = false; r.controls.update = () => {}; r.controls.target.set(l[0], l[1], l[2]); }
      r.camera.position.set(p[0], p[1], p[2]);
      r.camera.lookAt(l[0], l[1], l[2]);
      r.camera.updateProjectionMatrix();
      r.renderer.render(r.scene, r.camera);
    }, {p:pos, l:look, dl:daylight});
    await page.waitForTimeout(700);
    const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png', 1.0));
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log('✓', file);
    return file;
  }

  const N = inspection.N, mall = inspection.mallPad, reserve = inspection.reserve || {x:81,y:241,w:64,h:48};
  const wx = x => x - N/2, wz = y => y - N/2;
  const mcx = mall.x + (mall.w - 1) / 2, mcy = mall.y + (mall.h - 1) / 2;
  const rcx = reserve.x + (reserve.w - 1) / 2, rcy = reserve.y + (reserve.h - 1) / 2;
  const shots = [
    { key:'mall-anchor-seaward-medium', pos:[wx(mcx), 13, wz(mcy + mall.h + 18)], look:[wx(mcx), 1.0, wz(mcy)] },
    { key:'mall-anchor-overhead', pos:[wx(mcx), 42, wz(mcy + 2)], look:[wx(mcx), 0.8, wz(mcy)] },
    { key:'mall-anchor-side-east', pos:[wx(mcx + mall.w + 18), 12, wz(mcy)], look:[wx(mcx), 1.0, wz(mcy)] },
    { key:'commercial-reserve-with-anchor', pos:[wx(rcx), 35, wz(reserve.y + reserve.h + 34)], look:[wx(rcx), 1.0, wz(rcy)] },
    { key:'mall-anchor-low-ground-contact', pos:[wx(mcx), 4.5, wz(mcy + mall.h + 8)], look:[wx(mcx), 0.75, wz(mcy)] },
  ];
  const frames = [];
  for (const s of shots) {
    frames.push(await shot(`${safeName(s.key)}-day.png`, s.pos, s.look, 1));
    frames.push(await shot(`${safeName(s.key)}-night.png`, s.pos, s.look, 0));
  }
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames, null, 2));
  await browser.close();
  console.log('DONE', OUT);
})().catch(e => { console.error('ERR', e.stack || e); process.exit(1); });
