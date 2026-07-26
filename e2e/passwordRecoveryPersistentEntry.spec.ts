import { test, expect, type Page } from "@playwright/test";

// Deterministic coverage for the PERMANENT signed-out activation-token redemption route (PWD.REC.9),
// which explicitly supersedes PWD.REC.6's removal of that entry. The backend is fully mocked via route
// interception so these tests never touch a live gateway or issue/redeem a real token: they assert the
// CLIENT flow — that a player who requested recovery and then CLOSED/RELOADED can still return to the
// signed-out login screen, reach activation through the always-visible entry, redeem the operator
// token, and sign in with their staged new password.
//
// `/?login=1` only SHOWS the login form (it never bypasses auth), so the whole flow runs anonymous —
// exactly the locked-out, no-session case a returning recovery user is in.

const RECOVERY_ROUTE = "**/api/users/password-recovery-request";
const ACTIVATE_ROUTE = "**/api/users/password-activate";
const AUTH_ROUTE = "**/api/auth/basic";

const IDENTIFIER = "locked-out@test.com";
// Obviously-fake throwaway secrets — no real entropy, safe in a public repo, never a live credential.
const NEW_PASSWORD = "staged-new-pass-1234";
const REQUEST_REF = "A1B2-C3D4";
// A 32-hex fixture in the exact shape kooker-service-user issues (16 random bytes), built from a
// repeated block so it carries no real entropy and can never look like a live activation token.
const TOKEN = "ABCD1234".repeat(4);

/** Build a syntactically-valid but obviously-fake JWT so authClient can parse exp/roles/userId without
 *  throwing. Signature is a fixed dummy — the gateway is mocked, so no signature is ever verified. */
function fakeJwt(): string {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const header = b64url({ alg: "none", typ: "JWT" });
  const payload = b64url({
    userId: "e2e-user",
    roles: ["CITYLIFE_PLAYER"],
    // Far-future, fixed timestamp (2033) — never derived from the wall clock, so the fixture is stable.
    exp: 2000000000,
  });
  return `${header}.${payload}.e2e-not-a-real-signature`;
}

/** Decode a Basic auth header back to "id:password" so a test can prove which password was submitted. */
function decodeBasic(header: string): string {
  return Buffer.from(header.replace(/^Basic\s+/i, ""), "base64").toString(
    "utf8",
  );
}

async function assertNoSensitivePersistence(page: Page) {
  const storage = await page.evaluate(() => ({
    session: JSON.stringify(window.sessionStorage),
    local: JSON.stringify(window.localStorage),
  }));
  for (const bucket of [storage.session, storage.local]) {
    expect(bucket).not.toContain(TOKEN);
    expect(bucket).not.toContain(REQUEST_REF);
    expect(bucket).not.toContain(NEW_PASSWORD);
  }
  expect(page.url()).not.toContain(TOKEN);
  expect(page.url()).not.toContain(REQUEST_REF);
  expect(page.url()).not.toContain(NEW_PASSWORD);
}

