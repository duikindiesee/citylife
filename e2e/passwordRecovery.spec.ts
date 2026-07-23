import { test, expect } from "@playwright/test";

// Deterministic coverage for the signed-out CityLife password-recovery UX (PWD.REC R1, S4). The
// backend is fully mocked via route interception so these tests never touch a live gateway: they
// assert the CLIENT flow — a LOCKED-OUT (unauthenticated) owner initiating R1 without any current
// credentials, the generic one-time reference, no secret persistence, and the hand-off to the shipped
// activation screen.
//
// `/?login=1` forces the login form (it only SHOWS the form, never bypasses auth). There is no seeded
// session, so the whole flow runs fully anonymous — exactly the locked-out case.

const RECOVERY_ROUTE = "**/api/users/password-recovery-request";
const REQUEST_REF = "A1B2-C3D4";
// Obviously-fake throwaway secrets — no real entropy, safe in a public repo.
const NEW_PASSWORD = "brand-new-pass-1234";
const IDENTIFIER = "locked-out@test.com";

test.describe("Signed-out password recovery UX (PWD.REC R1)", () => {
  test("a locked-out user initiates R1 with no current credentials, sees a one-time reference, and hands off to activation", async ({
    page,
  }) => {
    let posted: unknown = null;
    let sawAuthHeader = false;
    await page.route(RECOVERY_ROUTE, async (route) => {
      posted = JSON.parse(route.request().postData() ?? "null");
      sawAuthHeader = Boolean(route.request().headers()["authorization"]);
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ status: "RECEIVED", requestRef: REQUEST_REF }),
      });
    });

    await page.goto("/?login=1");
    // The recovery action is clearly visible on the signed-out gate.
    await page.getByRole("button", { name: "Forgot password?" }).click();

    await expect(page.getByText("Reset your password")).toBeVisible();
    // Locked out means NO current password is asked for anywhere on this screen.
    await expect(page.getByPlaceholder("current password")).toHaveCount(0);

    await page.getByPlaceholder("email or username").fill(IDENTIFIER);
    await page.getByPlaceholder(/new password \(min/).fill(NEW_PASSWORD);
    await page.getByPlaceholder("confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request password reset" }).click();

    // The one-time reference is shown exactly once, with the read-to-your-operator instruction.
    await expect(page.getByTestId("recovery-ref")).toHaveText(REQUEST_REF);
    await expect(page.getByText(/read this one-time reference/i)).toBeVisible();

    // R1 posted only {identifier, newPassword} to the exact route, with no Authorization header.
    expect(posted).toEqual({
      identifier: IDENTIFIER,
      newPassword: NEW_PASSWORD,
    });
    expect(sawAuthHeader).toBe(false);

    // Secrets never appear in the URL...
    expect(page.url()).not.toContain(NEW_PASSWORD);
    expect(page.url()).not.toContain(REQUEST_REF);
    // ...and nothing sensitive is written to local/session storage.
    const storage = await page.evaluate(() => ({
      session: JSON.stringify(window.sessionStorage),
      local: JSON.stringify(window.localStorage),
    }));
    expect(storage.session).not.toContain(NEW_PASSWORD);
    expect(storage.session).not.toContain(REQUEST_REF);
    expect(storage.local).not.toContain(NEW_PASSWORD);
    expect(storage.local).not.toContain(REQUEST_REF);

    // Clean hand-off to the SHIPPED activation-token screen (no parallel activation mechanism), with
    // the identifier prefilled so the redeemed token resolves the same account.
    await page
      .getByRole("button", { name: "I have my activation token" })
      .click();
    await expect(page.getByText("Finish your password change")).toBeVisible();
    await expect(page.getByPlaceholder("email address")).toHaveValue(
      IDENTIFIER,
    );
  });

  test("a nonexistent identifier still returns a generic reference — no account-existence disclosure", async ({
    page,
  }) => {
    // The backend returns 202 + a ref even for an unknown account; the UI must look identical to the
    // eligible case and never say 'no such account'.
    await page.route(RECOVERY_ROUTE, async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ status: "RECEIVED", requestRef: "9F9F-9F9F" }),
      });
    });

    await page.goto("/?login=1");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await page
      .getByPlaceholder("email or username")
      .fill("definitely-not-a-real-user");
    await page.getByPlaceholder(/new password \(min/).fill(NEW_PASSWORD);
    await page.getByPlaceholder("confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request password reset" }).click();

    await expect(page.getByTestId("recovery-ref")).toHaveText("9F9F-9F9F");
    await expect(
      page.getByText(/no such account|not found|doesn't exist/i),
    ).toHaveCount(0);
  });

  test("a client-side mismatch or too-short password never reaches the backend", async ({
    page,
  }) => {
    let hit = false;
    await page.route(RECOVERY_ROUTE, async (route) => {
      hit = true;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: "{}",
      });
    });

    await page.goto("/?login=1");
    await page.getByRole("button", { name: "Forgot password?" }).click();

    // Too short (< 12) — the native minLength gate blocks submit before anything is sent (the same
    // belt-and-suspenders the signed-in change panel uses). The security invariant is that it never
    // reaches the backend.
    await page.getByPlaceholder("email or username").fill(IDENTIFIER);
    await page.getByPlaceholder(/new password \(min/).fill("short");
    await page.getByPlaceholder("confirm new password").fill("short");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request password reset" }).click();
    await expect(page.getByText("Reset your password")).toBeVisible(); // still on the form
    expect(hit).toBe(false);

    // Now a full-length mismatch (both 12+ so native validation passes) — the local JS validator
    // catches it and shows a friendly message, still without hitting the backend.
    await page.getByPlaceholder(/new password \(min/).fill(NEW_PASSWORD);
    await page
      .getByPlaceholder("confirm new password")
      .fill("does-not-match-9999");
    await page.getByRole("button", { name: "Request password reset" }).click();
    await expect(page.getByText(/don't match/i)).toBeVisible();

    expect(hit).toBe(false);
  });

  test("password fields are cleared after a failed R1 request, identifier preserved for retry", async ({
    page,
  }) => {
    await page.route(RECOVERY_ROUTE, async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: "{}",
      });
    });

    await page.goto("/?login=1");
    await page.getByRole("button", { name: "Forgot password?" }).click();

    await page.getByPlaceholder("email or username").fill(IDENTIFIER);
    await page.getByPlaceholder(/new password \(min/).fill(NEW_PASSWORD);
    await page.getByPlaceholder("confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request password reset" }).click();

    // The generic retry message appears — oracle-safe (no status detail leaked).
    await expect(page.getByText(/try again in a minute/i)).toBeVisible();

    // Both plaintext password fields must be empty; identifier is preserved so the user can retry.
    await expect(page.getByPlaceholder(/new password \(min/)).toHaveValue("");
    await expect(page.getByPlaceholder("confirm new password")).toHaveValue("");
    await expect(page.getByPlaceholder("email or username")).toHaveValue(
      IDENTIFIER,
    );
  });

  test("the signed-out recovery entry is distinct from token redemption and returns to sign in", async ({
    page,
  }) => {
    await page.goto("/?login=1");
    // Recovery is the only password-related entry on an ordinary login screen. Token redemption is
    // contextual after a recovery request or signed-in change, not permanent login clutter.
    await expect(
      page.getByRole("button", { name: "Forgot password?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enter your activation token" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByText("Reset your password")).toBeVisible();
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByText("Border Authority")).toBeVisible();
  });
});
