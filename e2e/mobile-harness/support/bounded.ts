import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";

// PLAYER.MOBILE.E2E.1 — shared bounds for the mobile/touch UAT harness. Every navigation,
// selector wait, touch action and screenshot in this harness goes through one of these helpers so
// no Playwright call can ever wait indefinitely. `boundedEvaluate` exists because `page.evaluate`
// itself accepts no timeout option and is NOT covered by Playwright's actionTimeout — an evaluate
// that never resolves (an in-page busy loop or a stuck await) would otherwise hang past the whole
// test timeout. Racing it against a timer means the *test* always terminates on schedule even if
// the underlying CDP call never settles; a follow-up hard process-tree kill (scripts/run-bounded-
// e2e.mjs) is the last-resort backstop for the browser process itself.
export const NAV_TIMEOUT = 20_000;
export const ACTION_TIMEOUT = 10_000;
export const ASSERT_TIMEOUT = 10_000;
export const EVAL_TIMEOUT = 10_000;

export async function boundedEvaluate<T, Arg>(
  page: Page,
  fn: (arg: Arg) => T,
  arg: Arg,
  timeoutMs = EVAL_TIMEOUT,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`boundedEvaluate exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([page.evaluate(fn, arg), bound]);
  } finally {
    clearTimeout(timer!);
  }
}

interface TouchHit {
  hasBox: boolean;
  onTarget: boolean;
  cx: number;
  cy: number;
}

// A real single-finger tap at the control's hit-tested centre, never a synthetic mouse click.
// Takes a Locator (not a raw selector string) so callers can use Playwright-only matchers like
// `{ hasText }`, which native `document.querySelector` cannot parse. Resolving the centre and
// hit-testing it happen in one bounded `Locator.evaluate` — its own `timeout` option (not
// `page.evaluate`'s, which has none) keeps this off the critical path even if a busy WebGL canvas
// starves Playwright's usual actionability sampling.
export async function touchTap(
  page: Page,
  locator: Locator,
  timeoutMs = ACTION_TIMEOUT,
): Promise<void> {
  await expect(locator).toBeVisible({ timeout: timeoutMs });
  const hit = await locator.evaluate<TouchHit, undefined>(
    (target) => {
      target.scrollIntoView({ block: "center", inline: "center" });
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        return { hasBox: false, onTarget: false, cx: 0, cy: 0 };
      }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      const onTarget = !!top && (top === target || target.contains(top));
      return { hasBox: true, onTarget, cx, cy };
    },
    undefined,
    { timeout: timeoutMs },
  );
  const description = (await locator
    .evaluate((el) => el.outerHTML.slice(0, 120), undefined, {
      timeout: timeoutMs,
    })
    .catch(() => "<description unavailable>")) as string;
  expect(hit.hasBox, `${description} should have a layout box`).toBe(true);
  expect(
    hit.onTarget,
    `${description} must be the top-most element at its centre (reachable by touch)`,
  ).toBe(true);
  await page.touchscreen.tap(hit.cx, hit.cy);
}

// Actionable failure evidence: a screenshot plus the outer HTML of the nearest useful root, both
// attached to the Playwright report (not just written to disk) so a hosted run surfaces them
// without needing artifact-path spelunking. Bounded by ASSERT_TIMEOUT like everything else here.
export async function attachFailureEvidence(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  // Attach on any actual failure, including a deliberately-expected one (`test.fail()`): the
  // point is evidence-on-failure, not whether Playwright itself considered the outcome expected.
  if (testInfo.status !== "failed" && testInfo.status !== "timedOut") return;
  const screenshot = await page
    .screenshot({ timeout: ASSERT_TIMEOUT })
    .catch(() => null);
  if (screenshot) {
    await testInfo.attach(`${label}-screenshot`, {
      body: screenshot,
      contentType: "image/png",
    });
  }
  const dom = await boundedEvaluate(
    page,
    () => document.body?.outerHTML?.slice(0, 20_000) ?? "<no body>",
    undefined,
    ASSERT_TIMEOUT,
  ).catch((err: unknown) => `<dom capture failed: ${String(err)}>`);
  await testInfo.attach(`${label}-dom`, {
    body: dom,
    contentType: "text/plain",
  });
}
