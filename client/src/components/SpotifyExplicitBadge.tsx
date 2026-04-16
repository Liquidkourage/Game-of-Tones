export type SpotifyExplicitBadgeSize = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<SpotifyExplicitBadgeSize, { w: number; h: number }> = {
  /** Playlist manager rows, compact chips */
  sm: { w: 22, h: 14 },
  /** Default: song list next to title */
  md: { w: 28, h: 18 },
  /** Inline help / legend */
  lg: { w: 34, h: 22 },
};

/** Light gray rounded square with dark “E” — matches Spotify’s explicit label (positive space). */
const BG = '#b3b3b3';
const FG = '#121212';

/**
 * Spotify-style explicit label: light block, bold dark E (same visual language as Spotify’s icon).
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
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
      }}
    >
      <title>{title}</title>
      <rect
        width={vbW}
        height={vbH}
        rx="2.5"
        fill={BG}
        stroke="rgba(0,0,0,0.18)"
        strokeWidth="0.35"
      />
      <text
        x={vbW / 2}
        y="9.45"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        fontSize="8.35"
        fontWeight={900}
        letterSpacing="-0.02em"
        fill={FG}
      >
        E
      </text>
    </svg>
  );
}
