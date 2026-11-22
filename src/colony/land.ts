// Spec 085 — the land economy's pure money math. The in-game currency is the Kook (₭, ledger.ts);
// the operator anchors it at ~25 ZAR per ₭, so a plot reads in both. Everything here is pure and
// deterministic — prices and the starter deposit replay identically for the same inputs, so the
// economy is reproducible and unit-testable headless.

export interface LandConfig {
  /** Real-world anchor: rand per Kook (operator's 25:1) — drives the HUD's ZAR readout only. */
  zarPerKook: number;
  /** ₭ charged per full parcel square metre. */
  pricePerM2: number;
  /** ASSUMPTION: old flat premium exceeded a compact plot; use +25% at the waterline, fading linearly over 60 cells (240 m). */
  waterfrontPremiumPct: number;
  waterfrontReachCells: number;
  /** Deposit covers the dearest suburban plot (waterfront Large = 340 ₭); smallholdings are aspirational. */
  starterDepositMin: number;
  /** + a seeded 0..spread on top, so wallets vary. */
  starterDepositSpread: number;
}

/** The deterministic ₭ price of a plot: its buildable area plus a waterfront premium. Rounded so a
 *  deed never costs a fraction. */
export function plotPriceBreakdown(areaM2: number, distToWater: number, cfg: LandConfig): { baseKco: number; premiumKco: number; totalKco: number } {
  const baseKco = Math.round(areaM2 * cfg.pricePerM2);
  const reach = Math.max(0, 1 - Math.max(0, distToWater) / cfg.waterfrontReachCells);
  const totalKco = Math.round(areaM2 * cfg.pricePerM2 * (1 + cfg.waterfrontPremiumPct * reach));
  return { baseKco, premiumKco: totalKco - baseKco, totalKco };
}

export function plotPriceKook(
  areaM2: number,
  distToWater: number,
  cfg: LandConfig,
): number {
  return plotPriceBreakdown(areaM2, distToWater, cfg).totalKco;
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
