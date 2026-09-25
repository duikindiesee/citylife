# Kooker2 CityLife runner activation

The CityLife repository is public, so a self-hosted runner must not be made available to arbitrary workflow revisions. The `CityLife Kooker2 Trusted Main` workflow is limited to `main` pushes/manual dispatches and remains disabled until `CITYLIFE_KOOKER2_RUNNER_ENABLED=true`, but workflow YAML guards alone are not an access boundary: a pull request can change its own workflow file.

Before registering the runner or setting the variable:

1. Create an organization-level runner group for Kooker2 and allow only `duikindiesee/citylife/.github/workflows/kooker2-trusted-main.yml@refs/heads/main` from this repository. Do not grant access to all repository workflows.
2. Register the runner in that group with the labels `Windows`, `X64`, `citylife-webgl`, and `kooker2-gpu`, and confirm the runner group permits only the CityLife repository.
3. Install/run the service under a dedicated, least-privilege Windows account that has no Kooker operator DPAPI profile or unrelated credentials. Use a service-managed runner directory and verify restart recovery and cleanup.
4. Set the repository variable `CITYLIFE_KOOKER2_RUNNER_ENABLED=true` only after the group and host controls above are verified.
5. Confirm a `main` run reports the runner name and labels in `ci-runs.json`; confirm PR/fork workflow revisions cannot acquire the runner.

## Service-account script policy

The dedicated runner service uses a non-interactive Windows service account. On hosts where the machine execution policy blocks GitHub Actions' generated temporary PowerShell job scripts, the trusted-main workflow may set its job-level shell to `powershell -ExecutionPolicy Bypass -File {0}`. This is a process-scoped override for that one already-restricted job: it does not alter the machine execution policy, the runner service identity, or any other workflow.

Treat this override as residual trusted-main risk. It is permitted only while the organization runner group remains restricted to this repository and the exact `main` workflow path above. Do not copy it to pull-request workflows, general workflow defaults, or host configuration. Any change to its scope, runner-group policy, or service identity requires a fresh exact-head review and a successful Kooker2 main run.

The reporter runs on GitHub-hosted infrastructure from the default-branch workflow and uses only the short-lived `GITHUB_TOKEN`. It does not check out or execute CI run code and never downloads CI artifacts. It captures completed workflows in this repository (except its own publisher runs), retains the newest 250 runs in the feed, writes sanitized run/job metadata to the orphan `ci-reports` branch, and keeps generated data commits off `main`.
