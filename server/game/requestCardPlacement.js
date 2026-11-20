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

/**
 * Ensure must-have songs appear on the pick list (same length). Swaps out random non-must picks.
 * Songs already on the card are left in place; order of remaining slots is reshuffled lightly via swap targets.
 */
function ensurePlayerRequestSongsOnPick(pickSongs, mustHaveSongs, songsNeeded) {
  const need = Math.max(0, Math.floor(Number(songsNeeded)) || 0);
  const pick = Array.isArray(pickSongs) ? pickSongs.filter((s) => s && s.id).slice(0, need) : [];
  const must = Array.isArray(mustHaveSongs) ? mustHaveSongs.filter((s) => s && s.id) : [];
  if (need === 0 || must.length === 0) return pick;

  const onCard = new Set(pick.map((s) => String(s.id)));
  const missing = [];
  const missingSeen = new Set();
  for (const song of must) {
    const id = String(song.id);
    if (onCard.has(id) || missingSeen.has(id)) continue;
    missingSeen.add(id);
    missing.push(song);
  }
  if (missing.length === 0) return pick;

  const mustIds = new Set(must.map((s) => String(s.id)));
  const replaceableIdx = [];
  for (let i = 0; i < pick.length; i++) {
    if (!mustIds.has(String(pick[i].id))) replaceableIdx.push(i);
  }

  let mi = 0;
  while (mi < missing.length && replaceableIdx.length > 0) {
    const swapAt = replaceableIdx.pop();
    const next = missing[mi++];
    pick[swapAt] = next;
    onCard.add(String(next.id));
  }
  return pick;
}

module.exports = {
  formatRequestedByLabel,
  buildRequestAttributionBySongId,
  requestedByFieldsFromAttribution,
  applyRequestAttributionToSong,
  approvedRequestSongsForPlayer,
  ensurePlayerRequestSongsOnPick,
};
