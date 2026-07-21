import { describe, expect, it } from "vitest";
import {
  CITYLIFE_AMOUNT_LOCALE,
  formatAmount,
} from "../src/colony/ui/currencyFormat";

// Host-locale nondeterminism: a bare toLocaleString() formats in the HOST's locale, so a Windows
// box set to South Africa (en-ZA) renders 1200 as "1<NBSP>200" while the hosted Ubuntu CI baseline
// (en-US) renders "1,200". Same build, different text — which is how playerNeighborhoodHudPrivacy
// started failing on Windows only. These lock the pinned contract so both hosts agree.

describe("CityLife amount display contract", () => {
  it("pins one locale rather than following the host", () => {
    expect(CITYLIFE_AMOUNT_LOCALE).toBe("en-US");
  });

  it("groups with ASCII commas and no decimals", () => {
    expect(formatAmount(1200)).toBe("1,200");
    expect(formatAmount(1_200_000)).toBe("1,200,000");
    expect(formatAmount(999)).toBe("999");
    expect(formatAmount(0)).toBe("0");
  });

  it("agrees with the hosted CI baseline REGARDLESS of the host locale", () => {
    // The real regression check: on an en-ZA host a bare toLocaleString() disagrees with the
    // baseline, and the helper must not. If this ever fails, the helper started following the host.
    const baseline = (1200).toLocaleString("en-US");
    expect(formatAmount(1200)).toBe(baseline);
    const hostBare = (1200).toLocaleString();
    if (hostBare !== baseline) {
      // Running on a host (like en-ZA Windows) that exposes the bug — prove the helper is immune.
      expect(formatAmount(1200)).not.toBe(hostBare);
    }
  });

  it("never emits a non-ASCII separator such as the en-ZA narrow no-break space", () => {
    for (const n of [1200, 1_200_000, 12_345_678]) {
      const out = formatAmount(n);
      // eslint-disable-next-line no-control-regex
      expect(/^[0-9,]+$/.test(out)).toBe(true);
      expect(out).not.toMatch(/[  \s]/);
    }
  });

  it("keeps negatives signed and rounds to whole units", () => {
    expect(formatAmount(-1200)).toBe("-1,200");
    expect(formatAmount(1200.4)).toBe("1,200");
    expect(formatAmount(1200.6)).toBe("1,201");
  });

  it("renders non-finite input as 0 instead of leaking NaN into the HUD", () => {
    expect(formatAmount(Number.NaN)).toBe("0");
    expect(formatAmount(Number.POSITIVE_INFINITY)).toBe("0");
  });
});
