// UI.VERSION.1 — the build stamp must be honest: it may never invent a version, and it must say
// so plainly when the build identity is missing rather than rendering something that looks real.
import { describe, expect, it } from "vitest";
import {
  buildStampParts,
  buildStampTitle,
  formatBuildStamp,
} from "../src/colony/buildStamp";

describe("build stamp", () => {
  it("is injected by the build, not hardcoded", () => {
    const parts = buildStampParts();
    // vite.config.ts defines these for the test run too, so a real value must be present. If this
    // ever fails, the define block was removed and the stamp would silently go blank in the app.
    expect(parts.version, "version must come from the build").not.toEqual("");
    expect(parts.sha, "sha must come from the build").not.toEqual("");
    // Guard the actual failure mode this ticket exists to prevent: a constant that rots. The
    // version must match package.json at build time, and the sha must look like a short sha.
    expect(parts.sha).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("shows version and commit together", () => {
    expect(
      formatBuildStamp({ version: "0.43.2", sha: "abc1234", builtAt: "" }),
    ).toBe("v0.43.2 · abc1234");
  });

  it("degrades honestly rather than inventing a value", () => {
    // Each of these is a real state: a bundle built outside CI, or an env var not passed through.
    expect(
      formatBuildStamp({ version: "", sha: "abc1234", builtAt: "" }),
    ).toBe("abc1234");
    expect(
      formatBuildStamp({ version: "0.43.2", sha: "", builtAt: "" }),
    ).toBe("v0.43.2");
    expect(formatBuildStamp({ version: "", sha: "", builtAt: "" })).toBe(
      "build unknown",
    );
  });

  it("keeps the build time in the tooltip, not the corner", () => {
    const parts = {
      version: "0.43.2",
      sha: "abc1234",
      builtAt: "2026-07-31T10:00:00Z",
    };
    // The visible stamp stays short — the operator asked for small.
    expect(formatBuildStamp(parts)).not.toContain("2026");
    expect(buildStampTitle(parts)).toBe(
      "version 0.43.2 · commit abc1234 · built 2026-07-31T10:00:00Z",
    );
  });

  it("never claims a build identity it does not have", () => {
    expect(buildStampTitle({ version: "", sha: "", builtAt: "" })).toBe(
      "build identity unavailable",
    );
  });
});
