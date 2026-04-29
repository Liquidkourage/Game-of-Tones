const SpotifyWebApi = require('spotify-web-api-node');
const https = require('https');
const pl = require('./spotifyPipelineLog');
const webApi = require('./spotifyWebApiMeter');

/**
 * Web API base URL and path shapes follow the official OpenAPI schema:
 * https://developer.spotify.com/reference/web-api/open-api-schema.yaml
 * Playlist track listings use GET /v1/playlists/{playlist_id}/items (not legacy /tracks-only helpers).
 *
 * Universal Spotify playlist name prefix for GOT output / temp setlists.
 * createTemporaryPlaylist, createOutputPlaylist, got-playlists cleanup, and
 * delete-playlists (when validated) must all use this — do not duplicate the string elsewhere.
 */
const GOT_OUTPUT_PLAYLIST_NAME_PREFIX = 'Game Of Tones Output - ';

/**
 * Spotify sends Retry-After from seconds (often 1) up to 86400+ when rate-limiting.
 * Capping quarantine too low (historically 8 min) caused TEMPO to resume Web API calls while Spotify
 * was still throttling → repeated 429s and escalating Retry-After (hours). Default: honor up to 24h.
 * Set SPOTIFY_QUARANTINE_MAX_MS=28800000 for 8h, or SPOTIFY_QUARANTINE_MAX_MS=480000 for 8min (debug only).
 */
function readSpotifyQuarantineMaxMs() {
  const raw = process.env.SPOTIFY_QUARANTINE_MAX_MS;
  if (raw === '0' || raw === '') return 24 * 60 * 60 * 1000;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 60_000) return 24 * 60 * 60 * 1000;
  return Math.min(48 * 60 * 60 * 1000, n);
}
const SPOTIFY_QUARANTINE_MAX_MS = readSpotifyQuarantineMaxMs();

/** Suppress routine Spotify success logs when MISSION_CRITICAL_LOGS=1; keep console.error (incl. [SPOTIFY_429_DIAGNOSTIC]). */
function missionCriticalLogsOnlySpotify() {
  const v = process.env.MISSION_CRITICAL_LOGS;
  return v === '1' || String(v || '').toLowerCase() === 'true';
}
function routineSpotifyLog(...args) {
  if (missionCriticalLogsOnlySpotify()) return;
  console.log(...args);
}

/** Full getPlaylistTracks() results, reused when the host loads tracks then finalizes (halves /items load). */
const PLAYLIST_TRACKS_CACHE_TTL_MS = 25 * 60 * 1000;

/** After any 429 quarantine, multiply pacing interval briefly so we ease back into traffic. */
const SPOTIFY_POST_429_PACING_BOOST_MS = 3 * 60 * 1000;
const SPOTIFY_POST_429_PACING_MULTIPLIER = 2;

/** GET …/playlists/{id}/items — Spotify OpenAPI `QueryLimit` maximum is 50 (shared parameter). */
const PLAYLIST_ITEMS_PAGE_LIMIT_MAX = 50;

/** DELETE /v1/me/library — max playlist (and other) URIs per request (OpenAPI). */
const LIBRARY_DELETE_URIS_MAX = 40;

/**
 * Code-path label → likely Spotify REST target (429 diagnostics). Raw HTTP calls also pass httpMethod+httpPath in meta.
 */
const SPOTIFY_SOURCE_ROUTE_HINT = {
  getUserPlaylists: 'GET /v1/me/playlists',
  getPlaylistItems: 'GET /v1/playlists/{playlist_id}/items',
  getPlaylistSnapshot: 'GET /v1/playlists/{playlist_id}?fields=snapshot_id',
  getPlaylistMetadataBrief: 'GET /v1/playlists/{playlist_id}',
  getPlaylistTracks: 'GET /v1/playlists/{playlist_id}/items (paginated)',
  removePlaylistLibrary: 'DELETE /v1/me/library',
  getCurrentUserProfileBrief: 'GET /v1/me',
  getCurrentPlaybackState: 'GET /v1/me/player',
  startPlayback: 'PUT /v1/me/player/play',
  pausePlayback: 'PUT /v1/me/player/pause',
  transferPlayback: 'PUT /v1/me/player',
  resumePlayback: 'PUT /v1/me/player/play',
  nextTrack: 'POST /v1/me/player/next',
  previousTrack: 'POST /v1/me/player/previous',
  getUserDevices: 'GET /v1/me/player/devices',
  getCurrentTrack: 'GET /v1/me/player/currently-playing',
  searchPlaylists: 'GET /v1/search (type=playlist)',
  searchTracks: 'GET /v1/search (type=track)',
  setVolume: 'PUT /v1/me/player/volume',
  seekToPosition: 'PUT /v1/me/player/seek',
  setShuffleState: 'PUT /v1/me/player/shuffle',
  setRepeatState: 'PUT /v1/me/player/repeat',
  createTemporaryPlaylist: 'POST /v1/me/playlists + …/items',
  createOutputPlaylist: 'POST /v1/me/playlists + …/items',
  getGameOfTonesPlaylists: 'GET /v1/me/playlists',
  startPlaybackFromPlaylist: 'PUT /v1/me/player/play (context_uri)',
  addToQueue: 'POST /v1/me/player/queue',
  getCurrentUserProfile: 'GET /v1/me',
  addTracksToPlaylist: 'POST /v1/playlists/{playlist_id}/items',
  removeTracksFromPlaylist: 'DELETE /v1/playlists/{playlist_id}/items',
  replaceTrackInPlaylist: 'DELETE+POST /v1/playlists/{playlist_id}/items',
  _transferPlaybackDirect: 'PUT /v1/me/player',
};

/** @param {Record<string, string>} h */
function spotifyPickDiagnosticHeaders(h) {
  if (!h || typeof h !== 'object') return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const k of ['retry-after', 'Retry-After', 'x-request-id', 'spotify-correlation-id']) {
    if (h[k] != null && String(h[k]).trim() !== '') {
      out[k] = String(h[k]).slice(0, 220);
    }
  }
  return out;
}

