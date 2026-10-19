import React, { forwardRef } from 'react';

export type NightBoardPosterRow = {
  roundLabel: string;
  prize: string;
  winner: string;
};

type NightBoardPosterProps = {
  venueTitle?: string;
  roomId?: string;
  rows: NightBoardPosterRow[];
  /** ISO date label shown on the poster */
  dateLabel?: string;
};

/** Fixed Stories-friendly poster (1080×1350). Capture via html2canvas from a hidden mount. */
const NightBoardPoster = forwardRef<HTMLDivElement, NightBoardPosterProps>(
  function NightBoardPoster({ venueTitle, roomId, rows, dateLabel }, ref) {
    return (
      <div
        ref={ref}
        className="night-board-poster"
        style={{
          width: 1080,
          height: 1350,
          boxSizing: 'border-box',
          padding: '72px 64px 64px',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(165deg, #0a1210 0%, #101c18 45%, #0d1512 100%)',
          color: '#f2fff8',
          fontFamily:
            '"Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'rgba(93, 255, 192, 0.75)',
            marginBottom: 12,
          }}
        >
          TEMPO
        </div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 900,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#5dffc0',
            lineHeight: 1.05,
            marginBottom: 10,
            textShadow: '0 0 28px rgba(0, 255, 170, 0.25)',
          }}
        >
          Tonight&apos;s board
        </div>
        {(venueTitle || roomId || dateLabel) && (
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.62)',
              marginBottom: 40,
            }}
          >
            {[venueTitle, roomId ? `Room ${roomId}` : '', dateLabel].filter(Boolean).join(' · ')}
          </div>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 1.3fr 1.4fr',
            gap: 20,
            paddingBottom: 16,
            marginBottom: 20,
            borderBottom: '2px solid rgba(255,255,255,0.18)',
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.55)',
          }}
        >
          <span>Round</span>
          <span>Prize</span>
          <span style={{ textAlign: 'right' }}>Winner</span>
        </div>
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            flex: 1,
            minHeight: 0,
          }}
        >
          {rows.map((row, idx) => (
            <li
              key={`${row.roundLabel}-${idx}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.2fr 1.3fr 1.4fr',
                gap: 20,
                alignItems: 'center',
                padding: '22px 24px',
                borderRadius: 18,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(0,255,136,0.28)',
              }}
            >
              <span style={{ fontWeight: 800, fontSize: 28, lineHeight: 1.2 }}>{row.roundLabel}</span>
              <span style={{ fontWeight: 700, fontSize: 26, color: 'rgba(255,255,255,0.88)' }}>
                {row.prize}
              </span>
              <span
                style={{
                  fontWeight: 900,
                  fontSize: 30,
                  textAlign: 'right',
                  color: '#5dffc0',
                  lineHeight: 1.15,
                }}
              >
                {row.winner}
              </span>
            </li>
          ))}
        </ul>
        <div
          style={{
            marginTop: 28,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.4)',
            textAlign: 'center',
          }}
        >
          Game of Tones
        </div>
      </div>
    );
  },
);

export default NightBoardPoster;
