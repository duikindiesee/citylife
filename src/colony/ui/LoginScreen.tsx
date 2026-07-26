import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AuthClient } from "../authClient";
import { redeemAndLogin } from "../visitorActivation";
import { formatCode, isCodeComplete, stripCode } from "../visitorCode";

/** How long the login screen may sit untouched before it drops into the cinematic attract backdrop. */
const IDLE_MS = 10_000;

interface Props {
  auth: AuthClient;
  onAuthed: () => void;
  onVisitorSignup: () => void;
  /** Opens the signed-out password-recovery screen for an owner who lost their password (PWD.REC R1). */
  onForgotPassword: () => void;
  /**
   * Opens the activation-token redemption screen directly (PWD.REC.9). A permanent, always-visible
   * signed-out route so a player who requested recovery, then closed or reloaded, can come back later,
   * enter the operator-issued activation token, and finish switching to their staged new password.
   * This explicitly supersedes PWD.REC.6, which had made activation entry contextual-only.
   */
  onEnterActivation: () => void;
  /** Fired after IDLE_MS of no interaction — the operator wants the cinematic fly-around to take over. */
  onIdle?: () => void;
  /** Fired the moment the operator stirs (mouse/key/touch) — return from the cinematic to the form. */
  onActive?: () => void;
  /** When true, the form root goes transparent so the cinematic backdrop shows through behind the card. */
  isCinematic?: boolean;
}

/**
 * Border Authority login — the single entry point. A normal kooker sign-in; if the account turns out
 * to be a not-yet-activated visitor (the backend 403s "Account disabled" after accepting the
 * password), the form drops INLINE into a code prompt: enter the operator-issued unlock code, which
 * activates the account and signs the user straight in. Brand-new users take the "Sign up as a
 * visitor" link first.
 */
