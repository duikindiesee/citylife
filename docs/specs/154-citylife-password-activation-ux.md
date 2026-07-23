# Spec 154 — CityLife password-change activation UX (PWD.ACT PR-E)

- **Status:** proposed for review, not yet built (human UAT is final)
- **Depends on:** the live PWD.ACT backends —
  - `kooker-service-user` 1.31.0 (E1 `POST /api/users/me/password-change-request`,
    E3 `POST /api/users/password-activate`, the `PasswordState` machine),
  - `kooker-service-auth` 1.13.5 (pending-login enforcement + real session revocation),
  - `kooker-infra` merge `e5e8c60a` (the public, rate-limited APISIX route for
    `POST /api/users/password-activate`, ahead of the JWT wildcard).
- **Relates to:** Spec 077 visitor self-service (this reuses its interaction language),
  `src/colony/authClient.ts`, `src/colony/visitorActivation.ts`, `src/colony/visitorCode.ts`.
- **Design provenance:** operator task PWD.ACT.6 — a bounded CityLife player UX over already-merged
  backend contracts. Frontend only; no backend, engine, scene, or Task API change ships here.

## 1. Why

A signed-in player must be able to change their own password safely. The backend (PWD.ACT.0) makes
this a two-step, activation-gated change rather than an instant swap, precisely so that a stolen
30-minute access token can never become an account takeover:

- **E1** re-proves the current password, disables the old hash, stores the new one as _pending_, moves
  the account to `PENDING_ACTIVATION`, and revokes every session. **Neither the old nor the new
  password authenticates while pending.**
- **E3** redeems a single-use, operator-issued activation token (out of band) that promotes the
  pending password to live and returns the account to `ACTIVE`.

The UX must expose exactly this shape without inventing a client-side session, and without conflating
it with the Spec 077 _visitor unlock code_ (a different endpoint, a different account state).

## 2. Mechanic

Three surfaces, mirroring the visitor flow's language but kept distinct:

1. **Request (authenticated).** A "Change password" action in the signed-in HUD opens
   `PasswordChangePanel` — current password + new password + a private confirm. On submit it calls E1
   as the logged-in player (refresh-aware Bearer). The confirm is compared in the browser and never
   sent.
2. **Immediate signed-out pending state.** On E1 success the client sets a one-shot, non-secret
   pending flag, calls `auth.logout()`, and reloads to the login gate. The gate reads-and-clears the
   flag and shows a notice explaining the change is waiting on activation.
3. **Redemption (public, token-free).** From the login gate, "Enter your activation token" opens
   `PasswordActivateScreen` — email + the 32-hex activation token (displayed grouped `XXXX-XXXX-…`
   via the shared `visitorCode` formatter). On success it confirms and returns the user to the normal
   sign-in, where they log in with the **new** password.

## 3. Rules & data (binding contracts)

- **Endpoints (through the `/kooker` proxy):**
  - E1 `POST /kooker/api/users/me/password-change-request`, body `{ currentPassword, newPassword }`,
    `Authorization: Bearer <token>`. New password 12–128 chars (matches `PendingPasswordChangeRequest`).
  - E3 `POST /kooker/api/users/password-activate`, body `{ identifier, token }`, **no** auth header.
    Returns `{ userId, status: "ACTIVATED" }`; every failure is one generic 401 (no oracle).
- **No session before redemption.** The client never fabricates a session from E1/E3. After E1 the
  local session is cleared; the pending account cannot log in (auth returns the same generic 401 for
  old and pending passwords alike) until E3 succeeds — then the user re-authenticates normally.
- **Generic errors.** E3 failures surface the backend's single generic message verbatim; E1 maps only
  a 401 to "current password is incorrect" (the re-proof), everything else to one neutral message.
- **Secret hygiene.** Passwords and the plaintext token live only in component state and the single
  request body. They are never logged, persisted, bridged, put in a URL, or kept after the request
  settles. The pending flag is a boolean only.
- **No conflation.** Password activation uses its own client (`passwordActivateClient`) and screen,
  separate from `visitorClient` / `visitorActivation`; only the display formatting is shared.

## 4. Cost

Pure client UX over merged backends. No new assets, no materials/labour sim cost, no engine or render
work. Two small client modules, one notice helper, two screens, one modal, and wiring.

## 5. Acceptance

- Unit: `passwordActivateClient` posts the exact path/body with no bearer and surfaces the generic
  failure; `passwordChangeClient` attaches a Bearer, hits the exact E1 path, maps 401 vs other, and
  refuses when signed out without calling the endpoint.
- e2e (`e2e/passwordActivation.spec.ts`, mocked backend): redeem-token happy path confirms and returns
  to sign in with the token never in the URL; a bad token shows one generic error; a signed-in change
  drops to a signed-out pending state (canvas gone, notice shown); a client-side confirm mismatch
  never reaches the backend.
- `npm run typecheck`, `npm run test`, and `npm run build` stay green.
- Human UAT against the live gateway is final; this PR does not merge, deploy, activate a real
  account, or mark the task done.
