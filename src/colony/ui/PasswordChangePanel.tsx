import { useState, type FormEvent } from "react";
import { requestPasswordChange } from "../passwordChangeClient";

interface Props {
  /** Called after a successful request — the caller signs the user out into the pending state. */
  onRequested: () => void;
  onClose: () => void;
}

/** Match the backend rule (PendingPasswordChangeRequest): new password 12–128 chars. */
const MIN_NEW_PASSWORD = 12;

/**
 * The signed-in "change my password" dialog. Re-proves the current password, takes a new one with a
 * private confirmation (the confirm is compared client-side and never sent), and asks the backend to
 * stage the change (E1). On success the account is left PENDING_ACTIVATION and the server revokes the
 * session, so the caller signs the user out — neither the old nor the new password works until the
 * operator-issued activation token is redeemed at the login gate.
 *
 * SECURITY: passwords live only in local component state and the single POST body — never logged,
 * persisted, or put in a URL. The confirmation field never leaves the browser.
 */
export function PasswordChangePanel({ onRequested, onClose }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setError("Enter your current password.");
      return;
    }
    if (newPassword.length < MIN_NEW_PASSWORD) {
      setError(`New password must be at least ${MIN_NEW_PASSWORD} characters.`);
      return;
    }
    if (newPassword === currentPassword) {
      setError("Choose a new password that differs from your current one.");
      return;
    }
    if (newPassword !== confirm) {
      setError("The new passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await requestPasswordChange(currentPassword, newPassword);
    // Clear the secrets from state the moment the request settles — no lingering plaintext.
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
    setBusy(false);
    if (r.ok) {
      onRequested();
      return;
    }
    setError(r.error);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        data-testid="password-change-modal"
      >
        <h3>Change your password</h3>
        <p>
          Confirm your current password and choose a new one. For safety the
          change doesn't take effect immediately: you'll be signed out and can
          finish it with a one-time activation token from your operator.
        </p>
        <form onSubmit={submit}>
          <input
            className="login-input"
            type="password"
            placeholder="current password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setError(null);
            }}
            autoFocus
            disabled={busy}
            autoComplete="current-password"
          />
          <input
            className="login-input"
            type="password"
            placeholder={`new password (min ${MIN_NEW_PASSWORD} characters)`}
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setError(null);
            }}
            disabled={busy}
            autoComplete="new-password"
            minLength={MIN_NEW_PASSWORD}
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
            disabled={busy}
            autoComplete="new-password"
            minLength={MIN_NEW_PASSWORD}
          />
          {error && <div className="login-err">⚠ {error}</div>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Requesting…" : "Request change"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
