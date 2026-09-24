import { pathToFileURL } from "node:url";

const REPORT_BRANCH = "ci-reports";
const REPORT_PATH = "ci-runs.json";
const MAX_RUNS = 250;
const API_VERSION = "2022-11-28";

export function durationSeconds(start, end) {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 1000);
}

function safeText(value, maxLength = 300) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function safeUrl(value, expectedPrefix) {
  if (typeof value !== "string" || !value.startsWith(expectedPrefix)) return "";
  return value;
}

export function makeRunRecord(run, jobs, pullRequests = [], serverUrl = "https://github.com") {
  const repo = safeText(run.repository?.full_name, 200);
  const runId = Number(run.id);
  const sha = /^[a-f0-9]{40}$/i.test(run.head_sha ?? "") ? run.head_sha.toLowerCase() : "";
  const repoUrl = `${serverUrl}/${repo}`;
  const normalizedPullRequests = pullRequests
    .filter((pr) => Number.isSafeInteger(Number(pr.number)) && Number(pr.number) > 0)
    .map((pr) => {
      const number = Number(pr.number);
      const candidateUrl = typeof pr.html_url === "string" ? pr.html_url : `${repoUrl}/pull/${number}`;
      return { number, url: safeUrl(candidateUrl, `${repoUrl}/pull/`) };
    })
    .filter((pr) => pr.url);
  const normalizedJobs = jobs.map((job) => ({
    id: Number(job.id),
    name: safeText(job.name, 200),
    status: safeText(job.status, 40),
    conclusion: safeText(job.conclusion, 40),
    runnerName: safeText(job.runner_name, 200),
    runnerGroup: safeText(job.runner_group_name, 200),
    runnerLabels: Array.isArray(job.labels) ? job.labels.map((label) => safeText(label, 100)).filter(Boolean) : [],
    startedAt: safeText(job.started_at, 40),
    completedAt: safeText(job.completed_at, 40),
    durationSeconds: durationSeconds(job.started_at, job.completed_at),
  }));
  const runnerNames = [...new Set(normalizedJobs.map((job) => job.runnerName || job.runnerGroup).filter(Boolean))];
  const prNumbers = [...new Set(normalizedPullRequests.map((pr) => pr.number))];
  const startedAt = safeText(run.run_started_at, 40);
  const completedAt = safeText(run.updated_at, 40);

  return {
    runId: Number.isSafeInteger(runId) ? runId : 0,
    workflowName: safeText(run.name, 200),
    workflowUrl: `${repoUrl}/actions/runs/${Number.isSafeInteger(runId) ? runId : 0}`,
    event: safeText(run.event, 80),
    branch: safeText(run.head_branch, 300),
    sha,
    commitUrl: sha ? `${repoUrl}/commit/${sha}` : "",
    pullRequestNumbers: prNumbers.map((number) => `#${number}`).join(", "),
    pullRequestUrl: normalizedPullRequests[0]?.url ?? "",
    pullRequests: normalizedPullRequests,
    status: safeText(run.status, 40),
    conclusion: safeText(run.conclusion, 40),
    startedAt,
    completedAt,
    durationSeconds: durationSeconds(startedAt, completedAt),
    runnerSummary: runnerNames.join(", ") || "No runner assigned",
    jobs: normalizedJobs,
  };
}

