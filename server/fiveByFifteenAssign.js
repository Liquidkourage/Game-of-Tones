/**
 * 5×15 column assignment: 15 globally unique tracks per playlist column (75 total).
 * Uniqueness is by Spotify id and by normalized title+artist (remasters / alt ids).
 */

function canonicalPlaylistIdForMatch(id) {
  const s = String(id ?? '').trim();
  const m = /^spotify:playlist:([a-zA-Z0-9]+)$/i.exec(s);
  if (m) return m[1];
  return s;
}

/** Same normalization as host night-wide leftovers / collision warning. */
function normalizeTrackLabelForDedup(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/^\s*got\s*[-–:]*\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Soft identity for the same song under different Spotify ids.
 * Falls back to id when title or artist is missing.
 */
function trackTitleArtistDedupKey(song) {
  if (!song || typeof song !== 'object') return null;
  const title = normalizeTrackLabelForDedup(song.customSongName || song.name || '');
  const artist = normalizeTrackLabelForDedup(song.customArtistName || song.artist || '');
  if (title && artist) return `${title}\0${artist}`;
  const id = String(song.id || '').trim();
  return id || null;
}

function dedupeSongsByIdPreserveOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    if (s && s.id && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}

function buildPerListUnique(playlists, songOrder) {
  return playlists.map((pl) => {
    const plCanon = canonicalPlaylistIdForMatch(pl.id);
    const raw = (Array.isArray(songOrder) ? songOrder : []).filter(
      (s) => canonicalPlaylistIdForMatch(s.sourcePlaylistId) === plCanon,
    );
    return { id: pl.id, name: pl.name, songs: dedupeSongsByIdPreserveOrder(raw) };
  });
}

const FIVE_BY_FIFTEEN_COLUMN_SLOTS = 15;

/**
 * Assign 15 globally unique tracks per column. Exclusive tracks first, then backfill
 * neediest columns from full playlist + extra song list (host order / API).
 * Skips a candidate when its Spotify id OR title+artist soft-key is already used.
 */
function assignGloballyUniqueFiveByFifteenColumns(perListUnique, songOrderExtra = []) {
  const n = perListUnique.length;
  const columnPools = Array.from({ length: n }, () => []);
  const globalSeenIds = new Set();
  const globalSeenSoft = new Set();

  const trackOwners = new Map();
  for (let i = 0; i < n; i++) {
    for (const song of perListUnique[i].songs) {
      if (!song?.id) continue;
      if (!trackOwners.has(song.id)) trackOwners.set(song.id, new Set());
      trackOwners.get(song.id).add(i);
    }
  }

  const tryAdd = (index, song) => {
    if (!song?.id || globalSeenIds.has(song.id)) return false;
    if (columnPools[index].length >= FIVE_BY_FIFTEEN_COLUMN_SLOTS) return false;
    const soft = trackTitleArtistDedupKey(song);
    if (soft && globalSeenSoft.has(soft)) return false;
    globalSeenIds.add(song.id);
    if (soft) globalSeenSoft.add(soft);
    columnPools[index].push(song);
    return true;
  };

  const sourcesForColumn = (index) => {
    const canon = canonicalPlaylistIdForMatch(String(perListUnique[index].id));
    const fromPl = dedupeSongsByIdPreserveOrder(perListUnique[index].songs);
    const extra = Array.isArray(songOrderExtra) ? dedupeSongsByIdPreserveOrder(songOrderExtra) : [];
    const merged = [...fromPl];
    for (const s of extra) {
      if (!s?.id) continue;
      if (canonicalPlaylistIdForMatch(s.sourcePlaylistId) !== canon) continue;
      if (!merged.some((m) => m.id === s.id)) merged.push(s);
    }
    return merged;
  };

  const isAvailable = (song) => {
    if (!song?.id || globalSeenIds.has(song.id)) return false;
    const soft = trackTitleArtistDedupKey(song);
    if (soft && globalSeenSoft.has(soft)) return false;
    return true;
  };

  // 1) Tracks that appear on only one playlist — never contested by id
  for (let i = 0; i < n; i++) {
    for (const song of perListUnique[i].songs) {
      const owners = trackOwners.get(song.id);
      if (owners && owners.size === 1) tryAdd(i, song);
    }
  }

  // 2) Round-robin backfill: neediest columns first
  let progressed = true;
  while (progressed) {
    progressed = false;
    const needy = [...Array(n).keys()]
      .filter((i) => columnPools[i].length < FIVE_BY_FIFTEEN_COLUMN_SLOTS)
      .sort((a, b) => columnPools[a].length - columnPools[b].length);
    for (const index of needy) {
      for (const song of sourcesForColumn(index)) {
        if (tryAdd(index, song)) {
          progressed = true;
          if (columnPools[index].length >= FIVE_BY_FIFTEEN_COLUMN_SLOTS) break;
        }
      }
    }
  }

  // 3) Columns with fewest remaining options claim shared tracks next
  const stillNeedy = () =>
    [...Array(n).keys()].filter((i) => columnPools[i].length < FIVE_BY_FIFTEEN_COLUMN_SLOTS);

  const remainingOptions = (index) => sourcesForColumn(index).filter(isAvailable).length;

  for (const index of stillNeedy().sort((a, b) => remainingOptions(a) - remainingOptions(b))) {
    for (const song of sourcesForColumn(index)) {
      if (columnPools[index].length >= FIVE_BY_FIFTEEN_COLUMN_SLOTS) break;
      tryAdd(index, song);
    }
  }

  const warnings = [];
  const perListGloballyUnique = perListUnique.map((pl, index) => {
    const songs = columnPools[index];
    const inPlaylist = Array.isArray(pl.songs) ? pl.songs.length : 0;
    if (songs.length < FIVE_BY_FIFTEEN_COLUMN_SLOTS) {
      const shortage = FIVE_BY_FIFTEEN_COLUMN_SLOTS - songs.length;
      if (inPlaylist < FIVE_BY_FIFTEEN_COLUMN_SLOTS) {
        warnings.push(
          `Playlist "${pl.name}" has only ${inPlaylist} track(s) in the mix (needs 15, short by ${FIVE_BY_FIFTEEN_COLUMN_SLOTS - inPlaylist}). Add more songs to this playlist or refetch.`,
        );
      } else {
        warnings.push(
          `Playlist "${pl.name}" could only get ${songs.length} of 15 globally unique column slots (${inPlaylist} in mix; ${shortage} short). Another column may be using overlapping tracks (same Spotify id or same title+artist) — add a few more unique songs to this playlist on Spotify.`,
        );
      }
    }
    return {
      ...pl,
      songs,
      originalCount: inPlaylist,
    };
  });

  return { perListGloballyUnique, warnings };
}

function flattenFiveByFifteenColumns(perListGloballyUnique) {
  const picks = [];
  for (let col = 0; col < perListGloballyUnique.length; col++) {
    picks.push(...perListGloballyUnique[col].songs.slice(0, FIVE_BY_FIFTEEN_COLUMN_SLOTS));
  }
  return picks;
}

module.exports = {
  canonicalPlaylistIdForMatch,
  normalizeTrackLabelForDedup,
  trackTitleArtistDedupKey,
  dedupeSongsByIdPreserveOrder,
  buildPerListUnique,
  assignGloballyUniqueFiveByFifteenColumns,
  flattenFiveByFifteenColumns,
  FIVE_BY_FIFTEEN_COLUMN_SLOTS,
};
