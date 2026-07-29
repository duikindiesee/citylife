import { test, expect } from "@playwright/test";

// UI.GEO.OVERLAP.1 — the bottom-LEFT corner of the HUD must have exactly ONE layout owner, the same
// property PR #421 established for the bottom-right.
//
// The defect: the BUG.GEO.1 presence readout (`.geo-readout`, `position: absolute; left: 16px;
// bottom: 24px; z-index: 6`) and the rally "who is here" card (`.rally-social-read`,
// `position: fixed; left: 18px; bottom: 24px; z-index: 49`) each pinned THEMSELVES into that corner.
// Both are bottom-anchored from the same edge, so the rally card landed wholly inside the readout's
// box and its higher z-index painted it over the readout's last rows — including the reproducibility
// stamp ("seed … · sol …"), which is the one line that makes a shared screenshot self-locating.
//
// This test is built to DISCRIMINATE, which is why it does what a screenshot or a hardcoded-pixel
// assertion cannot:
//   1. it reads the ACTUAL laid-out rects (getBoundingClientRect) and asserts pairwise intersection
//      area is exactly zero — no magic numbers, so it survives copy, font and record-count changes;
//   2. it hit-tests the CENTRE of each region with document.elementFromPoint and requires that region
//      to answer. The readout is deliberately `pointer-events: none` (the world must stay draggable
//      through it), so hit-testing it means momentarily lifting that ONE property: `pointer-events`
//      changes whether an element participates in hit-testing, never its paint order, so the answer
//      is a faithful reading of what is painted on top at that pixel. Restored immediately after.
//   3. it injects a `.modal-overlay` (z-index 30) and hit-tests again. This is the trap #421 measured:
//      making the rail `position: fixed` or giving it any `z-index` turns it into a stacking context
//      and FUSES its members into one layer. The two members legitimately sit on opposite sides of
//      the modal — the rally card (49) above it, the readout (6) below it — so a fused rail creates a
//      new defect in whichever direction it fuses. Both directions are asserted.
// It is two-sided: nothing may overlap AND nothing may be pushed off-screen, collapsed, clipped
// inside its own scroll box, or shoved up into the bus mini-map that owns the TOP-left — otherwise
// "fix the overlap by moving the readout somewhere else" would pass.
//
// Verified to fail against the pre-fix layout — see the PR: at BOTH 1280x800 and 390x844 the readout
// and the rally card intersected by 15161px^2 (the card's entire 190x80 box), the stamp and the card
// by 6516px^2 / 5447px^2, and the stamp's centre hit-test returned `span.rally-social-read__status`.
//
// SCOPE — measured and deliberately NOT covered: in first person the rally card unmounts, so this
// defect cannot occur, but the touch joystick takes the bottom-left and buries the readout instead
// (34532px^2 desktop / 39324px^2 mobile). That is a different owner (the first-person edge-HUD grid)
// and the readout does not fit the free band it leaves; folding it in was measured to relocate the
// collision onto the bus mini-map. It is reported separately. The one thing this test does assert in
// first person is that the rail behaves correctly with a SINGLE member (the rally-point-inactive
// shape): still on-screen, not collapsed, not clipped.

type Region = { name: string; sel: string };

// Every region that shares the bottom-left corner in a default session, plus the bus mini-map, which
// owns the TOP-left and is the upward boundary the rail may never cross.
const REGIONS: Region[] = [
  { name: "presence readout", sel: ".geo-readout" },
  { name: "presence stamp", sel: '[data-testid="geo-readout-stamp"]' },
  { name: "rally card", sel: ".rally-social-read" },
  { name: "bus mini-map", sel: ".bus-network-minimap" },
];

// The stamp is a child of the readout, so of course they intersect. Every other pair must not.
const NESTED = new Set(["presence readout|presence stamp"]);

type Measured = {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  bottom: number;
  reachable: boolean;
  blockedBy: string | null;
  clippedBy: number;
};

type Probe = {
  viewport: { w: number; h: number };
  missing: string[];
  measured: Measured[];
};

