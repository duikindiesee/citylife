import { describe, expect, it } from "vitest";
import { bankPanelCopy } from "../src/colony/ui/ColonyApp";
import { ColonyRuntime } from "../src/colony/runtime";

// Player-scoped HUD privacy: normal users should see their own balance only,
// not city-wide ledger/accounting labels that imply other residents' wallets,
// land-office proceeds, or real-ledger operator telemetry.
describe("player-scoped bank HUD copy", () => {
  it("labels the player wallet privately and hides city ledger rows", () => {
    const rt = new ColonyRuntime(4242);
    const adminUi = rt.getUiState();
    const me = adminUi.citizens.list[0]!;

    rt.setOperatorName(me.displayName);
    rt.setPlayerView(true);

    const playerBank = rt.getUiState().bank;
    const copy = bankPanelCopy(playerBank);

    expect(playerBank.scope).toBe("player");
    expect(copy.title).toBe("Your wallet · ₭");
    expect(copy.rows.map((r) => r.label)).toEqual(["Your balance"]);
    expect(copy.rows[0]!.value).toBe(`₭${playerBank.deposits.toLocaleString()}`);
    expect(copy.rows.map((r) => r.label).join(" ")).not.toMatch(
      /Residents hold|Wallets|Land office|Real ledger|≈ in rand/i,
    );
    expect(copy.ledgerRows).toEqual([]);
  });

  it("keeps admin bank copy unrestricted", () => {
    const rt = new ColonyRuntime(4242);
    const adminBank = rt.getUiState().bank;
    const copy = bankPanelCopy(adminBank);

    expect(adminBank.scope).toBe("city");
    expect(copy.title).toBe("City Bank · ₭");
    expect(copy.rows.map((r) => r.label)).toEqual([
      "Residents hold",
      "≈ in rand",
      "Wallets",
      "Land office",
      "Real ledger",
    ]);
    expect(copy.rows.at(-1)!.value).toMatch(/synced|pending/);
  });
});
