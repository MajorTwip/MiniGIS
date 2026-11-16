# syntax=docker/dockerfile:1
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
# Optional: behind a TLS-intercepting proxy pass --secret id=cabundle,src=<ca.pem>
RUN --mount=type=secret,id=cabundle,required=false \
    if [ -f /run/secrets/cabundle ]; then export NPM_CONFIG_CAFILE=/run/secrets/cabundle NODE_EXTRA_CA_CERTS=/run/secrets/cabundle; fi; npm ci
COPY shared shared
COPY server server
COPY web web
RUN npm run build -w @minigis/shared \
 && npm run build -w @minigis/web \
 && npm run build -w @minigis/server

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN --mount=type=secret,id=cabundle,required=false \
    if [ -f /run/secrets/cabundle ]; then export NPM_CONFIG_CAFILE=/run/secrets/cabundle NODE_EXTRA_CA_CERTS=/run/secrets/cabundle; fi; npm ci --omit=dev -w @minigis/shared -w @minigis/server \
 && npm cache clean --force \
 && mkdir -p /data /config && chown node:node /data /config
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
# default config, copied to /config/minigis.yaml on first start if none exists
COPY config/minigis.yaml config/minigis.yaml
USER node
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/dist/main.js"]
