import { test, expect } from "@playwright/test";

// UI.VERSION.1 — the build stamp must be readable, and must not repeat the corner-collision defect.
//
// UI.HUD.OVERLAP.1 (PR 421) and UI.GEO.OVERLAP.1 (PR 432) both exist because a new element pinned
// itself into a corner that already had an occupant, and whichever painted last buried the other.
// A version stamp is a third candidate for exactly that mistake, so this suite asserts the stamp is
// present, non-empty, on-screen, and shares no pixel with any existing HUD region — measured from
// real laid-out rects, not from hardcoded coordinates.
//
// It covers the two viewports the ticket names AND both player and operator view, plus first person
// on mobile. First person matters most: that is the mobile-first view a player is actually in when
// they hit a bug, and it is the one view where the bottom-left rail is NOT available (the touch
// joystick owns that corner), so the stamp rides in the edge-HUD destination strip there instead.
//
// DISCRIMINATION: the last test in this file deliberately moves the stamp on top of an existing
// region and asserts the SAME detector reports the collision. Without that, a zero-overlap result
// could just mean the detector never fires.

type Region = { name: string; sel: string };

const STAMP: Region = { name: "Build stamp", sel: '[data-testid="build-stamp"]' };

// Everything that can share screen space with the stamp in the third-person views.
const HUD_REGIONS: Region[] = [
  { name: "Geo readout", sel: '[data-testid="geo-readout"]' },
  { name: "Rally card", sel: ".rally-social-read" },
  { name: "City HUD title", sel: "aside.hud .hud-essentials h2" },
  { name: "HUD details expander", sel: "aside.hud .hud-detail-toggle" },
];

// First person replaces the whole HUD: the joystick and action cluster are the thumb targets the
// stamp must stay clear of.
const FP_REGIONS: Region[] = [
  { name: "Joystick", sel: ".first-person-panel__joystick" },
  { name: "Action cluster", sel: ".first-person-panel__action-cluster" },
  { name: "Guidance caption", sel: ".first-person-panel__guidance-caption" },
  { name: "Exit button", sel: ".first-person-panel__exit-button" },
];

type Measured = {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  bottom: number;
  text: string;
};
type Probe = {
  viewport: { w: number; h: number };
  missing: string[];
  measured: Measured[];
};

async function probe(
  page: import("@playwright/test").Page,
  regions: Region[],
): Promise<Probe> {
  return await page.evaluate((regions: Region[]) => {
    const missing: string[] = [];
    const measured: Measured[] = [];
    for (const r of regions) {
      const el = document.querySelector(r.sel);
      if (!el) {
        missing.push(r.name);
        continue;
      }
      const rect = el.getBoundingClientRect();
      measured.push({
        name: r.name,
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        right: rect.right,
        bottom: rect.bottom,
        text: (el.textContent || "").trim(),
      });
    }
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      missing,
      measured,
    };
  }, regions);
}

function intersectionArea(a: Measured, b: Measured): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= x || bottom <= y) return 0;
  return (right - x) * (bottom - y);
}

/** Every collision between the stamp and anything else that is on screen. */
function stampOverlaps(p: Probe): string[] {
  const stamp = p.measured.find((m) => m.name === STAMP.name);
  if (!stamp) return ["Build stamp is not rendered at all"];
  return p.measured
    .filter((m) => m.name !== STAMP.name)
    .map((m) => ({ m, area: intersectionArea(stamp, m) }))
    .filter((r) => r.area > 0)
    .map((r) => `${STAMP.name} x ${r.m.name} = ${Math.round(r.area)}px^2`);
}

function assertStampIsSane(p: Probe, where: string): void {
  const stamp = p.measured.find((m) => m.name === STAMP.name);
  expect(stamp, `${where}: the build stamp must be rendered`).toBeTruthy();

  // Non-vacuous: if nothing else rendered there is nothing to collide with and this proves nothing.
  expect(
    p.measured.length,
    `${where}: at least one other region must be present, or the overlap check is vacuous`,
  ).toBeGreaterThan(1);

  // (1) It must actually say something. A blank stamp is worse than none — it looks like a build
  //     identity when it is not one.
  expect(stamp!.text, `${where}: the stamp must not be empty`).not.toEqual("");
  expect(
    stamp!.text,
    `${where}: the stamp must not fall back to "build unknown" in a real build`,
  ).not.toEqual("build unknown");

  // (2) It must not share a pixel with any existing region.
  expect(stampOverlaps(p), `${where}: the stamp must not overlap the HUD`).toEqual(
    [],
  );

  // (3) Two-sided: it may not be "de-conflicted" by being collapsed or shoved off-screen.
  expect(stamp!.w, `${where}: the stamp must have width`).toBeGreaterThan(1);
  expect(stamp!.h, `${where}: the stamp must have height`).toBeGreaterThan(1);
  expect(stamp!.x, `${where}: the stamp must not be off the left edge`).toBeGreaterThanOrEqual(0);
  expect(stamp!.y, `${where}: the stamp must not be off the top edge`).toBeGreaterThanOrEqual(0);
  expect(
    stamp!.right,
    `${where}: the stamp must not overflow the ${p.viewport.w}px viewport`,
  ).toBeLessThanOrEqual(p.viewport.w + 0.5);
  expect(
    stamp!.bottom,
    `${where}: the stamp must not overflow the ${p.viewport.h}px viewport`,
  ).toBeLessThanOrEqual(p.viewport.h + 0.5);
}

