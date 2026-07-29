// BUG.COMPOSE.1 — composing the bug report: the body, the assisted repro chatbox, and the structural
// attachment to the capture/annotation evidence.
//
// The operator's ask (bridge/from-claude-citylife/2026-07-23-in-world-bug-reporting-and-kco-bounty.md,
// items 3 and 4) has two halves. The first is a Markdown body with Mermaid diagrams, rendered strictly
// locally — that lives in `bugMarkdown.ts` and `bugMermaid.ts`. The second is "a prompt chatbox that
// helps the reporter write repro steps, expected vs actual", and that is this module.
//
// Five properties are load-bearing, each with a matching invariant in tests/bugCompose.test.ts:
//
//  1. THE COMPOSER ASKS; IT NEVER WRITES. Every question comes from a frozen catalogue of constant
//     strings, and an answer is stored as the reporter typed it. A composer that "tidies up" a repro
//     step is producing a report that says something the reporter did not say — and the person who
//     later has to defend that report in a bounty dispute is the reporter. The catalogue also never
//     interpolates draft text into a question, so untrusted body text can never be reflected back
//     through the assistant's own voice.
//
//  2. EXPECTED AND ACTUAL MUST DIFFER, AND NEITHER MAY BE A NOISE PHRASE. "Expected: it works /
//     Actual: it doesn't work" is the single most common useless bug report, and it is the one thing
//     an assistant can catch mechanically. Both checks BLOCK the commit rather than warn.
//
//  3. EVIDENCE IS ATTACHED STRUCTURALLY, AND THE BINDING IS CHECKED. `BugComposeCaptureRef` and
//     `BugComposeAnnotationRef` declare exactly the parts of BUG.CAPTURE.1 and BUG.ANNOTATE.1 this
//     module needs; a `BugCaptureContext` and a `BugAnnotationLayer` satisfy them as-is with no shim.
//     `attachBugEvidence` REFUSES an annotation layer whose `captureId` is not the capture's — an
//     arrow that means "this kerb is wrong", filed against a different screenshot, asserts something
//     false with the reporter's authority behind it.
//
//  4. A COMMITTED REPORT IS A SNAPSHOT WITH A SELF-VERIFYING ID. `bodyId` is the same FNV-1a digest
//     construction `bugCapture.ts` and `bugAnnotation.ts` use, so a reviewer learns the shape once.
//     It digests the SOURCE fields, never the rendered document — the document is a projection of
//     `bodyMarkdown`, and folding it in would make every historical id change the day the renderer
//     gains a feature.
//
//  5. THE CANONICAL MARKDOWN CANNOT BE FORGED FROM INSIDE A FIELD. `renderBugReportMarkdown` emits
//     `## Expected` / `## Actual` sections; a reporter whose ACTUAL text begins with `## Expected`
//     would otherwise mint a second, contradictory section that reads as the tool's own. Block
//     structure in Markdown is decided at the START of a line, so each single-line field is emitted
//     with its leading structural character escaped.
//
// Pure and framework-agnostic: no DOM, no React, no three.js, no network. `projectBugComposeView`
// hands a surface everything it needs to draw, so the view layer stays a 1:1 mapping with no logic of
// its own to test.

import {
  bugMarkdownPlainText,
  renderBugMarkdown,
  sanitizeBugText,
  type BugMarkdownDocument,
} from "./bugMarkdown";

export const BUG_REPORT_BODY_VERSION = 1;

export type BugComposeErrorCode =
  | "INVALID_FIELD"
  | "FIELD_TOO_LONG"
  | "TOO_MANY_STEPS"
  | "UNKNOWN_PROMPT"
  | "PROMPT_NOT_ANSWERABLE"
  | "EVIDENCE_MISMATCH"
  | "INVALID_EVIDENCE"
  | "NOT_READY"
  | "INVALID_REPORT"
  | "UNSUPPORTED_VERSION"
  | "ID_MISMATCH";

export class BugComposeError extends Error {
  constructor(
    readonly code: BugComposeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BugComposeError";
  }
}

export const MAX_FIELD_CHARS = 2000;
export const MAX_STEPS = 40;
export const MAX_TRANSCRIPT_TURNS = 200;

// ---------------------------------------------------------------------------------------------
// shared helpers (same construction as bugCapture.ts / bugAnnotation.ts, deliberately)
// ---------------------------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.getOwnPropertyNames(value))
    deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
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

/** Field separator: a control character `sanitizeBugText` has already removed from every field, so
 *  two different field splits can never collide into the same canonical string. */
const FIELD = "";

