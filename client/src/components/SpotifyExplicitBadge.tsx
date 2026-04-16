import { useId } from 'react';

export type SpotifyExplicitBadgeSize = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<SpotifyExplicitBadgeSize, { w: number; h: number }> = {
  /** Playlist manager rows, compact chips */
  sm: { w: 22, h: 14 },
  /** Default: song list next to title */
  md: { w: 28, h: 18 },
  /** Inline help / legend */
  lg: { w: 34, h: 22 },
};

/**
 * Spotify-style explicit label: solid black rounded block with “E” as negative space
 * (background shows through the letter). Matches the in-app Spotify treatment.
 */
export function SpotifyExplicitBadge({
  size = 'md',
  title = 'Explicit content on Spotify',
  className,
}: {
  size?: SpotifyExplicitBadgeSize;
  title?: string;
  className?: string;
}) {
  const maskId = `spotify-explicit-${useId().replace(/:/g, '')}`;
  const { w, h } = SIZE_PX[size];
  const vbW = 18;
  const vbH = 12;

  return (
    <svg
      className={className}
      width={w}
      height={h}
      viewBox={`0 0 ${vbW} ${vbH}`}
      role="img"
      aria-label={title}
      style={{
        flexShrink: 0,
        verticalAlign: 'middle',
        filter:
          'drop-shadow(0 0 1px rgba(255,255,255,0.12)) drop-shadow(0 1px 3px rgba(0,0,0,0.75))',
      }}
    >
      <title>{title}</title>
      <defs>
        <mask id={maskId}>
          <rect width={vbW} height={vbH} rx="2.5" fill="white" />
          <text
            x={vbW / 2}
            y="9.45"
            textAnchor="middle"
            fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            fontSize="8.35"
            fontWeight={900}
            letterSpacing="-0.02em"
            fill="black"
          >
            E
          </text>
        </mask>
      </defs>
      <rect width={vbW} height={vbH} rx="2.5" fill="#000000" mask={`url(#${maskId})`} />
    </svg>
  );
}
