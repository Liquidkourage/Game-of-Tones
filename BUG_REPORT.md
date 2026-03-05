# 🐛 Comprehensive Bug Report - Music Bingo Platform

## Critical Issues

### 1. ⚠️ **Race Condition: `calledSongIds` Array Modification During Validation**
**Location:** `server/index.js:4177` in `validateBingoForPattern()`

**Problem:**
- `validateBingoForPattern()` creates a copy of `room.calledSongIds` at line 4177: `const playedSongIds = [...room.calledSongIds]`
- However, `room.calledSongIds` can be modified concurrently by:
  - `playNextSongSimple()` (line 965) - adds song when playback starts
  - `player-bingo` handler (line 1552) - adds current song when bingo is called
  - `startAutomaticPlayback()` (line 3711) - adds first song
  - `playNextSong()` (line 3957) - adds next song

**Impact:**
- If a player calls bingo RIGHT as a new song starts playing, the validation might use a stale copy that doesn't include the current song
- This could cause valid bingos to be rejected

**Fix:**
- Add a mutex/lock around `calledSongIds` modifications, OR
- Ensure `validateBingoForPattern()` always includes `room.currentSong.id` if it exists and isn't already in the array

---

### 2. 🔄 **Player Card Marks Lost on Server Card Update**
**Location:** `client/src/components/PlayerView.tsx:202-217`

**Problem:**
- When server sends `bingo-card` event, client merges marks (lines 205-216)
- However, if server sends card update BEFORE player's mark is processed, the mark could be lost
- The merge logic preserves marks from `prev` card, but if server sends a fresh card without marks, they're lost

**Impact:**
- Player marks a square → server processes it → server sends card update → client receives update → mark is lost
- This explains the "disappearing marks" issue reported

**Fix:**
- Server should NEVER send card updates that overwrite marks
- Only send card updates when card structure changes (new game, not on mark-square)
- OR: Server should always include current marks when sending card updates

---

### 3. 🎡 **Public Display Reveal Baseline Desynchronization**
**Location:** `client/src/components/PublicDisplay.tsx:796-797`

**Problem:**
- `songBaselineRef.current[pid]` tracks when each song was added to `revealSequenceRef`
- If display reconnects or receives `display-reset-letters`, baselines are cleared (line 684)
- But `revealSequenceRef` might still have letters from before reset
- Auto-reveal uses `revealSequenceRef.current.slice(baseline)` which could be wrong if baseline was reset

**Impact:**
- After reset, auto-reveal might reveal letters that were already revealed
- Or might not reveal letters that should be revealed
- Wheel of Fortune masking becomes incorrect

**Fix:**
- When resetting letters, also reset `songBaselineRef` for all songs
- OR: Recalculate baselines based on current `revealSequenceRef` length

---

### 4. 📋 **Host Player Card View Shows Stale `playedSongs`**
**Location:** `server/index.js:4062` in `sendPlayerCardUpdates()`

**Problem:**
- `sendPlayerCardUpdates()` sends `playedSongs: room.calledSongIds || []` (line 4062)
- This is sent IMMEDIATELY when a player marks/unmarks a square (line 2802)
- But `room.calledSongIds` might not include the CURRENT song that's playing
- Host sees player cards with outdated "played songs" list

**Impact:**
- Host views player cards → sees squares marked as "invalid" (red) even though song is currently playing
- Host can't accurately verify player progress

**Fix:**
- Include `room.currentSong.id` in `playedSongs` if it exists and isn't already in the array
- OR: Send `playedSongs` as a computed array that always includes current song

---

### 5. ⏱️ **Current Song Not Always in `calledSongIds` Before Bingo Validation**
**Location:** `server/index.js:1549-1561`

**Problem:**
- When player calls bingo, code tries to add current song to `calledSongIds` (lines 1550-1558)
- But this happens AFTER validation is called (line 1523 calls `validateBingoForPattern()` BEFORE adding current song)
- Wait, actually it's BEFORE validation - let me check... No, validation is at line 1523, adding song is at 1550
- Actually, validation happens at 1523, then current song is added at 1550-1558
- So validation might run WITHOUT the current song in the list!

