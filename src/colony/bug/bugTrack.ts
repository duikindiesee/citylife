// BUG.TRACK.1 — the bug record lifecycle, from a filed report through to a VALIDATED FIX.
//
// This module owns one thing: the persisted life of a bug report, and the gate in front of the state
// that BUG.KCO.1 will pay a bounty on. It is pure and framework-agnostic (no three.js, no React, no
// DOM, no network) and mutates nothing — every function returns a new deep-frozen value. It never
// merges, deploys, approves or marks work DONE; it only produces the SUBMISSION a governed worker
// pipeline consumes, and records the outcome it is told about.
//
// Five properties are load-bearing, and each has a matching invariant in tests/bugTrack.test.ts:
//
//  1. THERE IS NO WRITABLE STATUS. `status`, `taskId`, `proposedFix` and `validation` are PROJECTIONS
//     replayed from the append-only ledger, never fields a caller sets. `parseBugRecord` re-derives
//     them and rejects a record whose stored projection disagrees. This is the anti-gaming property
//     the reward rail depends on: a reporter cannot mint a bounty by writing `"VALIDATED_FIX"` into
//     their own JSON, because nothing reads that field.
//
//  2. THE LEDGER IS HASH-CHAINED TO THE REPORT. Each entry's `entryId` digests the previous entry's
//     id, the entry's own contents AND the `reportId` — which is itself the digest of the report's
//     immutable core (reporter, capture, annotation, body). So an entry cannot be inserted, edited,
//     reordered or dropped, and a validated ledger cannot be lifted onto a different report body,
//     without `verifyBugRecordLedger` failing.
//
//  3. VALIDATION IS AN EXPLICIT GATED TRANSITION, NEVER AUTOMATIC. `validateBugFix` refuses unless the
//     record is in FIX_PROPOSED, the actor holds the `validator` role, the actor is NEITHER the
//     reporter NOR the author of the fix, and the `BugFixRef` presented matches the fix actually under
//     review — field for field. Nothing else in this module can reach VALIDATED_FIX. The audit answers
//     WHO validated, against WHICH fix, WHEN, and the answer is chained.
//
//  4. UNTRUSTED TEXT STAYS TEXT. A bug body is user input (BUG.COMPOSE.1's reasoning). Every stored
//     string is checked for control characters — including the digest's own field separator, so a
//     reporter cannot split a canonical form and forge a colliding id — and every untrusted block in
//     the Task API submission is line-quoted, so it cannot impersonate a structural line. Nothing here
//     emits HTML, and the only URL a record stores is a `prUrl` matched against a strict https
//     GitHub pull-request pattern, so no `javascript:`/`data:` fetch-on-open vector can be persisted.
//
//  5. GOVERNED WORK IS IDEMPOTENT. `planBugTaskSubmission` derives `clientToken` from the `reportId`,
//     so re-submitting the same report cannot open a second governed task, and `recordBugGovernance`
//     refuses a task whose returned clientToken is not the one that was planned.
//
// Cross-module seams. BUG.CAPTURE.1 is merged on main, so the capture is bound FOR REAL: the record
// embeds a genuine `BugCaptureContext` and re-verifies it through the capture module's own
// `parseBugCapture` on every parse. BUG.ANNOTATE.1 (#419) and BUG.COMPOSE.1 (#425) are still open PRs,
// so their slices are declared STRUCTURALLY — the same discipline #425 used for capture — which keeps
// this PR compiling and testing standalone against main and merging in any order.
import {
  parseBugCapture,
  serializeBugCapture,
  type BugCaptureContext,
} from "./bugCapture";
import { isAuthorizedBugValidator } from "./bugBounty";

export const BUG_RECORD_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------------------------

export type BugTrackErrorCode =
  | "INVALID_FIELD"
  | "INVALID_TEXT"
  | "INVALID_CAPTURE"
  | "EVIDENCE_MISMATCH"
  | "INVALID_FIX_REF"
  | "ILLEGAL_TRANSITION"
  | "ROLE_REQUIRED"
  | "VALIDATOR_NOT_AUTHORIZED"
  | "SELF_VALIDATION"
  | "FIX_MISMATCH"
  | "NON_MONOTONIC_TIME"
  | "LEDGER_BROKEN"
  | "PROJECTION_MISMATCH"
  | "INVALID_RECORD"
  | "UNSUPPORTED_VERSION"
  | "NOT_SUBMITTABLE"
  | "TOKEN_MISMATCH";

export class BugTrackError extends Error {
  constructor(
    readonly code: BugTrackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BugTrackError";
  }
}

// ---------------------------------------------------------------------------------------------
// lifecycle vocabulary
// ---------------------------------------------------------------------------------------------

/**
 * The lifecycle. `VALIDATED_FIX` is the only state a bounty may be paid against, and the only state
 * with no outgoing transition — once a fix is validated the record is settled.
 */
export type BugRecordStatus =
  | "FILED"
  | "TRIAGED"
  | "GOVERNED"
  | "FIX_PROPOSED"
  | "VALIDATED_FIX"
  | "REJECTED"
  | "DUPLICATE";

export type BugTransitionType =
  | "FILE"
  | "TRIAGE"
  | "GOVERN"
  | "PROPOSE_FIX"
  | "REJECT_FIX"
  | "VALIDATE_FIX"
  | "REJECT"
  | "DUPLICATE";

/**
 * Roles are supplied by the CALLER — but a role alone is only ever a CLAIM, and for the one role that
 * can mint currency that claim is no longer enough.
 *
 * BUG.VALIDATOR.ROLE.1 changed this. `reporter`, `triager` and `maintainer` remain caller-supplied,
 * because the worst a false claim there can do is move a record between working states. `validator`
 * is different: it is the only role that reaches VALIDATED_FIX, and BUG.KCO.1 pays against that
 * signal. So for VALIDATE_FIX and REJECT_FIX the actor's IDENTITY must also resolve to a configured
 * validator principal (see ./bugBounty), checked in `guardTransition` and therefore on replay too.
 *
 * What this module owns remains the cheap, often-forgotten half: which role a transition demands,
 * that the validator is nobody with an interest in the outcome, and now that the validator is
 * somebody the operator actually named.
 */
export type BugActorRole = "reporter" | "triager" | "maintainer" | "validator";

export interface BugActor {
  readonly actorId: string;
  readonly role: BugActorRole;
}

interface TransitionRule {
  readonly from: readonly BugRecordStatus[];
  readonly to: BugRecordStatus;
  readonly roles: readonly BugActorRole[];
  readonly requiresFixRef: boolean;
  readonly requiresTaskId: boolean;
  readonly requiresDuplicateOf: boolean;
}

