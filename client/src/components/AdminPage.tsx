import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ArrowLeft, Loader2, Trash2, UserPlus } from 'lucide-react';
import { API_BASE } from '../config';
import { browserGoogleLoginUrl, hostFetch } from '../utils/hostFetch';

type AdminMe = {
  admin: boolean;
  adminConfigured: boolean;
  signedIn: boolean;
  email?: string | null;
  displayName?: string | null;
  allowlistMode: boolean;
  /** Server: TEMPO_APPROVED_HOSTS_ONLY — only allowlisted emails may host */
  approvedHostsOnly?: boolean;
};

type AllowRow = { email: string; created_at?: string };

const AdminPage: React.FC = () => {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<AllowRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshList = useCallback(async () => {
    setListError(null);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/admin/host-allowlist`);
      if (res.status === 401 || res.status === 403) {
        setRows([]);
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setListError((j && j.message) || `HTTP ${res.status}`);
        setRows(null);
        return;
      }
      const data = (await res.json()) as { emails?: AllowRow[] };
      setRows(Array.isArray(data.emails) ? data.emails : []);
    } catch (e) {
      setListError(String(e));
      setRows(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await hostFetch(`${API_BASE || ''}/api/admin/me`);
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(`Could not load admin status (${res.status}).`);
          setMe(null);
          return;
        }
        const data = (await res.json()) as AdminMe;
        setMe(data);
      } catch (e) {
        if (!cancelled) {
          setLoadError(String(e));
          setMe(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (me?.admin) void refreshList();
  }, [me?.admin, refreshList]);

  const addEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email.includes('@')) return;
    setBusy(true);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/admin/host-allowlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j && j.message) || `Could not add (${res.status})`);
        return;
      }
      setNewEmail('');
      void refreshList();
    } finally {
      setBusy(false);
    }
  };

  const removeEmail = async (email: string) => {
    if (!window.confirm(`Remove ${email} from the host allowlist?`)) return;
    setBusy(true);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/admin/host-allowlist`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j && j.message) || `Could not remove (${res.status})`);
        return;
      }
      void refreshList();
    } finally {
      setBusy(false);
    }
  };

  if (me === null && !loadError) {
    return (
      <div className="admin-page">
        <div className="admin-page__inner admin-page__loading">
          <Loader2 className="admin-page__spinner" aria-hidden />
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (loadError || !me) {
    return (
      <div className="admin-page">
        <div className="admin-page__inner">
          <p className="admin-page__error">{loadError || 'Unknown error.'}</p>
          <Link to="/" className="admin-page__back">
            <ArrowLeft size={18} aria-hidden /> Home
          </Link>
        </div>
      </div>
    );
  }

  if (!me.adminConfigured) {
    return (
      <div className="admin-page">
        <div className="admin-page__inner">
          <Shield className="admin-page__icon" aria-hidden />
          <h1 className="admin-page__title">Admin not configured</h1>
          <p className="admin-page__lead">
            The server needs <code>TEMPO_ADMIN_EMAILS</code> (your Google email, comma-separated) and/or{' '}
            <code>TEMPO_ADMIN_SECRET</code> before this page can be used.
          </p>
          <Link to="/" className="admin-page__back">
            <ArrowLeft size={18} aria-hidden /> Home
          </Link>
        </div>
      </div>
    );
  }

  if (!me.signedIn) {
    return (
      <div className="admin-page">
        <div className="admin-page__inner">
          <Shield className="admin-page__icon" aria-hidden />
          <h1 className="admin-page__title">Host admin</h1>
          <p className="admin-page__lead">Sign in with the Google account listed in <code>TEMPO_ADMIN_EMAILS</code>.</p>
          <a
            className="btn btn-primary admin-page__signin"
            href={browserGoogleLoginUrl()}
            onClick={() => {
              try {
                sessionStorage.setItem('tempo_post_auth_return', '/admin');
              } catch {
                /* ignore */
              }
            }}
          >
            Sign in with Google
          </a>
          <p className="admin-page__hint">
            After Google redirects back here, open <strong>/admin</strong> again.
          </p>
          <Link to="/" className="admin-page__back">
            <ArrowLeft size={18} aria-hidden /> Home
          </Link>
        </div>
      </div>
    );
  }

  if (!me.admin) {
    return (
      <div className="admin-page">
        <div className="admin-page__inner">
          <Shield className="admin-page__icon admin-page__icon--denied" aria-hidden />
          <h1 className="admin-page__title">Access denied</h1>
          <p className="admin-page__lead">
            Signed in as <strong>{me.email || 'unknown'}</strong>. This address is not in <code>TEMPO_ADMIN_EMAILS</code> on the
            server.
          </p>
          <Link to="/" className="admin-page__back">
            <ArrowLeft size={18} aria-hidden /> Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page__inner admin-page__inner--wide">
        <header className="admin-page__header">
          <Shield className="admin-page__icon admin-page__icon--ok" aria-hidden />
          <div>
            <h1 className="admin-page__title">Host allowlist</h1>
            <p className="admin-page__meta">
              Signed in as {me.displayName ? <strong>{me.displayName}</strong> : null}{' '}
              {me.email ? (
                <span className="admin-page__email">
                  ({me.email})
                </span>
              ) : null}
            </p>
          </div>
        </header>

        {me.approvedHostsOnly ? (
          <p className="admin-page__banner admin-page__banner--on">
            <strong>Approved hosts only</strong> — only emails below (or in <code>TEMPO_HOST_ALLOWLIST_EMAILS</code>) may sign in as
            hosts, create rooms, or run host controls. This is enforced server-wide.
          </p>
        ) : me.allowlistMode ? (
          <p className="admin-page__banner admin-page__banner--on">
            <strong>Legacy allowlist</strong> — <code>TEMPO_HOST_SIGNIN_MODE=allowlist</code> blocks <em>new</em> host accounts only.
            Prefer <code>TEMPO_APPROVED_HOSTS_ONLY=1</code> to require approval for everyone.
          </p>
        ) : (
          <p className="admin-page__banner admin-page__banner--off">
            <strong>Open hosting</strong> — set <code>TEMPO_APPROVED_HOSTS_ONLY=1</code> on the server so only allowlisted emails can
            host.
          </p>
        )}

        <form className="admin-page__add" onSubmit={(e) => void addEmail(e)}>
          <label htmlFor="admin-new-email" className="admin-page__label">
            Add email
          </label>
          <div className="admin-page__add-row">
            <input
              id="admin-new-email"
              type="email"
              className="input"
              placeholder="newhost@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="email"
              disabled={busy}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !newEmail.trim().includes('@')}>
              <UserPlus size={18} aria-hidden />
              Add
            </button>
          </div>
        </form>

        {listError && <p className="admin-page__error">{listError}</p>}

        <div className="admin-page__table-wrap">
          <h2 className="admin-page__h2">Allowed emails</h2>
          {rows === null ? (
            <p className="admin-page__muted">Loading list…</p>
          ) : rows.length === 0 ? (
            <p className="admin-page__muted">No entries yet. Add an email above.</p>
          ) : (
            <ul className="admin-page__list">
              {rows.map((r) => (
                <li key={r.email} className="admin-page__row">
                  <span className="admin-page__row-email">{r.email}</span>
                  <button
                    type="button"
                    className="admin-page__remove"
                    onClick={() => void removeEmail(r.email)}
                    disabled={busy}
                    aria-label={`Remove ${r.email}`}
                  >
                    <Trash2 size={18} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Link to="/" className="admin-page__back admin-page__back--footer">
          <ArrowLeft size={18} aria-hidden /> Back to home
        </Link>
      </div>
    </div>
  );
};

export default AdminPage;
