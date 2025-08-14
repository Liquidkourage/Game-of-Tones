import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Music, Users, Gamepad2, Sparkles } from 'lucide-react';
import './App.css';

// Components
import Home from './components/Home';
import HostView from './components/HostView';
import PlayerView from './components/PlayerView';
import PublicDisplay from './components/PublicDisplay';
import SpotifyCallback from './components/SpotifyCallback';
import DisplayHeaderInfo from './components/DisplayHeaderInfo';

function AppHeader() {
  const location = useLocation();
  const isDisplay = /^\/display\//.test(location.pathname);
  const headerStyle = isDisplay
    ? { position: 'absolute' as const, left: 12, top: 8, width: 'auto', background: 'transparent', borderBottom: 'none', padding: '0.4rem 0.8rem', zIndex: 200, pointerEvents: 'none' as const }
    : {};
  return (
    <motion.header
      className="app-header"
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      style={headerStyle}
    >
      <div className="header-content">
        <div className="logo">
          <Sparkles className="logo-icon" />
          <h1>Game of Tones</h1>
        </div>
        <DisplayHeaderInfo />
      </div>
    </motion.header>
  );
}

function App() {
  return (
    <div className="App">
      <Router>
        <div className="app-container">
          <AppHeader />
          <main className="app-main">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/host/:roomId" element={<HostView />} />
              <Route path="/player/:roomId" element={<PlayerView />} />
              <Route path="/display/:roomId" element={<PublicDisplay />} />
              <Route path="/callback" element={<SpotifyCallback />} />
            </Routes>
          </main>
          <motion.footer
            className="app-footer"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
          >
            <div className="footer-content">
              <p>🎵 Where Music Meets Bingo 🎵</p>
              <div className="footer-links">
                <a href="#" className="footer-link">About</a>
                <a href="#" className="footer-link">Help</a>
                <a href="#" className="footer-link">Contact</a>
              </div>
            </div>
          </motion.footer>
        </div>
      </Router>
    </div>
  );
}

export default App;