const PROBE_FN = (regions: Region[]) => {
  const describe = (el: Element | null): string | null => {
    if (!el) return null;
    const cls = (el.className || "").toString().split(" ")[0];
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`;
  };
  // Momentarily let every probed region answer a hit test. Several of them (the presence readout,
  // the bus mini-map) are deliberately `pointer-events: none` so the world stays draggable through
  // them, and a click-based probe could never see them. Lifting exactly that one property changes
  // hit-test PARTICIPATION only — never paint order — so what comes back is a faithful reading of
  // what is painted on top at that pixel. Restored in the `finally` below.
  const lifted: { el: HTMLElement; prev: string }[] = [];
  for (const r of regions) {
    const el = document.querySelector(r.sel) as HTMLElement | null;
    if (el && getComputedStyle(el).pointerEvents === "none") {
      lifted.push({ el, prev: el.style.pointerEvents });
      el.style.pointerEvents = "auto";
    }
  }
  try {
    const missing: string[] = [];
    const measured: Measured[] = [];
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
      // Reachable means the pixel at this region's visual centre belongs to this region (or to one
      // of its own children) — not to some sibling painted over it.
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
        // Content hidden inside the element's own scroll box: a `max-height` safe area that is too
        // tight would silently swallow presence rows instead of overlapping them.
        clippedBy: Math.max(0, el.scrollHeight - el.clientHeight),
      });
    }
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      missing,
      measured,
    };
  } finally {
    for (const { el, prev } of lifted) el.style.pointerEvents = prev;
  }
};

async function probeCorner(
  page: import("@playwright/test").Page,
  regions: Region[],
): Promise<Probe> {
  return await page.evaluate(PROBE_FN, regions);
}

function intersectionArea(a: Measured, b: Measured): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= x || bottom <= y) return 0;
  return (right - x) * (bottom - y);
}

function assertCornerIsSane(probe: Probe, where: string): void {
  // Guard against a vacuous pass: with a region missing there is nothing to collide with and every
  // assertion below would hold trivially.
  expect(
    probe.missing,
    `${where}: every bottom-left region must be present, otherwise this test proves nothing`,
  ).toEqual([]);

  // (1) No two regions may share a single pixel.
  const overlaps: string[] = [];
  for (let i = 0; i < probe.measured.length; i++) {
    for (let j = i + 1; j < probe.measured.length; j++) {
      const a = probe.measured[i];
      const b = probe.measured[j];
      if (
        NESTED.has(`${a.name}|${b.name}`) ||
        NESTED.has(`${b.name}|${a.name}`)
      )
        continue;
      const area = intersectionArea(a, b);
      if (area > 0)
        overlaps.push(`${a.name} x ${b.name} = ${Math.round(area)}px^2`);
    }
  }
  expect(overlaps, `${where}: bottom-left regions must not intersect`).toEqual(
    [],
  );

  // (2) Every region must own the pixel at its own centre.
  const unreachable = probe.measured
    .filter((m) => !m.reachable)
    .map((m) => `${m.name} (centre pixel belongs to ${m.blockedBy})`);
  expect(
    unreachable,
    `${where}: every bottom-left region must own its centre pixel`,
  ).toEqual([]);

  // (3) Two-sided: de-conflicting the corner may not collapse, clip or evict anything.
  const broken = probe.measured
    .filter(
      (m) =>
        m.w < 1 ||
        m.h < 1 ||
        m.x < 0 ||
        m.y < 0 ||
        m.right > probe.viewport.w + 0.5 ||
        m.bottom > probe.viewport.h + 0.5 ||
        m.clippedBy > 1,
    )
    .map(
      (m) =>
        `${m.name} [${Math.round(m.x)},${Math.round(m.y)} ${Math.round(m.w)}x${Math.round(m.h)}]${
          m.clippedBy > 1 ? ` clipped by ${Math.round(m.clippedBy)}px` : ""
        }`,
    );
  expect(
    broken,
    `${where}: nothing may be collapsed, clipped or pushed off the ${probe.viewport.w}x${probe.viewport.h} viewport`,
  ).toEqual([]);
}

/**
 * The #421 stacking trap, measured rather than assumed. A modal overlay sits at z-index 30, between
 * the readout (6) and the rally card (49). If the rail ever became a stacking context — via
 * `position: fixed` or any `z-index` — its members would fuse onto one layer and one of these two
 * facts would flip.
 */
async function assertLayersNotFused(
  page: import("@playwright/test").Page,
  where: string,
): Promise<void> {
  const result = await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.setAttribute("data-testid", "stacking-probe-overlay");
    (document.querySelector(".colony") ?? document.body).appendChild(overlay);
    const describe = (el: Element | null): string | null => {
      if (!el) return null;
      const cls = (el.className || "").toString().split(" ")[0];
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`;
    };
    // "Own" = the centre pixel belongs to this element or to one of its own children, which is what
    // makes the answer robust to the card's centre landing on its own <b> summary line.
    const owns = (el: Element | null): { own: boolean; hit: string | null } => {
      if (!el) return { own: false, hit: null };
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return {
        own: !!hit && (hit === el || el.contains(hit)),
        hit: describe(hit),
      };
    };
    const readout = document.querySelector(
      ".geo-readout",
    ) as HTMLElement | null;
    const restore = readout?.style.pointerEvents ?? "";
    if (readout) readout.style.pointerEvents = "auto";
    try {
      return {
        readout: owns(readout),
        rally: owns(document.querySelector(".rally-social-read")),
      };
    } finally {
      if (readout) readout.style.pointerEvents = restore;
      overlay.remove();
    }
  });

  // The rally card must stay ABOVE the modal overlay, exactly as it did when it positioned itself.
  expect(
    result.rally.own,
    `${where}: the rally card (z-index 49) must stay above a .modal-overlay (30) — a rail that became a stacking context would drop it under one; its centre pixel belonged to ${result.rally.hit}`,
  ).toBe(true);
  // And the readout must stay BELOW it: a status readout painting over an open modal is the same
  // bug in the opposite direction.
  expect(
    result.readout.hit,
    `${where}: the presence readout (z-index 6) must stay below a .modal-overlay (30) — a rail that became a stacking context would lift it over one`,
  ).toBe("div.modal-overlay");
  expect(
    result.readout.own,
    `${where}: the presence readout must NOT own its centre pixel while a modal overlay is up`,
  ).toBe(false);
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
  await page.waitForSelector(".geo-readout", { timeout: 30_000 });
  await page.waitForSelector(".rally-social-read", { timeout: 30_000 });
  await page.waitForTimeout(1500);
}

