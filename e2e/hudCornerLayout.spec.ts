import { test, expect } from "@playwright/test";

// UI.HUD.OVERLAP.1 — the bottom-right corner of the operator HUD must have exactly ONE layout owner.
//
// The defect: the city HUD panel ('Landing One' + its 'HUD details' expander) and every new-player /
// venue affordance ('Drive home', 'Choose your home', 'The Gamehouse', 'Gearbox Auto Hub') each pinned
// THEMSELVES into that corner — the panel with `position: absolute; bottom; right`, the buttons with
// `position: fixed` and hand-picked `bottom: 24/66/68/112`. Nothing owned the corner, so whichever
// painted last buried the other: 'Gearbox Auto Hub' sat on the 'HUD details' expander and 'Choose your
// home' sat on the 'Landing One' title (both unreadable AND unclickable), and 'Choose your home' hid
// 'The Gamehouse' entirely.
//
// This test is deliberately built to DISCRIMINATE, which is why it does two things a screenshot or a
// hardcoded-pixel assertion cannot:
//   1. it reads the ACTUAL laid-out rects (getBoundingClientRect) and asserts pairwise intersection
//      area is exactly zero — no magic numbers, so it keeps working when copy, fonts or the affordance
//      set change; and
//   2. it hit-tests the CENTRE of every control (document.elementFromPoint) and requires the control
//      itself to answer, which is the only way to prove a button is genuinely clickable rather than
//      merely painted somewhere.
// It is also two-sided: nothing may overlap AND nothing may be pushed off-screen, clipped to zero, or
// scrolled out of the corner rail — otherwise "fix the overlap by shoving a button off the viewport"
// would pass.
//
// Verified to fail against the pre-fix layout (measured 1280x800: 'Gearbox Auto Hub' x 'HUD details'
// intersected by 3600px^2 and the expander's centre hit-test returned the button, not the expander).

type Region = { name: string; sel: string };

// Every interactive region that shares the bottom-right corner in a default ADMIN/operator session.
// No feature flag is set: the local DEV skip-auth bypass (?skipauth=1) is what makes the journey and
// venue affordances live, which is exactly the operator-observed multi-affordance state.
const REGIONS: Region[] = [
  { name: "Drive home", sel: '[data-build-action="open-drive-home"]' },
  { name: "Choose your home", sel: '[data-build-action="open-home"]' },
  { name: "The Gamehouse", sel: '[data-build-action="open-gamehouse"]' },
  { name: "Gearbox Auto Hub", sel: '[data-build-action="open-showroom"]' },
  { name: "City HUD title", sel: "aside.hud .hud-essentials h2" },
  { name: "HUD details expander", sel: "aside.hud .hud-detail-toggle" },
];

type Probe = {
  viewport: { w: number; h: number };
  missing: string[];
  measured: {
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    right: number;
    bottom: number;
    reachable: boolean;
    blockedBy: string | null;
  }[];
};

async function probeCorner(
  page: import("@playwright/test").Page,
  regions: Region[],
): Promise<Probe> {
  return await page.evaluate((regions: Region[]) => {
    const describe = (el: Element | null): string | null => {
      if (!el) return null;
      const build = el.getAttribute?.("data-build-action");
      const cls = (el.className || "").toString().split(" ")[0];
      return `${el.tagName.toLowerCase()}${build ? `[${build}]` : cls ? `.${cls}` : ""}`;
    };
    const missing: string[] = [];
    const measured: Probe["measured"] = [];
    for (const r of regions) {
      const el = document.querySelector(r.sel);
      if (!el) {
        missing.push(r.name);
        continue;
      }
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      // Reachable means a real click at the visual centre lands on this control (or on its own text
      // node / icon child) — not on some sibling painted over it.
      const reachable = !!hit && (hit === el || el.contains(hit));
      measured.push({
        name: r.name,
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        right: rect.right,
        bottom: rect.bottom,
        reachable,
        blockedBy: reachable ? null : describe(hit),
      });
    }
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      missing,
      measured,
    };
  }, regions);
}

function intersectionArea(
  a: Probe["measured"][number],
  b: Probe["measured"][number],
): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= x || bottom <= y) return 0;
  return (right - x) * (bottom - y);
}

function assertCornerIsSane(probe: Probe, where: string): void {
  // Guard against a vacuous pass: if the affordances were not rendered there is nothing to collide
  // with and every assertion below would trivially hold.
  expect(
    probe.missing,
    `${where}: every corner affordance must be present, otherwise this test proves nothing`,
  ).toEqual([]);

  // (1) No two interactive regions may share a single pixel.
  const overlaps: string[] = [];
  for (let i = 0; i < probe.measured.length; i++) {
    for (let j = i + 1; j < probe.measured.length; j++) {
      const area = intersectionArea(probe.measured[i], probe.measured[j]);
      if (area > 0) {
        overlaps.push(
          `${probe.measured[i].name} x ${probe.measured[j].name} = ${Math.round(area)}px^2`,
        );
      }
    }
  }
  expect(overlaps, `${where}: HUD regions must not intersect`).toEqual([]);

  // (2) Every affordance must be reachable at its own centre.
  const unreachable = probe.measured
    .filter((m) => !m.reachable)
    .map((m) => `${m.name} (centre click lands on ${m.blockedBy})`);
  expect(
    unreachable,
    `${where}: every corner control must be clickable at its centre`,
  ).toEqual([]);

  // (3) Two-sided: nothing may be collapsed, clipped or pushed outside the viewport in the process of
  //     de-conflicting the corner.
  const offscreen = probe.measured
    .filter(
      (m) =>
        m.w < 1 ||
        m.h < 1 ||
        m.x < 0 ||
        m.y < 0 ||
        m.right > probe.viewport.w + 0.5 ||
        m.bottom > probe.viewport.h + 0.5,
    )
    .map(
      (m) =>
        `${m.name} [${Math.round(m.x)},${Math.round(m.y)} ${Math.round(m.w)}x${Math.round(m.h)}]`,
    );
  expect(
    offscreen,
    `${where}: no control may be clipped or pushed off the ${probe.viewport.w}x${probe.viewport.h} viewport`,
  ).toEqual([]);
}

async function bootOperatorSession(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 60_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { __colony?: unknown }).__colony,
    undefined,
    { timeout: 60_000 },
  );
  // The corner rail only settles once the HUD panel has its real content height.
  await page.waitForSelector("aside.hud .hud-detail-toggle", {
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
}

for (const [label, viewport] of [
  ["desktop 1280x800", { width: 1280, height: 800 }],
  ["mobile 390x844", { width: 390, height: 844 }],
] as const) {
  test(`bottom-right HUD corner: no overlap and every control clickable (${label})`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await bootOperatorSession(page);

    // Collapsed — the default operator state the defect was reported in.
    assertCornerIsSane(await probeCorner(page, REGIONS), `${label} collapsed`);

    // Expanding the detail stack is the load case that makes the panel tall: the affordances must
    // still be laid out clear of it and must not be pushed off the top of the viewport. This click is
    // itself the proof the expander is usable — it was unclickable before the fix.
    await page.click("aside.hud .hud-detail-toggle", { timeout: 60_000 });
    await expect(page.locator("aside.hud")).toHaveAttribute(
      "data-hud-expanded",
      "true",
      { timeout: 30_000 },
    );
    await page.waitForTimeout(500);

    assertCornerIsSane(await probeCorner(page, REGIONS), `${label} expanded`);
  });
}
