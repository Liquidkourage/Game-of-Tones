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
  if (roomId) {
    return (
      <div
        className="bingo-header"
        style={{
          position: 'absolute',
          top: 8,
          left: 'calc(30vw + 24px)',
          right: 12,
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 8,
          pointerEvents: 'none'
        }}
      >
        {['B','I','N','G','O'].map((c) => (
          <div
            key={c}
            style={{
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


