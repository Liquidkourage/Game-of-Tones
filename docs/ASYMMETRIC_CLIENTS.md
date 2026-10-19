# Asymmetric clients (TEMPO)

Phones and the projector/host do **not** share the same information. That is intentional product design, not a missing feature.

| Surface | Gets | Does not get |
|---------|------|----------------|
| **Player phone** | Pattern, cards, local marks, claim flow, song *requests* status | Current call title/artist/ID, played-song lists for auto-mark, letter-reveal state, bump theater |
| **Host** | Full pool, playback, verify, bump | — |
| **Projector** | Calls, titles, letter reveal, night board, bump flash | Player mark authority |

## Server rules

- `song-playing` and `snippet-bumped` → `emitToHostAndDisplays` only.
- Player `room-state` passes through `roomStateSafeForPlayers` ([`server/game/roomStateForPlayers.js`](../server/game/roomStateForPlayers.js)).
- Do not add mid-call titles or “you’re one away” spoilers to the phone.

## Client belt

[`PlayerView.tsx`](../client/src/components/PlayerView.tsx) registers no-op listeners for `song-playing` / `snippet-bumped` so a mistaken room-wide emit cannot drive UI.
