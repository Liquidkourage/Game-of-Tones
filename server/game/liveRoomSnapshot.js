/**
 * Pure serialize / hydrate for mid-show room persistence (feedback P0 #3).
 * Excludes socket ids, timer handles, and Spotify service objects.
 */

const LIVE_GAME_STATES = new Set([
  'playing',
  'paused',
  'paused_for_verification',
  'round_complete',
]);

const SNAPSHOT_VERSION = 1;

/** Fields copied as JSON-friendly values (arrays/objects/primitives). */
const PLAIN_FIELDS = [
  'id',
  'organizationId',
  'dbOrganizationId',
  'ownerUserId',
  'hostClientId',
  'hostParticipantId',
  'gameState',
  'snippetLength',
  'randomStarts',
  'volume',
  'repeatMode',
  'hybridInPersonPlusOnline',
  'playlistSongs',
  'finalizedSongOrder',
  'finalizedSongs',
  'playlists',
  'selectedPlaylists',
  'finalizedPlaylists',
  'calledSongIds',
  'currentSong',
  'currentSongIndex',
  'currentSongStartMs',
  'songStartAtMs',
  'pattern',
  'linesRequired',
  'customPatternName',
  'customPatternReverse',
  'customPatternAllowRotation',
  'customPatternAllowMirror',
  'customPatternAnywhere',
  'patternComposite',
  'letterRevealIntervalSec',
  'publicDisplayTitleRevealMode',
  'publicDisplayLetterRevealToast',
  'publicDisplayCallListMode',
  'publicDisplayFontSize',
  'maxPlayerBingoCards',
  'bingoWinPolicy',
  'songRequests',
  'winners',
  'roundWinners',
  'round',
  'mixFinalized',
  'temporaryPlaylistId',
  'oneBySeventyFivePool',
  'fiveByFifteenColumnsIds',
  'fiveByFifteenColumns',
  'fiveByFifteenPlaylistNames',
  'currentRoundName',
  'currentRoundPrize',
  'currentRoundPlaylistNames',
  'activeSavedRoundCardKey',
  'playerDataRoundToken',
  'venueBranding',
  'selectedDeviceId',
  'createdAt',
  'callSequence',
];