**Impact:**
- Player hears song playing → marks square → calls bingo immediately
- Validation runs → current song not in `calledSongIds` yet → bingo rejected even though valid

**Fix:**
- Move the "add current song to calledSongIds" logic BEFORE validation (before line 1523)
- OR: Include `room.currentSong.id` in validation if it exists

---

### 6. 🔌 **Player Reconnection May Not Restore Card Marks**
**Location:** `server/index.js:1376-1393`

**Problem:**
- When player reconnects, server sends `bingo-card` event (lines 1379, 1384)
- But this sends the card from `room.bingoCards.get(socket.id)` or `room.clientCards.get(clientId)`
- If player reconnects with a NEW socket.id, their marks might be lost
- The `clientId` mapping helps, but marks are stored on the card object, which might not persist

**Impact:**
- Player marks squares → disconnects → reconnects → marks are gone
- Player has to re-mark everything

**Fix:**
- Ensure marks are persisted in `room.bingoCards` or `room.clientCards` and restored on reconnect
- OR: Store marks separately in a `Map<playerId, Map<position, boolean>>` structure

---

### 7. 🔀 **Multiple Sources of Truth for Played Songs**
**Location:** Multiple files

**Problem:**
- **Server:** `room.calledSongIds` array
- **Client (PlayerView):** `playedSongIds` state (line 94)
- **Client (PublicDisplay):** `playedOrderRef.current` array
- **Client (HostView):** `playedSongs` in player card data

**Impact:**
- These can get out of sync:
  - Player's `playedSongIds` might be missing songs if they join mid-game
  - Public display might have different order than server
  - Host view might show stale data

**Fix:**
- Server should be single source of truth
- Clients should always sync from server on connect/reconnect
- Use `sync-state` event more aggressively

---

## Medium Priority Issues

### 8. 🎯 **Pattern Validation Logic Inconsistency**
**Location:** `server/index.js:4174-4355` vs `client/src/components/PlayerView.tsx:705-803`

**Problem:**
- Server `validateBingoForPattern()` checks if marked squares correspond to played songs
- Client `checkBingo()` also checks this, but might have stale `playedSongIds`
- Client-side check is currently disabled (line 649-654 commented out), but if re-enabled, could cause issues

**Impact:**
- Client might think they have bingo when they don't (or vice versa)
- Confusing UX

**Fix:**
- Keep client-side check disabled, OR
- Make client-side check always sync with server before validating

---

### 9. 📊 **Host Player Card Progress Calculation May Be Wrong**
**Location:** `client/src/components/HostView.tsx:1444-1542`

