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

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --production

# Copy server code
COPY server/ ./server/
RUN mkdir -p /app/server/data

# Copy built frontend into server's public directory
COPY --from=frontend-builder /app/client/dist ./server/public/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

VOLUME ["/app/server/data"]

CMD ["node", "server/index.js"]
