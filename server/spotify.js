const SpotifyWebApi = require('spotify-web-api-node');

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
            uri: item.track.uri
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
      console.error('Error transferring playback:', error);
      throw error;
    }
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
      // Convert milliseconds to seconds for Spotify API
      const positionSeconds = Math.floor(position / 1000);
      await this.spotifyApi.seek(positionSeconds, { device_id: deviceId });
      console.log(`✅ Seeked to ${positionSeconds}s on device ${deviceId}`);
    } catch (error) {
      console.error('Error seeking:', error);
      throw error;
    }
  }
}

module.exports = SpotifyService; 