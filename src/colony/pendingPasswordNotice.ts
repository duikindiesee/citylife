// A one-shot, NON-SECRET UX flag that survives the sign-out reload after a password-change request
// (PWD.ACT E1). When the authenticated request succeeds we sign the user out and reload to the login
// gate; this flag lets the login screen explain WHY they were signed out and point them at token
// redemption. It carries no password and no token — only a boolean hint — so it is safe in storage.

const PENDING_NOTICE_KEY = "citylife.pwdChangePending";

/** Mark that a password change was just requested, so the next login-gate render can explain it. */
export function markPasswordChangePending(): void {
  try {
    sessionStorage.setItem(PENDING_NOTICE_KEY, "1");
  } catch {
    /* no storage — the notice is a nicety, not load-bearing */
  }
}

/** Read-and-clear the pending flag. Returns true at most once per request (one-shot). */
export function consumePasswordChangePending(): boolean {
  try {
    const set = sessionStorage.getItem(PENDING_NOTICE_KEY) === "1";
    if (set) sessionStorage.removeItem(PENDING_NOTICE_KEY);
    return set;
  } catch {
    return false;
  }
}
