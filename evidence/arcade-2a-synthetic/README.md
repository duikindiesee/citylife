# ARCADE.2A — SYNTHETIC component evidence (NOT authenticated UAT)

These screenshots were produced by `scripts/arcade-2a-screens-synthetic.mjs` against a locally-served DEV
build. They are **synthetic component evidence**, not authenticated user-acceptance testing:

- The player session is **fabricated and injected** into `sessionStorage` before boot. It carries an
  opaque, made-up token that no auth backend ever issued or validated — there is **no real login and no
  real JWT**.
- The `citylife-arcade-3d-v1` entitlement endpoint is **stubbed** (via Playwright `page.route`) to return
  the desired ON/OFF state. **No real feature-flag / cohort service answered.**

### What these DO show

The client-side gate and render/interaction wiring behave correctly given a player session and an
entitlement answer, captured with a real occlusion-aware pointer click (not a programmatic `el.click()`):

- `*-00-authed-off-denied.png` — fabricated player + STUBBED flag OFF ⇒ entry affordance absent (denied).
- `*-01-world-affordance.png` — fabricated player + STUBBED flag ON ⇒ entry affordance present.
- `*-02-venue.png` — the streamed venue interior after entering.
- `*-03-cabinet-inspect.png` — the isolated 3D cabinet inspection.
- `*-04-closed-back-to-venue.png` — clean close back to the venue.

Both `desktop` (1280×800) and `narrow` (390×844) viewports are captured.

### What these do NOT show

They do **not** prove that a real signed-in player is authenticated by the backend or entitled by a real
server flag. That real, disposable, authenticated proof is a separate deliverable — see
`scripts/arcade-2a-authenticated-uat.mjs` and `docs/arcade-2a-authenticated-uat.md`. Real authenticated UAT
against a live/ephemeral kooker backend with a disposable account is operator-gated and pending.
