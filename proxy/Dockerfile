FROM node:24-alpine

WORKDIR /app

# Production deps only — the bridge needs `ws`. Node 24 runs the TypeScript
# entrypoint directly via built-in type stripping, so tsx (a devDependency)
# is NOT needed at runtime and no build step is required. The previous image
# ran `npx tsx` after `--omit=dev` dropped tsx, which forced a network fetch
# on every start.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY proxy/ ./proxy/

# Default to the Docker host rather than the container's own loopback. Runtime
# deployments can override this with an OT service name or address; Linux
# `docker run` users should map host.docker.internal to host-gateway.
ENV OT_HOST=host.docker.internal
ENV WS_PORT=8090
# Telemetry (dev tooling) appends to this file; default it under /tmp so the
# non-root user can write it even with a read-only root filesystem. Production
# never proxies /telemetry, so this stays empty there.
ENV TELEMETRY_FILE=/tmp/telemetry.jsonl
EXPOSE 8090

# Run as the image's built-in unprivileged user.
USER node

CMD ["node", "proxy/server.ts"]