async function bootSession(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 60_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { __colony?: unknown }).__colony,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForSelector('[data-testid="build-stamp"]', { timeout: 30_000 });
  await page.waitForTimeout(1500);
}

async function setPlayerView(
  page: import("@playwright/test").Page,
  value: boolean,
): Promise<void> {
  await page.evaluate((v) => {
    (
      window.__colony as unknown as { setPlayerView: (x: boolean) => void }
    ).setPlayerView(v);
  }, value);
  await page.waitForTimeout(900);
}

for (const [label, viewport] of [
  ["desktop 1280x800", { width: 1280, height: 800 }],
  ["mobile 390x844", { width: 390, height: 844 }],
] as const) {
  test(`build stamp is visible and clear of the HUD (${label})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await bootSession(page);

    await setPlayerView(page, true);
    assertStampIsSane(
      await probe(page, [STAMP, ...HUD_REGIONS]),
      `${label} player view`,
    );

    // Operator view resolves subjects exactly, so the readout grows — the tallest state the rail
    // has to hold, and therefore the one most likely to push into the stamp.
    await setPlayerView(page, false);
    assertStampIsSane(
      await probe(page, [STAMP, ...HUD_REGIONS]),
      `${label} operator view`,
    );

    await page.screenshot({
      path: testInfo.outputPath(`build-stamp-${viewport.width}.png`),
    });
  });
}

test("build stamp survives first person on mobile, where the joystick owns the corner", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await bootSession(page);

  const entered = await page.evaluate(() => {
    const rt = window.__colony as unknown as {
      setPlayerView: (v: boolean) => void;
      getUiState: () => { firstPerson: { stepInCitizenIds: string[] } };
      enterFirstPerson: (id: string) => boolean;
    };
    rt.setPlayerView(false);
    const ids = rt.getUiState().firstPerson.stepInCitizenIds;
    return ids.length > 0 && rt.enterFirstPerson(ids[0]);
  });
  expect(entered, "must be able to step into a citizen").toBe(true);
  await page.waitForTimeout(1800);

  // The stamp must have MOVED to the first-person owner, not stayed in the rail under the joystick.
  const railMembers = await page.evaluate(
    () =>
      document.querySelector('[data-testid="hud-corner-rail-left"]')
        ?.childElementCount ?? -1,
  );
  expect(
    railMembers,
    "the bottom-left rail must still degrade to exactly one member in first person",
  ).toBe(1);

  assertStampIsSane(
    await probe(page, [STAMP, ...FP_REGIONS]),
    "mobile 390x844 first person",
  );

  await page.screenshot({
    path: testInfo.outputPath("build-stamp-first-person-390.png"),
  });
});

// ================================================================================================
// DISCRIMINATION — prove the overlap detector actually fires.
// ================================================================================================
test("the overlap assertion FAILS when the stamp is deliberately placed over a HUD region", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await bootSession(page);
  await setPlayerView(page, false);

  // Baseline: the real layout is clean.
  expect(
    stampOverlaps(await probe(page, [STAMP, ...HUD_REGIONS])),
    "baseline: the shipped layout must be clean",
  ).toEqual([]);

  // Now pin the stamp exactly over the geo readout — the precise mistake UI.GEO.OVERLAP.1 fixed.
  const covered = await page.evaluate(() => {
    const stamp = document.querySelector(
      '[data-testid="build-stamp"]',
    ) as HTMLElement | null;
    const target = document.querySelector(
      '[data-testid="geo-readout"]',
    ) as HTMLElement | null;
    if (!stamp || !target) return false;
    const r = target.getBoundingClientRect();
    stamp.style.position = "fixed";
    stamp.style.left = `${r.x + 4}px`;
    stamp.style.top = `${r.y + 4}px`;
    stamp.style.zIndex = "999";
    return true;
  });
  expect(covered, "must be able to stage the collision").toBe(true);
  await page.waitForTimeout(300);

  const overlaps = stampOverlaps(await probe(page, [STAMP, ...HUD_REGIONS]));
  expect(
    overlaps.length,
    "the detector must report the staged collision — otherwise the clean result above proves nothing",
  ).toBeGreaterThan(0);
  expect(overlaps.join(" ")).toContain("Geo readout");
});
