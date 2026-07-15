# Kooker1 hardware-WebGL GitHub Actions runner

## Decision and plan

Use a repository-scoped self-hosted Windows x64 runner on bare kooker1 for the
`verify` job only. Kooker1 has an AMD Radeon GPU; forcing Chromium's ANGLE
backend to D3D11 changes Playwright's renderer from SwiftShader to the AMD GPU.
Keeping the runner bare avoids cluster/GPU pass-through work, so Joe and the
kooker cluster are not involved.

A GitHub-hosted larger runner would reduce CPU contention but ordinary larger
runners do not guarantee hardware WebGL. GitHub's GPU-powered hosted runners
would add recurring cost and plan/availability constraints. Revisit that option
if maintaining a host-bound runner becomes undesirable.

Security boundary: `duikindiesee/citylife` is public, so the self-hosted job is
restricted to pushes and pull requests whose head repository is this repository.
Fork pull requests are skipped and never run code on kooker1. Same-repository
branches remain a trusted-contributor lane. The workflow retains read-only
`contents` permission. Do not broaden the condition to forks.

## Installed runner

- GitHub runner name: `kooker1-citylife-gpu`
- Repository: `duikindiesee/citylife`
- Labels: `self-hosted`, `Windows`, `X64`, `citylife-webgl`, `kooker1-gpu`
- Installation: `C:\actions-runner-citylife`
- Work directory: `C:\actions-runner-citylife\_work`
- Hidden launcher: `C:\actions-runner-citylife\run-hidden.vbs`
- Login startup entry:
  `C:\Users\kooker\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\citylife-github-runner.vbs`

The runner intentionally runs in kooker's interactive login session instead of
Windows service session 0, so Chromium can access the physical GPU. The VBS
launcher suppresses command windows. The startup entry restores the runner at
the next login; it does not require administrator privileges.

## Registration or replacement

Run these commands from Git Bash. Never save or print the short-lived
registration token.

```bash
cd /c/actions-runner-citylife
TOKEN=$(gh api --method POST \
  repos/duikindiesee/citylife/actions/runners/registration-token --jq .token)
./config.cmd --unattended --replace \
  --url https://github.com/duikindiesee/citylife \
  --token "$TOKEN" \
  --name kooker1-citylife-gpu \
  --labels citylife-webgl,kooker1-gpu \
  --work _work
unset TOKEN
```

To start it without a visible console:

```bash
wscript.exe 'C:\actions-runner-citylife\run-hidden.vbs'
```

## Health and GPU checks

Runner health:

```bash
gh api repos/duikindiesee/citylife/actions/runners \
  --jq '.runners[] | select(.name=="kooker1-citylife-gpu") |
        {name,status,busy,labels:[.labels[].name]}'
```

The CI workflow sets `CITYLIFE_HARDWARE_WEBGL=1`. Playwright then launches
Chromium with `--enable-gpu`, `--ignore-gpu-blocklist`, and
`--use-angle=d3d11`. A smoke probe should report `AMD Radeon(TM) Graphics` and
`Direct3D11`, not `SwiftShader`.

If the runner is offline, confirm kooker is logged in, check
`C:\actions-runner-citylife\_diag`, and rerun the hidden launcher. If a stale
listener remains, stop that listener before relaunching; never run two listeners
from the same runner directory.

## Removal

Delete the login startup VBS, stop `Runner.Listener.exe`, then remove the runner
configuration with a fresh removal token:

```bash
cd /c/actions-runner-citylife
TOKEN=$(gh api --method POST \
  repos/duikindiesee/citylife/actions/runners/remove-token --jq .token)
./config.cmd remove --unattended --token "$TOKEN"
unset TOKEN
```
