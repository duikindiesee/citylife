import { useState, type FormEvent } from "react";
import type { AuthClient } from "../authClient";

/** Border Authority login — real kooker account, authenticated against the kooker auth service. */
export function LoginScreen({
  auth,
  onAuthed,
}: {
  auth: AuthClient;
  onAuthed: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await auth.login(email, password);
    setBusy(false);
    if (r.ok) onAuthed();
    else setError(r.error);
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          City<span>Life</span>
        </div>
        <div className="login-sub">Kookerverse · Border Authority</div>
        <p className="login-blurb">
          The border is the only way onto the planet. Sign in with your kooker
          account to open it.
        </p>
        <input
          className="login-input"
          type="email"
          placeholder="kooker email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          autoFocus
          disabled={busy}
          autoComplete="username"
        />
        <input
          className="login-input"
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          disabled={busy}
          autoComplete="current-password"
        />
        {error && <div className="login-err">⚠ {error}</div>}
        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? "Authenticating…" : "Enter the Kookerverse"}
        </button>
      </form>
    </div>
  );
}
