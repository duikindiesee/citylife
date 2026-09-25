import test from "node:test";
import assert from "node:assert/strict";
import {
  durationSeconds,
  makeRunRecord,
  mergeRunIntoReport,
} from "./ci-report-publisher.mjs";

test("durationSeconds returns whole seconds and rejects incomplete ranges", () => {
  assert.equal(
    durationSeconds("2026-09-24T10:00:00Z", "2026-09-24T10:00:07.500Z"),
    8,
  );
  assert.equal(durationSeconds("2026-09-24T10:00:00Z", null), null);
  assert.equal(durationSeconds("bad", "also bad"), null);
  assert.equal(
    durationSeconds("2026-09-24T10:00:10Z", "2026-09-24T10:00:00Z"),
    null,
  );
});

test("run records link PR, SHA, status, duration, and per-job runner identity", () => {
  const sha = "a".repeat(40);
  const record = makeRunRecord(
    {
      id: 42,
      name: "CI",
      repository: { full_name: "duikindiesee/citylife" },
      head_sha: sha,
      head_branch: "feature/demo",
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      run_started_at: "2026-09-24T10:00:00Z",
      updated_at: "2026-09-24T10:00:30Z",
      pull_requests: [],
    },
    [
      {
        id: 99,
        name: "verify",
        status: "completed",
        conclusion: "success",
        runner_name: "kooker2-citylife-gpu",
        runner_group_name: "citylife-kooker2-gpu",
        labels: ["self-hosted", "Windows", "X64"],
        started_at: "2026-09-24T10:00:02Z",
        completed_at: "2026-09-24T10:00:27Z",
      },
    ],
    [
      {
        number: 527,
        html_url: "https://github.com/duikindiesee/citylife/pull/527",
      },
    ],
  );

  assert.equal(record.runId, 42);
  assert.equal(record.sha, sha);
  assert.equal(
    record.commitUrl,
    `https://github.com/duikindiesee/citylife/commit/${sha}`,
  );
  assert.equal(record.pullRequestNumbers, "#527");
  assert.equal(
    record.pullRequestUrl,
    "https://github.com/duikindiesee/citylife/pull/527",
  );
  assert.equal(record.status, "completed");
  assert.equal(record.conclusion, "success");
  assert.equal(record.durationSeconds, 30);
  assert.equal(record.runnerSummary, "kooker2-citylife-gpu");
  assert.deepEqual(record.jobs[0].runnerLabels, [
    "self-hosted",
    "Windows",
    "X64",
  ]);
  assert.equal(record.jobs[0].durationSeconds, 25);
});

test("REST-shaped PR metadata without html_url still gets a same-repository link", () => {
  const record = makeRunRecord(
    {
      id: 43,
      repository: { full_name: "duikindiesee/citylife" },
      head_sha: "c".repeat(40),
    },
    [],
    [
      {
        number: 527,
        url: "https://api.github.com/repos/duikindiesee/citylife/pulls/527",
      },
    ],
  );
  assert.equal(
    record.pullRequestUrl,
    "https://github.com/duikindiesee/citylife/pull/527",
  );
});

test("report upsert is idempotent, newest first, and bounded", () => {
  const original = {
    schemaVersion: 1,
    runs: [{ runId: 1, conclusion: "failure" }],
  };
  const updated = mergeRunIntoReport(
    original,
    { runId: 1, conclusion: "success" },
    3,
    "2026-09-24T00:00:00Z",
  );
  assert.equal(updated.runs.length, 1);
  assert.equal(updated.runs[0].conclusion, "success");

  const bounded = mergeRunIntoReport(
    updated,
    { runId: 4 },
    3,
    "2026-09-24T00:00:01Z",
  );
  const latest = mergeRunIntoReport(
    bounded,
    { runId: 3 },
    3,
    "2026-09-24T00:00:02Z",
  );
  const capped = mergeRunIntoReport(
    latest,
    { runId: 2 },
    3,
    "2026-09-24T00:00:03Z",
  );
  assert.deepEqual(
    capped.runs.map((run) => run.runId),
    [4, 3, 2],
  );
  assert.equal(capped.updatedAt, "2026-09-24T00:00:03Z");
});

test("PR URLs outside the repository are omitted", () => {
  const record = makeRunRecord(
    {
      id: 7,
      repository: { full_name: "duikindiesee/citylife" },
      head_sha: "b".repeat(40),
    },
    [],
    [
      { number: 1, html_url: "https://attacker.invalid/pull/1" },
      {
        number: 2,
        html_url: "https://github.com/duikindiesee/citylife/pull/2",
      },
    ],
  );
  assert.equal(record.pullRequestNumbers, "#2");
  assert.equal(
    record.pullRequestUrl,
    "https://github.com/duikindiesee/citylife/pull/2",
  );
});
