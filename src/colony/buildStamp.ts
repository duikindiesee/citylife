/**
 * UI.VERSION.1 — the identity of the running build, as one small screenshot-legible string.
 *
 * WHY THIS EXISTS. A live bug report ("the bus is driving through grass") is unanswerable until
 * you know WHICH BUILD is live, and a stale deploy is otherwise indistinguishable from a real
 * regression. Answering it used to take several lookups against git history and the deploy
 * workflow. This turns that into a glance.
 *
 * WHY IT IS NOT THE PRESENCE STAMP. `formatPresenceStamp` (spatial/presenceReadout) already
 * stamps the geo readout with `seed N · sol N HH:MM · rev <layoutRevision>`. That was examined
 * and deliberately left alone: it identifies the WORLD (seed, sol, world-layout revision), not
 * the CODE. The two are independent — the exact same seed renders differently under two builds,
 * which is precisely the confusion this ticket came from. It is also the wrong carrier: the geo
 * readout returns null when there is no presence data, and it does not exist on the login screen
 * at all, so a build stamp living inside it would vanish exactly when someone needs to report a
 * problem. Separate concern, separate stamp; the presence stamp is unchanged.
 *
 * WHY VERSION *AND* SHA. The release version alone cannot distinguish two deploys of the same
 * version (a re-run, a rebuild, a rollback), and the SHA alone is not human-orderable. Together
 * they answer both "how new is this" and "exactly which commit".
 *
 * The values are compile-time literals injected by vite.config.ts — there is no hand-edited
 * constant here that could rot.
 */

declare const __BUILD_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

export type BuildStampParts = {
  readonly version: string;
  readonly sha: string;
  readonly builtAt: string;
};

/**
 * Read an injected literal without throwing where it was never defined (a bare `tsc`, or a
 * consumer that imports this module outside a vite pipeline). `typeof` on an undeclared
 * identifier is the one safe probe in JS.
 */
function injected(read: () => string): string {
  try {
    const value = read();
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

export function buildStampParts(): BuildStampParts {
  return {
    version: injected(() =>
      typeof __BUILD_VERSION__ === "string" ? __BUILD_VERSION__ : "",
    ),
    sha: injected(() =>
      typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "",
    ),
    builtAt: injected(() =>
      typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "",
    ),
  };
}

/**
 * Format for display. Honest about gaps rather than inventing a plausible value: an unknown
 * build reads "build unknown", which is itself a useful signal (something built outside the
 * normal pipeline) and is never mistaken for a real version.
 */
export function formatBuildStamp(
  parts: BuildStampParts = buildStampParts(),
): string {
  const version = parts.version ? `v${parts.version}` : "";
  const sha = parts.sha ? parts.sha : "";
  if (version && sha) return `${version} · ${sha}`;
  return version || sha || "build unknown";
}

/**
 * Longer form for a tooltip — the build time is useful when diagnosing a stale deploy but is far
 * too wide to sit in a corner, so it lives in `title` rather than in the visible stamp.
 */
export function buildStampTitle(
  parts: BuildStampParts = buildStampParts(),
): string {
  const bits = [
    parts.version ? `version ${parts.version}` : null,
    parts.sha ? `commit ${parts.sha}` : null,
    parts.builtAt ? `built ${parts.builtAt}` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "build identity unavailable";
}
