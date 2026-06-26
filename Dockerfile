# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:18-alpine AS deps

WORKDIR /app

# Copy dependency manifests first (better layer caching)
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:18-alpine AS runner

# Add non-root user for security
RUN addgroup -S hershield && adduser -S hershield -G hershield

WORKDIR /app

# Copy production node_modules from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (everything not in .dockerignore)
COPY . .

# Fly.io injects PORT (default 8080); our listenWithFallback reads it automatically
ENV PORT=8080
ENV NODE_ENV=production
ENV TRUST_PROXY=1

# Run as non-root
USER hershield

EXPOSE 8080

CMD ["node", "server.js"]
