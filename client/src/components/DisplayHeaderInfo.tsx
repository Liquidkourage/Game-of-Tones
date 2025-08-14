import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Users } from 'lucide-react';

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
    const cardWidth = rect ? Math.floor(rect.width / 5.5) : 40;
    const containerStyle: React.CSSProperties = rect
      ? {
          position: 'fixed',
          top: 8,
          left: rect.left,
          width: rect.width,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
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
              textAlign: 'center',
              fontWeight: 800,
              letterSpacing: '1px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 8,
              padding: '6px 0'
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


