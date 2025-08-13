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

  if (!roomId) return null;

  const joinUrl = roomId
    ? (typeof window !== 'undefined' ? window.location.origin + '/player/' + roomId : '')
    : '';
  const qrPrimary = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(joinUrl)}`;
  const qrFallback = `https://chart.googleapis.com/chart?cht=qr&chs=120x120&chl=${encodeURIComponent(joinUrl)}`;

  return (
    <div className="room-info">
      <h2>Room: {roomId}</h2>
      <div className="player-count">
        <Users className="count-icon" />
        <span>{playerCount} Players</span>
      </div>
      <div className="qr-join">
        <img
          alt="Join QR"
          className="qr-img"
          src={qrPrimary}
          loading="lazy"
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (img.src !== qrFallback) {
              img.src = qrFallback;
            }
          }}
        />
      </div>
    </div>
  );
};

export default DisplayHeaderInfo;


