# syntax=docker/dockerfile:1.7
# SFM Character Studio: static build served by unprivileged nginx.
# The server stores no visitor data; all projects live in each visitor's browser.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
LABEL org.opencontainers.image.title="SFM Character Studio" \
      org.opencontainers.image.source="https://github.com/darkzmaj/sfmc-studio" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.authors="Maj Kovačič"
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
