# Stage 1: Build client and server
FROM node:22-slim AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/

# Install dependencies (including devDependencies for build)
RUN npm install

# Copy source code
COPY client/ ./client/
COPY server/ ./server/

# Build server and client
RUN npm run build

# Stage 2: Production runner
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package manifests
COPY package*.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/

# Install production dependencies only (better-sqlite3 uses prebuilt binary out of the box)
RUN npm install --omit=dev

# Copy compiled files from builder
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server/dist ./server/dist

# Create data directory for SQLite persistence (owned by the non-root user)
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 4000

# Run migrations to ensure tables exist, then start the server.
# `exec` makes node PID 1 so it receives SIGTERM and closes SQLite cleanly.
CMD ["sh", "-c", "node server/dist/migrate.js && exec node server/dist/index.js"]
