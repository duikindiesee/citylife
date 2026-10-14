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

  describe("WebSocket proxies and Origin preservation", () => {
    it.each(["/kooker/api/v1/citylife/ws", "/api/v1/citylife/ws"])(
      "configures exact WebSocket proxy for %s with Upgrade and sanitized logging",
      (path) => {
        const block = exactLocation(path);
        expect(block).toContain(
          "proxy_pass ${KOOKER_GATEWAY}/api/v1/citylife/ws;",
        );
        expect(block).toContain("proxy_http_version 1.1;");
        expect(block).toContain("proxy_set_header Upgrade $http_upgrade;");
        expect(block).toContain('proxy_set_header Connection "upgrade";');
        expect(block).toContain(
          "access_log /var/log/nginx/access.log sanitized_wss;",
        );
      },
    );

    it("never hardcodes or overwrites Origin header with an allowed constant", () => {
      // Must NOT stamp an allowed constant or override caller Origin
      expect(nginxTemplate).not.toMatch(/proxy_set_header\s+Origin\b/i);
    });
  });

  describe("Server default access logging & safe format", () => {
    it("configures server-level safe_combined access log matching official main format with x-forwarded-for", () => {
      expect(nginxTemplate).toContain("log_format safe_combined");
      expect(nginxTemplate).toContain(
        '"$citylife_log_referer" "$http_user_agent" "$http_x_forwarded_for"',
      );
      expect(nginxTemplate).toContain(
        "access_log /var/log/nginx/access.log safe_combined;",
      );
    });

    it("preserves access_log off on healthz and runtime endpoints", () => {
      const healthzBlock = exactLocation("/healthz");
      expect(healthzBlock).toContain("access_log off;");

      const runtimeBlock = exactLocation("/citylife-runtime.json");
      expect(runtimeBlock).toContain("access_log off;");
    });

    it("declares HTTP-context maps for sensitive socket paths and query-like Referers", () => {
      expect(nginxTemplate).toContain("map $uri $citylife_ws_normalized");
      expect(nginxTemplate).toContain("map $request_uri $citylife_ws_original");
      expect(nginxTemplate).toContain(
        'map "$citylife_ws_normalized$citylife_ws_original" $citylife_ws_log_safe',
      );
      expect(nginxTemplate).toContain(
        "map $citylife_ws_log_safe $citylife_log_request",
      );
      expect(nginxTemplate).toContain(
        "map $http_referer $citylife_log_referer",
      );
    });

    it("verifies map regex logic for socket paths and referer sanitization", () => {
      const wsNormalizedRe = /^\/(?:kooker\/)?api\/v1\/citylife\/ws(?:\/|$)/;
      const wsOriginalRe = /^\/(?:kooker\/)?api\/v1\/citylife\/ws(?:[/?]|$)/;
      const refererSanitizeRe = /(?:\?|%3f)/i;

      // Socket path matches
      expect(wsNormalizedRe.test("/api/v1/citylife/ws")).toBe(true);
      expect(wsNormalizedRe.test("/api/v1/citylife/ws/")).toBe(true);
      expect(wsNormalizedRe.test("/kooker/api/v1/citylife/ws")).toBe(true);
      expect(wsNormalizedRe.test("/kooker/api/v1/citylife/ws/")).toBe(true);

      expect(wsOriginalRe.test("/api/v1/citylife/ws?jwt=secret")).toBe(true);
      expect(wsOriginalRe.test("/api/v1/citylife/ws/?jwt=secret")).toBe(true);
      expect(wsOriginalRe.test("/kooker/api/v1/citylife/ws?token=abc")).toBe(
        true,
      );
      expect(wsOriginalRe.test("/kooker/api/v1/citylife/ws/?token=abc")).toBe(
        true,
      );

      // Unrelated paths do not match
      expect(wsNormalizedRe.test("/ask")).toBe(false);
      expect(wsNormalizedRe.test("/index.html")).toBe(false);
      expect(wsNormalizedRe.test("/assets/app.js")).toBe(false);
      expect(wsOriginalRe.test("/ask?sort=asc")).toBe(false);

      // Referer sanitization
      expect(
        refererSanitizeRe.test(
          "https://citylife.kooker.co.za/api/v1/citylife/ws?jwt=canary",
        ),
      ).toBe(true);
      expect(
        refererSanitizeRe.test(
          "https://citylife.kooker.co.za/api/v1/citylife/ws%3fjwt=canary",
        ),
      ).toBe(true);
      expect(
        refererSanitizeRe.test(
          "https://citylife.kooker.co.za/api/v1/citylife/ws%3Fjwt=canary",
        ),
      ).toBe(true);
      expect(refererSanitizeRe.test("https://citylife.kooker.co.za/home")).toBe(
        false,
      );
      expect(refererSanitizeRe.test("")).toBe(false);
    });
  });
});
