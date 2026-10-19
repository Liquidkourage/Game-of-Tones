# Socket events (partial audit)

Incremental gate from engineering feedback #7. Only migrated hot paths use `socketGate` today; the rest still use raw `socket.on`.

| Event | hostOnly | rate limit | Notes |
|-------|----------|------------|--------|
| `player-bingo` | no | bingo claim bucket (4 / ~0.5/s) | Option B: `markedPositions` on payload |
| `mark-square` | no | player tap bucket (20 / 8/s) | Telemetry for host live cards |
| `verify-bingo` | yes | — | Resolves claim via `participantId` |
| `end-game` | yes | — | Clears `live_rooms` snapshot |
| `reset-game` | yes | — | Clears `live_rooms` snapshot |
| `start-game` | no* | — | *Room may be missing; host check stays inside handler |

Full 70-handler schema audit deferred.
