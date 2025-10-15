import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const DisplayHeaderInfo: React.FC = () => {
  const location = useLocation();
  const match = location.pathname.match(/^\/display\/([^/]+)/);
  const roomId = match ? match[1] : null;
  const [playerCount, setPlayerCount] = useState<number>(0);
  const [pattern, setPattern] = useState<string>('full_card');

  // Listen for player count and pattern updates forwarded by PublicDisplay
  useEffect(() => {
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
    const cardWidth = Math.max(0, Math.floor(baseWidth * 1.1) - 12); // shrink each by additional 11px total
    const prettyPattern = pattern === 'line' ? 'Single Line' : pattern === 'four_corners' ? 'Four Corners' : pattern === 'x' ? 'X' : pattern === 'full_card' ? 'Full Card' : 'Custom';
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

    // For full card pattern, don't show any top indicators
    if (pattern === 'full_card') {
      return null;
    }
    
    // For other patterns, don't show any top indicators (BINGO letters now inline with categories)
    return null;
  }
  return null;
};

export default DisplayHeaderInfo;


