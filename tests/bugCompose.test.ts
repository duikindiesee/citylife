import { describe, expect, it } from "vitest";

import {
  aimBugCaptureDraft,
  commitBugCapture,
  openBugCaptureDraft,
  type BugCaptureContext,
} from "../src/colony/bug/bugCapture";
import type { SpatialFrame } from "../src/colony/worldSurvey";
import {
  BugComposeError,
  answerBugComposePrompt,
  appendBugComposeStep,
  assessBugReportReadiness,
  attachBugComposeEvidence,
  attachBugEvidence,
  commitBugReport,
  deriveBugReportBodyId,
  nextBugComposePrompt,
  openBugComposeDraft,
  parseBugReport,
  projectBugComposeView,
  renderBugReportMarkdown,
  serializeBugReport,
  setBugComposeActual,
  setBugComposeBody,
  setBugComposeExpected,
  setBugComposeTitle,
  type BugComposeDraft,
  type BugComposePromptId,
  type BugReportBody,
} from "../src/colony/bug/bugCompose";

// ---------------------------------------------------------------------------------------------
// fixtures
//
// These stand in for a BUG.CAPTURE.1 `BugCaptureContext` and a BUG.ANNOTATE.1 `BugAnnotationLayer`.
// Neither module is on main yet (PR #415, PR #419), which is exactly why the seam is structural: the
// shapes below are the real ones, with the fields this module reads, and a real record satisfies
// `BugComposeCaptureRef` / `BugComposeAnnotationRef` as-is with no shim.
// ---------------------------------------------------------------------------------------------

const CAPTURE = Object.freeze({
  captureId: "bugcap_9f2a1c0455e10b31",
  recordVersion: 1,
  world: { worldId: "seed-4242", seed: 4242 },
  sol: {
    capturedAtMs: 1_785_000_000_000,
    sol: 312,
    hour: 9,
    minute: 30,
    isDay: true,
  },
  viewport: { width: 3840, height: 2160, devicePixelRatio: 2 },
  composeSteps: 3,
});

const LAYER = Object.freeze({
  layerVersion: 1,
  layerId: "buganl_1234abcd5678ef90",
  captureId: CAPTURE.captureId,
  viewport: CAPTURE.viewport,
  annotations: Object.freeze([
    {
      kind: "arrow",
      id: "mark-1",
      style: { color: "red", strokeWidth: 0.004 },
    },
    { kind: "box", id: "mark-2", style: { color: "red", strokeWidth: 0.004 } },
    {
      kind: "arrow",
      id: "mark-3",
      style: { color: "red", strokeWidth: 0.004 },
    },
  ]),
  nextOrdinal: 4,
});

const STEPS = [
  "Spawn at the founders landing camp",
  "Walk north along Harbour Road to the first junction",
  "Stand on the north-east corner and look down at the kerb",
];
const TITLE =
  "Kerb cap overshoots the carriageway at the Harbour Road junction";
const EXPECTED =
  "The kerb should stop at the carriageway edge and the paint should stay straight";
const ACTUAL =
  "The cap sticks about half a metre into the road and the paint jumps sideways";

function readyDraft(): BugComposeDraft {
  return openBugComposeDraft({
    title: TITLE,
    steps: STEPS,
    expected: EXPECTED,
    actual: ACTUAL,
    bodyMarkdown:
      "Seen on two junctions.\n\n```mermaid\nflowchart TD\n  A[walk] --> B[look]\n```",
    evidence: attachBugEvidence(CAPTURE, LAYER),
  });
}

function committed(): BugReportBody {
  return commitBugReport(readyDraft(), { filedAtMs: 1_785_000_123_456 });
}

// ---------------------------------------------------------------------------------------------
// evidence
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// the seam, proved against the REAL record
//
// BUG.CAPTURE.1 merged as #415 while this slice was in flight, so the structural claim is no longer
// a promise: a genuine `BugCaptureContext`, built by the capture module's own API, is handed to
// `attachBugEvidence` here with no shim and no adapter. The declaration in `bugCompose.ts` stays
// structural because BUG.ANNOTATE.1 (#419) is still open and because the coupling really is
// structural — a report body does not care how the view was captured.
// ---------------------------------------------------------------------------------------------

const identity = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
} as const;

