import React, { useEffect, useState } from 'react';
import { Routes, Route, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, Shield } from 'lucide-react';
import { API_BASE } from './config';
import { hostFetch } from './utils/hostFetch';
import './App.css';

// Components
import Home from './components/Home';
import HostView from './components/HostView';
import PlayerView from './components/PlayerView';
import PublicDisplay from './components/PublicDisplay';
import SpotifyCallback from './components/SpotifyCallback';
import CallbackGoogle from './components/CallbackGoogle';
import AdminPage from './components/AdminPage';
import DisplayHeaderInfo from './components/DisplayHeaderInfo';
import ErrorBoundary from './components/ErrorBoundary';

function AppHeader() {
  const location = useLocation();
  const [showAdminLink, setShowAdminLink] = useState(false);
  const isDisplay = /^\/display(\/.+|$)/.test(location.pathname);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await hostFetch(`${API_BASE || ''}/api/admin/me`);
        if (cancelled) return;
        if (!res.ok) {
          setShowAdminLink(false);
          return;
        }
        const data = (await res.json()) as { admin?: boolean };
        setShowAdminLink(data.admin === true);
      } catch {
        if (!cancelled) setShowAdminLink(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const headerStyle = isDisplay
    ? { 
        position: 'absolute' as const, 
        left: 0, 
        right: 0, 
        top: 8, 
        width: '100%', 
        background: 'transparent', 
        borderBottom: 'none', 
        padding: '0.4rem 0.8rem', 
        zIndex: 200, 
        pointerEvents: 'none' as const,
        display: 'flex',
        justifyContent: 'center'
      }
    : {};
  return (
    <motion.header
      className="app-header"
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      style={headerStyle}
    >
      <div className="header-content" style={isDisplay ? { width: 'auto' } : {}}>
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
      </div>
      {!isDisplay && (
        <div
          className="app-header__trailing"
          style={{ position: 'absolute', right: '2rem', top: '50%', transform: 'translateY(-50%)', zIndex: 101 }}
        >
          {showAdminLink && (
            <Link to="/admin" className="app-header__admin-link" title="Admin">
              <Shield size={16} aria-hidden className="app-header__admin-icon" />
              <span>Admin</span>
            </Link>
          )}
          <DisplayHeaderInfo />
        </div>
      )}
    </motion.header>
  );
}

function App() {
  const location = useLocation();
  const isDisplay = /^\/display(\/.+|$)/.test(location.pathname);
  const isAdmin = location.pathname === '/admin';
  return (
    <div className="App">
      <div className="app-container">
        {!isAdmin && <AppHeader />}
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
              <Route path="/callback-google" element={<CallbackGoogle />} />
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default App;
