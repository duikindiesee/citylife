import {
  attachBugComposeEvidence,
  attachBugEvidence,
  commitBugReport,
  openBugComposeDraft,
  renderBugReportMarkdown,
  setBugComposeActual,
  setBugComposeBody,
  setBugComposeExpected,
  setBugComposeSteps,
  setBugComposeTitle,
  type BugReportBody,
} from "./bugCompose";
import type { BugCaptureContext } from "./bugCapture";
import {
  fileBugReport,
  planBugTaskSubmission,
  triageBugReport,
  type BugRecord,
  type BugTaskSubmission,
  type BugTaskSubmissionOptions,
} from "./bugTrack";

export interface BuildBugGoalPlanInput {
  readonly capture: BugCaptureContext;
  readonly filedAtMs: number;
  readonly reporterId: string;
  readonly title: string;
  readonly stepsText?: string;
  readonly steps?: readonly string[];
  readonly expected: string;
  readonly actual: string;
  readonly detail?: string;
  readonly repo: string;
  readonly branch?: string;
  readonly priority?: number;
  readonly pathGlobs?: readonly string[];
  readonly extraScopeKeys?: readonly string[];
  readonly triagerId?: string;
}

export interface BugGoalPlan {
  readonly reportBody: BugReportBody;
  readonly record: BugRecord;
  readonly taskSubmission: BugTaskSubmission;
  readonly markdown: string;
}

export function bugGoalStepsFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^(?:\d+[.)]|[-*])\s+/, "").trim())
    .filter(Boolean);
}

function stepsFor(input: BuildBugGoalPlanInput): readonly string[] {
  const steps = input.steps ?? bugGoalStepsFromText(input.stepsText ?? "");
  return steps.length > 0
    ? steps
    : ["Open CityLife and reproduce from the attached capture."];
}

/**
 * Turn a captured in-world bug into the governed Task API goal payload.
 *
 * This is still a PLAN, not a network call: `bugTrack` deliberately keeps Task API I/O outside the
 * pure lifecycle module. The UI adapter owns whether this payload is posted live or stored as a local
 * planned goal for an operator/worker to pick up.
 */
export function buildBugGoalPlan(input: BuildBugGoalPlanInput): BugGoalPlan {
  const filedAtMs = input.filedAtMs;
  const evidence = attachBugEvidence(input.capture, null);
  let draft = openBugComposeDraft();
  draft = setBugComposeTitle(draft, input.title);
  draft = setBugComposeSteps(draft, stepsFor(input));
  draft = setBugComposeExpected(draft, input.expected);
  draft = setBugComposeActual(draft, input.actual);
  draft = setBugComposeBody(draft, input.detail ?? "");
  draft = attachBugComposeEvidence(draft, evidence);
  const reportBody = commitBugReport(draft, { filedAtMs });
  const filed = fileBugReport({
    reporter: { actorId: input.reporterId, role: "reporter" },
    filedAtMs,
    capture: input.capture,
    body: reportBody,
    detail: "filed from the CityLife in-world bug UI",
  });
  const triaged = triageBugReport(filed, {
    actor: {
      actorId: input.triagerId ?? "citylife:bug-ui:auto-triage",
      role: "triager",
    },
    atMs: filedAtMs + 1,
    detail: "accepted by the CityLife bug UI and converted to a queue goal",
  });
  const options: BugTaskSubmissionOptions = {
    repo: input.repo,
    branch: input.branch ?? "main",
    priority: input.priority ?? 2,
    pathGlobs: input.pathGlobs,
    extraScopeKeys: input.extraScopeKeys,
  };
  return {
    reportBody,
    record: triaged,
    taskSubmission: planBugTaskSubmission(triaged, options),
    markdown: renderBugReportMarkdown(reportBody),
  };
}
