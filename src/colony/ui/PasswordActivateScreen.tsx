import { useState, type FormEvent } from "react";
import { activatePassword } from "../passwordActivateClient";
import { formatCode, stripCode } from "../visitorCode";

interface Props {
  /** Optional email to prefill (the user just came from a signed-out pending state). */
  initialEmail?: string;
  onBackToLogin: () => void;
}

/** A password-activation token is 16 random bytes rendered as 32 uppercase hex chars (see
 *  kooker-service-user UserService#generateToken). We display it grouped as XXXX-XXXX-… exactly like
 *  a visitor unlock code — the SAME interaction language — but this redeems a password change, not a
 *  visitor account unlock. Complete once all 32 hex digits are present. */
const PASSWORD_TOKEN_HEX = 32;

function isTokenComplete(formatted: string): boolean {
  return stripCode(formatted).length >= PASSWORD_TOKEN_HEX;
}

/**
 * The login-gate screen for finishing a password change. After an authenticated change request the
 * user is signed out into a pending state; once their operator hands them the one-time activation
 * token (out of band), they come here, enter their email + token, and — on success — return to the
 * normal sign-in to log in with their NEW password.
 *
 * This deliberately mirrors the visitor-activation wording without conflating the two: a visitor
 * unlock code activates a brand-new account; this activation token completes a password change on an
 * existing one. It hits the public, token-free /api/users/password-activate route.
 */
export function PasswordActivateScreen({ initialEmail, onBackToLogin }: Props) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = email.trim();
    if (!id) {
      setError("Enter the email your account uses.");
      return;
    }
    if (!isTokenComplete(token)) {
      setError("Token is incomplete — check you typed all of it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await activatePassword(id, stripCode(token));
      setDone(true);
    } catch (err) {
      // The backend returns one generic failure for every wrong/expired/consumed/unknown case — we
      // show it verbatim and never guess which it was.
      setError((err as Error).message || "Invalid or expired token.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="login-brand">
            City<span>Life</span>
          </div>
          <div className="login-sub">Password change complete</div>
          <div className="visitor-pending-badge">Activated</div>
          <p className="login-blurb">
            Your new password is now active. Head back to sign in and log in
            with it.
          </p>
          <button className="login-btn" type="button" onClick={onBackToLogin}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          City<span>Life</span>
        </div>
        <div className="login-sub">Finish your password change</div>
        <p className="login-blurb">
          Your password change is waiting on activation. Enter your email and
          the one-time activation token your operator sent you to switch to your
          new password.
        </p>
        <input
          className="login-input"
          type="email"
          placeholder="email address"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          required
          autoFocus={!initialEmail}
          disabled={busy}
          autoComplete="email"
        />
        <input
          className="login-input visitor-code-input"
          type="text"
          inputMode="text"
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          value={token}
          onChange={(e) => {
            setToken(formatCode(e.target.value));
            setError(null);
          }}
          autoFocus={!!initialEmail}
          disabled={busy}
          autoComplete="one-time-code"
          spellCheck={false}
        />
        {error && <div className="login-err">⚠ {error}</div>}
        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? "Activating…" : "Activate new password"}
        </button>
        <div className="login-hint visitor-back">
          Changed your mind, or don't have a token yet?{" "}
          <button type="button" className="login-link" onClick={onBackToLogin}>
            Back to sign in
          </button>
        </div>
      </form>
    </div>
  );
}
