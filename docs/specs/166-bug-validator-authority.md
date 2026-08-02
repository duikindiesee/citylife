# Spec 166 — Validator authority is resolved, not asserted (BUG.VALIDATOR.ROLE.1)

Status: proposed
Depends on: spec 162 (bug record lifecycle, BUG.TRACK.1) — merged
Feeds: BUG.KCO.1 (bounty payment)

## The hole

BUG.TRACK.1 built a strong validated-fix gate: `VALIDATE_FIX` is legal only from `FIX_PROPOSED`, only
for the `validator` role, only when the actor is neither the reporter nor the fix author, and only
when the presented `BugFixRef` matches the fix under review field for field. Status is a projection
replayed from a hash-chained ledger, so nobody can write `"VALIDATED_FIX"` into their own JSON.

Its author still flagged what remained, and was right to: **the `validator` role was a string the
caller supplied.** In their words the gate "stops accidents but not intent". BUG.KCO.1 pays 100 KCO
on the validated-fix signal, so anyone who could call `validateBugFix` with `role: "validator"` could
mint currency. Every other check passes for a stranger — they are not the reporter, not the fix
author, and the fix ref is whatever is genuinely under review.

## The change

Validator authority stops being something a caller **asserts** and becomes something the system
**resolves**.

`src/colony/bug/bugBounty.ts` owns that resolution:

- `validatorPrincipalIds` — an identity allowlist. Default `["operator:kooker"]`.
- `kcoPerValidatedFix` — default `100`.
- `setBugValidatorAuthority(fn)` — the seam where the real auth boundary plugs in.

`src/colony/authClient.ts` installs that seam for the live browser path. The principal is derived
from the already-accepted CityLife JWT's stable `userId` claim (`operator:<userId>` unless the claim is
already namespaced) and is honored only while the session holds an admin/operator role. Signed-out
sessions, CityLife players/visitors, wrong admin identities and bot principals all fail closed before
any validation ledger entry or bounty signal can be produced.

`guardTransition` now additionally requires, for `VALIDATE_FIX` **and** `REJECT_FIX`, that the
actor's identity resolves to a configured validator principal.

Three placement decisions carry the weight:

**It lives in `guardTransition`, not in `validateBugFix`.** The writing path and
`verifyBugRecordLedger` both route through that function, which is why BUG.TRACK.1 could claim a
hand-appended entry is refused on replay. Putting the identity check anywhere else would have created
a rule the writer enforces and the reader does not — so a forged ledger with a recomputed digest
chain would replay as valid. It is tested directly: a hand-built `VALIDATE_FIX` naming an
unauthorised validator, with a perfectly recomputed `entryId`, is refused on parse.

**It runs AFTER the self-validation checks.** Both gates apply, but when the reporter or the fix
author reaches for validation, `SELF_VALIDATION` is the truer answer — the problem is the conflict of
interest, not the allowlist. Ordering it the other way masked a precise error with a vaguer one, and
broke four existing tests that were right to expect the specific code.

**The allowlist is consulted BEFORE the installed authority, and both must agree.** That ordering
means installing an authority can only ever narrow who may validate, never widen it past the
identities the operator configured. A buggy or hostile authority cannot promote a stranger.

`REJECT_FIX` is gated as well as `VALIDATE_FIX`. Rejection mints nothing, but ungated it would let a
stranger veto every proposed fix indefinitely.

## What this does not close

It does not prove the caller **is** the principal they name. That is an identity question and only
the auth boundary can answer it; a client-side module cannot verify a signature it has no key for.
`setBugValidatorAuthority` is where that answer arrives. The shipped AuthClient wiring installs it
from the signed-in JWT role/user identity; without a signed-in admin/operator session, validation is
denied even when a caller names the configured principal.

This is stated plainly rather than papered over, because a security note that overclaims is worse
than none. What changed is real: the role name alone is no longer sufficient, and the check now
survives replay.

## Failure posture

The gate fails closed. An empty allowlist is refused at configuration time — it reads as "nobody may
validate" but is overwhelmingly more likely to be a wiring bug, and a gate that disables itself on a
wiring bug is not a gate. An authority that throws is treated as a refusal, so an unreachable auth
service cannot become an open door.

## Configuration, not literals

The operator's decision (100 KCO per validated fix, the operator alone validates — recorded in
`bridge/from-claude-citylife/2026-07-29-kco-bounty-operator-decision.md`) ships as **defaults**, so
kooker-web can change both later. That admin surface is deliberately **not** built here.

## Evidence

All assertions were verified to discriminate: with the authority check removed from
`guardTransition`, **7 of the 50 tests fail**; with it restored, 50/50 pass. Typecheck clean.
The 39 pre-existing BUG.TRACK.1 tests are unmodified and still green.