function num(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

/** One line, control characters removed, whitespace collapsed. Fields are single-line by contract so
 *  that nothing a reporter types can introduce block structure into the canonical Markdown. */
function normalizeLine(value: string, label: string): string {
  if (typeof value !== "string")
    throw new BugComposeError("INVALID_FIELD", `${label} must be a string`);
  const line = sanitizeBugText(value).replace(/\s+/g, " ").trim();
  if (line.length > MAX_FIELD_CHARS)
    throw new BugComposeError(
      "FIELD_TOO_LONG",
      `${label} exceeds ${MAX_FIELD_CHARS} characters`,
    );
  return line;
}

/** Comparison form for the "these two say the same thing" check: case, punctuation and spacing are
 *  not differences a reviewer would call meaningful. */
function comparable(value: string): string {
  return (
    value
      .toLowerCase()
      // Apostrophes are DELETED rather than turned into a separator, so "doesn't work" and "doesnt
      // work" reduce to the same key. Splitting on them instead lets the single most common useless
      // ACTUAL in the corpus walk straight past the noise check.
      .replace(/['‘’ʼ]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Phrases that carry no information about what happened. A field is only flagged when it is ENTIRELY
 * one of these — "nothing happens when I press E" is a fine ACTUAL and must not be flagged, while a
 * bare "doesn't work" must be. Whole-string matching keeps the false-positive rate at zero, which
 * matters because this check BLOCKS.
 */
const NOISE_PHRASES: ReadonlySet<string> = new Set([
  "bug",
  "a bug",
  "broken",
  "its broken",
  "it is broken",
  "broke",
  "bad",
  "wrong",
  "its wrong",
  "it is wrong",
  "weird",
  "fails",
  "it fails",
  "failed",
  "doesnt work",
  "does not work",
  "dont work",
  "do not work",
  "not working",
  "not work",
  "no",
  "nope",
  "error",
  "an error",
  "crash",
  "it crashes",
  "issue",
  "an issue",
  "problem",
  "a problem",
  "n a",
  "na",
  "tbd",
  "todo",
  "see above",
  "see screenshot",
  "as described",
]);

function isNoise(value: string): boolean {
  // A bare subject pronoun adds nothing, so "it doesn't work" and "doesn't work" are the same claim.
  // Stripping it keeps the phrase list short instead of enumerating every prefix a reporter may type.
  const key = comparable(value).replace(
    /^(it|this|that|the game|the app) /,
    "",
  );
  return key.length === 0 || NOISE_PHRASES.has(key);
}

// ---------------------------------------------------------------------------------------------
// evidence — the structural seam onto BUG.CAPTURE.1 and BUG.ANNOTATE.1
// ---------------------------------------------------------------------------------------------

/**
 * The part of a BUG.CAPTURE.1 `BugCaptureContext` a report body needs. Declared STRUCTURALLY rather
 * than imported, for the same reason BUG.ANNOTATE.1 declared its own seam that way: it is the honest
 * shape of the coupling — a report body genuinely does not care how the view was captured — and it
 * keeps this slice reviewable on its own.
 *
 * BUG.CAPTURE.1 merged as #415 while this slice was in flight, so the claim is checked rather than
 * promised: `tests/bugCompose.test.ts` builds a genuine `BugCaptureContext` through the capture
 * module's own API and hands it straight to `attachBugEvidence`, with no shim and no adapter.
 */
export interface BugComposeCaptureRef {
  readonly captureId: string;
  readonly world: { readonly worldId: string; readonly seed: number };
  readonly sol: { readonly sol: number };
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
  };
}

/** The part of a BUG.ANNOTATE.1 `BugAnnotationLayer` a report body needs; satisfied as-is. */
export interface BugComposeAnnotationRef {
  readonly layerId: string;
  readonly captureId: string;
  readonly annotations: readonly {
    readonly id: string;
    readonly kind: string;
  }[];
}

export interface BugReportEvidence {
  readonly captureId: string;
  readonly worldId: string;
  readonly seed: number;
  readonly sol: number;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
  };
  readonly layerId: string | null;
  readonly markCount: number;
  /** Unique mark kinds, sorted, so the summary line is stable across authoring order. */
  readonly markKinds: readonly string[];
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new BugComposeError(
      "INVALID_EVIDENCE",
      `${label} must be a non-empty string`,
    );
  return value;
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new BugComposeError(
      "INVALID_EVIDENCE",
      `${label} must be a finite number`,
    );
  return value;
}

/**
 * Bind a report to its evidence.
 *
 * The `captureId` check is the load-bearing line. `openBugAnnotationLayer` already binds a layer to
 * one capture, but a compose surface holds BOTH a capture and a layer and can trivially be holding
 * the wrong pair — the reporter re-captured after drawing, or reopened an older layer. Re-checking at
 * the point the two are joined is cheap, and the failure it prevents (marks presented over an image
 * they were not drawn on) is invisible to every later reviewer.
 */
export function attachBugEvidence(
  capture: BugComposeCaptureRef,
  annotation: BugComposeAnnotationRef | null = null,
): BugReportEvidence {
  if (capture === null || typeof capture !== "object")
    throw new BugComposeError(
      "INVALID_EVIDENCE",
      "capture reference is required",
    );
  const captureId = assertNonEmptyString(
    capture.captureId,
    "capture.captureId",
  );
  const worldId = assertNonEmptyString(
    capture.world?.worldId,
    "capture.world.worldId",
  );
  const seed = assertFiniteNumber(capture.world?.seed, "capture.world.seed");
  const sol = assertFiniteNumber(capture.sol?.sol, "capture.sol.sol");
  const width = assertFiniteNumber(
    capture.viewport?.width,
    "capture.viewport.width",
  );
  const height = assertFiniteNumber(
    capture.viewport?.height,
    "capture.viewport.height",
  );
  const devicePixelRatio = assertFiniteNumber(
    capture.viewport?.devicePixelRatio,
    "capture.viewport.devicePixelRatio",
  );

  let layerId: string | null = null;
  let markCount = 0;
  let markKinds: string[] = [];
  if (annotation !== null) {
    layerId = assertNonEmptyString(annotation.layerId, "annotation.layerId");
    const boundTo = assertNonEmptyString(
      annotation.captureId,
      "annotation.captureId",
    );
    if (boundTo !== captureId)
      throw new BugComposeError(
        "EVIDENCE_MISMATCH",
        `annotation layer ${layerId} is bound to capture ${boundTo}, not ${captureId}`,
      );
    if (!Array.isArray(annotation.annotations))
      throw new BugComposeError(
        "INVALID_EVIDENCE",
        "annotation.annotations must be a list",
      );
    markCount = annotation.annotations.length;
    markKinds = Array.from(
      new Set(annotation.annotations.map((mark) => String(mark.kind))),
    ).sort();
  }

  return deepFreeze({
    captureId,
    worldId,
    seed,
    sol,
    viewport: { width, height, devicePixelRatio },
    layerId,
    markCount,
    markKinds,
  }) as BugReportEvidence;
}

// ---------------------------------------------------------------------------------------------
// the draft
// ---------------------------------------------------------------------------------------------

export interface BugComposeTurn {
  readonly turn: number;
  readonly promptId: BugComposePromptId;
  /** The constant question that was asked, copied so a transcript reads on its own. */
  readonly question: string;
  /** The reporter's answer, as typed (control characters removed, outer whitespace trimmed). */
  readonly answer: string;
}

export interface BugComposeDraft {
  readonly title: string;
  readonly steps: readonly string[];
  readonly expected: string;
  readonly actual: string;
  /** Free Markdown: extra detail, code, and ```mermaid diagrams. */
  readonly bodyMarkdown: string;
  readonly evidence: BugReportEvidence | null;
  readonly transcript: readonly BugComposeTurn[];
}

export interface OpenBugComposeInput {
  readonly title?: string;
  readonly steps?: readonly string[];
  readonly expected?: string;
  readonly actual?: string;
  readonly bodyMarkdown?: string;
  readonly evidence?: BugReportEvidence | null;
}

function normalizeSteps(steps: readonly string[]): readonly string[] {
  if (!Array.isArray(steps))
    throw new BugComposeError("INVALID_FIELD", "steps must be a list");
  const out = steps
    .map((step, index) => normalizeLine(step, `steps[${index}]`))
    .filter((step) => step.length > 0);
  if (out.length > MAX_STEPS)
    throw new BugComposeError(
      "TOO_MANY_STEPS",
      `a report may carry at most ${MAX_STEPS} steps`,
    );
  return out;
}

function normalizeBody(body: string): string {
  if (typeof body !== "string")
    throw new BugComposeError("INVALID_FIELD", "bodyMarkdown must be a string");
  // The body keeps its line structure — it IS Markdown — so only control characters are removed and
  // line endings normalized. Rendering is where it becomes safe, not here.
  return sanitizeBugText(body.replace(/\r\n?/g, "\n")).replace(/\s+$/, "");
}

export function openBugComposeDraft(
  input: OpenBugComposeInput = {},
): BugComposeDraft {
  return deepFreeze({
    title: normalizeLine(input.title ?? "", "title"),
    steps: normalizeSteps(input.steps ?? []),
    expected: normalizeLine(input.expected ?? "", "expected"),
    actual: normalizeLine(input.actual ?? "", "actual"),
    bodyMarkdown: normalizeBody(input.bodyMarkdown ?? ""),
    evidence: input.evidence ?? null,
    transcript: [],
  }) as BugComposeDraft;
}

function withDraft(
  draft: BugComposeDraft,
  patch: Partial<BugComposeDraft>,
): BugComposeDraft {
  return deepFreeze({
    title: patch.title ?? draft.title,
    steps: patch.steps ?? draft.steps,
    expected: patch.expected ?? draft.expected,
    actual: patch.actual ?? draft.actual,
    bodyMarkdown: patch.bodyMarkdown ?? draft.bodyMarkdown,
    evidence: patch.evidence === undefined ? draft.evidence : patch.evidence,
    transcript: patch.transcript ?? draft.transcript,
  }) as BugComposeDraft;
}

export function setBugComposeTitle(
  draft: BugComposeDraft,
  title: string,
): BugComposeDraft {
  return withDraft(draft, { title: normalizeLine(title, "title") });
}

export function setBugComposeSteps(
  draft: BugComposeDraft,
  steps: readonly string[],
): BugComposeDraft {
  return withDraft(draft, { steps: normalizeSteps(steps) });
}

export function appendBugComposeStep(
  draft: BugComposeDraft,
  step: string,
): BugComposeDraft {
  return withDraft(draft, { steps: normalizeSteps([...draft.steps, step]) });
}

export function setBugComposeExpected(
  draft: BugComposeDraft,
  expected: string,
): BugComposeDraft {
  return withDraft(draft, { expected: normalizeLine(expected, "expected") });
}

export function setBugComposeActual(
  draft: BugComposeDraft,
  actual: string,
): BugComposeDraft {
  return withDraft(draft, { actual: normalizeLine(actual, "actual") });
}

export function setBugComposeBody(
  draft: BugComposeDraft,
  bodyMarkdown: string,
): BugComposeDraft {
  return withDraft(draft, { bodyMarkdown: normalizeBody(bodyMarkdown) });
}

export function attachBugComposeEvidence(
  draft: BugComposeDraft,
  evidence: BugReportEvidence | null,
): BugComposeDraft {
  return withDraft(draft, { evidence });
}

// ---------------------------------------------------------------------------------------------
// the assisted composer ("the prompt chatbox")
// ---------------------------------------------------------------------------------------------

export type BugComposePromptId =
  | "title.missing"
  | "title.noise"
  | "steps.missing"
  | "steps.more"
  | "steps.terse"
  | "expected.missing"
  | "actual.missing"
  | "expected.noise"
  | "actual.noise"
  | "expected-actual.identical"
  | "evidence.capture"
  | "evidence.marks";

export type BugComposeField =
  | "title"
  | "steps"
  | "expected"
  | "actual"
  | "evidence";

export interface BugComposePrompt {
  readonly id: BugComposePromptId;
  readonly field: BugComposeField;
  /** `blocking` prompts stop `commitBugReport`; `advisory` ones are shown and can be ignored. */
  readonly severity: "blocking" | "advisory";
  /** A CONSTANT string. Never interpolates draft text — see property 1 in the header. */
  readonly question: string;
  readonly why: string;
  readonly example: string;
  /** False when the gap cannot be closed by typing a sentence (attach a capture, edit a step). */
  readonly answerable: boolean;
}

/**
 * The whole catalogue, in the order it is offered. Frozen constants: the assistant's voice is fixed
 * code, so no amount of hostile body text can steer what it says to the next reader.
 */
const PROMPTS: Readonly<Record<BugComposePromptId, BugComposePrompt>> =
  deepFreeze({
    "title.missing": {
      id: "title.missing",
      field: "title",
      severity: "blocking",
      question: "In one line, what is wrong? Name the thing and the defect.",
      why: "The title is what a reviewer reads in a list of forty reports. It has to survive on its own.",
      example:
        "Kerb cap overshoots the carriageway at the north junction of Harbour Road",
      answerable: true,
    },
    "title.noise": {
      id: "title.noise",
      field: "title",
      severity: "blocking",
      question:
        "That title does not name anything specific. Which object or place is wrong, and in what way?",
      why: "A title like 'broken' cannot be searched for, deduplicated against, or prioritised.",
      example: "Bus 3 drives through the depot wall when leaving the last bay",
      answerable: true,
    },
    "steps.missing": {
      id: "steps.missing",
      field: "steps",
      severity: "blocking",
      question:
        "What was the FIRST thing you did? Start from where you were standing or what you loaded.",
      why: "A reviewer has to be able to arrive at the same place before anything else you say applies.",
      example:
        "Spawn at the founders' landing camp and walk north to the first junction",
      answerable: true,
    },
    "steps.more": {
      id: "steps.more",
      field: "steps",
      severity: "blocking",
      question: "And then what? Add the next step, one action per step.",
      why: "One step is a description, not a reproduction. Two or more is the smallest thing someone else can follow.",
      example: "Press E to enter the bus, then wait for it to leave the bay",
      answerable: true,
    },
    "steps.terse": {
      id: "steps.terse",
      field: "steps",
      severity: "advisory",
      question:
        "One of your steps is a single word or two. Can you say what you did and where?",
      why: "A step like 'walk' does not tell a reviewer which way, from where, or how far.",
      example: "Walk north along Harbour Road until the kerb turns",
      answerable: false,
    },
    "expected.missing": {
      id: "expected.missing",
      field: "expected",
      severity: "blocking",
      question: "What did you EXPECT to happen at that point?",
      why: "Without it, a reviewer cannot tell a defect from a design decision they simply disagree with.",
      example:
        "The kerb should stop at the carriageway edge and the paint should stay straight across the mouth",
      answerable: true,
    },
    "actual.missing": {
      id: "actual.missing",
      field: "actual",
      severity: "blocking",
      question: "And what ACTUALLY happened? Describe only what you saw.",
      why: "The observed behaviour is the thing a fix is tested against.",
      example:
        "The kerb cap sticks about half a metre into the road and the paint jumps sideways",
      answerable: true,
    },
    "expected.noise": {
      id: "expected.noise",
      field: "expected",
      severity: "blocking",
      question:
        "'Expected' needs the specific behaviour you were counting on, not that it should work.",
      why: "'It should work' is true of everything, so it rules nothing in and nothing out.",
      example: "The door should open and I should end up inside the lobby",
      answerable: true,
    },
    "actual.noise": {
      id: "actual.noise",
      field: "actual",
      severity: "blocking",
      question:
        "'Actual' needs what you actually saw — the message, the position, the thing that moved.",
      why: "'Broken' is the same sentence for a crash, a wrong colour and a missing wall.",
      example:
        "Nothing happened and the prompt stayed on screen; no message appeared",
      answerable: true,
    },
    "expected-actual.identical": {
      id: "expected-actual.identical",
      field: "actual",
      severity: "blocking",
      question:
        "Your expected and actual say the same thing. What was different about what actually happened?",
      why: "If the two match, the report contains no defect a reviewer can act on.",
      example:
        "Expected: the bus stops at the bay. Actual: the bus drives through the bay wall and stops outside.",
      answerable: true,
    },
    "evidence.capture": {
      id: "evidence.capture",
      field: "evidence",
      severity: "advisory",
      question:
        "There is no capture attached. Take one from where the problem is so a reviewer can stand there.",
      why: "A capture carries the camera pose, the presence address, the seed and the sol — a written location does not.",
      example: "Aim at the defect, capture, then attach it to this report",
      answerable: false,
    },
    "evidence.marks": {
      id: "evidence.marks",
      field: "evidence",
      severity: "advisory",
      question:
        "The capture has no marks on it. Which of the things on screen is the wrong one?",
      why: "A junction capture holds a couple of hundred objects; the arrow is the only thing that says which one.",
      example: "Draw an arrow from the sky onto the kerb that overshoots",
      answerable: false,
    },
  });

/** Fewer than this many words in a step reads as a note to self rather than an instruction. */
const MIN_STEP_WORDS = 3;

function unmetPrompts(draft: BugComposeDraft): readonly BugComposePrompt[] {
  const out: BugComposePrompt[] = [];
  const push = (id: BugComposePromptId): void => {
    out.push(PROMPTS[id]);
  };

  if (draft.title === "") push("title.missing");
  else if (isNoise(draft.title)) push("title.noise");

  if (draft.steps.length === 0) push("steps.missing");
  else if (draft.steps.length === 1) push("steps.more");

  if (draft.expected === "") push("expected.missing");
  else if (isNoise(draft.expected)) push("expected.noise");

  if (draft.actual === "") push("actual.missing");
  else if (isNoise(draft.actual)) push("actual.noise");

  // Only meaningful once both sides exist; otherwise the "missing" prompts already cover it.
  if (
    draft.expected !== "" &&
    draft.actual !== "" &&
    comparable(draft.expected) === comparable(draft.actual)
  )
    push("expected-actual.identical");

  if (
    draft.steps.some(
      (step) => step.split(" ").filter(Boolean).length < MIN_STEP_WORDS,
    )
  )
    push("steps.terse");

  if (draft.evidence === null) push("evidence.capture");
  else if (draft.evidence.markCount === 0) push("evidence.marks");

  return out;
}

export interface BugReportReadiness {
  readonly ready: boolean;
  readonly blocking: readonly BugComposePrompt[];
  readonly advisory: readonly BugComposePrompt[];
}

export function assessBugReportReadiness(
  draft: BugComposeDraft,
): BugReportReadiness {
  const unmet = unmetPrompts(draft);
  const blocking = unmet.filter((prompt) => prompt.severity === "blocking");
  const advisory = unmet.filter((prompt) => prompt.severity === "advisory");
  return deepFreeze({
    ready: blocking.length === 0,
    blocking,
    advisory,
  }) as BugReportReadiness;
}

/** The next question the chatbox should ask, blocking gaps first. `null` once nothing is left. */
export function nextBugComposePrompt(
  draft: BugComposeDraft,
): BugComposePrompt | null {
  const unmet = unmetPrompts(draft);
  return (
    unmet.find((prompt) => prompt.severity === "blocking") ??
    unmet.find((prompt) => prompt.answerable) ??
    unmet[0] ??
    null
  );
}

/**
 * Record an answer and apply it to the field the prompt is about.
 *
 * The answer lands in the draft as the reporter typed it. There is deliberately no rewriting, no
 * capitalisation, no "did you mean" — see property 1. Multi-line answers to a step question become
 * one step per line, because that is what a reporter pasting a numbered list means.
 */
export function answerBugComposePrompt(
  draft: BugComposeDraft,
  promptId: BugComposePromptId,
  answer: string,
): BugComposeDraft {
  const prompt = PROMPTS[promptId];
  if (!prompt)
    throw new BugComposeError(
      "UNKNOWN_PROMPT",
      `no such prompt: ${String(promptId)}`,
    );
  if (!prompt.answerable)
    throw new BugComposeError(
      "PROMPT_NOT_ANSWERABLE",
      `prompt ${promptId} is closed by an action, not by an answer`,
    );
  if (typeof answer !== "string")
    throw new BugComposeError("INVALID_FIELD", "answer must be a string");
  if (draft.transcript.length >= MAX_TRANSCRIPT_TURNS)
    throw new BugComposeError(
      "TOO_MANY_STEPS",
      `a compose session may carry at most ${MAX_TRANSCRIPT_TURNS} turns`,
    );

  const recorded = sanitizeBugText(answer).trim();
  const turn: BugComposeTurn = {
    turn: draft.transcript.length,
    promptId,
    question: prompt.question,
    answer: recorded,
  };
  const transcript = [...draft.transcript, turn];

  switch (prompt.field) {
    case "title":
      return withDraft(draft, {
        title: normalizeLine(recorded, "title"),
        transcript,
      });
    case "expected":
      return withDraft(draft, {
        expected: normalizeLine(recorded, "expected"),
        transcript,
      });
    case "actual":
      return withDraft(draft, {
        actual: normalizeLine(recorded, "actual"),
        transcript,
      });
    case "steps": {
      const added = recorded
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return withDraft(draft, {
        steps: normalizeSteps([...draft.steps, ...added]),
        transcript,
      });
    }
    default:
      throw new BugComposeError(
        "PROMPT_NOT_ANSWERABLE",
        `prompt ${promptId} has no text field`,
      );
  }
}

// ---------------------------------------------------------------------------------------------
// the committed report
// ---------------------------------------------------------------------------------------------

export interface BugReportBody {
  readonly reportVersion: number;
  readonly bodyId: string;
  readonly title: string;
  readonly steps: readonly string[];
  readonly expected: string;
  readonly actual: string;
  readonly bodyMarkdown: string;
  /** A PROJECTION of `bodyMarkdown`, re-derived on parse and excluded from the digest (property 4). */
  readonly document: BugMarkdownDocument;
  readonly evidence: BugReportEvidence | null;
  readonly filedAtMs: number;
  readonly transcript: readonly BugComposeTurn[];
}

function canonicalEvidenceForm(evidence: BugReportEvidence | null): string {
  if (evidence === null) return "none";
  return [
    evidence.captureId,
    evidence.worldId,
    num(evidence.seed),
    num(evidence.sol),
    `${num(evidence.viewport.width)}x${num(evidence.viewport.height)}@${num(evidence.viewport.devicePixelRatio)}`,
    evidence.layerId ?? "nolayer",
    num(evidence.markCount),
    evidence.markKinds.join(","),
  ].join("|");
}

function canonicalReportForm(
  parts: Omit<BugReportBody, "bodyId" | "document">,
): string {
  return [
    num(parts.reportVersion),
    parts.title,
    parts.steps.join(""),
    parts.expected,
    parts.actual,
    parts.bodyMarkdown,
    canonicalEvidenceForm(parts.evidence),
    num(parts.filedAtMs),
    parts.transcript
      .map((turn) => `${num(turn.turn)}~${turn.promptId}~${turn.answer}`)
      .join(""),
  ].join(FIELD);
}

export function deriveBugReportBodyId(
  parts: Omit<BugReportBody, "bodyId" | "document">,
): string {
  return `bugbody_${digest(canonicalReportForm(parts))}`;
}

export interface CommitBugReportInput {
  readonly filedAtMs: number;
}

/**
 * Freeze the draft into a filed report.
 *
 * Committing REFUSES while any blocking prompt is unmet. That is a real product decision and not a
 * nicety: BUG.KCO.1 will pay a bounty against these records, so a report that cannot be reproduced or
 * whose expected and actual say the same thing is a cost, and the cheapest place to stop it is before
 * it exists.
 */
export function commitBugReport(
  draft: BugComposeDraft,
  input: CommitBugReportInput,
): BugReportBody {
  const readiness = assessBugReportReadiness(draft);
  if (!readiness.ready)
    throw new BugComposeError(
      "NOT_READY",
      `report is not ready: ${readiness.blocking.map((prompt) => prompt.id).join(", ")}`,
    );
  if (typeof input?.filedAtMs !== "number" || !Number.isFinite(input.filedAtMs))
    throw new BugComposeError(
      "INVALID_FIELD",
      "filedAtMs must be a finite number",
    );

  const parts = {
    reportVersion: BUG_REPORT_BODY_VERSION,
    title: draft.title,
    steps: [...draft.steps],
    expected: draft.expected,
    actual: draft.actual,
    bodyMarkdown: draft.bodyMarkdown,
    evidence: draft.evidence,
    filedAtMs: input.filedAtMs,
    transcript: draft.transcript.map((turn) => ({ ...turn })),
  };

  return deepFreeze({
    ...parts,
    bodyId: deriveBugReportBodyId(parts),
    document: renderBugMarkdown(draft.bodyMarkdown),
  }) as BugReportBody;
}

// ---------------------------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------------------------

interface BugReportWire {
  readonly reportVersion: number;
  readonly bodyId: string;
  readonly title: string;
  readonly steps: readonly string[];
  readonly expected: string;
  readonly actual: string;
  readonly bodyMarkdown: string;
  readonly evidence: BugReportEvidence | null;
  readonly filedAtMs: number;
  readonly transcript: readonly BugComposeTurn[];
}

/** The wire form carries the SOURCE only. The rendered document is re-derived on parse, so a renderer
 *  improvement reaches every stored report instead of freezing at the version that filed it. */
export function serializeBugReport(report: BugReportBody): string {
  const wire: BugReportWire = {
    reportVersion: report.reportVersion,
    bodyId: report.bodyId,
    title: report.title,
    steps: report.steps,
    expected: report.expected,
    actual: report.actual,
    bodyMarkdown: report.bodyMarkdown,
    evidence: report.evidence,
    filedAtMs: report.filedAtMs,
    transcript: report.transcript,
  };
  return JSON.stringify(wire);
}

export function parseBugReport(json: string): BugReportBody {
  let wire: BugReportWire;
  try {
    wire = JSON.parse(json) as BugReportWire;
  } catch {
    throw new BugComposeError("INVALID_REPORT", "report is not valid JSON");
  }
  if (wire === null || typeof wire !== "object")
    throw new BugComposeError("INVALID_REPORT", "report must be an object");
  if (wire.reportVersion !== BUG_REPORT_BODY_VERSION)
    throw new BugComposeError(
      "UNSUPPORTED_VERSION",
      `unsupported report version ${String(wire.reportVersion)}`,
    );

  const parts = {
    reportVersion: BUG_REPORT_BODY_VERSION,
    title: normalizeLine(wire.title, "title"),
    steps: normalizeSteps(wire.steps ?? []),
    expected: normalizeLine(wire.expected, "expected"),
    actual: normalizeLine(wire.actual, "actual"),
    bodyMarkdown: normalizeBody(wire.bodyMarkdown ?? ""),
    evidence: wire.evidence ?? null,
    filedAtMs: wire.filedAtMs,
    transcript: (wire.transcript ?? []).map((turn) => ({
      turn: turn.turn,
      promptId: turn.promptId,
      question: turn.question,
      answer: turn.answer,
    })),
  };
  if (typeof parts.filedAtMs !== "number" || !Number.isFinite(parts.filedAtMs))
    throw new BugComposeError(
      "INVALID_REPORT",
      "filedAtMs must be a finite number",
    );

  const bodyId = deriveBugReportBodyId(parts);
  if (bodyId !== wire.bodyId)
    throw new BugComposeError(
      "ID_MISMATCH",
      `report id ${String(wire.bodyId)} does not match its contents (${bodyId})`,
    );

  return deepFreeze({
    ...parts,
    bodyId,
    document: renderBugMarkdown(parts.bodyMarkdown),
  }) as BugReportBody;
}

// ---------------------------------------------------------------------------------------------
// canonical Markdown
// ---------------------------------------------------------------------------------------------

/**
 * Neutralize the FIRST character of a single-line field when it would start a Markdown block.
 *
 * Block structure is decided at the start of a line, so this is the complete set of positions that
 * matter — and it is why fields are normalized to one line in the first place. Without it, an ACTUAL
 * of "## Expected: it works fine" mints a section that reads as the tool's own heading.
 */
function escapeMarkdownLine(value: string): string {
  if (value === "") return value;
  if (/^[#>\-+*_=~|`]/.test(value) || /^\d+[.)]/.test(value))
    return `\\${value}`;
  return value;
}

function evidenceLines(evidence: BugReportEvidence): readonly string[] {
  const lines = [
    `- capture \`${evidence.captureId}\` — world \`${evidence.worldId}\` (seed ${evidence.seed}), sol ${evidence.sol}, viewport ${evidence.viewport.width}x${evidence.viewport.height}@${evidence.viewport.devicePixelRatio}`,
  ];
  if (evidence.layerId === null) lines.push("- no annotation layer attached");
  else
    lines.push(
      `- annotations \`${evidence.layerId}\` — ${evidence.markCount} mark${evidence.markCount === 1 ? "" : "s"}${
        evidence.markKinds.length > 0
          ? ` (${evidence.markKinds.join(", ")})`
          : ""
      }`,
    );
  return lines;
}

/**
 * The tracker-facing rendering. `serializeBugReport` remains the source of truth — this is a view,
 * and it is generated fresh rather than stored so a report can never disagree with itself.
 */
export function renderBugReportMarkdown(report: BugReportBody): string {
  const out: string[] = [];
  out.push(`# ${escapeMarkdownLine(report.title)}`, "");
  out.push("## Steps to reproduce", "");
  report.steps.forEach((step, index) => {
    out.push(`${index + 1}. ${escapeMarkdownLine(step)}`);
  });
  out.push("", "## Expected", "", escapeMarkdownLine(report.expected), "");
  out.push("## Actual", "", escapeMarkdownLine(report.actual), "");
  if (report.bodyMarkdown.trim() !== "")
    out.push("## Details", "", report.bodyMarkdown, "");
  out.push("## Evidence", "");
  if (report.evidence === null) out.push("- no in-world capture attached");
  else out.push(...evidenceLines(report.evidence));
  out.push("", `<!-- bugbody ${report.bodyId} -->`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------
// the view model
// ---------------------------------------------------------------------------------------------

export interface BugComposeView {
  readonly title: string;
  readonly steps: readonly string[];
  readonly expected: string;
  readonly actual: string;
  readonly evidence: BugReportEvidence | null;
  readonly transcript: readonly BugComposeTurn[];
  /** The question to show in the chatbox right now, or `null` when there is nothing left to ask. */
  readonly prompt: BugComposePrompt | null;
  readonly readiness: BugReportReadiness;
  /** The parsed, sanitized body — a surface maps these nodes straight to elements. */
  readonly document: BugMarkdownDocument;
  readonly plainText: string;
  /** Things the reporter should know were refused, so nothing is dropped silently. */
  readonly warnings: readonly string[];
}

/**
 * Everything a compose surface needs to draw, computed here so the surface stays a pure mapping.
 *
 * That split is deliberate. The rest of this feature family (BUG.CAPTURE.1, BUG.ANNOTATE.1) ships its
 * model without a mounted surface, because the in-world chrome lands once all three exist; keeping the
 * view logic here means the eventual panel has nothing in it worth a test.
 */
export function projectBugComposeView(draft: BugComposeDraft): BugComposeView {
  const document = renderBugMarkdown(draft.bodyMarkdown);
  const warnings: string[] = [];
  for (const rejected of document.rejectedLinks)
    warnings.push(
      `link not rendered (${rejected.reason.toLowerCase().replace(/_/g, " ")}): ${rejected.raw}`,
    );
  for (const rejected of document.rejectedImages)
    warnings.push(
      `image not rendered — a bug body never loads a remote image; attach a capture instead: ${rejected.raw}`,
    );
  for (const diagnostic of document.diagnostics)
    warnings.push(`diagram not rendered: ${diagnostic.message}`);

  return deepFreeze({
    title: draft.title,
    steps: draft.steps,
    expected: draft.expected,
    actual: draft.actual,
    evidence: draft.evidence,
    transcript: draft.transcript,
    prompt: nextBugComposePrompt(draft),
    readiness: assessBugReportReadiness(draft),
    document,
    plainText: bugMarkdownPlainText(document),
    warnings,
  }) as BugComposeView;
}
