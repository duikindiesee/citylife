import { test, expect, type Page } from "@playwright/test";

// Deterministic coverage for the CityLife password-change activation UX (PWD.ACT PR-E). The backend
// is fully mocked via route interception so these tests never depend on a live gateway: they assert
// the CLIENT flow — the login-gate token redemption and the signed-in change → pending sign-out.
//
// The login gate renders before the colony canvas, so `/?login=1` (force the login form, no bypass)
// is enough for the public redemption path; the authenticated path seeds a real session shape the way
// AuthClient.restore() reads it, exactly like cityBuilderRoleGate.spec.ts.

const SESSION_STORAGE_KEY = "citylife.session.v5";
const ACTIVATE_ROUTE = "**/api/users/password-activate";
const CHANGE_ROUTE = "**/api/users/me/password-change-request";
// An obviously-fake 32-hex fixture (the exact shape kooker-service-user issues: 16 random bytes),
// built from a repeated block so it carries no real entropy and can never look like a live token.
const TOKEN = "ABCD1234".repeat(4);

// The init script runs on every load INCLUDING the post-change-request reload. We deliberately do
// NOT re-seed once the pending flag is set: that mirrors the backend truly revoking the session on
// E1, so the reload genuinely lands signed-out at the login gate (rather than a test artifact
// re-authenticating the user).
function seedSession(page: Page, roles: string[]) {
  return page.addInitScript(
    ({ key, roles: sessionRoles }) => {
      if (window.sessionStorage.getItem("citylife.pwdChangePending") === "1") {
        return; // change requested → session revoked; stay signed out
      }
      const session = {
        token: "e2e-fake-token",
        refreshToken: "e2e-fake-refresh",
        expiresAt: Date.now() + 1000 * 60 * 60 * 8,
        operator: {
          id: "E2E Tester",
          userId: "e2e-user",
          scopes: [],
          roles: sessionRoles,
        },
      };
      window.sessionStorage.setItem(key, JSON.stringify(session));
    },
    { key: SESSION_STORAGE_KEY, roles },
  );
}

test.describe("Password activation UX (PWD.ACT PR-E)", () => {
  test("login gate redeems an activation token and confirms success, then returns to sign in", async ({
    page,
  }) => {
    let posted: unknown = null;
    await page.route(ACTIVATE_ROUTE, async (route) => {
      posted = JSON.parse(route.request().postData() ?? "null");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ userId: 7, status: "ACTIVATED" }),
      });
    });

    await page.goto("/?login=1");
    await page.getByRole("button", { name: "Enter your activation token" }).click();

    await expect(
      page.getByText("Finish your password change"),
    ).toBeVisible();
    await page.getByPlaceholder("email address").fill("player@test.com");
    await page
      .locator("input.visitor-code-input")
      .fill(TOKEN); // formatCode regroups it as XXXX-XXXX-…
    await page
      .getByRole("button", { name: "Activate new password" })
      .click();

    await expect(page.getByText("Password change complete")).toBeVisible();
    await expect(page.getByText("Activated", { exact: true })).toBeVisible();
    // The plaintext token was sent in the body (never a URL), and the identifier is the email.
    expect(posted).toEqual({ identifier: "player@test.com", token: TOKEN });
    expect(page.url()).not.toContain(TOKEN);

    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByText("Border Authority")).toBeVisible();
  });

  test("a bad token shows one generic error and stays on the redemption screen", async ({
    page,
  }) => {
    await page.route(ACTIVATE_ROUTE, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Invalid or expired code" }),
      });
    });

    await page.goto("/?login=1");
    await page.getByRole("button", { name: "Enter your activation token" }).click();
    await page.getByPlaceholder("email address").fill("player@test.com");
    await page.locator("input.visitor-code-input").fill(TOKEN);
    await page.getByRole("button", { name: "Activate new password" }).click();

    await expect(page.getByText(/invalid or expired code/i)).toBeVisible();
    await expect(
      page.getByText("Finish your password change"),
    ).toBeVisible();
  });

  test("a signed-in user requests a change and is dropped to a signed-out pending state", async ({
    page,
  }) => {
    // Loads the full colony canvas (slow under headless, no GPU) and then reloads to the login gate —
    // give it generous headroom over the default 60s so a cold scene load never trips the cap.
    test.setTimeout(150_000);
    await seedSession(page, ["CITYLIFE_PLAYER"]);
    await page.route(CHANGE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForTimeout(1500);

    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("password-change-modal")).toBeVisible();
    await page.getByPlaceholder("current password").fill("old-pass-1234");
    await page.getByPlaceholder(/new password \(min/).fill("brand-new-pass-5678");
    await page.getByPlaceholder("confirm new password").fill("brand-new-pass-5678");
    await page.getByRole("button", { name: "Request change" }).click();

    // The session is cleared and the page reloads to the login gate with the one-shot pending notice.
    await expect(page.getByText(/waiting on activation/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Border Authority")).toBeVisible();
    // Fully signed out — the colony canvas is gone.
    await expect(page.locator("canvas")).toHaveCount(0);
  });

  test("client-side new-password confirmation mismatch never reaches the backend", async ({
    page,
  }) => {
    // Also loads the colony canvas — same generous headroom for a cold headless scene load.
    test.setTimeout(150_000);
    let hit = false;
    await seedSession(page, ["CITYLIFE_PLAYER"]);
    await page.route(CHANGE_ROUTE, async (route) => {
      hit = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForTimeout(1500);

    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByPlaceholder("current password").fill("old-pass-1234");
    await page.getByPlaceholder(/new password \(min/).fill("brand-new-pass-5678");
    await page.getByPlaceholder("confirm new password").fill("does-not-match-9999");
    await page.getByRole("button", { name: "Request change" }).click();

    await expect(page.getByText(/don't match/i)).toBeVisible();
    expect(hit).toBe(false);
  });
});
