import { API_BASE } from '../config';
import { playerFetch } from './playerFetch';

export const PLAYER_AVATAR_PRESETS = [
  { id: 'fox', label: 'Fox', glyph: '🦊' },
  { id: 'owl', label: 'Owl', glyph: '🦉' },
  { id: 'cat', label: 'Cat', glyph: '🐱' },
  { id: 'dog', label: 'Dog', glyph: '🐶' },
  { id: 'bear', label: 'Bear', glyph: '🐻' },
  { id: 'bird', label: 'Bird', glyph: '🐦' },
  { id: 'fish', label: 'Fish', glyph: '🐟' },
  { id: 'star', label: 'Star', glyph: '⭐' },
  { id: 'moon', label: 'Moon', glyph: '🌙' },
  { id: 'bolt', label: 'Bolt', glyph: '⚡' },
  { id: 'heart', label: 'Heart', glyph: '💜' },
  { id: 'music', label: 'Music', glyph: '🎵' },
] as const;

export type PlayerAvatarPresetId = (typeof PLAYER_AVATAR_PRESETS)[number]['id'];

const GUEST_AVATAR_KEY = 'tempo_player_avatar';

export function presetAvatarValue(id: string): string {
  return `preset:${String(id || '').trim().toLowerCase()}`;
}

export function parsePresetAvatarId(avatar: string | null | undefined): PlayerAvatarPresetId | null {
  const m = String(avatar || '')
    .trim()
    .match(/^preset:([a-z0-9_-]+)$/i);
  if (!m) return null;
  const id = m[1].toLowerCase() as PlayerAvatarPresetId;
  return PLAYER_AVATAR_PRESETS.some((p) => p.id === id) ? id : null;
}

export function avatarImageSrc(avatar: string | null | undefined): string | null {
  const v = String(avatar || '').trim();
  if (!v || parsePresetAvatarId(v)) return null;
  if (v.startsWith('/api/player-avatar/')) {
    return `${API_BASE || ''}${v}`;
  }
  if (/^https?:\/\//i.test(v)) return v;
  return null;
}

export function initialsFromName(name: string | null | undefined): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase() || '?';
}

export function avatarHueFromName(name: string | null | undefined): number {
  const s = String(name || 'player');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function readGuestAvatar(): string {
  try {
    return String(localStorage.getItem(GUEST_AVATAR_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function writeGuestAvatar(avatar: string): void {
  try {
    const v = String(avatar || '').trim();
    if (!v) localStorage.removeItem(GUEST_AVATAR_KEY);
    else localStorage.setItem(GUEST_AVATAR_KEY, v);
  } catch {
    /* ignore */
  }
}

/** Square-crop + compress for upload (≤ ~220KB JPEG). */
export async function compressImageFileToDataUrl(file: File, maxEdge = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);
  const size = Math.min(maxEdge, side);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process image');
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close();
  let quality = 0.85;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > 280_000 && quality > 0.45) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUrl.length > 350_000) throw new Error('Image is too large after compression');
  return dataUrl;
}

export type PlayerAvatarUploadBody = {
  avatar?: string;
  dataUrl?: string;
  imageUrl?: string;
};

export async function uploadPlayerAvatar(
  body: PlayerAvatarUploadBody,
): Promise<{ avatar: string }> {
  const res = await playerFetch(`${API_BASE || ''}/api/player/avatar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as {
    avatar?: string;
    message?: string;
  };
  if (!res.ok || !j.avatar) {
    throw new Error(j.message || 'Could not save avatar');
  }
  return { avatar: j.avatar };
}

/** Prefer room socket (no CORS) when seated; fall back to HTTP; bare https URL last. */
export async function persistPlayerAvatarValue(
  next: string,
  opts?: {
    roomId?: string;
    socket?: { emit: (event: string, payload: unknown, ack?: (res: any) => void) => void } | null;
  },
): Promise<string> {
  const trimmed = String(next || '').trim();
  if (!trimmed) return '';

  const body: PlayerAvatarUploadBody = trimmed.startsWith('data:')
    ? { dataUrl: trimmed }
    : /^https?:\/\//i.test(trimmed)
      ? { imageUrl: trimmed }
      : { avatar: trimmed };

  const socket = opts?.socket;
  const roomId = opts?.roomId;
  if (socket && roomId) {
    try {
      const avatar = await new Promise<string>((resolve, reject) => {
        const t = window.setTimeout(() => reject(new Error('Avatar save timed out')), 45000);
        try {
          socket.emit('set-player-avatar', { roomId, ...body }, (res: any) => {
            window.clearTimeout(t);
            if (res?.ok && typeof res.avatar === 'string') resolve(res.avatar);
            else reject(new Error(res?.message || 'Could not save avatar'));
          });
        } catch (e) {
          window.clearTimeout(t);
          reject(e);
        }
      });
      return avatar;
    } catch (socketErr) {
      console.warn('set-player-avatar socket failed, trying HTTP:', socketErr);
    }
  }

  try {
    const { avatar } = await uploadPlayerAvatar(body);
    return avatar;
  } catch (httpErr) {
    // Guests / blocked CORS: keep remote URL for join-time mirror on the server.
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('preset:')) {
      return trimmed;
    }
    throw httpErr;
  }
}
