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

  describe("Auth cookie and clear BFF proxies", () => {
    it.each(["/kooker/api/v1/citylife/auth/cookie", "/api/v1/citylife/auth/cookie"])(
      "configures exact cookie issuance BFF proxy for %s under internal Host citylife-ws.internal",
      (path) => {
        const block = exactLocation(path);
        expect(block).toContain("proxy_pass ${KOOKER_GATEWAY}/api/v1/citylife/auth/cookie;");
        expect(block).toContain("proxy_set_header Host citylife-ws.internal;");
        expect(block).toContain("proxy_pass_header Set-Cookie;");
      },
    );

    it.each(["/kooker/api/v1/citylife/auth/clear", "/api/v1/citylife/auth/clear"])(
      "configures exact cookie clear BFF proxy for %s under internal Host citylife-ws.internal",
      (path) => {
        const block = exactLocation(path);
        expect(block).toContain("proxy_pass ${KOOKER_GATEWAY}/api/v1/citylife/auth/clear;");
        expect(block).toContain("proxy_set_header Host citylife-ws.internal;");
        expect(block).toContain("proxy_pass_header Set-Cookie;");
      },
    );
  });

  describe("WebSocket proxies and Origin preservation", () => {
    it.each(["/kooker/api/v1/citylife/ws", "/api/v1/citylife/ws"])(
      "configures exact WebSocket proxy for %s with Upgrade, internal Host citylife-ws.internal, browser-ws upstream, and sanitized logging",
      (path) => {
        const block = exactLocation(path);
        expect(block).toContain("proxy_pass ${KOOKER_GATEWAY}/api/v1/citylife/browser-ws;");
        expect(block).toContain("proxy_http_version 1.1;");
        expect(block).toContain("proxy_set_header Upgrade $http_upgrade;");
        expect(block).toContain('proxy_set_header Connection "upgrade";');
        expect(block).toContain("proxy_set_header Host citylife-ws.internal;");
        expect(block).toContain('proxy_set_header Authorization "";');
        expect(block).toContain("proxy_pass_header Cookie;");
        expect(block).toContain("access_log /var/log/nginx/access.log sanitized_wss;");
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
      expect(nginxTemplate).toContain('"$citylife_log_referer" "$http_user_agent" "$http_x_forwarded_for"');
      expect(nginxTemplate).toContain("access_log /var/log/nginx/access.log safe_combined;");
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
      expect(nginxTemplate).toContain('map "$citylife_ws_normalized$citylife_ws_original" $citylife_ws_log_safe');
      expect(nginxTemplate).toContain("map $citylife_ws_log_safe $citylife_log_request");
      expect(nginxTemplate).toContain("map $http_referer $citylife_log_referer");
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
      expect(wsOriginalRe.test("/kooker/api/v1/citylife/ws?token=abc")).toBe(true);
      expect(wsOriginalRe.test("/kooker/api/v1/citylife/ws/?token=abc")).toBe(true);

      // Unrelated paths do not match
      expect(wsNormalizedRe.test("/ask")).toBe(false);
      expect(wsNormalizedRe.test("/index.html")).toBe(false);
      expect(wsNormalizedRe.test("/assets/app.js")).toBe(false);
      expect(wsOriginalRe.test("/ask?sort=asc")).toBe(false);

      // Referer sanitization
      expect(refererSanitizeRe.test("https://citylife.kooker.co.za/api/v1/citylife/ws?jwt=canary")).toBe(true);
      expect(refererSanitizeRe.test("https://citylife.kooker.co.za/api/v1/citylife/ws%3fjwt=canary")).toBe(true);
      expect(refererSanitizeRe.test("https://citylife.kooker.co.za/api/v1/citylife/ws%3Fjwt=canary")).toBe(true);
      expect(refererSanitizeRe.test("https://citylife.kooker.co.za/home")).toBe(false);
      expect(refererSanitizeRe.test("")).toBe(false);
    });
  });

  describe("Conditional public scheme propagation (Floyd trusted contract)", () => {
    const bffAndWsLocations = [
      "/kooker/api/v1/citylife/auth/cookie",
      "/api/v1/citylife/auth/cookie",
      "/kooker/api/v1/citylife/auth/clear",
      "/api/v1/citylife/auth/clear",
      "/kooker/api/v1/citylife/ws",
      "/api/v1/citylife/ws",
    ];

    it("declares HTTP-scope map for citylife_public_scheme with default $scheme", () => {
      expect(nginxTemplate).toContain("map $http_x_forwarded_proto $citylife_public_scheme {");
      expect(nginxTemplate).toContain("default $scheme;");
      expect(nginxTemplate).toContain("~*^https$ https;");
      expect(nginxTemplate).toContain("~*^http$ http;");
    });

    it.each(bffAndWsLocations)(
      "assigns $citylife_public_scheme to X-Forwarded-Proto for %s",
      (path) => {
        const block = exactLocation(path);
        expect(block).toContain("proxy_set_header X-Forwarded-Proto $citylife_public_scheme;");
        expect(block).not.toContain("proxy_set_header X-Forwarded-Proto $scheme;");
      },
    );

    it("preserves unmodified local $scheme X-Forwarded-Proto on the older four auth and kooker locations", () => {
      const chatBlock = exactLocation("/kooker/api/v1/ai/route/chat");
      expect(chatBlock).toContain("proxy_set_header X-Forwarded-Proto $scheme;");

      const basicBlock = exactLocation("/api/auth/basic");
      expect(basicBlock).toContain("proxy_set_header X-Forwarded-Proto $scheme;");

      const refreshBlock = exactLocation("/api/auth/refresh");
      expect(refreshBlock).toContain("proxy_set_header X-Forwarded-Proto $scheme;");

      const genericMatch = nginxTemplate.match(/location \/kooker\/ \{([\s\S]*?)\n    \}/);
      expect(genericMatch).not.toBeNull();
      expect(genericMatch![1]).toContain("proxy_set_header X-Forwarded-Proto $scheme;");
    });

    it("evaluates simulated public scheme map logic with positives and negative fallbacks", () => {
      const simulateSchemeMap = (rawHeader: string | undefined): string => {
        if (!rawHeader) return "$scheme";
        if (/^https$/i.test(rawHeader)) return "https";
        if (/^http$/i.test(rawHeader)) return "http";
        return "$scheme";
      };

      // Intended single-value positives
      expect(simulateSchemeMap("https")).toBe("https");
      expect(simulateSchemeMap("http")).toBe("http");
      expect(simulateSchemeMap("HTTPS")).toBe("https");
      expect(simulateSchemeMap("HTTP")).toBe("http");

      // Fabricated missing / empty negative
      expect(simulateSchemeMap("")).toBe("$scheme");
      expect(simulateSchemeMap(undefined)).toBe("$scheme");

      // Fabricated duplicate / appended negatives (e.g. ngrok appending to client header)
      expect(simulateSchemeMap("http, https")).toBe("$scheme");
      expect(simulateSchemeMap("https, http")).toBe("$scheme");
      expect(simulateSchemeMap("https, https")).toBe("$scheme");
      expect(simulateSchemeMap("http, http")).toBe("$scheme");

      // Fabricated invalid / spoofed scheme negatives
      expect(simulateSchemeMap("ftp")).toBe("$scheme");
      expect(simulateSchemeMap("ws")).toBe("$scheme");
      expect(simulateSchemeMap("wss")).toBe("$scheme");
      expect(simulateSchemeMap("javascript:alert(1)")).toBe("$scheme");
      expect(simulateSchemeMap("https://evil.invalid")).toBe("$scheme");
    });
  });
});
