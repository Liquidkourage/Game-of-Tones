FROM node:18-alpine AS builder
WORKDIR /app

# Force cache-bust when needed
ARG CACHE_BREAKER=2
RUN echo "Cache breaker: ${CACHE_BREAKER}"

# Reduce npm resource usage
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    npm_config_loglevel=error

# Install root deps (with dev) for build
COPY package*.json ./
RUN npm install --no-audit --no-fund --no-optional --ignore-scripts

# Install client deps and build
COPY client/package*.json ./client/
RUN cd client && npm install --no-audit --no-fund --no-optional --ignore-scripts

# Copy full source and build client
COPY . .
# CRA inlines REACT_APP_* at webpack compile time. Railway variables must be declared as ARG here
# so they are available in this RUN layer (runtime-only injection does not rewrite an existing bundle).
ARG REACT_APP_API_BASE
ARG REACT_APP_SOCKET_URL
ARG REACT_APP_ENABLE_YOUTUBE_MUSIC
ENV REACT_APP_API_BASE=$REACT_APP_API_BASE \
    REACT_APP_SOCKET_URL=$REACT_APP_SOCKET_URL \
    REACT_APP_ENABLE_YOUTUBE_MUSIC=$REACT_APP_ENABLE_YOUTUBE_MUSIC
# CRA: skip source maps + ESLint plugin during webpack (lint locally / CI with npm run client:typecheck + eslint)
ENV GENERATE_SOURCEMAP=false \
    DISABLE_ESLINT_PLUGIN=true
RUN cd client && npm run build

# Prune dev dependencies to production only
RUN npm prune --omit=dev

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Keep npm quiet and lean in runner too
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    npm_config_loglevel=error

# Use pruned node_modules from builder to avoid reinstall (saves memory)
COPY --from=builder /app/node_modules ./node_modules

# Copy server and built client
COPY package*.json ./
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/build ./client/build

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]