/** Clamp the presence RECORD list, the load case the corner's occupancy varies with. */
async function setPresenceRecordCount(
  page: import("@playwright/test").Page,
  count: number | null,
): Promise<void> {
  await page.evaluate((count) => {
    const rt = window.__colony as unknown as {
      presenceRecords: () => unknown[];
      __allPresenceRecords?: () => unknown[];
    };
    if (!rt.__allPresenceRecords)
      rt.__allPresenceRecords = rt.presenceRecords.bind(rt);
    const all = rt.__allPresenceRecords;
    rt.presenceRecords =
      count === null ? all : () => all().slice(0, count as number);
  }, count);
  await page.waitForTimeout(700);
}

for (const [label, viewport] of [
  ["desktop 1280x800", { width: 1280, height: 800 }],
  ["mobile 390x844", { width: 390, height: 844 }],
] as const) {
  test(`bottom-left HUD corner: presence readout and rally card never overlap (${label})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await bootSession(page);

    // The default live state — the one the operator screenshotted.
    assertCornerIsSane(await probeCorner(page, REGIONS), `${label} default`);
    await assertLayersNotFused(page, `${label} default`);

    // The MINIMAL trigger: a single presence record is already enough, because the collision comes
    // from two bottom-anchored occupants, not from a long list. Sweeping the record count keeps the
    // corner honest as the roster grows and shrinks.
    for (const count of [1, 2, 3]) {
      await setPresenceRecordCount(page, count);
      expect(
        await page.locator(".geo-readout__marker").count(),
        `${label}: the readout must actually render ${count} marker(s)`,
      ).toBe(count);
      assertCornerIsSane(
        await probeCorner(page, REGIONS),
        `${label} ${count} presence record(s)`,
      );
    }
    await setPresenceRecordCount(page, null);

    // Operator view resolves step-in subjects EXACTLY, so every marker gains grid/world/yaw rows and
    // the readout grows — the tallest state the corner has to hold.
    await page.evaluate(() =>
      (
        window.__colony as unknown as { setPlayerView: (v: boolean) => void }
      ).setPlayerView(false),
    );
    await page.waitForTimeout(1000);
    assertCornerIsSane(
      await probeCorner(page, REGIONS),
      `${label} operator view`,
    );
    await assertLayersNotFused(page, `${label} operator view`);

    await page.screenshot({
      path: testInfo.outputPath(`geo-corner-${viewport.width}.png`),
    });
  });
}

test("bottom-left rail with a single member stays on-screen and unclipped (rally point inactive)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await bootSession(page);

  // Stepping into a citizen unmounts the rally card, which is the rally-point-inactive shape of the
  // corner: the rail is left holding exactly one member. A rail that only looks right when it is
  // full is not a layout owner.
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
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="hud-corner-rail-left"]');
    const readout = document.querySelector(".geo-readout");
    if (!rail || !readout) return null;
    const r = readout.getBoundingClientRect();
    return {
      railMembers: rail.childElementCount,
      rallyPresent: !!document.querySelector(".rally-social-read"),
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      right: r.right,
      bottom: r.bottom,
      clippedBy: Math.max(0, readout.scrollHeight - readout.clientHeight),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  expect(state, "the rail and the readout must both be mounted").not.toBeNull();
  expect(state!.rallyPresent).toBe(false);
  expect(state!.railMembers, "exactly one member left in the rail").toBe(1);
  // NOTE: this deliberately does NOT assert non-overlap. In first person the touch joystick is a
  // separate, measured collision with a different owner — see the header comment. What is asserted
  // is that the rail itself degrades correctly to one member.
  expect(state!.w).toBeGreaterThan(1);
  expect(state!.h).toBeGreaterThan(1);
  expect(state!.x).toBeGreaterThanOrEqual(0);
  expect(state!.y).toBeGreaterThanOrEqual(0);
  expect(state!.right).toBeLessThanOrEqual(state!.vw + 0.5);
  expect(state!.bottom).toBeLessThanOrEqual(state!.vh + 0.5);
  expect(
    state!.clippedBy,
    "the readout must not be clipped by the safe area",
  ).toBeLessThanOrEqual(1);
});

// ================================================================================================
// UI.GEO.OVERLAP.1 follow-up — the stamp must never leave the readout's scroll box
// ================================================================================================

/**
 * A reviewer measured 948.14px^2 of stamp-versus-card intersection on a machine where the rail sat
 * exactly at its 540px cap (0 slack) while this one had 36px of slack and reported 0. The difference
 * was never the machine: it was whether the rail is CAPPED. Capped, the readout shrinks and scrolls,
 * and the stamp — the last child of the scroll container — falls below the readout's visible edge.
 *
 * So this drives the failing state DETERMINISTICALLY instead of waiting for font metrics to produce
 * it: `.hud-corner-rail-left` is `max-height: calc(100vh - 260px)`, so a short viewport caps the rail
 * on any machine. That is the whole point — a test that only fails on someone else's box is not a
 * regression test.
 */
test("the reproducibility stamp stays inside the readout when the rail is CAPPED", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Tall enough to be a real session, short enough that calc(100vh - 260px) bites.
  await page.setViewportSize({ width: 1280, height: 660 });
  await bootSession(page);
  await page.evaluate(() =>
    (
      window.__colony as unknown as { setPlayerView: (v: boolean) => void }
    ).setPlayerView(false),
  );
  await page.waitForTimeout(1000);

  const m = await page.evaluate(() => {
    const q = (s: string) => document.querySelector(s) as HTMLElement | null;
    const readout = q(".geo-readout");
    const stamp = q('[data-testid="geo-readout-stamp"]');
    const card = q(".rally-social-read");
    const rail = q(".hud-corner-rail-left");
    if (!readout || !stamp || !card || !rail) return null;
    const rb = readout.getBoundingClientRect();
    const sb = stamp.getBoundingClientRect();
    const cb = card.getBoundingClientRect();
    const area = (a: DOMRect, b: DOMRect) =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return {
      railCapped:
        rail.getBoundingClientRect().height + 0.5 >=
        parseFloat(getComputedStyle(rail).maxHeight),
      readoutScrolls: readout.scrollHeight > readout.clientHeight,
      stampBelowReadoutBottom: sb.bottom - rb.bottom,
      stampVsCard: area(sb, cb),
      readoutVsCard: area(rb, cb),
      stampVisibleHeight: Math.max(
        0,
        Math.min(sb.bottom, rb.bottom) - Math.max(sb.top, rb.top),
      ),
      stampHeight: sb.height,
    };
  });

  expect(m, "the corner's occupants must all be present").not.toBeNull();

  // Guard: if the rail is NOT capped we are not testing anything. Fail loudly rather than pass
  // vacuously — a green run that never entered the failing state is exactly the trap this whole
  // investigation started from.
  expect(
    m!.railCapped && m!.readoutScrolls,
    `precondition not met — rail capped: ${m!.railCapped}, readout scrolls: ${m!.readoutScrolls}. ` +
      `Shorten the viewport until calc(100vh - 260px) forces the readout to scroll.`,
  ).toBe(true);

  // THE FIX: pinned to the bottom of the scroll box, the stamp can never fall below the readout.
  expect(
    m!.stampBelowReadoutBottom,
    `the stamp escaped the readout's visible box by ${m!.stampBelowReadoutBottom}px`,
  ).toBeLessThanOrEqual(0.5);

  // ...and it must be WHOLLY visible, not merely non-overlapping. A stamp clipped to a sliver is
  // still an unreadable revision hash, which is the defect the reviewer's numbers actually exposed.
  expect(
    m!.stampVisibleHeight,
    "the whole stamp must be readable, not clipped to a sliver",
  ).toBeGreaterThan(m!.stampHeight - 0.5);

  // The number the reviewer measured at 948.14px^2.
  expect(m!.stampVsCard, "stamp must not overlap the rally card").toBe(0);
  expect(m!.readoutVsCard, "readout must not overlap the rally card").toBe(0);
});
