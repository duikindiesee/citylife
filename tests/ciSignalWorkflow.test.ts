// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CityLife hosted CI signal bounds", () => {
  it("uses a dedicated bounded Vitest CI script before e2e and build gates", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["test:ci"]).toMatch(/run-bounded-vitest/);
    expect(workflow).toContain("run: npm run test:ci");
    expect(workflow).toContain("timeout-minutes: 35");
    expect(workflow).not.toContain("run: npm test");
  });
});