/** @param {string} pathWithQuery */
function spotifyTruncateApiPath(pathWithQuery, max = 900) {
  const s = String(pathWithQuery || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * @param {string} source
 * @param {{ httpMethod?: string, httpPath?: string }} [meta]
 */
function inferSpotify429Route(source, meta) {
  if (meta && meta.httpMethod && meta.httpPath) {
    const q = spotifyTruncateApiPath(meta.httpPath);
    return `${String(meta.httpMethod).toUpperCase()} https://api.spotify.com${q}`;
  }
  const s = String(source || 'unknown');
  if (s.startsWith('withRetries:')) {
    const inner = s.slice('withRetries:'.length);
    const hint = SPOTIFY_SOURCE_ROUTE_HINT[inner];
    return hint ? `retry_wrap:${hint}` : `retry_wrap:${inner}`;
  }
  const baseLabel = s.includes(':') ? s.split(':')[0] : s;
  return SPOTIFY_SOURCE_ROUTE_HINT[baseLabel] || SPOTIFY_SOURCE_ROUTE_HINT[s] || `unmapped_source:${s}`;
}

/** Extra pause between GET …/items pages inside one playlist (reduces burst 429s). */
function readPlaylistItemsPageGapMs() {
  const raw = process.env.SPOTIFY_PLAYLIST_ITEMS_PAGE_GAP_MS;
  const n = parseInt(raw != null && raw !== '' ? raw : '400', 10);
  if (!Number.isFinite(n) || n < 0) return 400;
  return Math.min(5000, n);
}
const PLAYLIST_ITEMS_PAGE_GAP_MS = readPlaylistItemsPageGapMs();

/**
 * February 2026 Web API (Development Mode) — Search endpoint limits.
 * @see https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
 */
const SPOTIFY_SEARCH_LIMIT_DEFAULT = 5;
const SPOTIFY_SEARCH_LIMIT_MAX = 10;

function clampSearchLimit(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return SPOTIFY_SEARCH_LIMIT_DEFAULT;
  const v = Math.floor(Number(n));
  return Math.max(1, Math.min(SPOTIFY_SEARCH_LIMIT_MAX, v));
}

function normalizeSearchOffset(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return 0;
  return Math.max(0, Math.floor(Number(n)));
}

/**
 * Minimum ms between *starts* of api.spotify.com calls for one SpotifyService (one user token).
 * Serializes traffic to avoid bursty parallel requests — the main avoidable cause of 429.
 * SPOTIFY_WEB_API_MIN_INTERVAL_MS=0 disables (emergency only).
 * Default 550 (~1.8 req/s max for that user from this process).
 */
function readWebApiPacingMinMs() {
  const raw = process.env.SPOTIFY_WEB_API_MIN_INTERVAL_MS;
  if (raw === '0') return 0;
  const n = parseInt(raw != null && raw !== '' ? raw : '550', 10);
  if (!Number.isFinite(n) || n < 0) return 550;
  return Math.min(10_000, n);
}

class SpotifyService {
  /**
   * @param {undefined | null | { clientId: string; clientSecret: string }} options - If object with id+secret, use tenant's Spotify Developer app; else env SPOTIFY_*.
   */
  constructor(options) {
    this.defaultRedirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:7094/callback';
    const override =
      options &&
      typeof options === 'object' &&
      typeof options.clientId === 'string' &&
      options.clientId &&
      typeof options.clientSecret === 'string' &&
      options.clientSecret;
    this.spotifyApi = new SpotifyWebApi({
      clientId: override ? options.clientId : process.env.SPOTIFY_CLIENT_ID,
      clientSecret: override ? options.clientSecret : process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: this.defaultRedirectUri,
    });
    this._wrapSpotifyWebApiForMeter();
    const cidForLog = override ? options.clientId : process.env.SPOTIFY_CLIENT_ID;
    this._pipelineClientIdPrefix = pl.clientIdPrefix(cidForLog);
    this._pipelineCredentialMode = override ? 'organization_client' : 'env_client';

    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpirationTime = null;
    /** Last successful /v1/me/player body — reused during 429 backoff. */
    this._lastPlaybackStateCache = null;
    this._playbackStateBackoffUntil = 0;
    this._playbackState429Streak = 0;
    /** True when getCurrentPlaybackState returned null only because of 429 and no cache yet. */
    this._playbackNullDueToRateLimit = false;
    /** When > Date.now(), skip Spotify Web API calls (429 with Retry-After, often 24h for restricted apps). */
    this._spotifyQuarantineUntil = 0;
    this._lastGlobal429LogAt = 0;
    /** Last 429: which API path / label, Spotify Retry-After (seconds), effective cooldown (seconds, capped), uncapped. */
    this._quarantineSource = null;
    this._quarantineSpotifyRetryAfterSec = null;
    this._quarantineEffectiveCooldownSec = null;
    this._quarantineCapped = false;
    /** Full track lists keyed by playlist id — avoids re-paginating /items when host loads then finalizes. */
    this._playlistTracksCache = new Map();
    /** Global pacing for this token (see readWebApiPacingMinMs). */
    this._pacingMinIntervalMs = readWebApiPacingMinMs();
    this._paceQueueTail = Promise.resolve();
    this._nextWebApiSlotAt = 0;
    /** After 429, temporarily increase spacing between calls (see SPOTIFY_POST_429_*). */
    this._pacingBoostUntil = 0;
    /** Last api.spotify.com 429 incident (structured); survives clearRateLimitQuarantine() for forensics. */
    this._last429Incident = null;
  }

  // Classify common Spotify Web API errors
  isTokenExpiredError(error) {
    const status = error?.body?.error?.status || error?.statusCode;
    const msg = (error?.body?.error?.message || error?.message || '').toLowerCase();
    return status === 401 || /token.*expired|access.*token/i.test(msg);
  }

  isRestrictionError(error) {
    const status = error?.body?.error?.status || error?.statusCode;
    const msg = (error?.body?.error?.message || error?.message || '').toLowerCase();
    return status === 403 && /restriction/i.test(msg);
  }

  isRateLimitError(error) {
    return (error?.body?.error?.status || error?.statusCode) === 429;
  }

  getRetryAfterSecFromError(error) {
    const h = error?.headers || {};
    const v = h['retry-after'] ?? h['Retry-After'];
    const n = v != null ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  /**
   * Apply backoff from 429. Honors Retry-After (often 86400s = 24h when Spotify restrains the app).
   * `meta.httpMethod` + `meta.httpPath` identify raw HTTP calls; SDK-only paths use `source` + SPOTIFY_SOURCE_ROUTE_HINT.
   * Emits JSON line `[SPOTIFY_429_DIAGNOSTIC]` on every occurrence (Railway logs / grep).
   */
  applyRateLimitQuarantine(error, source, meta = {}) {
    if (!this.isRateLimitError(error)) return;
    const raSec = this.getRetryAfterSecFromError(error);
    const routeHint = inferSpotify429Route(source, meta);
    const hdrDiag = spotifyPickDiagnosticHeaders(error?.headers);
    const eb = error?.body?.error;
    const spotifyMsg =
      eb && (eb.message != null || eb.reason != null)
        ? String(eb.message != null ? eb.message : eb.reason)
        : null;
    const spotifyErrStatus = eb?.status != null ? eb.status : error?.statusCode;

    const now = Date.now();
    const rawWaitMs =
      raSec > 0 ? Math.min(86400 * 1000, raSec * 1000) : Math.min(3600 * 1000, 60_000);
    const waitMs = Math.min(rawWaitMs, SPOTIFY_QUARANTINE_MAX_MS);
    const capped = rawWaitMs > SPOTIFY_QUARANTINE_MAX_MS;
    const effectiveSec = Math.max(1, Math.round(waitMs / 1000));

    this._quarantineSource = String(source);
    this._quarantineSpotifyRetryAfterSec = raSec > 0 ? raSec : null;
    this._quarantineEffectiveCooldownSec = effectiveSec;
    this._quarantineCapped = capped;
    this._spotifyQuarantineUntil = Math.max(this._spotifyQuarantineUntil || 0, now + waitMs);
    this._playbackStateBackoffUntil = Math.max(this._playbackStateBackoffUntil || 0, now + waitMs);
    this._pacingBoostUntil = Math.max(this._pacingBoostUntil || 0, now + SPOTIFY_POST_429_PACING_BOOST_MS);

    this._last429Incident = {
      occurredAtIso: new Date().toISOString(),
      sourceLabel: String(source),
      routeHint,
      httpMethod: meta.httpMethod || null,
      httpPath: meta.httpPath ? spotifyTruncateApiPath(meta.httpPath) : null,
      retryAfterSecFromHeader: raSec,
      effectiveCooldownSec: effectiveSec,
      quarantineCappedToEnvMax: capped,
      spotifyErrorMessage: spotifyMsg,
      spotifyErrorStatus: spotifyErrStatus != null ? Number(spotifyErrStatus) : null,
      responseHeadersDiagnostic: hdrDiag,
      clientIdPrefix: this._pipelineClientIdPrefix,
      credentialMode: this._pipelineCredentialMode,
      humanReadableSource: this._describeQuarantineSource(source),
      why:
        'Spotify returned HTTP 429 for this call site. TEMPO reads Retry-After, applies in-process quarantine (may cap via SPOTIFY_QUARANTINE_MAX_MS), and temporarily increases pacing. Find routeHint / httpPath for the exact api.spotify.com surface.',
    };

    console.error('[SPOTIFY_429_DIAGNOSTIC]', JSON.stringify(this._last429Incident));

    if (pl.isEnabled() && pl.shouldLogQuarantine429ToPipeline()) {
      pl.log('quarantine_429', {
        source: String(source),
        client_id_prefix: this._pipelineClientIdPrefix,
        cred_mode: this._pipelineCredentialMode,
        spotify_retry_after_s: String(raSec),
        route_hint: routeHint.slice(0, 400),
        spotify_error:
          spotifyMsg != null && spotifyMsg !== ''
            ? spotifyMsg.slice(0, 400)
            : '',
      });
    }

    if (!missionCriticalLogsOnlySpotify() && now - (this._lastGlobal429LogAt || 0) > 120_000) {
      this._lastGlobal429LogAt = now;
      const untilIso = new Date(this._spotifyQuarantineUntil).toISOString();
      console.warn(
        `⚠️ Spotify 429 [${source}] — pausing API calls until ${untilIso} (Retry-After from Spotify: ${
          raSec || 'n/a'
        }s${capped ? `; capped to ${SPOTIFY_QUARANTINE_MAX_MS / 1000}s for in-process backoff` : ''}). See [SPOTIFY_429_DIAGNOSTIC] JSON above/below for route + headers.`
      );
    }
  }

  isQuarantined() {
    return Date.now() < (this._spotifyQuarantineUntil || 0);
  }

  getQuarantineRemainingSec() {
    return Math.max(0, Math.ceil(((this._spotifyQuarantineUntil || 0) - Date.now()) / 1000));
  }

  _describeQuarantineSource(source) {
    const s = String(source || 'unknown');
    const labels = {
      getUserPlaylists: 'Loading your playlist library (GET /v1/me/playlists)',
      getPlaylistItems: 'Reading playlist track pages (GET /v1/playlists/…/items)',
      getPlaylistMetadataBrief: 'Loading playlist details',
      getPlaylistTracks: 'Loading a playlist’s full track list',
      getPlaylistSnapshot: 'Playlist version id (GET /v1/playlists/… snapshot_id)',
      removePlaylistLibrary: 'Removing playlists from library (DELETE /v1/me/library)',
      getCurrentUserProfileBrief: 'Spotify user profile (GET /v1/me)',
      getCurrentPlaybackState: 'Current playback / player state',
    };
    if (labels[s]) return labels[s];
    if (s.startsWith('withRetries:')) {
      return `A Spotify call that can retry: ${s.replace(/^withRetries:/, '')}`;
    }
    return `Spotify Web API: ${s}`;
  }

  /**
   * In-process 429 cooldown for api.spotify.com (for host UI). Not cleared until cooldown ends
   * or clearRateLimitQuarantine().
   */
  getWebApiQuarantineInfo() {
    const incident = this._last429Incident || null;
    if (!this.isQuarantined()) {
      return { active: false, last429Incident: incident };
    }
    return {
      active: true,
      remainingSec: this.getQuarantineRemainingSec(),
      source: this._quarantineSource,
      sourceDescription: this._describeQuarantineSource(this._quarantineSource),
      spotifyRetryAfterSec: this._quarantineSpotifyRetryAfterSec,
      effectiveCooldownSec: this._quarantineEffectiveCooldownSec,
      inProcessMaxCooldownSec: Math.ceil(SPOTIFY_QUARANTINE_MAX_MS / 1000),
      spotifyRetryCapped: this._quarantineCapped === true,
      last429Incident: incident,
    };
  }

  /**
   * Clear in-process 429 backoff. Call after a successful token refresh (POST /api/spotify/refresh) so
   * Web API is attempted again. OAuth uses a new SpotifyService (invalidate) instead of this.
   */
  clearRateLimitQuarantine() {
    this._spotifyQuarantineUntil = 0;
    this._pacingBoostUntil = 0;
    this._quarantineSource = null;
    this._quarantineSpotifyRetryAfterSec = null;
    this._quarantineEffectiveCooldownSec = null;
    this._quarantineCapped = false;
  }

  _makeQuarantineError(caller) {
    const err = new Error(`Spotify API quarantined (${caller})`);
    err.statusCode = 429;
    err.headers = { 'retry-after': String(Math.max(1, this.getQuarantineRemainingSec())) };
    return err;
  }

  /**
   * Block all api.spotify.com traffic while a 429 / Retry-After quarantine is active
   * (token refresh to accounts.spotify.com still uses ensureValidToken elsewhere).
   */
  async _ensureCanCallWebApi(caller) {
    if (this.isQuarantined()) throw this._makeQuarantineError(caller);
    await this.ensureValidToken();
  }

  _rethrowIfRateLimited(error, label, meta = {}) {
    if (this.isRateLimitError(error)) {
      this.applyRateLimitQuarantine(error, label, meta);
    }
  }

  /**
   * Serialized “next slot” pacing for every Web API call on this token — prevents burst 429s.
   */
  async _paceBeforeWebApiRequest() {
    if (!this._pacingMinIntervalMs) return;
    let min = this._pacingMinIntervalMs;
    if (Date.now() < (this._pacingBoostUntil || 0)) {
      min = Math.min(10_000, Math.floor(min * SPOTIFY_POST_429_PACING_MULTIPLIER));
    }
    const run = async () => {
      const now = Date.now();
      const wait = Math.max(0, (this._nextWebApiSlotAt || 0) - now);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this._nextWebApiSlotAt = Date.now() + min;
    };
    const p = this._paceQueueTail.then(run);
    this._paceQueueTail = p.catch(() => {});
    await p;
  }

  async _paceAndThen(fn) {
    await this._paceBeforeWebApiRequest();
    return await fn();
  }

  /**
   * Normalize to spotify:track:… URIs for playlist item APIs (February 2026: POST/DELETE /playlists/{id}/items).
   */
  _asSpotifyTrackUris(uris) {
    return (Array.isArray(uris) ? uris : [uris])
      .filter((u) => u != null && String(u).trim() !== '')
      .map((u) => {
        const s = String(u).trim();
        if (s.startsWith('spotify:')) return s;
        return `spotify:track:${s}`;
      });
  }

  /**
   * Proxy spotify-web-api-node: count one api.spotify.com request per call (excludes token/OAuth helpers).
   */
  _wrapSpotifyWebApiForMeter() {
    const raw = this.spotifyApi;
    const self = this;
    const noCount = new Set([
      'setAccessToken',
      'setRefreshToken',
      'setClientId',
      'setClientSecret',
      'setRedirectURI',
      'setCredentials',
      'resetAccessToken',
      'getAccessToken',
      'getRefreshToken',
      'getClientId',
      'getClientSecret',
      'getRedirectURI',
      'getCredentials',
      'getHttpManager',
      'createAuthorizeURL',
      'authorizationCodeGrant',
      'refreshAccessToken',
      'clientCredentialsGrant',
    ]);
    this.spotifyApi = new Proxy(raw, {
      get: (target, prop) => {
        if (prop === 'constructor') return target.constructor;
        const v = target[prop];
        if (typeof v !== 'function') return v;
        if (noCount.has(String(prop))) {
          return v.bind(target);
        }
        return function proxiedSpotifyRequest(...args) {
          webApi.record(1);
          return self._paceAndThen(() => v.apply(target, args));
        };
      },
    });
  }

  /**
   * Raw GET to api.spotify.com (used for /items where the Node SDK still maps older paths).
   */
  async _webApiGet(path, label, { bypassQuarantine = false } = {}) {
    if (!bypassQuarantine && this.isQuarantined()) {
      return Promise.reject(this._makeQuarantineError(label));
    }
    if (!this.accessToken) {
      return Promise.reject(new Error('No access token'));
    }
    await this._paceBeforeWebApiRequest();
    return new Promise((resolve, reject) => {
      webApi.record(1);
      const req = https.request(
        {
          hostname: 'api.spotify.com',
          path,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: 'application/json',
          },
        },
        (res) => {
          const parts = [];
          res.on('data', (c) => parts.push(c));
          res.on('end', () => {
            const buf = Buffer.concat(parts).toString('utf8');
            let body = null;
            try {
              body = buf ? JSON.parse(buf) : null;
            } catch {
              body = { _raw: buf };
            }
            const sc = res.statusCode || 0;
            if (pl.shouldLogWebApiResponseStatus(sc)) {
              const pathOnly = String(path).split('?')[0];
              pl.log('web_api_response', { label, path: pathOnly, status: String(sc) });
            }
            if (sc >= 200 && sc < 300) {
              return resolve({ body, statusCode: sc, headers: res.headers });
            }
            if (pl.isEnabled() && !pl.isWebApiLogEnabled()) {
              pl.log('web_api_error', {
                label,
                path: String(path).split('?')[0],
                status: String(sc),
              });
            }
            const err = new Error(
              (body && body.error && (body.error.message || String(body.error))) || `Spotify API ${sc}`
            );
            err.statusCode = sc;
            err.body = body;
            err.headers = res.headers;
            if (sc === 429 || this.isRateLimitError(err)) {
              this.applyRateLimitQuarantine(
                { statusCode: 429, headers: res.headers, body: body || {} },
                label,
                { httpMethod: 'GET', httpPath: path }
              );
            }
            reject(err);
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(90000, () => {
        req.destroy();
        reject(new Error('Spotify request timeout'));
      });
      req.end();
    });
  }

  /**
   * Raw POST/PUT/DELETE to api.spotify.com (February 2026: POST /v1/me/playlists, /v1/playlists/{id}/items, etc.).
   */
  async _webApiRequest(method, path, bodyObj, label, { bypassQuarantine = false } = {}) {
    if (!bypassQuarantine && this.isQuarantined()) {
      return Promise.reject(this._makeQuarantineError(label));
    }
    if (!this.accessToken) {
      return Promise.reject(new Error('No access token'));
    }
    await this._paceBeforeWebApiRequest();
    const bodyStr =
      bodyObj == null
        ? undefined
        : typeof bodyObj === 'string'
          ? bodyObj
          : JSON.stringify(bodyObj);
    return new Promise((resolve, reject) => {
      webApi.record(1);
      const headers = {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      };
      if (bodyStr != null && bodyStr !== '') {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(bodyStr, 'utf8');
      }
      const req = https.request(
        {
          hostname: 'api.spotify.com',
          path,
          method: String(method).toUpperCase(),
          headers,
        },
        (res) => {
          const parts = [];
          res.on('data', (c) => parts.push(c));
          res.on('end', () => {
            const buf = Buffer.concat(parts).toString('utf8');
            let body = null;
            try {
              body = buf ? JSON.parse(buf) : null;
            } catch {
              body = buf ? { _raw: buf } : null;
            }
            const sc = res.statusCode || 0;
            if (pl.shouldLogWebApiResponseStatus(sc)) {
              const pathOnly = String(path).split('?')[0];
              pl.log('web_api_response', { label, path: pathOnly, status: String(sc) });
            }
            if (sc >= 200 && sc < 300) {
              return resolve({ body, statusCode: sc, headers: res.headers });
            }
            if (pl.isEnabled() && !pl.isWebApiLogEnabled()) {
              pl.log('web_api_error', {
                label,
                path: String(path).split('?')[0],
                status: String(sc),
              });
            }
            const err = new Error(
              (body && body.error && (body.error.message || String(body.error))) || `Spotify API ${sc}`
            );
            err.statusCode = sc;
            err.body = body;
            err.headers = res.headers;
            if (sc === 429 || this.isRateLimitError(err)) {
              this.applyRateLimitQuarantine(
                { statusCode: 429, headers: res.headers, body: body || {} },
                label,
                { httpMethod: String(method).toUpperCase(), httpPath: path }
              );
            }
            reject(err);
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(90000, () => {
        req.destroy();
        reject(new Error('Spotify request timeout'));
      });
      if (bodyStr != null && bodyStr !== '') {
        req.write(bodyStr, 'utf8');
      }
      req.end();
    });
  }

  /**
   * GET /v1/playlists/{id}/items — see https://developer.spotify.com/documentation/web-api/reference/get-playlists-items
   * (`QueryLimit` in https://developer.spotify.com/reference/web-api/open-api-schema.yaml — max 50.)
   */
  async _fetchPlaylistItemsPage(playlistId, { limit = PLAYLIST_ITEMS_PAGE_LIMIT_MAX, offset = 0, market = null } = {}) {
    const cap = Math.min(PLAYLIST_ITEMS_PAGE_LIMIT_MAX, Math.max(1, limit));
    const q = new URLSearchParams();
    q.set('limit', String(cap));
    q.set('offset', String(offset));
    // Omit additional_types — default items are tracks. Explicit additional_types=track has correlated with
    // empty `items` / odd shaping on some Web API responses; episodes are filtered out downstream anyway.
    if (market) q.set('market', market);
    const path = `/v1/playlists/${encodeURIComponent(playlistId)}/items?${q.toString()}`;
    const { body } = await this._webApiGet(path, 'getPlaylistItems');
    return body && Array.isArray(body.items) ? body : { items: [] };
  }

  async withRetries(label, fn, options = {}) {
    const attempts = Math.max(1, options.attempts || 3);
    const baseDelayMs = Math.max(0, options.backoffMs || 250);
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if (this.isQuarantined()) {
          throw this._makeQuarantineError(`withRetries:${label}`);
        }
        if (attempt > 1) {
          await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 2)));
        }
        // Ensure token each attempt
        try { await this.ensureValidToken(); } catch (_) {}
        return await fn();
      } catch (err) {
        lastErr = err;
        if (this.isRateLimitError(err)) {
          this.applyRateLimitQuarantine(err, `withRetries:${label}`);
          throw err;
        }
        // If token expired, refresh once and retry immediately
        if (this.isTokenExpiredError(err)) {
          try { await this.refreshAccessToken(); } catch (_) {}
          continue;
        }
        // If 403 restriction on resume-type operations, treat as non-fatal for subsequent logic
        if (this.isRestrictionError(err) && /resume|playback|seek|transfer|start/i.test(String(label))) {
          console.warn(`⚠️ ${label} got restriction (ignored):`, err?.body?.error?.message || err?.message || err);
          return null;
        }
        if (attempt === attempts) break;
      }
    }
    throw lastErr;
  }

  // Get authorization URL for Spotify login (optional state for OAuth callback routing)
  // Minimum scopes: playlist + playback control. No user-read-email (Google host identity is primary).
  // Re-connect Spotify after scope changes.
  getAuthorizationURL(state, redirectUriOverride) {
    const scopes = [
      'playlist-read-private',
      'playlist-read-collaborative',
      'playlist-modify-private',
      'playlist-modify-public',
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
    ];

    const target = redirectUriOverride || this.defaultRedirectUri;
    const prev =
      typeof this.spotifyApi.getRedirectURI === 'function'
        ? this.spotifyApi.getRedirectURI()
        : this.defaultRedirectUri;
    this.spotifyApi.setRedirectURI(target);
    try {
      return this.spotifyApi.createAuthorizeURL(scopes, state || undefined);
    } finally {
      this.spotifyApi.setRedirectURI(prev);
    }
  }

  // Handle authorization callback
  async handleCallback(code, redirectUriOverride) {
    try {
      routineSpotifyLog('Handling Spotify callback with code:', code.substring(0, 20) + '...');
      const target = redirectUriOverride || this.defaultRedirectUri;
      const prev =
        typeof this.spotifyApi.getRedirectURI === 'function'
          ? this.spotifyApi.getRedirectURI()
          : this.defaultRedirectUri;
      this.spotifyApi.setRedirectURI(target);
      let data;
      try {
        data = await this.spotifyApi.authorizationCodeGrant(code);
      } finally {
        this.spotifyApi.setRedirectURI(prev);
      }
      routineSpotifyLog('Successfully got tokens from Spotify');
      this.accessToken = data.body.access_token;
      this.refreshToken = data.body.refresh_token;
      this.tokenExpirationTime = Date.now() + (data.body.expires_in * 1000);
      
      this.spotifyApi.setAccessToken(this.accessToken);
      this.spotifyApi.setRefreshToken(this.refreshToken);
      
      return {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiresIn: data.body.expires_in
      };
    } catch (error) {
      const msg = (error && error.message) || String(error);
      if (process.env.TEMPO_SPOTIFY_LOG_FULL_TOKEN_ERRORS === '1') {
        console.error('Error getting Spotify tokens:', error);
      } else {
        console.error('Error getting Spotify tokens:', msg);
      }
      throw error;
    }
  }

  // Set tokens (for when tokens are stored elsewhere)
  setTokens(accessToken, refreshToken) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.spotifyApi.setAccessToken(accessToken);
    this.spotifyApi.setRefreshToken(refreshToken);
    // Force a refresh on next use if we don't know the expiry
    this.tokenExpirationTime = Date.now() - 1;
  }

  // Refresh access token if needed
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      if (pl.isEnabled()) {
        pl.log('token_refresh_attempt', {
          cred_mode: this._pipelineCredentialMode,
          client_id_prefix: this._pipelineClientIdPrefix,
        });
      }
      const data = await this.spotifyApi.refreshAccessToken();
      this.accessToken = data.body.access_token;
      this.tokenExpirationTime = Date.now() + (data.body.expires_in * 1000);
      this.spotifyApi.setAccessToken(this.accessToken);
      if (pl.isEnabled()) {
        const exp = data.body.expires_in;
        pl.log('token_refresh_ok', {
          cred_mode: this._pipelineCredentialMode,
          client_id_prefix: this._pipelineClientIdPrefix,
          expires_in_s: String(exp),
        });
      }
      return this.accessToken;
    } catch (error) {
      if (pl.isEnabled()) {
        pl.log('token_refresh_fail', {
          cred_mode: this._pipelineCredentialMode,
          client_id_prefix: this._pipelineClientIdPrefix,
          err: (error && error.message) || String(error),
        });
      }
      const msg = (error && error.message) || String(error);
      if (process.env.TEMPO_SPOTIFY_LOG_FULL_TOKEN_ERRORS === '1') {
        console.error('Error refreshing Spotify token:', error);
      } else {
        console.error('Error refreshing Spotify token:', msg);
      }
      throw error;
    }
  }

  // Check if token needs refresh
  async ensureValidToken() {
    // If we don't have an access token but we do have a refresh token, try to refresh
    if (!this.accessToken) {
      if (this.refreshToken) {
        await this.refreshAccessToken();
        return;
      }
      throw new Error('No access token available');
    }

    // If we don't know the expiry yet, proactively refresh using the refresh token
    if ((!this.tokenExpirationTime || Date.now() >= this.tokenExpirationTime - 60000) && this.refreshToken) {
      await this.refreshAccessToken();
    }
  }

  /**
   * Track count on playlist list rows / metadata.
   * Spotify deprecated `tracks` in favor of `items` (a ref { href, total } on /me/playlists
   * simplified objects, or the items paging object on full GET /playlists/{id}).
   * Prefer `items.total` when present; fall back to `tracks.total` for older responses.
   */
  _playlistItemsTotalFromListItem(playlist) {
    if (!playlist || typeof playlist !== 'object') return 0;
    let ref = null;
    if (
      playlist.items != null &&
      typeof playlist.items === 'object' &&
      !Array.isArray(playlist.items) &&
      Object.prototype.hasOwnProperty.call(playlist.items, 'total')
    ) {
      ref = playlist.items;
    } else if (playlist.tracks != null && typeof playlist.tracks === 'object') {
      ref = playlist.tracks;
    }
    if (!ref) return 0;
    const n = Number(ref.total);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  /**
   * GET /v1/me — which Spotify user this access token represents (for support / logs).
   * Does not require user-read-email; id + display_name are always present for valid tokens.
   */
  async getCurrentUserProfileBrief() {
    await this._ensureCanCallWebApi('getCurrentUserProfileBrief');
    const { body } = await this._webApiGet('/v1/me', 'getCurrentUserProfileBrief');
    if (!body || typeof body !== 'object') {
      return { spotifyUserId: null, displayName: null, product: null, country: null };
    }
    return {
      spotifyUserId: body.id != null ? String(body.id) : null,
      displayName: body.display_name != null ? String(body.display_name) : null,
      product: body.product != null ? String(body.product) : null,
      country: body.country != null ? String(body.country) : null,
    };
  }

  /**
   * GET /v1/playlists/{id} (minimal fields) — may succeed when /v1/me/playlists is 429; used for
   * host “add by link” fallback. Same row shape as getUserPlaylists() items.
   * @param {object} [options]
   * @param {boolean} [options.emergencyBypassQuarantine] - allow one read while TEMPO in-process
   *   429 quarantine (still honors Spotify’s own 429 on the wire).
   */
  async getPlaylistMetadataBrief(playlistId, options = {}) {
    const emergency = Boolean(options && options.emergencyBypassQuarantine);
    if (emergency) {
      await this.ensureValidToken();
    } else {
      await this._ensureCanCallWebApi('getPlaylistMetadataBrief');
    }
    const id = String(playlistId || '').trim();
    if (!id) throw new Error('playlist id required');
    const path = `/v1/playlists/${encodeURIComponent(id)}?fields=${encodeURIComponent(
      'id,name,description,public,collaborative,owner(display_name),items.total,tracks.total'
    )}`;
    const { body } = await this._webApiGet(path, 'getPlaylistMetadataBrief', {
      bypassQuarantine: emergency,
    });
    if (!body || typeof body !== 'object' || !body.id) {
      throw new Error('Unexpected playlist response');
    }
    return {
      id: String(body.id),
      name: body.name,
      description: body.description,
      public: body.public,
      collaborative: body.collaborative,
      owner:
        body.owner && body.owner.display_name != null
          ? String(body.owner.display_name)
          : 'Unknown',
      tracks: this._playlistItemsTotalFromListItem(body),
    };
  }

  /**
   * Lightweight playlist version check — GET /v1/playlists/{id}?fields=snapshot_id (OpenAPI).
   * Used to skip full GET …/items pagination when the playlist has not changed since we cached tracks.
   */
  async _getPlaylistSnapshotId(playlistId) {
    await this._ensureCanCallWebApi('getPlaylistSnapshot');
    const id = String(playlistId || '').trim();
    if (!id) throw new Error('playlist id required');
    const path = `/v1/playlists/${encodeURIComponent(id)}?fields=${encodeURIComponent('snapshot_id')}`;
    const { body } = await this._webApiGet(path, 'getPlaylistSnapshot');
    if (!body || typeof body !== 'object' || body.snapshot_id == null) return null;
    return String(body.snapshot_id);
  }

  // Get user's playlists
  async getUserPlaylists() {
    await this._ensureCanCallWebApi('getUserPlaylists');

    try {
      const raw = [];
      let offset = 0;
      const limit = 50;
      let spotifyListTotal = null;
      let isFirst = true;

      // Use direct Web API so we keep `items.total` / `tracks.total` (Spotify is moving to `items`).
      while (true) {
        if (offset > 0 && !this._pacingMinIntervalMs) {
          await new Promise((r) => setTimeout(r, 200));
        }
        const path = `/v1/me/playlists?limit=${limit}&offset=${offset}`;
        const { body } = await this._webApiGet(path, 'getUserPlaylists');
        if (isFirst && body && typeof body.total === 'number' && body.total >= 0) {
          spotifyListTotal = body.total;
          isFirst = false;
        } else if (isFirst) {
          isFirst = false;
        }
        const items = (body && Array.isArray(body.items) ? body.items : []) || [];

        if (items.length === 0) break;

        raw.push(...items);
        offset += items.length;

        if (items.length < limit) break;
      }

      if (
        spotifyListTotal != null &&
        spotifyListTotal > 0 &&
        raw.length === 0
      ) {
        console.error(
          `getUserPlaylists: Spotify /v1/me/playlists total=${spotifyListTotal} but no items were returned (offset 0) — check API response shape or token scopes.`
        );
      }
      if (raw.length > 0 && spotifyListTotal === 0) {
        console.warn('getUserPlaylists: got playlist rows but spotifyListTotal=0 (unexpected).');
      }

      const playlists = raw.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        tracks: this._playlistItemsTotalFromListItem(playlist),
        public: playlist.public,
        collaborative: playlist.collaborative,
        owner:
          playlist.owner && playlist.owner.display_name != null
            ? playlist.owner.display_name
            : 'Unknown',
      }));
      return { playlists, spotifyListTotal };
    } catch (error) {
      // 429 from _webApiGet: quarantine already applied there — avoid duplicate log/state
      if (this.isRateLimitError(error) && error && error.headers) {
        throw error;
      }
      if (this.isRateLimitError(error)) {
        this.applyRateLimitQuarantine(error, 'getUserPlaylists');
        throw error;
      }
      console.error('Error getting user playlists:', error);
      throw error;
    }
  }

  // Get playlist tracks (paginated via GET /playlists/{id}/items)
  async getPlaylistTracks(playlistId, playlistInfo = null) {
    await this._ensureCanCallWebApi('getPlaylistTracks');

    const cacheKey = String(playlistId);
    const now = Date.now();

    let snapshotId = null;
    try {
      snapshotId = await this._getPlaylistSnapshotId(playlistId);
    } catch {
      /* non-fatal — omit snapshot skip optimization */
    }

    const cached = this._playlistTracksCache.get(cacheKey);
    const mapRow = (t) => ({
      ...t,
      sourcePlaylistId: playlistId,
      sourcePlaylistName: playlistInfo?.name || 'Unknown Playlist',
    });

    if (
      snapshotId &&
      cached &&
      cached.snapshotId === snapshotId &&
      Array.isArray(cached.tracks) &&
      cached.tracks.length > 0
    ) {
      return cached.tracks.map(mapRow);
    }

    if (
      !snapshotId &&
      cached &&
      now - cached.at < PLAYLIST_TRACKS_CACHE_TTL_MS &&
      Array.isArray(cached.tracks) &&
      cached.tracks.length > 0
    ) {
      return cached.tracks.map(mapRow);
    }

    try {
      const tracks = [];
      let offset = 0;
      const pageLimit = PLAYLIST_ITEMS_PAGE_LIMIT_MAX;

      while (true) {
        const page = await this._fetchPlaylistItemsPage(playlistId, { limit: pageLimit, offset });
        /** Raw rows from Spotify — advance `offset` by this length even when some rows lack `track` (deleted/null). */
        const rawItems = page.items || [];

        if (rawItems.length === 0) {
          if (offset === 0) {
            console.warn(
              `[getPlaylistTracks] playlist ${playlistId}: Spotify returned empty items[] at offset 0 (check playlist id and OAuth scopes)`
            );
          }
          break;
        }

        // Filter out non-track items and map to our format
        const validTracks = rawItems
          .filter((item) => item.track && item.track.id)
          .map((item) => ({
            id: item.track.id,
            name: item.track.name,
            artist: item.track.artists.map((artist) => artist.name).join(', '),
            album: item.track.album.name,
            duration: item.track.duration_ms,
            uri: item.track.uri,
            previewUrl: item.track.preview_url || null,
            explicit: item.track.explicit === true,
            sourcePlaylistId: playlistId,
            sourcePlaylistName: playlistInfo?.name || 'Unknown Playlist',
          }));

        tracks.push(...validTracks);
        if (offset === 0 && rawItems.length > 0 && validTracks.length === 0) {
          console.warn(
            `[getPlaylistTracks] playlist ${playlistId}: ${rawItems.length} row(s) on first page but none pass track.id filter (removed tracks / episodes-only page?)`
          );
        }
        offset += rawItems.length;

        if (rawItems.length < pageLimit) break;
        if (PLAYLIST_ITEMS_PAGE_GAP_MS > 0) {
          await new Promise((r) => setTimeout(r, PLAYLIST_ITEMS_PAGE_GAP_MS));
        }
      }

      let snapStore = snapshotId;
      if (!snapStore) {
        try {
          snapStore = await this._getPlaylistSnapshotId(playlistId);
        } catch {
          snapStore = null;
        }
      }
      this._playlistTracksCache.set(cacheKey, {
        at: Date.now(),
        tracks,
        snapshotId: snapStore || null,
      });
      return tracks;
    } catch (error) {
      this._rethrowIfRateLimited(error, 'getPlaylistTracks');
      console.error('Error getting playlist tracks:', error);
      throw error;
    }
  }

  // Get public / shared playlist tracks (full pagination via /items, same as owned playlists)
  async getPublicPlaylistTracks(playlistId) {
    return this.getPlaylistTracks(playlistId, { name: 'Playlist' });
  }

  // Start playback on user's device
  async startPlayback(deviceId, uris, position = 0) {
    await this._ensureCanCallWebApi('startPlayback');
    
    try {
      await this.spotifyApi.play({
        device_id: deviceId,
        uris: uris,
        position_ms: position
      });
    } catch (error) {
      this._rethrowIfRateLimited(error, 'startPlayback');
      console.error('Error starting playback:', error);
      throw error;
    }
  }

  // Pause playback
  async pausePlayback(deviceId) {
    await this._ensureCanCallWebApi('pausePlayback');
    
    try {
      await this.spotifyApi.pause({ device_id: deviceId });
    } catch (error) {
      this._rethrowIfRateLimited(error, 'pausePlayback');
      console.error('Error pausing playback:', error);
      throw error;
    }
  }

  // Transfer playback to a specific device (assert control)
  async transferPlayback(deviceId, play = true) {
    await this._ensureCanCallWebApi('transferPlayback');
    try {
      await this.spotifyApi.transferMyPlayback({ deviceIds: [deviceId], play });
      routineSpotifyLog(`🔀 Transferred playback to device ${deviceId} (play=${play})`);
    } catch (error) {
      this._rethrowIfRateLimited(error, 'transferPlayback');
      const msg = error?.body?.error?.message || error?.message || '';
      console.warn('⚠️ transferMyPlayback failed:', msg);
      // Fallback: send raw request if Spotify complains about JSON shape
      if (/Malformed json/i.test(msg)) {
        routineSpotifyLog('🔧 Falling back to direct HTTP transfer request');
        const ok = await this._transferPlaybackDirect(deviceId, !!play);
        if (ok) return;
      }
      throw error;
    }
  }

  async _transferPlaybackDirect(deviceId, play) {
    await this._paceBeforeWebApiRequest();
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ device_ids: [deviceId], play: !!play });
      webApi.record(1);
      const req = https.request({
        hostname: 'api.spotify.com',
        path: '/v1/me/player',
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          routineSpotifyLog('✅ Direct transfer success');
          resolve(true);
        } else {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 429) {
              const syn = new Error('Direct transfer rate limited');
              syn.statusCode = 429;
              syn.headers = res.headers || {};
              syn.body = {};
              try {
                syn.body = data ? JSON.parse(data) : {};
              } catch {
                syn.body = { _parseError: true };
              }
              this.applyRateLimitQuarantine(syn, '_transferPlaybackDirect', {
                httpMethod: 'PUT',
                httpPath: '/v1/me/player',
              });
            }
            console.error('❌ Direct transfer failed:', res.statusCode, data);
            reject(new Error(`Direct transfer failed: ${res.statusCode} ${data}`));
          });
        }
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // Resume playback
  async resumePlayback(deviceId) {
    await this._ensureCanCallWebApi('resumePlayback');
    
    try {
      await this.spotifyApi.play({ device_id: deviceId });
      routineSpotifyLog(`▶️ Resumed playback on ${deviceId}`);
    } catch (error) {
      this._rethrowIfRateLimited(error, 'resumePlayback');
      console.error('Error resuming playback:', error);
      throw error;
    }
  }

  // Skip to next track
  async nextTrack(deviceId) {
    await this._ensureCanCallWebApi('nextTrack');
    
    try {
      await this.spotifyApi.skipToNext({ device_id: deviceId });
    } catch (error) {
      this._rethrowIfRateLimited(error, 'nextTrack');
      console.error('Error skipping to next track:', error);
      throw error;
    }
  }

  // Get user's devices
  async getUserDevices() {
    await this._ensureCanCallWebApi('getUserDevices');
    try {
      const response = await this.spotifyApi.getMyDevices();
      const devices = response.body.devices;
      if (process.env.NODE_ENV !== 'production' || process.env.DEBUG) {
        routineSpotifyLog(`Found ${devices.length} devices from Spotify API`);
        devices.forEach((device) => {
          routineSpotifyLog(`- ${device.name} (${device.type}) - Active: ${device.is_active}`);
        });
      }
      return devices;
    } catch (error) {
      if (this.isRateLimitError(error)) {
        this.applyRateLimitQuarantine(error, 'getUserDevices');
        throw error;
      }
      console.error('Error getting user devices:', error);
      throw error;
    }
  }

  // Force device activation without starting playback
  async forceDeviceActivation() {
    await this._ensureCanCallWebApi('forceDeviceActivation');
    try {
      const devices = await this.getUserDevices();
      if (devices.length === 0) {
        routineSpotifyLog('No devices available for activation');
        return { success: false, message: 'No devices available' };
      }
      const deviceId = devices[0].id;
      const deviceName = devices[0].name;
      try {
        await this.transferPlayback(deviceId, false);
        try { await this.setShuffleState(false, deviceId); } catch (_) {}
        try { await this.setRepeatState('off', deviceId); } catch (_) {}
        routineSpotifyLog(`Successfully asserted control on device without playback: ${deviceName}`);
      } catch (_) {
        routineSpotifyLog(`Could not assert control on ${deviceName}, but device is available`);
      }
      return { success: true, device: devices[0] };
    } catch (error) {
      console.error('Error forcing device activation:', error);
      throw error;
    }
  }

  // Activate a specific device by transferring control without playback
  async activateDevice(deviceId, pauseAfterMs = 0) {
    await this._ensureCanCallWebApi('activateDevice');
    try {
      await this.transferPlayback(deviceId, false);
      try { await this.setShuffleState(false, deviceId); } catch (_) {}
      try { await this.setRepeatState('off', deviceId); } catch (_) {}
      // pauseAfterMs retained for signature compatibility, but no autoplay occurs
      return true;
    } catch (error) {
      console.error('Error activating device:', error);
      return false;
    }
  }

  // Get currently playing track
  async getCurrentTrack() {
    await this._ensureCanCallWebApi('getCurrentTrack');
    
    try {
      const response = await this.spotifyApi.getMyCurrentPlayingTrack();
      if (response.body.item) {
        return {
          id: response.body.item.id,
          name: response.body.item.name,
          artist: response.body.item.artists.map(artist => artist.name).join(', '),
          album: response.body.item.album.name,
          duration: response.body.item.duration_ms,
          progress: response.body.progress_ms,
          uri: response.body.item.uri
        };
      }
      return null;
    } catch (error) {
      this._rethrowIfRateLimited(error, 'getCurrentTrack');
      console.error('Error getting current track:', error);
      throw error;
    }
  }

  // Search for playlists (limit max 10, default 5; offset for paging — February 2026 Web API)
  async searchPlaylists(query, limit = SPOTIFY_SEARCH_LIMIT_DEFAULT, offset = 0) {
    await this._ensureCanCallWebApi('searchPlaylists');
    
    try {
      const response = await this.spotifyApi.searchPlaylists(query, {
        limit: clampSearchLimit(limit),
        offset: normalizeSearchOffset(offset),
      });
      return response.body.playlists.items.map(playlist => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        tracks: this._playlistItemsTotalFromListItem(playlist),
        public: playlist.public,
        collaborative: playlist.collaborative,
        owner: (playlist.owner && playlist.owner.display_name) || 'Unknown',
        images: playlist.images
      }));
    } catch (error) {
      this._rethrowIfRateLimited(error, 'searchPlaylists');
      console.error('Error searching playlists:', error);
      throw error;
    }
  }

  // Search for tracks (limit max 10, default 5; offset for paging)
  async searchTracks(query, limit = SPOTIFY_SEARCH_LIMIT_DEFAULT, offset = 0) {
    await this._ensureCanCallWebApi('searchTracks');
    
    try {
      const response = await this.spotifyApi.searchTracks(query, {
        limit: clampSearchLimit(limit),
        offset: normalizeSearchOffset(offset),
      });
      return response.body.tracks.items.map(track => ({
        id: track.id,
        name: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        album: track.album.name,
        duration_ms: track.duration_ms,
        popularity: track.popularity,
        preview_url: track.preview_url,
        uri: track.uri,
        external_urls: track.external_urls,
        explicit: track.explicit === true
      }));
    } catch (error) {
      this._rethrowIfRateLimited(error, 'searchTracks');
      console.error('Error searching tracks:', error);
      throw error;
    }
  }

  // Set volume
  async setVolume(volume, deviceId) {
    await this._ensureCanCallWebApi('setVolume');
    
    try {
      await this.spotifyApi.setVolume(volume, { device_id: deviceId });
      routineSpotifyLog(`✅ Volume set to ${volume}% on device ${deviceId}`);
    } catch (error) {
      this._rethrowIfRateLimited(error, 'setVolume');
      console.error('Error setting volume:', error);
      throw error;
    }
  }

  // Seek to position
  async seekToPosition(position, deviceId) {
    await this._ensureCanCallWebApi('seekToPosition');
    
    try {
      // Spotify API expects milliseconds
      await this.spotifyApi.seek(position, { device_id: deviceId });
      routineSpotifyLog(`✅ Seeked to ${position}ms on device ${deviceId}`);
    } catch (error) {
      this._rethrowIfRateLimited(error, 'seekToPosition');
      console.error('Error seeking:', error);
      throw error;
    }
  }

  // Get full current playback state (raw Spotify shape)
  async getCurrentPlaybackState() {
    await this.ensureValidToken();
    const now = Date.now();
    if (this.isQuarantined() && this._lastPlaybackStateCache != null) {
      this._playbackNullDueToRateLimit = false;
      return this._lastPlaybackStateCache;
    }
    if (this.isQuarantined() && !this._lastPlaybackStateCache) {
      this._playbackNullDueToRateLimit = true;
      return null;
    }
    if (now < this._playbackStateBackoffUntil && this._lastPlaybackStateCache != null) {
      this._playbackNullDueToRateLimit = false;
      return this._lastPlaybackStateCache;
    }
    try {
      const response = await this.spotifyApi.getMyCurrentPlaybackState();
      const body = response.body || null;
      this._lastPlaybackStateCache = body;
      this._playbackState429Streak = 0;
      this._playbackNullDueToRateLimit = false;
      return body;
    } catch (error) {
      if (this.isRateLimitError(error)) {
        this._playbackState429Streak = Math.min(6, (this._playbackState429Streak || 0) + 1);
        this.applyRateLimitQuarantine(error, 'getCurrentPlaybackState');
        if (this._lastPlaybackStateCache) {
          this._playbackNullDueToRateLimit = false;
          return this._lastPlaybackStateCache;
        }
        this._playbackNullDueToRateLimit = true;
        return null;
      }
      console.error('Error getting current playback state:', error);
      throw error;
    }
  }

  // Set shuffle state
  async setShuffleState(state, deviceId) {
    await this._ensureCanCallWebApi('setShuffleState');
    try {
      await this.spotifyApi.setShuffle(state, { device_id: deviceId });
      routineSpotifyLog(`✅ Shuffle ${state ? 'enabled' : 'disabled'} on device ${deviceId || '(default)'}`);
    } catch (error) {
      this._rethrowIfRateLimited(error, 'setShuffleState');
      console.error('Error setting shuffle state:', error);
      throw error;
    }
  }

  // Set repeat state: 'track' | 'context' | 'off'
  async setRepeatState(state, deviceId) {
    await this._ensureCanCallWebApi('setRepeatState');
    try {
      await this.spotifyApi.setRepeat(state, { device_id: deviceId });
      routineSpotifyLog(`✅ Repeat set to ${state} on device ${deviceId || '(default)'}`);
    } catch (error) {
      this._rethrowIfRateLimited(error, 'setRepeatState');
      console.error('Error setting repeat state:', error);
      throw error;
    }
  }

  // Previous track
  async previousTrack(deviceId) {
    await this._ensureCanCallWebApi('previousTrack');
    try {
      await this.spotifyApi.skipToPrevious({ device_id: deviceId });
    } catch (error) {
      this._rethrowIfRateLimited(error, 'previousTrack');
      console.error('Error going to previous track:', error);
      throw error;
    }
  }

  // Clear queue by skipping all queued items (Spotify has no direct clear API)
  async clearQueue(deviceId) {
    await this._ensureCanCallWebApi('clearQueue');
    try {
      // Get current state to see if there's a queue
      const state = await this.getCurrentPlaybackState();
      if (!state?.device || !state.is_playing) return;
      
      // Skip through queued items until we're back to the current context
      // This is a best-effort approach since Spotify doesn't provide queue listing
      for (let i = 0; i < 50; i++) { // Safety limit
        try {
          await this.nextTrack(deviceId);
          await new Promise(r => setTimeout(r, 100));
          const newState = await this.getCurrentPlaybackState();
          // If we hit the end or context changes, we've likely cleared the queue
          if (!newState?.is_playing || newState?.context?.uri !== state?.context?.uri) {
            break;
          }
        } catch {
          break;
        }
      }
      routineSpotifyLog(`🧹 Queue clearing attempted on device ${deviceId}`);
    } catch (error) {
      console.warn('⚠️ Queue clearing failed (non-fatal):', error?.message || error);
    }
  }

  // Create a temporary playlist for context-based playback (POST /v1/me/playlists + /items)
  async createTemporaryPlaylist(name, trackUris) {
    await this._ensureCanCallWebApi('createTemporaryPlaylist');
    try {
      const organizedName = `${GOT_OUTPUT_PLAYLIST_NAME_PREFIX}${name}`;

      const { body: createBody } = await this._webApiRequest(
        'POST',
        '/v1/me/playlists',
        {
          name: organizedName,
          description: 'Generated by TEMPO Music Bingo - Game Of Tones Output Playlist',
          public: false,
        },
        'createTemporaryPlaylist'
      );
      const playlistId = createBody && createBody.id;
      if (!playlistId) {
        throw new Error('Create playlist: missing id in response');
      }

      await this.addTracksToPlaylist(playlistId, trackUris);
      
      routineSpotifyLog(`✅ Created organized playlist: ${organizedName} with ${trackUris.length} tracks`);
      return playlistId;
    } catch (error) {
      this._rethrowIfRateLimited(error, 'createTemporaryPlaylist');
      console.error('Error creating temporary playlist:', error);
      throw error;
    }
  }

  // Create a permanent output playlist (not deleted after game)
  async createOutputPlaylist(name, trackUris, description = null) {
    await this._ensureCanCallWebApi('createOutputPlaylist');
    try {
      const organizedName = `${GOT_OUTPUT_PLAYLIST_NAME_PREFIX}${name}`;

      const { body: createBody } = await this._webApiRequest(
        'POST',
        '/v1/me/playlists',
        {
          name: organizedName,
          description: description || 'Permanent output playlist from TEMPO Music Bingo',
          public: false,
        },
        'createOutputPlaylist'
      );
      const playlistId = createBody && createBody.id;
      if (!playlistId) {
        throw new Error('Create playlist: missing id in response');
      }

      await this.addTracksToPlaylist(playlistId, trackUris);
      
      routineSpotifyLog(`✅ Created permanent output playlist: ${organizedName} with ${trackUris.length} tracks`);
      return { playlistId, name: organizedName };
    } catch (error) {
      this._rethrowIfRateLimited(error, 'createOutputPlaylist');
      console.error('Error creating output playlist:', error);
      throw error;
    }
  }

  // Get user's Game Of Tones output playlists (GET /v1/me/playlists, not /users/{id}/playlists)
  async getGameOfTonesPlaylists() {
    await this._ensureCanCallWebApi('getGameOfTonesPlaylists');
    try {
      const { spotifyUserId: userId } = await this.getCurrentUserProfileBrief();
      if (!userId) {
        throw new Error('Could not resolve current Spotify user');
      }

      const playlists = [];
      let offset = 0;
      const limit = 50;
      
      while (true) {
        if (offset > 0 && !this._pacingMinIntervalMs) {
          await new Promise((r) => setTimeout(r, 200));
        }
        const path = `/v1/me/playlists?limit=${limit}&offset=${offset}`;
        const { body } = await this._webApiGet(path, 'getGameOfTonesPlaylists');
        const batch = (body && Array.isArray(body.items) ? body.items : []) || [];
        
        if (batch.length === 0) break;

        const gotPlaylists = batch.filter(
          (playlist) =>
            typeof playlist.name === 'string' &&
            playlist.name.startsWith(GOT_OUTPUT_PLAYLIST_NAME_PREFIX) &&
            playlist.owner &&
            playlist.owner.id === userId
        );
        
        playlists.push(...gotPlaylists.map(playlist => ({
          id: playlist.id,
          name: playlist.name,
          trackCount: this._playlistItemsTotalFromListItem(playlist),
          createdAt: playlist.added_at || 'Unknown',
          description: playlist.description || '',
          external_urls: playlist.external_urls
        })));
        
        offset += batch.length;
        if (batch.length < limit) break;
      }
      
      routineSpotifyLog(`✅ Found ${playlists.length} Game Of Tones output playlists`);
      return playlists;
    } catch (error) {
      this._rethrowIfRateLimited(error, 'getGameOfTonesPlaylists');
      console.error('Error getting Game Of Tones playlists:', error);
      throw error;
    }
  }

  /**
   * Before a new game-stage Spotify playlist is created: remove every existing GOT output
   * playlist for this user (same rule as getGameOfTonesPlaylists / Manager cleanup).
   * IDs come from our own listing (trusted); skips per-ID getPlaylist checks.
   */
  async deleteAllGameOfTonesOutputPlaylists() {
    await this._ensureCanCallWebApi('deleteAllGameOfTonesOutputPlaylists');
    const prior = await this.getGameOfTonesPlaylists();
    if (!prior.length) {
      return { deleted: 0, failed: 0, results: [] };
    }
    const ids = prior.map((p) => p.id);
    const results = await this.deleteMultiplePlaylists(ids, {
      requireGotOutputPrefix: false
    });
    const deleted = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    routineSpotifyLog(
      `🧹 Auto-cleared ${deleted} prior GOT output playlist(s) (${failed} failed)`
    );
    return { deleted, failed, results };
  }

  /**
   * Remove playlists from the user's library (February 2026: DELETE /v1/me/library?uris=…).
   * OpenAPI: max 40 URIs per request. Replaces legacy unfollowPlaylist → DELETE …/followers.
   */
  async removePlaylistUrisFromLibrary(playlistIds, label = 'removePlaylistLibrary') {
    await this._ensureCanCallWebApi(label);
    const ids = (Array.isArray(playlistIds) ? playlistIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (!ids.length) return;

    for (let i = 0; i < ids.length; i += LIBRARY_DELETE_URIS_MAX) {
      const chunk = ids.slice(i, i + LIBRARY_DELETE_URIS_MAX);
      const uris = chunk.map((id) => `spotify:playlist:${id}`).join(',');
      const q = new URLSearchParams();
      q.set('uris', uris);
      try {
        await this._webApiRequest(
          'DELETE',
          `/v1/me/library?${q.toString()}`,
          null,
          `${label}:${i}`
        );
      } catch (err) {
        console.warn(
          `⚠️ DELETE /v1/me/library failed (${label}); falling back to unfollowPlaylist:`,
          err?.message || err
        );
        for (const id of chunk) {
          await this.spotifyApi.unfollowPlaylist(id);
        }
      }
    }
  }

  // Delete multiple playlists.
  // When requireGotOutputPrefix is true (Manager cleanup / #32), each ID must be owned by
  // the current user and name must start with GOT_OUTPUT_PLAYLIST_NAME_PREFIX.
  async deleteMultiplePlaylists(playlistIds, options = {}) {
    const { requireGotOutputPrefix = false } = options;
    await this._ensureCanCallWebApi('deleteMultiplePlaylists');

    let userId = null;
    if (requireGotOutputPrefix) {
      const userResponse = await this.spotifyApi.getMe();
      userId = userResponse.body.id;
    }

    const results = [];
    const validatedIds = [];

    for (const playlistId of playlistIds) {
      try {
        if (requireGotOutputPrefix) {
          const pl = await this.spotifyApi.getPlaylist(playlistId);
          const body = pl.body;
          if (body.owner.id !== userId) {
            results.push({
              playlistId,
              success: false,
              error: 'Playlist not owned by current user',
            });
            continue;
          }
          if (
            typeof body.name !== 'string' ||
            !body.name.startsWith(GOT_OUTPUT_PLAYLIST_NAME_PREFIX)
          ) {
            results.push({
              playlistId,
              success: false,
              error:
                'Not a GOT output playlist (name must start with: ' +
                JSON.stringify(GOT_OUTPUT_PLAYLIST_NAME_PREFIX) +
                ')',
            });
            continue;
          }
        }
        validatedIds.push(playlistId);
      } catch (error) {
        console.error(`❌ Failed to validate/delete playlist ${playlistId}:`, error);
        results.push({ playlistId, success: false, error: error.message });
      }
    }

    if (!validatedIds.length) {
      return results;
    }

    try {
      await this.removePlaylistUrisFromLibrary(validatedIds, 'deleteMultiplePlaylists');
      for (const playlistId of validatedIds) {
        routineSpotifyLog(`✅ Deleted playlist: ${playlistId}`);
        results.push({ playlistId, success: true });
      }
    } catch (error) {
      for (const playlistId of validatedIds) {
        results.push({ playlistId, success: false, error: error.message });
      }
    }

    return results;
  }

  // Delete a temporary playlist
  async deleteTemporaryPlaylist(playlistId) {
    await this._ensureCanCallWebApi('deleteTemporaryPlaylist');
    try {
      await this.removePlaylistUrisFromLibrary([playlistId], 'deleteTemporaryPlaylist');
      routineSpotifyLog(`✅ Deleted temporary playlist: ${playlistId}`);
    } catch (error) {
      console.warn('⚠️ Error deleting temporary playlist (non-fatal):', error);
    }
  }

  // Simplified playlist playback - let timer handle timing, not Spotify
  async startPlaybackFromPlaylist(deviceId, playlistId, trackIndex = 0, positionMs = 0) {
    await this._ensureCanCallWebApi('startPlaybackFromPlaylist');
    try {
      // Simple playlist playback - no complex verification or repeat manipulation
      await this.spotifyApi.play({
        device_id: deviceId,
        context_uri: `spotify:playlist:${playlistId}`,
        offset: { position: trackIndex },
        position_ms: positionMs
      });
      
      routineSpotifyLog(`✅ Started playlist playback: track ${trackIndex} at ${positionMs}ms`);
    } catch (error) {
      this._rethrowIfRateLimited(error, 'startPlaybackFromPlaylist');
      console.error('Error starting playback from playlist:', error);
      throw error;
    }
  }

  // Add to queue (deprecated - will be removed)
  async addToQueue(uri, deviceId) {
    await this._ensureCanCallWebApi('addToQueue');
    try {
      await this.spotifyApi.addToQueue(uri, { device_id: deviceId });
      routineSpotifyLog(`✅ Added to queue: ${uri} on device ${deviceId || '(default)'}`);
    } catch (error) {
      this._rethrowIfRateLimited(error, 'addToQueue');
      console.error('Error adding to queue:', error);
      throw error;
    }
  }

  // Get current user profile (to verify correct Spotify account). Email omitted from scopes — field may be null.
  async getCurrentUserProfile() {
    await this._ensureCanCallWebApi('getCurrentUserProfile');
    try {
      const response = await this.spotifyApi.getMe();
      const b = response.body || {};
      return {
        id: b.id,
        display_name: b.display_name,
        email: b.email != null ? b.email : null,
        product: b.product,
        country: b.country
      };
    } catch (error) {
      this._rethrowIfRateLimited(error, 'getCurrentUserProfile');
      console.error('Error getting current user profile:', error);
      throw error;
    }
  }

  // Add tracks to playlist (POST /v1/playlists/{id}/items; max 100 URIs per request)
  async addTracksToPlaylist(playlistId, trackUris, position = null) {
    await this._ensureCanCallWebApi('addTracksToPlaylist');
    try {
      const uris = this._asSpotifyTrackUris(trackUris);
      if (uris.length === 0) {
        return null;
      }
      const id = String(playlistId);
      const chunkSize = 100;
      let lastBody = null;
      for (let i = 0; i < uris.length; i += chunkSize) {
        const chunk = uris.slice(i, i + chunkSize);
        const body = { uris: chunk };
        if (i === 0 && position !== null && position !== undefined) {
          body.position = position;
        }
        const { body: resBody } = await this._webApiRequest(
          'POST',
          `/v1/playlists/${encodeURIComponent(id)}/items`,
          body,
          'addTracksToPlaylist'
        );
        lastBody = resBody;
      }
      routineSpotifyLog(`✅ Added ${uris.length} tracks to playlist ${playlistId} at position ${position ?? 'end'}`);
      return lastBody;
    } catch (error) {
      this._rethrowIfRateLimited(error, 'addTracksToPlaylist');
      console.error('Error adding tracks to playlist:', error);
      throw error;
    }
  }

  // Remove tracks from playlist (DELETE /v1/playlists/{id}/items; max 100 per request)
  async removeTracksFromPlaylist(playlistId, trackUris) {
    await this._ensureCanCallWebApi('removeTracksFromPlaylist');
    try {
      const uris = this._asSpotifyTrackUris(trackUris);
      if (uris.length === 0) {
        return null;
      }
      const id = String(playlistId);
      const chunkSize = 100;
      let lastBody = null;
      for (let i = 0; i < uris.length; i += chunkSize) {
        const chunk = uris.slice(i, i + chunkSize);
        const items = chunk.map((uri) => ({ uri }));
        const { body: resBody } = await this._webApiRequest(
          'DELETE',
          `/v1/playlists/${encodeURIComponent(id)}/items`,
          { items },
          'removeTracksFromPlaylist'
        );
        lastBody = resBody;
      }
      routineSpotifyLog(`✅ Removed ${uris.length} tracks from playlist ${playlistId}`);
      return lastBody;
    } catch (error) {
      this._rethrowIfRateLimited(error, 'removeTracksFromPlaylist');
      console.error('Error removing tracks from playlist:', error);
      throw error;
    }
  }

  // Replace a track in a playlist (remove old, add new at same position)
  async replaceTrackInPlaylist(playlistId, oldTrackUri, newTrackUri, position = null) {
    await this._ensureCanCallWebApi('replaceTrackInPlaylist');
    try {
      // First, remove the old track
      await this.removeTracksFromPlaylist(playlistId, [oldTrackUri]);
      
      // Then add the new track at the specified position
      await this.addTracksToPlaylist(playlistId, [newTrackUri], position);
      
      routineSpotifyLog(`✅ Replaced track in playlist ${playlistId}: ${oldTrackUri} -> ${newTrackUri} at position ${position || 'end'}`);
      return { success: true };
    } catch (error) {
      this._rethrowIfRateLimited(error, 'replaceTrackInPlaylist');
      console.error('Error replacing track in playlist:', error);
      throw error;
    }
  }
}

Object.assign(SpotifyService, {
  SPOTIFY_SEARCH_LIMIT_DEFAULT,
  SPOTIFY_SEARCH_LIMIT_MAX,
  clampSearchLimit,
  normalizeSearchOffset,
});
module.exports = SpotifyService; 