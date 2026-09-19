# Zero runtime dependencies, so there is nothing to install: copy the source
# and run it. Node 22 is the floor because of node:sqlite.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    DB_PATH=/data/intake.db \
    UPLOAD_DIR=/data/uploads

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY data ./data
COPY public ./public

# The database and uploads live on a mounted volume, owned by the app user.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1

CMD ["node", "--experimental-sqlite", "src/server.js"]
