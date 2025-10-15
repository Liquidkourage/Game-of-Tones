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
import ErrorBoundary from './components/ErrorBoundary';

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
          <span style={{ 
            marginLeft: 12, 
            fontSize: '1.35rem', 
            fontStyle: 'italic', 
            fontWeight: 700, 
            color: '#b3b3b3', 
            letterSpacing: '0.02em',
            lineHeight: '1.1',
            display: 'inline-block',
            maxWidth: '180px', /* Adjust max width for smaller text */
            alignSelf: 'flex-end' /* Align to bottom of the logo */
          }}>by Liquid Kourage</span>
        </div>
        <DisplayHeaderInfo />
      </div>
    </motion.header>
  );
}

function App() {
  const location = useLocation();
  const isDisplay = /^\/display(\/.+|$)/.test(location.pathname);
  return (
    <div className="App">
      <div className="app-container">
        <AppHeader />
        {isDisplay && <div style={{ height: 73 }} />}
        <main className="app-main">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/host/:roomId" element={
                <ErrorBoundary fallback={
                  <div style={{ padding: '20px', textAlign: 'center', color: '#ff4444' }}>
                    <h2>Host View Error</h2>
                    <p>Unable to load host controls. Please refresh the page.</p>
                  </div>
                }>
                  <HostView />
                </ErrorBoundary>
              } />
              <Route path="/player/:roomId" element={
                <ErrorBoundary fallback={
                  <div style={{ padding: '20px', textAlign: 'center', color: '#ff4444' }}>
                    <h2>Player View Error</h2>
                    <p>Unable to load player view. Please refresh the page.</p>
                  </div>
                }>
                  <PlayerView />
                </ErrorBoundary>
              } />
              <Route path="/display" element={<PublicDisplay />} />
              <Route path="/display/:roomId" element={<PublicDisplay />} />
              <Route path="/callback" element={<SpotifyCallback />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default App;