/**
 * The whole legal state machine, in one table. `FILE` is the genesis entry and has no `from`. Replay
 * and the mutation helpers read the SAME table, so a transition that cannot be applied also cannot be
 * smuggled in through a hand-built ledger.
 */
const TRANSITIONS: Readonly<Record<BugTransitionType, TransitionRule>> = {
  FILE: {
    from: [],
    to: "FILED",
    roles: ["reporter"],
    requiresFixRef: false,
    requiresTaskId: false,
    requiresDuplicateOf: false,
  },
  TRIAGE: {
    from: ["FILED"],
    to: "TRIAGED",
    roles: ["triager", "maintainer"],
    requiresFixRef: false,
    requiresTaskId: false,
    requiresDuplicateOf: false,
  },
  GOVERN: {
    from: ["TRIAGED"],
    to: "GOVERNED",
    roles: ["triager", "maintainer"],
    requiresFixRef: false,
    requiresTaskId: true,
    requiresDuplicateOf: false,
  },
  PROPOSE_FIX: {
    from: ["GOVERNED"],
    to: "FIX_PROPOSED",
    roles: ["maintainer"],
    requiresFixRef: true,
    requiresTaskId: false,
    requiresDuplicateOf: false,
  },
  // A validator who looks and says "no" is the reason validation is not automatic. The record drops
  // back to GOVERNED so a second fix can be proposed; the refusal stays in the chain.
  REJECT_FIX: {
    from: ["FIX_PROPOSED"],
    to: "GOVERNED",
    roles: ["validator"],
    requiresFixRef: true,
    requiresTaskId: false,
    requiresDuplicateOf: false,
  },
  VALIDATE_FIX: {
    from: ["FIX_PROPOSED"],
    to: "VALIDATED_FIX",
    roles: ["validator"],
    requiresFixRef: true,
    requiresTaskId: false,
    requiresDuplicateOf: false,
  },
  REJECT: {
    from: ["FILED", "TRIAGED"],
    to: "REJECTED",
    roles: ["triager", "maintainer"],
    requiresFixRef: false,
    requiresTaskId: false,
    requiresDuplicateOf: false,
  },
  DUPLICATE: {
    from: ["FILED", "TRIAGED"],
    to: "DUPLICATE",
    roles: ["triager", "maintainer"],
    requiresFixRef: false,
    requiresTaskId: false,
    requiresDuplicateOf: true,
  },
};

export const BUG_TERMINAL_STATUSES: readonly BugRecordStatus[] = [
  "VALIDATED_FIX",
  "REJECTED",
  "DUPLICATE",
];

// ---------------------------------------------------------------------------------------------
// validation helpers
// ---------------------------------------------------------------------------------------------

export const MAX_TITLE_CHARS = 300;
export const MAX_TEXT_CHARS = 4000;
export const MAX_DETAIL_CHARS = 500;
export const MAX_STEPS = 60;

/**
 * Reject C0/C1 control characters. Two separate reasons, both load-bearing:
 *  - the canonical digest form joins fields with U+001F, so a string allowed to contain U+001F could
 *    re-split the canonical form and produce a colliding `reportId` for different content;
 *  - control characters in persisted text are the classic way to make a rendered audit trail lie
 *    about what it contains.
 * Newline and tab are allowed because a bug body legitimately has both.
 */
function assertPlainText(
  value: unknown,
  label: string,
  maxChars: number,
): string {
  if (typeof value !== "string")
    throw new BugTrackError("INVALID_TEXT", `${label} must be a string`);
  if (value.length > maxChars)
    throw new BugTrackError(
      "INVALID_TEXT",
      `${label} must be at most ${maxChars} characters`,
    );
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x0a || code === 0x09) continue;
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f))
      throw new BugTrackError(
        "INVALID_TEXT",
        `${label} must not contain control characters (found U+${code.toString(16).toUpperCase().padStart(4, "0")} at ${index})`,
      );
  }
  return value;
}

function assertNonEmptyText(
  value: unknown,
  label: string,
  maxChars: number,
): string {
  const text = assertPlainText(value, label, maxChars);
  if (text.trim() === "")
    throw new BugTrackError("INVALID_TEXT", `${label} must not be blank`);
  return text;
}

/** Ids are machine references, so they get a machine charset — never free text. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

function assertId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value))
    throw new BugTrackError(
      "INVALID_FIELD",
      `${label} must match ${String(ID_PATTERN)}`,
    );
  return value;
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new BugTrackError(
      "INVALID_FIELD",
      `${label} must be a finite number`,
    );
  return value;
}

function assertRole(value: unknown, label: string): BugActorRole {
  if (
    value !== "reporter" &&
    value !== "triager" &&
    value !== "maintainer" &&
    value !== "validator"
  )
    throw new BugTrackError(
      "INVALID_FIELD",
      `${label} must be a known bug actor role`,
    );
  return value;
}

function assertActor(actor: BugActor | undefined, label: string): BugActor {
  if (!actor || typeof actor !== "object")
    throw new BugTrackError("INVALID_FIELD", `${label} is required`);
  return {
    actorId: assertId(actor.actorId, `${label}.actorId`),
    role: assertRole(actor.role, `${label}.role`),
  };
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value as Record<string, unknown>))
    freezeDeep((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------------------------
// deterministic digest — same construction BUG.CAPTURE.1 uses, kept module-local because it is an
// identity digest and not a shared primitive.
// ---------------------------------------------------------------------------------------------

/** A control character no id, address, url or (checked) body text may contain. */
const FIELD = "";

