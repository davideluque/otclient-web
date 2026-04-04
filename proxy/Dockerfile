FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY proxy/ ./proxy/

ENV WS_PORT=8090
ENV OT_HOST=host.docker.internal
ENV OT_LOGIN_PORT=7171
ENV OT_GAME_PORT=7172

EXPOSE 8090

CMD ["npx", "tsx", "proxy/server.ts"]
