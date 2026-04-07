# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-slim AS frontend-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: Production server ─────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Create non-root user
RUN useradd -m -u 1001 appuser

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --production

# Copy server code and built frontend
COPY server/ ./server/
COPY --from=frontend-builder /app/client/dist ./server/public/

# Prepare data directory and transfer ownership
RUN mkdir -p /app/server/data && chown -R appuser:appuser /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/server/data

USER appuser

EXPOSE 3000

VOLUME ["/app/server/data"]

CMD ["node", "server/index.js"]
