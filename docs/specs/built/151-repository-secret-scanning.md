# Spec 151 — repository secret scanning

- status: built
- proposed-by: Skoonveld security hygiene signal
- date: 2026-07-15
- depends-on: none

## Why

CityLife is a public-facing repository. A daily security hygiene signal found that its existing
GitHub workflows did not scan commits for secrets and that `.gitignore` did not cover common private
key and signing-container formats. The signal did not prove that a credential was exposed; it
identified a preventive control gap.

The repository must reject new hard-coded credentials without introducing a paid action licence,
an unpinned executable, or a report artifact that can itself disclose a detected value.

## Mechanic

The `Secret scan` workflow runs the open-source Gitleaks CLI over every reachable commit on:

- pull requests targeting `main` or `r3f-colony-migration`;
- pushes to either delivery branch;
- an explicit operator `workflow_dispatch`; and
- a weekly scheduled safety scan.

The workflow downloads one pinned Gitleaks release, verifies the official release checksum before
execution, checks out full history, grants only `contents: read`, and redacts detected values from
logs. It deliberately does not upload a findings report artifact.

## Rules and data

- Gitleaks CLI: `8.30.1`.
- Linux x64 release SHA-256:
  `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`.
- Checkout is pinned to commit `11bd71901bbe5b1630ceea73d27597364c9af683` (`v4.2.2`).
- `.gitignore` blocks `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, and `*.keystore` in addition to
  the existing `.env` rule.
- Exceptions use exact Gitleaks fingerprints. Never disable a rule or allowlist a broad path to make
  CI green.
- The one initial-history exception is an old documentation sentence whose API hostname is followed
  by an operation name. It is scoped to its exact commit, file, rule, and line.
- A real finding triggers credential rotation first, then repository/history remediation. Deleting
  the current file alone does not invalidate a leaked credential.

## Cost — materials and labour

- GitHub-hosted runner time for pull requests, delivery-branch pushes, and one weekly scan.
- Maintainer labour to review alerts and deliberately update the pinned CLI version and checksum.
- No Gitleaks Action organisation licence and no new repository secret are required.

## Acceptance

- A redacted full-history scan passes locally with Gitleaks `8.30.1`.
- Workflow syntax is validated before push.
- A pull request targeting `main` receives a qualifying green `Secret scan` hosted result.
- `workflow_dispatch` is available after the workflow lands.
- A controlled fixture containing a synthetic key fails the scanner outside the committed tree; the
  fixture and report are never committed.
- Existing typecheck, test, and build gates remain green.
