/**
 * Requests meta-round helpers: put a player's approved requests on their bingo card(s),
 * and format projector "requested by" attribution from the room queue.
 */

function trimName(raw, fallback = 'Player') {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s || fallback;
}

/** Join requester names for projector copy (UI adds "Requested by "). */
function formatRequestedByLabel(names) {
  const list = [];
  const seen = new Set();
  for (const raw of Array.isArray(names) ? names : []) {
    const name = trimName(raw, '');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(name);
  }
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} & ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
}

/**
 * songId → { names: string[], clientIds: Set<string> } for approved resolved requests.
 */
function buildRequestAttributionBySongId(songRequests) {
  const map = new Map();
  const list = Array.isArray(songRequests) ? songRequests : [];
  for (const entry of list) {
    if (!entry || entry.status !== 'approved') continue;
    const songId =
      entry.resolvedSong && typeof entry.resolvedSong.id === 'string'
        ? entry.resolvedSong.id.trim()
        : '';
    if (!songId) continue;
    let row = map.get(songId);
    if (!row) {
      row = { names: [], clientIds: new Set() };
      map.set(songId, row);
    }
    const name = trimName(entry.playerName);
    const key = name.toLowerCase();
    if (!row.names.some((n) => n.toLowerCase() === key)) row.names.push(name);
    const cid = typeof entry.clientId === 'string' ? entry.clientId.trim() : '';
    if (cid) row.clientIds.add(cid);
  }
  return map;
}

function requestedByFieldsFromAttribution(attr) {
  if (!attr || !Array.isArray(attr.names) || attr.names.length === 0) return {};
  const requestedBy = formatRequestedByLabel(attr.names);
  if (!requestedBy) return {};
  return {
    requestedBy,
    requestedByNames: attr.names.slice(),
  };
}

/** Attach requestedBy* onto a song object when attribution exists. */
function applyRequestAttributionToSong(song, attributionBySongId) {
  if (!song || typeof song !== 'object' || !song.id || !attributionBySongId) return song;
  const attr = attributionBySongId.get(String(song.id));
  const fields = requestedByFieldsFromAttribution(attr);
  if (!fields.requestedBy) return song;
  return { ...song, ...fields };
}

/**
 * Approved resolved songs this player submitted (in submission order), limited to the round pool when provided.
 */
function approvedRequestSongsForPlayer(songRequests, player, poolById = null) {
  const list = Array.isArray(songRequests) ? songRequests : [];
  const clientId =
    player && typeof player.clientId === 'string' && player.clientId.trim()
      ? player.clientId.trim()
      : '';
  const playerName = player && typeof player.name === 'string' ? player.name.trim() : '';
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry || entry.status !== 'approved') continue;
    const song = entry.resolvedSong;
    if (!song || typeof song.id !== 'string' || !song.id.trim()) continue;
    const songId = song.id.trim();
    if (seen.has(songId)) continue;
    const entryCid = typeof entry.clientId === 'string' ? entry.clientId.trim() : '';
    let mine = false;
    if (clientId && entryCid) mine = entryCid === clientId;
    else if (!entryCid && playerName && entry.playerName === playerName) mine = true;
    if (!mine) continue;
    if (poolById && !poolById.has(songId)) continue;
    seen.add(songId);
    const fromPool = poolById ? poolById.get(songId) : null;
    out.push(fromPool && typeof fromPool === 'object' ? fromPool : song);
  }
  return out;
}

function defaultShuffle(arr) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/**
 * Build a card pick list: place the player's request songs into random slots first,
 * then fill remaining slots from the pool (excluding those already placed).
 * Prefer this over post-hoc end-of-list swaps (which clustered requests at the bottom).
 *
 * @param {object[]} poolSongs full pool available for this card geometry
 * @param {object[]} mustHaveSongs player's approved request songs (already pool-filtered)
 * @param {number} songsNeeded 24 or 25
 * @param {(arr: any[]) => any[]} [shuffleFn] injectable shuffle (tests / server properShuffle)
 */
function buildPickWithGuaranteedRequests(poolSongs, mustHaveSongs, songsNeeded, shuffleFn) {
  const need = Math.max(0, Math.floor(Number(songsNeeded)) || 0);
  if (need === 0) return [];
  const shuffle = typeof shuffleFn === 'function' ? shuffleFn : defaultShuffle;
  const pool = Array.isArray(poolSongs) ? poolSongs.filter((s) => s && s.id) : [];
  const must = [];
  const mustSeen = new Set();
  for (const song of Array.isArray(mustHaveSongs) ? mustHaveSongs : []) {
    if (!song || !song.id) continue;
    const id = String(song.id);
    if (mustSeen.has(id)) continue;
    // Prefer richer pool row when available.
    const fromPool = pool.find((s) => String(s.id) === id);
    mustSeen.add(id);
    must.push(fromPool || song);
    if (must.length >= need) break;
  }

  const pick = new Array(need).fill(null);
  const mustPlaced = shuffle(must);
  const slotOrder = shuffle(Array.from({ length: need }, (_, i) => i));
  for (let i = 0; i < mustPlaced.length; i++) {
    pick[slotOrder[i]] = mustPlaced[i];
  }

  const used = new Set(mustPlaced.map((s) => String(s.id)));
  const fillers = shuffle(pool.filter((s) => !used.has(String(s.id))));
  let fi = 0;
  for (let i = 0; i < need; i++) {
    if (pick[i]) continue;
    if (fi >= fillers.length) break;
    const next = fillers[fi++];
    pick[i] = next;
    used.add(String(next.id));
  }
  return pick.filter(Boolean).slice(0, need);
}

/**
 * @deprecated Prefer buildPickWithGuaranteedRequests(fullPool, must, need, shuffle).
 * Kept as a thin wrapper for call sites that still pass an already-sliced pick as the pool.
 */
function ensurePlayerRequestSongsOnPick(pickSongs, mustHaveSongs, songsNeeded, shuffleFn) {
  return buildPickWithGuaranteedRequests(pickSongs, mustHaveSongs, songsNeeded, shuffleFn);
}

module.exports = {
  formatRequestedByLabel,
  buildRequestAttributionBySongId,
  requestedByFieldsFromAttribution,
  applyRequestAttributionToSong,
  approvedRequestSongsForPlayer,
  buildPickWithGuaranteedRequests,
  ensurePlayerRequestSongsOnPick,
};
