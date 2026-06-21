import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AuthClient } from "../authClient";

/** How long the login screen may sit untouched before it drops into the cinematic attract backdrop. */
const IDLE_MS = 10_000;

/** Border Authority login — real kooker account, authenticated against the kooker auth service. */
export function LoginScreen({
  auth,
  onAuthed,
  onIdle,
  onActive,
  isCinematic,
}: {
  auth: AuthClient;
  onAuthed: () => void;
  /** Fired after IDLE_MS of no interaction — the operator wants the cinematic fly-around to take over. */
  onIdle?: () => void;
  /** Fired the moment the operator stirs (mouse/key/touch) — return from the cinematic to the form. */
  onActive?: () => void;
  /** When true, the form root goes transparent so the cinematic backdrop shows through behind the card. */
  isCinematic?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Idle → cinematic. Keep the callbacks + busy flag in refs so the listener effect runs once (deps []),
  // i.e. the 10s countdown is NOT reset by unrelated re-renders — only by real user activity.
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    clearIdleTimer(); // a submit-in-flight must not flip to cinematic underneath the operator
    onActive?.();
    setBusy(true);
    busyRef.current = true;
    setError(null);
    const r = await auth.login(email, password);
    setBusy(false);
    busyRef.current = false;
    if (r.ok) onAuthed();
    else setError(r.error);
  };

  return (
    <div className={"login" + (isCinematic ? " is-cinematic" : "")}>
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
