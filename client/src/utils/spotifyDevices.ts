/** Spotify Jam / Social Connect virtual device (venue Jam sessions). */
export function isSpotifyJamDeviceId(deviceId: string | null | undefined): boolean {
  return typeof deviceId === 'string' && deviceId.startsWith('social-connect-');
}

export function isSpotifyJamDevice(device: { id?: string } | null | undefined): boolean {
  return isSpotifyJamDeviceId(device?.id);
}

export function pickPreferredPlaybackDevice<T extends { id: string; is_active?: boolean }>(
  devices: T[],
  options?: {
    savedId?: string | null;
    currentId?: string | null;
    pendingId?: string | null;
    venueJamMode?: boolean;
  },
): T | null {
  const { savedId, currentId, pendingId, venueJamMode } = options ?? {};

  if (venueJamMode) {
    const jamDevices = devices.filter((d) => isSpotifyJamDeviceId(d.id));
    const pool = jamDevices.length > 0 ? jamDevices : devices;

    if (pendingId) {
      const pending = pool.find((d) => d.id === pendingId);
      if (pending) return pending;
    }
    const activeJam = pool.find((d) => d.is_active && isSpotifyJamDeviceId(d.id));
    if (activeJam) return activeJam;
    if (savedId) {
      const savedJam = pool.find((d) => isSpotifyJamDeviceId(d.id));
      if (savedJam) return savedJam;
    }
    if (currentId && isSpotifyJamDeviceId(currentId)) {
      const current = pool.find((d) => d.id === currentId);
      if (current) return current;
    }
    return pool.find((d) => isSpotifyJamDeviceId(d.id)) ?? pool[0] ?? null;
  }

  const playable = devices.filter((d) => !isSpotifyJamDeviceId(d.id));
  const pool = playable.length > 0 ? playable : devices;

  if (pendingId) {
    const pending = pool.find((d) => d.id === pendingId);
    if (pending) return pending;
  }
  if (savedId) {
    const saved = pool.find((d) => d.id === savedId);
    if (saved) return saved;
  }
  if (currentId && !isSpotifyJamDeviceId(currentId)) {
    const current = pool.find((d) => d.id === currentId);
    if (current) return current;
  }
  return pool[0] ?? null;
}
