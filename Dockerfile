FROM node:18-alpine AS builder
WORKDIR /app

# Install root deps (with dev) for build
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Install client deps and build
COPY client/package*.json ./client/
RUN cd client && npm ci --no-audit --no-fund

# Copy full source and build client
COPY . .
RUN cd client && npm run build

# Prune dev dependencies to production only
RUN npm prune --omit=dev

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Use pruned node_modules from builder to avoid reinstall (saves memory)
COPY --from=builder /app/node_modules ./node_modules

# Copy server and built client
COPY package*.json ./
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/build ./client/build

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]


