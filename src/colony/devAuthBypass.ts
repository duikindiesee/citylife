// The single, narrowly-scoped local DEV/E2E auth-bypass predicate shared by every gate that must keep
// login-free local/E2E flows working WITHOUT ever widening production access. It is deliberately NOT
// derived from auth state: an expired, signed-out or otherwise null operator is NOT a bypass signal
// (a mounted app can drop to a null operator at any time), so gates that keyed off `operator === null`
// could fail OPEN in production. This predicate instead requires, together:
//   • a DEV build (`import.meta.env.DEV`) — a production `vite build` has DEV === false, so the cluster
//     bundle (citylife.kooker.co.za) can never satisfy it; the real border gate always stands;
//   • a LOCAL origin (localhost / 127.0.0.1 / LAN) — a belt-and-suspenders guard so it can never fire on
//     a kooker.co.za domain even if a dev build were somehow served there; and
//   • an explicit developer opt-in: either `VITE_LOCAL_TEST` is set in `.env.local`, or the URL carries
//     `?skipauth=1`.
// SECURITY: production, expired and signed-out sessions all fail CLOSED here — the predicate is false
// unless all three developer-only conditions hold on the developer's own machine.

/** The already-evaluated inputs to the bypass decision. Pure and DOM-free so the whole matrix is
 *  node-testable without a browser; the browser default reader is `readDevAuthBypassProbe`. */
export interface DevAuthBypassProbe {
  /** `import.meta.env.DEV` — true only for a dev build, never a production `vite build`. */
  readonly isDev: boolean;
  /** `window.location.hostname` (or "" when there is no window). */
  readonly hostname: string;
  /** `VITE_LOCAL_TEST` is `"1"` or `"true"` in the build env. */
  readonly localTestSetting: boolean;
  /** The current URL carries `?skipauth=1`. */
  readonly urlSkip: boolean;
}

/** True iff the host is a loopback / LAN / *.local address — never a public kooker.co.za domain. Mirrors
 *  the AuthGate host allow-list exactly so both gates share one definition of "local". */
export function isLocalBypassHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)
  );
}

/** Read the bypass probe from the ambient DEV build env + window. Returns an all-false-ish probe when
 *  there is no window (SSR/node), so the predicate fails closed off the browser. */
export function readDevAuthBypassProbe(): DevAuthBypassProbe {
  const env = (
    import.meta as unknown as {
      env?: { DEV?: boolean; VITE_LOCAL_TEST?: string };
    }
  ).env;
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : "";
  const urlSkip =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("skipauth") === "1";
  return {
    isDev: Boolean(env?.DEV),
    hostname,
    localTestSetting:
      env?.VITE_LOCAL_TEST === "1" || env?.VITE_LOCAL_TEST === "true",
    urlSkip,
  };
}

/** The shared decision: a bypass is allowed ONLY when it is a DEV build, on a local origin, with an
 *  explicit developer opt-in. Every other state — production, expired, signed-out — is false. */
export function isLocalDevAuthBypass(
  probe: DevAuthBypassProbe = readDevAuthBypassProbe(),
): boolean {
  return (
    probe.isDev &&
    isLocalBypassHost(probe.hostname) &&
    (probe.localTestSetting || probe.urlSkip)
  );
}
