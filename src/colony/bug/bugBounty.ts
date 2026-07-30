/**
 * BUG.VALIDATOR.ROLE.1 — who is allowed to validate a fix, and what a validated fix pays.
 *
 * BUG.TRACK.1 shipped a strong validated-fix gate but left one hole its own author named: the
 * `validator` role was a STRING THE CALLER SUPPLIED. Anyone who could call `validateBugFix` could
 * present `role: "validator"` and mint a payable signal. In the author's words the gate "stops
 * accidents but not intent".
 *
 * The fix is to stop treating validator authority as something the caller ASSERTS and start treating
 * it as something the system RESOLVES. This module owns that resolution and the bounty amount, both
 * as configuration so kooker-web can change them later without a code change.
 *
 * OPERATOR DECISION (bridge/from-claude-citylife/2026-07-29-kco-bounty-operator-decision.md):
 * 100 KCO per validated fix, and THE OPERATOR ALONE VALIDATES. Those are the defaults below.
 *
 * WHAT THIS DOES AND DOES NOT CLOSE — read this before trusting it:
 *  - It DOES stop a caller self-asserting the role. `validator` is no longer sufficient; the actor's
 *    identity must also be a configured validator principal, and `bugTrack` applies that check on the
 *    WRITING path and on LEDGER REPLAY through the same code, so a hand-appended entry naming an
 *    unauthorised validator is refused when the record is read back.
 *  - It does NOT, on its own, prove that the caller IS the principal they name. That is an identity
 *    question and only the auth boundary can answer it. `setBugValidatorAuthority` is the seam where
 *    that boundary plugs in: the Task API already refuses operator-gated actions without a user JWT
 *    holding an admin role (see bridge docs/runbooks/2026-07-17-ledger-operator-report-backfill.md —
 *    unauthenticated operator-report returns HTTP 401 "requires a user JWT with an admin role").
 *    Until an authority is installed the default below is allowlist-only, which is why the gap is
 *    documented here rather than papered over.
 */

/** What a validated fix pays. Operator decision: 100 KCO. Configuration, not a literal. */
export const DEFAULT_KCO_PER_VALIDATED_FIX = 100;

/**
 * Who may validate. Operator decision: the operator alone. Configuration, not a literal.
 * This is an identity allowlist, NOT a role name — the whole point is that the role name is no
 * longer sufficient on its own.
 */
export const DEFAULT_VALIDATOR_PRINCIPAL_IDS: readonly string[] = [
  "operator:kooker",
];

export interface BugBountyConfig {
  /** KCO paid once per validated fix, keyed by the deterministic signalId BUG.TRACK.1 already mints. */
  readonly kcoPerValidatedFix: number;
  /** Identities permitted to hold validator authority. */
  readonly validatorPrincipalIds: readonly string[];
}

const DEFAULT_CONFIG: BugBountyConfig = Object.freeze({
  kcoPerValidatedFix: DEFAULT_KCO_PER_VALIDATED_FIX,
  validatorPrincipalIds: Object.freeze([...DEFAULT_VALIDATOR_PRINCIPAL_IDS]),
});

let config: BugBountyConfig = DEFAULT_CONFIG;

export function getBugBountyConfig(): BugBountyConfig {
  return config;
}

/**
 * Replace the configuration (kooker-web's future admin surface calls this; that surface is NOT built
 * here). Rejects a nonsense amount and an empty allowlist rather than silently disabling the gate —
 * an empty allowlist would read as "nobody may validate" but is far more likely to be a wiring bug,
 * and a gate that fails open on a wiring bug is not a gate.
 */
export function setBugBountyConfig(next: Partial<BugBountyConfig>): void {
  const amount = next.kcoPerValidatedFix ?? config.kcoPerValidatedFix;
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("kcoPerValidatedFix must be a finite, non-negative number");
  const ids = next.validatorPrincipalIds ?? config.validatorPrincipalIds;
  if (!Array.isArray(ids) || ids.length === 0)
    throw new Error(
      "validatorPrincipalIds must be a non-empty allowlist; refusing to configure a gate nobody guards",
    );
  for (const id of ids)
    if (typeof id !== "string" || id.trim() === "")
      throw new Error(
        "validatorPrincipalIds entries must be non-empty strings",
      );
  config = Object.freeze({
    kcoPerValidatedFix: amount,
    validatorPrincipalIds: Object.freeze([...ids]),
  });
}

/** Restore the shipped operator decision. Used by tests and by a failed config rollback. */
export function resetBugBountyConfig(): void {
  config = DEFAULT_CONFIG;
}

/**
 * The seam for the real auth boundary. Given the identity an entry claims, answer whether that
 * principal genuinely holds validator authority RIGHT NOW.
 *
 * Returning `false` must always be safe. An authority that throws is treated as a refusal, because a
 * broken authority must not become an open door.
 */
export type BugValidatorAuthority = (principalId: string) => boolean;

let authority: BugValidatorAuthority | null = null;

/** Install the auth-boundary check (e.g. "this JWT is a user token holding an admin role"). */
export function setBugValidatorAuthority(
  next: BugValidatorAuthority | null,
): void {
  authority = next;
}

/**
 * The one question `bugTrack` asks. Both the writing path and ledger replay call this, so authority
 * is judged by the same rule in both directions.
 *
 * Allowlist first, then the installed authority — BOTH must agree. Ordering them this way means
 * installing an authority can only ever NARROW who may validate, never widen it past the operator's
 * configured allowlist.
 */
export function isAuthorizedBugValidator(principalId: unknown): boolean {
  if (typeof principalId !== "string" || principalId.trim() === "")
    return false;
  if (!config.validatorPrincipalIds.includes(principalId)) return false;
  if (authority === null) return true;
  try {
    return authority(principalId) === true;
  } catch {
    return false;
  }
}
