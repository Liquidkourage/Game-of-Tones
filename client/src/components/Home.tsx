import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { 
  Music, 
  Users, 
  Gamepad2, 
  Sparkles, 
  Play, 
  UserPlus, 
  Volume2,
  Crown,
  Trophy,
  Zap
} from 'lucide-react';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');

  const generateRoomId = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(id);
  };

  const startHosting = () => {
    if (!playerName.trim()) {
      alert('Please enter your name!');
      return;
    }
    const id = roomId || Math.random().toString(36).substring(2, 8).toUpperCase();
    navigate(`/host/${id}?name=${encodeURIComponent(playerName)}`);
  };

  const joinGame = () => {
    if (!playerName.trim() || !roomId.trim()) {
      alert('Please enter both your name and room ID!');
      return;
    }
    navigate(`/player/${roomId}?name=${encodeURIComponent(playerName)}`);
  };

  return (
    <div className="home-container">
      {/* Hero Section */}
      <motion.div 
        className="hero-section"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <div className="hero-content">
          <motion.div 
            className="hero-title"
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Sparkles className="hero-icon" />
            <h1>Game of Tones</h1>
            <p className="hero-subtitle">Where Music Meets Bingo</p>
          </motion.div>

          <motion.div 
            className="hero-features"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
          >
            <div className="feature">
              <Music className="feature-icon" />
              <span>Spotify Integration</span>
            </div>
            <div className="feature">
              <Users className="feature-icon" />
              <span>Multiplayer</span>
            </div>
            <div className="feature">
              <Gamepad2 className="feature-icon" />
              <span>Real-time Gaming</span>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Game Options */}
      <motion.div 
        className="game-options"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.6 }}
      >
        <div className="options-grid">
          {/* Host Game */}
          <motion.div 
            className="option-card host-card"
            whileHover={{ scale: 1.05, y: -10 }}
            whileTap={{ scale: 0.95 }}
          >
            <div className="card-header">
              <Crown className="card-icon" />
              <h3>Host a Game</h3>
            </div>
            <p>Create a new music bingo session and control the playlist</p>
            
            <div className="input-group">
              <input
                type="text"
                placeholder="Your name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="input"
              />
            </div>

            <div className="input-group">
              <input
                type="text"
                placeholder="Room ID (optional)"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="input"
              />
              <button 
                onClick={generateRoomId}
                className="btn btn-secondary"
              >
                Generate
              </button>
            </div>

            <button 
              onClick={startHosting}
              className="btn btn-primary"
            >
              <Play className="btn-icon" />
              Start Hosting
            </button>
          </motion.div>

          {/* Join Game */}
          <motion.div 
            className="option-card join-card"
            whileHover={{ scale: 1.05, y: -10 }}
            whileTap={{ scale: 0.95 }}
          >
            <div className="card-header">
              <UserPlus className="card-icon" />
              <h3>Join a Game</h3>
            </div>
            <p>Join an existing game with the room code</p>
            
            <div className="input-group">
              <input
                type="text"
                placeholder="Your name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="input"
              />
            </div>

            <div className="input-group">
              <input
                type="text"
                placeholder="Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="input"
              />
            </div>

            <button 
              onClick={joinGame}
              className="btn btn-pink"
            >
              <UserPlus className="btn-icon" />
              Join Game
            </button>
          </motion.div>
        </div>
      </motion.div>

      {/* Features Section */}
      <motion.div 
        className="features-section"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.8 }}
      >
        <h2>Game Features</h2>
        <div className="features-grid">
          <div className="feature-card">
            <Volume2 className="feature-card-icon" />
            <h4>Spotify Premium</h4>
            <p>Connect your Spotify Premium account for seamless music playback</p>
          </div>
          <div className="feature-card">
            <Trophy className="feature-card-icon" />
            <h4>Smart Bingo</h4>
            <p>Automatic bingo detection with manual host verification</p>
          </div>
          <div className="feature-card">
            <Zap className="feature-card-icon" />
            <h4>Real-time Updates</h4>
            <p>Live game updates and player synchronization</p>
          </div>
        </div>
      </motion.div>

      {/* How to Play */}
      <motion.div 
        className="how-to-play"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.0 }}
      >
        <h2>How to Play</h2>
        <div className="steps-grid">
          <div className="step">
            <div className="step-number">1</div>
            <h4>Host Creates Game</h4>
            <p>Host selects 5 playlists with 15+ songs each or 1 playlist with 75+ songs</p>
          </div>
          <div className="step">
            <div className="step-number">2</div>
            <h4>Players Join</h4>
            <p>Players join with room code and get unique bingo cards</p>
          </div>
          <div className="step">
            <div className="step-number">3</div>
            <h4>Music Plays</h4>
            <p>Host plays random song snippets from the selected playlists</p>
          </div>
          <div className="step">
            <div className="step-number">4</div>
            <h4>Mark & Win</h4>
            <p>Players mark matching songs on their cards and call BINGO!</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default Home; 