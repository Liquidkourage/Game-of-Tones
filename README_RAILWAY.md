Deploying Game of Tones to Railway

1) Prep the code
- Client uses env/relative URLs via `client/src/config.ts`.
- Server reads CORS allowlist from `CORS_ORIGINS` and serves React build in production.

2) Environment variables (Railway project → Variables)
- SPOTIFY_CLIENT_ID: Your Spotify app client ID
- SPOTIFY_CLIENT_SECRET: Your Spotify app client secret
- SPOTIFY_REDIRECT_URI: https://YOUR-CLIENT-DOMAIN/callback
- NODE_ENV: production
- CORS_ORIGINS: https://YOUR-CLIENT-DOMAIN

Optional (if splitting services):
- REACT_APP_API_BASE: https://YOUR-API-DOMAIN
- REACT_APP_SOCKET_URL: https://YOUR-API-DOMAIN

Organization billing (Stripe pay-as-you-like, optional until you gate hosting):
- STRIPE_SECRET_KEY: sk_test_… or sk_live_… from Stripe Dashboard → API keys
- STRIPE_WEBHOOK_SECRET: whsec_… from Stripe → Webhooks → your endpoint signing secret
- PUBLIC_APP_URL: https://YOUR-CLIENT-DOMAIN (checkout return URLs; same as app origin if single-service)
- STRIPE_WEBHOOK_BASE_URL: only if API host differs from PUBLIC_APP_URL (webhook hits this origin)
- TEMPO_REQUIRE_ORG_BILLING: 0 (default) or 1 to require payment before hosting

See STRIPE_SETUP.md for webhook URL and test card details.

3) Choose a deployment model

Single service (recommended):
- Build client and serve from Node server to share origin.
- Railway will set PORT; server uses `process.env.PORT`.

Two services (advanced):
- Deploy server and client separately.
- Set `REACT_APP_API_BASE` and `REACT_APP_SOCKET_URL` in the client.
- Add both domains to `CORS_ORIGINS` on the server.

4) Build & start commands

Railway Nixpacks auto-detects Node. Configure:
- Install command: npm run install-all
- Build command: npm run build
- Start command: node server/index.js

5) Spotify dashboard setup
- Add Redirect URIs:
  - https://YOUR-CLIENT-DOMAIN/callback
- Ensure scopes match server: playlist-read-private, playlist-read-collaborative, user-read-playback-state, user-modify-playback-state, user-read-currently-playing

6) First run
- Open your Railway client URL.
- Go to Host view and click Connect Spotify.
- Approve Spotify app. You should see a success message on /callback, then return to host.

7) Token storage note
- The server currently saves tokens to a JSON file. Railway filesystems are ephemeral. Expect to re-auth on restarts or wire up persistent storage (Redis/DB) later.

8) Troubleshooting
- CORS: Add your exact domain to `CORS_ORIGINS`. Use HTTPS in production.
- OAuth redirect mismatch: The URI in Spotify must match `SPOTIFY_REDIRECT_URI` exactly.
- Socket connection issues: Ensure `SOCKET_URL` points to your server domain or leave it blank to use same-origin.


