import { useState, type FormEvent } from "react";
import type { SpatialLocation } from "../spatial/spatialLocation";
import type { ColonyRuntime, ColonyUiState } from "../runtime";
import type { WorldSurveyRegistry } from "../worldSurvey";
import { buildBugGoalPlan, type BugGoalPlan } from "../bug/bugGoal";
import type { BugTaskSubmission } from "../bug/bugTrack";
import { defaultBugSubmitDeps, submitBugGoal } from "../bug/bugGoalSubmit";

export interface BugGoalSubmitResult {
  readonly mode: "planned" | "submitted";
  readonly taskId: string;
  readonly message: string;
}

export type BugGoalSubmitter = (
  submission: BugTaskSubmission,
) => Promise<BugGoalSubmitResult>;

const BUG_GOAL_STORAGE_KEY = "citylife.bugGoals.v1";

function safeJsonList(text: string | null): unknown[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Keep a copy on this device. Returns the LOCAL MARKER — deliberately prefixed so it can never be
 *  mistaken for, or displayed as, a real governed task id. */
export function saveBugGoalLocally(submission: BugTaskSubmission): string {
  const taskId = `local-${submission.clientToken}`;
  if (typeof window !== "undefined" && window.localStorage) {
    const list = safeJsonList(
      window.localStorage.getItem(BUG_GOAL_STORAGE_KEY),
    );
    list.push({ taskId, submission });
    window.localStorage.setItem(BUG_GOAL_STORAGE_KEY, JSON.stringify(list));
  }
  return taskId;
}

/**
 * BUG.SUBMIT.1 — the DEFAULT submitter: try to file the report for real, fall back to this device.
 *
 * The panel used to default to the local writer alone, so "Queue as goal" wrote the payload into
 * localStorage, handed back a fabricated `local-<clientToken>` id, and nothing ever read that key
 * back. The report reached no one. It now POSTs to the authenticated CityLife backend (which holds
 * the credential needed to create a governed task — a browser must never carry one) and only reports
 * a filing when the backend returns a real task id.
 */
export async function backendBugGoalSubmitter(
  submission: BugTaskSubmission,
): Promise<BugGoalSubmitResult> {
  const outcome = await submitBugGoal(
    submission,
    defaultBugSubmitDeps(saveBugGoalLocally),
  );
  return {
    mode: outcome.mode,
    taskId: outcome.taskId,
    message: outcome.message,
  };
}

export async function localBugGoalSubmitter(
  submission: BugTaskSubmission,
): Promise<BugGoalSubmitResult> {
  const taskId = saveBugGoalLocally(submission);
  return {
    mode: "planned",
    taskId,
    message:
      "Queue goal planned locally; live Task API posting is the deploy/auth seam.",
  };
}

export function bugCaptureLocationFromUi(
  ui: ColonyUiState,
  survey: Pick<WorldSurveyRegistry, "surfaceFrameId" | "frames">,
): SpatialLocation {
  const surface = survey.frames.get(survey.surfaceFrameId);
  const position = ui.firstPerson.view?.citizen.positionXY;
  if (surface?.grid && position) {
    return {
      frameId: survey.surfaceFrameId,
      point: {
        x: surface.grid.origin.x + position.x * surface.grid.cellSize,
        y: 0,
        z: surface.grid.origin.z + position.y * surface.grid.cellSize,
      },
    };
  }
  const landing = surface?.metadata?.landing as
    | { readonly x?: unknown; readonly y?: unknown }
    | undefined;
  if (
    surface?.grid &&
    landing &&
    typeof landing.x === "number" &&
    typeof landing.y === "number"
  ) {
    return {
      frameId: survey.surfaceFrameId,
      point: {
        x: surface.grid.origin.x + landing.x * surface.grid.cellSize,
        y: 0,
        z: surface.grid.origin.z + landing.y * surface.grid.cellSize,
      },
    };
  }
  return { frameId: survey.surfaceFrameId, point: { x: 0, y: 0, z: 0 } };
}

export function BugReportPanel({
  open,
  runtime,
  ui,
  onClose,
  submitGoal = backendBugGoalSubmitter,
}: {
  open: boolean;
  runtime: ColonyRuntime;
  ui: ColonyUiState;
  onClose: () => void;
  submitGoal?: BugGoalSubmitter;
}) {
  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [detail, setDetail] = useState("");
  const [capture, setCapture] = useState<ReturnType<
    ColonyRuntime["captureBugContext"]
  > | null>(null);
  const [plan, setPlan] = useState<BugGoalPlan | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const captureCurrentView = () => {
    setError(null);
    try {
      const survey = runtime.worldSurvey();
      const location = bugCaptureLocationFromUi(ui, survey);
      const next = runtime.captureBugContext({
        location,
        composeSteps: 1,
        includeScreenshot: true,
      });
      if (!next) {
        setError(
          "Renderer is not ready yet; try again once the world is visible.",
        );
        return;
      }
      setCapture(next);
      setPlan(null);
      setStatus(`Captured ${next.context.captureId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const queueGoal = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!capture) {
      setError("Capture the current view before queueing the bug goal.");
      return;
    }
    setBusy(true);
    try {
      const nextPlan = buildBugGoalPlan({
        capture: capture.context,
        filedAtMs: Date.now(),
        reporterId: ui.firstPerson.citizenId ?? "operator:citylife",
        title,
        stepsText: steps,
        expected,
        actual,
        detail,
        repo: "duikindiesee/citylife",
        pathGlobs: ["src/colony/ui/**", "src/colony/bug/**", "tests/**"],
      });
      const result = await submitGoal(nextPlan.taskSubmission);
      setPlan(nextPlan);
      // Only a REAL filing gets its id shown. A local fallback shows the honest message alone —
      // appending `local-<token>` is what made a device-only save read as a filed ticket.
      setStatus(
        result.mode === "submitted" ? `${result.message}` : result.message,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bug-report-panel" aria-label="Log Bug">
      <div className="bug-report-panel__card">
        <div className="bug-report-panel__header">
          <div>
            <span>CityLife QA</span>
            <h2>Log Bug</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bug report panel"
          >
            ×
          </button>
        </div>
        <p className="bug-report-panel__intro">
          Capture the exact camera and presence context, write the repro, then
          queue it as a governed goal.
        </p>
        <button
          type="button"
          className="bug-report-panel__capture"
          data-bug-action="capture"
          onClick={captureCurrentView}
        >
          Capture current view
        </button>
        {capture && (
          <p className="bug-report-panel__capture-id">
            Capture <code>{capture.context.captureId}</code> · sol{" "}
            {capture.context.sol.sol} · {capture.context.viewport.width}×
            {capture.context.viewport.height}
          </p>
        )}
        <form onSubmit={queueGoal}>
          <label>
            Title
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Steps to reproduce
            <textarea
              name="steps"
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
            />
          </label>
          <label>
            Expected
            <textarea
              name="expected"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          </label>
          <label>
            Actual
            <textarea
              name="actual"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
          </label>
          <label>
            Details / notes
            <textarea
              name="detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </label>
          <button type="submit" data-bug-action="queue-goal" disabled={busy}>
            {busy ? "Queueing…" : "Queue as goal"}
          </button>
        </form>
        {status && <p className="bug-report-panel__status">{status}</p>}
        {error && <p className="bug-report-panel__error">{error}</p>}
        {plan && (
          <details className="bug-report-panel__goal" open>
            <summary>Queued goal payload</summary>
            <code>{plan.taskSubmission.clientToken}</code>
            <pre>{plan.taskSubmission.title}</pre>
          </details>
        )}
      </div>
    </section>
  );
}
