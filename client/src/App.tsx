import React, { useEffect, useState } from 'react';
import { Routes, Route, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, Shield, Crown, UserCircle, UserPlus, LogOut } from 'lucide-react';
import { API_BASE } from './config';
import { hostFetch, postHostLogout } from './utils/hostFetch';
import './App.css';

// Components
import Home from './components/Home';
import HostView from './components/HostView';
import PlayerView from './components/PlayerView';
import PublicDisplay from './components/PublicDisplay';
import SpotifyCallback from './components/SpotifyCallback';
import CallbackGoogle from './components/CallbackGoogle';
import AdminPage from './components/AdminPage';
import OrgPortalPage from './components/OrgPortalPage';
import './components/OrgPortalPage.css';
import DisplayHeaderInfo from './components/DisplayHeaderInfo';
import ErrorBoundary from './components/ErrorBoundary';
import HostYoutubePlaybackWindow from './components/HostYoutubePlaybackWindow';

/** Mirrors PublicDisplay venue state (dispatched via window event). */
type DisplayVenueBranding = {
  eventTitle?: string;
  sponsorLine?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
} | null;

const DISPLAY_VENUE_EVENT = 'tempo-display-venue-branding';

function AppHeader() {
  const location = useLocation();
  const [showAdminLink, setShowAdminLink] = useState(false);
  const [showOrgLink, setShowOrgLink] = useState(false);
  const [displayVenueBranding, setDisplayVenueBranding] = useState<DisplayVenueBranding>(null);
  const isDisplay = /^\/display(\/.+|$)/.test(location.pathname);
  const isHome = location.pathname === '/';
  const isHostEntry =
    isHome &&
    (location.search.includes('mode=host') || new URLSearchParams(location.search).get('host') === '1');

  useEffect(() => {
    const onBranding = (e: Event) => {
      const d = (e as CustomEvent<{ branding: DisplayVenueBranding }>).detail;
      setDisplayVenueBranding(d?.branding ?? null);
    };
    window.addEventListener(DISPLAY_VENUE_EVENT, onBranding as EventListener);
    return () => window.removeEventListener(DISPLAY_VENUE_EVENT, onBranding as EventListener);
  }, []);

  useEffect(() => {
    if (!isDisplay) setDisplayVenueBranding(null);
  }, [isDisplay]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [adminRes, authRes] = await Promise.all([
          hostFetch(`${API_BASE || ''}/api/admin/me`),
          hostFetch(`${API_BASE || ''}/api/auth/me`),
        ]);
        if (cancelled) return;
        if (adminRes.ok) {
          const adminData = (await adminRes.json()) as { admin?: boolean };
          setShowAdminLink(adminData.admin === true);
        } else {
          setShowAdminLink(false);
        }
        if (authRes.ok) {
          const authData = (await authRes.json()) as { user?: { id: number } | null };
          setShowOrgLink(!!authData.user);
        } else {
          setShowOrgLink(false);
        }
      } catch {
        if (!cancelled) {
          setShowAdminLink(false);
          setShowOrgLink(false);
        }
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
      <div className="header-content" style={isDisplay ? { width: 'auto', maxWidth: 'min(96vw, 1200px)' } : {}}>
        <div className={`logo${isDisplay ? ' logo--display-lockup' : ''}`}>
          <Sparkles className="logo-icon" />
          <h1>TEMPO</h1>
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
          {isDisplay &&
            displayVenueBranding &&
            (displayVenueBranding.eventTitle || displayVenueBranding.sponsorLine) && (
              <span className="app-header__display-co-brand" aria-label="Venue branding">
                <span className="app-header__display-co-divider" aria-hidden>
                  |
                </span>
                {displayVenueBranding.eventTitle ? (
                  <span className="app-header__display-co-text">{displayVenueBranding.eventTitle}</span>
                ) : null}
                {displayVenueBranding.sponsorLine ? (
                  <span className="app-header__display-co-sub">{displayVenueBranding.sponsorLine}</span>
                ) : null}
              </span>
            )}
        </div>
      </div>
      {!isDisplay && (
        <div
          className="app-header__trailing"
          style={{ position: 'absolute', right: '2rem', top: '50%', transform: 'translateY(-50%)', zIndex: 101 }}
        >
          {isHome ? (
            isHostEntry ? (
              <Link to="/" className="app-header__org-link" title="Join a game">
                <UserPlus size={16} aria-hidden className="app-header__org-icon" />
                <span>Join</span>
              </Link>
            ) : (
              <Link to="/?mode=host" className="app-header__org-link" title="Host a game">
                <Crown size={16} aria-hidden className="app-header__org-icon" />
                <span>Host</span>
              </Link>
            )
          ) : (
            <Link to="/" className="app-header__org-link" title="Join a game">
              <UserPlus size={16} aria-hidden className="app-header__org-icon" />
              <span>Join</span>
            </Link>
          )}
          {showOrgLink && (
            <Link to="/org" className="app-header__org-link" title="Account and billing">
              <UserCircle size={16} aria-hidden className="app-header__org-icon" />
              <span>Account</span>
            </Link>
          )}
          {showOrgLink && (
            <button
              type="button"
              className="app-header__org-link app-header__signout"
              title="Sign out of your Tempo host account"
              onClick={() => {
                if (window.confirm('Sign out of your Tempo host account?')) postHostLogout();
              }}
            >
              <LogOut size={16} aria-hidden className="app-header__org-icon" />
              <span>Sign out</span>
            </button>
          )}
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
  const isYoutubeHostPlayback = /^\/youtube-host-playback(\/.+|$)/.test(location.pathname);
  const isAdmin = location.pathname === '/admin';
  return (
    <div className="App">
      <div className="app-container">
        {/* Projector/display gets no site header — the splash's animated TEMPO balls carry the branding. */}
        {!isAdmin && !isYoutubeHostPlayback && !isDisplay && <AppHeader />}
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
              <Route path="/youtube-host-playback/:roomId" element={<HostYoutubePlaybackWindow />} />
              <Route path="/callback" element={<SpotifyCallback />} />
              <Route path="/callback-google" element={<CallbackGoogle />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/org" element={<OrgPortalPage />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default App;
