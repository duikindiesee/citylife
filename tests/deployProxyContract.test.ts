import { describe, expect, it } from "vitest";
import nginxTemplate from "../docker/default.conf.template?raw";

function exactLocation(path: string): string {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = nginxTemplate.match(
    new RegExp(`location = ${escaped} \\{([\\s\\S]*?)\\n    \\}`),
  );
  expect(match, `missing exact nginx location for ${path}`).not.toBeNull();
  return match![1];
}

describe("production gateway proxy contract", () => {
  it("keeps the canonical /kooker gateway proxy", () => {
    expect(nginxTemplate).toContain("location /kooker/ {");
    expect(nginxTemplate).toContain("proxy_pass ${KOOKER_GATEWAY}/;");
  });

  it.each(["basic", "refresh"])(
    "proxies a legacy bare %s auth request instead of serving the SPA",
    (operation) => {
      const path = `/api/auth/${operation}`;
      const block = exactLocation(path);
      expect(block).toContain(`proxy_pass ${"${KOOKER_GATEWAY}"}${path};`);
      expect(block).toContain("proxy_set_header Host ${KOOKER_HOST};");
    },
  );

  it("does not expose the rest of /api as a second gateway surface", () => {
    expect(nginxTemplate).not.toMatch(/location\s+(?:\^~\s+)?\/api\/?\s*\{/);
  });
});