**Problem:**
- `calculateWinProgress()` uses `playedSongs` array passed from server
- But this array might be stale (see bug #4)
- Progress calculation might show wrong percentages

**Impact:**
- Host sees incorrect progress indicators
- Can't accurately assess player status

**Fix:**
- Ensure `playedSongs` always includes current song
- Recalculate progress on every card update

---

### 10. 🎵 **Song Playing Event Race Condition**
**Location:** `server/index.js:963-967` and `client/src/components/PlayerView.tsx:235-245`

**Problem:**
- Server adds song to `calledSongIds` when playback starts (line 965)
- Server emits `song-playing` event
- Client receives event and adds to `playedSongIds` (line 238-243)
- But if client is slow, they might mark a square BEFORE receiving the event
- Then validation fails because song isn't in their local `playedSongIds`

**Impact:**
- Player marks square → song playing event arrives late → client thinks mark is invalid
- Client-side validation fails even though server would accept it

**Fix:**
- Client should always check server state before validating
- OR: Client should optimistically add song to `playedSongIds` when marking square if song matches current song

---

## Low Priority Issues

### 11. 🔤 **Reset Letters Doesn't Clear All State**
**Location:** `client/src/components/PublicDisplay.tsx:571-577`

**Problem:**
- `display-reset-letters` clears `revealSequenceRef` and `songBaselineRef`
- But doesn't clear `revealToast` or `revealToastTimerRef`
- Toast might still be showing after reset

**Impact:**
- Minor UX issue - toast might persist after reset

**Fix:**
- Clear toast state when resetting letters

---

### 12. 📱 **Player Card Updates Sent Too Frequently**
**Location:** `server/index.js:2802`

**Problem:**
- Every time a player marks/unmarks a square, `sendPlayerCardUpdates()` is called
- This sends updates to ALL hosts in the room
- If multiple players are marking squares rapidly, this could flood the network

**Impact:**
- Performance degradation with many players
- Host UI might lag

**Fix:**
- Debounce player card updates (e.g., max once per 500ms)
- OR: Batch updates and send periodically

---

### 13. 🎲 **Card Generation Race Condition**
**Location:** `server/index.js:3161-3260`

**Problem:**
- `generateBingoCards()` generates cards for all players
- But if a player joins DURING card generation, they might get a card from `generateBingoCardForPlayer()` with different column assignments
- This was partially fixed, but edge cases might remain

**Impact:**
- Player cards might have inconsistent column assignments
- Songs might appear in wrong columns

**Fix:**
- Lock card generation process
- Queue late-joining players until generation completes

---

## Recommendations

1. **Immediate Fixes Needed:**
   - Bug #5: Move current song addition BEFORE validation
   - Bug #4: Include current song in playedSongs sent to host
   - Bug #2: Prevent server from overwriting player marks

2. **High Priority:**
   - Bug #1: Fix race condition in `calledSongIds`
   - Bug #7: Consolidate played songs state management
   - Bug #6: Ensure marks persist on reconnect

3. **Medium Priority:**
   - Bug #3: Fix reveal baseline sync
   - Bug #10: Fix song playing event race condition

4. **Testing Needed:**
   - Test rapid mark/unmark sequences
   - Test bingo calls during song transitions
   - Test reconnection scenarios
   - Test with multiple players marking simultaneously

---

## Summary

**Total Issues Found:** 14
- **Critical:** 8
- **Medium:** 3
- **Low:** 3

**Most Critical:** Bug #5 (current song not in calledSongIds during validation) - this directly causes valid bingos to be rejected.

---

### 14. 🔄 **Duplicate Songs Not Replaced with Alternative Tracks in 5x15 Mode**
**Location:** `server/index.js:3608-3671` in `generateBingoCards()`

**Problem:**
- When duplicate songs are detected across child playlists in 5x15 mode, the system **removes** duplicates but does **NOT replace** them with alternative tracks from the same playlist
- The deduplication logic (lines 3613-3644) iterates through each playlist and filters out songs that have already been seen globally
- When a duplicate is found in playlist B (because it was already seen in playlist A), the code simply skips it (line 3622) and adds it to `duplicatesFound` array
- The playlist is then left with fewer songs than needed (potentially < 15 unique songs)
- If a playlist ends up with fewer than 15 songs after deduplication, the system only **warns** (lines 3647-3656) but does not attempt to fetch replacement songs

**Expected Behavior:**
- When a duplicate song is detected in a playlist, the system should:
  1. Remove the duplicate from that playlist's pool
  2. Find the **next unique song** from the same playlist that hasn't been seen globally yet
  3. Replace the duplicate with this new song
  4. Continue until the playlist has at least 15 unique songs (or exhausts available songs)

**Current Behavior:**
- Duplicates are detected and logged (lines 3626-3630)
- Duplicates are removed from the playlist's song array (line 3640)
- No replacement logic exists - playlists are left short
- System falls back to a different mode or warns if playlists don't have enough songs

**Code Flow:**
```javascript
// Lines 3617-3624: Duplicate detection
for (const song of pl.songs) {
  if (!globalSeen.has(song.id)) {
    globalSeen.add(song.id);
    uniqueSongs.push(song);
  } else {
    duplicatesFound.push(song);  // ❌ Just tracks it, doesn't replace
  }
}
```

**Impact:**
- **High:** Games fail to start in 5x15 mode when duplicates cause playlists to have < 15 unique songs
- **Medium:** Even if playlists have exactly 15 songs after deduplication, the system doesn't utilize the full playlist content - songs that could be used are ignored
- **User Experience:** Host sees warning messages but game may still proceed with incomplete playlists, or game fails to start entirely

**Root Cause:**
- The deduplication logic processes playlists sequentially and only uses songs that appear **first** in the iteration order
- No mechanism exists to "backfill" playlists that lose songs due to duplicates
- The `getPlaylistTracks()` function (in `server/spotify.js:184-224`) fetches ALL songs from a playlist, but the replacement logic to use those additional songs doesn't exist

**Affected Code Paths:**
1. `generateBingoCards()` - Main card generation (lines 3608-3671)
2. `generateBingoCardForPlayer()` - Late-join card generation (lines 3940-3960) - **Same issue exists here**
3. `startAutomaticPlayback()` - Playback initialization (lines 4137-4158) - **Same issue exists here**

**Fix Strategy:**
1. After detecting duplicates in a playlist, iterate through the **remaining songs** in that playlist
2. For each duplicate found, find the next song from the same playlist that:
   - Hasn't been seen globally (`!globalSeen.has(song.id)`)
   - Is not already in the `uniqueSongs` array for this playlist
3. Replace the duplicate with this alternative song
4. Continue until playlist has 15 unique songs OR all songs from playlist are exhausted
5. If playlist still has < 15 songs after replacement attempts, then warn/fallback

**Example Scenario:**
- Playlist A has songs: [Song1, Song2, Song3, ..., Song20]
- Playlist B has songs: [Song1 (duplicate), Song21, Song22, ..., Song30]
- **Current behavior:** Playlist B ends up with [Song21, Song22, ..., Song30] = 10 songs (short by 5)
- **Expected behavior:** Playlist B should replace Song1 with Song31, Song32, etc. from its remaining tracks until it has 15 unique songs

**Testing Notes:**
- Test with playlists where the same song appears in multiple child playlists
- Verify that playlists maintain 15+ unique songs after deduplication
- Verify that replacement songs come from the same playlist (maintaining theme consistency)
- Verify that the same replacement logic works in `generateBingoCardForPlayer()` and `startAutomaticPlayback()`

**Additional Finding - Duplicate Songs in Output Playlist:**
The user reports that "Sweet Home Alabama" appears TWICE in the final output/playback playlist, even though deduplication should have occurred.

## 🎯 **EXACT CULPRIT IDENTIFIED:**

**Location:** `server/index.js:4216-4222` in `startAutomaticPlayback()`

**The Bug:**
After `startAutomaticPlayback()` correctly maps deduplicated IDs from `room.finalizedSongOrder` to songs (lines 4089-4091), there's a SECOND reordering step at lines 4216-4222 that can reintroduce duplicates:

```javascript
// Line 4216-4222: SECOND reordering (BUG HERE)
if (Array.isArray(room.finalizedSongOrder) && room.finalizedSongOrder.length > 0) {
  const idToSong = new Map(allSongs.map(s => [s.id, s]));
  const orderedSongs = room.finalizedSongOrder.map(id => idToSong.get(id)).filter(Boolean);
  if (orderedSongs.length > 0) {
    console.log(`🎯 Reordering allSongs to match finalizedSongOrder (${orderedSongs.length} songs)`);
    allSongs = orderedSongs;
  }
}
```

**Why This Causes Duplicates:**

1. **Client `generateSongList()` creates duplicates** (`client/src/components/HostView.tsx:2058-2094`):
   - Loops through all playlists and pushes ALL songs into `allSongs` array (line 2078)
   - **NO DEDUPLICATION** - if "Sweet Home Alabama" is in 2 playlists, it gets added twice
   - This duplicate-containing `songList` is sent to `finalize-mix`

2. **Server stores duplicate list** (`server/index.js:1571`):
   - `room.finalizedSongOrder = songList` (stores duplicate-containing list)

3. **Card generation deduplicates** (`server/index.js:3712`):
   - `generateBingoCards()` creates deduplicated columns
   - **OVERWRITES** `room.finalizedSongOrder = globalOrder` (deduplicated IDs)

4. **Playback starts with duplicate `songList`** (`server/index.js:2822`):
   - `start-game` event passes the original `songList` (with duplicates) to `startAutomaticPlayback()`

5. **First mapping works correctly** (`server/index.js:4089-4091`):
   - Creates Map from `songList` (duplicates collapse to single entry per ID)
   - Maps deduplicated IDs from `finalizedSongOrder` → correctly deduplicated `allSongs`

6. **BUG: Second reordering reintroduces duplicates** (`server/index.js:4216-4222`):
   - Creates NEW Map from `allSongs` (which is now deduplicated)
   - Maps IDs from `room.finalizedSongOrder` again
   - **IF `room.finalizedSongOrder` somehow still contains duplicates** (race condition, or if card generation didn't complete), OR
   - **IF the check at line 4083 fails** and `finalizedSongOrder` is the original duplicate-containing list from line 1571, then duplicates get through

**Most Likely Scenario:**
The issue occurs when `room.finalizedSongOrder` still contains the original duplicate-containing list from line 1571. This can happen if:

1. **Race condition:** `startAutomaticPlayback()` is called before `generateBingoCards()` completes (unlikely since it's `await`ed, but possible if there's an error)
2. **Mode detection fails:** If the mode isn't detected as '5x15' (line 3680), the code block at line 3687-3736 doesn't execute, so `finalizedSongOrder` never gets overwritten with deduplicated IDs
3. **Exception in card generation:** If an exception occurs in the try-catch at line 3688-3735, `finalizedSongOrder` remains as the duplicate-containing list

**The Second Reordering Bug (lines 4216-4222):**
Even if the first mapping works correctly, the SECOND reordering creates a new Map from `allSongs` and maps IDs from `room.finalizedSongOrder` again. If `finalizedSongOrder` contains duplicate IDs (from the original client list), mapping them will create duplicate song entries in the final array.

**Example:**
- `room.finalizedSongOrder = ['id1', 'id2', 'id1', 'id3']` (duplicate IDs)
- `allSongs = [song1, song2, song3]` (deduplicated)
- Line 4217: `idToSong = Map{id1: song1, id2: song2, id3: song3}`
- Line 4218: Maps `['id1', 'id2', 'id1', 'id3']` → `[song1, song2, song1, song3]` (DUPLICATES!)

**Root Cause:**
- Client-side `generateSongList()` doesn't deduplicate (line 2078 in HostView.tsx)
- Server has TWO places that set `room.finalizedSongOrder`:
  1. Line 1571: Stores duplicate-containing list from client
  2. Line 3712: Overwrites with deduplicated IDs
- The second reordering at line 4216-4222 is redundant and can cause issues if `finalizedSongOrder` isn't properly deduplicated

**Fix:**
1. **Immediate:** Ensure `room.finalizedSongOrder` is ALWAYS deduplicated. After line 3712, add deduplication:
   ```javascript
   roomRef.finalizedSongOrder = [...new Set(globalOrder)]; // Deduplicate IDs
   ```

2. **Critical:** Fix the second reordering at lines 4216-4222 to deduplicate:
   ```javascript
   if (Array.isArray(room.finalizedSongOrder) && room.finalizedSongOrder.length > 0) {
     const idToSong = new Map(allSongs.map(s => [s.id, s]));
     const seenIds = new Set();
     const orderedSongs = room.finalizedSongOrder
       .map(id => {
         if (seenIds.has(id)) return null; // Skip duplicates
         seenIds.add(id);
         return idToSong.get(id);
       })
       .filter(Boolean);
     if (orderedSongs.length > 0) {
       allSongs = orderedSongs;
     }
   }
   ```

3. **Better:** Add deduplication to client-side `generateSongList()` (HostView.tsx line 2078):
   ```javascript
   // After line 2078, deduplicate:
   const seen = new Set();
   const uniqueSongs = allSongs.filter(song => {
     if (seen.has(song.id)) return false;
     seen.add(song.id);
     return true;
   });
   ```

4. **Best:** Ensure `finalizedSongOrder` is set ONLY after successful deduplication, never store the original duplicate-containing list


