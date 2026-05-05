# Product roadmap

Living document for planned Tempo / Game of Tones features. Prioritize and slice with stakeholders before implementation.

---

## Multi-round pattern presets & pre-show printing

### Problem / ask

Hosts want to **plan an entire event upfront**: for **each round**, set the **bingo pattern** (and related options where relevant), and **print physical cards** for every round **before** “showtime” / before the live game flow starts — not only a single global pattern and one PDF sampled from one finalized pool.

### Current behavior (baseline)

- **Round Planner** assigns **playlists per round** only; rounds do **not** carry pattern metadata.
- **Pattern** (line, full card, custom mask, free space, etc.) is **room-level** for the running game.
- **Printable PDF** runs **after finalize**: server generates *N* cards by sampling the **current** finalized pool; **not** round-scoped or pattern-scoped batches.

### Target UX (directional)

1. **Round definition** includes optional **pattern** (and **free space** if we keep it per round or inherit global default).
2. Host can **finalize or “lock”** round definitions (playlists + pattern) for **all planned rounds** (or per round as they go).
3. **Print** flows:
   - **Per round**: “Download PDF — Round 3” with cover/slug text (room, round name, pattern).
   - Optional: **single ZIP / merged PDF** with section breaks per round.
4. **Player cards** (digital) remain consistent with whatever rule we choose: either **regenerate** when switching rounds if pattern/pool changes, or **freeze** printed layouts separately from live verification (needs explicit product rule).

### Technical tracks

| Track | Notes |
| --- | --- |
| **Data model** | Extend round payload (`EventRound` + server `room.eventRounds` or equivalent): `pattern`, `customMask?`, `freeSpace?`, `status` extended for “locked”. Persist across refresh where rounds already persist. |
| **Pools per round** | Today finalize builds **one** global `finalizedSongOrder` / mix. Need either **per-round song pools** derived from round playlists, or **one global pool** plus **round segment ranges** (only valid if playback order is strictly round-major). |
| **Card generation** | Reuse `pickChosen25` / card builders with **round-local pool** + **round pattern**. Server endpoints: e.g. `request-printable-cards` accepts `{ roundId, count }` or batch `{ rounds: [{ roundId, count }] }`. |
| **Verification** | Bingo verification must use **active round’s pattern** and **that round’s card generation rules** so printed sheets match the app. |
| **Host UI** | Round Planner (or pattern column); print actions per round + bulk “print all”; clear warnings when round isn’t locked / pool empty. |

### Phases (suggested)

1. **MVP — Print only**  
   - Per-round pools from existing round playlists + **inherit global pattern** for all rounds.  
   - API + UI: “Print round N” PDF after those playlists are loaded into a round-level pool (may still be one finalize or explicit “build round pool”).  

2. **Pattern per round**  
   - Store pattern on round; server applies when generating cards and when advancing rounds in-game.  

3. **Full pre-show workflow**  
   - “Lock all rounds” / rehearsal mode; bulk export; optional deterministic seeds for reproducible print runs (enterprise / dispute handling).  

### Open questions

- **Single finalize vs per-round finalize**: Does each round need its own **immutable** track order independent of others, or one global shuffle with round = slice?
- **Custom patterns**: Saved masks — per round or library picklist?
- **Digital vs print parity**: Must phone cards match printed decks exactly, or is print “bonus” random layouts?
- **1×75 / 5×15**: Does per-round pool size always match display mode, or is printing always “classic 25-cell” only?

### References in codebase

- Host rounds: `client/src/components/RoundPlanner.tsx`, `EventRound` in `HostView.tsx`.
- Printable pipeline: `socket.on('request-printable-cards')` in `server/index.js`, `buildPrintableBingoPdfBlob` in `client/src/utils/printableBingoPdf.ts`.

---

*Last updated: roadmap item added for multi-round presets & printing.*