const REAL_FRAMES = new Map<string, SpatialFrame>(
  (
    [
      {
        id: "universe",
        parentId: undefined,
        kind: "universe",
        layer: "surface",
      },
      { id: "world", parentId: "universe", kind: "world", layer: "surface" },
      { id: "surface", parentId: "world", kind: "region", layer: "surface" },
    ] as const
  ).map((f) => [
    f.id,
    {
      id: f.id,
      address: `spatial://test/${f.id}`,
      kind: f.kind,
      layer: f.layer,
      parentId: f.parentId,
      transform: identity,
    } as SpatialFrame,
  ]),
);

function realCapture(): BugCaptureContext {
  const draft = aimBugCaptureDraft(
    openBugCaptureDraft({
      world: { worldId: "seed-4242", seed: 4242 },
      viewport: { width: 1920, height: 1080, devicePixelRatio: 2 },
    }),
    {
      camera: {
        frameId: "surface",
        position: { x: 10, y: 2, z: 4 },
        target: { x: 10, y: 1.5, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        fovDeg: 45,
        near: 0.5,
        far: 12000,
        aspect: 16 / 9,
      },
      location: { frameId: "surface", point: { x: 10, y: 0, z: 4 } },
    },
  );
  return commitBugCapture(draft, {
    capturedAtMs: 1_780_092_000_000 + 4 * 3_600_000,
    frames: REAL_FRAMES,
  });
}

describe("bugCompose — the BUG.CAPTURE.1 seam holds against the real record", () => {
  it("accepts a genuine BugCaptureContext with no shim", () => {
    const capture = realCapture();
    const evidence = attachBugEvidence(capture);
    expect(evidence.captureId).toBe(capture.captureId);
    expect(evidence.worldId).toBe("seed-4242");
    expect(evidence.seed).toBe(4242);
    expect(evidence.sol).toBe(capture.sol.sol);
    expect(evidence.viewport).toEqual({
      width: 1920,
      height: 1080,
      devicePixelRatio: 2,
    });
  });

  it("binds a real capture to a layer that names it, and refuses one that does not", () => {
    const capture = realCapture();
    const layer = { ...LAYER, captureId: capture.captureId };
    expect(attachBugEvidence(capture, layer).markCount).toBe(3);
    expect(() => attachBugEvidence(capture, LAYER)).toThrowError(
      /bound to capture/,
    );
  });

  it("carries the real capture through a filed report and its round-trip", () => {
    const capture = realCapture();
    const report = commitBugReport(
      openBugComposeDraft({
        title: TITLE,
        steps: STEPS,
        expected: EXPECTED,
        actual: ACTUAL,
        evidence: attachBugEvidence(capture),
      }),
      { filedAtMs: 99 },
    );
    expect(parseBugReport(serializeBugReport(report))).toEqual(report);
    expect(renderBugReportMarkdown(report)).toContain(capture.captureId);
  });
});

describe("bugCompose — structural attachment to capture and annotation evidence", () => {
  it("takes a capture record and an annotation layer as-is", () => {
    const evidence = attachBugEvidence(CAPTURE, LAYER);
    expect(Object.keys(evidence).sort()).toEqual(
      [
        "captureId",
        "layerId",
        "markCount",
        "markKinds",
        "seed",
        "sol",
        "viewport",
        "worldId",
      ].sort(),
    );
    expect(evidence).toEqual({
      captureId: CAPTURE.captureId,
      worldId: "seed-4242",
      seed: 4242,
      sol: 312,
      viewport: { width: 3840, height: 2160, devicePixelRatio: 2 },
      layerId: LAYER.layerId,
      markCount: 3,
      markKinds: ["arrow", "box"],
    });
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it("accepts a capture with no annotation layer", () => {
    const evidence = attachBugEvidence(CAPTURE);
    expect(evidence.layerId).toBeNull();
    expect(evidence.markCount).toBe(0);
    expect(evidence.markKinds).toEqual([]);
  });

  it("REFUSES a layer bound to a different capture (two-sided)", () => {
    // The layer module already binds marks to one capture. A compose surface holds BOTH, so it can
    // trivially hold the wrong pair — the reporter re-captured after drawing, or reopened an older
    // layer. The failure this prevents is invisible to every later reviewer: arrows presented over an
    // image they were never drawn on.
    const other = { ...LAYER, captureId: "bugcap_deadbeefdeadbeef" };
    expect(() => attachBugEvidence(CAPTURE, other)).toThrowError(
      /bound to capture/,
    );
    try {
      attachBugEvidence(CAPTURE, other);
      expect.unreachable("mismatched layer must be refused");
    } catch (error) {
      expect((error as BugComposeError).code).toBe("EVIDENCE_MISMATCH");
    }
    // Positive side: the matching pair is still accepted, so the check is a binding test and not a
    // blanket refusal.
    expect(attachBugEvidence(CAPTURE, LAYER).layerId).toBe(LAYER.layerId);
  });

  it("rejects evidence missing the fields a reviewer needs to reproduce", () => {
    const noWorld = { ...CAPTURE, world: { worldId: "", seed: 4242 } };
    expect(() => attachBugEvidence(noWorld)).toThrowError(/world.worldId/);
    const noSol = { ...CAPTURE, sol: { sol: Number.NaN } };
    expect(() => attachBugEvidence(noSol)).toThrowError(/sol/);
  });
});

// ---------------------------------------------------------------------------------------------
// the assisted composer
// ---------------------------------------------------------------------------------------------

describe("bugCompose — the prompt chatbox", () => {
  it("asks for the missing pieces in order and stops when the report holds together", () => {
    let draft = openBugComposeDraft();
    const asked: BugComposePromptId[] = [];
    const answers: Record<string, string> = {
      "title.missing": TITLE,
      "steps.missing": STEPS[0],
      "steps.more": `${STEPS[1]}\n${STEPS[2]}`,
      "expected.missing": EXPECTED,
      "actual.missing": ACTUAL,
    };
    for (let guard = 0; guard < 10; guard += 1) {
      const prompt = nextBugComposePrompt(draft);
      if (!prompt || prompt.severity !== "blocking") break;
      asked.push(prompt.id);
      draft = answerBugComposePrompt(draft, prompt.id, answers[prompt.id]);
    }
    expect(asked).toEqual([
      "title.missing",
      "steps.missing",
      "steps.more",
      "expected.missing",
      "actual.missing",
    ]);
    expect(draft.steps).toEqual(STEPS);
    expect(assessBugReportReadiness(draft).ready).toBe(true);
    // Evidence is still missing, so the composer keeps saying so — as advice, not as a blocker.
    expect(nextBugComposePrompt(draft)?.id).toBe("evidence.capture");
    expect(assessBugReportReadiness(draft).advisory.map((p) => p.id)).toEqual([
      "evidence.capture",
    ]);
  });

  it("stores an answer as the reporter typed it", () => {
    // The composer ASKS. It does not rewrite, capitalise, spell-check or tidy: the reporter is the
    // one who has to defend the wording later, so the wording stays theirs. The transcript is the
    // verbatim record; the single-line FIELD additionally collapses runs of whitespace, which is the
    // only transformation this module performs on reporter text and the reason fields cannot carry
    // block structure into the canonical Markdown.
    const typed =
      'press *E*  then the door `sticks` — 50% of the time, "every" time #4';
    const draft = answerBugComposePrompt(
      openBugComposeDraft(),
      "title.missing",
      typed,
    );
    expect(draft.transcript).toEqual([
      {
        turn: 0,
        promptId: "title.missing",
        question: nextBugComposePrompt(openBugComposeDraft())?.question,
        answer: typed,
      },
    ]);
    expect(draft.title).toBe(typed.replace("*E*  then", "*E* then"));
    expect(draft.title).toContain('"every" time #4');
    expect(draft.title).toContain("50% of the time");
  });

  it("never puts draft text into a question it asks back", () => {
    // A body is untrusted. If the assistant echoed it, injected text would be reflected in the
    // assistant's own voice to the next person who reads the transcript.
    const sentinel = "ZZ-SENTINEL-9137";
    const drafts = [
      openBugComposeDraft({ title: sentinel }),
      openBugComposeDraft({
        title: sentinel,
        steps: [sentinel],
        expected: sentinel,
      }),
      openBugComposeDraft({
        title: sentinel,
        steps: [`${sentinel} one`, `${sentinel} two`],
        expected: "broken",
        actual: "broken",
        bodyMarkdown: sentinel,
      }),
    ];
    let seen = 0;
    for (const draft of drafts) {
      const readiness = assessBugReportReadiness(draft);
      for (const prompt of [...readiness.blocking, ...readiness.advisory]) {
        seen += 1;
        expect(prompt.question).not.toContain(sentinel);
        expect(prompt.why).not.toContain(sentinel);
        expect(prompt.example).not.toContain(sentinel);
      }
    }
    expect(seen).toBeGreaterThan(3);
  });

  it("blocks when expected and actual say the same thing, ignoring case and punctuation", () => {
    const base = openBugComposeDraft({ title: TITLE, steps: STEPS });
    const same = setBugComposeActual(
      setBugComposeExpected(base, "The door opens when I press E"),
      "the door opens when i press E.",
    );
    expect(assessBugReportReadiness(same).blocking.map((p) => p.id)).toEqual([
      "expected-actual.identical",
    ]);
    const different = setBugComposeActual(
      same,
      "The door stays shut and no message appears",
    );
    expect(assessBugReportReadiness(different).ready).toBe(true);
  });

  it("blocks a noise phrase but not a specific negative observation (two-sided)", () => {
    const base = openBugComposeDraft({
      title: TITLE,
      steps: STEPS,
      expected: EXPECTED,
    });
    for (const noise of [
      "broken",
      "It doesn't work.",
      "  BAD  ",
      "n/a",
      "see screenshot",
    ])
      expect(
        assessBugReportReadiness(setBugComposeActual(base, noise)).blocking.map(
          (p) => p.id,
        ),
      ).toEqual(["actual.noise"]);
    // The mirror case is what makes the check usable: "nothing happens" is a real observation and
    // must sail through, or reporters learn to fight the assistant.
    for (const real of [
      "Nothing happens when I press E and the prompt stays on screen",
      "The bus drives through the depot wall",
    ])
      expect(
        assessBugReportReadiness(setBugComposeActual(base, real)).ready,
      ).toBe(true);
  });

  it("flags a one-word step as advice without blocking the report", () => {
    const draft = openBugComposeDraft({
      title: TITLE,
      steps: ["Spawn at the founders landing camp", "walk"],
      expected: EXPECTED,
      actual: ACTUAL,
      evidence: attachBugEvidence(CAPTURE, LAYER),
    });
    const readiness = assessBugReportReadiness(draft);
    expect(readiness.ready).toBe(true);
    expect(readiness.advisory.map((p) => p.id)).toEqual(["steps.terse"]);
  });

  it("asks for marks once a capture with no annotations is attached", () => {
    const draft = attachBugComposeEvidence(
      readyDraft(),
      attachBugEvidence(CAPTURE),
    );
    expect(nextBugComposePrompt(draft)?.id).toBe("evidence.marks");
    expect(assessBugReportReadiness(draft).ready).toBe(true);
  });

  it("refuses to answer a prompt that is closed by an action, not by typing", () => {
    try {
      answerBugComposePrompt(
        readyDraft(),
        "evidence.marks",
        "I drew one, promise",
      );
      expect.unreachable("evidence prompts are not answerable");
    } catch (error) {
      expect((error as BugComposeError).code).toBe("PROMPT_NOT_ANSWERABLE");
    }
  });

  it("leaves the draft it was given untouched", () => {
    const before = openBugComposeDraft({ title: TITLE });
    const snapshot = JSON.stringify(before);
    answerBugComposePrompt(before, "steps.missing", STEPS[0]);
    appendBugComposeStep(before, STEPS[1]);
    setBugComposeBody(before, "# changed");
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(Object.isFrozen(before)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// the committed report
// ---------------------------------------------------------------------------------------------

describe("bugCompose — committing a report", () => {
  it("refuses to commit while a blocking gap remains", () => {
    const thin = openBugComposeDraft({
      title: TITLE,
      steps: STEPS,
      expected: EXPECTED,
    });
    try {
      commitBugReport(thin, { filedAtMs: 1 });
      expect.unreachable("a report with no ACTUAL must not commit");
    } catch (error) {
      expect((error as BugComposeError).code).toBe("NOT_READY");
      expect((error as BugComposeError).message).toContain("actual.missing");
    }
  });

  it("commits a snapshot that later edits cannot reach", () => {
    const steps = [...STEPS];
    const draft = openBugComposeDraft({
      title: TITLE,
      steps,
      expected: EXPECTED,
      actual: ACTUAL,
    });
    const report = commitBugReport(draft, { filedAtMs: 42 });
    steps.push("a step added after filing");
    expect(report.steps).toEqual(STEPS);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.steps)).toBe(true);
  });

  it("renders the body at commit time so a stored report is already drawable", () => {
    const report = committed();
    expect(report.document.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "mermaid",
    ]);
    const diagram = report.document.blocks[1];
    expect(diagram.kind === "mermaid" && diagram.render !== null).toBe(true);
  });
});

describe("bugCompose — the report is self-verifying", () => {
  it("derives the same id for the same contents", () => {
    expect(committed().bodyId).toBe(committed().bodyId);
    expect(committed().bodyId).toMatch(/^bugbody_[0-9a-f]{16}$/);
  });

  it("derives a different id for any single altered field", () => {
    const report = committed();
    const base = {
      reportVersion: report.reportVersion,
      title: report.title,
      steps: report.steps,
      expected: report.expected,
      actual: report.actual,
      bodyMarkdown: report.bodyMarkdown,
      evidence: report.evidence,
      filedAtMs: report.filedAtMs,
      transcript: report.transcript,
    };
    const mutations: Record<string, typeof base> = {
      title: { ...base, title: `${base.title}.` },
      "steps.text": {
        ...base,
        steps: [...base.steps.slice(0, 2), "different"],
      },
      "steps.order": {
        ...base,
        steps: [base.steps[1], base.steps[0], base.steps[2]],
      },
      "steps.count": { ...base, steps: base.steps.slice(0, 2) },
      expected: { ...base, expected: `${base.expected} exactly` },
      actual: { ...base, actual: `${base.actual} exactly` },
      bodyMarkdown: { ...base, bodyMarkdown: `${base.bodyMarkdown}\n\nmore` },
      filedAtMs: { ...base, filedAtMs: base.filedAtMs + 1 },
      "evidence.captureId": {
        ...base,
        evidence: { ...base.evidence!, captureId: "bugcap_0000000000000000" },
      },
      "evidence.layerId": {
        ...base,
        evidence: { ...base.evidence!, layerId: "buganl_0000000000000000" },
      },
      "evidence.sol": { ...base, evidence: { ...base.evidence!, sol: 313 } },
      "evidence.markCount": {
        ...base,
        evidence: { ...base.evidence!, markCount: 2 },
      },
      "evidence.dropped": { ...base, evidence: null },
      "transcript.answer": {
        ...base,
        transcript: [
          {
            turn: 0,
            promptId: "title.missing" as const,
            question: "q",
            answer: "other",
          },
        ],
      },
    };
    const seen = new Map<string, string>([[report.bodyId, "unchanged"]]);
    for (const [name, mutated] of Object.entries(mutations)) {
      const id = deriveBugReportBodyId(mutated);
      expect(seen.has(id), `${name} collides with ${seen.get(id)}`).toBe(false);
      seen.set(id, name);
    }
    expect(seen.size).toBe(Object.keys(mutations).length + 1);
  });

  it("round-trips through JSON with the exact key set (two-sided)", () => {
    const report = committed();
    const json = serializeBugReport(report);
    const wire = JSON.parse(json) as Record<string, unknown>;
    // Exact set: a field can neither be lost nor gained on the wire without this failing.
    expect(Object.keys(wire).sort()).toEqual(
      [
        "actual",
        "bodyId",
        "bodyMarkdown",
        "evidence",
        "expected",
        "filedAtMs",
        "reportVersion",
        "steps",
        "title",
        "transcript",
      ].sort(),
    );
    // The rendered document is NOT on the wire: it is a projection of bodyMarkdown, re-derived here.
    expect(wire.document).toBeUndefined();
    expect(parseBugReport(json)).toEqual(report);
  });

  it("rejects a report whose id does not match its contents", () => {
    const json = serializeBugReport(committed());
    const tampered = JSON.parse(json) as Record<string, unknown>;
    tampered.actual = "actually it was fine";
    try {
      parseBugReport(JSON.stringify(tampered));
      expect.unreachable("an edited report must not parse");
    } catch (error) {
      expect((error as BugComposeError).code).toBe("ID_MISMATCH");
    }
  });

  it("rejects an unknown report version", () => {
    const wire = JSON.parse(serializeBugReport(committed())) as Record<
      string,
      unknown
    >;
    wire.reportVersion = 99;
    expect(() => parseBugReport(JSON.stringify(wire))).toThrowError(/version/);
  });
});

// ---------------------------------------------------------------------------------------------
// canonical Markdown
// ---------------------------------------------------------------------------------------------

describe("bugCompose — canonical Markdown", () => {
  it("emits the sections a reviewer reads, with the evidence spelled out", () => {
    const markdown = renderBugReportMarkdown(committed());
    expect(markdown).toContain(`# ${TITLE}`);
    expect(markdown).toContain("## Steps to reproduce");
    expect(markdown).toContain(`1. ${STEPS[0]}`);
    expect(markdown).toContain(`3. ${STEPS[2]}`);
    expect(markdown).toContain(`## Expected\n\n${EXPECTED}`);
    expect(markdown).toContain(`## Actual\n\n${ACTUAL}`);
    expect(markdown).toContain(CAPTURE.captureId);
    expect(markdown).toContain(LAYER.layerId);
    expect(markdown).toContain("3 marks (arrow, box)");
    expect(markdown).toContain("sol 312");
  });

  it("cannot have a section forged from inside a field (two-sided)", () => {
    const forged = commitBugReport(
      openBugComposeDraft({
        title: TITLE,
        steps: STEPS,
        expected: EXPECTED,
        actual: "## Expected\n\nit works fine, nothing to see",
      }),
      { filedAtMs: 7 },
    );
    const markdown = renderBugReportMarkdown(forged);
    const headings = markdown
      .split("\n")
      .filter((line) => line === "## Expected");
    expect(headings).toHaveLength(1);
    expect(markdown).toContain("\\## Expected it works fine, nothing to see");
    // Two-sided: an ordinary field is NOT escaped, so the escape is a targeted defence rather than a
    // blanket backslash in front of everything.
    expect(renderBugReportMarkdown(committed())).toContain(`\n${ACTUAL}\n`);
  });

  it("says plainly when no capture is attached", () => {
    const report = commitBugReport(
      openBugComposeDraft({
        title: TITLE,
        steps: STEPS,
        expected: EXPECTED,
        actual: ACTUAL,
      }),
      { filedAtMs: 7 },
    );
    expect(renderBugReportMarkdown(report)).toContain(
      "- no in-world capture attached",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// the view model
// ---------------------------------------------------------------------------------------------

describe("bugCompose — the view model", () => {
  it("hands a surface the prompt, the readiness and the parsed document", () => {
    const view = projectBugComposeView(readyDraft());
    // A complete report with marked-up evidence leaves the chatbox with nothing left to ask.
    expect(view.prompt).toBeNull();
    expect(view.readiness.ready).toBe(true);
    expect(view.readiness.advisory).toEqual([]);
    expect(view.document.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "mermaid",
    ]);
    expect(view.plainText).toContain("Seen on two junctions.");
    expect(view.warnings).toEqual([]);
    expect(Object.isFrozen(view)).toBe(true);
  });

  it("surfaces every refusal so nothing is dropped without the reporter knowing", () => {
    const draft = setBugComposeBody(
      readyDraft(),
      [
        "[click](javascript:alert(1))",
        "",
        "![shot](https://tracker.example.com/a.png)",
        "",
        "```mermaid",
        "gantt",
        "```",
      ].join("\n"),
    );
    const view = projectBugComposeView(draft);
    expect(view.warnings).toHaveLength(3);
    expect(view.warnings[0]).toContain("link not rendered (disallowed scheme)");
    expect(view.warnings[1]).toContain("never loads a remote image");
    expect(view.warnings[2]).toContain("diagram not rendered");
  });

  it("reflects a title change without touching the previous view", () => {
    const first = projectBugComposeView(openBugComposeDraft());
    const second = projectBugComposeView(
      setBugComposeTitle(openBugComposeDraft(), TITLE),
    );
    expect(first.prompt?.id).toBe("title.missing");
    expect(second.prompt?.id).toBe("steps.missing");
  });
});
