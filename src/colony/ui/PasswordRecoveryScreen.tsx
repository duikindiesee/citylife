import { useEffect, useState, type FormEvent } from "react";
import {
  requestPasswordRecovery,
  validateRecoveryInput,
  RECOVERY_PASSWORD_MIN,
} from "../passwordRecoveryClient";

interface Props {
  /** Return to the signed-out sign-in form (also used for Cancel). */
  onBackToLogin: () => void;
  /** Hand off to the already-shipped activation-token screen once the operator has approved and
   *  issued a token. Receives the identifier so that screen can prefill it (in-memory only). */
  onHaveToken: (identifier: string) => void;
}

/**
 * Signed-out, operator-assisted password recovery (PWD.REC R1) — the "I can't sign in / forgot my
 * password" path for an owner who has LOST their current password, so the authenticated Change
 * password flow (which re-proves the old password) is impossible for them.
 *
 * The owner commits the NEW password here; the backend keeps it only as a hash and returns a one-time
 * `requestRef` the owner reads to their operator out of band. The operator verifies identity, quotes
 * the ref to approve (R2), and issues an activation token — after which the owner finishes on the
 * existing PasswordActivateScreen. This request touches NO live credential and NO session: approval
 * (R2), not this request, is what moves the account to pending, so an anonymous request can neither
 * lock anyone out nor reveal whether an account exists.
 *
 * SECURITY: identifier, new password, confirmation and requestRef live ONLY in component state and the
 * single POST body. None of them is ever logged, written to local/sessionStorage, put in a URL, or
 * sent to analytics/telemetry. The plaintext password + confirm are cleared the instant the request
 * settles, and all sensitive state is cleared on cancel, on hand-off, and on unmount.
 */
export function PasswordRecoveryScreen({ onBackToLogin, onHaveToken }: Props) {
  const [identifier, setIdentifier] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once R1 succeeds — flips the screen to the one-time reference display.
  const [requestRef, setRequestRef] = useState<string | null>(null);

  // Defence in depth: if this screen unmounts (navigation away, gate re-render) while a plaintext
  // password is still in state, clear it explicitly. React discards the state on unmount anyway; this
  // makes the "no lingering secret" guarantee unconditional.
  useEffect(() => {
    return () => {
      setNewPassword("");
      setConfirm("");
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = identifier.trim();
    const v = validateRecoveryInput(id, newPassword, confirm, consented);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await requestPasswordRecovery(id, newPassword);
      setRequestRef(r.requestRef);
    } catch {
      // Oracle-safe: one neutral message for rate-limit, network, or any server error. We deliberately
      // do NOT read the thrown message so nothing about account existence can leak into the UI.
      setError(
        "Couldn't submit your request right now. Please try again in a minute.",
      );
    } finally {
      // The candidate password has done its single job — drop the plaintext from state whether the
      // request succeeded or failed, so secrets never linger after a settled submission.
      setNewPassword("");
      setConfirm("");
      setBusy(false);
    }
  };

  // Clear every sensitive field, then leave for the activation screen (clean hand-off, no parallel
  // activation mechanism — this reuses the shipped PasswordActivateScreen).
  const handoffToActivation = () => {
    const id = identifier.trim();
    setNewPassword("");
    setConfirm("");
    setRequestRef(null);
    onHaveToken(id);
  };

  const cancel = () => {
    setNewPassword("");
    setConfirm("");
    setIdentifier("");
    setRequestRef(null);
    onBackToLogin();
  };

  if (requestRef) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="login-brand">
            City<span>Life</span>
          </div>
          <div className="login-sub">Recovery request received</div>
          <p className="login-blurb">
            Read this one-time reference to your operator. They'll check it's
            really you, then send you a one-time activation token to finish
            switching to your new password. We won't show it again.
          </p>
          <div className="recovery-ref" data-testid="recovery-ref">
            {requestRef}
          </div>
          <p className="login-blurb">
            Nothing on your account has changed yet. Your new password only
            starts working after your operator approves this request and you
            redeem the activation token they give you.
          </p>
          <button
            className="login-btn"
            type="button"
            onClick={handoffToActivation}
          >
            I have my activation token
          </button>
          <div className="login-hint visitor-back">
            <button type="button" className="login-link" onClick={cancel}>
              Back to sign in
            </button>
          </div>
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
        <div className="login-sub">Can't sign in · Reset your password</div>
        <p className="login-blurb">
          Lost your password? Choose a new one here — you don't need your old
          one. You'll get a one-time reference to read to your operator, who
          verifies it's you and sends you an activation token to finish.
        </p>
        <input
          className="login-input"
          type="text"
          placeholder="email or username"
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            setError(null);
          }}
          required
          autoFocus
          disabled={busy}
          autoComplete="username"
        />
        <input
          className="login-input"
          type="password"
          placeholder={`new password (min ${RECOVERY_PASSWORD_MIN} characters)`}
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            setError(null);
          }}
          required
          disabled={busy}
          autoComplete="new-password"
          minLength={RECOVERY_PASSWORD_MIN}
        />
        <input
          className="login-input"
          type="password"
          placeholder="confirm new password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setError(null);
          }}
          required
          disabled={busy}
          autoComplete="new-password"
          minLength={RECOVERY_PASSWORD_MIN}
        />
        <label className="login-consent">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => {
              setConsented(e.target.checked);
              setError(null);
            }}
            disabled={busy}
          />
          <span>
            I understand an operator will verify my identity and that I must
            give them my recovery reference to complete this reset.
          </span>
        </label>
        {error && <div className="login-err">⚠ {error}</div>}
        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? "Submitting…" : "Request password reset"}
        </button>
        <div className="login-hint visitor-back">
          Remembered it?{" "}
          <button type="button" className="login-link" onClick={cancel}>
            Back to sign in
          </button>
        </div>
      </form>
    </div>
  );
}
