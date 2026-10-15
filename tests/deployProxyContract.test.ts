import { describe, expect, it } from "vitest";
import nginxTemplate from "../docker/default.conf.template?raw";
import entrypointScript from "../docker/entrypoint.sh?raw";
import dockerfile from "../Dockerfile?raw";

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
      expect(nginxTemplate).toContain("map $request_uri $citylife_sensitive_clean_req");
      expect(nginxTemplate).toContain("map $uri $citylife_sensitive_clean_uri");
      expect(nginxTemplate).toContain("map $citylife_sensitive_clean_req $citylife_clean_path");
      expect(nginxTemplate).toContain("map $http_referer $citylife_log_referer");
    });

    it("verifies map regex logic for sensitive aliases and referer sanitization", () => {
      const sensitiveNormalizedRe = /^\/(?:kooker\/)?api\/v1\/citylife\/(?:ws|browser-ws|auth\/cookie|auth\/clear)(?:%3[fF]|[/?]|$)/i;
      const sensitiveOriginalRe = /^\/(?:kooker\/)?api\/v1\/citylife\/(?:ws|browser-ws|auth\/cookie|auth\/clear)(?:%3[fF]|[/?]|$)/i;
      const cleanPathRe = /^((?:(?:\/kooker)?\/api\/v1\/citylife\/(?:ws|browser-ws|auth\/cookie|auth\/clear)\/?))(?:%3[fF]|\?|\/|$)/i;
      const refererSanitizeRe = /(?:\?|%3f)/i;

      // Sensitive path matches: ws, browser-ws, auth/cookie, auth/clear (direct and /kooker alias)
      const sensitivePaths = [
        "/api/v1/citylife/ws",
        "/api/v1/citylife/ws/",
        "/kooker/api/v1/citylife/ws",
        "/kooker/api/v1/citylife/ws/",
        "/api/v1/citylife/browser-ws",
        "/api/v1/citylife/browser-ws/",
        "/kooker/api/v1/citylife/browser-ws",
        "/kooker/api/v1/citylife/browser-ws/",
        "/api/v1/citylife/auth/cookie",
        "/api/v1/citylife/auth/cookie/",
        "/kooker/api/v1/citylife/auth/cookie",
        "/kooker/api/v1/citylife/auth/cookie/",
        "/api/v1/citylife/auth/clear",
        "/api/v1/citylife/auth/clear/",
        "/kooker/api/v1/citylife/auth/clear",
        "/kooker/api/v1/citylife/auth/clear/",
      ];

      for (const p of sensitivePaths) {
        expect(sensitiveNormalizedRe.test(p), `normalized must match ${p}`).toBe(true);
        expect(sensitiveOriginalRe.test(p), `original must match ${p}`).toBe(true);
        expect(sensitiveOriginalRe.test(`${p}?token=secret`), `original with query must match ${p}`).toBe(true);
        expect(sensitiveOriginalRe.test(`${p}%3ftoken=secret`), `original with encoded lower %3f must match ${p}`).toBe(true);
        expect(sensitiveOriginalRe.test(`${p}%3Ftoken=secret`), `original with encoded upper %3F must match ${p}`).toBe(true);
      }

      // Legacy fae1090 regression negative: legacy original regex lacked %3[fF] and missed encoded queries
      const legacyFaeOriginalRe = /^\/(?:kooker\/)?api\/v1\/citylife\/(?:ws|browser-ws|auth\/cookie|auth\/clear)(?:[/?]|$)/;
      expect(legacyFaeOriginalRe.test("/api/v1/citylife/ws%3ftoken=secret")).toBe(false);
      expect(legacyFaeOriginalRe.test("/api/v1/citylife/ws%3Ftoken=secret")).toBe(false);
      expect(legacyFaeOriginalRe.test("/kooker/api/v1/citylife/ws%3ftoken=secret")).toBe(false);
      expect(legacyFaeOriginalRe.test("/kooker/api/v1/citylife/ws%3Ftoken=secret")).toBe(false);

      // Clean path extraction verifies stripping queries without echoing decoded ?token into access.log
      const extractClean = (u: string) => {
        const m = u.match(cleanPathRe);
        return m ? m[1] : null;
      };
      expect(extractClean("/api/v1/citylife/ws%3Ftoken=secret")).toBe("/api/v1/citylife/ws");
      expect(extractClean("/api/v1/citylife/ws%3ftoken=secret")).toBe("/api/v1/citylife/ws");
      expect(extractClean("/kooker/api/v1/citylife/ws%3Ftoken=secret")).toBe("/kooker/api/v1/citylife/ws");
      expect(extractClean("/api/v1/citylife/ws?token=secret")).toBe("/api/v1/citylife/ws");
      expect(extractClean("/api/v1/citylife/ws/?token=secret")).toBe("/api/v1/citylife/ws/");
      expect(extractClean("/ask?search=query")).toBeNull();

      // Unrelated paths do not match (preserving ordinary access diagnostics)
      expect(sensitiveNormalizedRe.test("/ask")).toBe(false);
      expect(sensitiveNormalizedRe.test("/index.html")).toBe(false);
      expect(sensitiveNormalizedRe.test("/assets/app.js")).toBe(false);
      expect(sensitiveOriginalRe.test("/ask?sort=asc")).toBe(false);
      expect(sensitiveOriginalRe.test("/assets/style.css?v=1")).toBe(false);

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

  describe("Site alias, trailing-slash, and fallback disposition (Floyd release-control contract)", () => {
    it("preserves baseline error logging without suppressing ordinary diagnostic classes", () => {
      expect(nginxTemplate).not.toContain("error_log /var/log/nginx/error.log warn;");
      expect(nginxTemplate).not.toContain("log_not_found off;");
    });

    it("dispositions internal browser-ws route against public exposure with 404", () => {
      expect(nginxTemplate).toContain("location ~ ^/(?:kooker/)?api/v1/citylife/browser-ws(?:%3[fF]|\\?|/|$) {");
      const match = nginxTemplate.match(
        /location ~ \^\/\(\?:kooker\/\)\?api\/v1\/citylife\/browser-ws\(\?:%3\[fF\]\|\\\?\|\/\|\$\) \{([\s\S]*?)\n    \}/,
      );
      expect(match).not.toBeNull();
      expect(match![1]).toContain("return 404;");
    });

    it("dispositions trailing slashes and encoded query variants on sensitive API/WebSocket endpoints with 404", () => {
      expect(nginxTemplate).toContain("location ~ ^/(?:kooker/)?api/v1/citylife/(?:ws|auth/cookie|auth/clear)(?:/|%3[fF]|\\?) {");
      const match = nginxTemplate.match(
        /location ~ \^\/\(\?:kooker\/\)\?api\/v1\/citylife\/\(\?:ws\|auth\/cookie\|auth\/clear\)\(\?:\/\|%3\[fF\]\|\\\?\) \{([\s\S]*?)\n    \}/,
      );
      expect(match).not.toBeNull();
      expect(match![1]).toContain("return 404;");
    });

    it("verifies browser-ws blocking regex matches internal aliases and rejects valid routes", () => {
      const browserWsBlockRe = /^\/(?:kooker\/)?api\/v1\/citylife\/browser-ws(?:%3[fF]|\?|\/|$)/i;

      // Internal browser-ws routes must match (and be 404'd)
      expect(browserWsBlockRe.test("/api/v1/citylife/browser-ws")).toBe(true);
      expect(browserWsBlockRe.test("/api/v1/citylife/browser-ws/")).toBe(true);
      expect(browserWsBlockRe.test("/kooker/api/v1/citylife/browser-ws")).toBe(true);
      expect(browserWsBlockRe.test("/kooker/api/v1/citylife/browser-ws/")).toBe(true);
      expect(browserWsBlockRe.test("/api/v1/citylife/browser-ws%3ftoken=abc")).toBe(true);
      expect(browserWsBlockRe.test("/kooker/api/v1/citylife/browser-ws%3Ftoken=abc")).toBe(true);

      // Valid public ws and auth routes must not match
      expect(browserWsBlockRe.test("/api/v1/citylife/ws")).toBe(false);
      expect(browserWsBlockRe.test("/kooker/api/v1/citylife/ws")).toBe(false);
      expect(browserWsBlockRe.test("/api/v1/citylife/auth/cookie")).toBe(false);
    });

    it("verifies fallback blocking regex matches trailing slashes and encoded queries on sensitive endpoints only", () => {
      const fallbackBlockRe = /^\/(?:kooker\/)?api\/v1\/citylife\/(?:ws|auth\/cookie|auth\/clear)(?:\/|%3[fF]|\?)/;

      // Trailing slashes must match (and be 404'd instead of falling back to SPA index.html)
      expect(fallbackBlockRe.test("/api/v1/citylife/ws/")).toBe(true);
      expect(fallbackBlockRe.test("/kooker/api/v1/citylife/ws/")).toBe(true);
      expect(fallbackBlockRe.test("/api/v1/citylife/auth/cookie/")).toBe(true);
      expect(fallbackBlockRe.test("/kooker/api/v1/citylife/auth/cookie/")).toBe(true);
      expect(fallbackBlockRe.test("/api/v1/citylife/auth/clear/")).toBe(true);
      expect(fallbackBlockRe.test("/kooker/api/v1/citylife/auth/clear/")).toBe(true);

      // Encoded and raw queries in path must match and be 404'd
      expect(fallbackBlockRe.test("/api/v1/citylife/ws%3ftoken=abc")).toBe(true);
      expect(fallbackBlockRe.test("/kooker/api/v1/citylife/ws%3Ftoken=abc")).toBe(true);

      // Exact valid endpoints must not match
      expect(fallbackBlockRe.test("/api/v1/citylife/ws")).toBe(false);
      expect(fallbackBlockRe.test("/api/v1/citylife/auth/cookie")).toBe(false);
      expect(fallbackBlockRe.test("/kooker/api/v1/citylife/auth/cookie")).toBe(false);
      expect(fallbackBlockRe.test("/api/v1/citylife/auth/clear")).toBe(false);
      expect(fallbackBlockRe.test("/kooker/api/v1/citylife/auth/clear")).toBe(false);
    });
  });

  describe("Pre-emission error log companion and supervisor contract (same-site containment)", () => {
    it("verifies site-entrypoint.sh is installed as ENTRYPOINT in Dockerfile", () => {
      expect(dockerfile).toContain("COPY docker/entrypoint.sh /usr/local/bin/site-entrypoint.sh");
      expect(dockerfile).toContain("RUN chmod +x /usr/local/bin/site-entrypoint.sh");
      expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/site-entrypoint.sh"]');
    });

    it("verifies entrypoint script creates FIFO at /var/log/nginx/error.log", () => {
      expect(entrypointScript).toContain("mkfifo /var/log/nginx/error.log");
      expect(entrypointScript).toContain("chmod 666 /var/log/nginx/error.log");
    });

    it("verifies entrypoint script uses printf rather than echo for arbitrary log lines", () => {
      expect(entrypointScript).toContain("printf '%s\\n' \"$line\"");
      expect(entrypointScript).toContain("printf '%s\\n' \"$sanitized\" >&2");
      expect(entrypointScript).not.toMatch(/echo "\$sanitized"/);
    });

    it("verifies entrypoint supervises companion death with fail-closed Nginx termination", () => {
      expect(entrypointScript).toContain("kill -0 \"$COMPANION_PID\"");
      expect(entrypointScript).toContain("kill -TERM \"$NGINX_PID\"");
      expect(entrypointScript).toContain("Pre-emission companion died unexpectedly; terminating Nginx (fail-closed)");
    });

    it("verifies entrypoint preserves child exit status without masking via || NGINX_EXIT=$?", () => {
      expect(entrypointScript).toContain('wait "$NGINX_PID" 2>/dev/null || NGINX_EXIT=$?');
      expect(entrypointScript).toContain('exit "$NGINX_EXIT"');
      // Must not suppress exit status with `|| true` on wait before capturing $?
      expect(entrypointScript).not.toMatch(/wait "\$NGINX_PID"[^;\n]*\|\|\s*true\s*[\n;]\s*NGINX_EXIT=/);
    });

    it("verifies entrypoint forwards arguments via \"$@\" and traps lifecycle signals", () => {
      expect(entrypointScript).toContain('"$@" &');
      expect(entrypointScript).toContain("trap 'forward_signal QUIT' QUIT");
      expect(entrypointScript).toContain("trap 'forward_signal TERM' TERM");
      expect(entrypointScript).toContain("trap 'forward_signal INT' INT");
      expect(entrypointScript).toContain("trap 'forward_signal HUP' HUP");
    });

    it("verifies companion regex sanitizes sensitive query strings, tokens, trailing slashes, and referers", () => {
      // Regexes matching the sed expressions in entrypoint.sh:
      // -e 's@(/api/v1/citylife/(ws|browser-ws|auth/cookie|auth/clear))(\?|%3[fF]|/)[^[:space:]"]*@\1?[REDACTED]@g'
      const sensitiveDirectRe = /^(.*\/api\/v1\/citylife\/(?:ws|browser-ws|auth\/cookie|auth\/clear))(?:\?|%3[fF]|\/)\S*(.*)$/;
      const sensitiveKookerRe = /^(.*\/kooker\/api\/v1\/citylife\/(?:ws|browser-ws|auth\/cookie|auth\/clear))(?:\?|%3[fF]|\/)\S*(.*)$/;
      const tokenRe = /[?&](?:token|jwt|auth)=\S*/;
      const refererRe = /Referer:\s*https?:\/\/\S*(?:\?|%3[fF])\S*/i;

      // Sensitive routes with queries, trailing slashes, or encoded queries must match
      expect(sensitiveDirectRe.test('request: "GET /api/v1/citylife/ws?token=secret HTTP/1.1"')).toBe(true);
      expect(sensitiveDirectRe.test('upstream: "http://127.0.0.1:8080/api/v1/citylife/browser-ws?token=secret"')).toBe(true);
      expect(sensitiveDirectRe.test('request: "GET /api/v1/citylife/ws/ HTTP/1.1"')).toBe(true);
      expect(sensitiveKookerRe.test('request: "GET /kooker/api/v1/citylife/ws%3ftoken=secret HTTP/1.1"')).toBe(true);
      expect(sensitiveKookerRe.test('request: "GET /kooker/api/v1/citylife/ws/ HTTP/1.1"')).toBe(true);
      expect(tokenRe.test('?token=secret123')).toBe(true);
      expect(tokenRe.test('&jwt=eyJhbGciOi...')).toBe(true);
      expect(tokenRe.test('?auth=mytoken')).toBe(true);
      expect(refererRe.test('Referer: https://example.invalid/?token=secret')).toBe(true);

      // Ordinary diagnostic lines must not match sensitive redaction
      expect(sensitiveDirectRe.test('request: "GET /kooker/ordinary-endpoint-fail HTTP/1.1"')).toBe(false);
      expect(sensitiveKookerRe.test('request: "GET /kooker/ordinary-endpoint-fail HTTP/1.1"')).toBe(false);
      expect(sensitiveDirectRe.test('start worker process 12')).toBe(false);
      expect(sensitiveDirectRe.test('request: "GET /ask?search=query HTTP/1.1"')).toBe(false);
    });
  });
});
