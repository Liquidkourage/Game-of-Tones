FROM node:18-alpine AS builder
WORKDIR /app

# Install root deps
COPY package*.json ./
RUN npm ci

# Install and build client
COPY client/package*.json ./client/
RUN cd client && npm ci && npm run build

# Copy full source (server code, assets)
COPY . .

FROM node:18-alpine AS runner
WORKDIR /app

# Only production deps for server
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server and prebuilt client
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/build ./client/build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]


