# Agent / assistant conventions (Game of Tones)

## Speed vs. safety

- **Prefer** `cd client && npm run typecheck` (or from repo root: `npm run client:typecheck`) to catch TS errors. **~seconds**, not a full webpack production build.
- **Skip** `cd client && npm run build` during iterative edits unless:
  - `package.json` / deps changed, or
  - you changed build config / env handling, or
  - the user explicitly wants a production build verified.
- **Commit + push** after completing work unless the user says not to—do not wait for a separate “commit/push” prompt (batch logical fixes into one commit when possible).

## Repo layout

- **UI:** `client/src/` (React, `PlayerView`, `HostView`, etc.)
- **API + sockets:** `server/`
- **Root scripts:** `package.json` (`dev`, `build`, …)

## PR hygiene (optional)

- Large files (`HostView.tsx`): prefer small targeted edits over full-file churn.
- Remove or gate noisy `console.log` / debug UI before calling work "done" if it was added for a single investigation.
