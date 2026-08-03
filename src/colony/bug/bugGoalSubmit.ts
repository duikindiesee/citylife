// BUG.SUBMIT.1 — actually file the bug, instead of leaving it in the browser.
//
// WHAT WAS WRONG. `BugReportPanel` defaulted to `localBugGoalSubmitter`, which wrote the payload into
// `localStorage` under `citylife.bugGoals.v1` and returned a FABRICATED id, `local-<clientToken>`.
// Nothing ever read that key back — the only three references to it are its declaration and the
// get/set inside the writer itself. So a filed bug lived on one device, in one browser profile, until
// site data was cleared, and nobody else could ever see it. The panel still said "Queue as goal" and
// handed back an id, which to a player reads as FILED.
//
// WHY THIS POSTS TO THE CITYLIFE BACKEND AND NOT TO THE TASK API DIRECTLY.
//
// The obvious design — have the browser POST the governed task itself — is wrong and would be a
// security defect. Creating a governed task requires an admin or worker credential; a player's bearer
// token is not one. (The fleet's own orchestrator records exactly this: it "has no admin/user JWT or
// worker credential to ... create tasks".) A browser that could create tasks would have to carry a
// privileged credential, which must never be shipped to a client.
//
// So this follows the seam every other CityLife player-facing write already uses: POST to the
// authenticated CityLife backend as the PLAYER, and let the server, holding its own credential,
// create the governed task. Same shape as `blueprintStore.saveBlueprintBackend` and the
// player-home/car-ownership endpoints.
//
// The payload is `BugTaskSubmission` unchanged — `bugTrack.planBugTaskSubmission` already produces
// exactly the governed goal shape (kind, repo, branch, priority, pathGlobs, scopeKeys, reviewPolicy)
// with a `clientToken` derived from the report id, so a replayed submission cannot open a second task.
// Nothing about the governed contract is re-invented here; this is the transport that was missing.
//
// FAIL-SAFE, AND HONEST ABOUT IT. A 404 means the kooker-side endpoint has not shipped yet — the same
// convention `blueprintStore` documents — and every failure falls back to the local copy so a bug
// found offline is not lost. What must NOT happen again is the fallback pretending to be a filing:
// the result carries `mode: "planned"` and a message that says the report is on this device only.
import { getAuthClient } from "../authClient";
import type { BugTaskSubmission } from "./bugTrack";

/** The player-authenticated CityLife endpoint. The server creates the governed task, not the client. */
export const BUG_REPORT_BACKEND_PATH = "/kooker/api/v1/citylife/bug-reports";

/** Bounded, so a hung gateway falls back to the local copy instead of leaving the panel spinning. */
export const BUG_SUBMIT_TIMEOUT_MS = 10_000;

export interface BugSubmitOutcome {
  /** "submitted" ONLY when the backend accepted it and returned a task id. Everything else is planned. */
  readonly mode: "planned" | "submitted";
  /** The server's task id when submitted; the local marker otherwise. Never fabricated as a real id. */
  readonly taskId: string;
  /** Player-facing text. For "planned" it must say the report has not been filed yet. */
  readonly message: string;
  /** Short reason for a non-submission, for logging. Never shown as if it were a task id. */
  readonly reason?: string;
}

export type BugSubmitTransport = (
  path: string,
  init: { headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; body: unknown }>;

export interface BugSubmitDeps {
  transport: BugSubmitTransport;
  getToken: () => Promise<string | null>;
  /** Persist a copy locally when the submission does not land. Returns the local marker. */
  saveLocal: (submission: BugTaskSubmission) => string;
}

/** The wording a player sees when the report is only on their device. It must never read as filed. */
export const NOT_FILED_MESSAGE =
  "Saved on this device only — not filed yet. It will stay here until it can be sent.";

/** Pull a task id out of whatever shape the backend answers with, or null if it did not give one. */
export function taskIdFromResponse(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  for (const key of ["taskId", "id", "task_id"]) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  // Some endpoints nest the created resource.
  const task = rec["task"];
  if (task && typeof task === "object") return taskIdFromResponse(task);
  return null;
}

/**
 * Submit a planned bug goal.
 *
 * Returns "submitted" ONLY on an unambiguous backend acceptance that carries a task id. Signed out, a
 * 404 (endpoint not shipped), any other non-ok status, a malformed body, a timeout or a thrown
 * transport all resolve to "planned" WITH the local copy saved and a message that says so.
 */
export async function submitBugGoal(
  submission: BugTaskSubmission,
  deps: BugSubmitDeps,
): Promise<BugSubmitOutcome> {
  const planned = (reason: string): BugSubmitOutcome => ({
    mode: "planned",
    taskId: deps.saveLocal(submission),
    message: NOT_FILED_MESSAGE,
    reason,
  });

  const token = await deps.getToken();
  if (!token) return planned("not signed in");

  try {
    const res = await deps.transport(BUG_REPORT_BACKEND_PATH, {
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(submission),
    });
    if (!res.ok) {
      return planned(
        res.status === 404
          ? "bug-report endpoint not shipped yet"
          : `HTTP ${res.status}`,
      );
    }
    const taskId = taskIdFromResponse(res.body);
    // An "ok" with no task id is NOT a filing. Treating it as one is exactly the failure this module
    // exists to end — a player told their bug was filed when nothing holds it.
    if (!taskId) return planned("backend accepted but returned no task id");
    return {
      mode: "submitted",
      taskId,
      message: `Filed as ${taskId}. It is now in the work queue.`,
    };
  } catch (e) {
    return planned(e instanceof Error ? e.message : "network error");
  }
}

/** Browser deps: POST through the /kooker proxy as the signed-in player, time-bounded. */
export function defaultBugSubmitDeps(
  saveLocal: (submission: BugTaskSubmission) => string,
  timeoutMs = BUG_SUBMIT_TIMEOUT_MS,
): BugSubmitDeps {
  return {
    transport: async (path, init) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(path, {
          method: "POST",
          headers: init.headers,
          body: init.body,
          signal: controller.signal,
        });
        let body: unknown = null;
        try {
          body = await resp.json();
        } catch {
          body = null;
        }
        return { ok: resp.ok, status: resp.status, body };
      } finally {
        clearTimeout(timer);
      }
    },
    getToken: () => getAuthClient().getValidToken(),
    saveLocal,
  };
}
