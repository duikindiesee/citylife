import { useState, type FormEvent } from "react";
import { signupVisitor } from "../visitorClient";

interface Props {
  onBackToLogin: () => void;
}

/**
 * Brand-new-visitor entry point. Explains the whole process up front (request → operator approves →
 * one-time code → enter it at sign-in → in), then on submit flips to an in-screen confirmation that
 * recaps the next step. There is no separate pending/unlock screen: once they have their code, the
 * user signs in normally and the login screen prompts for the code inline.
 */
export function VisitorSignupScreen({ onBackToLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const u = username.trim().toLowerCase();
    if (!u) {
      setError("Choose a username.");
      return;
    }
    if (u.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signupVisitor(email.trim(), password, u);
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message || "Signup failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="login-brand">
            City<span>Life</span>
          </div>
          <div className="login-sub">Request received</div>
          <p className="login-blurb">
            Your account is created but <b>not active yet</b>. An operator will
            review your request and send you a one-time unlock code.
          </p>
          <div className="visitor-pending-badge">Awaiting approval</div>
          <p className="login-blurb">
            When you have your code, come back here, sign in with the email and
            password you just chose, and you'll be prompted to enter the code to
            finish.
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
        <div className="login-sub">Sign up as a visitor</div>
        <p className="login-blurb">
          Request access below. An operator reviews it, then sends you a
          one-time unlock code. Come back and sign in with this email and
          password — you'll be asked for the code right there to finish.
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
          autoFocus
          disabled={busy}
          autoComplete="email"
        />
        <input
          className="login-input"
          type="text"
          placeholder="username (your in-game handle)"
          value={username}
          onChange={(e) => {
            setUsername(
              e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
            );
            setError(null);
          }}
          required
          disabled={busy}
          autoComplete="username"
          minLength={3}
          maxLength={32}
        />
        <input
          className="login-input"
          type="password"
          placeholder="password (min 8 characters)"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          required
          disabled={busy}
          autoComplete="new-password"
          minLength={8}
        />
        {error && <div className="login-err">⚠ {error}</div>}
        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? "Registering…" : "Request access"}
        </button>
        <div className="login-hint visitor-back">
          Already have an account?{" "}
          <button type="button" className="login-link" onClick={onBackToLogin}>
            Sign in
          </button>
        </div>
      </form>
    </div>
  );
}
