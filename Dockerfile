# CityLife — static SPA build, served by nginx. Internal-only deploy (no public ingress).
#
# IMPORTANT: no secret is baked into the bundle. The build runs vite with no VITE_CITYLIFE_PAT,
# so the shipped image contains no inference token. The colony sim, the cinematic broadcast loop
# (open with ?tv=1) and the renderer all run without it. Live Border Patrol bot replies need
# inference auth, which is supplied AT RUNTIME by the nginx layer below — it injects the Bearer
# from the CITYLIFE_PAT env (a k8s Secret) on the inference route only, never compiled in.
# See docs/DEPLOY.md.

# Stage 1: build the vite bundle.
FROM node:24-alpine AS build
WORKDIR /app
# APP_VERSION is the CI build version (major.minor.run_number, see .github/workflows/docker.yml). It is
# inlined into the bundle as VITE_APP_VERSION so the running app can report which build it is.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
COPY package*.json ./
RUN npm ci || (rm -f package-lock.json && npm install)
COPY . .
RUN npm run build

# Stage 2: serve the static dist/ with nginx, proxying /kooker -> gateway at runtime.
FROM nginx:alpine
# Stamp the version onto the image so `docker inspect` / GHCR shows exactly what is deployed.
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="citylife" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.source="https://github.com/duikland/citylife"

# Runtime config (overridable by the Deployment env / a k8s Secret):
#   KOOKER_GATEWAY        - base URL the SPA's /kooker calls proxy to. In-cluster this is the
#                           internal apisix-gateway service, not the public host.
#   KOOKER_HOST           - Host header sent upstream so APISIX matches its host-based route
#                           (the public hostname) even when proxying to the internal gateway IP.
#   CITYLIFE_BOT_BACKEND  - "kooker" => real Hermes via the proxy; anything else => mock
#   CITYLIFE_MODEL        - model id routed through the choke point
#   CITYLIFE_PAT          - citylife PAT, injected as the Bearer ONLY on the inference route.
#                           Never in the image/repo — sourced from a k8s Secret at runtime.
ENV KOOKER_GATEWAY=https://api.kooker.co.za \
    KOOKER_HOST=api.kooker.co.za \
    CITYLIFE_BOT_BACKEND=mock \
    CITYLIFE_MODEL=kooker-codex \
    CITYLIFE_PAT=""

# Only substitute OUR vars so nginx runtime vars ($uri, $proxy_host, ...) survive envsubst.
ENV NGINX_ENVSUBST_FILTER='^(KOOKER_GATEWAY|KOOKER_HOST|CITYLIFE_PAT|CITYLIFE_BOT_BACKEND|CITYLIFE_MODEL)$'

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
# nginx:alpine's entrypoint renders /etc/nginx/templates/*.template via envsubst, then runs nginx.
