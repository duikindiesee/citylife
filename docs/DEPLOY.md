# CityLife — internal-only 24/7 deploy

CityLife runs inside the kooker kind-cluster as a static nginx SPA. It is **internal-only — not
visible to the world**. Public reachability in this cluster comes solely from a host rule in the
kooker ingress behind the ngrok wildcard; CityLife deliberately has **no ingress host rule**, so it
is unreachable from the internet. Access is by `kubectl port-forward` only.

## What ships

- `Dockerfile` — two stages: build the vite bundle, serve `dist/` with nginx.
- `nginx.conf` — SPA history fallback plus correct MIME for the three.js ES modules and asset types.
- The k8s manifests live in **kooker-infra** at `manifests/base/citylife/` and the Argo app at
  `argo/applications/citylife.yaml` (ClusterIP Service, namespace `kooker`, no ingress host).

## No secret in the bundle

The image is built with **no `VITE_CITYLIFE_PAT`**, so no inference token is compiled into the
artifact. The colony sim, the renderer, and the cinematic broadcast loop (`?tv=1`) all run without
it. Live Border Patrol bot replies need inference auth — supply it at runtime through a proxy in
front of the `kooker-service-ai` choke point, never by baking a token into the build.

## Build and deploy (manual path)

There is currently **no automated CI publish** for this image. The CityLife repo lives under
`github.com/duikland` while the container registry and GitOps manifests live under `duikindiesee`,
so an automated `ghcr.io/duikindiesee/citylife` publish needs a cross-org token that is not wired up
yet (see the blocker below). Until then, build and push by hand:

```
docker build -t ghcr.io/duikindiesee/citylife:dev .
docker push ghcr.io/duikindiesee/citylife:dev
```

Then pin the tag in `kooker-infra/manifests/overlays/develop/citylife/kustomization.yaml` and let
Argo sync, or apply directly:

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

## Open blockers / decisions for the operator

- **Cross-org CI token.** Automated publish to `ghcr.io/duikindiesee/citylife` and a GitOps tag
  bump in `duikindiesee/kooker-infra` from the `duikland/citylife` repo need a cross-org PAT/secret
  that may not exist. Until it is added, use the manual build path above. No broken workflow is
  committed to avoid failing CI on every push.
- **Production inference auth.** Decide how the served SPA reaches the choke point with auth in
  prod (a runtime proxy that injects a service token, or per-user auth via the gateway). Do not bake
  `VITE_CITYLIFE_PAT` into the bundle even internally.
