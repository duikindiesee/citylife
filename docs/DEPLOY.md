# CityLife — internal-only 24/7 deploy

CityLife runs inside the kooker kind-cluster as a static nginx SPA. It is **internal-only — not
visible to the world**. Public reachability in this cluster comes solely from a host rule in the
kooker ingress behind the ngrok wildcard; CityLife deliberately has **no ingress host rule**, so it
is unreachable from the internet. Access is by `kubectl port-forward` only.

## What ships

- `Dockerfile` — two stages: build the vite bundle, serve `dist/` with nginx.
- `docker/default.conf.template` — the nginx config (rendered by envsubst at container start):
  SPA history fallback, correct MIME for the three.js ES modules and asset caching, PLUS a
  `/kooker` reverse proxy to the gateway and the runtime auth/config described below.
- `.github/workflows/docker.yml` — builds and publishes the image (see "Automated publish").
- The k8s manifests live in **kooker-infra** at `manifests/base/citylife/` and the Argo app at
  `argo/applications/citylife.yaml` (ClusterIP Service, namespace `kooker`, no ingress host).

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

## Automated publish

The image publishes to **`ghcr.io/duikland/citylife`** — the SAME org as this repo — so CI authenticates
with the built-in `GITHUB_TOKEN` and needs **no cross-org PAT**. `.github/workflows/docker.yml` builds
and pushes `:dev` (and a short-sha tag) on every push to `main`. One-time: set the resulting GHCR
package to **Public** so the cluster pulls it with no imagePullSecret. The kooker-infra manifests pin
`ghcr.io/duikland/citylife:dev`.

## Build and deploy (manual path)

```
docker build -t ghcr.io/duikland/citylife:dev .
# local kind (no registry needed): load the image straight onto the node
kind load docker-image ghcr.io/duikland/citylife:dev --name kooker-cluster
# or push to GHCR (requires a token with write:packages):
docker push ghcr.io/duikland/citylife:dev
```

Then let Argo sync the kooker-infra manifests, or apply directly:

```
kubectl apply -k manifests/overlays/develop/citylife
kubectl -n kooker rollout status deploy/citylife
kubectl -n kooker port-forward svc/citylife 8080:80   # open http://localhost:8080 (and ?tv=1)
```

## Confirm it is internal-only

```
kubectl -n kooker get svc citylife          # type ClusterIP, no external IP
grep -R citylife manifests/base/ingress     # MUST return nothing — no host rule
```
