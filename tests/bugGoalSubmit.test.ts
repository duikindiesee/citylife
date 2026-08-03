// BUG.SUBMIT.1 — a filed bug must actually reach the queue, and must never CLAIM to when it hasn't.
//
// WHAT WAS WRONG. `BugReportPanel` defaulted to a local-only writer: it put the payload in
// `localStorage` under `citylife.bugGoals.v1`, returned a fabricated `local-<clientToken>` id, and
// nothing ever read that key back — the only references to it are its declaration and the get/set
// inside the writer. A filed bug lived on one device, in one browser profile, until site data was
// cleared. Nobody else could see it. The panel still said "Queue as goal" and handed back an id,
// which to a player reads as FILED.
//
// The rule these tests exist to hold: **"submitted" is claimed ONLY on an unambiguous backend
// acceptance carrying a real task id.** Every other outcome saves locally and says so, in words.
import { describe, expect, it } from "vitest";
import {
  BUG_REPORT_BACKEND_PATH,
  NOT_FILED_MESSAGE,
  submitBugGoal,
  taskIdFromResponse,
  type BugSubmitDeps,
} from "../src/colony/bug/bugGoalSubmit";
import type { BugTaskSubmission } from "../src/colony/bug/bugTrack";

const submission = {
  clientToken: "bugtrack-bugrec_abc123",
  title: "bus does not stop",
  body: "steps...",
  kind: "dev",
  repo: "duikindiesee/citylife",
  branch: "main",
  priority: 2,
  pathGlobs: [],
  scopeKeys: [],
  reviewPolicy: "MERGE",
} as unknown as BugTaskSubmission;

/** Deps whose local save is observable, so "did it keep a copy?" is directly assertable. */
function deps(
  over: Partial<BugSubmitDeps> & { saved?: string[] } = {},
): BugSubmitDeps & { saved: string[] } {
  const saved: string[] = [];
  return {
    saved,
    transport: async () => ({ ok: true, status: 200, body: { taskId: "T-1" } }),
    getToken: async () => "tok",
    saveLocal: (s) => {
      saved.push(s.clientToken);
      return `local-${s.clientToken}`;
    },
    ...over,
  } as BugSubmitDeps & { saved: string[] };
}

describe("BUG.SUBMIT.1 — a real filing", () => {
  it("reports submitted, with the SERVER's task id, and does not save a local copy", async () => {
    const d = deps();
    const out = await submitBugGoal(submission, d);
    expect(out.mode).toBe("submitted");
    expect(out.taskId).toBe("T-1");
    expect(out.message).toContain("T-1");
    // A successful filing must not also leave a stale device copy to be re-submitted later.
    expect(d.saved).toEqual([]);
  });

  it("posts the governed payload, as the player, to the CityLife backend", async () => {
    let seenPath = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody = "";
    await submitBugGoal(
      submission,
      deps({
        transport: async (path, init) => {
          seenPath = path;
          seenHeaders = init.headers;
          seenBody = init.body;
          return { ok: true, status: 201, body: { id: "T-9" } };
        },
      }),
    );
    expect(seenPath).toBe(BUG_REPORT_BACKEND_PATH);
    expect(seenHeaders["Authorization"]).toBe("Bearer tok");
    // The governed shape must go through untouched — clientToken is what makes a replay idempotent.
    const sent = JSON.parse(seenBody);
    expect(sent.clientToken).toBe("bugtrack-bugrec_abc123");
    expect(sent.repo).toBe("duikindiesee/citylife");
    expect(sent.reviewPolicy).toBe("MERGE");
  });

  it("accepts the several shapes a backend may use for the id", () => {
    expect(taskIdFromResponse({ taskId: "a" })).toBe("a");
    expect(taskIdFromResponse({ id: "b" })).toBe("b");
    expect(taskIdFromResponse({ task_id: "c" })).toBe("c");
    expect(taskIdFromResponse({ task: { id: "d" } })).toBe("d");
  });
});

describe("BUG.SUBMIT.1 — every non-filing says so, and keeps the report", () => {
  const cases: [string, Partial<BugSubmitDeps>][] = [
    ["signed out", { getToken: async () => null }],
    [
      "endpoint not shipped (404)",
      { transport: async () => ({ ok: false, status: 404, body: null }) },
    ],
    [
      "server error",
      { transport: async () => ({ ok: false, status: 500, body: null }) },
    ],
    [
      "forbidden",
      { transport: async () => ({ ok: false, status: 403, body: null }) },
    ],
    [
      "network throw",
      {
        transport: async () => {
          throw new Error("offline");
        },
      },
    ],
    [
      "accepted but no task id — the dangerous one",
      { transport: async () => ({ ok: true, status: 200, body: {} }) },
    ],
    [
      "accepted with a malformed body",
      { transport: async () => ({ ok: true, status: 200, body: "yes" }) },
    ],
  ];

  for (const [name, over] of cases) {
    it(`${name}: reports planned, says NOT FILED, and keeps a device copy`, async () => {
      const d = deps(over);
      const out = await submitBugGoal(submission, d);
      expect(out.mode, name).toBe("planned");
      // The wording is the whole point: it must not read as a filing.
      expect(out.message).toBe(NOT_FILED_MESSAGE);
      expect(out.message.toLowerCase()).toContain("not filed");
      // The report is never lost.
      expect(d.saved).toEqual(["bugtrack-bugrec_abc123"]);
      // And the marker is unmistakably local, never presentable as a governed task id.
      expect(out.taskId.startsWith("local-")).toBe(true);
    });
  }

  it("does not call the backend at all when signed out", async () => {
    let called = false;
    await submitBugGoal(
      submission,
      deps({
        getToken: async () => null,
        transport: async () => {
          called = true;
          return { ok: true, status: 200, body: { taskId: "T" } };
        },
      }),
    );
    expect(called, "no token must short-circuit before the request").toBe(
      false,
    );
  });

  it("an ok response with no id is NOT treated as filed", async () => {
    // Called out separately because it is the failure mode most likely to be written carelessly:
    // HTTP 200 looks like success, but with no task id nothing holds the report.
    const out = await submitBugGoal(
      submission,
      deps({ transport: async () => ({ ok: true, status: 200, body: {} }) }),
    );
    expect(out.mode).toBe("planned");
    expect(out.reason).toContain("no task id");
  });
});
