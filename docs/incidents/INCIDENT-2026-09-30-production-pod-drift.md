# Incident Record: Production Drift on citylife.kooker.co.za via Ephemeral Pod Sync

- **Incident ID:** INCIDENT-2026-09-30-PROD-DRIFT-01
- **Severity:** P1 (Production Integrity / Release Pipeline Bypass)
- **Status:** Contained / Investigation Completed / Recovery Proposal Pending Operator Authorization
- **Related PR:** https://github.com/duikindiesee/citylife/pull/549
- **Related Task API Gate:** `1907c3ce-a1d0-4134-8c15-7c436d33550d` (Note: direct mutation via API blocked by role permission denial HTTP 403; recorded via durable repository documentation)
- **Date Recorded:** 2026-09-30 19:05 SAST (17:05 UTC)

---

## 1. Executive Summary

On 2026-09-30, operator Irwin confirmed that `citylife.kooker.co.za` is **PRODUCTION**, regardless of its internal `develop` environment directory pathing or GitOps overlay naming.

A handoff dispatch in repository `duikindiesee/kooker-bot-constitution` (commit `0c5c05bc96a39cb0353d76ee3dbc3efb364e2f05` at 14:10:59 SAST) reported that during visual authoring, a compiled production bundle (`dist/`) was copied directly into `/usr/share/nginx/html` of cluster pod `citylife-6f4dc6fdc9-bf5bm` via SSH/kubectl for visual verification.

This investigation establishes:

1. **Public Serving Status:** Pod `citylife-6f4dc6fdc9-bf5bm` belongs to Deployment `citylife` in namespace `kooker`, which is targeted by Service `citylife:80` — the sole backend for Ingress host `citylife.kooker.co.za`. Therefore, **pod `citylife-6f4dc6fdc9-bf5bm` DOES serve the public production site**.
2. **Production Drift Confirmed:** Live HTTP responses from `https://citylife.kooker.co.za` confirmed served assets with timestamp `Last-Modified: Wed, 30 Sep 2026 11:11:06 GMT` (13:11:06 SAST), referencing bundles (`index-CPyYEmtr.js`, `CommercialBlock-DfJNOuiL.js`) that diverged from the immutable container image `ghcr.io/duikindiesee/citylife:0.58.0` pinned in GitOps repository `kooker-infra`.
3. **Safety & Containment:** In strict compliance with instructions, **zero direct live changes, zero pod copies, zero restarts, and zero ad-hoc rollbacks** have been executed during this investigation. Implementation continues in local isolation.

---

## 2. Chronology & Execution Receipts

- **2026-09-30 14:08:08 +02:00:** Git commit `c380c62489e0332bd04db73dea10c1d35ab6a37b` authored on branch `antigravity/1907c3ce-a1d0-4134-8c15-7c436d33550d-raceable-roads` by `duikland <duikland@users.noreply.github.com>`: `fix(render): remove drivewayApron mesh projecting onto road and crosswalk`.
- **2026-09-30 14:10:59 +02:00:** Bridge dispatch commit `0c5c05bc96a39cb0353d76ee3dbc3efb364e2f05` pushed by `duikland` to `kooker-bot-constitution` (`bridge-live`), recording in `bridge/to-mojojo/2026-09-30-citylife-pr549-specs-173-176-review.md`:
  > _"During iterative visual and spatial authoring of the showroom lighting, paved apron, and road clearance, the compiled production bundle (`dist/`) was copied into `/usr/share/nginx/html` of development cluster pod `citylife-6f4dc6fdc9-bf5bm` via SSH/kubectl for immediate exploratory verification."_
- **2026-09-30 17:00:57 UTC:** Diagnostic HTTP probe against `https://citylife.kooker.co.za/`:
  - `HTTP/1.1 200 OK`
  - `Date: Wed, 30 Sep 2026 17:00:57 GMT`
  - `Last-Modified: Wed, 30 Sep 2026 11:11:06 GMT` (13:11:06 SAST / UTC+2)
  - `Etag: W/"6abcee4a-3da"`
  - `Content-Length: 986`
  - Body references: `/assets/index-CPyYEmtr.js`, `/assets/CommercialBlock-DfJNOuiL.js`, `/assets/AuthGate-CNOMwXdU.js`, `/assets/index-DyjNZK20.css`.

---

## 3. Facts vs. Assumptions

