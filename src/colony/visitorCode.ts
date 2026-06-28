// Hex unlock-code formatting, shared by the login gate's inline code field. Operator-issued unlock
// codes are hex; we display them grouped as XXXX-XXXX-… as the user types, and strip the hyphens
// before posting to the backend. Kept framework-free so it is unit-testable in the node test env.

/** The minimum accepted code length: the backend's 64-bit floor = 16 hex chars (up to 32 = 128-bit). */
export const MIN_CODE_HEX = 16;

/** Format raw input as an uppercase hex code grouped into 4-char blocks, capped at 32 hex chars. */
export function formatCode(raw: string): string {
  const hex = raw
    .replace(/[^0-9a-fA-F]/g, "")
    .toUpperCase()
    .slice(0, 32);
  return hex.match(/.{1,4}/g)?.join("-") ?? "";
}

/** The hyphen-free hex string sent to the backend. */
export function stripCode(formatted: string): string {
  return formatted.replace(/-/g, "");
}

/** Whether a formatted code has enough hex digits to be worth submitting. */
export function isCodeComplete(formatted: string): boolean {
  return stripCode(formatted).length >= MIN_CODE_HEX;
}
