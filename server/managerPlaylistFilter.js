/**
 * Mirrors client HostView Manager rules for which playlists need explicit stats
 * (GoT filter, exclude assigned, stable id normalization).
 */

function normalizeSpotifyPlaylistId(id) {
  if (id == null || id === '') return '';
  return String(id).trim();
}

function filterBasePlaylistsForMix(playlists, showAllPlaylists) {
  if (!showAllPlaylists) {
    return playlists.filter((p) => {
      const nameLower = (p.name || '').toLowerCase();
      if (nameLower.includes('game of tones output') || nameLower.includes('gameoftones output')) {
        return false;
      }
      const startsWithGot = /^got\s*[-–—:]*\s*/i.test(p.name || '');
      const containsGameOfTones = nameLower.includes('game of tones') || nameLower.includes('gameoftones');
      return startsWithGot || containsGameOfTones;
    });
  }
  return playlists;
}

/** @param {Set<string>|string[]} assigned */
function computeManagerExplicitPlaylistIds(playlists, showAllPlaylists, assigned) {
  const base = filterBasePlaylistsForMix(playlists, showAllPlaylists);
  const set =
    assigned instanceof Set
      ? assigned
      : new Set(
          (Array.isArray(assigned) ? assigned : String(assigned || '').split(','))
            .map((s) => String(s).trim())
            .filter(Boolean),
        );
  return base
    .filter((p) => {
      const pid = normalizeSpotifyPlaylistId(p.id);
      return pid !== '' && !set.has(pid);
    })
    .map((p) => normalizeSpotifyPlaylistId(p.id));
}

module.exports = {
  normalizeSpotifyPlaylistId,
  filterBasePlaylistsForMix,
  computeManagerExplicitPlaylistIds,
};
