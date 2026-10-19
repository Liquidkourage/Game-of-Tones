# Engineering backlog status

Outside review items from `game-of-tones-engineering-feedback.md` (Oct 2026).

## Done

| Item | What |
|------|------|
| 1 | Characterization tests + CI |
| 2 | `callState` single writer |
| 3 | `live_rooms` mid-show restart persistence |
| 4 | Stable `participantId` (+ `requireHost`) |
| 5 | Bingo marks Option B |
| 7 (partial) | Socket gate + rate limits on hot events |
| 9 (partial) | Round advance timer registry |
| 6 (partial) | Pure `server/game/*` extracts |
| 13 (partial) | Doc / engines alignment |

## Deferred (do not start unless reopened)

| Item | What |
|------|------|
| 6 full | Split `server/index.js` / sockets / routes |
| 7 full | Schema + rate audit for all ~70 handlers |
| 8 | `node-pg-migrate` |
| 9 full | Every `setTimeout` in index via registry |
| 10 | Break up `HostView.tsx` + typed socket contract |
| 11 | Node 22 LTS + Vite |
| 12 | Structured logging (pino) |

Achievements / richer Stats remain parked until Jay reopens them.
