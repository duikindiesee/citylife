# CityLife — public 24/7 deploy at citylife.kooker.co.za

CityLife runs inside the kooker kind-cluster as a static nginx SPA, served to the world at
**citylife.kooker.co.za**. Public reachability comes from a host rule in the kooker ingress
(`manifests/base/ingress/ingress.yaml`, synced by the `kooker-ingress` Argo app) behind the ngrok
wildcard. The site is **login-gated**: the bundle is a production build (`import.meta.env.DEV` is
`false`), so the local dev auth-skip can never fire on the cluster, and access requires a kooker
login plus membership of the CityLife app-users allowlist. The auth-skip is confined to the
developer's own local dev server (`localhost`, `?skipauth=1` or `VITE_LOCAL_TEST`).

## What ships

- `Dockerfile` — two stages: build the vite bundle, serve `dist/` with nginx.
- `docker/default.conf.template` — the nginx config (rendered by envsubst at container start):
  SPA history fallback, correct MIME for the three.js ES modules and asset caching, PLUS a
  `/kooker` reverse proxy to the gateway and the runtime auth/config described below.
- `.github/workflows/docker.yml` — builds and publishes the image (see "Automated publish").
- The k8s manifests live in **kooker-infra** at `manifests/base/citylife/` and the Argo app at
  `argo/applications/citylife.yaml` (ClusterIP Service, namespace `kooker`). The public host rule
  for `citylife.kooker.co.za` lives in `manifests/base/ingress/ingress.yaml`.

## No secret in the bundle

The image is built with **no `VITE_CITYLIFE_PAT`**, so no inference token is compiled into the
artifact. The colony sim, the renderer, and the cinematic broadcast loop (`?tv=1`) all run without
it. Live Border Patrol bot replies need inference auth — supplied at runtime by the nginx layer,
never by baking a token into the build (see "Runtime inference auth").

## Runtime inference auth (the proxy-injected PAT)

The served SPA reaches the choke point **without ever holding a token**:

- nginx proxies `/kooker/*` to `KOOKER_GATEWAY`, mirroring the vite dev proxy.
- On the inference route **only** (`/kooker/api/v1/ai/route/chat`), nginx injects
  `Authorization: Bearer ${CITYLIFE_PAT}` from the `CITYLIFE_PAT` env, sourced from the
  `citylife-secret` k8s Secret. The browser sends no Authorization header.
- The SPA fetches `/citylife-runtime.json` (rendered from env, **no secret**) on boot. When it
  reports `botBackend:"kooker"`, the bot adapter calls the choke point with no token and lets the
  proxy supply auth; otherwise it falls back to mock stand-in replies.

Set on the Deployment: `KOOKER_GATEWAY`, `CITYLIFE_BOT_BACKEND=kooker`, `CITYLIFE_MODEL`, and
`CITYLIFE_PAT` from the (optional) `citylife-secret`. The pod starts even before the Secret exists
(`optional: true`); real replies light up the moment it is loaded — no image or manifest change.

```
# create the PAT on the kooker-web CityLife PAT page (role: citylife), then:
kubectl create secret generic citylife-secret -n kooker --from-literal=pat='THE_PAT' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n kooker rollout restart deploy/citylife
```

## Automated publish (versioned, like kooker-web)

The image publishes to **`ghcr.io/duikindiesee/citylife`**. CityLife lives in the **duikindiesee** org,
so `.github/workflows/docker.yml` reuses the same shared workflows as kooker-web and versions identically:

1. **node-version-bump** — every merge to `main` opens an auto-merging `chore/bump-X.Y.Z` PR (SemVer from
   Conventional Commits: `feat` → minor, `fix`/other → patch).
2. **build-and-push** — builds `ghcr.io/duikindiesee/citylife:<semver>` (+ `sha`, `latest`) with
   `APP_VERSION` baked in.
3. **gitops-sync** — pins that semver into `manifests/overlays/develop/citylife` in kooker-infra, so Argo
   rolls the Deployment to the exact version each release.

Same-org means the self-hosted runner and `MAVEN_PUBLISH_TOKEN` are inherited via `secrets: inherit` — no
cross-org PAT. The repo is **private**, so the Deployment pulls the image with the shared
`github-registry` imagePullSecret (the same one kooker-web uses).

## Build and deploy (manual path)

```
docker build -t ghcr.io/duikindiesee/citylife:dev .
# local kind (no registry needed): load the image straight onto the node
kind load docker-image ghcr.io/duikindiesee/citylife:dev --name kooker-cluster
# or push to GHCR (requires a token with write:packages):
docker push ghcr.io/duikindiesee/citylife:dev
```

Then let Argo sync the kooker-infra manifests, or apply directly:

```
kubectl apply -k manifests/overlays/develop/citylife
kubectl -n kooker rollout status deploy/citylife
kubectl -n kooker port-forward svc/citylife 8080:80   # local check; open http://localhost:8080 (and ?tv=1)
```

## Confirm the public host rule

```
kubectl -n kooker get svc citylife          # type ClusterIP (ingress fronts it)
grep -R citylife manifests/base/ingress     # MUST show the citylife.kooker.co.za host rule
curl -sI https://citylife.kooker.co.za      # reachable; serves the login-gated SPA
```
