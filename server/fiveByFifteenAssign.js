/**
 * 5×15 column assignment: 15 globally unique tracks per playlist column (75 total).
 */

function canonicalPlaylistIdForMatch(id) {
  const s = String(id ?? '').trim();
  const m = /^spotify:playlist:([a-zA-Z0-9]+)$/i.exec(s);
  if (m) return m[1];
  return s;
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
 */
function assignGloballyUniqueFiveByFifteenColumns(perListUnique, songOrderExtra = []) {
  const n = perListUnique.length;
  const columnPools = Array.from({ length: n }, () => []);
  const globalSeen = new Set();

  const trackOwners = new Map();
  for (let i = 0; i < n; i++) {
    for (const song of perListUnique[i].songs) {
      if (!song?.id) continue;
      if (!trackOwners.has(song.id)) trackOwners.set(song.id, new Set());
      trackOwners.get(song.id).add(i);
    }
  }

  const tryAdd = (index, song) => {
    if (!song?.id || globalSeen.has(song.id)) return false;
    if (columnPools[index].length >= FIVE_BY_FIFTEEN_COLUMN_SLOTS) return false;
    globalSeen.add(song.id);
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

  // 1) Tracks that appear on only one playlist — never contested
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

  const remainingOptions = (index) =>
    sourcesForColumn(index).filter((s) => s?.id && !globalSeen.has(s.id)).length;

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
          `Playlist "${pl.name}" could only get ${songs.length} of 15 globally unique column slots (${inPlaylist} in mix; ${shortage} short). Another column may be using overlapping tracks — add a few more unique songs to this playlist on Spotify.`,
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
  dedupeSongsByIdPreserveOrder,
  buildPerListUnique,
  assignGloballyUniqueFiveByFifteenColumns,
  flattenFiveByFifteenColumns,
  FIVE_BY_FIFTEEN_COLUMN_SLOTS,
};