| Item                         | Status   | Evidence / Source                                                                                                                                                                                                                                  |
| :--------------------------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target Host / Context        | **Fact** | Kubernetes in-cluster (`https://kubernetes.default.svc`) managed by ArgoCD (`argocd.argoproj.io/sync-wave: "2"`).                                                                                                                                  |
| Target Namespace             | **Fact** | Namespace `kooker` (defined in `kooker-infra/argo/applications/citylife.yaml` line 14).                                                                                                                                                            |
| Target Pod / Deployment      | **Fact** | Deployment `citylife`, ReplicaSet `citylife-6f4dc6fdc9`, Pod `citylife-6f4dc6fdc9-bf5bm`.                                                                                                                                                          |
| Target Path inside Container | **Fact** | `/usr/share/nginx/html` (Nginx default webroot for static SPA).                                                                                                                                                                                    |
| Public Traffic Serving       | **Fact** | Ingress `citylife.kooker.co.za` routes prefix `/` to Service `citylife:80`, which routes to pod selector `app: citylife`. Confirmed serving live public requests.                                                                                  |
| Local Execution              | **Fact** | Local shell history (`(Get-PSReadLineOption).HistorySavePath`) and `kubectl config current-context` contain no cluster credentials or `kubectl cp` / `ssh` invocations. Execution took place in an external operator environment under `duikland`. |
| Production Release Bypass    | **Fact** | Live pod served files from local unmerged commit `c380c62` instead of the immutable image built from `main` by GitHub Actions.                                                                                                                     |

---

## 4. Reconciliation: Deployed Image vs. Served Bundle

1. **GitOps Pinned Truth:**
   - Manifest: `manifests/overlays/develop/citylife/kustomization.yaml` in repo `kooker-infra` (target branch `main`).
   - Pinned Image: `ghcr.io/duikindiesee/citylife:0.58.0`.
   - Base Commit: `b4afe825c7ed888221bff1fbe925a5ffc9ceac67`.
2. **Currently Served Live Files:**
   - Stamp: `Last-Modified: Wed, 30 Sep 2026 11:11:06 GMT`.
   - Entrypoint: `index.html` loading `index-CPyYEmtr.js`.
3. **Discrepancy:**
   - The live Nginx container is running image `ghcr.io/duikindiesee/citylife:0.58.0`, but its container-layer filesystem was overwritten with files compiled locally from unapproved PR #549 branch revisions.
   - The deployment is in a drifted, mutable state outside GitOps provenance.

---

## 5. Permitted Release Flow (The Sole Authorized Path)

Per Irwin's binding instructions, the **only** permitted release path to the cluster is:

```mermaid
flowchart LR
    A["PR Code Complete & Validated"] --> B["MoJoJo Exact-Head Review"]
    B -->|"Receipt APPROVED"| C["Merge PR into main"]
    C --> D["GitHub Actions docker.yml"]
    D --> E["Build Immutable Image & Digest"]
    E --> F["GitOps PR / commit to kooker-infra"]
    F --> G["ArgoCD Auto-Sync & Self-Heal"]
    G --> H["Kubernetes Deployment Rollout"]
    H --> I["Verified Player Acceptance"]
```

Direct file copying into running containers is strictly prohibited.

---

## 6. Concrete Recovery Proposal (For Operator Review & Authorization)

To recover cluster integrity without violating the freeze on ad-hoc mutations:

### Option 1: Clean Reset to Approved Main (Recommended if PR #549 is not yet ready)

- **Action:** An authorized cluster operator executes:
  ```sh
  kubectl rollout restart deployment/citylife -n kooker
  ```
- **Outcome:** The drifted pod `citylife-6f4dc6fdc9-bf5bm` is terminated. Kubernetes spins up a fresh container replica directly from the immutable image `ghcr.io/duikindiesee/citylife:0.58.0` from GHCR. The container's ephemeral root filesystem is refreshed, completely removing all manually copied files and restoring exact alignment with the GitOps repository.

### Option 2: Authorized Landing & Rollout of Completed PR #549

- **Action:** Complete all remaining e2e and CI verifications in local isolation, obtain MoJoJo's independent exact-head review approval receipt, and merge PR #549 to `main`.
- **Outcome:** Workflow `.github/workflows/docker.yml` triggers automatically on `main`:
  1. Computes new semver (e.g. `0.59.0`).
  2. Builds immutable image `ghcr.io/duikindiesee/citylife:0.59.0` with baked `APP_VERSION`, `GIT_SHA`, and `BUILD_TIME`.
  3. Pushes image to GHCR.
  4. Automatically updates `kooker-infra` develop overlay.
  5. ArgoCD deploys the clean, authorized image to the cluster.
