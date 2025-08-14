import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const DisplayHeaderInfo: React.FC = () => {
  const location = useLocation();
  const match = location.pathname.match(/^\/display\/([^/]+)/);
  const roomId = match ? match[1] : null;
  const [playerCount, setPlayerCount] = useState<number>(0);

  // Listen for player count forwarded by PublicDisplay to avoid opening a second socket
  useEffect(() => {
    const handler = (e: Event) => {
      const anyEvent = e as CustomEvent<{ playerCount: number }>;
      if (typeof anyEvent.detail?.playerCount === 'number') {
        setPlayerCount(anyEvent.detail.playerCount);
      }
    };
    window.addEventListener('display-player-count', handler as EventListener);
    return () => window.removeEventListener('display-player-count', handler as EventListener);
  }, []);

  // For the public display header, render BINGO column headers to free vertical space below
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    if (!roomId) return;
    const update = () => {
      const el = document.querySelector('.call-list-display') as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ left: Math.round(r.left), width: Math.round(r.width) });
      }
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    const id = window.setInterval(update, 500);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.clearInterval(id);
    };
  }, [roomId]);

  if (roomId) {
    const gap = 5;
    const baseWidth = rect ? (rect.width - gap * 4) / 5 : 40;
    const cardWidth = Math.floor(baseWidth * 1.1);
    const containerStyle: React.CSSProperties = rect
      ? {
          position: 'fixed',
          top: 0,
          left: Math.max(rect.left - 9, 0),
          width: rect.width,
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
          gap,
          pointerEvents: 'none',
          zIndex: 250,
        }
      : { display: 'none' };

    return (
      <div className="bingo-header" style={containerStyle}>
        {['B', 'I', 'N', 'G', 'O'].map((c) => (
          <div
            key={c}
            style={{
              width: cardWidth,
              height: rect ? Math.max(0, ((document.querySelector('.app-header') as HTMLElement)?.getBoundingClientRect().bottom || 40) - 5) : undefined,
              textAlign: 'center',
              fontWeight: 900,
              letterSpacing: '0.08em',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.6rem'
            }}
          >
            {c}
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default DisplayHeaderInfo;


