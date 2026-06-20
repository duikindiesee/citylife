import { describe, it, expect } from "vitest";
import {
  createLedger,
  post,
  walletDeposits,
  walletCount,
  bankDeposits,
} from "../src/colony/ledger";

describe("ledger wallet helpers (spec 085 — the active ₭ economy)", () => {
  it("walletDeposits sums only citizen: wallets, walletCount counts them", () => {
    const l = createLedger();
    post(l, "joe arrives", [
      { account: "citizen:citizen_joe", amount: 675 },
      { account: "arrivals", amount: -675 },
    ]);
    post(l, "viw arrives", [
      { account: "citizen:citizen_viw", amount: 787 },
      { account: "arrivals", amount: -787 },
    ]);
    expect(walletDeposits(l)).toBe(1462);
    expect(walletCount(l)).toBe(2);
  });

  it("ignores the land office and arrivals source — only resident wallets count as deposits", () => {
    const l = createLedger();
    post(l, "mara arrives", [
      { account: "citizen:citizen_mara", amount: 961 },
      { account: "arrivals", amount: -961 },
    ]);
    post(l, "mara buys", [
      { account: "citizen:citizen_mara", amount: -230 },
      { account: "land", amount: 230 },
    ]);
    expect(walletDeposits(l)).toBe(731); // 961 - 230, the land office's 230 is excluded
    expect(walletCount(l)).toBe(1);
  });

  it("does not confuse the retired settler accounts with the active wallets", () => {
    const l = createLedger();
    post(l, "legacy settler", [
      { account: "settler:42", amount: 5000 },
      { account: "earth", amount: -5000 },
    ]);
    post(l, "citizen", [
      { account: "citizen:citizen_x", amount: 700 },
      { account: "arrivals", amount: -700 },
    ]);
    expect(walletDeposits(l)).toBe(700); // citizen only
    expect(bankDeposits(l)).toBe(5000); // legacy settler path, kept for back-compat
    expect(walletCount(l)).toBe(1);
  });
});
