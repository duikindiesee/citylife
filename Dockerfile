# CityLife — static SPA build, served by nginx. Internal-only deploy (no public ingress).
#
# IMPORTANT: no secret is baked into the bundle. The build runs vite with no VITE_CITYLIFE_PAT,
# so the shipped image contains no inference token. The colony sim, the cinematic broadcast loop
# (open with ?tv=1) and the renderer all run without it. Live Border Patrol bot replies need
# inference auth, which is supplied at runtime by a proxy in front of the choke point, not by a
# token compiled into the artifact. See docs/DEPLOY.md.

# Stage 1: build the vite bundle.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || (rm -f package-lock.json && npm install)
COPY . .
RUN npm run build

# Stage 2: serve the static dist/ with nginx.
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
