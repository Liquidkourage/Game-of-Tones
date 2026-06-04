/** Spotify Jam / Social Connect virtual device IDs (venue Jam sessions). */
const JAM_DEVICE_ID_PREFIX = 'social-connect-';

/** Min gap between transfer attempts when correcting device routing. */
const JAM_DEVICE_TRANSFER_COOLDOWN_MS = 90_000;

function isSpotifyJamDeviceId(deviceId) {
  return typeof deviceId === 'string' && deviceId.startsWith(JAM_DEVICE_ID_PREFIX);
}

function isSpotifyJamDevice(device) {
  if (!device) return false;
  return isSpotifyJamDeviceId(device.id);
}

function annotateSpotifyDevice(device) {
  if (!device || typeof device !== 'object') return device;
  return { ...device, isJam: isSpotifyJamDevice(device) };
}

function isVenueSpotifyJamMode(room) {
  return !!room?.venueSpotifyJamMode;
}

function cacheJamDeviceId(room, deviceId) {
  if (room && isSpotifyJamDeviceId(deviceId)) {
    room._lastKnownJamDeviceId = deviceId;
    if (isVenueSpotifyJamMode(room)) {
      room.selectedDeviceId = deviceId;
    }
  }
}

/** True when Spotify reports the song/context Tempo expects for this room. */
function playbackMatchesExpected(state, room) {
  const expectedTrackId = room?.currentSong?.id;
  const currentTrackId = state?.item?.id;
  if (!expectedTrackId || !currentTrackId || currentTrackId !== expectedTrackId) return false;

  const expectedContext = room.temporaryPlaylistId
    ? `spotify:playlist:${room.temporaryPlaylistId}`
    : null;
  const currentContext = state?.context?.uri || null;
  if (expectedContext && currentContext && currentContext !== expectedContext) return false;

  return true;
}

function jamTransferOnCooldown(room) {
  const until = room?._jamTransferCooldownUntil || 0;
  return Date.now() < until;
}

function markJamTransferAttempt(room) {
  if (!room) return;
  room._jamTransferCooldownUntil = Date.now() + JAM_DEVICE_TRANSFER_COOLDOWN_MS;
}

/**
 * Whether current and target devices should be treated as equivalent for monitoring.
 * Jam session IDs rotate; in venue Jam mode any social-connect device counts as on-target.
 */
function playbackDevicesMatch(room, targetDeviceId, currentDeviceId) {
  if (!targetDeviceId || !currentDeviceId) return targetDeviceId === currentDeviceId;
  if (targetDeviceId === currentDeviceId) return true;
  if (isVenueSpotifyJamMode(room) && isSpotifyJamDeviceId(currentDeviceId)) {
    return true;
  }
  if (isSpotifyJamDeviceId(targetDeviceId) && isSpotifyJamDeviceId(currentDeviceId)) {
    return true;
  }
  return false;
}

function resolvePlaybackTargetDeviceId(room, fallbackDeviceId, state) {
  const explicit = room?.selectedDeviceId || fallbackDeviceId || null;
  if (!isVenueSpotifyJamMode(room)) {
    return explicit;
  }
  if (state?.device?.id && isSpotifyJamDeviceId(state.device.id)) {
    cacheJamDeviceId(room, state.device.id);
    return state.device.id;
  }
  if (isSpotifyJamDeviceId(explicit)) {
    return explicit;
  }
  if (room?._lastKnownJamDeviceId) {
    return room._lastKnownJamDeviceId;
  }
  return explicit;
}

function maybeEmitJamActiveWarning(io, roomId, room) {
  if (!io || !room) return;
  if (isVenueSpotifyJamMode(room)) {
    if (room._jamVenueModeInfoEmitted) return;
    room._jamVenueModeInfoEmitted = true;
    io.to(roomId).emit('playback-warning', {
      message:
        'Venue Spotify Jam mode is on. Tempo controls playback through the active Jam session — start Jam on the venue speaker before Start Game.',
      code: 'spotify_jam_venue_mode',
    });
    return;
  }
  if (room._jamWarningEmitted) return;
  room._jamWarningEmitted = true;
  io.to(roomId).emit('playback-warning', {
    message:
      'Spotify Jam is active on this account. Enable “Venue uses Spotify Jam” in Connection if the show must run through Jam, or end Jam and pick your speaker.',
    code: 'spotify_jam_active',
  });
}

/**
 * Skip or allow device-transfer corrections depending on venue Jam mode.
 */
function shouldAttemptJamDeviceCorrection(room, currentDeviceId, targetDeviceId, state) {
  if (isVenueSpotifyJamMode(room)) {
    if (isSpotifyJamDeviceId(currentDeviceId)) {
      if (playbackMatchesExpected(state, room)) return false;
      return !jamTransferOnCooldown(room);
    }
    if (playbackMatchesExpected(state, room)) return false;
    return !jamTransferOnCooldown(room);
  }
  if (!isSpotifyJamDeviceId(currentDeviceId) || isSpotifyJamDeviceId(targetDeviceId)) {
    return true;
  }
  if (playbackMatchesExpected(state, room)) {
    return false;
  }
  return !jamTransferOnCooldown(room);
}

async function findJamDeviceId(sp, room, state) {
  if (state?.device?.id && isSpotifyJamDeviceId(state.device.id)) {
    cacheJamDeviceId(room, state.device.id);
    return state.device.id;
  }
  if (isSpotifyJamDeviceId(room?.selectedDeviceId)) {
    return room.selectedDeviceId;
  }
  if (room?._lastKnownJamDeviceId) {
    return room._lastKnownJamDeviceId;
  }
  const now = Date.now();
  if (!room || (room._jamDeviceLookupAt && now - room._jamDeviceLookupAt < 60_000)) {
    return null;
  }
  room._jamDeviceLookupAt = now;
  try {
    const devices = await sp.getUserDevices();
    const jam = (devices || []).find((d) => isSpotifyJamDeviceId(d.id));
    if (jam?.id) {
      cacheJamDeviceId(room, jam.id);
      return jam.id;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

async function resolveMonitorTargetDeviceId(roomId, room, fallbackDeviceId, state, sp) {
  let target = resolvePlaybackTargetDeviceId(room, fallbackDeviceId, state);
  if (isVenueSpotifyJamMode(room) && !isSpotifyJamDeviceId(target)) {
    const jamId = await findJamDeviceId(sp, room, state);
    if (jamId) target = jamId;
  }
  return target;
}

module.exports = {
  JAM_DEVICE_ID_PREFIX,
  JAM_DEVICE_TRANSFER_COOLDOWN_MS,
  isSpotifyJamDeviceId,
  isSpotifyJamDevice,
  annotateSpotifyDevice,
  isVenueSpotifyJamMode,
  cacheJamDeviceId,
  playbackMatchesExpected,
  playbackDevicesMatch,
  resolvePlaybackTargetDeviceId,
  resolveMonitorTargetDeviceId,
  findJamDeviceId,
  jamTransferOnCooldown,
  markJamTransferAttempt,
  maybeEmitJamActiveWarning,
  shouldAttemptJamDeviceCorrection,
};
