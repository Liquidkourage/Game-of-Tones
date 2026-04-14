import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ArrowLeft, Loader2, Trash2, UserPlus, Copy, Check } from 'lucide-react';
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

type OrgRow = { id: number; name: string; spotify_client_id: string; created_at?: string };

type SpotifyTenantSetup = {
  spotifyDashboardUrl: string;
  redirectUris: { redirectUri: string; origin: string; label: string }[];
  orgEncryptionKeyConfigured: boolean;
};

type VenueForm = {
  eventTitle: string;
  sponsorLine: string;
  footerText: string;
  runbookUrl: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  defaultSnippetLength: string;
  volumeCap: string;
};

const emptyVenueForm = (): VenueForm => ({
  eventTitle: '',
  sponsorLine: '',
  footerText: '',
  runbookUrl: '',
  logoUrl: '',
  primaryColor: '',
  accentColor: '',
  defaultSnippetLength: '',
  volumeCap: '',
});

const AdminPage: React.FC = () => {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<AllowRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [orgClientId, setOrgClientId] = useState('');
  const [orgSecret, setOrgSecret] = useState('');
  const [assignUserId, setAssignUserId] = useState('');
  const [assignOrgId, setAssignOrgId] = useState('');
  const [spotifySetup, setSpotifySetup] = useState<SpotifyTenantSetup | null>(null);
  const [spotifySetupError, setSpotifySetupError] = useState<string | null>(null);
  const [copiedUri, setCopiedUri] = useState<string | null>(null);
  const [venueOrgId, setVenueOrgId] = useState('');
  const [venueForm, setVenueForm] = useState<VenueForm>(emptyVenueForm);
  const [venueError, setVenueError] = useState<string | null>(null);
  const [venueSavedAt, setVenueSavedAt] = useState<number | null>(null);
  const [venueLoading, setVenueLoading] = useState(false);

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

  const refreshOrgs = useCallback(async () => {
    setOrgError(null);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/admin/organizations`);
      if (res.status === 401 || res.status === 403) {
        setOrgs([]);
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setOrgError((j && j.message) || `HTTP ${res.status}`);
        setOrgs(null);
        return;
      }
      const data = (await res.json()) as { organizations?: OrgRow[] };
      setOrgs(Array.isArray(data.organizations) ? data.organizations : []);
    } catch (e) {
      setOrgError(String(e));
      setOrgs(null);
    }
  }, []);

  useEffect(() => {
    if (me?.admin) void refreshList();
  }, [me?.admin, refreshList]);

  useEffect(() => {
    if (me?.admin) void refreshOrgs();
  }, [me?.admin, refreshOrgs]);

  useEffect(() => {
    if (!me?.admin) return;
    let cancelled = false;
    (async () => {
      setSpotifySetupError(null);
      try {
        const res = await hostFetch(`${API_BASE || ''}/api/admin/spotify-tenant-setup`);
        if (cancelled) return;
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setSpotifySetupError((j && j.message) || `HTTP ${res.status}`);
          setSpotifySetup(null);
          return;
        }
        const data = (await res.json()) as SpotifyTenantSetup;
        setSpotifySetup(data);
      } catch (e) {
        if (!cancelled) {
          setSpotifySetupError(String(e));
          setSpotifySetup(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me?.admin]);

  const loadVenueForOrg = useCallback(async (id: string) => {
    if (!id.trim()) return;
    setVenueError(null);
    setVenueLoading(true);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/admin/organizations/${encodeURIComponent(id)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVenueError((j && j.message) || `HTTP ${res.status}`);
        setVenueForm(emptyVenueForm());
        return;
      }
      const vs = (j.organization && j.organization.venueSettings) || {};
      setVenueForm({
        eventTitle: String(vs.eventTitle || ''),
        sponsorLine: String(vs.sponsorLine || ''),
        footerText: String(vs.footerText || ''),
        runbookUrl: String(vs.runbookUrl || ''),
        logoUrl: String(vs.logoUrl || ''),
        primaryColor: String(vs.primaryColor || ''),
        accentColor: String(vs.accentColor || ''),
        defaultSnippetLength:
          vs.defaultSnippetLength != null && vs.defaultSnippetLength !== '' ? String(vs.defaultSnippetLength) : '',
        volumeCap: vs.volumeCap != null && vs.volumeCap !== '' ? String(vs.volumeCap) : '',
      });
    } catch (e) {
      setVenueError(String(e));
      setVenueForm(emptyVenueForm());
    } finally {
      setVenueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!me?.admin || !venueOrgId.trim()) return;
    void loadVenueForOrg(venueOrgId.trim());
  }, [me?.admin, venueOrgId, loadVenueForOrg]);

  const saveVenueSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = venueOrgId.trim();
    if (!id) return;
    setBusy(true);
    setVenueError(null);
    setVenueSavedAt(null);
    try {
      const dsl = venueForm.defaultSnippetLength.trim();
      const vc = venueForm.volumeCap.trim();
      const venueSettings: Record<string, unknown> = {
        eventTitle: venueForm.eventTitle.trim(),
        sponsorLine: venueForm.sponsorLine.trim(),
        footerText: venueForm.footerText.trim(),
        runbookUrl: venueForm.runbookUrl.trim(),
        logoUrl: venueForm.logoUrl.trim(),
        primaryColor: venueForm.primaryColor.trim(),
        accentColor: venueForm.accentColor.trim(),
      };
      if (dsl !== '') {
        const n = parseInt(dsl, 10);
        venueSettings.defaultSnippetLength = Number.isFinite(n) ? n : null;
      } else venueSettings.defaultSnippetLength = null;
      if (vc !== '') {
        const n = parseInt(vc, 10);
        venueSettings.volumeCap = Number.isFinite(n) ? n : null;
      } else venueSettings.volumeCap = null;
      const res = await hostFetch(`${API_BASE || ''}/api/admin/organizations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueSettings }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVenueError((j && j.message) || `Could not save (${res.status})`);
        return;
      }
      setVenueSavedAt(Date.now());
      void loadVenueForOrg(id);
    } finally {
      setBusy(false);
    }
  };

  const copyRedirectUri = async (uri: string) => {
    try {
      await navigator.clipboard.writeText(uri);
      setSpotifySetupError(null);
      setCopiedUri(uri);
      window.setTimeout(() => setCopiedUri((u) => (u === uri ? null : u)), 2000);
    } catch {
      setSpotifySetupError('Could not copy to clipboard (browser blocked).');
    }
  };

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

  const createOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = orgName.trim();
    const cid = orgClientId.trim();
    const sec = orgSecret.trim();
    if (!name || !cid || !sec) return;
    setBusy(true);
    setOrgError(null);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/admin/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, spotifyClientId: cid, spotifyClientSecret: sec }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOrgError((j && j.message) || `Could not create organization (${res.status})`);
        return;
      }
      setOrgName('');
      setOrgClientId('');
      setOrgSecret('');
      void refreshOrgs();
    } finally {
      setBusy(false);
    }
  };

  const assignUserOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    const uid = parseInt(assignUserId.trim(), 10);
    if (!Number.isFinite(uid)) return;
    const raw = assignOrgId.trim();
    const organizationId = raw === '' ? null : parseInt(raw, 10);
    if (organizationId != null && !Number.isFinite(organizationId)) return;
    setBusy(true);
    setOrgError(null);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/admin/users/${uid}/organization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOrgError((j && j.message) || `Could not assign (${res.status})`);
        return;
      }
      setAssignUserId('');
      setAssignOrgId('');
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
            <h1 className="admin-page__title">Admin</h1>
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

        <section className="admin-page__table-wrap admin-page__tenant-section" style={{ marginBottom: '2rem' }}>
          <h2 className="admin-page__h2">Tenant Spotify apps (enterprise)</h2>
          <p className="admin-page__muted" style={{ marginBottom: '0.75rem' }}>
            Each approved tenant uses their own Spotify Developer <strong>Client ID</strong> and <strong>Client Secret</strong>. Hosts
            without an organization still use the server&apos;s default <code>SPOTIFY_CLIENT_ID</code> /{' '}
            <code>SPOTIFY_CLIENT_SECRET</code>.
          </p>

          {spotifySetup && !spotifySetup.orgEncryptionKeyConfigured && (
            <p className="admin-page__banner admin-page__banner--on" style={{ marginBottom: '1rem' }}>
              <strong>Encrypt tenant secrets</strong> — set <code>TEMPO_ORG_CREDENTIALS_KEY</code> to 64 hex characters on the server
              before relying on stored tenant credentials.
            </p>
          )}

          {spotifySetupError && (
            <p className="admin-page__error" style={{ marginBottom: '0.5rem' }}>
              {spotifySetupError}
            </p>
          )}

          <details className="admin-page__tenant-guide" open>
            <summary className="admin-page__tenant-guide-summary">Step-by-step: Spotify app for a tenant</summary>
            <ol className="admin-page__tenant-steps">
              <li>
                Open the{' '}
                <a href={spotifySetup?.spotifyDashboardUrl || 'https://developer.spotify.com/dashboard'} target="_blank" rel="noreferrer">
                  Spotify Developer Dashboard
                </a>{' '}
                (tenant or your team signs in).
              </li>
              <li>
                Click <strong>Create app</strong>, name it, accept terms, then open the app&apos;s <strong>Settings</strong>.
              </li>
              <li>
                Under <strong>Redirect URIs</strong>, add <em>every</em> URI below that matches how users open this game (production
                and local dev if needed). Use <strong>Add</strong>, paste exactly, then <strong>Save</strong> at the bottom of the
                dashboard page.
              </li>
              <li>
                Copy the app&apos;s <strong>Client ID</strong> and <strong>Client secret</strong> (View client secret).
              </li>
              <li>
                In this admin page, create the tenant and paste those values. Then assign the host&apos;s numeric user id to that
                organization.
              </li>
              <li>
                The host opens a room and uses <strong>Connect Spotify</strong> again so tokens are issued for the tenant&apos;s app.
              </li>
            </ol>
            <div className="admin-page__tenant-uris">
              <p className="admin-page__muted admin-page__tenant-uris-lead">
                Register these redirect URIs in the tenant&apos;s Spotify app (exact match, including <code>https</code> and path):
              </p>
              {spotifySetup === null && !spotifySetupError && (
                <p className="admin-page__muted">Loading redirect URIs from server…</p>
              )}
              {spotifySetup &&
                spotifySetup.redirectUris.map((row) => (
                  <div key={row.redirectUri} className="admin-page__uri-row">
                    <code className="admin-page__uri-code" title={row.label}>
                      {row.redirectUri}
                    </code>
                    <button
                      type="button"
                      className="btn btn-secondary admin-page__copy-uri"
                      onClick={() => void copyRedirectUri(row.redirectUri)}
                      aria-label={`Copy ${row.redirectUri}`}
                    >
                      {copiedUri === row.redirectUri ? (
                        <>
                          <Check size={16} aria-hidden /> Copied
                        </>
                      ) : (
                        <>
                          <Copy size={16} aria-hidden /> Copy
                        </>
                      )}
                    </button>
                    <span className="admin-page__uri-label">{row.label}</span>
                  </div>
                ))}
            </div>
          </details>

          {orgError && <p className="admin-page__error">{orgError}</p>}
          <form className="admin-page__add" onSubmit={(e) => void createOrganization(e)} style={{ marginBottom: '1rem' }}>
            <div className="admin-page__add-row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <input
                type="text"
                className="input"
                placeholder="Organization name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                disabled={busy}
                style={{ minWidth: '140px' }}
              />
              <input
                type="text"
                className="input"
                placeholder="Spotify Client ID"
                value={orgClientId}
                onChange={(e) => setOrgClientId(e.target.value)}
                autoComplete="off"
                disabled={busy}
                style={{ minWidth: '180px' }}
              />
              <input
                type="password"
                className="input"
                placeholder="Spotify Client Secret"
                value={orgSecret}
                onChange={(e) => setOrgSecret(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
                style={{ minWidth: '180px' }}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !orgName.trim() || !orgClientId.trim() || !orgSecret.trim()}>
                Create tenant
              </button>
            </div>
          </form>
          <form className="admin-page__add" onSubmit={(e) => void assignUserOrganization(e)}>
            <label className="admin-page__label">Assign host user to tenant (numeric user id from DB / auth)</label>
            <div className="admin-page__add-row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <input
                type="text"
                inputMode="numeric"
                className="input"
                placeholder="User id"
                value={assignUserId}
                onChange={(e) => setAssignUserId(e.target.value)}
                disabled={busy}
                style={{ maxWidth: '120px' }}
              />
              <input
                type="text"
                inputMode="numeric"
                className="input"
                placeholder="Organization id (empty = default app)"
                value={assignOrgId}
                onChange={(e) => setAssignOrgId(e.target.value)}
                disabled={busy}
                style={{ minWidth: '220px' }}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !assignUserId.trim()}>
                Assign
              </button>
            </div>
          </form>
          {orgs === null ? (
            <p className="admin-page__muted">Loading organizations…</p>
          ) : orgs.length === 0 ? (
            <p className="admin-page__muted">No tenant Spotify apps yet.</p>
          ) : (
            <ul className="admin-page__list" style={{ marginTop: '0.75rem' }}>
              {orgs.map((o) => (
                <li key={o.id} className="admin-page__row">
                  <span className="admin-page__row-email">
                    <strong>#{o.id}</strong> {o.name} — client id {o.spotify_client_id?.slice(0, 8)}…
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-page__table-wrap" style={{ marginBottom: '2rem' }}>
          <h2 className="admin-page__h2">Venue &amp; corporate branding</h2>
          <p className="admin-page__muted" style={{ marginBottom: '0.75rem' }}>
            Saved per organization. Applies to player and public display when hosts in that org run a room (logo, colors, event copy,
            optional runbook link). Snippet length and volume cap are stored for future host defaults.
          </p>
          {venueError && <p className="admin-page__error">{venueError}</p>}
          {venueSavedAt != null && (
            <p className="admin-page__muted" style={{ marginBottom: '0.5rem' }}>
              Saved.
            </p>
          )}
          <form className="admin-page__add" onSubmit={(e) => void saveVenueSettings(e)}>
            <label className="admin-page__label" htmlFor="admin-venue-org">
              Organization
            </label>
            <div className="admin-page__add-row" style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <select
                id="admin-venue-org"
                className="input"
                value={venueOrgId}
                onChange={(e) => {
                  setVenueOrgId(e.target.value);
                  setVenueSavedAt(null);
                }}
                disabled={busy || venueLoading}
                style={{ minWidth: '220px' }}
              >
                <option value="">Select organization…</option>
                {(orgs || []).map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    #{o.id} {o.name}
                  </option>
                ))}
              </select>
              {venueLoading && (
                <span className="admin-page__muted" style={{ alignSelf: 'center' }}>
                  Loading…
                </span>
              )}
            </div>
            <div
              className="admin-page__venue-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '0.65rem',
                marginBottom: '0.75rem',
              }}
            >
              <input
                type="text"
                className="input"
                placeholder="Event title (headline)"
                value={venueForm.eventTitle}
                onChange={(e) => setVenueForm((f) => ({ ...f, eventTitle: e.target.value }))}
                disabled={busy || !venueOrgId}
              />
              <input
                type="text"
                className="input"
                placeholder="Sponsor line"
                value={venueForm.sponsorLine}
                onChange={(e) => setVenueForm((f) => ({ ...f, sponsorLine: e.target.value }))}
                disabled={busy || !venueOrgId}
              />
              <input
                type="url"
                className="input"
                placeholder="Logo URL (https)"
                value={venueForm.logoUrl}
                onChange={(e) => setVenueForm((f) => ({ ...f, logoUrl: e.target.value }))}
                disabled={busy || !venueOrgId}
              />
              <input
                type="text"
                className="input"
                placeholder="Primary color (#0d9488)"
                value={venueForm.primaryColor}
                onChange={(e) => setVenueForm((f) => ({ ...f, primaryColor: e.target.value }))}
                disabled={busy || !venueOrgId}
              />
              <input
                type="text"
                className="input"
                placeholder="Accent color (#14b8a6)"
                value={venueForm.accentColor}
                onChange={(e) => setVenueForm((f) => ({ ...f, accentColor: e.target.value }))}
                disabled={busy || !venueOrgId}
              />
              <input
                type="url"
                className="input"
                placeholder="Runbook / support URL"
                value={venueForm.runbookUrl}
                onChange={(e) => setVenueForm((f) => ({ ...f, runbookUrl: e.target.value }))}
                disabled={busy || !venueOrgId}
              />
              <input
                type="text"
                inputMode="numeric"
                className="input"
                placeholder="Default snippet length (sec)"
                value={venueForm.defaultSnippetLength}
                onChange={(e) => setVenueForm((f) => ({ ...f, defaultSnippetLength: e.target.value }))}
                disabled={busy || !venueOrgId}
              />
              <input
                type="text"
                inputMode="numeric"
                className="input"
                placeholder="Volume cap (1–100)"
                value={venueForm.volumeCap}
                onChange={(e) => setVenueForm((f) => ({ ...f, volumeCap: e.target.value }))}
                disabled={busy || !venueOrgId}
              />
            </div>
            <textarea
              className="input"
              placeholder="Footer / legal line (shown on player)"
              value={venueForm.footerText}
              onChange={(e) => setVenueForm((f) => ({ ...f, footerText: e.target.value }))}
              disabled={busy || !venueOrgId}
              rows={3}
              style={{ width: '100%', resize: 'vertical', marginBottom: '0.75rem' }}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !venueOrgId.trim()}>
              Save venue settings
            </button>
          </form>
        </section>

        <h2 className="admin-page__h2" style={{ marginBottom: '0.75rem' }}>
          Host allowlist
        </h2>

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
