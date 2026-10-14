import React, { useCallback, useRef, useState } from 'react';
import PlayerAvatar from './PlayerAvatar';
import {
  PLAYER_AVATAR_PRESETS,
  compressImageFileToDataUrl,
  parsePresetAvatarId,
  persistPlayerAvatarValue,
  presetAvatarValue,
  writeGuestAvatar,
} from '../utils/playerAvatars';
import { updatePlayerProfile } from '../utils/playerFetch';

export default function PlayerAvatarPicker({
  value,
  name,
  signedIn,
  onChange,
  disabled = false,
  roomId,
  socket,
}: {
  value: string;
  name?: string;
  /** When true, persist via profile/avatar API; guests still receive onChange + localStorage. */
  signedIn: boolean;
  onChange: (avatar: string) => void;
  disabled?: boolean;
  /** When seated, prefer socket upload (avoids CORS on POST /api/player/avatar). */
  roomId?: string;
  socket?: { emit: (event: string, payload: unknown, ack?: (res: any) => void) => void } | null;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const applyAvatar = useCallback(
    async (next: string) => {
      setError(null);
      setBusy(true);
      try {
        let avatar = await persistPlayerAvatarValue(next, { roomId, socket });
        if (signedIn && avatar !== undefined) {
          try {
            const { user } = await updatePlayerProfile({ avatar });
            avatar = user.avatar || avatar;
          } catch {
            /* socket/local already applied; profile sync is best-effort */
          }
        }
        writeGuestAvatar(avatar);
        onChange(avatar);
      } catch (e: any) {
        const msg = String(e?.message || 'Could not save avatar');
        setError(
          /cors|failed to fetch|network/i.test(msg)
            ? 'Could not reach the server to save that image. Try a preset, upload a file, or rejoin and try again.'
            : msg.replace(/^player-avatar:\s*/i, ''),
        );
      } finally {
        setBusy(false);
      }
    },
    [onChange, roomId, signedIn, socket],
  );

  const onFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file || disabled || busy) return;
      if (!file.type.startsWith('image/')) {
        setError('Choose an image file (PNG, JPEG, WebP, or GIF).');
        return;
      }
      try {
        const dataUrl = await compressImageFileToDataUrl(file);
        await applyAvatar(dataUrl);
      } catch (e: any) {
        setError(e?.message || 'Could not read image');
      }
    },
    [applyAvatar, busy, disabled],
  );

  const activePreset = parsePresetAvatarId(value);

  return (
    <div className="player-avatar-picker" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <PlayerAvatar avatar={value} name={name} size="lg" />
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          Pick a preset, drop a photo, or paste an image URL.
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          gap: 6,
        }}
      >
        {PLAYER_AVATAR_PRESETS.map((p) => {
          const selected = activePreset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled || busy}
              title={p.label}
              onClick={() => void applyAvatar(presetAvatarValue(p.id))}
              style={{
                border: selected ? '2px solid #f0c14b' : '1px solid rgba(255,255,255,0.18)',
                borderRadius: 10,
                background: selected ? 'rgba(240,193,75,0.15)' : 'rgba(0,0,0,0.25)',
                padding: '8px 4px',
                cursor: disabled || busy ? 'default' : 'pointer',
                fontSize: 20,
                lineHeight: 1,
              }}
            >
              <span aria-hidden>{p.glyph}</span>
            </button>
          );
        })}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          void onFile(f);
        }}
        style={{
          border: `1px dashed ${dragOver ? '#f0c14b' : 'rgba(255,255,255,0.25)'}`,
          borderRadius: 12,
          padding: 12,
          textAlign: 'center',
          background: dragOver ? 'rgba(240,193,75,0.08)' : 'rgba(0,0,0,0.2)',
          fontSize: 13,
        }}
      >
        <div style={{ marginBottom: 8 }}>Drop an image here, or</div>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'rgba(255,255,255,0.08)',
            color: 'inherit',
            cursor: disabled || busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Saving…' : 'Choose file'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            void onFile(f);
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="url"
          value={urlDraft}
          disabled={disabled || busy}
          placeholder="https://… image URL"
          onChange={(e) => setUrlDraft(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')?.trim();
            if (text && /^https?:\/\//i.test(text)) {
              // Keep default paste into the field; user can hit Apply.
            }
          }}
          style={{
            flex: '1 1 160px',
            minWidth: 0,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(0,0,0,0.35)',
            color: 'inherit',
          }}
        />
        <button
          type="button"
          disabled={disabled || busy || !urlDraft.trim()}
          onClick={() => void applyAvatar(urlDraft.trim())}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'rgba(255,255,255,0.08)',
            color: 'inherit',
            cursor: disabled || busy || !urlDraft.trim() ? 'default' : 'pointer',
          }}
        >
          Use URL
        </button>
        {value ? (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => void applyAvatar('')}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'transparent',
              color: 'inherit',
              opacity: 0.8,
              cursor: disabled || busy ? 'default' : 'pointer',
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {error ? (
        <div style={{ color: '#f5a9a9', fontSize: 12 }} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
