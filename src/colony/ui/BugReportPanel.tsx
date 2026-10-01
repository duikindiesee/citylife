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
  const [promptText, setPromptText] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

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

  const applyPreset = (preset: {
    title: string;
    steps: string;
    expected: string;
    actual: string;
    detail?: string;
  }) => {
    setTitle(preset.title);
    setSteps(preset.steps);
    setExpected(preset.expected);
    setActual(preset.actual);
    if (preset.detail) setDetail(preset.detail);
    setStatus(`Applied preset: ${preset.title}`);
  };

  const autoFillFromPrompt = (custom?: string) => {
    const raw = (custom ?? promptText).trim();
    if (!raw) return;
    const lower = raw.toLowerCase();

    let newTitle = raw;
    let newSteps =
      "1. Navigate to location in world\n2. Observe reported behavior";
    let newExpected =
      "Normal operation without visual defects, collision blockers, or darkness";
    let newActual = raw;

    if (lower.includes("tree") && lower.includes("road")) {
      newTitle = "Quiver tree spawned in middle of roadway";
      newSteps =
        "1. Drive vehicle along highway or municipal road\n2. Observe flora generation inside the travel lanes";
      newExpected =
        "Trees and flora strictly clear of all road corridors and verges";
      newActual =
        "Quiver tree grows directly out of asphalt surface, obstructing driving";
    } else if (
      lower.includes("dark") ||
      lower.includes("lighting") ||
      lower.includes("showroom")
    ) {
      newTitle = "Showroom interior is pitch black at night";
      newSteps =
        "1. Approach Gearbox Auto Hub at evening / night\n2. Inspect showroom interior through glass facade";
      newExpected =
        "Luminous showroom with warm interior lighting and clearly visible vehicle models";
      newActual =
        "Interior is an unlit black cavity with invisible vehicle silhouettes";
    } else if (
      lower.includes("curb") ||
      lower.includes("drive into") ||
      lower.includes("garage") ||
      lower.includes("parking")
    ) {
      newTitle = "Cannot drive into garage: unpaved gap and curb lip";
      newSteps =
        "1. Approach Gearbox Auto Hub from highway\n2. Steer car toward entrance forecourt and bays";
      newExpected =
        "Continuous paved driveway apron bridging road to garage forecourt with parking stalls";
      newActual =
        "Dirt verge and elevated concrete slab lip block smooth vehicle entry";
    } else if (
      lower.includes("walk") ||
      lower.includes("plot") ||
      lower.includes("parcel")
    ) {
      newTitle = "Player avatar on foot cannot walk on garage plot";
      newSteps =
        "1. Exit vehicle or approach garage on foot\n2. Attempt to walk onto showroom floor or forecourt";
      newExpected = "Commercial garage plot is fully walkable for pedestrians";
      newActual = "First-person walk blocked with 'parcel' reason";
    } else if (
      lower.includes("overlap") ||
      lower.includes("button") ||
      lower.includes("hud") ||
      lower.includes("above")
    ) {
      newTitle = "HUD buttons and banners overlapping modal dialogs";
      newSteps =
        "1. Open modal (e.g. Log Bug, Roadmap, or Settings) while driving\n2. Observe top driving HUD and mission banner";
      newExpected =
        "Modals and overlays sit above gameplay HUD; buttons never overlap or obscure dialogs";
      newActual =
        "Driving HUD and mission pills render directly on top of modal controls";
    } else {
      // General freeform parse
      newTitle = raw.length > 60 ? raw.slice(0, 57) + "…" : raw;
      newSteps = `1. Trigger condition related to: ${raw}\n2. Observe resulting behavior`;
      newExpected = "Expected gameplay and UI state to function as designed";
      newActual = raw;
    }

    setTitle(newTitle);
    setSteps(newSteps);
    setExpected(newExpected);
    setActual(newActual);
    setDetail((prev) =>
      prev ? `${prev}\n[Prompt]: ${raw}` : `[Prompt]: ${raw}`,
    );
    setStatus("Auto-filled form from prompt");
  };

  const reworkForm = () => {
    if (promptText.trim()) {
      autoFillFromPrompt();
    } else if (title || actual) {
      setTitle((t) => (t ? `[QA] ${t}` : "QA Issue Report"));
      setSteps((s) => (s ? s : "1. Step into world\n2. Replicate context"));
      setExpected((e) => (e ? e : "Flawless rendering and collision"));
      setStatus("Reworked and formatted fields");
    }
    setContextMenu(null);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <section
      className="bug-report-panel"
      aria-label="Log Bug"
      onClick={() => {
        if (contextMenu) setContextMenu(null);
      }}
    >
      <div className="bug-report-panel__card" onContextMenu={handleContextMenu}>
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

        {/* Quick Scenario Preset Chips */}
        <div className="bug-report-panel__presets" aria-label="Bug presets">
          <button
            type="button"
            className="bug-report-panel__chip"
            onClick={() =>
              applyPreset({
                title: "Quiver tree spawned in middle of roadway",
                steps:
                  "1. Drive vehicle along highway or municipal road\n2. Observe flora generation inside the travel lanes",
                expected:
                  "Trees and flora strictly clear of all road corridors and verges",
                actual:
                  "Quiver tree grows directly out of asphalt surface, obstructing driving",
              })
            }
          >
            🌲 Tree on Road
          </button>
          <button
            type="button"
            className="bug-report-panel__chip"
            onClick={() =>
              applyPreset({
                title: "Showroom interior is pitch black at night",
                steps:
                  "1. Approach Gearbox Auto Hub at evening / night\n2. Inspect showroom interior through glass facade",
                expected:
                  "Luminous showroom with warm interior lighting and clearly visible vehicle models",
                actual:
                  "Interior is an unlit black cavity with invisible vehicle silhouettes",
              })
            }
          >
            💡 Dark Showroom
          </button>
          <button
            type="button"
            className="bug-report-panel__chip"
            onClick={() =>
              applyPreset({
                title: "Cannot drive into garage: unpaved gap and curb lip",
                steps:
                  "1. Approach Gearbox Auto Hub from highway\n2. Steer car toward entrance forecourt and bays",
                expected:
                  "Continuous paved driveway apron bridging road to garage forecourt with parking stalls",
                actual:
                  "Dirt verge and elevated concrete slab lip block smooth vehicle entry",
              })
            }
          >
            🚗 Garage Driveway
          </button>
          <button
            type="button"
            className="bug-report-panel__chip"
            onClick={() =>
              applyPreset({
                title: "Player avatar on foot cannot walk on garage plot",
                steps:
                  "1. Exit vehicle or approach garage on foot\n2. Attempt to walk onto showroom floor or forecourt",
                expected:
                  "Commercial garage plot is fully walkable for pedestrians",
                actual: "First-person walk blocked with 'parcel' reason",
              })
            }
          >
            🚶 Walk Blocked
          </button>
          <button
            type="button"
            className="bug-report-panel__chip"
            onClick={() =>
              applyPreset({
                title: "HUD buttons and banners overlapping modal dialogs",
                steps:
                  "1. Open modal (e.g. Log Bug, Roadmap, or Settings) while driving\n2. Observe top driving HUD and mission banner",
                expected:
                  "Modals and overlays sit above gameplay HUD; buttons never overlap or obscure dialogs",
                actual:
                  "Driving HUD and mission pills render directly on top of modal controls",
              })
            }
          >
            🔲 Button Overlap
          </button>
        </div>

        {/* Freelance Prompt / AI Assist Section */}
        <div className="bug-report-panel__prompt-container">
          <div className="bug-report-panel__prompt-label">
            <span>✨ Freelance Talk / Write</span>
            <small style={{ color: "#a5c2d6", fontSize: 10 }}>
              Right-click anywhere to rework
            </small>
          </div>
          <textarea
            className="bug-report-panel__prompt-input"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Talk or freelance write what is wrong (e.g. 'tree in middle of road near garage', 'buttons overlapping modal', etc.)..."
          />
          <div className="bug-report-panel__prompt-actions">
            <button
              type="button"
              className="bug-report-panel__action-btn bug-report-panel__action-btn--primary"
              onClick={() => autoFillFromPrompt()}
            >
              🪄 Auto-Fill Form
            </button>
            <button
              type="button"
              className="bug-report-panel__action-btn bug-report-panel__action-btn--secondary"
              onClick={reworkForm}
            >
              🔄 Rework
            </button>
          </div>
        </div>

        <button
          type="button"
          className="bug-report-panel__capture"
          data-bug-action="capture"
          onClick={captureCurrentView}
          style={{ marginTop: 12 }}
        >
          Capture current view
        </button>
        {capture && (
          <div
            className="bug-report-panel__capture-preview-container"
            style={{ marginTop: 8 }}
          >
            <p
              className="bug-report-panel__capture-id"
              style={{ margin: "0 0 6px 0" }}
            >
              Capture <code>{capture.context.captureId}</code> · sol{" "}
              {capture.context.sol.sol} · {capture.context.viewport.width}×
              {capture.context.viewport.height}
            </p>
            {capture.pngDataUrl ? (
              <img
                src={capture.pngDataUrl}
                alt="Captured viewport preview"
                data-testid="bug-capture-preview"
                style={{
                  width: "100%",
                  maxHeight: "180px",
                  objectFit: "contain",
                  borderRadius: "6px",
                  border: "1px solid rgba(138, 203, 255, 0.3)",
                  background: "#0a101d",
                  display: "block",
                }}
              />
            ) : (
              <p
                data-testid="bug-capture-warning"
                style={{ color: "#ff8080", fontSize: "11px", margin: "4px 0" }}
              >
                ⚠️ Warning: No visual screenshot buffer was captured.
              </p>
            )}
          </div>
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

        {/* Right-click rework context menu */}
        {contextMenu && (
          <div
            className="bug-report-panel__rework-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="bug-report-panel__rework-item"
              onClick={() => {
                autoFillFromPrompt();
                setContextMenu(null);
              }}
            >
              🪄 Rework from prompt
            </button>
            <button
              type="button"
              className="bug-report-panel__rework-item"
              onClick={() => {
                reworkForm();
              }}
            >
              ✨ Polish & format as QA repro
            </button>
            <button
              type="button"
              className="bug-report-panel__rework-item"
              onClick={() => {
                setTitle("");
                setSteps("");
                setExpected("");
                setActual("");
                setDetail("");
                setPromptText("");
                setContextMenu(null);
                setStatus("Cleared form");
              }}
            >
              🧹 Clear form
            </button>
          </div>
        )}
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
