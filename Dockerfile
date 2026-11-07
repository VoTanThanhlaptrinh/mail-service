# Stage 1: Build client and server
FROM node:22-slim AS builder

WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/

# Install dependencies (including devDependencies for build)
RUN npm ci

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
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/

# Install production dependencies only (better-sqlite3 uses prebuilt binary out of the box)
RUN npm ci --omit=dev

# Copy compiled files from builder
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server/dist ./server/dist

# Create data directory for SQLite persistence
RUN mkdir -p /app/data

EXPOSE 4000

# Run migrations to ensure tables exist, then start the server
CMD ["sh", "-c", "node server/dist/migrate.js && node server/dist/index.js"]
