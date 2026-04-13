# Community Feed Generator - Production Dockerfile
# Multi-stage build for minimal image size

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:20.19.0-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files first (better caching)
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:20.19.0-alpine AS production

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Install only production dependencies.
# Ignore lifecycle scripts in runtime image so dev-only `prepare` hooks (Husky)
# do not run when devDependencies are intentionally omitted.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy database migrations (needed at runtime)
COPY src/db/migrations ./src/db/migrations

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Change ownership of app directory
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health/ready || exit 1

# Start the application
CMD ["node", "dist/index.js"]
