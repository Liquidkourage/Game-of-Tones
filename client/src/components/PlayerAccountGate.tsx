import React, { useState } from 'react';
import { API_BASE } from '../config';
import {
  PlayerAccountUser,
  PlayerStats,
  PlayerRoundHistory,
  playerFetch,
  setPlayerJwt,
} from '../utils/playerFetch';

type Mode = 'login' | 'signup' | 'guest';
export type PlayerUiTheme = 'dark' | 'light';

type Props = {
  onGuestContinue: (displayName: string) => void;
  onAccountReady: (user: PlayerAccountUser, stats: PlayerStats | null, recentRounds: PlayerRoundHistory[]) => void;
  initialMode?: Mode;
  theme?: PlayerUiTheme;
  onThemeChange?: (theme: PlayerUiTheme) => void;
};

const PlayerAccountGate: React.FC<Props> = ({
  onGuestContinue,
  onAccountReady,
  initialMode = 'login',
  theme = 'dark',
  onThemeChange,
}) => {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [guestName, setGuestName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const light = theme === 'light';

  const submitAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = mode === 'signup' ? '/api/player/signup' : '/api/player/login';
      const body =
        mode === 'signup'
          ? { email, password, displayName: displayName.trim() || undefined }
          : { email, password };
      const res = await playerFetch(`${API_BASE || ''}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((j && j.message) || `Could not ${mode === 'signup' ? 'sign up' : 'sign in'}`);
        return;
      }
      if (j.token) setPlayerJwt(String(j.token));
      if (j.user) onAccountReady(j.user, j.stats ?? null, j.recentRounds ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: light ? '1px solid rgba(15, 23, 42, 0.18)' : '1px solid rgba(255,255,255,0.25)',
    background: light ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.35)',
    color: light ? '#0f172a' : '#fff',
    boxSizing: 'border-box',
  };

  return (
    <div
      className={`player-account-gate${light ? ' player-account-gate--light' : ''}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: light ? 'rgba(244, 246, 251, 0.96)' : 'rgba(0,0,0,0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: 'min(92vw, 440px)',
          background: light ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.07)',
          border: light ? '1px solid rgba(15, 23, 42, 0.12)' : '1px solid rgba(255,255,255,0.16)',
          borderRadius: 16,
          padding: 20,
          color: light ? '#0f172a' : '#fff',
          boxShadow: light ? '0 16px 40px rgba(15, 23, 42, 0.12)' : undefined,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 6,
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1.35rem' }}>Join the game</h3>
          {onThemeChange ? (
            <div
              role="group"
              aria-label="Appearance"
              style={{
                display: 'inline-flex',
                gap: 4,
                padding: 3,
                borderRadius: 999,
                border: light ? '1px solid rgba(15,23,42,0.15)' : '1px solid rgba(255,255,255,0.2)',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                className={theme === 'dark' ? 'btn-primary' : 'btn-secondary'}
                aria-pressed={theme === 'dark'}
                onClick={() => onThemeChange('dark')}
                style={{ padding: '4px 10px', fontSize: '0.78rem' }}
              >
                Dark
              </button>
              <button
                type="button"
                className={theme === 'light' ? 'btn-primary' : 'btn-secondary'}
                aria-pressed={theme === 'light'}
                onClick={() => onThemeChange('light')}
                style={{ padding: '4px 10px', fontSize: '0.78rem' }}
              >
                Light
              </button>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, marginTop: 12 }}>
          {(['login', 'signup', 'guest'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'btn-primary' : 'btn-secondary'}
              style={{ flex: 1, textTransform: 'capitalize' }}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
            >
              {m === 'guest' ? 'Guest' : m === 'login' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

        {mode === 'guest' ? (
          <>
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem' }}>Display name</label>
            <input
              type="text"
              placeholder="Your name"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const name = guestName.trim();
                  if (name) onGuestContinue(name);
                }
              }}
              autoFocus
              style={inputStyle}
            />
            <button
              type="button"
              className="btn-primary"
              style={{ width: '100%', marginTop: 14 }}
              disabled={!guestName.trim()}
              onClick={() => onGuestContinue(guestName.trim())}
            >
              Continue as guest
            </button>
          </>
        ) : (
          <>
            {mode === 'signup' ? (
              <>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem' }}>Display name</label>
                <input
                  type="text"
                  placeholder="How hosts see you"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  style={{ ...inputStyle, marginBottom: 12 }}
                />
              </>
            ) : null}
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem' }}>Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ ...inputStyle, marginBottom: 12 }}
            />
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem' }}>Password</label>
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitAccount();
              }}
              style={inputStyle}
            />
            {error ? (
              <p
                style={{ color: light ? '#b91c1c' : '#ff8888', margin: '10px 0 0', fontSize: '0.9rem' }}
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className="btn-primary"
              style={{ width: '100%', marginTop: 14 }}
              disabled={busy || !email.trim() || password.length < 8}
              onClick={() => void submitAccount()}
            >
              {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
            <p style={{ margin: '12px 0 0', fontSize: '0.82rem', opacity: 0.7 }}>
              Password must be at least 8 characters.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default PlayerAccountGate;
