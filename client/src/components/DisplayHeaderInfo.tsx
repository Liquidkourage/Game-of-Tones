import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import io from 'socket.io-client';
import { SOCKET_URL } from '../config';
import { Users } from 'lucide-react';

const DisplayHeaderInfo: React.FC = () => {
  const location = useLocation();
  const match = location.pathname.match(/^\/display\/([^/]+)/);
  const roomId = match ? match[1] : null;
  const [playerCount, setPlayerCount] = useState<number>(0);

  useEffect(() => {
    if (!roomId) return;
    const socket = io(SOCKET_URL || undefined);
    socket.on('connect', () => {
      socket.emit('join-room', { roomId, playerName: 'DisplayHeader', isHost: false });
    });
    socket.on('player-joined', (data: any) => setPlayerCount(data.playerCount));
    socket.on('player-left', (data: any) => setPlayerCount(data.playerCount));
    return () => { socket.close(); };
  }, [roomId]);

  if (!roomId) return null;

  const joinUrl = typeof window !== 'undefined'
    ? window.location.origin + '/player/' + roomId
    : '';

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
          src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(joinUrl)}`}
        />
      </div>
    </div>
  );
};

export default DisplayHeaderInfo;