function cloneJson(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function serializePlayers(players) {
  if (!players || typeof players.values !== 'function') return [];
  const out = [];
  for (const p of players.values()) {
    if (!p || p.isHost || p.name === 'Display') continue;
    const clientId = typeof p.clientId === 'string' && p.clientId.trim() ? p.clientId.trim() : null;
    if (!clientId) continue;
    out.push({
      clientId,
      participantId: typeof p.participantId === 'string' ? p.participantId : null,
      name: p.name || 'Player',
      inPerson: p.inPerson !== false,
      playerUserId: p.playerUserId != null ? p.playerUserId : null,
      avatar: typeof p.avatar === 'string' ? p.avatar : '',
      hasBingo: !!p.hasBingo,
      hasOfficialBingoWin: !!p.hasOfficialBingoWin,
      disqualifiedCardIds: Array.isArray(p.disqualifiedCardIds) ? [...p.disqualifiedCardIds] : [],
      patternComplete: !!p.patternComplete,
    });
  }
  return out;
}

/**
 * Build a JSON-safe snapshot of show-critical room state.
 * @returns {object|null}
 */
function serializeRoom(room) {
  if (!room || !room.id) return null;
  const state = {
    v: SNAPSHOT_VERSION,
    needsHostResume: LIVE_GAME_STATES.has(room.gameState),
  };
  for (const key of PLAIN_FIELDS) {
    if (room[key] === undefined) continue;
    const cloned = cloneJson(room[key]);
    if (cloned !== undefined) state[key] = cloned;
  }
  if (room.customPattern instanceof Set) {
    state.customPattern = Array.from(room.customPattern);
  } else if (Array.isArray(room.customPattern)) {
    state.customPattern = [...room.customPattern];
  }
  state.playersByClientId = serializePlayers(room.players);
  // Cards: prefer clientId-keyed map; also fold socket-keyed bingoCards via player.clientId
  const cardsByClient = {};
  if (room.clientCards && typeof room.clientCards.entries === 'function') {
    for (const [cid, value] of room.clientCards.entries()) {
      if (!cid) continue;
      const cloned = cloneJson(value);
      if (cloned != null) cardsByClient[String(cid)] = cloned;
    }
  }
  if (room.bingoCards && room.players && typeof room.bingoCards.entries === 'function') {
    for (const [socketId, value] of room.bingoCards.entries()) {
      const player = room.players.get(socketId);
      const cid = player?.clientId;
      if (!cid || cardsByClient[cid]) continue;
      const cloned = cloneJson(value);
      if (cloned != null) cardsByClient[String(cid)] = cloned;
    }
  }
  state.cardsByClientId = cardsByClient;
  // Do not persist verification queue (socket-bound); host re-opens claims after resume.
  state.bingoVerificationQueue = [];
  return state;
}

/**
 * Create a fresh in-memory room object from a snapshot (no sockets / timers).
 */
function hydrateRoom(state) {
  if (!state || typeof state !== 'object' || !state.id) return null;
  const room = {
    id: String(state.id),
    organizationId: state.organizationId || 'DEFAULT',
    dbOrganizationId: state.dbOrganizationId ?? null,
    ownerUserId: state.ownerUserId ?? null,
    host: null,
    hostClientId: state.hostClientId || null,
    hostParticipantId: state.hostParticipantId || null,
    players: new Map(),
    socketsByParticipant: new Map(),
    bingoCards: new Map(),
    clientCards: new Map(),
    gameState: typeof state.gameState === 'string' ? state.gameState : 'waiting',
    snippetLength: Number(state.snippetLength) > 0 ? Number(state.snippetLength) : 30,
    winners: Array.isArray(state.winners) ? state.winners : [],
    roundWinners: Array.isArray(state.roundWinners) ? state.roundWinners : [],
    repeatMode: !!state.repeatMode,
    volume: Number.isFinite(Number(state.volume)) ? Number(state.volume) : 100,
    hybridInPersonPlusOnline: !!state.hybridInPersonPlusOnline,
    playlistSongs: Array.isArray(state.playlistSongs) ? state.playlistSongs : [],
    finalizedSongOrder: Array.isArray(state.finalizedSongOrder) ? state.finalizedSongOrder : [],
    finalizedSongs: Array.isArray(state.finalizedSongs) ? state.finalizedSongs : [],
    playlists: Array.isArray(state.playlists) ? state.playlists : [],
    selectedPlaylists: Array.isArray(state.selectedPlaylists) ? state.selectedPlaylists : [],
    finalizedPlaylists: Array.isArray(state.finalizedPlaylists) ? state.finalizedPlaylists : [],
    calledSongIds: Array.isArray(state.calledSongIds) ? state.calledSongIds.filter(Boolean) : [],
    currentSong: state.currentSong && state.currentSong.id ? state.currentSong : null,
    currentSongIndex:
      typeof state.currentSongIndex === 'number' && state.currentSongIndex >= 0
        ? state.currentSongIndex
        : 0,
    currentSongStartMs: Number(state.currentSongStartMs) || 0,
    songStartAtMs: state.songStartAtMs != null ? Number(state.songStartAtMs) : null,
    pattern: state.pattern || 'line',
    linesRequired: Number(state.linesRequired) > 0 ? Number(state.linesRequired) : 1,
    customPattern: Array.isArray(state.customPattern) ? new Set(state.customPattern) : undefined,
    customPatternName: state.customPatternName || '',
    customPatternReverse: !!state.customPatternReverse,
    customPatternAllowRotation: !!state.customPatternAllowRotation,
    customPatternAllowMirror: !!state.customPatternAllowMirror,
    customPatternAnywhere: !!state.customPatternAnywhere,
    patternComposite: state.patternComposite || undefined,
    letterRevealIntervalSec: state.letterRevealIntervalSec,
    publicDisplayTitleRevealMode: state.publicDisplayTitleRevealMode,
    publicDisplayLetterRevealToast: state.publicDisplayLetterRevealToast !== false,
    publicDisplayCallListMode: state.publicDisplayCallListMode,
    publicDisplayFontSize: state.publicDisplayFontSize,
    maxPlayerBingoCards: state.maxPlayerBingoCards || 1,
    bingoWinPolicy: state.bingoWinPolicy || 'any_round',
    songRequests: Array.isArray(state.songRequests) ? state.songRequests : [],
    round: typeof state.round === 'number' ? state.round : 0,
    mixFinalized: !!state.mixFinalized,
    temporaryPlaylistId: state.temporaryPlaylistId || null,
    oneBySeventyFivePool: Array.isArray(state.oneBySeventyFivePool) ? state.oneBySeventyFivePool : [],
    fiveByFifteenColumnsIds: state.fiveByFifteenColumnsIds,
    fiveByFifteenColumns: state.fiveByFifteenColumns,
    fiveByFifteenPlaylistNames: state.fiveByFifteenPlaylistNames,
    currentRoundName: state.currentRoundName || null,
    currentRoundPrize: state.currentRoundPrize || null,
    currentRoundPlaylistNames: Array.isArray(state.currentRoundPlaylistNames)
      ? state.currentRoundPlaylistNames
      : [],
    activeSavedRoundCardKey: state.activeSavedRoundCardKey || null,
    playerDataRoundToken: state.playerDataRoundToken || null,
    venueBranding: state.venueBranding || null,
    selectedDeviceId: state.selectedDeviceId || null,
    createdAt: state.createdAt || new Date().toISOString(),
    callSequence: typeof state.callSequence === 'number' ? state.callSequence : 0,
    bingoVerificationQueue: [],
    randomStarts: state.randomStarts || 'none',
    needsHostResume: state.needsHostResume === true || LIVE_GAME_STATES.has(state.gameState),
    restoredFromLiveSnapshot: true,
  };

  // If we were mid-round, do not auto-resume Spotify — host presses Resume.
  if (room.needsHostResume && (room.gameState === 'playing' || room.gameState === 'paused_for_verification')) {
    room.gameState = 'paused';
  }

  const cards = state.cardsByClientId && typeof state.cardsByClientId === 'object'
    ? state.cardsByClientId
    : {};
  for (const [cid, value] of Object.entries(cards)) {
    if (cid && value != null) room.clientCards.set(cid, value);
  }

  return room;
}

function shouldPersistRoom(room) {
  if (!room?.id) return false;
  if (room.gameState === 'ended') return false;
  // Persist once a mix exists or a round is/was live — skip empty lobby shells.
  if (room.mixFinalized) return true;
  if (Array.isArray(room.playlistSongs) && room.playlistSongs.length > 0) return true;
  if (Array.isArray(room.calledSongIds) && room.calledSongIds.length > 0) return true;
  if (LIVE_GAME_STATES.has(room.gameState)) return true;
  return false;
}

module.exports = {
  SNAPSHOT_VERSION,
  LIVE_GAME_STATES,
  serializeRoom,
  hydrateRoom,
  shouldPersistRoom,
};
