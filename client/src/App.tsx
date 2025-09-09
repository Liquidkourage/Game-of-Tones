import React from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
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
  const isDisplay = /^\/display(\/.+|$)/.test(location.pathname);
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
          <h1>TEMPO - Music Bingo</h1>
          <span style={{ marginLeft: 12, fontSize: '1.05rem', fontStyle: 'italic', fontWeight: 700, color: '#b3b3b3', letterSpacing: '0.02em' }}>by Liquid Kourage Entertainment</span>
        </div>
        <DisplayHeaderInfo />
      </div>
    </motion.header>
  );
}

function App() {
  const location = useLocation();
  const isDisplay = /^\/display(\/.+|$)/.test(location.pathname);
  const isPlayer = /^\/player(\/.+|$)/.test(location.pathname);
  return (
    <div className="App">
      <div className="app-container">
        <AppHeader />
        {isDisplay && <div style={{ height: 73 }} />}
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/host/:roomId" element={<HostView />} />
            <Route path="/player/:roomId" element={<PlayerView />} />
            <Route path="/display" element={<PublicDisplay />} />
            <Route path="/display/:roomId" element={<PublicDisplay />} />
            <Route path="/callback" element={<SpotifyCallback />} />
          </Routes>
        </main>
        {!isPlayer && (
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
              <div style={{ marginLeft: 'auto', color: '#777', fontSize: '0.8rem' }}>Build: {process.env.REACT_APP_BUILD_ID || 'dev'}</div>
            </div>
          </motion.footer>
        )}
      </div>
    </div>
  );
}

export default App;
