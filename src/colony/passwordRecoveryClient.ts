// Public signed-out password-recovery REQUEST (PWD.REC R1) — NO Bearer token.
//
// This is the "I've lost my password" path for an ACTIVE account whose owner can no longer prove the
// current password, so the authenticated PWD.ACT change (E1, which re-proves the old password) is
// impossible for them. R1 lets the owner commit a NEW password up front; the backend stores it only
// as a BCrypt hash and hands back a one-time `requestRef`. Nothing on the account changes here — no
// credential, no state, no session. An operator later verifies identity, quotes the ref to approve
// (R2), and issues the existing PWD.ACT activation token; the owner finishes on PasswordActivateScreen.
//
// This is DISTINCT from every other password path and must never be conflated:
//  - visitor unlock (visitorClient) activates a brand-new DISABLED visitor account;
//  - password-activate (passwordActivateClient) redeems the token AFTER approval;
//  - the signed-in change (passwordChangeClient) needs a Bearer + the current password.
// Recovery is the ONLY one that is both anonymous and lets a locked-out owner start a reset.
//
// Security notes:
//  - the candidate new password travels once over HTTPS in the POST body — never in a URL, never
//    logged, never persisted; the caller drops it from state the instant the request settles;
//  - the backend returns an identical generic 202 {status:"RECEIVED", requestRef} whether or not the
//    identifier resolved to an eligible account (oracle resistance), so the caller shows the ref for
//    every success and never infers account existence;
//  - do NOT add an Authorization header here (mirrors visitorClient / passwordActivateClient doctrine).

const RECOVERY_PATH = "/kooker/api/users/password-recovery-request";

// Candidate-password policy — mirrors the backend contract (PasswordRecoveryRequestBody @Size 12–128,
// v1.32.0). Enforced locally so obvious mistakes never leave the browser; the server stays authoritative.
export const RECOVERY_PASSWORD_MIN = 12;
export const RECOVERY_PASSWORD_MAX = 128;

export interface PasswordRecoveryResult {
  status: string; // "RECEIVED"
  requestRef: string; // dash-grouped 8-hex, e.g. "A1B2-C3D4" — read to the operator, shown once
}

export type RecoveryValidation = { ok: true } | { ok: false; error: string };

/**
 * Pure, DOM-free local validation mirroring the R1 contract (identifier required; new password
 * 12–128; confirmation match; explicit consent). It ONLY blocks obviously-invalid input before the
 * network call — it never relaxes the server's own validation, which remains the authority. Kept a
 * standalone function so the rules are unit-testable without a browser.
 */
export function validateRecoveryInput(
  identifier: string,
  newPassword: string,
  confirm: string,
  consented: boolean,
): RecoveryValidation {
  if (!identifier.trim()) {
    return {
      ok: false,
      error: "Enter the email or username your account uses.",
    };
  }
  if (newPassword.length < RECOVERY_PASSWORD_MIN) {
    return {
      ok: false,
      error: `New password must be at least ${RECOVERY_PASSWORD_MIN} characters.`,
    };
  }
  if (newPassword.length > RECOVERY_PASSWORD_MAX) {
    return {
      ok: false,
      error: `New password must be at most ${RECOVERY_PASSWORD_MAX} characters.`,
    };
  }
  if (newPassword !== confirm) {
    return { ok: false, error: "The new passwords don't match." };
  }
  if (!consented) {
    return {
      ok: false,
      error:
        "Please confirm you understand an operator must verify you and approve this reset.",
    };
  }
  return { ok: true };
}

/**
 * Submit an R1 recovery request. On success returns the generic {status, requestRef}; the requestRef
 * is the only thing the requester ever learns and must be shown exactly once. Throws on any non-2xx
 * with the backend's message (the caller collapses that to a single neutral, oracle-safe error and
 * never surfaces which failure it was). No Authorization header — this path is anonymous by design.
 */
export async function requestPasswordRecovery(
  identifier: string,
  newPassword: string,
): Promise<PasswordRecoveryResult> {
  const resp = await fetch(RECOVERY_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ identifier, newPassword }),
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
  return data as PasswordRecoveryResult;
}
