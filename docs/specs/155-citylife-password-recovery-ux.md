# Spec 155 — CityLife signed-out password recovery UX (PWD.REC S4)

- **Status:** proposed for review, not yet built (human UAT is final)
- **Depends on:** the live PWD.REC backends —
  - `kooker-service-user` 1.32.0 (R1 `POST /api/users/password-recovery-request`, R2/R3 admin
    approve/discard, the `password_recovery_requests` table), plus the already-shipped PWD.ACT
    E2/E3 token flow it hands off to,
  - `kooker-infra` PR #293 merge `76d725e6` (the public, per-IP rate-limited APISIX route for
    `POST /api/users/password-recovery-request`, priority 100, ahead of the JWT wildcard).
- **Relates to:** Spec 154 password-change activation UX (this reuses its `PasswordActivateScreen`
  verbatim as the redemption step), `src/colony/authClient.ts`, `src/colony/ui/LoginScreen.tsx`,
  `src/colony/ui/AuthGate.tsx`.
- **Design provenance:** the PWD.REC.0 operator-assisted recovery contract (S4 slice) — a bounded
  CityLife frontend UX over already-merged backend contracts. Frontend only; no backend, engine,
  scene, or Task API change ships here.

## 1. Why

The accepted PWD.ACT design makes current-password re-proof the _only_ entry into
`PENDING_ACTIVATION` (E1). That is correct — a stolen 30-minute JWT must not become an account
takeover — but it leaves exactly one uncovered case: an **ACTIVE owner who has lost their current
password**. They get the generic 401 at sign-in and have no lawful next step. This is the failed
three-day-UAT gap ("how does a user change a password they forgot?"). D5 excluded anonymous _email
self-service_ reset from v1, so the path is **operator-assisted**: the owner starts it, but a human
operator must verify identity and approve before anything on the account changes.

The central property mirrors the accepted train: the **replacement password is committed by the owner
before any operator is involved**, so the operator's token can only ever activate the _owner's_
chosen password. The operator never learns, chooses, or submits it.

## 2. Mechanic

Signed-out, on the login gate, kept strictly separate from the signed-in Change password flow:

1. **Forgot-password entry.** A clearly visible "Can't sign in? · Forgot password?" action on the
   signed-out `LoginScreen`. It requires no session and no current password.
2. **Recovery request (R1, anonymous).** `PasswordRecoveryScreen` collects an identifier (email or
   username), a new password + private confirmation, and an explicit consent acknowledgement. On
   submit it calls R1 with **no** auth header. The confirm is compared in the browser and never sent.
3. **One-time reference.** On the generic 202 the screen shows the `requestRef` **exactly once**, in a
   prominent, selectable, monospaced badge, with "read this to your operator" instructions. Nothing on
   the account has changed yet.
4. **Hand-off to redemption.** "I have my activation token" routes to the **existing**
   `PasswordActivateScreen` (Spec 154) with the identifier prefilled — no parallel activation
   mechanism. After the operator approves (R2) and issues the token, the owner redeems it there and
   returns to normal sign-in to log in with the **new** password.

## 3. Rules & data (binding contracts)

- **Endpoint (through the `/kooker` proxy):** R1 `POST /kooker/api/users/password-recovery-request`,
  body `{ identifier, newPassword }`, **no** auth header. Returns `202 { status: "RECEIVED",
requestRef }`. New password 12–128 chars (matches `PasswordRecoveryRequestBody @Size`, v1.32.0).
- **Generic, oracle-safe response.** The backend returns the same `202 { status, requestRef }` shape
  whether or not the identifier resolves to an eligible account. The client shows the reference for
  **every** success and never infers or discloses account existence. Every non-2xx collapses to one
  neutral "try again in a minute" message; the thrown detail is never surfaced.
- **No credential/session change here.** R1 touches no live credential and no session — approval (R2),
  which is human-admin-only and out of scope for this frontend, is what moves the account to pending.
  So an anonymous R1 can neither lock anyone out nor act as an existence oracle.
- **Local validation never weakens the server.** `validateRecoveryInput` blocks empty identifier,
  <12/>128 passwords, mismatched confirm, and missing consent before the call; the server remains the
  authority.
- **Secret hygiene.** Identifier, new password, confirmation and `requestRef` live only in component
  state and the single request body. None is ever logged, written to local/sessionStorage, put in a
  URL, or sent to analytics/telemetry. The plaintext password + confirm are cleared the instant the
  request settles; all sensitive state is cleared on cancel, on hand-off, and on unmount.
- **No conflation.** Recovery uses its own client (`passwordRecoveryClient`) and screen, distinct from
  the signed-in change (`passwordChangeClient`, needs a Bearer + current password), visitor unlock
  (`visitorClient`, a brand-new disabled account), and token redemption (`passwordActivateClient`,
  after approval). Only the redemption screen and code formatting are shared.
- **Role boundaries unchanged.** Recovery is anonymous and role-agnostic on the owner side; it grants
  no capability and leaves visitor/player/operator boundaries and existing login behaviour intact.

## 4. Cost

Pure client UX over merged backends. No new assets, no materials/labour sim cost, no engine or render
work. One small client module (+ a pure validator), one screen, a login-gate action, and the AuthGate
wiring; the redemption step is reused unchanged.

## 5. Acceptance

- Unit (`tests/passwordRecoveryClient.test.ts`): `requestPasswordRecovery` posts the exact
  path/body with no bearer, returns the generic `{status, requestRef}` for any identifier, and
  attaches the HTTP status on failure; `validateRecoveryInput` enforces identifier/12–128/confirm/
  consent locally.
- e2e (`e2e/passwordRecovery.spec.ts`, mocked backend): a locked-out (unauthenticated) user initiates
  R1 with no current-password field, sees the one-time reference, posts only `{identifier,
newPassword}` with no Authorization header, has no secret in the URL or in local/sessionStorage, and
  hands off to the activation screen with the identifier prefilled; a nonexistent identifier still
  shows a generic reference with no existence disclosure; a client-side mismatch/too-short password
  never reaches the backend; the recovery entry is distinct from token redemption and returns to sign
  in.
- `npm run typecheck`, `npm run test`, and `npm run build` stay green.
- Human UAT against the live gateway is final; this PR does not merge, deploy, approve a real
  recovery, activate a real account, or mark the task done.
