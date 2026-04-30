# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-slim AS frontend-builder
WORKDIR /build/client
COPY services/queue-service/client/package*.json ./
RUN npm ci
COPY services/queue-service/client/ ./
RUN npm run build

# ── Stage 2: Production server ─────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /repo

RUN useradd -m -u 1001 appuser

# Copy shared db module
COPY shared/ shared/

# Install server dependencies
COPY services/queue-service/server/package*.json services/queue-service/server/
RUN cd services/queue-service/server && npm ci --production

# Copy server code and built frontend
COPY services/queue-service/server/ services/queue-service/server/
COPY --from=frontend-builder /build/client/dist services/queue-service/server/public/

RUN mkdir -p services/queue-service/server/uploads && chown -R appuser:appuser /repo

ENV NODE_ENV=production
ENV PORT=3000

USER appuser
WORKDIR /repo/services/queue-service/server

EXPOSE 3000

CMD ["node", "index.js"]
