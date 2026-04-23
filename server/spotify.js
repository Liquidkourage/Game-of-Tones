const SpotifyWebApi = require('spotify-web-api-node');
const https = require('https');

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
 * Spotify may send Retry-After of 86400+ seconds when restricting an app; honoring that
 * in-process would block every Web API call for 24h and the host UI shows no playlists.
 * We still back off, but cap so the server can retry after a few minutes (logging the raw value).
 */
const SPOTIFY_QUARANTINE_MAX_MS = 15 * 60 * 1000;

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
   * Call from any Web API method that receives 429.
   */
  applyRateLimitQuarantine(error, source) {
    if (!this.isRateLimitError(error)) return;
    const now = Date.now();
    const raSec = this.getRetryAfterSecFromError(error);
    const rawWaitMs =
      raSec > 0
        ? Math.min(86400 * 1000, raSec * 1000)
        : Math.min(3600 * 1000, 60_000);
    const waitMs = Math.min(rawWaitMs, SPOTIFY_QUARANTINE_MAX_MS);
    this._spotifyQuarantineUntil = Math.max(this._spotifyQuarantineUntil || 0, now + waitMs);
    this._playbackStateBackoffUntil = Math.max(this._playbackStateBackoffUntil || 0, now + waitMs);
    if (now - (this._lastGlobal429LogAt || 0) > 120_000) {
      this._lastGlobal429LogAt = now;
      const untilIso = new Date(this._spotifyQuarantineUntil).toISOString();
      const capped = rawWaitMs > SPOTIFY_QUARANTINE_MAX_MS;
      console.warn(
        `⚠️ Spotify 429 [${source}] — pausing API calls until ${untilIso} (Retry-After from Spotify: ${
          raSec || 'n/a'
        }s${capped ? `; capped to ${SPOTIFY_QUARANTINE_MAX_MS / 1000}s for in-process backoff` : ''}). If this persists, check the app status in Spotify Developer Dashboard.`
      );
    }
  }

  isQuarantined() {
    return Date.now() < (this._spotifyQuarantineUntil || 0);
  }

  getQuarantineRemainingSec() {
    return Math.max(0, Math.ceil(((this._spotifyQuarantineUntil || 0) - Date.now()) / 1000));
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

  _rethrowIfRateLimited(error, label) {
    if (this.isRateLimitError(error)) {
      this.applyRateLimitQuarantine(error, label);
    }
  }

  /**
   * Raw GET to api.spotify.com (used for /items where the Node SDK still maps older paths).
   */
  _webApiGet(path, label) {
    return new Promise((resolve, reject) => {
      if (this.isQuarantined()) {
        return reject(this._makeQuarantineError(label));
      }
      if (!this.accessToken) {
        return reject(new Error('No access token'));
      }
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
            if (sc >= 200 && sc < 300) {
              return resolve({ body, statusCode: sc, headers: res.headers });
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
                label
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
   * GET /v1/playlists/{id}/items — see https://developer.spotify.com/documentation/web-api/reference/get-playlists-items
   */
  async _fetchPlaylistItemsPage(playlistId, { limit = 100, offset = 0, market = null } = {}) {
    const cap = Math.min(100, Math.max(1, limit));
    const q = new URLSearchParams();
    q.set('limit', String(cap));
    q.set('offset', String(offset));
    q.set('additional_types', 'track');
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
      console.log('Handling Spotify callback with code:', code.substring(0, 20) + '...');
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
      console.log('Successfully got tokens from Spotify');
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
      console.error('Error getting Spotify tokens:', error);
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
      const data = await this.spotifyApi.refreshAccessToken();
      this.accessToken = data.body.access_token;
      this.tokenExpirationTime = Date.now() + (data.body.expires_in * 1000);
      this.spotifyApi.setAccessToken(this.accessToken);
      
      return this.accessToken;
    } catch (error) {
      console.error('Error refreshing Spotify token:', error);
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

  /** Track count on list-playlist items (Spotify: tracks.total). */
  _playlistItemsTotalFromListItem(playlist) {
    const t = playlist && playlist.tracks;
    if (!t || typeof t !== 'object') return 0;
    const n = Number(t.total);
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

  // Get user's playlists
  async getUserPlaylists() {
    await this._ensureCanCallWebApi('getUserPlaylists');

    try {
      const raw = [];
      let offset = 0;
      const limit = 50;
      let spotifyListTotal = null;
      let isFirst = true;

      // Use direct Web API so `tracks.total` matches Spotify JSON (Node SDK can omit/reshape fields).
      while (true) {
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
        offset += limit;

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
    
    try {
      const tracks = [];
      let offset = 0;
      const limit = 100;
      
      while (true) {
        const page = await this._fetchPlaylistItemsPage(playlistId, { limit, offset });
        const items = page.items || [];
        
        if (items.length === 0) break;
        
        // Filter out non-track items and map to our format
        const validTracks = items
          .filter(item => item.track && item.track.id)
          .map(item => ({
            id: item.track.id,
            name: item.track.name,
            artist: item.track.artists.map(artist => artist.name).join(', '),
            album: item.track.album.name,
            duration: item.track.duration_ms,
            uri: item.track.uri,
            previewUrl: item.track.preview_url || null,
            explicit: item.track.explicit === true,
            sourcePlaylistId: playlistId,
            sourcePlaylistName: playlistInfo?.name || 'Unknown Playlist'
          }));
        
        tracks.push(...validTracks);
        offset += limit;
        
        if (items.length < limit) break;
      }
      
      return tracks;
    } catch (error) {
      this._rethrowIfRateLimited(error, 'getPlaylistTracks');
      console.error('Error getting playlist tracks:', error);
      throw error;
    }
  }

  /**
   * Count total tracks and tracks marked explicit by Spotify (paginated; prefers minimal `fields`).
   */
  async getPlaylistExplicitStats(playlistId) {
    await this._ensureCanCallWebApi('getPlaylistExplicitStats');
    const pid = String(playlistId || '').trim();
    if (!pid) throw new Error('playlist id required');
    // Full track payload so `explicit` is always present (minimal `fields` can omit or break nested props on some API responses).
    let offset = 0;
    const limit = 100;
    let total = 0;
    let explicitCount = 0;
    try {
      while (true) {
        const page = await this._fetchPlaylistItemsPage(pid, { limit, offset });
        const items = page.items || [];
        if (items.length === 0) break;
        for (const item of items) {
          const t = item.track;
          if (!t || !t.id) continue;
          total++;
          if (t.explicit === true) explicitCount++;
        }
        offset += limit;
        if (items.length < limit) break;
      }
    } catch (e) {
      this._rethrowIfRateLimited(e, 'getPlaylistExplicitStats');
      throw e;
    }
    return { total, explicitCount };
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
      console.log(`🔀 Transferred playback to device ${deviceId} (play=${play})`);
    } catch (error) {
      this._rethrowIfRateLimited(error, 'transferPlayback');
      const msg = error?.body?.error?.message || error?.message || '';
      console.warn('⚠️ transferMyPlayback failed:', msg);
      // Fallback: send raw request if Spotify complains about JSON shape
      if (/Malformed json/i.test(msg)) {
        console.log('🔧 Falling back to direct HTTP transfer request');
        const ok = await this._transferPlaybackDirect(deviceId, !!play);
        if (ok) return;
      }
      throw error;
    }
  }

  _transferPlaybackDirect(deviceId, play) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ device_ids: [deviceId], play: !!play });
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
          console.log('✅ Direct transfer success');
          resolve(true);
        } else {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 429) {
              const err = new Error('Direct transfer rate limited');
              err.statusCode = 429;
              const ra = res.headers && (res.headers['retry-after'] || res.headers['Retry-After']);
              err.headers = { 'retry-after': ra != null ? String(ra) : '3600' };
              this.applyRateLimitQuarantine(err, '_transferPlaybackDirect');
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
      console.log(`▶️ Resumed playback on ${deviceId}`);
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
        console.log(`Found ${devices.length} devices from Spotify API`);
        devices.forEach((device) => {
          console.log(`- ${device.name} (${device.type}) - Active: ${device.is_active}`);
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
        console.log('No devices available for activation');
        return { success: false, message: 'No devices available' };
      }
      const deviceId = devices[0].id;
      const deviceName = devices[0].name;
      try {
        await this.transferPlayback(deviceId, false);
        try { await this.setShuffleState(false, deviceId); } catch (_) {}
        try { await this.setRepeatState('off', deviceId); } catch (_) {}
        console.log(`Successfully asserted control on device without playback: ${deviceName}`);
      } catch (_) {
        console.log(`Could not assert control on ${deviceName}, but device is available`);
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

  // Search for playlists
  async searchPlaylists(query, limit = 20) {
    await this._ensureCanCallWebApi('searchPlaylists');
    
    try {
      const response = await this.spotifyApi.searchPlaylists(query, { limit });
      return response.body.playlists.items.map(playlist => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        tracks: playlist.tracks.total,
        public: playlist.public,
        collaborative: playlist.collaborative,
        owner: playlist.owner.display_name,
        images: playlist.images
      }));
    } catch (error) {
      this._rethrowIfRateLimited(error, 'searchPlaylists');
      console.error('Error searching playlists:', error);
      throw error;
    }
  }

  // Search for tracks
  async searchTracks(query, limit = 20) {
    await this._ensureCanCallWebApi('searchTracks');
    
    try {
      const response = await this.spotifyApi.searchTracks(query, { limit });
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
      console.log(`✅ Volume set to ${volume}% on device ${deviceId}`);
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
      console.log(`✅ Seeked to ${position}ms on device ${deviceId}`);
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
      console.log(`✅ Shuffle ${state ? 'enabled' : 'disabled'} on device ${deviceId || '(default)'}`);
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
      console.log(`✅ Repeat set to ${state} on device ${deviceId || '(default)'}`);
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
      console.log(`🧹 Queue clearing attempted on device ${deviceId}`);
    } catch (error) {
      console.warn('⚠️ Queue clearing failed (non-fatal):', error?.message || error);
    }
  }

  // Create a temporary playlist for context-based playback
  async createTemporaryPlaylist(name, trackUris) {
    await this._ensureCanCallWebApi('createTemporaryPlaylist');
    try {
      // Get current user
      const userResponse = await this.spotifyApi.getMe();
      const userId = userResponse.body.id;
      
      const organizedName = `${GOT_OUTPUT_PLAYLIST_NAME_PREFIX}${name}`;
      
      // Create playlist
      const playlistResponse = await this.spotifyApi.createPlaylist(userId, {
        name: organizedName,
        description: 'Generated by TEMPO Music Bingo - Game Of Tones Output Playlist',
        public: false
      });
      
      const playlistId = playlistResponse.body.id;
      
      // Add tracks to playlist in chunks (Spotify limit is 100 per request)
      const chunkSize = 100;
      for (let i = 0; i < trackUris.length; i += chunkSize) {
        const chunk = trackUris.slice(i, i + chunkSize);
        await this.spotifyApi.addTracksToPlaylist(playlistId, chunk);
      }
      
      console.log(`✅ Created organized playlist: ${organizedName} with ${trackUris.length} tracks`);
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
      // Get current user
      const userResponse = await this.spotifyApi.getMe();
      const userId = userResponse.body.id;
      
      const organizedName = `${GOT_OUTPUT_PLAYLIST_NAME_PREFIX}${name}`;
      
      // Create playlist
      const playlistResponse = await this.spotifyApi.createPlaylist(userId, {
        name: organizedName,
        description: description || 'Permanent output playlist from TEMPO Music Bingo',
        public: false
      });
      
      const playlistId = playlistResponse.body.id;
      
      // Add tracks to playlist in chunks (Spotify limit is 100 per request)
      const chunkSize = 100;
      for (let i = 0; i < trackUris.length; i += chunkSize) {
        const chunk = trackUris.slice(i, i + chunkSize);
        await this.spotifyApi.addTracksToPlaylist(playlistId, chunk);
      }
      
      console.log(`✅ Created permanent output playlist: ${organizedName} with ${trackUris.length} tracks`);
      return { playlistId, name: organizedName };
    } catch (error) {
      this._rethrowIfRateLimited(error, 'createOutputPlaylist');
      console.error('Error creating output playlist:', error);
      throw error;
    }
  }

  // Get user's Game Of Tones output playlists
  async getGameOfTonesPlaylists() {
    await this._ensureCanCallWebApi('getGameOfTonesPlaylists');
    try {
      // Get current user
      const userResponse = await this.spotifyApi.getMe();
      const userId = userResponse.body.id;
      
      // Get user's playlists
      const playlists = [];
      let offset = 0;
      const limit = 50;
      
      while (true) {
        const response = await this.spotifyApi.getUserPlaylists(userId, { limit, offset });
        const batch = response.body.items;
        
        // Only playlists the app created with GOT_OUTPUT_PLAYLIST_NAME_PREFIX
        const gotPlaylists = batch.filter(playlist =>
          typeof playlist.name === 'string' &&
          playlist.name.startsWith(GOT_OUTPUT_PLAYLIST_NAME_PREFIX) &&
          playlist.owner.id === userId
        );
        
        playlists.push(...gotPlaylists.map(playlist => ({
          id: playlist.id,
          name: playlist.name,
          trackCount: playlist.tracks.total,
          createdAt: playlist.added_at || 'Unknown',
          description: playlist.description || '',
          external_urls: playlist.external_urls
        })));
        
        // Check if we have more playlists to fetch
        if (batch.length < limit) break;
        offset += limit;
      }
      
      console.log(`✅ Found ${playlists.length} Game Of Tones output playlists`);
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
    console.log(
      `🧹 Auto-cleared ${deleted} prior GOT output playlist(s) (${failed} failed)`
    );
    return { deleted, failed, results };
  }

  // Delete multiple playlists.
  // When requireGotOutputPrefix is true (Manager cleanup / #32), each ID must be owned by
  // the current user and name must start with GOT_OUTPUT_PLAYLIST_NAME_PREFIX.
  async deleteMultiplePlaylists(playlistIds, options = {}) {
    const { requireGotOutputPrefix = false } = options;
    await this._ensureCanCallWebApi('deleteMultiplePlaylists');
    const results = [];

    let userId = null;
    if (requireGotOutputPrefix) {
      const userResponse = await this.spotifyApi.getMe();
      userId = userResponse.body.id;
    }

    for (const playlistId of playlistIds) {
      try {
        if (requireGotOutputPrefix) {
          const pl = await this.spotifyApi.getPlaylist(playlistId);
          const body = pl.body;
          if (body.owner.id !== userId) {
            results.push({
              playlistId,
              success: false,
              error: 'Playlist not owned by current user'
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
                ')'
            });
            continue;
          }
        }
        await this.spotifyApi.unfollowPlaylist(playlistId);
        results.push({ playlistId, success: true });
        console.log(`✅ Deleted playlist: ${playlistId}`);
      } catch (error) {
        console.error(`❌ Failed to delete playlist ${playlistId}:`, error);
        results.push({ playlistId, success: false, error: error.message });
      }
    }

    return results;
  }

  // Delete a temporary playlist
  async deleteTemporaryPlaylist(playlistId) {
    await this._ensureCanCallWebApi('deleteTemporaryPlaylist');
    try {
      await this.spotifyApi.unfollowPlaylist(playlistId);
      console.log(`✅ Deleted temporary playlist: ${playlistId}`);
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
      
      console.log(`✅ Started playlist playback: track ${trackIndex} at ${positionMs}ms`);
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
      console.log(`✅ Added to queue: ${uri} on device ${deviceId || '(default)'}`);
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

  // Add tracks to playlist
  async addTracksToPlaylist(playlistId, trackUris, position = null) {
    await this._ensureCanCallWebApi('addTracksToPlaylist');
    try {
      const options = {};
      if (position !== null) {
        options.position = position;
      }
      
      const response = await this.spotifyApi.addTracksToPlaylist(playlistId, trackUris, options);
      console.log(`✅ Added ${trackUris.length} tracks to playlist ${playlistId} at position ${position || 'end'}`);
      return response.body;
    } catch (error) {
      this._rethrowIfRateLimited(error, 'addTracksToPlaylist');
      console.error('Error adding tracks to playlist:', error);
      throw error;
    }
  }

  // Remove tracks from playlist
  async removeTracksFromPlaylist(playlistId, trackUris) {
    await this._ensureCanCallWebApi('removeTracksFromPlaylist');
    try {
      // Convert track URIs to the format expected by removeTracksFromPlaylist
      const tracksToRemove = trackUris.map(uri => ({ uri }));
      
      const response = await this.spotifyApi.removeTracksFromPlaylist(playlistId, tracksToRemove);
      console.log(`✅ Removed ${trackUris.length} tracks from playlist ${playlistId}`);
      return response.body;
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
      
      console.log(`✅ Replaced track in playlist ${playlistId}: ${oldTrackUri} -> ${newTrackUri} at position ${position || 'end'}`);
      return { success: true };
    } catch (error) {
      this._rethrowIfRateLimited(error, 'replaceTrackInPlaylist');
      console.error('Error replacing track in playlist:', error);
      throw error;
    }
  }
}

module.exports = SpotifyService; 