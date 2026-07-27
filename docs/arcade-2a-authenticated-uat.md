# ARCADE.2A — real authenticated UAT runbook (operator-gated)

The synthetic capture (`scripts/arcade-2a-screens-synthetic.mjs`) proves the client gate + render wiring,
but it fabricates the session and stubs the entitlement endpoint, so it is **not** authenticated UAT. This
runbook produces the **real** proof: a REAL, backend-issued disposable-player JWT and a REAL server
entitlement decision. It is operator-gated because it needs an ephemeral non-production kooker backend and
a disposable account — neither of which an autonomous worker may stand up on the shared cluster or against
production (`api.kooker.co.za`).

## Why this is not run automatically here

- Real login is Google-OAuth based (`POST /api/auth/google` with a Google id token) — a disposable JWT
  cannot be minted headlessly without a real Google credential + consent.
- The only reachable real backend is the shared ephemeral kooker cluster (Kind + ArgoCD), which other
  fleet workers use for live UAT; commandeering/mutating it (flag grants, kills) risks colliding with
  their work and would leave servers running — both out of scope for this task.

So the harness is delivered ready-to-run and the capture is left as the pending operator gate.

## What to prove (the matrix)

| Case                  | Setup                                  | Expected                         |
| --------------------- | -------------------------------------- | -------------------------------- |
| Signed-out denied     | no session                             | venue affordance absent          |
| Authenticated allowed | disposable player, scoped flag granted | can enter + inspect cabinet      |
| Killed / OFF denied   | same player, flag OFF or killed        | venue closes / affordance absent |
| Desktop + narrow      | 1280×800 and 390×844                   | both render                      |

## Steps (operator)

1. **Stand up the ephemeral, non-production backend** (never production):

   - `D:\infra\kooker-infra\up.ps1` (Kind cluster + APISIX + auth/user services + MySQL).
   - Note its non-prod gateway URL (e.g. `http://192.168.0.4:9005`). This is `KOOKER_GATEWAY`.

2. **Create a disposable CityLife player** and capture its `userId`:

   - Real login (`POST {gateway}/api/auth/google`) → a real kooker JWT with the `CITYLIFE_PLAYER` role.
   - Keep the returned session JSON (the app's `citylife.session.v5` shape). **Never print or commit it.**

3. **Grant the scoped flag to that disposable player** on the ephemeral backend only:

   - `POST {gateway}/api/admin/feature-flags/citylife-arcade-3d-v1/allowlist` with `{ "userId": "<id>" }`
     (admin JWT). The global flag stays OFF — this is a per-user allowlist grant on a throwaway backend.

4. **Serve the DEV build against that gateway** on an allowed port (5630–5639):

   - `KOOKER_GATEWAY=<gateway> npm run dev -- --port 5630` (or a preview build proxied the same way).

5. **Capture the allow path** (nothing is stubbed):

   - `KOOKER_GATEWAY=<gateway> KOOKER_TEST_SESSION='<real session json>' ARCADE_EXPECT=allow \`
     `ARCADE_BASE=http://127.0.0.1:5630 node scripts/arcade-2a-authenticated-uat.mjs`
   - Produces `evidence/arcade-2a-authenticated/{desktop,narrow}-00-signedout-denied.png`,
     `-20-authed-allowed-affordance.png`, `-21-authed-venue.png`, `-22-authed-cabinet-inspect.png`.

6. **Capture the kill/OFF deny path** for the SAME real player:

   - Flip the flag OFF or kill it:
     `PUT {gateway}/api/admin/feature-flags/citylife-arcade-3d-v1/state {"state":"OFF"}` **or**
     `POST {gateway}/api/admin/feature-flags/citylife-arcade-3d-v1/kill`.
   - Re-run with `ARCADE_EXPECT=deny` → `-10-authed-killed-or-off-denied.png`.

7. **Clean up (mandatory):**
   - Remove the allowlist grant / clear the kill:
     `DELETE {gateway}/api/admin/feature-flags/citylife-arcade-3d-v1/allowlist/<userId>`.
   - Delete / disable the disposable account and cohort grant.
   - Tear the ephemeral backend down (`down.ps1` or `kind delete cluster`) so no test server is left
     running.
   - Clear the exported `KOOKER_TEST_SESSION` from the shell/env. Confirm no token landed in any log.

## Guarantees baked into the harness

- Refuses to run without `KOOKER_TEST_SESSION` and `KOOKER_GATEWAY` (no silent fake fallback).
- Never routes/stubs the `citylife-arcade-3d-v1` endpoint — the real backend answers.
- Never prints the session or token.
- Writes only to `evidence/arcade-2a-authenticated/`, distinct from the synthetic folder.
