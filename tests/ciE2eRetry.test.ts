// CI.E2E.RETRY.1 — the e2e suite retries once on CI and never locally.
//
// Both halves are load-bearing and pull in OPPOSITE directions, which is the whole reason to pin them:
// a later "tidy-up" that sets a single constant satisfies one and breaks the other.
//
//   on CI    1 retry, so a contention timeout on the single shared GPU runner self-heals instead of
//            costing a human a rerun and another 24 minutes of queue (see the note in
//            playwright.config.ts for the three-failures-three-different-victims evidence).
//   locally  0, so a developer on a quiet machine SEES a flake rather than having it hidden.
//
// More than one retry would start masking genuine breakage, so the CI value is asserted exactly.
import { afterEach, describe, expect, it, vi } from "vitest";

const CONFIG_MODULE = "../playwright.config";

/** Load playwright.config.ts with CI set or cleared, and read back what it decided. */
async function retriesWithCi(ci: string | undefined): Promise<unknown> {
  vi.stubEnv("CI", ci as string);
  // The config reads the environment at MODULE EVALUATION time, so the module cache must be dropped
  // between the two cases or the second import silently returns the first one's answer.
  vi.resetModules();
  // Imported through a variable specifier ON PURPOSE. tsconfig.json includes only `src` and `tests`,
  // so the playwright/vite configs are outside the typecheck program and use node globals (`process`)
  // that this project's lib set does not declare. A literal specifier would pull the config into
  // `tsc --noEmit` and fail the build on `Cannot find name 'process'` — a typing accident, not a
  // defect in either file. Vitest resolves this at runtime exactly the same way.
  const mod = await import(CONFIG_MODULE);
  return (mod.default as { retries?: unknown }).retries;
}

describe("CI.E2E.RETRY.1", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("retries exactly once when CI is set", async () => {
    await expect(retriesWithCi("true")).resolves.toBe(1);
  });

  it("does not retry at all off CI, so a local flake stays visible", async () => {
    await expect(retriesWithCi(undefined)).resolves.toBe(0);
  });

  it("the two differ — a single hardcoded value cannot satisfy both", async () => {
    const onCi = await retriesWithCi("1");
    const local = await retriesWithCi(undefined);
    expect(onCi).not.toBe(local);
  });
});
