import React from 'react';
import {
  PLAYER_AVATAR_PRESETS,
  avatarHueFromName,
  avatarImageSrc,
  initialsFromName,
  parsePresetAvatarId,
} from '../utils/playerAvatars';

type Size = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<Size, number> = { sm: 28, md: 36, lg: 56 };

export default function PlayerAvatar({
  avatar,
  name,
  size = 'md',
  className = '',
  title,
}: {
  avatar?: string | null;
  name?: string | null;
  size?: Size;
  className?: string;
  title?: string;
}) {
  const px = SIZE_PX[size] || SIZE_PX.md;
  const presetId = parsePresetAvatarId(avatar);
  const preset = presetId ? PLAYER_AVATAR_PRESETS.find((p) => p.id === presetId) : null;
  const img = avatarImageSrc(avatar);
  const label = title || name || 'Player';
  const hue = avatarHueFromName(name);

  const baseStyle: React.CSSProperties = {
    width: px,
    height: px,
    minWidth: px,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
    fontWeight: 700,
    fontSize: Math.max(10, Math.round(px * 0.38)),
    lineHeight: 1,
    userSelect: 'none',
  };

  if (img) {
    return (
      <span
        className={`player-avatar player-avatar--img ${className}`.trim()}
        style={{ ...baseStyle, background: '#1a1a1a' }}
        title={label}
        aria-hidden
      >
        <img
          src={img}
          alt=""
          width={px}
          height={px}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }

  if (preset) {
    return (
      <span
        className={`player-avatar player-avatar--preset ${className}`.trim()}
        style={{
          ...baseStyle,
          background: `hsl(${hue} 42% 22%)`,
          fontSize: Math.max(14, Math.round(px * 0.55)),
        }}
        title={label}
        aria-hidden
      >
        {preset.glyph}
      </span>
    );
  }

  return (
    <span
      className={`player-avatar player-avatar--initials ${className}`.trim()}
      style={{
        ...baseStyle,
        background: `hsl(${hue} 48% 28%)`,
        color: 'rgba(255,255,255,0.92)',
      }}
      title={label}
      aria-hidden
    >
      {initialsFromName(name)}
    </span>
  );
}
