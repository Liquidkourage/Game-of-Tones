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

## Repo layout

- **UI:** `client/src/` (React, `PlayerView`, `HostView`, etc.)
- **API + sockets:** `server/`
- **Root scripts:** `package.json` (`dev`, `build`, …)

## Live show (order, display, cards) — Jay’s source of truth

Detailed rules: `.cursor/rules/game-of-tones-show.mdc` (always applied).

**North star:** One shuffled play order at **Start Game** (#1–75). Host pool + projector + playback match it. Cards use that round’s 75 only. **Auto** display: 5×15 if five playlists, 1×75 carousel if one.

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
