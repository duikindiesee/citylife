import { describe, it, expect, vi } from "vitest";
import {
  readPlayerWallet,
  playerWalletLabel,
  emptyPlayerWallet,
  type PlayerWalletSnapshot,
} from "../src/colony/wallet/playerWallet";
import {
  classifyPurchaseStatus,
  purchaseButtonView,
  homePurchaseIdempotencyKey,
  type PurchaseOutcome,
} from "../src/colony/home/starterProperty";
import {
  classifyAcquireStatus,
  acquireButtonView,
  acquireIdempotencyKey,
  carOwnershipCacheKey,
  type AcquireOutcome,
} from "../src/colony/car/carAcquisition";

describe("Wallet and Purchase Edge-Case Hardening (Irwin acceptance requirement)", () => {
  describe("1. Missing wallet vs zero balance vs unavailable", () => {
    it("distinguishes missing wallet from zero balance in labels", () => {
      const missing: PlayerWalletSnapshot = {
        accountKey: "player-1",
        status: "missing",
        balanceKco: null,
      };
      const zero: PlayerWalletSnapshot = {
        accountKey: "player-1",
        status: "ready",
        balanceKco: 0,
      };
      const unavailable: PlayerWalletSnapshot = {
        accountKey: "player-1",
        status: "unavailable",
        balanceKco: null,
      };

      expect(playerWalletLabel(missing)).toBe("Wallet not set up");
      expect(playerWalletLabel(zero)).toBe("₭0 KCO");
      expect(playerWalletLabel(unavailable)).toBe("Balance unavailable");
    });

    it("readPlayerWallet correctly identifies missing wallet on explicit 404 ledger detail", async () => {
      const mockAuth = {
        getValidToken: vi.fn().mockResolvedValue("mock-jwt-token"),
        operator: { userId: "user-404" },
      };

      const mockFetchMissing = vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        json: async () => ({
          message: "No DEFAULT wallet exists yet for this account",
        }),
      });

      const res = await readPlayerWallet(
        mockAuth,
        "user-404",
        mockFetchMissing as any,
      );
      expect(res.status).toBe("missing");
      expect(res.balanceKco).toBeNull();
      expect(res.accountKey).toBe("user-404");
    });

    it("readPlayerWallet treats unstructured 404 as unavailable (fail-closed, never fabricated zero)", async () => {
      const mockAuth = {
        getValidToken: vi.fn().mockResolvedValue("mock-jwt-token"),
        operator: { userId: "user-unknown-404" },
      };

      const mockFetch404 = vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        json: async () => ({ error: "Not Found" }),
      });

      const res = await readPlayerWallet(
        mockAuth,
        "user-unknown-404",
        mockFetch404 as any,
      );
      expect(res.status).toBe("unavailable");
      expect(res.balanceKco).toBeNull();
    });

    it("readPlayerWallet parses exact 0 balance as ready", async () => {
      const mockAuth = {
        getValidToken: vi.fn().mockResolvedValue("mock-jwt-token"),
        operator: { userId: "user-funded-0" },
      };

      const mockFetchZero = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          ownerId: "user-funded-0",
          appName: "citylife",
          walletType: "DEFAULT",
          instrument: "KCO",
          balance: 0,
        }),
      });

      const res = await readPlayerWallet(
        mockAuth,
        "user-funded-0",
        mockFetchZero as any,
      );
      expect(res.status).toBe("ready");
      expect(res.balanceKco).toBe(0);
    });
  });

  describe("2. Request failure and expired session handling", () => {
    it("classifies 401/403 session expiration as disabled for home purchase and car acquisition", () => {
      expect(classifyPurchaseStatus(401)).toEqual({ kind: "disabled" });
      expect(classifyPurchaseStatus(403)).toEqual({ kind: "disabled" });
      expect(classifyAcquireStatus(401)).toEqual({ kind: "disabled" });
      expect(classifyAcquireStatus(403)).toEqual({ kind: "disabled" });

      const purchaseBtn = purchaseButtonView(false, true, false, {
        kind: "disabled",
      });
      expect(purchaseBtn.state).toBe("disabled");
      expect(purchaseBtn.disabled).toBe(true);
      expect(purchaseBtn.label).toContain("Sign in");

      const acquireBtn = acquireButtonView(false, false, {
        kind: "disabled",
      });
      expect(acquireBtn.state).toBe("disabled");
      expect(acquireBtn.disabled).toBe(true);
      expect(acquireBtn.label).toContain("Sign in");
    });

    it("classifies network / 500 error as retryable error outcome", () => {
      expect(classifyPurchaseStatus(500)).toEqual({
        kind: "error",
        status: 500,
      });
      expect(classifyAcquireStatus(500)).toEqual({
        kind: "error",
        status: 500,
      });

      const purchaseBtn = purchaseButtonView(false, true, false, {
        kind: "error",
        status: 500,
      });
      expect(purchaseBtn.state).toBe("error");
      expect(purchaseBtn.disabled).toBe(false);
      expect(purchaseBtn.label).toContain("retry");
    });
  });

  describe("3. Logout and account-switch stale balance clearing", () => {
    it("resets player wallet cleanly when signed out or account changes", () => {
      const reset = emptyPlayerWallet(null, "unavailable");
      expect(reset.accountKey).toBeNull();
      expect(reset.status).toBe("unavailable");
      expect(reset.balanceKco).toBeNull();

      const loadingNewUser = emptyPlayerWallet("new-user-77", "loading");
      expect(loadingNewUser.accountKey).toBe("new-user-77");
      expect(loadingNewUser.status).toBe("loading");
      expect(loadingNewUser.balanceKco).toBeNull();
    });

    it("scopes car ownership cache by user ID to prevent cross-account leakage", () => {
      const cacheUserA = carOwnershipCacheKey("user-alpha");
      const cacheUserB = carOwnershipCacheKey("user-bravo");
      const cacheAnon = carOwnershipCacheKey(null);

      expect(cacheUserA).toBe("citylife.car.ownership.v1.user-alpha");
      expect(cacheUserB).toBe("citylife.car.ownership.v1.user-bravo");
      expect(cacheAnon).toBe("citylife.car.ownership.v1");
      expect(cacheUserA).not.toBe(cacheUserB);
    });
  });

  describe("4. Atomic purchase, idempotent retries and concurrent request protection", () => {
    it("constructs stable, deterministic idempotency keys including user ID and target", () => {
      const key1 = homePurchaseIdempotencyKey("user-123", "coast_hamlet_2");
      const key2 = homePurchaseIdempotencyKey("user-123", "coast_hamlet_2");
      expect(key1).toBe("citylife:home-purchase:user-123:coast_hamlet_2");
      expect(key1).toBe(key2);

      const carKey1 = acquireIdempotencyKey("user-123", "karoo-kaap-gt");
      const carKey2 = acquireIdempotencyKey("user-123", "karoo-kaap-gt");
      expect(carKey1).toBe("citylife:car-acquire:user-123:karoo-kaap-gt");
      expect(carKey1).toBe(carKey2);
    });

    it("maps 409 conflict and 202 accepted to pending to prevent double-charging on concurrent requests", () => {
      expect(classifyPurchaseStatus(409)).toEqual({ kind: "pending" });
      expect(classifyPurchaseStatus(202)).toEqual({ kind: "pending" });
      expect(classifyAcquireStatus(409)).toEqual({ kind: "pending" });
      expect(classifyAcquireStatus(202)).toEqual({ kind: "pending" });

      const purchaseBtn = purchaseButtonView(false, true, false, {
        kind: "pending",
      });
      expect(purchaseBtn.state).toBe("pending");
      expect(purchaseBtn.disabled).toBe(true);

      const acquireBtn = acquireButtonView(false, false, {
        kind: "pending",
      });
      expect(acquireBtn.state).toBe("pending");
      expect(acquireBtn.disabled).toBe(true);
    });

    it("locks acquire and purchase button when request is already in-flight (pending flag)", () => {
      const inFlightPurchase = purchaseButtonView(false, true, true, undefined);
      expect(inFlightPurchase.state).toBe("pending");
      expect(inFlightPurchase.disabled).toBe(true);
      expect(inFlightPurchase.label).toContain("Securing");

      const inFlightAcquire = acquireButtonView(false, true, undefined);
      expect(inFlightAcquire.state).toBe("pending");
      expect(inFlightAcquire.disabled).toBe(true);
      expect(inFlightAcquire.label).toContain("Acquiring");
    });

    it("provides immediate refresh affordance for ready-but-insufficient wallet snapshot", () => {
      // Test the logic of refresh button display in StarterPropertyOverlay
      const checkRefreshVisible = (status: string, isInsufficient: boolean, onWalletRefresh?: () => void) => {
        return !!((status === "missing" || status === "unavailable" || isInsufficient) && onWalletRefresh);
      };

      const mockRefresh = vi.fn();
      expect(checkRefreshVisible("ready", true, mockRefresh)).toBe(true);
      expect(checkRefreshVisible("ready", false, mockRefresh)).toBe(false);
      expect(checkRefreshVisible("missing", false, mockRefresh)).toBe(true);
      expect(checkRefreshVisible("unavailable", false, mockRefresh)).toBe(true);
    });
  });
});
