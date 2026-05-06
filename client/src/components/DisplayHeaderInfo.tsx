import { useEffect, useState, type FC } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Listens for display forwards from PublicDisplay. Header chrome for `/display/:roomId` is intentionally
 * minimal — pattern-specific hints render inline on the main display.
 */
const DisplayHeaderInfo: FC = () => {
  const location = useLocation();
  const match = location.pathname.match(/^\/display\/([^/]+)/);
  const roomId = match ? match[1] : null;

  const [, setPlayerCount] = useState(0);
  const [, setPattern] = useState<string>('full_card');

  useEffect(() => {
    if (!roomId) return;
    const playerCountHandler = (e: Event) => {
      const anyEvent = e as CustomEvent<{ playerCount: number }>;
      if (typeof anyEvent.detail?.playerCount === 'number') {
        setPlayerCount(anyEvent.detail.playerCount);
      }
    };

    const patternHandler = (e: Event) => {
      const anyEvent = e as CustomEvent<{ pattern: string }>;
      if (typeof anyEvent.detail?.pattern === 'string') {
        setPattern(anyEvent.detail.pattern);
      }
    };

    window.addEventListener('display-player-count', playerCountHandler as EventListener);
    window.addEventListener('display-pattern', patternHandler as EventListener);

    return () => {
      window.removeEventListener('display-player-count', playerCountHandler as EventListener);
      window.removeEventListener('display-pattern', patternHandler as EventListener);
    };
  }, [roomId]);

  return null;
};

export default DisplayHeaderInfo;
