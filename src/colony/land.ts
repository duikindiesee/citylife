// Spec 085 — the land economy's pure money math. The in-game currency is the Kook (₭, ledger.ts);
// the operator anchors it at ~25 ZAR per ₭, so a plot reads in both. Everything here is pure and
// deterministic — prices and the starter deposit replay identically for the same inputs, so the
// economy is reproducible and unit-testable headless.

export interface LandConfig {
  /** Real-world anchor: rand per Kook (operator's 25:1) — drives the HUD's ZAR readout only. */
  zarPerKook: number;
  /** ₭ charged per house-zone cell (the plot's buildable footprint). */
  plotAreaRate: number;
  /** ₭ added to a shore-side plot, decaying 2 ₭ per cell of distance to water (0 inland). */
  waterfrontPremium: number;
  /** ₭ a newcomer arrives holding — always covers the dearest plot so everyone can buy in. */
  starterDepositMin: number;
  /** + a seeded 0..spread on top, so wallets vary. */
  starterDepositSpread: number;
}

/** The deterministic ₭ price of a plot: its buildable area plus a waterfront premium. Rounded so a
 *  deed never costs a fraction. */
export function plotPriceKook(
  houseZoneArea: number,
  distToWater: number,
  cfg: LandConfig,
): number {
  const water = Math.max(
    0,
    cfg.waterfrontPremium - Math.max(0, distToWater) * 2,
  );
  return Math.round(houseZoneArea * cfg.plotAreaRate + water);
}

/** A plot's price in rand, for the HUD's human-readable readout. */
export function kookToZar(kook: number, cfg: LandConfig): number {
  return Math.round(kook * cfg.zarPerKook);
}

// A small splitmix-style avalanche so the deposit varies wildly between nearby citizen seeds.
function hash(seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** A citizen's seeded off-world holdings, injected at the border as their ₭ wallet. Deterministic
 *  per seed; min + 0..spread, so every arrival can afford the dearest plot with room to build. */
export function starterDeposit(seed: number, cfg: LandConfig): number {
  return (
    cfg.starterDepositMin + (hash(seed >>> 0) % (cfg.starterDepositSpread + 1))
  );
}