export function mergeRunIntoReport(existing, incoming, limit = MAX_RUNS, updatedAt = new Date().toISOString()) {
  const previous = Array.isArray(existing?.runs) ? existing.runs : [];
  const byId = new Map(previous.map((run) => [Number(run.runId), run]));
  byId.set(Number(incoming.runId), incoming);
  const runs = [...byId.values()]
    .filter((run) => Number.isSafeInteger(Number(run.runId)) && Number(run.runId) > 0)
    .sort((a, b) => Number(b.runId) - Number(a.runId))
    .slice(0, limit);
  return { schemaVersion: 1, updatedAt, runs };
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createGitHubClient({ token, repository, apiUrl = "https://api.github.com" }) {
  async function request(path, options = {}) {
    const response = await fetch(`${apiUrl}/repos/${repository}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "Content-Type": "application/json",
        "User-Agent": "citylife-ci-report-publisher",
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const raw = await response.text();
    const body = raw ? JSON.parse(raw) : null;
    if (!response.ok) throw new ApiError(response.status, body?.message ?? `GitHub API ${response.status}`);
    return body;
  }
  return { request };
}

async function listJobs(client, runId) {
  const jobs = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await client.request(`/actions/runs/${runId}/jobs?per_page=100&page=${page}`);
    jobs.push(...(result.jobs ?? []));
    if ((result.jobs ?? []).length < 100) return jobs;
  }
  return jobs;
}

async function resolvePullRequests(client, run, repository) {
  if (Array.isArray(run.pull_requests) && run.pull_requests.length > 0) return run.pull_requests;
  if (!/^[a-f0-9]{40}$/i.test(run.head_sha ?? "")) return [];
  const associated = await client.request(`/commits/${run.head_sha}/pulls?per_page=100`);
  return (Array.isArray(associated) ? associated : []).filter((pr) => pr.base?.repo?.full_name === repository);
}

async function readReport(client, branchSha) {
  if (!branchSha) return { schemaVersion: 1, runs: [] };
  try {
    const file = await client.request(`/contents/${REPORT_PATH}?ref=${REPORT_BRANCH}`);
    const content = Buffer.from(String(file.content ?? "").replace(/\s/g, ""), "base64").toString("utf8");
    const report = JSON.parse(content);
    return { schemaVersion: 1, runs: Array.isArray(report.runs) ? report.runs : [] };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { schemaVersion: 1, runs: [] };
    throw error;
  }
}

async function publishReport(client, record, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let ref = null;
    try {
      ref = await client.request(`/git/ref/heads/${REPORT_BRANCH}`);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
    const parentSha = ref?.object?.sha ?? null;
    const existing = await readReport(client, parentSha);
    const report = mergeRunIntoReport(existing, record);
    const content = `${JSON.stringify(report, null, 2)}\n`;
    let baseTree = null;
    if (parentSha) {
      const parent = await client.request(`/git/commits/${parentSha}`);
      baseTree = parent.tree.sha;
    }
    const treeBody = {
      tree: [{ path: REPORT_PATH, mode: "100644", type: "blob", content }],
      ...(baseTree ? { base_tree: baseTree } : {}),
    };
    const tree = await client.request("/git/trees", { method: "POST", body: treeBody });
    const commit = await client.request("/git/commits", {
      method: "POST",
      body: {
        message: `ci-reports: record run ${record.runId}`,
        tree: tree.sha,
        parents: parentSha ? [parentSha] : [],
      },
    });
    try {
      if (parentSha) {
        await client.request(`/git/refs/heads/${REPORT_BRANCH}`, {
          method: "PATCH",
          body: { sha: commit.sha, force: false },
        });
      } else {
        await client.request("/git/refs", {
          method: "POST",
          body: { ref: `refs/heads/${REPORT_BRANCH}`, sha: commit.sha },
        });
      }
      return commit.sha;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 422)) continue;
      throw error;
    }
  }
  throw new Error("Could not publish CI report after concurrent update retries");
}

async function main() {
  const repository = process.env.CI_REPORT_REPOSITORY || process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repository || !token || !eventPath) throw new Error("Missing repository, GITHUB_TOKEN, or event payload path");
  const event = JSON.parse(await (await import("node:fs/promises")).readFile(eventPath, "utf8"));
  const runId = Number(process.env.CI_REPORT_RUN_ID || event.workflow_run?.id);
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error("Invalid workflow run id");
  const client = createGitHubClient({ token, repository, apiUrl: process.env.GITHUB_API_URL });
  const run = await client.request(`/actions/runs/${runId}`);
  if (run.repository?.full_name !== repository) throw new Error("Refusing to report a run from another repository");
  if (run.name === "Publish CI run reports") {
    console.log("Skipping the report publisher's own workflow run");
    return;
  }
  const [jobs, pullRequests] = await Promise.all([
    listJobs(client, runId),
    resolvePullRequests(client, run, repository),
  ]);
  const record = makeRunRecord(run, jobs, pullRequests, process.env.GITHUB_SERVER_URL || "https://github.com");
  if (!record.sha) throw new Error("Workflow run has no valid 40-character commit SHA");
  const commitSha = await publishReport(client, record);
  console.log(`Published run ${record.runId} for ${repository} (${record.sha}) as ${commitSha}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
