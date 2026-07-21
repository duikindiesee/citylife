// The ONE CityLife currency/amount display contract.
//
// `Number.prototype.toLocaleString()` with no argument formats in the HOST's locale, so the same
// build renders different text on different machines: a Windows box configured for South Africa
// (en-ZA) groups 1200 as "1<NBSP>200", while the hosted Ubuntu CI baseline (en-US) renders
// "1,200". That is invisible in the UI but makes HUD assertions machine-dependent — the failure
// that surfaced in playerNeighborhoodHudPrivacy.test.ts.
//
// CityLife therefore pins ONE locale for every displayed amount, regardless of host:
//
//   * comma thousands separators, ASCII — "1,200", "1,200,000"
//   * no decimal places (amounts are whole ₭ / R)
//   * negatives keep their sign; the caller supplies any "R", "₭" or currency prefix
//
// en-US is chosen because it is what the hosted CI baseline and every existing assertion already
// expect, so pinning it changes no rendered output on CI while making Windows agree.
//
// Use this for ANY number shown to a player. A bare toLocaleString() is a portability bug.

/** The pinned display locale. Never read the host locale for rendered amounts. */
export const CITYLIFE_AMOUNT_LOCALE = "en-US";

/** Format a whole amount for display, identically on every host. Non-finite input renders "0"
 *  rather than "NaN"/"∞" leaking into the HUD. */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString(CITYLIFE_AMOUNT_LOCALE, {
    useGrouping: true,
    maximumFractionDigits: 0,
  });
}
