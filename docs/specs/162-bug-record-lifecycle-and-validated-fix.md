# Spec 162 — Bug record lifecycle through to a validated fix (BUG.TRACK.1)

- **Status:** proposed for review. The record, its lifecycle and the Task API submission plan ship
  here; no UI surface is wired yet and no network call is made.
- **Depends on:** spec 160 (BUG.CAPTURE.1 — `BugCaptureContext`, merged as #415, bound for real) and
  through it spec 152 (presence address, ancestor chain) and spec 150 (canonical sol).
- **Declared structurally, not imported:** spec 159 (BUG.ANNOTATE.1, PR #419) and spec 161
  (BUG.COMPOSE.1, PR #425) are still open PRs. Their slices are declared as local interfaces
  (`BugTrackAnnotationRef`, `BugTrackBodyRef`) that their real types satisfy as-is, so this slice
  compiles and tests standalone against `main` and the three merge in any order.
- **Consumed by:** BUG.KCO.1, which pays a bounty against `bugBountySignal` and nothing else.
- **Design provenance:** the operator brief
  `bridge/from-claude-citylife/2026-07-23-in-world-bug-reporting-and-kco-bounty.md`, decomposition
  item 5.

## The product rule

A bug report is only worth persisting if it can become work, and the work is only worth rewarding if
somebody actually confirmed the fix. So the record has to carry two different things at once:

1. **Everything a fixer needs** — the capture (camera pose, presence address + ancestor chain, world
   seed, canonical sol, screenshot fingerprint), the on-screen marking, and repro / expected / actual.
2. **A trustworthy account of what happened to it** — who triaged it, which governed task it became,
   which fix was proposed, and whether a fix was **validated**, by whom, against what.

The second is the hard half, because BUG.KCO.1 pays on the validated state. Reward on validated fix
and never on report is the anti-gaming property of the whole feature — but that only holds if the
validated state cannot be minted. A self-declared `"validated": true` a reporter can write into their
own record would turn the bounty into a faucet.

## What ships

`src/colony/bug/bugTrack.ts` — pure, framework-agnostic (no three.js, no React, no DOM, no network),
mutates nothing, returns deep-frozen values. It never merges, deploys, approves or marks work DONE.

### The lifecycle

```
FILE      -> FILED
TRIAGE    -> TRIAGED        (triager | maintainer)
GOVERN    -> GOVERNED       (triager | maintainer)  + taskId, clientToken-bound
PROPOSE_FIX -> FIX_PROPOSED (maintainer)            + fixRef
REJECT_FIX  -> GOVERNED     (validator)             + fixRef, must match the one under review
VALIDATE_FIX-> VALIDATED_FIX(validator)             + fixRef, THE GATE
REJECT    -> REJECTED       (triager | maintainer)  from FILED | TRIAGED
DUPLICATE -> DUPLICATE      (triager | maintainer)  from FILED | TRIAGED  + duplicateOfReportId
```

`VALIDATED_FIX`, `REJECTED` and `DUPLICATE` are terminal. `REJECT_FIX` exists because validation
being explicit is only meaningful if refusal is a real, recorded outcome: a validator who looks and
says no drops the record back to `GOVERNED`, clears the fix under review, and leaves the refusal in
the chain.

### Five load-bearing properties

**1. There is no writable status.** `status`, `taskId`, `proposedFix` and `validation` are
projections replayed from the append-only ledger. The wire form does not carry them at all, and
`parseBugRecord` derives them from scratch. A record with `"status":"VALIDATED_FIX"` bolted on parses
as whatever its ledger actually says — which for a freshly filed report is `FILED`.

**2. The ledger is hash-chained to the report.** Each entry's `entryId` digests the previous entry's
id, the entry's own contents, and the `reportId` — which is itself the digest of the immutable core
(reporter, capture id, annotation summary, body). So an entry cannot be edited, removed, reordered or
inserted, and a validated ledger cannot be lifted onto a different report body: changing the body
changes the `reportId`, which breaks every entry in the chain.

**3. Validation is an explicit gated transition.** `validateBugFix` is the only route to
`VALIDATED_FIX`, and `guardTransition` refuses unless _all_ of:

- the record is in `FIX_PROPOSED`;
- the actor holds the `validator` role;
- the actor is **not** the reporter;
- the actor is **not** the author of the fix;
- the presented `BugFixRef` equals the fix under review **field for field** (commit sha, PR url,
  author) — so "validated against which fix" is exact rather than approximate.

Replay judges legality with the **same table** the writing path uses, so a hand-appended entry with a
correctly recomputed digest is still refused: forging the digest does not buy past the gate. The
authority for _who holds a role_ stays outside this module (the Task API's own auth); what the module
owns is which role a transition demands and that nobody with an interest in the outcome grants it.

**4. Untrusted text stays text.** A bug body is user input (spec 161's reasoning). Every stored string
is rejected if it contains a control character — including the digest's own field separator, so a
reporter cannot re-split the canonical form and mint a colliding `reportId`. Nothing here emits HTML.
The only URL a record stores is `fixRef.prUrl`, matched against a strict
`https://github.com/<owner>/<repo>/pull/<n>` pattern, so `javascript:`, `data:`, credential-bearing
and query-carrying URLs never reach storage and no fetch-on-open vector is persisted. The Task API
submission body is plain text with every untrusted block line-quoted, so reporter text cannot
impersonate a structural line such as `GOVERNANCE:` or `reported-by:`.

**5. Governed work is idempotent.** `planBugTaskSubmission` derives `clientToken` from the
`reportId`, so re-submitting the same report cannot open a second governed task, and
`recordBugGovernance` refuses a result whose `clientToken` is not the one that was planned — a record
cannot be attached to an unrelated task by feeding back somebody else's response.

### The bounty signal

`bugBountySignal(record)` returns `null` for every status but `VALIDATED_FIX`. When it does return, it
carries a `signalId` digested from the `reportId`, the ledger head and the validating entry — a
deterministic idempotency key, so BUG.KCO.1 can pay exactly once — plus `reporterId`, `fixAuthorId`,
`validatedBy`, `validatedAtMs`, the `fixRef`, and `selfFixed` when the reporter authored the fix
themselves. Self-fixing is legitimate, so it is surfaced for pricing rather than blocked or hidden.

### Audit

`renderBugRecordAudit` prints the chain as plain text: every transition with actor, role, instant,
from/to status and entry id, closing with who validated, against which commit, authored by whom, when.
This is the answer a bounty dispute needs, and it is the same data the digest covers.

## Costs

No materials or labour: this is a bookkeeping record, not a building. The real cost it manages is
review time — which is why `commitBugReport` upstream (spec 161) refuses an unready body and why
`planBugTaskSubmission` here refuses anything but a `TRIAGED` report. Untriaged reports never become
governed work.

## Out of scope

- Any UI. The reporting surface, the tracker view and the validator's console are separate work.
- The KCO reward itself (BUG.KCO.1): amounts, the payee decision, and posting through the existing
  authenticated score authority. This spec produces the signal and stops.
- Identity and role assignment. Roles arrive as caller-supplied `BugActor` values.
