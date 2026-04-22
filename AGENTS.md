# Agent / assistant conventions (Game of Tones)

## Speed vs. safety

- **Prefer** `cd client && npm run typecheck` (or from repo root: `npm run client:typecheck`) to catch TS errors. **~seconds**, not a full webpack production build.
- **Skip** `cd client && npm run build` during iterative edits unless:
  - `package.json` / deps changed, or
  - you changed build config / env handling, or
  - the user explicitly wants a production build verified.
- **Commit + push** after completing work **by default**. Only skip git when the user **explicitly** asks to leave changes uncommitted or local (e.g. “don’t commit”, “no push”, “WIP only”). **Do not wait** for a separate “commit/push” request—finish the task by shipping to `origin` (batch related edits into one commit). If the user later says they always need commits pushed, follow this file literally every time.

### Making “always ship” apply in Cursor

- **This repo:** `AGENTS.md` (this file) is loaded for the workspace—keep the rule above here.
- **All your projects:** add the same instruction under **Cursor Settings → Rules → User rules** (global), or create **`.cursor/rules/*.mdc`** in a repo with `alwaysApply: true` so every chat in that project follows it.

## Repo layout

- **UI:** `client/src/` (React, `PlayerView`, `HostView`, etc.)
- **API + sockets:** `server/`
- **Root scripts:** `package.json` (`dev`, `build`, …)

## PR hygiene (optional)

- Large files (`HostView.tsx`): prefer small targeted edits over full-file churn.
- Remove or gate noisy `console.log` / debug UI before calling work "done" if it was added for a single investigation.