test.describe("Persistent activation-token redemption route (PWD.REC.9)", () => {
  test("request -> close/reopen -> redeem via the permanent entry -> sign in with the staged password", async ({
    page,
  }) => {
    // The final step authenticates and mounts the colony canvas (slow under headless, no GPU) — give it
    // generous headroom over the default 60s so a cold scene load never trips the cap.
    test.setTimeout(150_000);

    let recoveryBody: unknown = null;
    let activateBody: unknown = null;
    let loginBasic = "";

    await page.route(RECOVERY_ROUTE, async (route) => {
      recoveryBody = JSON.parse(route.request().postData() ?? "null");
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ status: "RECEIVED", requestRef: REQUEST_REF }),
      });
    });
    await page.route(ACTIVATE_ROUTE, async (route) => {
      activateBody = JSON.parse(route.request().postData() ?? "null");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ userId: 7, status: "ACTIVATED" }),
      });
    });
    await page.route(AUTH_ROUTE, async (route) => {
      loginBasic = route.request().headers()["authorization"] ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          accessToken: fakeJwt(),
          refreshToken: "e2e-fake-refresh",
          user: { email: IDENTIFIER, name: "E2E Player" },
        }),
      });
    });

    // 1) Request recovery — the owner stages a NEW password and gets a one-time REFERENCE to read out.
    await page.goto("/?login=1");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByText("Reset your password")).toBeVisible();
    await page.getByPlaceholder("email or username").fill(IDENTIFIER);
    await page.getByPlaceholder(/new password \(min/).fill(NEW_PASSWORD);
    await page.getByPlaceholder("confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request password reset" }).click();
    await expect(page.getByTestId("recovery-ref")).toHaveText(REQUEST_REF);
    expect(recoveryBody).toEqual({
      identifier: IDENTIFIER,
      newPassword: NEW_PASSWORD,
    });
    // The reference and the staged password left no trace in browser persistence.
    await assertNoSensitivePersistence(page);

    // 2) CLOSE / REOPEN — a full document reload with no session. Recovery persisted nothing, so this
    //    lands on a plain signed-out login screen with zero context, exactly like reopening the tab.
    await page.goto("/?login=1");
    await expect(page.getByText("Border Authority")).toBeVisible();
    await assertNoSensitivePersistence(page);

    // 3) The permanent PWD.REC.9 entry is right there — no recovery re-request needed to reach it.
    await page.getByTestId("enter-activation-link").click();
    await expect(page.getByText("Finish your password change")).toBeVisible();

    // 4) Redeem the operator-issued activation token (email typed fresh — nothing was prefilled).
    await page.getByPlaceholder("email address").fill(IDENTIFIER);
    await page.locator("input.visitor-code-input").fill(TOKEN); // formatCode regroups as XXXX-XXXX-…
    await page.getByRole("button", { name: "Activate new password" }).click();
    await expect(page.getByText("Password change complete")).toBeVisible();
    await expect(page.getByText("Activated", { exact: true })).toBeVisible();
    // The plaintext token went in the POST body (never a URL) against the token-free public route.
    expect(activateBody).toEqual({ identifier: IDENTIFIER, token: TOKEN });
    await assertNoSensitivePersistence(page);

    // 5) Back to sign in, then log in with the STAGED NEW password.
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByText("Border Authority")).toBeVisible();
    await page.getByPlaceholder("kooker email").fill(IDENTIFIER);
    await page.getByPlaceholder("password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Enter the Kookerverse" }).click();

    // Authenticated: the border gate hands over to the colony canvas.
    await page.waitForSelector("canvas", { timeout: 30000 });
    await expect(page.getByText("Border Authority")).toHaveCount(0);
    // The login used the STAGED new password (the whole point of the reset), not some old one.
    expect(decodeBasic(loginBasic)).toBe(`${IDENTIFIER}:${NEW_PASSWORD}`);
  });

  // Every backend rejection reason must produce ONE identical, generic UI outcome — no oracle that
  // could tell a wrong token from an expired or already-redeemed (replayed) one apart.
  for (const scenario of [
    { name: "a wrong token", status: 401 },
    { name: "an expired token", status: 410 },
    { name: "a replayed (already-redeemed) token", status: 409 },
  ]) {
    test(`${scenario.name} is rejected generically from the permanent entry and stays on the redemption screen`, async ({
      page,
    }) => {
      await page.route(ACTIVATE_ROUTE, async (route) => {
        // The real gateway returns the SAME generic message for wrong/expired/consumed/unknown.
        await route.fulfill({
          status: scenario.status,
          contentType: "application/json",
          body: JSON.stringify({ message: "Invalid or expired token" }),
        });
      });

      await page.goto("/?login=1");
      await page.getByTestId("enter-activation-link").click();
      await expect(page.getByText("Finish your password change")).toBeVisible();

      await page.getByPlaceholder("email address").fill(IDENTIFIER);
      await page.locator("input.visitor-code-input").fill(TOKEN);
      await page.getByRole("button", { name: "Activate new password" }).click();

      await expect(page.getByText(/invalid or expired token/i)).toBeVisible();
      // Still on the redemption screen — the user can re-type — and no success ever shows.
      await expect(page.getByText("Finish your password change")).toBeVisible();
      await expect(page.getByText("Password change complete")).toHaveCount(0);
      await assertNoSensitivePersistence(page);
    });
  }
});
