// The inline activation step behind the login gate's code prompt: redeem an operator-issued unlock
// code, then auto-retry login with the SAME credentials. Kept framework-free (no React) so the whole
// redeem→retry flow is unit-testable in the node test env, matching the project's plain-TS convention.
import { redeemUnlockCode } from "./visitorClient";
import type { AuthClient } from "./authClient";

export type ActivationResult =
  | { ok: true }
  // stage tells the caller WHERE it failed so it can message correctly and avoid re-redeeming a
  // single-use code: "redeem" = the code was rejected; "retry" = the code worked but login still
  // failed (pending=true → activation didn't take; pending absent → network/other).
  | { ok: false; error: string; stage: "redeem" | "retry"; pending?: boolean };

/**
 * Redeem an unlock code then sign the user in. The password was already verified by the login attempt
 * that surfaced the pending state, so the retry login is expected to succeed once redeem flips the
 * account to active. Redeem is single-use, so it is never looped — only the login is retried.
 *
 * If redeem fails but the account turns out to already be active (e.g. a code re-used after a prior
 * activation), the plain login retry still lets the user in rather than surfacing a confusing error.
 */
export async function redeemAndLogin(
  auth: AuthClient,
  email: string,
  password: string,
  strippedCode: string,
): Promise<ActivationResult> {
  try {
    await redeemUnlockCode(email.trim(), strippedCode);
  } catch (err) {
    // The code was rejected (wrong / expired / already consumed). The account may already be active,
    // so try a plain login before surfacing the code error — "I already activated" then just works.
    const already = await auth.login(email, password);
    if (already.ok) return { ok: true };
    return {
      ok: false,
      stage: "redeem",
      error: (err as Error).message || "Invalid or expired code.",
    };
  }

  const r = await auth.login(email, password);
  if (r.ok) return { ok: true };
  return { ok: false, stage: "retry", error: r.error, pending: r.pending };
}
