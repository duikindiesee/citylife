// Authenticated self-service password-change REQUEST (PWD.ACT E1).
//
// This does NOT change the password immediately. It moves the account to PENDING_ACTIVATION
// server-side: the old password is disabled and the new one is stored but UNUSABLE until an
// operator-issued single-use activation token is redeemed (see passwordActivateClient). The current
// password is re-proved here so a stolen access token alone can never trigger a lockout+takeover.
// On success the backend synchronously revokes the user's sessions, so the caller must sign out.
//
// Security notes:
//  - both passwords travel once over HTTPS in the POST body under a short-lived Bearer token —
//    never logged, never persisted, never placed in a URL;
//  - the refresh-aware getValidToken() supplies the Bearer, matching every other authenticated call.

import { getAuthClient } from "./authClient";

const REQUEST_PATH = "/kooker/api/users/me/password-change-request";

export type PasswordChangeResult = { ok: true } | { ok: false; error: string };

/**
 * Ask the backend to stage a password change for the signed-in user. Returns a generic result; the
 * only distinguished failure is a 401, which for this authenticated route means the current-password
 * re-proof was wrong (the Bearer was already validated fresh via getValidToken).
 */
export async function requestPasswordChange(
  currentPassword: string,
  newPassword: string,
): Promise<PasswordChangeResult> {
  const token = await getAuthClient().getValidToken();
  if (!token) {
    return {
      ok: false,
      error: "You're signed out — sign in again to change your password.",
    };
  }
  try {
    const resp = await fetch(REQUEST_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!resp.ok) {
      if (resp.status === 401) {
        return { ok: false, error: "Current password is incorrect." };
      }
      // Any other status (validation, gateway, server) — one neutral message, no detail leaked.
      return {
        ok: false,
        error: "Couldn't start the password change. Please try again.",
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Network error — is the gateway reachable?",
    };
  }
}