function num(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

function fnv1a(text: string, offsetBasis: number): number {
  let hash = offsetBasis >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= text.charCodeAt(index) >>> 8;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function digest(text: string): string {
  const a = fnv1a(text, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a(text, 0x7fffffff).toString(16).padStart(8, "0");
  return `${a}${b}`;
}

// ---------------------------------------------------------------------------------------------
// the fix reference — the thing a validation is "against"
// ---------------------------------------------------------------------------------------------

/**
 * Where the fix lives. `prUrl` is the only URL this module persists, and it is matched against a
 * strict pattern rather than merely "starts with https": a tracker UI will render it as a link, and a
 * record is allowed to contain attacker-chosen text, so `javascript:`, `data:` and credential-bearing
 * or redirect-style URLs must never reach storage in the first place.
 */
export interface BugFixRef {
  readonly commitSha: string;
  readonly prUrl: string;
  readonly authorId: string;
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/;
const PR_URL_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/pull\/[1-9][0-9]{0,9}$/;

export function normalizeBugFixRef(fixRef: BugFixRef | undefined): BugFixRef {
  if (!fixRef || typeof fixRef !== "object")
    throw new BugTrackError("INVALID_FIX_REF", "a fix reference is required");
  const commitSha =
    typeof fixRef.commitSha === "string" ? fixRef.commitSha.toLowerCase() : "";
  if (!COMMIT_SHA_PATTERN.test(commitSha))
    throw new BugTrackError(
      "INVALID_FIX_REF",
      "fixRef.commitSha must be 7-64 hex characters",
    );
  if (typeof fixRef.prUrl !== "string" || !PR_URL_PATTERN.test(fixRef.prUrl))
    throw new BugTrackError(
      "INVALID_FIX_REF",
      "fixRef.prUrl must be an https github pull-request url",
    );
  return {
    commitSha,
    prUrl: fixRef.prUrl,
    authorId: assertId(fixRef.authorId, "fixRef.authorId"),
  };
}

function fixRefForm(fixRef: BugFixRef | null): string {
  return fixRef === null
    ? "nofix"
    : `${fixRef.commitSha}|${fixRef.prUrl}|${fixRef.authorId}`;
}

/** Field-for-field equality. Used by the gate, so "validated against WHICH fix" is exact. */
export function sameBugFixRef(
  a: BugFixRef | null,
  b: BugFixRef | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.commitSha === b.commitSha &&
    a.prUrl === b.prUrl &&
    a.authorId === b.authorId
  );
}

// ---------------------------------------------------------------------------------------------
// evidence seams
// ---------------------------------------------------------------------------------------------

/**
 * The part of a BUG.ANNOTATE.1 `BugAnnotationLayer` a tracked record needs. Declared structurally
 * because #419 is still an open PR; the shape is satisfied as-is once it lands.
 */
export interface BugTrackAnnotationRef {
  readonly layerId: string;
  readonly captureId: string;
  readonly annotations: readonly {
    readonly id: string;
    readonly kind: string;
  }[];
}

/**
 * The part of a BUG.COMPOSE.1 `BugReportBody` a tracked record needs — the repro/expected/actual the
 * brief calls for. Declared structurally because #425 is still an open PR; `BugReportBody` satisfies
 * it as-is, so the two merge in any order with no shim.
 */
export interface BugTrackBodyRef {
  readonly bodyId: string;
  readonly title: string;
  readonly steps: readonly string[];
  readonly expected: string;
  readonly actual: string;
  readonly bodyMarkdown: string;
}

export interface BugTrackAnnotationSummary {
  readonly layerId: string;
  readonly markCount: number;
  /** Unique mark kinds, sorted, so the summary is stable across authoring order. */
  readonly markKinds: readonly string[];
}

function normalizeBody(body: BugTrackBodyRef | undefined): BugTrackBodyRef {
  if (!body || typeof body !== "object")
    throw new BugTrackError("INVALID_FIELD", "a report body is required");
  if (!Array.isArray(body.steps) || body.steps.length === 0)
    throw new BugTrackError(
      "INVALID_FIELD",
      "body.steps must be a non-empty list",
    );
  if (body.steps.length > MAX_STEPS)
    throw new BugTrackError(
      "INVALID_FIELD",
      `body.steps must hold at most ${MAX_STEPS} entries`,
    );
  return {
    bodyId: assertId(body.bodyId, "body.bodyId"),
    title: assertNonEmptyText(body.title, "body.title", MAX_TITLE_CHARS),
    steps: body.steps.map((step, index) =>
      assertNonEmptyText(step, `body.steps[${index}]`, MAX_TEXT_CHARS),
    ),
    expected: assertNonEmptyText(
      body.expected,
      "body.expected",
      MAX_TEXT_CHARS,
    ),
    actual: assertNonEmptyText(body.actual, "body.actual", MAX_TEXT_CHARS),
    bodyMarkdown: assertPlainText(
      body.bodyMarkdown,
      "body.bodyMarkdown",
      MAX_TEXT_CHARS,
    ),
  };
}

/**
 * Re-check the annotation/capture binding at the point the two are joined, exactly as #425's
 * `attachBugEvidence` does. A tracking surface holds both and can trivially hold the wrong pair, and
 * marks presented over an image they were not drawn on are invisible to every later reviewer.
 */
function normalizeAnnotation(
  annotation: BugTrackAnnotationRef | null | undefined,
  captureId: string,
): BugTrackAnnotationSummary | null {
  if (annotation === null || annotation === undefined) return null;
  if (typeof annotation !== "object")
    throw new BugTrackError(
      "INVALID_FIELD",
      "annotation must be an object or null",
    );
  const layerId = assertId(annotation.layerId, "annotation.layerId");
  const boundTo = assertId(annotation.captureId, "annotation.captureId");
  if (boundTo !== captureId)
    throw new BugTrackError(
      "EVIDENCE_MISMATCH",
      `annotation layer ${layerId} is bound to capture ${boundTo}, not ${captureId}`,
    );
  if (!Array.isArray(annotation.annotations))
    throw new BugTrackError(
      "INVALID_FIELD",
      "annotation.annotations must be a list",
    );
  return {
    layerId,
    markCount: annotation.annotations.length,
    markKinds: Array.from(
      new Set(annotation.annotations.map((mark) => String(mark.kind))),
    ).sort(),
  };
}

/**
 * Bind the capture FOR REAL. BUG.CAPTURE.1 is on main, so rather than trusting a caller-shaped object
 * the context is round-tripped through the capture module's own verifying parser: a hand-built or
 * edited context whose `captureId` does not match its contents is rejected here, not discovered later
 * by a reviewer standing in the wrong place.
 */
function verifyCapture(
  capture: BugCaptureContext | undefined,
): BugCaptureContext {
  if (!capture || typeof capture !== "object")
    throw new BugTrackError(
      "INVALID_CAPTURE",
      "a bug capture context is required",
    );
  try {
    return parseBugCapture(serializeBugCapture(capture));
  } catch (error) {
    throw new BugTrackError(
      "INVALID_CAPTURE",
      `capture failed verification: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// the record
// ---------------------------------------------------------------------------------------------

/** One chained transition. `entryId` is a digest, not an assigned name. */
export interface BugLedgerEntry {
  readonly seq: number;
  readonly type: BugTransitionType;
  readonly actorId: string;
  readonly role: BugActorRole;
  readonly atMs: number;
  readonly fromStatus: BugRecordStatus | null;
  readonly toStatus: BugRecordStatus;
  readonly detail: string;
  readonly fixRef: BugFixRef | null;
  readonly taskId: string | null;
  readonly duplicateOfReportId: string | null;
  readonly prevEntryId: string;
  readonly entryId: string;
}

/** WHO validated, against WHICH fix, WHEN — and the chained entry that proves it. */
export interface BugValidation {
  readonly validatedBy: string;
  readonly validatedRole: BugActorRole;
  readonly validatedAtMs: number;
  readonly fixRef: BugFixRef;
  readonly entryId: string;
}

/** Everything replay derives. Nothing here is settable. */
export interface BugRecordProjection {
  readonly status: BugRecordStatus;
  readonly taskId: string | null;
  readonly proposedFix: BugFixRef | null;
  readonly validation: BugValidation | null;
  readonly ledgerHeadId: string;
  readonly ledgerHeadSeq: number;
  readonly lastEventAtMs: number;
}

/** The immutable half of a record: everything the `reportId` digests. */
export interface BugRecordCore {
  readonly recordVersion: number;
  readonly reporterId: string;
  readonly filedAtMs: number;
  readonly capture: BugCaptureContext;
  readonly annotation: BugTrackAnnotationSummary | null;
  readonly body: BugTrackBodyRef;
}

export interface BugRecord extends BugRecordCore {
  readonly reportId: string;
  readonly ledger: readonly BugLedgerEntry[];
  readonly status: BugRecordStatus;
  readonly taskId: string | null;
  readonly proposedFix: BugFixRef | null;
  readonly validation: BugValidation | null;
}

function canonicalCoreForm(core: BugRecordCore): string {
  const { capture, annotation, body } = core;
  return [
    `v=${num(core.recordVersion)}`,
    `reporter=${core.reporterId}`,
    `filed=${num(core.filedAtMs)}`,
    // The capture is self-verifying, so digesting its id is digesting all of it: presence address,
    // ancestor chain, world seed, canonical sol, camera pose and screenshot fingerprint.
    `capture=${capture.captureId}`,
    `layer=${annotation ? `${annotation.layerId}|${num(annotation.markCount)}|${annotation.markKinds.join(",")}` : "nolayer"}`,
    `body=${body.bodyId}`,
    `title=${body.title}`,
    `steps=${body.steps.join(FIELD)}`,
    `expected=${body.expected}`,
    `actual=${body.actual}`,
    `markdown=${body.bodyMarkdown}`,
  ].join(FIELD);
}

export function deriveBugReportId(core: BugRecordCore): string {
  return `bugrec_${digest(canonicalCoreForm(core))}`;
}

function canonicalEntryForm(
  reportId: string,
  entry: Omit<BugLedgerEntry, "entryId">,
): string {
  return [
    reportId,
    entry.prevEntryId,
    num(entry.seq),
    entry.type,
    entry.actorId,
    entry.role,
    num(entry.atMs),
    entry.fromStatus ?? "none",
    entry.toStatus,
    entry.detail,
    fixRefForm(entry.fixRef),
    entry.taskId ?? "notask",
    entry.duplicateOfReportId ?? "nodup",
  ].join(FIELD);
}

export function deriveBugLedgerEntryId(
  reportId: string,
  entry: Omit<BugLedgerEntry, "entryId">,
): string {
  return `bugev_${digest(canonicalEntryForm(reportId, entry))}`;
}

// ---------------------------------------------------------------------------------------------
// replay — the single source of every projected field
// ---------------------------------------------------------------------------------------------

interface TransitionRequest {
  readonly type: BugTransitionType;
  readonly actor: BugActor;
  readonly atMs: number;
  readonly detail?: string;
  readonly fixRef?: BugFixRef | null;
  readonly taskId?: string | null;
  readonly duplicateOfReportId?: string | null;
}

/**
 * The one place a transition is judged legal. Both `applyBugTransition` (writing) and
 * `verifyBugRecordLedger` (reading) go through here, so a ledger that could not have been produced
 * legally also cannot be read back as if it had been.
 */
function guardTransition(
  current: BugRecordProjection | null,
  type: BugTransitionType,
  actor: BugActor,
  atMs: number,
  fixRef: BugFixRef | null,
  taskId: string | null,
  duplicateOfReportId: string | null,
  reporterId: string,
): BugRecordStatus {
  const rule = TRANSITIONS[type];
  if (!rule)
    throw new BugTrackError(
      "ILLEGAL_TRANSITION",
      `unknown transition type: ${type}`,
    );

  if (type === "FILE") {
    if (current !== null)
      throw new BugTrackError(
        "ILLEGAL_TRANSITION",
        "FILE may only be the genesis ledger entry",
      );
  } else {
    if (current === null)
      throw new BugTrackError(
        "ILLEGAL_TRANSITION",
        `${type} requires an existing record; the ledger must open with FILE`,
      );
    if (!rule.from.includes(current.status))
      throw new BugTrackError(
        "ILLEGAL_TRANSITION",
        `${type} is not legal from ${current.status}`,
      );
    if (atMs < current.lastEventAtMs)
      throw new BugTrackError(
        "NON_MONOTONIC_TIME",
        `transition time ${atMs} precedes the previous entry at ${current.lastEventAtMs}`,
      );
  }

  if (!rule.roles.includes(actor.role))
    throw new BugTrackError(
      "ROLE_REQUIRED",
      `${type} requires one of [${rule.roles.join(", ")}]; actor holds ${actor.role}`,
    );
  if (rule.requiresFixRef && fixRef === null)
    throw new BugTrackError(
      "INVALID_FIX_REF",
      `${type} requires a fix reference`,
    );
  if (!rule.requiresFixRef && fixRef !== null)
    throw new BugTrackError(
      "INVALID_FIX_REF",
      `${type} must not carry a fix reference`,
    );
  if (rule.requiresTaskId && taskId === null)
    throw new BugTrackError("INVALID_FIELD", `${type} requires a taskId`);
  if (!rule.requiresTaskId && taskId !== null)
    throw new BugTrackError("INVALID_FIELD", `${type} must not carry a taskId`);
  if (rule.requiresDuplicateOf && duplicateOfReportId === null)
    throw new BugTrackError(
      "INVALID_FIELD",
      `${type} requires duplicateOfReportId`,
    );
  if (!rule.requiresDuplicateOf && duplicateOfReportId !== null)
    throw new BugTrackError(
      "INVALID_FIELD",
      `${type} must not carry duplicateOfReportId`,
    );

  // ---- the gate -------------------------------------------------------------------------------
  // Everything above is bookkeeping. These three checks are what make a VALIDATED_FIX worth paying a
  // bounty against, and they apply on REJECT_FIX too so a validator cannot silently retarget.
  if (type === "VALIDATE_FIX" || type === "REJECT_FIX") {
    const underReview = current?.proposedFix ?? null;
    if (!sameBugFixRef(underReview, fixRef))
      throw new BugTrackError(
        "FIX_MISMATCH",
        `${type} presented ${fixRefForm(fixRef)} but the fix under review is ${fixRefForm(underReview)}`,
      );
  }
  // BUG.VALIDATOR.ROLE.1 — holding the `validator` role is NO LONGER SUFFICIENT. The role is a
  // caller-supplied string, so on its own it stopped accidents but not intent. Authority is now
  // resolved from configuration (and, once installed, the auth boundary) rather than asserted.
  // This runs inside guardTransition deliberately: the writing path and `verifyBugRecordLedger` both
  // come through here, so an entry that could not have been written legally also cannot be READ BACK
  // as legal. A hand-appended VALIDATE_FIX naming an unauthorised validator is refused on replay even
  // when its digest chain is recomputed perfectly.
  if (type === "VALIDATE_FIX") {
    if (actor.actorId === reporterId)
      throw new BugTrackError(
        "SELF_VALIDATION",
        "the reporter may not validate the fix to their own report",
      );
    if (fixRef !== null && actor.actorId === fixRef.authorId)
      throw new BugTrackError(
        "SELF_VALIDATION",
        "the author of a fix may not validate it",
      );
  }

  // BUG.VALIDATOR.ROLE.1 — holding the `validator` role is NO LONGER SUFFICIENT. The role is a
  // caller-supplied string, so on its own it stopped accidents but not intent. Authority is now
  // RESOLVED from configuration (and, once installed, the auth boundary) rather than ASSERTED.
  //
  // This lives inside guardTransition deliberately: the writing path and `verifyBugRecordLedger` both
  // come through here, so an entry that could not have been written legally also cannot be READ BACK
  // as legal. A hand-appended VALIDATE_FIX naming an unauthorised validator is refused on replay even
  // when its digest chain is recomputed perfectly.
  //
  // It runs AFTER the self-validation checks on purpose. Both gates apply, but when the reporter or
  // the fix author is the one reaching for validation, SELF_VALIDATION is the truer answer — the
  // problem is the conflict of interest, not the allowlist. Ordering it the other way masked that
  // with a vaguer error.
  if (type === "VALIDATE_FIX" || type === "REJECT_FIX") {
    if (!isAuthorizedBugValidator(actor.actorId))
      throw new BugTrackError(
        "VALIDATOR_NOT_AUTHORIZED",
        `${type} requires a configured validator principal; ${actor.actorId} is not one`,
      );
  }

  return rule.to;
}

/**
 * Replay a ledger into its projection, verifying the hash chain, the sequence, the clock and the legal
 * state machine as it goes. This is the only producer of `status`.
 */
export function verifyBugRecordLedger(
  reportId: string,
  reporterId: string,
  entries: readonly BugLedgerEntry[],
): BugRecordProjection {
  if (!Array.isArray(entries) || entries.length === 0)
    throw new BugTrackError(
      "LEDGER_BROKEN",
      "the ledger must hold at least the FILE entry",
    );

  let projection: BugRecordProjection | null = null;
  let prevEntryId = "";

  for (let index = 0; index < entries.length; index += 1) {
    const previous: BugRecordProjection | null = projection;
    const entry = entries[index];
    if (!entry || typeof entry !== "object")
      throw new BugTrackError(
        "LEDGER_BROKEN",
        `ledger entry ${index} is not an object`,
      );
    if (entry.seq !== index)
      throw new BugTrackError(
        "LEDGER_BROKEN",
        `ledger entry ${index} claims seq ${String(entry.seq)}`,
      );
    if (entry.prevEntryId !== prevEntryId)
      throw new BugTrackError(
        "LEDGER_BROKEN",
        `ledger entry ${index} does not chain to its predecessor`,
      );

    const actor: BugActor = {
      actorId: assertId(entry.actorId, `ledger[${index}].actorId`),
      role: assertRole(entry.role, `ledger[${index}].role`),
    };
    const atMs = assertFiniteNumber(entry.atMs, `ledger[${index}].atMs`);
    const detail = assertPlainText(
      entry.detail,
      `ledger[${index}].detail`,
      MAX_DETAIL_CHARS,
    );
    const fixRef =
      entry.fixRef === null || entry.fixRef === undefined
        ? null
        : normalizeBugFixRef(entry.fixRef);
    const taskId =
      entry.taskId === null || entry.taskId === undefined
        ? null
        : assertId(entry.taskId, `ledger[${index}].taskId`);
    const duplicateOfReportId =
      entry.duplicateOfReportId === null ||
      entry.duplicateOfReportId === undefined
        ? null
        : assertId(
            entry.duplicateOfReportId,
            `ledger[${index}].duplicateOfReportId`,
          );

    const toStatus = guardTransition(
      projection,
      entry.type,
      actor,
      atMs,
      fixRef,
      taskId,
      duplicateOfReportId,
      reporterId,
    );
    if (entry.fromStatus !== (projection?.status ?? null))
      throw new BugTrackError(
        "LEDGER_BROKEN",
        `ledger entry ${index} records fromStatus ${String(entry.fromStatus)} but replay is at ${String(projection?.status ?? null)}`,
      );
    if (entry.toStatus !== toStatus)
      throw new BugTrackError(
        "LEDGER_BROKEN",
        `ledger entry ${index} records toStatus ${String(entry.toStatus)} but ${entry.type} yields ${toStatus}`,
      );

    const rebuilt: Omit<BugLedgerEntry, "entryId"> = {
      seq: index,
      type: entry.type,
      actorId: actor.actorId,
      role: actor.role,
      atMs,
      fromStatus: projection?.status ?? null,
      toStatus,
      detail,
      fixRef,
      taskId,
      duplicateOfReportId,
      prevEntryId,
    };
    const expectedId = deriveBugLedgerEntryId(reportId, rebuilt);
    if (entry.entryId !== expectedId)
      throw new BugTrackError(
        "LEDGER_BROKEN",
        `ledger entry ${index} entryId does not match its contents`,
      );

    // Annotated rather than inferred: the literal reads `previous`, which aliases `projection`, and an
    // inferred loop-carried type would be circular.
    const next: BugRecordProjection = {
      status: toStatus,
      taskId: taskId ?? previous?.taskId ?? null,
      // A proposal sets the fix under review; validating or rejecting clears the slot, so a fix can
      // never be validated twice or validated after it was already rejected.
      proposedFix: entry.type === "PROPOSE_FIX" ? fixRef : null,
      validation:
        entry.type === "VALIDATE_FIX" && fixRef !== null
          ? {
              validatedBy: actor.actorId,
              validatedRole: actor.role,
              validatedAtMs: atMs,
              fixRef,
              entryId: expectedId,
            }
          : (previous?.validation ?? null),
      ledgerHeadId: expectedId,
      ledgerHeadSeq: index,
      lastEventAtMs: atMs,
    };
    projection = next;
    prevEntryId = expectedId;
  }

  return projection as BugRecordProjection;
}

// ---------------------------------------------------------------------------------------------
// filing
// ---------------------------------------------------------------------------------------------

export interface FileBugReportInput {
  readonly reporter: BugActor;
  readonly filedAtMs: number;
  readonly capture: BugCaptureContext;
  readonly annotation?: BugTrackAnnotationRef | null;
  readonly body: BugTrackBodyRef;
  readonly detail?: string;
}

/**
 * Persist a report. The record opens in FILED with a one-entry ledger; nothing about it says anything
 * about a fix, and no path from here reaches VALIDATED_FIX without a validator.
 */
export function fileBugReport(input: FileBugReportInput): BugRecord {
  const reporter = assertActor(input?.reporter, "reporter");
  if (reporter.role !== "reporter")
    throw new BugTrackError(
      "ROLE_REQUIRED",
      "filing requires the reporter role",
    );
  const filedAtMs = assertFiniteNumber(input.filedAtMs, "filedAtMs");
  const capture = verifyCapture(input.capture);
  const annotation = normalizeAnnotation(
    input.annotation ?? null,
    capture.captureId,
  );
  const body = normalizeBody(input.body);

  const core: BugRecordCore = {
    recordVersion: BUG_RECORD_VERSION,
    reporterId: reporter.actorId,
    filedAtMs,
    capture,
    annotation,
    body,
  };
  const reportId = deriveBugReportId(core);
  const genesis = buildEntry(reportId, null, {
    type: "FILE",
    actor: reporter,
    atMs: filedAtMs,
    detail: input.detail ?? "report filed from inside CityLife",
  });
  const projection = verifyBugRecordLedger(reportId, core.reporterId, [
    genesis,
  ]);
  return freezeDeep({
    ...core,
    reportId,
    ledger: [genesis],
    status: projection.status,
    taskId: projection.taskId,
    proposedFix: projection.proposedFix,
    validation: projection.validation,
  });
}

function buildEntry(
  reportId: string,
  current: { projection: BugRecordProjection; prevEntryId: string } | null,
  request: TransitionRequest,
  reporterId = "",
): BugLedgerEntry {
  const actor = assertActor(request.actor, "actor");
  const atMs = assertFiniteNumber(request.atMs, "atMs");
  const detail = assertPlainText(
    request.detail ?? "",
    "detail",
    MAX_DETAIL_CHARS,
  );
  const fixRef =
    request.fixRef === null || request.fixRef === undefined
      ? null
      : normalizeBugFixRef(request.fixRef);
  const taskId =
    request.taskId === null || request.taskId === undefined
      ? null
      : assertId(request.taskId, "taskId");
  const duplicateOfReportId =
    request.duplicateOfReportId === null ||
    request.duplicateOfReportId === undefined
      ? null
      : assertId(request.duplicateOfReportId, "duplicateOfReportId");

  const toStatus = guardTransition(
    current?.projection ?? null,
    request.type,
    actor,
    atMs,
    fixRef,
    taskId,
    duplicateOfReportId,
    reporterId,
  );
  const seq = current ? current.projection.ledgerHeadSeq + 1 : 0;
  const parts: Omit<BugLedgerEntry, "entryId"> = {
    seq,
    type: request.type,
    actorId: actor.actorId,
    role: actor.role,
    atMs,
    fromStatus: current?.projection.status ?? null,
    toStatus,
    detail,
    fixRef,
    taskId,
    duplicateOfReportId,
    prevEntryId: current?.prevEntryId ?? "",
  };
  return freezeDeep({
    ...parts,
    entryId: deriveBugLedgerEntryId(reportId, parts),
  });
}

/**
 * Append one transition. Every mutation in this module funnels through here, so there is exactly one
 * code path that can extend a ledger, and it always re-verifies the whole chain afterwards.
 */
function applyBugTransition(
  record: BugRecord,
  request: TransitionRequest,
): BugRecord {
  if (!record || typeof record !== "object")
    throw new BugTrackError("INVALID_RECORD", "a bug record is required");
  const head = record.ledger[record.ledger.length - 1];
  if (!head)
    throw new BugTrackError(
      "LEDGER_BROKEN",
      "the record has no ledger entries",
    );
  const entry = buildEntry(
    record.reportId,
    {
      projection: {
        status: record.status,
        taskId: record.taskId,
        proposedFix: record.proposedFix,
        validation: record.validation,
        ledgerHeadId: head.entryId,
        ledgerHeadSeq: head.seq,
        lastEventAtMs: head.atMs,
      },
      prevEntryId: head.entryId,
    },
    request,
    record.reporterId,
  );
  const ledger = [...record.ledger, entry];
  const projection = verifyBugRecordLedger(
    record.reportId,
    record.reporterId,
    ledger,
  );
  return freezeDeep({
    recordVersion: record.recordVersion,
    reporterId: record.reporterId,
    filedAtMs: record.filedAtMs,
    capture: record.capture,
    annotation: record.annotation,
    body: record.body,
    reportId: record.reportId,
    ledger,
    status: projection.status,
    taskId: projection.taskId,
    proposedFix: projection.proposedFix,
    validation: projection.validation,
  });
}

// ---------------------------------------------------------------------------------------------
// the transitions
// ---------------------------------------------------------------------------------------------

export interface BugTransitionInput {
  readonly actor: BugActor;
  readonly atMs: number;
  readonly detail?: string;
}

export function triageBugReport(
  record: BugRecord,
  input: BugTransitionInput,
): BugRecord {
  return applyBugTransition(record, { ...input, type: "TRIAGE" });
}

export function rejectBugReport(
  record: BugRecord,
  input: BugTransitionInput,
): BugRecord {
  return applyBugTransition(record, { ...input, type: "REJECT" });
}

export function markBugDuplicate(
  record: BugRecord,
  input: BugTransitionInput & { readonly duplicateOfReportId: string },
): BugRecord {
  return applyBugTransition(record, {
    actor: input.actor,
    atMs: input.atMs,
    detail: input.detail,
    type: "DUPLICATE",
    duplicateOfReportId: input.duplicateOfReportId,
  });
}

export function proposeBugFix(
  record: BugRecord,
  input: BugTransitionInput & { readonly fixRef: BugFixRef },
): BugRecord {
  return applyBugTransition(record, {
    actor: input.actor,
    atMs: input.atMs,
    detail: input.detail,
    type: "PROPOSE_FIX",
    fixRef: input.fixRef,
  });
}

export function rejectBugFix(
  record: BugRecord,
  input: BugTransitionInput & { readonly fixRef: BugFixRef },
): BugRecord {
  return applyBugTransition(record, {
    actor: input.actor,
    atMs: input.atMs,
    detail: input.detail,
    type: "REJECT_FIX",
    fixRef: input.fixRef,
  });
}

/**
 * THE GATE. The only route to VALIDATED_FIX, and therefore the only route to a payable bounty.
 * `guardTransition` enforces: FIX_PROPOSED only, `validator` role only, not the reporter, not the fix
 * author, and the presented `fixRef` must equal the one under review field for field. The resulting
 * entry is chained, so who/which/when cannot be rewritten afterwards.
 */
export function validateBugFix(
  record: BugRecord,
  input: BugTransitionInput & { readonly fixRef: BugFixRef },
): BugRecord {
  return applyBugTransition(record, {
    actor: input.actor,
    atMs: input.atMs,
    detail: input.detail,
    type: "VALIDATE_FIX",
    fixRef: input.fixRef,
  });
}

// ---------------------------------------------------------------------------------------------
// Task API wiring — a report becomes governed work
// ---------------------------------------------------------------------------------------------

export interface BugTaskSubmissionOptions {
  readonly repo: string;
  readonly branch?: string;
  readonly priority?: number;
  readonly pathGlobs?: readonly string[];
  readonly extraScopeKeys?: readonly string[];
}

export interface BugTaskSubmission {
  /** Derived from the reportId: replaying a submission cannot open a second governed task. */
  readonly clientToken: string;
  readonly title: string;
  readonly body: string;
  readonly kind: "dev";
  readonly repo: string;
  readonly branch: string;
  readonly priority: number;
  readonly pathGlobs: readonly string[];
  readonly scopeKeys: readonly string[];
  readonly reviewPolicy: "MERGE";
}

export function bugTaskClientToken(reportId: string): string {
  return `bugtrack-${reportId}`;
}

/**
 * Line-quote untrusted reporter text. The submission body is PLAIN TEXT — no HTML, no markdown
 * rendering, no link resolution — and every untrusted block is prefixed, so a body containing a line
 * like "VALIDATED-FIX: yes" reads as quoted reporter text rather than as a structural field. Control
 * characters were already refused at file time, so a reporter cannot smuggle a bare CR to hide the
 * prefix.
 */
function quoteUntrusted(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * Turn a triaged report into the governed-task payload. Deliberately a PLAN and not a call: this
 * module opens nothing, merges nothing, deploys nothing and marks nothing DONE. The caller posts it
 * through the existing worker rail and feeds the result back via `recordBugGovernance`.
 */
export function planBugTaskSubmission(
  record: BugRecord,
  options: BugTaskSubmissionOptions,
): BugTaskSubmission {
  if (record.status !== "TRIAGED")
    throw new BugTrackError(
      "NOT_SUBMITTABLE",
      `only a TRIAGED report becomes governed work; this one is ${record.status}`,
    );
  const repo = assertId(options?.repo, "options.repo");
  const branch = assertId(options?.branch ?? "main", "options.branch");
  const priority = assertFiniteNumber(
    options?.priority ?? 2,
    "options.priority",
  );
  const pathGlobs = (options?.pathGlobs ?? ["src/colony/**", "tests/**"]).map(
    (glob, index) => assertPlainText(glob, `options.pathGlobs[${index}]`, 200),
  );
  const extra = (options?.extraScopeKeys ?? []).map((key, index) =>
    assertId(key, `options.extraScopeKeys[${index}]`),
  );

  const capture = record.capture;
  const body = [
    `bug-report: ${record.reportId}`,
    `reported-by: ${record.reporterId}`,
    `capture: ${capture.captureId}`,
    `world: ${capture.world.worldId} seed=${num(capture.world.seed)}`,
    `sol: ${num(capture.sol.sol)} (${num(capture.sol.hour)}:${String(capture.sol.minute).padStart(2, "0")}, ${capture.sol.isDay ? "day" : "night"})`,
    `presence: ${capture.presence.publicPresence.address} [${capture.presence.publicPresence.kind}]`,
    `portal-path: ${[...capture.presence.ancestorFrameIds].reverse().join(" > ")}`,
    record.annotation
      ? `annotation: ${record.annotation.layerId} (${num(record.annotation.markCount)} marks: ${record.annotation.markKinds.join(", ")})`
      : "annotation: none",
    "",
    "REPRO (reporter text, untrusted):",
    quoteUntrusted(
      record.body.steps.map((step, i) => `${i + 1}. ${step}`).join("\n"),
    ),
    "",
    "EXPECTED (reporter text, untrusted):",
    quoteUntrusted(record.body.expected),
    "",
    "ACTUAL (reporter text, untrusted):",
    quoteUntrusted(record.body.actual),
    "",
    "GOVERNANCE: the fix lands as ONE PR against main and is reported for review. The worker must not",
    "self-merge, deploy, approve or mark this DONE. A KCO bounty is paid only on an explicitly",
    "validated fix, and only a validator who is neither the reporter nor the fix author can grant it.",
  ].join("\n");

  return freezeDeep({
    clientToken: bugTaskClientToken(record.reportId),
    title: `BUG ${record.reportId}: ${record.body.title}`,
    body,
    kind: "dev" as const,
    repo,
    branch,
    priority,
    pathGlobs,
    scopeKeys: Array.from(
      new Set(["citylife:bug-reporting", `bug:${record.reportId}`, ...extra]),
    ),
    reviewPolicy: "MERGE" as const,
  });
}

export interface BugGovernanceResult {
  readonly taskId: string;
  readonly clientToken: string;
}

/**
 * Record that the Task API accepted the submission. The returned clientToken must be the planned one,
 * so a record cannot be attached to somebody else's task by feeding back an unrelated response.
 */
export function recordBugGovernance(
  record: BugRecord,
  input: BugTransitionInput & { readonly result: BugGovernanceResult },
): BugRecord {
  const expected = bugTaskClientToken(record.reportId);
  if (input?.result?.clientToken !== expected)
    throw new BugTrackError(
      "TOKEN_MISMATCH",
      `governed task carries clientToken ${String(input?.result?.clientToken)}, expected ${expected}`,
    );
  return applyBugTransition(record, {
    actor: input.actor,
    atMs: input.atMs,
    detail: input.detail,
    type: "GOVERN",
    taskId: input.result.taskId,
  });
}

// ---------------------------------------------------------------------------------------------
// the KCO bounty signal — the ONLY payable output
// ---------------------------------------------------------------------------------------------

export interface BugBountySignal {
  /** Deterministic idempotency key bound to the exact validated ledger head — pay once, ever. */
  readonly signalId: string;
  readonly reportId: string;
  readonly reporterId: string;
  readonly fixAuthorId: string;
  readonly validatedBy: string;
  readonly validatedAtMs: number;
  readonly fixRef: BugFixRef;
  readonly ledgerHeadId: string;
  /** The reporter fixed their own bug. Legitimate, but priced by BUG.KCO.1 rather than hidden. */
  readonly selfFixed: boolean;
}

/**
 * The reward rail's input. Returns null for EVERY status but VALIDATED_FIX — filing a report, however
 * many, produces nothing payable. That asymmetry is the anti-gaming property; this function is where
 * it is enforced rather than assumed.
 */
export function bugBountySignal(record: BugRecord): BugBountySignal | null {
  if (record?.status !== "VALIDATED_FIX") return null;
  const validation = record.validation;
  if (!validation)
    throw new BugTrackError(
      "PROJECTION_MISMATCH",
      "a VALIDATED_FIX record must carry its validation",
    );
  const head = record.ledger[record.ledger.length - 1];
  const ledgerHeadId = head ? head.entryId : "";
  return freezeDeep({
    signalId: `bugbounty_${digest([record.reportId, ledgerHeadId, validation.entryId].join(FIELD))}`,
    reportId: record.reportId,
    reporterId: record.reporterId,
    fixAuthorId: validation.fixRef.authorId,
    validatedBy: validation.validatedBy,
    validatedAtMs: validation.validatedAtMs,
    fixRef: { ...validation.fixRef },
    ledgerHeadId,
    selfFixed: validation.fixRef.authorId === record.reporterId,
  });
}

// ---------------------------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------------------------

/**
 * The wire form carries the CORE plus the LEDGER only. Every projected field is left out on purpose:
 * there is no `status` on the wire to forge.
 */
interface BugRecordWire {
  readonly recordVersion: number;
  readonly reportId: string;
  readonly reporterId: string;
  readonly filedAtMs: number;
  readonly capture: BugCaptureContext;
  readonly annotation: BugTrackAnnotationSummary | null;
  readonly body: BugTrackBodyRef;
  readonly ledger: readonly BugLedgerEntry[];
}

export function serializeBugRecord(record: BugRecord): string {
  const wire: BugRecordWire = {
    recordVersion: record.recordVersion,
    reportId: record.reportId,
    reporterId: record.reporterId,
    filedAtMs: record.filedAtMs,
    capture: record.capture,
    annotation: record.annotation,
    body: record.body,
    ledger: record.ledger,
  };
  return JSON.stringify(wire);
}

/**
 * Parse and VERIFY. In order: the capture re-verifies itself through BUG.CAPTURE.1's parser, the
 * `reportId` is re-derived from the core, and the ledger is replayed from scratch to produce the
 * status. A stored record that was edited anywhere — body text, capture, an entry, the order of
 * entries — fails here rather than reaching the reward rail.
 */
export function parseBugRecord(json: string): BugRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BugTrackError("INVALID_RECORD", "record is not valid JSON");
  }
  if (!raw || typeof raw !== "object")
    throw new BugTrackError("INVALID_RECORD", "record must be an object");
  const wire = raw as Record<string, unknown>;

  if (wire.recordVersion !== BUG_RECORD_VERSION)
    throw new BugTrackError(
      "UNSUPPORTED_VERSION",
      `unsupported bug record version: ${String(wire.recordVersion)}`,
    );
  if (!Array.isArray(wire.ledger))
    throw new BugTrackError("INVALID_RECORD", "record.ledger must be an array");

  const capture = verifyCapture(wire.capture as BugCaptureContext | undefined);
  const rawAnnotation = wire.annotation as
    | BugTrackAnnotationSummary
    | null
    | undefined;
  const annotation =
    rawAnnotation === null || rawAnnotation === undefined
      ? null
      : {
          layerId: assertId(rawAnnotation.layerId, "annotation.layerId"),
          markCount: assertFiniteNumber(
            rawAnnotation.markCount,
            "annotation.markCount",
          ),
          markKinds: (Array.isArray(rawAnnotation.markKinds)
            ? rawAnnotation.markKinds
            : []
          ).map((kind, index) =>
            assertPlainText(kind, `annotation.markKinds[${index}]`, 100),
          ),
        };
  const core: BugRecordCore = {
    recordVersion: BUG_RECORD_VERSION,
    reporterId: assertId(wire.reporterId, "reporterId"),
    filedAtMs: assertFiniteNumber(wire.filedAtMs, "filedAtMs"),
    capture,
    annotation,
    body: normalizeBody(wire.body as BugTrackBodyRef | undefined),
  };

  const reportId = deriveBugReportId(core);
  if (wire.reportId !== reportId)
    throw new BugTrackError(
      "INVALID_RECORD",
      "reportId does not match the record contents",
    );

  const projection = verifyBugRecordLedger(
    reportId,
    core.reporterId,
    wire.ledger as readonly BugLedgerEntry[],
  );
  return freezeDeep({
    ...core,
    reportId,
    ledger: (wire.ledger as readonly BugLedgerEntry[]).map((entry) => ({
      ...entry,
    })),
    status: projection.status,
    taskId: projection.taskId,
    proposedFix: projection.proposedFix,
    validation: projection.validation,
  });
}

// ---------------------------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------------------------

/**
 * The human-readable chain: plain text, no HTML, no links resolved. Reads bottom-up as "who did what,
 * when, against which fix" — the answer a bounty dispute needs.
 */
export function renderBugRecordAudit(record: BugRecord): string {
  const lines = [
    `bug-report ${record.reportId}`,
    `status     ${record.status}`,
    `reporter   ${record.reporterId}`,
    `capture    ${record.capture.captureId} @ ${record.capture.presence.publicPresence.address}`,
    `task       ${record.taskId ?? "-"}`,
    "ledger:",
  ];
  for (const entry of record.ledger) {
    const bits = [
      `  #${entry.seq}`,
      entry.type.padEnd(12),
      `${entry.actorId} (${entry.role})`,
      `at ${num(entry.atMs)}`,
      `${entry.fromStatus ?? "-"} -> ${entry.toStatus}`,
    ];
    if (entry.fixRef)
      bits.push(`fix ${entry.fixRef.commitSha} by ${entry.fixRef.authorId}`);
    if (entry.taskId) bits.push(`task ${entry.taskId}`);
    if (entry.duplicateOfReportId)
      bits.push(`dup-of ${entry.duplicateOfReportId}`);
    bits.push(`[${entry.entryId}]`);
    lines.push(bits.join(" "));
  }
  const validation = record.validation;
  lines.push(
    validation
      ? `validated  by ${validation.validatedBy} (${validation.validatedRole}) at ${num(validation.validatedAtMs)} against ${validation.fixRef.commitSha} authored by ${validation.fixRef.authorId} [${validation.entryId}]`
      : "validated  no",
  );
  return lines.join("\n");
}
