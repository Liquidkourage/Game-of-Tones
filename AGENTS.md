# Agent / assistant conventions (Game of Tones)

## People

- **Jay** (repo owner / primary collaborator): address her as **you** in replies; **she/her** if third-person reference is needed.

## Speed vs. safety

- **Prefer** `cd client && npm run typecheck` (or from repo root: `npm run client:typecheck`) to catch TS errors. **~seconds**, not a full webpack production build.
- **Skip** `cd client && npm run build` during iterative edits unless:
  - `package.json` / deps changed, or
  - you changed build config / env handling, or
  - the user explicitly wants a production build verified.
- **Commit + push** after completing work **by default**. Only skip git when the user **explicitly** asks to leave changes uncommitted or local (e.g. “don’t commit”, “no push”, “WIP only”). **Do not wait** for a separate “commit/push” request—finish the task by shipping to `origin` (batch related edits into one commit). If the user says **push**, include **all** modified or intentionally-added project files in that commit—no silent file omissions unless they specify otherwise.

### Making “always ship” apply in Cursor

- **This repo:** `AGENTS.md` (this file) is loaded for the workspace—keep the rule above here.
- **All your projects:** add the same instruction under **Cursor Settings → Rules → User rules** (global), or create **`.cursor/rules/*.mdc`** in a repo with `alwaysApply: true` so every chat in that project follows it.

## Spotify Web API

- Follow the [OpenAPI schema](https://developer.spotify.com/reference/web-api/open-api-schema.yaml) for paths and shapes; playlist track pages use `GET /v1/playlists/{id}/items` in `server/spotify.js` (`_fetchPlaylistItemsPage`).
- OAuth is Authorization Code with server-side callback (no implicit grant). After changing requested **scopes** in `getAuthorizationURL`, hosts must **re-connect Spotify** to grant new scopes.

### Windows Connect playback (do not regress)

Detailed rules: `.cursor/rules/spotify-connect-playback.mdc` (always applied).

Working path: play via track **source playlist** `context_uri` + Early/Random `position_ms`; poll until bound; **never** URI-fallback after context; no `transfer(play=false)` / ensuring-active thrash; no mid-show wake playlists. Verify with Railway `startPlayback` confirm lines + sustained audio — not typecheck alone.

### Org shelf — never auto-hit Spotify for track counts

Background shelf hydrate caused the Oct 2026 app **429**. `/api/org/shared-host-assets` and org-shelf UI must fill counts from **DB/cache only**. Do not reintroduce Spotify probes for zero-count shelf rows. Guard: `npm run check:spotify-shelf`. Rule: `.cursor/rules/spotify-org-shelf-no-auto-hydrate.mdc`.

## Repo layout

- **UI:** `client/src/` (React, `PlayerView`, `HostView`, etc.)
- **API + sockets:** `server/`
- **Root scripts:** `package.json` (`dev`, `build`, …)

## Live show (order, display, cards) — Jay’s source of truth

Detailed rules: `.cursor/rules/game-of-tones-show.mdc` (always applied).

**North star:** Saved rounds lock a Fisher–Yates `playOrder` when saved; **Start Game preserves it**. Host pool + projector + playback + offline call sheet match it. Legacy snapshots without `playOrder` shuffle once at Start Game. Cards use that round's 75-song `songs` set, not a separate pool. **Auto** display: 5×15 if five playlists, 1×75 carousel if one.

**Projector:** Always **five** columns; top row calls 1,6,11,16,21…; bottom row 5,10,15,20,25…. No `?cols=` override. Never fix width by switching to three columns.

**Host pool:** Shuffled play order only (not finalize build order).

## Show verification (pick per change; say which you did in the reply)

| Level | What | When to use |
|-------|------|-------------|
| **Minimum** | `npm run client:typecheck` | Every TS/UI change |
| **Order** | After deploy: hard-refresh **host** + **projector**; Start Game; **#1** same title on host pool, first played song, projector call badge | Any change to shuffle, `game-started`, `finalized-order`, host pool, or call numbers |
| **Layout** | Projector screenshot or browser tools: **5** equal columns; call cards one column wide; spot-check top row 1,6,11,16,21 after ~5 calls | `PublicDisplay.tsx`, `App.css` carousel/grid |
| **Geometry** | Test **Auto** with **1** playlist → 1×75 carousel; **5** playlists → 5×15 column headers | Display mode / `generateBingoCards` |
| **Cards** | Join a test player; confirm card songs ⊆ round 75; no regen after list-only order fix | Card generation / `bingoCards` |

Do not claim display/order work is done after typecheck alone if the change touches the projector or play order.

## PR hygiene (optional)

- Large files (`HostView.tsx`): prefer small targeted edits over full-file churn.
- Remove or gate noisy `console.log` / debug UI before calling work "done" if it was added for a single investigation.

## Cursor Cloud specific instructions

- **Node 18.** `.node-version` and `engines` (`>=18 <20`) pin Node 18. Agent shells often resolve `/exec-daemon/node` (22) first. Prefix PATH with nvm’s Node 18 before install or dev commands: `export PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH"`.
- **Install.** From the repo root: `npm ci --no-audit --no-fund`, then `npm install --prefix client --no-audit --no-fund --no-optional`. Postgres packages are `postgresql` and `postgresql-contrib` (cluster 16).
- **Postgres.** `sudo pg_ctlcluster 16 main start`, then `pg_isready -q`. Local dev role `tempo` / password `tempo` / database `tempo`. `DATABASE_URL=postgres://tempo:tempo@127.0.0.1:5432/tempo`. The server creates its tables on startup. Host accounts and cloud prep need this URL.
- **Dev servers (tmux `tempo-api` and `tempo-client`).** API listens on **7093** (`PORT`). Client dev server listens on **7094** so it matches the server’s default CORS list. Start the client from `client/` with `PORT=7094`, `HOST=0.0.0.0`, `BROWSER=none`, `REACT_APP_API_BASE=http://127.0.0.1:7093`, and `REACT_APP_SOCKET_URL=http://127.0.0.1:7093`. Health: `curl -sf http://127.0.0.1:7093/api/health`. UI: `http://127.0.0.1:7094/`.
- **Spotify.** The process exits unless `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REDIRECT_URI` are non-empty. Cloud start uses placeholders when those secrets are unset, which is enough for rooms, join, and the public display. Playlist import and Connect playback need real Spotify app credentials (redirect `http://127.0.0.1:7094/callback`).
- **Checks.** `npm run client:typecheck` and `npm run test:spotify-efficiency`. Skip `cd client && npm run build` unless packaging.
