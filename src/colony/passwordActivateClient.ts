// Public password-activation redemption (PWD.ACT E3) — NO Bearer token.
// A pending-activation account has no valid session to present, so this path is token-free BY DESIGN
// and gateway rate-limited. Do NOT add an Authorization header here (mirrors visitorClient's doctrine).
//
// This is DISTINCT from the visitor unlock-code path: it redeems an operator-issued password-change
// activation token, not a visitor account-unlock code. The two must never be conflated — different
// endpoint, different meaning, different account state.
//
// Security notes:
//  - the plaintext activation token travels once over HTTPS in the POST body — never in a URL,
//    never logged, never persisted;
//  - the backend returns ONE generic failure for every wrong/expired/consumed/unknown case (no
//    oracle); we surface that message verbatim without inferring the reason.

const ACTIVATE_PATH = "/kooker/api/users/password-activate";

export interface PasswordActivateResult {
  userId: number;
  status: string; // "ACTIVATED"
}

/**
 * Redeem an operator-issued password-activation token, promoting the pending new password to the
 * live credential. Throws on any non-2xx with the backend's generic message (the caller shows it as
 * a single neutral error). Single-use: never loop this call.
 */
export async function activatePassword(
  identifier: string,
  token: string,
): Promise<PasswordActivateResult> {
  const resp = await fetch(ACTIVATE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ identifier, token }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    /* no body */
  }
  if (!resp.ok) {
    const msg: string =
      data?.message || data?.error || `Request failed (${resp.status})`;
    const err = new Error(msg) as Error & { status: number };
    err.status = resp.status;
    throw err;
  }
  return data as PasswordActivateResult;
}
