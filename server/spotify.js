const SpotifyWebApi = require('spotify-web-api-node');
const https = require('https');

class SpotifyService {
  constructor() {
    this.spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:7094/callback'
    });
    
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpirationTime = null;
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

  async withRetries(label, fn, options = {}) {
    const attempts = Math.max(1, options.attempts || 3);
    const baseDelayMs = Math.max(0, options.backoffMs || 250);
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 2)));
        }
        // Ensure token each attempt
        try { await this.ensureValidToken(); } catch (_) {}
        return await fn();
      } catch (err) {
        lastErr = err;
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

  // Get authorization URL for Spotify login
  getAuthorizationURL() {
    const scopes = [
      'user-read-private',
      'user-read-email',
      'playlist-read-private',
      'playlist-read-collaborative',
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing'
    ];

    return this.spotifyApi.createAuthorizeURL(scopes);
  }

  // Handle authorization callback
  async handleCallback(code) {
    try {
      console.log('Handling Spotify callback with code:', code.substring(0, 20) + '...');
      const data = await this.spotifyApi.authorizationCodeGrant(code);
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

  // Get user's playlists
  async getUserPlaylists() {
    await this.ensureValidToken();
    
    try {
      const playlists = [];
      let offset = 0;
      const limit = 50;
      
      while (true) {
        const response = await this.spotifyApi.getUserPlaylists({ limit, offset });
        const items = response.body.items;
        
        if (items.length === 0) break;
        
        playlists.push(...items);
        offset += limit;
        
        if (items.length < limit) break;
      }
      
      return playlists.map(playlist => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        tracks: playlist.tracks.total,
        public: playlist.public,
        collaborative: playlist.collaborative,
        owner: playlist.owner.display_name
      }));
    } catch (error) {
      console.error('Error getting user playlists:', error);
      throw error;
    }
  }

  // Get playlist tracks
  async getPlaylistTracks(playlistId) {
    await this.ensureValidToken();
    
    try {
      const tracks = [];
      let offset = 0;
      const limit = 100;
      
      while (true) {
        const response = await this.spotifyApi.getPlaylistTracks(playlistId, { limit, offset });
        const items = response.body.items;
        
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
            previewUrl: item.track.preview_url || null
          }));
        
        tracks.push(...validTracks);
        offset += limit;
        
        if (items.length < limit) break;
      }
      
      return tracks;
    } catch (error) {
      console.error('Error getting playlist tracks:', error);
      throw error;
    }
  }

  // Get public playlist tracks (for playlists not owned by user)
  async getPublicPlaylistTracks(playlistId) {
    await this.ensureValidToken();
    
    try {
      const response = await this.spotifyApi.getPlaylist(playlistId);
      const tracks = response.body.tracks.items
        .filter(item => item.track && item.track.id)
        .map(item => ({
          id: item.track.id,
          name: item.track.name,
          artist: item.track.artists.map(artist => artist.name).join(', '),
          album: item.track.album.name,
          duration: item.track.duration_ms,
          uri: item.track.uri
        }));
      
      return tracks;
    } catch (error) {
      console.error('Error getting public playlist tracks:', error);
      throw error;
    }
  }

  // Start playback on user's device
  async startPlayback(deviceId, uris, position = 0) {
    await this.ensureValidToken();
    
    try {
      await this.spotifyApi.play({
        device_id: deviceId,
        uris: uris,
        position_ms: position
      });
    } catch (error) {
      console.error('Error starting playback:', error);
      throw error;
    }
  }

  // Pause playback
  async pausePlayback(deviceId) {
    await this.ensureValidToken();
    
    try {
      await this.spotifyApi.pause({ device_id: deviceId });
    } catch (error) {
      console.error('Error pausing playback:', error);
      throw error;
    }
  }

  // Transfer playback to a specific device (assert control)
  async transferPlayback(deviceId, play = true) {
    await this.ensureValidToken();
    try {
      await this.spotifyApi.transferMyPlayback({ deviceIds: [deviceId], play });
      console.log(`🔀 Transferred playback to device ${deviceId} (play=${play})`);
    } catch (error) {
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
    await this.ensureValidToken();
    
    try {
      await this.spotifyApi.play({ device_id: deviceId });
      console.log(`▶️ Resumed playback on ${deviceId}`);
    } catch (error) {
      console.error('Error resuming playback:', error);
      throw error;
    }
  }

  // Skip to next track
  async nextTrack(deviceId) {
    await this.ensureValidToken();
    
    try {
      await this.spotifyApi.skipToNext({ device_id: deviceId });
    } catch (error) {
      console.error('Error skipping to next track:', error);
      throw error;
    }
  }

  // Get user's devices
  async getUserDevices() {
    await this.ensureValidToken();
    
    try {
      const response = await this.spotifyApi.getMyDevices();
      const devices = response.body.devices;
      
      console.log(`Found ${devices.length} devices from Spotify API`);
      devices.forEach(device => {
        console.log(`- ${device.name} (${device.type}) - Active: ${device.is_active}`);
      });
      
      return devices;
    } catch (error) {
      console.error('Error getting user devices:', error);
      throw error;
    }
  }

  // Force device activation by attempting to start playback
  async forceDeviceActivation() {
    await this.ensureValidToken();
    
    try {
      // First, try to get any available devices
      const devices = await this.getUserDevices();
      
      if (devices.length === 0) {
        console.log('No devices available for activation');
        return { success: false, message: 'No devices available' };
      }

      // Try to start playback on the first available device
      const deviceId = devices[0].id;
      console.log(`Attempting to activate device: ${devices[0].name}`);
      
      // Use a short, quiet track or just try to start playback
      try {
        await this.spotifyApi.play({
          device_id: deviceId,
          uris: ['spotify:track:4iV5W9uYEdYUVa79Axb7Rh'] // A short test track
        });
        console.log(`Successfully activated device: ${devices[0].name}`);
        return { success: true, device: devices[0] };
      } catch (playError) {
        console.log(`Could not start playback on ${devices[0].name}, but device is available`);
        return { success: true, device: devices[0] };
      }
    } catch (error) {
      console.error('Error forcing device activation:', error);
      throw error;
    }
  }

  // Activate a specific device by transferring and briefly starting a test track
  async activateDevice(deviceId, pauseAfterMs = 0) {
    await this.ensureValidToken();
    try {
      await this.transferPlayback(deviceId, true);
      try {
        await this.spotifyApi.play({
          device_id: deviceId,
          uris: ['spotify:track:4iV5W9uYEdYUVa79Axb7Rh']
        });
      } catch (_) {
        // If play fails, it's fine; device may still become active
      }
      // Optionally pause shortly after to avoid audible blip
      if (pauseAfterMs > 0) {
        setTimeout(async () => {
          try { await this.pausePlayback(deviceId); } catch (_) {}
        }, pauseAfterMs);
      }
      return true;
    } catch (error) {
      console.error('Error activating device:', error);
      return false;
    }
  }

  // Get currently playing track
  async getCurrentTrack() {
    await this.ensureValidToken();
    
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
      console.error('Error getting current track:', error);
      throw error;
    }
  }

  // Search for playlists
  async searchPlaylists(query, limit = 20) {
    await this.ensureValidToken();
    
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
      console.error('Error searching playlists:', error);
      throw error;
    }
  }

  // Set volume
  async setVolume(volume, deviceId) {
    await this.ensureValidToken();
    
    try {
      await this.spotifyApi.setVolume(volume, { device_id: deviceId });
      console.log(`✅ Volume set to ${volume}% on device ${deviceId}`);
    } catch (error) {
      console.error('Error setting volume:', error);
      throw error;
    }
  }

  // Seek to position
  async seekToPosition(position, deviceId) {
    await this.ensureValidToken();
    
    try {
      // Spotify API expects milliseconds
      await this.spotifyApi.seek(position, { device_id: deviceId });
      console.log(`✅ Seeked to ${position}ms on device ${deviceId}`);
    } catch (error) {
      console.error('Error seeking:', error);
      throw error;
    }
  }

  // Get full current playback state (raw Spotify shape)
  async getCurrentPlaybackState() {
    await this.ensureValidToken();
    try {
      const response = await this.spotifyApi.getMyCurrentPlaybackState();
      return response.body || null;
    } catch (error) {
      console.error('Error getting current playback state:', error);
      throw error;
    }
  }

  // Set shuffle state
  async setShuffleState(state, deviceId) {
    await this.ensureValidToken();
    try {
      await this.spotifyApi.setShuffle(state, { device_id: deviceId });
      console.log(`✅ Shuffle ${state ? 'enabled' : 'disabled'} on device ${deviceId || '(default)'}`);
    } catch (error) {
      console.error('Error setting shuffle state:', error);
      throw error;
    }
  }

  // Set repeat state: 'track' | 'context' | 'off'
  async setRepeatState(state, deviceId) {
    await this.ensureValidToken();
    try {
      await this.spotifyApi.setRepeat(state, { device_id: deviceId });
      console.log(`✅ Repeat set to ${state} on device ${deviceId || '(default)'}`);
    } catch (error) {
      console.error('Error setting repeat state:', error);
      throw error;
    }
  }

  // Previous track
  async previousTrack(deviceId) {
    await this.ensureValidToken();
    try {
      await this.spotifyApi.skipToPrevious({ device_id: deviceId });
    } catch (error) {
      console.error('Error going to previous track:', error);
      throw error;
    }
  }

  // Add to queue
  async addToQueue(uri, deviceId) {
    await this.ensureValidToken();
    try {
      await this.spotifyApi.addToQueue(uri, { device_id: deviceId });
      console.log(`✅ Added to queue: ${uri} on device ${deviceId || '(default)'}`);
    } catch (error) {
      console.error('Error adding to queue:', error);
      throw error;
    }
  }

  // Get current user profile (to verify correct Spotify account)
  async getCurrentUserProfile() {
    await this.ensureValidToken();
    try {
      const response = await this.spotifyApi.getMe();
      const b = response.body || {};
      return {
        id: b.id,
        display_name: b.display_name,
        email: b.email,
        product: b.product,
        country: b.country
      };
    } catch (error) {
      console.error('Error getting current user profile:', error);
      throw error;
    }
  }
}

module.exports = SpotifyService; 