export function LoginScreen({
  auth,
  onAuthed,
  onVisitorSignup,
  onForgotPassword,
  onEnterActivation,
  onIdle,
  onActive,
  isCinematic,
}: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inline activation: after a "pending" login we switch to the code phase, keeping the (already
  // password-verified) credentials in state so the post-redeem retry login needs no re-entry.
  const [phase, setPhase] = useState<"credentials" | "code">("credentials");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Set when redeem succeeded but the retry login failed transiently — offer a plain re-login that
  // does NOT re-redeem the (now single-use-consumed) code.
  const [retryable, setRetryable] = useState(false);

  // Idle → cinematic. Keep the callbacks + busy flag in refs so the listener effect runs once (deps []),
  // i.e. the 10s countdown is NOT reset by unrelated re-renders — only by real user activity.
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  // Lets endBusy() re-arm the idle countdown after an auth attempt without waiting for a fresh gesture
  // (a user hunting for an emailed code is exactly the idle case). Set inside the listener effect.
  const armRef = useRef<() => void>(() => {});

  const clearIdleTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    const arm = () => {
      clearIdleTimer();
      if (busyRef.current) return; // never drift into cinematic mid-authentication
      timerRef.current = window.setTimeout(
        () => onIdleRef.current?.(),
        IDLE_MS,
      );
    };
    armRef.current = arm;
    const onActivity = () => {
      onActiveRef.current?.(); // leave the cinematic the instant the operator stirs
      arm(); // and restart the countdown
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"];
    for (const e of events)
      window.addEventListener(e, onActivity, { passive: true });
    arm(); // start the first countdown on mount
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      clearIdleTimer();
    };
  }, []);

  const beginBusy = () => {
    clearIdleTimer(); // an auth-in-flight must not flip to cinematic underneath the user
    onActive?.();
    setBusy(true);
    busyRef.current = true;
  };
  const endBusy = () => {
    setBusy(false);
    busyRef.current = false;
    armRef.current(); // resume the idle→cinematic countdown after the auth attempt settles
  };

  // Phase 1 — try the credentials. A "pending" result (correct password, inactive account) drops us
  // into the inline code phase; any other failure is a normal error.
  const submitCredentials = async (e: FormEvent) => {
    e.preventDefault();
    beginBusy();
    setError(null);
    setNotice(null);
    const r = await auth.login(email, password);
    endBusy();
    if (r.ok) {
      onAuthed();
      return;
    }
    if (r.pending) {
      // Correct password and an unlock code is outstanding (or a legacy "disabled" account) — drop
      // into the inline code phase so they can enter it.
      setPhase("code");
      return;
    }
    if (r.accountState === "pending_review") {
      // Signed up, still awaiting operator approval, no code issued yet — reassure rather than alarm,
      // and stay on the sign-in form (there is no code to enter yet).
      setNotice(r.error);
      return;
    }
    // revoked / no CityLife access / any other gate — a plain error, no code prompt.
    setError(r.error);
  };

  // Phase 2 — redeem the code, then auto-sign-in with the same credentials.
  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!isCodeComplete(code)) {
      setError("Code is incomplete — check you typed it correctly.");
      return;
    }
    beginBusy();
    setError(null);
    setRetryable(false);
    setNotice("Activating your account…");
    const r = await redeemAndLogin(auth, email, password, stripCode(code));
    endBusy();
    if (r.ok) {
      onAuthed();
      return;
    }
    setNotice(null);
    if (r.stage === "redeem") {
      setError(r.error); // bad/expired code — let them re-type it
      return;
    }
    // Redeem worked but the retry login didn't.
    if (r.pending) {
      setError(
        "Your code was accepted but the account still isn't active. Contact the operator.",
      );
    } else {
      setError(r.error);
      setRetryable(true); // transient — offer a plain re-login (no second redeem)
    }
  };

  // A plain re-login after a successful redeem (the code is already consumed, so never re-redeem).
  const retrySignIn = async () => {
    beginBusy();
    setError(null);
    const r = await auth.login(email, password);
    endBusy();
    if (r.ok) onAuthed();
    else setError(r.error);
  };

  const backToCredentials = () => {
    setPhase("credentials");
    setCode("");
    setError(null);
    setNotice(null);
    setRetryable(false);
  };

  const rootClass = "login" + (isCinematic ? " is-cinematic" : "");

  if (phase === "code") {
    return (
      <div className={rootClass}>
        <form className="login-card" onSubmit={submitCode}>
          <div className="login-brand">
            City<span>Life</span>
          </div>
          <div className="login-sub">Activate your account</div>
          <p className="login-blurb">
            Signing in as <b>{email}</b>. Your account isn't active yet — enter
            the one-time unlock code your operator sent you to finish.
          </p>
          {notice && <div className="visitor-pending-badge">{notice}</div>}
          <input
            className="login-input visitor-code-input"
            type="text"
            inputMode="text"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            value={code}
            onChange={(e) => {
              setCode(formatCode(e.target.value));
              setError(null);
            }}
            autoFocus
            disabled={busy}
            autoComplete="one-time-code"
            spellCheck={false}
          />
          {error && <div className="login-err">⚠ {error}</div>}
          <button className="login-btn" type="submit" disabled={busy}>
            {busy ? "Activating…" : "Activate & enter"}
          </button>
          {retryable && (
            <button
              className="login-btn"
              type="button"
              disabled={busy}
              onClick={retrySignIn}
            >
              Try sign in again
            </button>
          )}
          <div className="login-hint visitor-back">
            No code yet? Your request may still be awaiting operator approval —
            check back once you've received your code.{" "}
            <button
              type="button"
              className="login-link"
              onClick={backToCredentials}
            >
              Back to sign in
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <form className="login-card" onSubmit={submitCredentials}>
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
            setNotice(null);
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
            setNotice(null);
          }}
          disabled={busy}
          autoComplete="current-password"
        />
        {notice && <div className="visitor-pending-badge">{notice}</div>}
        {error && <div className="login-err">⚠ {error}</div>}
        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? "Authenticating…" : "Enter the Kookerverse"}
        </button>
        <div className="login-hint visitor-back">
          Can't sign in?{" "}
          <button
            type="button"
            className="login-link"
            onClick={onForgotPassword}
          >
            Forgot password?
          </button>
        </div>
        {/* PWD.REC.9 — a permanent route to finish a password reset. A player who requested recovery
            and then closed or reloaded still lands here signed-out with no context; this always-visible
            entry lets them return, redeem the operator-issued activation token, and switch to their
            staged new password. Deliberately worded around the ACTIVATION TOKEN, kept distinct from the
            recovery REFERENCE the request screen hands out — the two are different concepts. */}
        <div className="login-hint visitor-back">
          Completing a password reset?{" "}
          <button
            type="button"
            className="login-link"
            data-testid="enter-activation-link"
            onClick={onEnterActivation}
          >
            Enter activation token
          </button>
        </div>
        <div className="login-hint visitor-links">
          New to CityLife?{" "}
          <button
            type="button"
            className="login-link"
            onClick={onVisitorSignup}
          >
            Sign up as a visitor
          </button>
        </div>
        <div className="login-hint">
          <a className="login-link" href="/ask-kooker.html">
            Ask Kooker a question
          </a>{" "}
          — no account needed to ask.
        </div>
      </form>
    </div>
  );
}
