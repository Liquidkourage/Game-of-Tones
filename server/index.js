const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { OAuth2Client } = require('google-auth-library');
const SpotifyService = require('./spotify');
const fs = require('fs');
const path = require('path');
const hostAuth = require('./hostAuth');
const usersStore = require('./users');
const organizationsStore = require('./organizations');
const credentialCrypto = require('./credentialCrypto');

/**
 * Run async work over `ids` with bounded concurrency (Spotify explicit-stats batch was
 * sequential before — dozens of playlists × pagination could take minutes).
 */
async function mapPlaylistIdsWithConcurrency(ids, concurrency, fn) {
  const results = Object.create(null);
  if (!ids || ids.length === 0) return results;
  const n = Math.min(Math.max(1, concurrency), ids.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= ids.length) return;
      const id = ids[i];
      try {
        results[id] = await fn(id);
      } catch (e) {
        results[id] = { error: e?.message || 'failed' };
      }
    }
  };
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// Song title cleaning utility
function cleanSongTitle(title) {
  if (!title || typeof title !== 'string') {
    return title;
  }

  let cleaned = title.trim();

  // Remove remastered versions
  // Handle specific patterns first (most specific to least specific)
  cleaned = cleaned.replace(/\s*\(\d{4}\s+remastered\s+version\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(\d{4}\s+remaster\s+version\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(\d{4}\s+remastered\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(\d{4}\s+remaster\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*\d{4}\s+remastered\s+version\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*\d{4}\s+remaster\s+version\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*\d{4}\s+remastered\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*\d{4}\s+remaster\s*$/i, '');
  // Handle generic patterns
  cleaned = cleaned.replace(/\s*-\s*remastered\s*\d*\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(remastered\s*\d*\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\[remastered\s*\d*\]\s*$/i, '');
  cleaned = cleaned.replace(/\s*remastered\s*\d*\s*$/i, '');

  // Remove live versions
  cleaned = cleaned.replace(/\s*-\s*live\s*at\s*[^)]*\)?\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(live\s*at\s*[^)]*\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\[live\s*at\s*[^\]]*\]\s*$/i, '');
  cleaned = cleaned.replace(/\s*live\s*at\s*[^)]*\)?\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*live\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(live\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\[live\]\s*$/i, '');

  // Remove explicit/clean versions
  cleaned = cleaned.replace(/\s*-\s*explicit\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*clean\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(explicit\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(clean\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\[explicit\]\s*$/i, '');
  cleaned = cleaned.replace(/\s*\[clean\]\s*$/i, '');

  // Remove version indicators
  cleaned = cleaned.replace(/\s*-\s*single\s*version\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*radio\s*edit\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*album\s*version\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*extended\s*version\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*short\s*version\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*instrumental\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*acoustic\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*studio\s*version\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(single\s*version\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(radio\s*edit\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(album\s*version\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(extended\s*version\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(instrumental\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(acoustic\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(studio\s*version\)\s*$/i, '');

  // Remove years
  cleaned = cleaned.replace(/\s*-\s*\d{4}\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(\d{4}\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\[\d{4}\]\s*$/i, '');

  // Remove parenthetical content
  cleaned = cleaned.replace(/\s*\(feat\.?\s*[^)]*\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(featuring\s*[^)]*\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(with\s*[^)]*\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(from\s*[^)]*\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(soundtrack\s*version\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(original\s*motion\s*picture\s*soundtrack\)\s*$/i, '');

  // Remove leading/trailing dashes and clean up spacing
  cleaned = cleaned.replace(/^\s*-\s*/, '');
  cleaned = cleaned.replace(/\s*-\s*$/, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // If we've cleaned too much, return original
  if (cleaned.length < 3) {
    return title.trim();
  }

  return cleaned;
}

// Database connection for persistent token storage
let db = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  console.log('🗄️ Database connection initialized');
} else {
  console.log('⚠️ No DATABASE_URL found - using file-based storage (not persistent on Railway)');
}

// Enhanced logging with production optimization
class Logger {
  constructor() {
    this.logCounts = new Map();
    this.isProduction = process.env.NODE_ENV === 'production';
    this.quietMode = process.env.QUIET_MODE === '1';
    this.resetInterval = setInterval(() => {
      this.logCounts.clear();
    }, 60000); // Reset counts every minute
  }

  throttle(key, maxPerMinute = 10) {
    const count = this.logCounts.get(key) || 0;
    if (count >= maxPerMinute) return false;
    this.logCounts.set(key, count + 1);
    return true;
  }

  // Production-safe logging methods
  log(message, throttleKey = null, maxPerMinute = 30) {
    if (this.quietMode) return;
    if (throttleKey && !this.throttle(throttleKey, maxPerMinute)) return;
    console.log(message);
  }

  // Debug logs are suppressed in production unless explicitly enabled
  debug(message, throttleKey = null, maxPerMinute = 5) {
    if (this.isProduction && !process.env.DEBUG) return;
    if (throttleKey && !this.throttle(throttleKey, maxPerMinute)) return;
    console.log(`[DEBUG] ${message}`);
  }

  // Info logs are throttled more aggressively in production
  info(message, throttleKey = null, maxPerMinute = 10) {
    const limit = this.isProduction ? Math.min(maxPerMinute, 5) : maxPerMinute;
    if (throttleKey && !this.throttle(throttleKey, limit)) return;
    console.log(message);
  }

  warn(message, throttleKey = null, maxPerMinute = 10) {
    if (throttleKey && !this.throttle(throttleKey, maxPerMinute)) return;
    console.warn(message);
  }

  error(message, throttleKey = null, maxPerMinute = 10) {
    if (throttleKey && !this.throttle(throttleKey, maxPerMinute)) return;
    console.error(message);
  }
}

const logger = new Logger();
require('dotenv').config();

// Environment validation for critical variables
function validateEnvironment() {
  const requiredVars = {
    'SPOTIFY_CLIENT_ID': 'Spotify API client ID',
    'SPOTIFY_CLIENT_SECRET': 'Spotify API client secret',
    'SPOTIFY_REDIRECT_URI': 'Spotify OAuth redirect URI'
  };

  const missing = [];
  for (const [key, description] of Object.entries(requiredVars)) {
    if (!process.env[key]) {
      missing.push(`${key} (${description})`);
    }
  }

  if (missing.length > 0) {
    console.error('❌ CRITICAL: Missing required environment variables:');
    missing.forEach(var_ => console.error(`   - ${var_}`));
    console.error('\n📋 Set these in Railway dashboard or your .env file');
    console.error('🚫 Server cannot start without Spotify credentials');
    process.exit(1);
  }

  // Validate production-specific settings
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CORS_ORIGINS) {
      console.warn('⚠️  WARNING: CORS_ORIGINS not set in production - this allows ALL origins');
      console.warn('   Set CORS_ORIGINS to your production domain for security');
    }
  }

  console.log('✅ Environment validation passed');
}

// Validate environment before starting
validateEnvironment();

const app = express();
// Logging verbosity
const VERBOSE = process.env.VERBOSE_LOGS === '1' || process.env.DEBUG === '1';
const QUIET_MODE = process.env.QUIET_MODE === '1'; // Reduce logging for production
const server = http.createServer(app);
const clientBuildPath = path.join(__dirname, '..', 'client', 'build');
const hasClientBuild = fs.existsSync(clientBuildPath);
console.log('NODE_ENV:', process.env.NODE_ENV, 'Client build exists:', hasClientBuild, 'at', clientBuildPath);

// CORS configuration
const isProduction = process.env.NODE_ENV === 'production';
const allowedOriginsEnv = process.env.CORS_ORIGINS || '';

// Security fix: Only allow all CORS if explicitly set to '*'
const allowAllCors = allowedOriginsEnv === '*';

const allowedOrigins = allowedOriginsEnv && allowedOriginsEnv !== '*'
  ? allowedOriginsEnv.split(',').map(s => s.trim()).filter(Boolean)
  : ["http://127.0.0.1:7094", "http://localhost:7094", "http://127.0.0.1:3002", "http://localhost:3002"];

/** Same origin as publicAppOrigin() below — merged into CORS so production works when CORS_ORIGINS is unset. */
function getPublicAppOriginForCors() {
  const raw = (process.env.PUBLIC_APP_URL || process.env.CLIENT_APP_URL || '').trim();
  if (!raw) return '';
  let s = raw;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s).origin;
  } catch {
    return '';
  }
}

const publicAppOriginForCors = getPublicAppOriginForCors();
const corsAllowedOrigins = [...new Set([...allowedOrigins, publicAppOriginForCors].filter(Boolean))];

// Log CORS configuration for debugging
if (isProduction) {
  if (allowAllCors) {
    console.log('🔓 CORS: Allowing ALL origins (*)');
  } else {
    console.log('🔒 CORS: Restricting to origins:', corsAllowedOrigins);
  }
}

const io = socketIo(server, {
  cors: {
    origin: allowAllCors ? '*' : corsAllowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: function (origin, callback) {
    if (allowAllCors) {
      return callback(null, true);
    }
    // Allow no origin (same-origin) or any in allowlist
    if (!origin || corsAllowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Note: production static serving is registered after API routes below

// Game state management
const games = new Map();
const rooms = new Map();

// Store custom song titles (songId -> customTitle)
const customSongTitles = new Map();
const PREQUEUE_WINDOW_DEFAULT = 10;
// Utility: count non-host players in a room
function getNonHostPlayerCount(room) {
  if (!room) return 0;
  let count = 0;
  for (const player of room.players.values()) {
    // Exclude host and display connections from the visible player count
    const isDisplay = typeof player.name === 'string' && /display/i.test(player.name);
    if (!player.isHost && !isDisplay) count++;
  }
  return count;
}

// Token storage file path
const TOKEN_FILE = path.join(__dirname, 'spotify_tokens.json');
// Device storage file path
const DEVICE_FILE = path.join(__dirname, 'spotify_device.json');

// Load tokens from environment variables or file
function loadTokens() {
  try {
    // First try environment variables (for Railway deployment persistence)
    if (process.env.SPOTIFY_ACCESS_TOKEN && process.env.SPOTIFY_REFRESH_TOKEN) {
      console.log('🌍 Loaded Spotify tokens from environment variables');
      return {
        accessToken: process.env.SPOTIFY_ACCESS_TOKEN,
        refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
        expiresIn: 3600 // Default 1 hour, will be refreshed automatically
      };
    }
    
    // Fallback to file (for local development)
    if (fs.existsSync(TOKEN_FILE)) {
      const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      console.log('📁 Loaded Spotify tokens from file');
      return tokenData;
    }
  } catch (error) {
    console.error('❌ Error loading tokens:', error);
  }
  return null;
}

// Save tokens to file and log environment variable instructions
function saveTokens(tokens) {
  try {
    // Save to file (for local development)
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    logger.debug('💾 Saved Spotify tokens to file', 'save-tokens');
    
    // Log environment variable instructions for Railway deployment
    console.log('🚀 To persist Spotify tokens across Railway deployments, set these environment variables:');
    console.log(`   SPOTIFY_ACCESS_TOKEN=${tokens.accessToken}`);
    console.log(`   SPOTIFY_REFRESH_TOKEN=${tokens.refreshToken}`);
    console.log('   Add these in your Railway project settings under "Variables"');
    
  } catch (error) {
    console.error('❌ Error saving tokens to file:', error);
  }
}

// Load saved device from file (legacy single file, no host user)
function loadSavedDevice() {
  try {
    if (fs.existsSync(DEVICE_FILE)) {
      const deviceData = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
      logger.debug('📁 Loaded saved device:', deviceData.name, 'load-device');
      return deviceData;
    }
  } catch (error) {
    console.error('❌ Error loading device from file:', error);
  }
  return null;
}

function deviceFileForUserId(uid) {
  if (uid == null || !Number.isFinite(Number(uid))) return DEVICE_FILE;
  return path.join(__dirname, `spotify_device_user_${Number(uid)}.json`);
}

function loadSavedDeviceForUser(uid) {
  try {
    const file = deviceFileForUserId(uid);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (error) {
    console.error('❌ Error loading device for user:', error);
  }
  return null;
}

/** Prefer host-owned room's saved device (per Spotify account). */
function loadSavedDeviceForRoom(roomId) {
  const room = rooms.get(roomId);
  const uid = room?.ownerUserId;
  if (uid != null && Number.isFinite(Number(uid))) {
    const d = loadSavedDeviceForUser(Number(uid));
    if (d) return d;
  }
  return loadSavedDevice();
}

// Save device to file
function saveDevice(device) {
  try {
    fs.writeFileSync(DEVICE_FILE, JSON.stringify(device, null, 2), 'utf8');
    console.log('💾 Saved device to file:', device.name);
  } catch (error) {
    console.error('❌ Error saving device to file:', error);
  }
}

function saveDeviceForUser(uid, device) {
  try {
    const file = deviceFileForUserId(uid);
    fs.writeFileSync(file, JSON.stringify(device, null, 2), 'utf8');
    console.log(`💾 Saved device for host user ${uid}:`, device.name);
  } catch (error) {
    console.error('❌ Error saving device for user:', error);
  }
}

// Timer management functions
function clearRoomTimer(roomId) {
  if (roomTimers.has(roomId)) {
    const room = rooms.get(roomId);
    const currentTime = Date.now();
    if (VERBOSE) {
    console.log(`🔍 TIMER CLEARED - Room: ${roomId}, Time: ${currentTime}`);
    console.log(`🔍 Reason: Manual interruption (skip/pause/previous)`);
    console.log(`🔍 Current Song: ${room?.currentSong?.name} by ${room?.currentSong?.artist}`);
    console.log(`🔍 Stack trace:`, new Error().stack?.split('\n').slice(1, 4).join('\n'));
    }
    
    clearTimeout(roomTimers.get(roomId));
    roomTimers.delete(roomId);
    console.log(`⏰ Cleared timer for room: ${roomId}`);
  }
}

function setRoomTimer(roomId, callback, delay) {
  // Clear any existing timer for this room
  clearRoomTimer(roomId);
  
  // Use exact delay - no buffer manipulation
  const actualDelay = delay;
  
  // Set new timer
  const timerId = setTimeout(() => {
    const room = rooms.get(roomId);
    const currentTime = Date.now();
    if (VERBOSE) {
    console.log(`🔍 TIMER FIRED - Room: ${roomId}, Time: ${currentTime}, Expected Duration: ${delay}ms, Actual Duration: ${actualDelay}ms`);
    console.log(`🔍 Room State - GameState: ${room?.gameState}, CurrentSongIndex: ${room?.currentSongIndex}, TotalSongs: ${room?.playlistSongs?.length}`);
    console.log(`🔍 Current Song - ${room?.currentSong?.name} by ${room?.currentSong?.artist}`);
    console.log(`🔍 Room exists: ${!!room}, Room ID: ${room?.id}`);
    }
    
    roomTimers.delete(roomId);
    if (VERBOSE) console.log(`🔍 About to execute callback for room ${roomId}`);
    callback();
    if (VERBOSE) console.log(`🔍 Callback executed for room ${roomId}`);
  }, actualDelay);
  
  roomTimers.set(roomId, timerId);
  console.log(`⏰ Set timer for room ${roomId}: ${actualDelay}ms (${actualDelay/1000}s)`);
}

// Play song at specific index without changing the index
async function playSongAtIndex(roomId, deviceId, songIndex) {
  console.log(`🎵 Playing song at index ${songIndex} for room:`, roomId);
  const room = rooms.get(roomId);
  if (!room || room.gameState !== 'playing' || !room.playlistSongs) {
    console.log('❌ Cannot play song: Room not in playing state or no playlist songs');
    return;
  }

  try {
    const song = room.playlistSongs[songIndex];
    console.log(`🎵 Playing song ${songIndex + 1}/${room.playlistSongs.length}: ${song.name} by ${song.artist}`);

    // STRICT device control: use provided device or saved device only
    let targetDeviceId = deviceId;
    if (!targetDeviceId) {
      const savedDevice = loadSavedDeviceForRoom(roomId);
      if (savedDevice) {
        targetDeviceId = savedDevice.id;
        console.log(`🎵 Using saved device for song: ${savedDevice.name}`);
      }
    }
    if (!targetDeviceId) {
      console.error('❌ Strict mode: no locked device available for playback');
      io.to(roomId).emit('playback-error', { message: 'Locked device not available. Open Spotify on your chosen device or reselect in Host.' });
          return;
    }

    try {
      await spotifyFor(roomId).withRetries('transferPlayback(initial)', () => spotifyFor(roomId).transferPlayback(targetDeviceId, false), { attempts: 3, backoffMs: 300 });
    } catch (e) {
      console.warn('⚠️ Transfer playback failed (will still try play):', e?.message || e);
    }
    console.log(`🎵 Starting playback on device: ${targetDeviceId}`);

    try {
      const startTime = Date.now();
      console.log(`🎵 Starting playback at ${startTime} - Song: ${song.name} by ${song.artist}`);
      // Enforce deterministic playback mode for direct index plays
      try { await spotifyFor(roomId).setShuffleState(false, targetDeviceId); } catch (_) {}
      try { await spotifyFor(roomId).setRepeatState('off', targetDeviceId); } catch (_) {}
      // Determine randomized start when enabled and safe
      let startMs = 0;
      if (room.randomStarts && room.randomStarts !== 'none' && Number.isFinite(song.duration)) {
        const durationMs = Math.max(0, Number(song.duration));
        const snippetMs = room.snippetLength * 1000;
        const bufferMs = 1500;
        
        if (room.randomStarts === 'early') {
          // Early random: first 90 seconds
          const maxStartMs = 90000; // 90 seconds
          const safeWindow = Math.min(maxStartMs, Math.max(0, durationMs - snippetMs - bufferMs));
          if (safeWindow > 3000) {
            startMs = Math.floor(Math.random() * safeWindow);
          }
        } else if (room.randomStarts === 'random') {
          // Random: anywhere but last 30+ seconds
          const safeWindow = Math.max(0, durationMs - snippetMs - bufferMs - 30000); // 30 second buffer
          if (safeWindow > 3000) {
            startMs = Math.floor(Math.random() * safeWindow);
          }
        }
      }
      await spotifyFor(roomId).startPlayback(targetDeviceId, [`spotify:track:${song.id}`], startMs);
      const endTime = Date.now();
      console.log(`✅ Successfully started playback on device: ${targetDeviceId} (took ${endTime - startTime}ms)`);
      
      // Stabilization delay to prevent context hijacks from volume changes
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Set initial volume to 100% (or room's saved volume) with single retry
        try {
          const initialVolume = room.volume || 100;
        await spotifyFor(roomId).withRetries('setVolume(index)', () => spotifyFor(roomId).setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
        console.log(`🔊 Set initial volume to ${initialVolume}%`);
        } catch (volumeError) {
        console.warn('⚠️ Volume setting failed, continuing anyway:', volumeError?.message || volumeError);
      }
    } catch (playbackError) {
      console.error('❌ Error starting playback:', playbackError);
      
      // In strict mode, do not fallback silently
      console.error('❌ Playback error in strict mode:', playbackError?.body?.error?.message || playbackError?.message || playbackError);
      const errorMsg = playbackError?.body?.error?.message || playbackError?.message || '';
      if (/restriction/i.test(errorMsg) || playbackError?.body?.error?.status === 403) {
        io.to(roomId).emit('playback-error', { 
          message: `Playback restricted: ${errorMsg}`,
          type: 'restriction',
          suggestions: [
            'Ensure you have Spotify Premium (required for remote control)',
            'Check if the device allows remote control',
            'Try opening Spotify on the target device first',
            'Wait a moment and try again'
          ]
        });
      } else {
        io.to(roomId).emit('playback-error', { message: 'Playback failed on locked device. Ensure it is online and try again.' });
      }
            return;
    }

    room.currentSong = {
      id: song.id,
      name: song.name,
      artist: song.artist,
      explicit: song.explicit === true
    };
    try { const r = rooms.get(roomId); if (r) r.songStartAtMs = Date.now() - (startMs || 0); } catch {}

    io.to(roomId).emit('song-playing', {
      songId: song.id,
      songName: song.name,
      customSongName: customSongTitles.get(song.id) || cleanSongTitle(song.name),
      artistName: song.artist,
      explicit: song.explicit === true,
      snippetLength: room.snippetLength,
      currentIndex: songIndex,
      totalSongs: room.playlistSongs.length,
      previewUrl: (room.playlistSongs[songIndex]?.previewUrl) || null
    });

    // Send real-time player card updates to host
    sendPlayerCardUpdates(roomId, true); // Immediate update on game start

    console.log(`✅ Playing song in room ${roomId}: ${song.name} by ${song.artist} on device ${targetDeviceId}`);

    // Use simplified progression system
    startSimpleProgression(roomId, targetDeviceId, room.snippetLength);
  } catch (error) {
    console.error('❌ Error playing song at index:', error);
    // Try to continue with next song after a delay using simple system
    setTimeout(() => playNextSongSimple(roomId, deviceId), 3000);
  }
}

function parseUserIdFromSpotifyOrgKey(organizationId) {
  if (typeof organizationId !== 'string' || !organizationId.startsWith('user_')) return null;
  const id = parseInt(organizationId.slice(5), 10);
  return Number.isFinite(id) ? id : null;
}

// Multi-Tenant Spotify Manager
class MultiTenantSpotifyManager {
  constructor() {
    this.orgServices = new Map();
    this.orgTokens = new Map();
    this.defaultOrg = 'DEFAULT';
  }

  /** Drop cached SpotifyService when tenant credentials change (call after primeTenantSpotifyCredentials). */
  invalidateUserService(uid) {
    if (uid == null) return;
    const key = `user_${uid}`;
    this.orgServices.delete(key);
  }
  
  getService(organizationId = this.defaultOrg) {
    if (!this.orgServices.has(organizationId)) {
      const uid = parseUserIdFromSpotifyOrgKey(organizationId);
      let credentialOverride;
      if (uid != null) {
        const o = organizationsStore.getCredentialOptionsForUser(uid);
        if (o !== undefined) credentialOverride = o;
      }
      const service = new SpotifyService(credentialOverride);
      this.orgServices.set(organizationId, service);
      // Tokens are applied via setTokens() after OAuth, or ensureOrgTokensLoaded() from DB.
      // Do NOT call async loadOrgTokens here without await (would store a Promise in orgTokens).
    }
    return this.orgServices.get(organizationId);
  }

  /**
   * Ensure in-memory tokens exist for this org (e.g. after server restart). Loads from DB if needed.
   * Clears corrupted entries (e.g. a Promise mistakenly stored by old getService).
   */
  async ensureOrgTokensLoaded(organizationId = this.defaultOrg) {
    let tok = this.orgTokens.get(organizationId);
    if (tok && typeof tok.then === 'function') {
      this.orgTokens.delete(organizationId);
      tok = undefined;
    }
    if (tok && tok.accessToken) return true;
    const loaded = await this.loadOrgTokens(organizationId);
    if (!loaded || !loaded.accessToken) return false;
    await this.setTokens(organizationId, loaded);
    return true;
  }
  
  getTokens(organizationId = this.defaultOrg) {
    return this.orgTokens.get(organizationId);
  }
  
  async setTokens(organizationId, tokens) {
    this.orgTokens.set(organizationId, tokens);
    const service = this.getService(organizationId);
    service.setTokens(tokens.accessToken, tokens.refreshToken);
    await this.saveOrgTokens(organizationId, tokens);
  }
  
  async loadOrgTokens(organizationId) {
    try {
      // Try database first (persistent across deployments)
      const dbTokens = await loadTokensFromDatabase(organizationId);
      if (dbTokens) {
        return dbTokens;
      }
      
      // Fallback to environment variables (for backward compatibility)
      const envPrefix = organizationId === this.defaultOrg ? '' : `ORG_${organizationId}_`;
      const accessToken = process.env[`${envPrefix}SPOTIFY_ACCESS_TOKEN`];
      const refreshToken = process.env[`${envPrefix}SPOTIFY_REFRESH_TOKEN`];
      
      if (accessToken && refreshToken) {
        console.log(`🌍 Loaded Spotify tokens for ${organizationId} from environment variables`);
        const tokens = {
          accessToken,
          refreshToken,
          expiresIn: 3600
        };
        
        // Migrate to database for future persistence
        await saveTokensToDatabase(organizationId, tokens);
        console.log(`🔄 Migrated ${organizationId} tokens to database`);
        
        return tokens;
      }
      
      // Fallback to file (for local development)
      const tokenFile = organizationId === this.defaultOrg ? 
        TOKEN_FILE : 
        path.join(__dirname, `spotify_tokens_${organizationId.toLowerCase()}.json`);
        
      if (fs.existsSync(tokenFile)) {
        const tokenData = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
        console.log(`📁 Loaded Spotify tokens for ${organizationId} from file`);
        
        // Migrate to database for future persistence
        await saveTokensToDatabase(organizationId, tokenData);
        console.log(`🔄 Migrated ${organizationId} tokens from file to database`);
        
        return tokenData;
      }
    } catch (error) {
      console.error(`❌ Error loading tokens for ${organizationId}:`, error);
    }
    return null;
  }
  
  async saveOrgTokens(organizationId, tokens) {
    try {
      // Save to database (persistent across deployments)
      const dbSaved = await saveTokensToDatabase(organizationId, tokens);
      
      if (dbSaved) {
        console.log(`✅ Tokens for ${organizationId} saved to database - will persist across deployments`);
      } else {
        // Fallback to file (for local development)
        const tokenFile = organizationId === this.defaultOrg ? 
          TOKEN_FILE : 
          path.join(__dirname, `spotify_tokens_${organizationId.toLowerCase()}.json`);
          
        fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), 'utf8');
        console.log(`📁 Tokens for ${organizationId} saved to file (local development only)`);
      }
      
    } catch (error) {
      console.error(`❌ Error saving tokens for ${organizationId}:`, error);
    }
  }
  
  async clearOrgTokens(organizationId) {
    this.orgTokens.delete(organizationId);
    this.orgServices.delete(organizationId);
    
    // Remove from database
    const dbDeleted = await deleteTokensFromDatabase(organizationId);
    
    if (!dbDeleted) {
      // Fallback: Remove token file
      try {
        const tokenFile = organizationId === this.defaultOrg ? 
          TOKEN_FILE : 
          path.join(__dirname, `spotify_tokens_${organizationId.toLowerCase()}.json`);
          
        if (fs.existsSync(tokenFile)) {
          fs.unlinkSync(tokenFile);
          console.log(`✅ Removed token file for ${organizationId}`);
        }
      } catch (error) {
        console.error(`❌ Error removing token file for ${organizationId}:`, error);
      }
    }
  }
}

// License Key Validation
function validateLicenseKey(licenseKey) {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return null;
  }
  
  const parts = licenseKey.split('-');
  if (parts.length !== 4 || parts[0] !== 'TEMPO') {
    return null;
  }
  
  const [prefix, orgCode, year, checksum] = parts;
  
  // Validate year
  const currentYear = new Date().getFullYear();
  if (parseInt(year) < 2024 || parseInt(year) > currentYear + 1) {
    return null;
  }
  
  // Validate checksum
  const expectedChecksum = generateChecksum(orgCode, year);
  if (checksum !== expectedChecksum) {
    return null;
  }
  
  return orgCode; // Return organization ID
}

function generateChecksum(orgCode, year) {
  // Simple checksum - combines org code, year, and secret
  const secret = process.env.LICENSE_SECRET || 'TEMPO_DEFAULT_SECRET_2024';
  const combined = orgCode + year + secret;
  
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(16).toUpperCase().substring(0, 6);
}

// Database functions for persistent token storage
async function initializeDatabase() {
  if (!db) return false;
  
  try {
    // Create spotify_tokens table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS spotify_tokens (
        organization_id VARCHAR(50) PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await usersStore.ensureUsersTable(db);
    await usersStore.ensureHostAllowlistTable(db);
    await organizationsStore.ensureOrganizationsTable(db);
    console.log('✅ Database tables initialized');
    return true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    return false;
  }
}

async function saveTokensToDatabase(organizationId, tokens) {
  if (!db) return false;
  
  try {
    const expiresAt = new Date(Date.now() + (tokens.expiresIn || 3600) * 1000);
    
    await db.query(`
      INSERT INTO spotify_tokens (organization_id, access_token, refresh_token, expires_at, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (organization_id) 
      DO UPDATE SET 
        access_token = $2,
        refresh_token = $3,
        expires_at = $4,
        updated_at = CURRENT_TIMESTAMP
    `, [organizationId, tokens.accessToken, tokens.refreshToken, expiresAt]);
    
    console.log(`💾 Saved Spotify tokens for ${organizationId} to database`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to save tokens for ${organizationId}:`, error);
    return false;
  }
}

async function loadTokensFromDatabase(organizationId) {
  if (!db) return null;
  
  try {
    const result = await db.query(
      'SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE organization_id = $1',
      [organizationId]
    );
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log(`📁 Loaded Spotify tokens for ${organizationId} from database`);
      return {
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        expiresIn: 3600 // Will be refreshed automatically
      };
    }
    return null;
  } catch (error) {
    console.error(`❌ Failed to load tokens for ${organizationId}:`, error);
    return null;
  }
}

async function deleteTokensFromDatabase(organizationId) {
  if (!db) return false;
  
  try {
    await db.query('DELETE FROM spotify_tokens WHERE organization_id = $1', [organizationId]);
    console.log(`🗑️ Deleted Spotify tokens for ${organizationId} from database`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to delete tokens for ${organizationId}:`, error);
    return false;
  }
}

// Initialize Multi-Tenant Spotify Manager
const multiTenantSpotify = new MultiTenantSpotifyManager();

// Backward compatibility - initialize default organization
(async () => {
  const defaultTokens = loadTokens();
  if (defaultTokens) {
    await multiTenantSpotify.setTokens('DEFAULT', defaultTokens);
    console.log('✅ Restored default Spotify connection from saved tokens');
  }
})();

// Legacy support - DEFAULT org (no host user on room)
const spotifyServiceDefault = multiTenantSpotify.getService('DEFAULT');
let spotifyTokens = multiTenantSpotify.getTokens('DEFAULT');

function spotifyOrgForRoom(room) {
  if (!room) return 'DEFAULT';
  if (room.ownerUserId != null && Number.isFinite(Number(room.ownerUserId))) return `user_${room.ownerUserId}`;
  return room.organizationId || 'DEFAULT';
}

function spotifyFor(roomId) {
  const room = rooms.get(roomId);
  return multiTenantSpotify.getService(spotifyOrgForRoom(room));
}

// Helper function to get organization from room
function getOrganizationFromRoom(roomId) {
  const room = rooms.get(roomId);
  return room ? spotifyOrgForRoom(room) : 'DEFAULT';
}

/** Spotify HTTP API: logged-in host only — each host uses user_${uid} tokens (never shared DEFAULT). */
function spotifyForRequest(req) {
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (uid == null) return null;
  return multiTenantSpotify.getService(`user_${uid}`);
}

function hostSpotifyHasTokens(req) {
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (uid == null) return false;
  const t = multiTenantSpotify.getTokens(`user_${uid}`);
  return !!(t && t.accessToken);
}

// Timer management to prevent conflicts
const roomTimers = new Map();
// Playback watchdogs per room to recover from mid-snippet stalls
const roomPlaybackWatchers = new Map();

function isStormActive(room) {
  return !!(room && room.superStrictLock && room.stormUntilMs && Date.now() < room.stormUntilMs);
}

function clearPlaybackWatcher(roomId) {
  if (roomPlaybackWatchers.has(roomId)) {
    clearInterval(roomPlaybackWatchers.get(roomId));
    roomPlaybackWatchers.delete(roomId);
  }
}

// NEW: Simplified context monitor - watches for context hijacks AND device switches
function startSimpleContextMonitor(roomId, deviceId) {
  clearPlaybackWatcher(roomId);
  
  // Get the target device ID (use saved device if deviceId not provided)
  let targetDeviceId = deviceId;
  if (!targetDeviceId) {
    const savedDevice = loadSavedDeviceForRoom(roomId);
    if (savedDevice) {
      targetDeviceId = savedDevice.id;
    }
  }
  
  const intervalId = setInterval(async () => {
    try {
      const room = rooms.get(roomId);
      if (!room || room.gameState !== 'playing') { 
        clearPlaybackWatcher(roomId); 
        return; 
      }
      
      // Get current playback state to check device
      const state = await spotifyFor(roomId).getCurrentPlaybackState();
      const currentDeviceId = state?.device?.id;
      
      // CRITICAL: Check if playback has switched to a different device
      if (targetDeviceId && currentDeviceId && currentDeviceId !== targetDeviceId) {
        console.warn(`⚠️ Device switch detected! Expected: ${targetDeviceId}, Got: ${currentDeviceId}. Transferring back...`);
        
        try {
          // Immediately transfer playback back to the correct device
          await spotifyFor(roomId).transferPlayback(targetDeviceId, false);
          console.log(`✅ Transferred playback back to locked device: ${targetDeviceId}`);
          
          // Small delay then verify it worked
          await new Promise(resolve => setTimeout(resolve, 500));
          const verifyState = await spotifyFor(roomId).getCurrentPlaybackState();
          if (verifyState?.device?.id === targetDeviceId) {
            console.log(`✅ Device lock restored successfully`);
          } else {
            console.warn(`⚠️ Device transfer may have failed - still on ${verifyState?.device?.id}`);
          }
        } catch (e) {
          console.warn('⚠️ Failed to transfer playback back to locked device:', e?.message);
        }
        return; // Skip other checks this cycle
      }
      
      const expectedContext = room.temporaryPlaylistId ? `spotify:playlist:${room.temporaryPlaylistId}` : null;
      const currentContext = state?.context?.uri || null;
      
      // Handle context issues and track restart corrections
      const currentTrackId = state?.item?.id;
      const expectedTrackId = room?.currentSong?.id;
      const progress = Number(state?.progress_ms || 0);
      
      // Case 1: Wrong playlist context
      if (expectedContext && currentContext && currentContext !== expectedContext) {
        console.warn(`🔄 Context lost. Expected: ${expectedContext}, Got: ${currentContext}. Restoring...`);
        
        try {
          // Ensure we're on the correct device first
          if (targetDeviceId && currentDeviceId !== targetDeviceId) {
            await spotifyFor(roomId).transferPlayback(targetDeviceId, false);
          }
          
          // Restore playlist context with original start position
          const originalStartMs = room.currentSongStartMs || 0;
          if (room.currentSongIndex !== undefined) {
            await spotifyFor(roomId).startPlaybackFromPlaylist(targetDeviceId || deviceId, room.temporaryPlaylistId, room.currentSongIndex, originalStartMs);
          }
        } catch (e) {
          console.warn('⚠️ Context restore failed:', e?.message);
        }
      }
      // Case 2: Same track restarted from beginning (back button pressed)
      else if (currentTrackId === expectedTrackId && progress < 3000 && room.currentSongStartMs > 0) {
        console.log(`🔄 Track restart detected. Restoring original start position: ${room.currentSongStartMs}ms`);
        
        try {
          // Ensure we're on the correct device first
          if (targetDeviceId && currentDeviceId !== targetDeviceId) {
            await spotifyFor(roomId).transferPlayback(targetDeviceId, false);
          }
          
          // Restore original start position for this track
          await spotifyFor(roomId).seekToPosition(room.currentSongStartMs, targetDeviceId || deviceId);
        } catch (e) {
          console.warn('⚠️ Failed to restore original start position:', e?.message);
        }
      }
    } catch (_e) {
      // Ignore monitor errors to prevent spam
    }
  }, 3000); // Check every 3 seconds - more frequent to catch device switches quickly
  
  roomPlaybackWatchers.set(roomId, intervalId);
}

// NEW: Simple timer-based song progression - let timer control everything
function startSimpleProgression(roomId, deviceId, snippetLengthSeconds) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  console.log(`⏰ Starting simple progression: ${snippetLengthSeconds}s per song`);
  
  // Clear any existing timer
  clearRoomTimer(roomId);
  
  // Start context monitor for hijack detection only
  startSimpleContextMonitor(roomId, deviceId);
  
  // Set timer for exact snippet duration
  setRoomTimer(roomId, async () => {
    console.log(`⏰ Timer fired - advancing to next song`);
    
    // Immediately advance to next song (don't pause first to avoid dead air)
    await playNextSongSimple(roomId, deviceId);
  }, snippetLengthSeconds * 1000);
}

// NEW: Simplified song progression without complex verification
async function playNextSongSimple(roomId, deviceId) {
  console.log('🎵 Simple next song for room:', roomId);
  const room = rooms.get(roomId);
  
  if (!room || room.gameState !== 'playing' || !room.playlistSongs) {
    console.log('❌ Cannot advance: invalid room state');
    return;
  }

  // Check if we're at the end
  if (room.currentSongIndex + 1 >= room.playlistSongs.length) {
    console.log('🏁 Playlist complete. Ending game.');
    room.gameState = 'ended';
    clearRoomTimer(roomId);
    clearPlaybackWatcher(roomId);
    
    // Clean up temporary playlist
    if (room.temporaryPlaylistId) {
      spotifyFor(roomId).deleteTemporaryPlaylist(room.temporaryPlaylistId).catch(err => 
        console.warn('⚠️ Failed to delete temporary playlist:', err)
      );
      room.temporaryPlaylistId = null;
    }
    
    io.to(roomId).emit('game-ended', { roomId, reason: 'playlist-complete' });
    return;
  }

  // Move to next song
  room.currentSongIndex++;
  const nextSong = room.playlistSongs[room.currentSongIndex];
  
  if (!nextSong) {
    console.log('❌ No next song found');
    return;
  }

  // Calculate start position if random starts enabled
  let startMs = 0;
  if (room.randomStarts && room.randomStarts !== 'none' && Number.isFinite(nextSong.duration)) {
    const dur = Math.max(0, Number(nextSong.duration));
    const snippetMs = room.snippetLength * 1000;
    const bufferMs = 1500;
    
    if (room.randomStarts === 'early') {
      // Early random: first 90 seconds
      const maxStartMs = 90000; // 90 seconds
      const safeWindow = Math.min(maxStartMs, Math.max(0, dur - snippetMs - bufferMs));
      if (safeWindow > 3000) {
        startMs = Math.floor(Math.random() * safeWindow);
      }
    } else if (room.randomStarts === 'random') {
      // Random: anywhere but last 30+ seconds
      const safeWindow = Math.max(0, dur - snippetMs - bufferMs - 30000); // 30 second buffer
      if (safeWindow > 3000) {
        startMs = Math.floor(Math.random() * safeWindow);
      }
    }
  }

    // Track called song
    room.calledSongIds = Array.isArray(room.calledSongIds) ? room.calledSongIds : [];
    room.calledSongIds.push(nextSong.id);
    console.log(`📝 SIMPLE PLAYBACK: Marked song as played: ${nextSong.name} (${nextSong.id}) - Total played: ${room.calledSongIds.length}`);
    console.log(`📋 SIMPLE PLAYBACK: Current calledSongIds array:`, room.calledSongIds);

  // Update current song and store original start position
  room.currentSong = {
    id: nextSong.id,
    name: nextSong.name,
    artist: nextSong.artist,
    explicit: nextSong.explicit === true
  };
  room.currentSongStartMs = startMs; // Store for restart correction

  try {
    console.log(`🎵 Starting playback for: ${nextSong.name} by ${nextSong.artist} at ${startMs}ms`);
    
    // Brief delay to ensure smooth transition without dead air
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Simple playlist playback with enhanced logging
    if (room.temporaryPlaylistId) {
      console.log(`🎼 Using playlist context: ${room.temporaryPlaylistId}, track ${room.currentSongIndex}`);
      await spotifyFor(roomId).startPlaybackFromPlaylist(deviceId, room.temporaryPlaylistId, room.currentSongIndex, startMs);
    } else {
      console.log(`🎵 Using individual track: ${nextSong.id}`);
      await spotifyFor(roomId).startPlayback(deviceId, [`spotify:track:${nextSong.id}`], startMs);
    }

    console.log(`✅ Playback started successfully for: ${nextSong.name}`);

    // Emit song update
    io.to(roomId).emit('song-playing', {
      songId: nextSong.id,
      songName: nextSong.name,
      customSongName: customSongTitles.get(nextSong.id) || cleanSongTitle(nextSong.name),
      artistName: nextSong.artist,
      explicit: nextSong.explicit === true,
      snippetLength: room.snippetLength,
      currentIndex: room.currentSongIndex,
      totalSongs: room.playlistSongs.length,
      previewUrl: nextSong.previewUrl || null
    });

    // CRITICAL: Sync room-state after every song starts to ensure clients stay in sync
    // This makes server the single source of truth for played songs
    const playedSongIds = Array.isArray(room.calledSongIds) ? [...room.calledSongIds] : [];
    if (room.currentSong && room.currentSong.id && !playedSongIds.includes(room.currentSong.id)) {
      playedSongIds.push(room.currentSong.id);
    }
    
    const syncPayload = {
      isPlaying: room.gameState === 'playing',
      pattern: room.pattern || 'line',
      customMask: Array.from(room.customPattern || []),
      currentSong: room.currentSong || null,
      snippetLength: room.snippetLength || 30,
      playerCount: getNonHostPlayerCount(room),
      gameState: room.gameState,
      winners: room.winners || [],
      roundWinners: room.roundWinners || [],
      publicDisplayFontSize: room.publicDisplayFontSize || 1.0,
      venueBranding: venueBrandingForRoom(room),
      playedSongs: playedSongIds.map(songId => {
        const foundSong = room.playlistSongs?.find(s => s.id === songId);
        return foundSong ? {
          id: foundSong.id,
          name: foundSong.name,
          artist: foundSong.artist
        } : null;
      }).filter(Boolean),
      playedSongIds: playedSongIds,
      totalPlayedCount: playedSongIds.length,
      currentSongIndex: room.currentSongIndex || 0,
      totalSongs: room.playlistSongs?.length || 0,
      syncTimestamp: Date.now()
    };
    
    io.to(roomId).emit('room-state', syncPayload);
    console.log(`🔄 Synced room-state after song start: ${playedSongIds.length} played songs`);

    // Send real-time player card updates to host
    sendPlayerCardUpdates(roomId, true); // Immediate update on game start

    console.log(`✅ Simple advance: ${nextSong.name} by ${nextSong.artist}`);

    // Start simple progression for next song
    startSimpleProgression(roomId, deviceId, room.snippetLength);

  } catch (error) {
    console.error('❌ Error in simple song advance:', error);
    console.error('❌ Error details:', error?.message, error?.body?.error);
    
    // Try to resume playback if it got stuck in paused state
    try {
      console.log('🔄 Attempting to resume playback after song advance failure...');
      await spotifyFor(roomId).resumePlayback(deviceId);
      console.log('✅ Resume attempt completed');
    } catch (resumeError) {
      console.warn('⚠️ Failed to resume playback:', resumeError?.message);
    }
    
    // Try to continue with next song after delay
    console.log('🔄 Retrying song advance in 3 seconds...');
    setTimeout(() => playNextSongSimple(roomId, deviceId), 3000);
  }
}

function startPlaybackWatchdog(roomId, deviceId, snippetMs) {
  clearPlaybackWatcher(roomId);
  let attempts = 0;
  const room = rooms.get(roomId);
  const strict = !!room?.superStrictLock;
  const intervalId = setInterval(async () => {
    try {
      const room = rooms.get(roomId);
      if (!room || room.gameState !== 'playing') { clearPlaybackWatcher(roomId); return; }
      const state = await spotifyFor(roomId).getCurrentPlaybackState();
      const isPlaying = !!state?.is_playing;
      const currentId = state?.item?.id;
      const progress = Number(state?.progress_ms || 0);
      const expectedId = room?.currentSong?.id || null;
      const now = Date.now();

      // Hard guard: wrong track correction with ping-pong prevention
      // Check for track mismatch OR wrong playlist context
      const expectedContext = room.temporaryPlaylistId ? `spotify:playlist:${room.temporaryPlaylistId}` : null;
      const currentContext = state?.context?.uri || null;
      const wrongTrack = expectedId && currentId && currentId !== expectedId;
      const wrongContext = expectedContext && currentContext && currentContext !== expectedContext;
      
      // More tolerant validation: Only correct if we have BOTH wrong track AND wrong context
      // OR if progress is excessively beyond snippet length (indicating auto-advance)
      const excessiveProgress = progress > (snippetMs * 2); // More than 2x snippet length
      const needsCorrection = (wrongTrack && wrongContext) || excessiveProgress;
      
      if (needsCorrection) {
        const room = rooms.get(roomId);
        // Check for ping-pong correction (same wrong track corrected recently)
        const lastWrongTrack = room?.lastCorrectedFromTrack;
        const lastCorrectionTime = room?.lastCorrectionAtMs || 0;
        const timeSinceLastCorrection = now - lastCorrectionTime;
        
        if (lastWrongTrack === currentId && timeSinceLastCorrection < 10000) {
          console.warn(`⚠️ Ping-pong detected: ${currentId} corrected ${Math.floor(timeSinceLastCorrection/1000)}s ago. Advancing to next song instead.`);
          clearPlaybackWatcher(roomId);
          clearRoomTimer(roomId);
          await playNextSong(roomId, deviceId);
          return;
        }
        
        if (excessiveProgress) {
          console.warn(`⚠️ Watchdog detected excessive progress (${progress}ms > ${snippetMs*2}ms limit). Auto-advance likely occurred. Correcting…`);
        } else if (wrongTrack && wrongContext) {
          console.warn(`⚠️ Watchdog detected track AND context mismatch. Expected ${expectedId} in ${expectedContext}, got ${currentId} in ${currentContext}. Correcting…`);
        } else if (wrongContext) {
          console.warn(`⚠️ Watchdog detected wrong playlist context. Expected ${expectedContext}, got ${currentContext}. Correcting…`);
        } else {
          console.warn(`⚠️ Watchdog detected track mismatch. Expected ${expectedId}, got ${currentId}. Correcting…`);
        }
        try {
          // Store correction info for ping-pong detection
          if (room) {
            room.lastCorrectedFromTrack = currentId;
            room.lastCorrectionAtMs = now;
          }
          
          // Ensure control on target device without autoplaying a random context
          try { await spotifyFor(roomId).transferPlayback(deviceId, false); } catch {}
          // Hard pause to stop any stray context audio before restart
          try { await spotifyFor(roomId).pausePlayback(deviceId); } catch {}
          // Restart intended track (position 0 to avoid drift); timers already handle overrun
          // Try to calculate expected progress from when song started
          let expectedProgress = 0;
          try {
            const r = rooms.get(roomId);
            if (r?.songStartAtMs) expectedProgress = Math.max(0, Date.now() - r.songStartAtMs);
          } catch {}
          // Use playlist context for correction if available
          if (room.temporaryPlaylistId && room.currentSongIndex !== undefined) {
            console.log(`🎼 Watchdog correcting via playlist context at index ${room.currentSongIndex}`);
            await spotifyFor(roomId).startPlaybackFromPlaylist(deviceId, room.temporaryPlaylistId, room.currentSongIndex, expectedProgress);
          } else {
            await spotifyFor(roomId).startPlayback(deviceId, [`spotify:track:${expectedId}`], expectedProgress);
          }
          // Double-seek to clamp exact resume position and avoid restart sputter
          try {
            await new Promise(r => setTimeout(r, 150));
            await spotifyFor(roomId).seekToPosition(expectedProgress, deviceId);
            await new Promise(r => setTimeout(r, 120));
            await spotifyFor(roomId).seekToPosition(expectedProgress, deviceId);
          } catch {}
          // Verify and seek precisely if needed
          try {
            const verify = await spotifyFor(roomId).getCurrentPlaybackState();
            const vid = verify?.item?.id;
            const vprog = Number(verify?.progress_ms || 0);
            if (vid === expectedId && Math.abs(vprog - expectedProgress) > 1200) {
              try { await spotifyFor(roomId).seekToPosition(expectedProgress, deviceId); } catch {}
            }
          } catch {}
          // Enforce deterministic playback settings after correction
          try { await spotifyFor(roomId).setShuffleState(false, deviceId); } catch {}
          // Note: Do NOT set repeat to 'off' here - we want 'track' mode to prevent auto-advance
          try { const r = rooms.get(roomId); if (r) { r.songStartAtMs = now - expectedProgress; } } catch {}
          // Clear any queued items that might cause future hijacks
          try {
            const r = rooms.get(roomId);
            if (r) {
              // Mark a storm window (e.g., 2 minutes) where we tighten cadence
              r.stormUntilMs = Date.now() + 120000;
            }
          } catch {}
        } catch (e) {
          console.warn('⚠️ Correction attempt failed:', e?.message || e);
        }
        // Reset attempts to avoid immediate stall escalation
        attempts = 0;
        // Surface a warning with context info to host
        try {
          const ctx = await spotifyFor(roomId).getCurrentPlaybackState();
          const devices = await spotifyFor(roomId).getUserDevices();
          const ctxUri = ctx?.context?.uri || '(none)';
          const ctxName = ctx?.item?.name || '(unknown track)';
          const ctxArtist = ctx?.item?.artists?.map?.((a) => a?.name).filter(Boolean).join(', ') || '';
          const expectedCtx = room.temporaryPlaylistId ? `spotify:playlist:${room.temporaryPlaylistId}` : '(none)';
          const correctionType = excessiveProgress ? 'excessive progress (auto-advance)' : 
                                 wrongTrack && wrongContext ? 'track and context mismatch' : 
                                 wrongContext ? 'wrong context' : 'track mismatch';
          const diag = {
            message: `Context hijack corrected (${correctionType}). Was: ${ctxName}${ctxArtist ? ' — ' + ctxArtist : ''} in ${ctxUri} (expected: ${room?.currentSong?.name || 'unknown'} in ${expectedCtx} at index ${room.currentSongIndex})`,
            contextUri: ctxUri,
            expectedContext: expectedCtx,
            expectedTrackIndex: room.currentSongIndex,
            correctionType: correctionType,
            track: { id: ctx?.item?.id, name: ctxName, artist: ctxArtist },
            isPlaying: !!ctx?.is_playing,
            progressMs: Number(ctx?.progress_ms || 0),
            device: { id: ctx?.device?.id, name: ctx?.device?.name, isActive: !!ctx?.device?.is_active },
            shuffle: !!ctx?.shuffle_state,
            repeat: ctx?.repeat_state || 'off',
            devices: (devices || []).map(d => ({ id: d.id, name: d.name, is_active: d.is_active }))
          };
          io.to(roomId).emit('playback-warning', { message: diag.message });
          io.to(roomId).emit('playback-diagnostic', diag);
        } catch {}
        // Do not early-return; still run stall logic below
      }

      if (isPlaying && (!expectedId || currentId === expectedId)) { attempts = 0; return; }
      attempts += 1;
      if (attempts === 1) {
        try { await spotifyFor(roomId).resumePlayback(deviceId); } catch {}
      } else if (attempts >= 2) {
        io.to(roomId).emit('playback-warning', { message: 'Playback stalled; restarting current track.' });
        // Try to restart the intended current track at expected progress
        try {
          const r = rooms.get(roomId);
          const currentExpectedId = r?.currentSong?.id || expectedId;
          if (currentExpectedId) {
            // Calculate expected progress from when song started, or use 0 if unknown
            let expectedProgress = 0;
            try {
              if (r?.songStartAtMs) expectedProgress = Math.max(0, Date.now() - r.songStartAtMs);
            } catch {}
            try { await spotifyFor(roomId).transferPlayback(deviceId, false); } catch {}
            try { await spotifyFor(roomId).pausePlayback(deviceId); } catch {}
            await spotifyFor(roomId).startPlayback(deviceId, [`spotify:track:${currentExpectedId}`], expectedProgress);
            try { await new Promise(res => setTimeout(res, 150)); await spotifyFor(roomId).seekToPosition(expectedProgress, deviceId); } catch {}
            attempts = 0; // reset attempts after restart
          } else {
            // Fallback if no track id known: advance
            clearPlaybackWatcher(roomId);
            clearRoomTimer(roomId);
            await playNextSong(roomId, deviceId);
          }
        } catch (_) {
          // As a last resort, advance
          clearPlaybackWatcher(roomId);
          clearRoomTimer(roomId);
          await playNextSong(roomId, deviceId);
        }
      }
      
      // Aggressive auto-advance prevention: pause playback if it exceeds snippet length
      const snippetLimitMs = snippetMs * 0.95; // Allow 5% buffer for timing variations
      if (room.temporaryPlaylistId && isPlaying && progress > snippetLimitMs) {
        try {
          console.log(`⏸️ AGGRESSIVE PAUSE: Progress ${progress}ms exceeds snippet limit ${snippetLimitMs}ms. Pausing to prevent auto-advance.`);
          await spotifyFor(roomId).pausePlayback(deviceId);
          // Let timer handle the next song transition
        } catch (e) {
          console.warn('⚠️ Failed to pause at snippet limit:', e?.message);
        }
      }
      
      // Also enforce repeat mode but it's secondary to the pause strategy
      if (room.temporaryPlaylistId && state?.repeat_state !== 'track') {
        try {
          console.log(`🔄 Enforcing repeat 'track' mode (was: ${state?.repeat_state})`);
          await spotifyFor(roomId).setRepeatState('track', deviceId);
        } catch (e) {
          console.warn('⚠️ Failed to enforce repeat mode:', e?.message);
        }
      }
      
      // Overrun guard: if snippet time essentially elapsed on same track, force advance
      const lastCorrection = room?.lastCorrectionAtMs || 0;
      const recentlyCorrected = (now - lastCorrection) < 2500;
      if (!recentlyCorrected && room?.currentSong?.id && currentId === room.currentSong.id && progress >= Math.max(0, snippetMs - 300)) {
        clearPlaybackWatcher(roomId);
        clearRoomTimer(roomId);
        await playNextSong(roomId, deviceId);
      }
    } catch (_e) {
      // ignore
    }
  }, ((room && room.superStrictLock && room.stormUntilMs && Date.now() < room.stormUntilMs) ? 1500 : (strict ? 2000 : Math.max(2500, Math.min(5000, snippetMs / 6)))));
  roomPlaybackWatchers.set(roomId, intervalId);
}

io.use((socket, next) => {
  try {
    const token = hostAuth.getHostSessionTokenFromHandshake(socket.handshake);
    if (typeof token === 'string' && token.length > 0) {
      const p = hostAuth.decodeHostJwtPayload(token);
      if (p) {
        socket.hostUserId = p.userId;
        socket.hostEmailFromJwt = p.email || null;
      }
    }
  } catch (_) {}
  next();
});

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.log('User connected:', 'user-connect', 20);

  // Join room
  socket.on('join-room', async (data) => {
    const { roomId, playerName, isHost = false, clientId, licenseKey, hostSecret, hostToken } = data;
    const hostSecretEnv = (process.env.TEMPO_HOST_SECRET || '').trim();
    let wantsHost = isHost;

    /** Google host user id from handshake or join payload (used for owner checks and owner takeover). */
    let claimUid = null;
    if (wantsHost) {
      claimUid = socket.hostUserId ?? null;
      if (claimUid == null && typeof hostToken === 'string' && hostToken.length > 0) {
        const p = hostAuth.decodeHostJwtPayload(hostToken);
        claimUid = p ? p.userId : null;
      }
    }

    /** Email from JWT (same as Google OAuth allowlist source); hostToken may carry it if handshake lacked it. */
    let hostEmailFromJwt = socket.hostEmailFromJwt || null;
    if (!hostEmailFromJwt && typeof hostToken === 'string' && hostToken.length > 0) {
      hostEmailFromJwt = hostAuth.getHostEmailFromJwtToken(hostToken);
    }

    /**
     * Approved-hosts-only: require Google JWT + allowlisted email. TEMPO_HOST_SECRET cannot substitute
     * (prevents anonymous hosting with only the shared secret).
     */
    if (wantsHost && usersStore.isApprovedHostsOnlyMode()) {
      if (claimUid == null) {
        socket.emit('host-join-denied', {
          roomId,
          reason: 'host_not_approved',
          message: 'Sign in with Google as an approved host to run games.',
        });
        return;
      }
      if (!db) {
        socket.emit('host-join-denied', {
          roomId,
          reason: 'host_not_approved',
          message: 'Server is missing DATABASE_URL; host approval cannot be verified.',
        });
        return;
      }
      try {
        const urow = await usersStore.getUserById(db, claimUid);
        const dbEmail = urow?.email;
        if (
          !usersStore.normalizeHostEmail(hostEmailFromJwt || '') &&
          !usersStore.normalizeHostEmail(dbEmail || '')
        ) {
          socket.emit('host-join-denied', {
            roomId,
            reason: 'host_not_approved',
            message:
              'Your host account has no email on file. Sign out and sign in with Google again, then try hosting.',
          });
          return;
        }
        if (!(await usersStore.isEmailAllowlistedForHostUser(db, hostEmailFromJwt, dbEmail))) {
          socket.emit('host-join-denied', {
            roomId,
            reason: 'host_not_approved',
            message:
              'This account is not approved to host games. Ask your organizer to add your Google email (or an equivalent Gmail address) to the allowlist.',
          });
          return;
        }
      } catch (e) {
        console.error('join-room approved-host check:', e);
        socket.emit('host-join-denied', {
          roomId,
          reason: 'host_not_approved',
          message: 'Could not verify host approval. Try again.',
        });
        return;
      }
    }

    if (wantsHost && claimUid != null && db) {
      try {
        await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, claimUid);
      } catch (e) {
        console.error('join-room primeTenantSpotifyCredentials:', e?.message || e);
      }
    }

    /** If TEMPO_HOST_SECRET is set, only callers who send the same value may host — unless they prove host identity via Google JWT (socket handshake or hostToken). */
    if (isHost && hostSecretEnv) {
      const authedHostUid =
        socket.hostUserId ??
        (typeof hostToken === 'string' && hostToken.length > 0
          ? (hostAuth.decodeHostJwtPayload(hostToken) || {}).userId ?? null
          : null);
      if (authedHostUid == null && (hostSecret || '').trim() !== hostSecretEnv) {
        console.warn(`Host join rejected: invalid or missing host secret for ${playerName} room ${roomId}`);
        socket.emit('host-join-denied', {
          roomId,
          reason: 'invalid_host_secret',
          message: 'Invalid host access code. Hosting is restricted.',
        });
        return;
      }
    }
    logger.info(`Player ${playerName} (${wantsHost ? 'host' : 'player'}) joining room: ${roomId}`, 'player-join');

    let organizationId = 'DEFAULT';

    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      logger.info(`Creating new room: ${roomId} for organization: ${organizationId}`, 'room-create');
      const newRoom = {
        id: roomId,
        organizationId: organizationId, // Add organization support
        licenseKey: licenseKey || null, // Store license key
        host: wantsHost ? socket.id : null,
        hostClientId: wantsHost && clientId ? clientId : null,
        players: new Map(),
        gameState: 'waiting',
        snippetLength: 30,
        winners: [],
        repeatMode: false,
        volume: 100,
        /** When true, only in-person players can pause/end the round with a verified bingo; online players get unofficial bingo. */
        hybridInPersonPlusOnline: false,
        playlistSongs: [],
        currentSongIndex: 0,
        // Pre-queue system removed for deterministic playback
        superStrictLock: false,
        pattern: 'line', // Default pattern
        customPattern: undefined, // Will be set when custom pattern is chosen
        createdAt: new Date().toISOString()
      };
      rooms.set(roomId, newRoom);
      
      // Log organization info
      if (organizationId !== 'DEFAULT') {
        console.log(`🏢 Room ${roomId} created for organization ${organizationId} with license ${licenseKey}`);
      }
    }

    const room = rooms.get(roomId);

    /** Host-owned rooms: only the signed-in host may take the host role. */
    if (wantsHost && room.ownerUserId != null) {
      if (claimUid == null || Number(claimUid) !== Number(room.ownerUserId)) {
        socket.emit('host-join-denied', {
          roomId,
          reason: 'not_room_owner',
          message: 'Sign in as the host who created this room to run the host controls.',
        });
        return;
      }
    }
    
    // Join the socket room
    socket.join(roomId);
    
    /** Only one active host; reconnect allowed if clientId matches room.hostClientId; takeover if old host socket disconnected */
    let effectiveIsHost = wantsHost;
    if (wantsHost) {
      if (!room.host) {
        room.host = socket.id;
        if (clientId) room.hostClientId = clientId;
        effectiveIsHost = true;
        console.log(`Set ${playerName} as host for room: ${roomId}`);
      } else if (room.host === socket.id) {
        effectiveIsHost = true;
      } else {
        const oldHostSocket = io.sockets.sockets.get(room.host);
        const oldHostConnected = !!(oldHostSocket && oldHostSocket.connected);
        const sameClientReconnect = clientId && room.hostClientId && clientId === room.hostClientId;
        if (sameClientReconnect) {
          if (room.players.has(room.host)) {
            const op = room.players.get(room.host);
            if (op) op.isHost = false;
          }
          room.host = socket.id;
          effectiveIsHost = true;
          console.log(`Host reconnected (clientId) for room ${roomId}`);
        } else if (!oldHostConnected) {
          room.host = socket.id;
          if (clientId) room.hostClientId = clientId;
          effectiveIsHost = true;
          console.log(`New host claimed room ${roomId} (previous host disconnected)`);
        } else {
          /** Active host socket still connected, but room is host-owned and joiner is that owner (e.g. "Continue" after modal, new tab, or clientId mismatch). Allow takeover. */
          const ownerUid = room.ownerUserId != null ? Number(room.ownerUserId) : null;
          if (
            ownerUid != null &&
            claimUid != null &&
            Number(claimUid) === ownerUid
          ) {
            if (room.players.has(room.host)) {
              const op = room.players.get(room.host);
              if (op) op.isHost = false;
            }
            room.host = socket.id;
            if (clientId) room.hostClientId = clientId;
            effectiveIsHost = true;
            console.log(`Host takeover by room owner (uid ${ownerUid}) for room ${roomId}`);
          } else {
            effectiveIsHost = false;
            console.warn(`Host claim rejected for ${playerName} — room ${roomId} already has an active host`);
            socket.emit('host-join-denied', {
              roomId,
              reason: 'room_has_host',
              message: 'This room already has a host. Use the player link to join, or wait for the host to leave.'
            });
          }
        }
      }
    }
    
    const inPerson = data.inPerson !== false;
    const player = {
      id: socket.id,
      name: playerName,
      isHost: effectiveIsHost,
      hasBingo: false,
      clientId: clientId || null,
      /** false = joined as remote/online when host enables hybrid mode */
      inPerson
    };
    
    room.players.set(socket.id, player);

    if (room.ownerUserId != null && db) {
      try {
        await resolveRoomVenueBranding(room);
      } catch (e) {
        console.error('join-room resolveRoomVenueBranding:', e?.message || e);
      }
    }
    
    if (effectiveIsHost) {
      for (const [pid, p] of room.players) {
        if (pid !== socket.id && p.isHost) {
          console.log(`Removing old host entry for ${p.name} (${pid})`);
          p.isHost = false;
        }
      }
    }
    
    console.log(`Player ${playerName} joined room ${roomId}. Total players: ${room.players.size}`);
    console.log(`Room host: ${room.host}, Current socket: ${socket.id}`);
    
    // Emit player joined event to all players in the room
    io.to(roomId).emit('player-joined', {
      playerId: socket.id,
      playerName: playerName,
      isHost: effectiveIsHost,
      playerCount: getNonHostPlayerCount(room),
      inPerson
    });

    // Emit successful room join confirmation to the joining socket
    socket.emit('room-joined', {
      roomId: roomId,
      organizationId: organizationId,
      playerName: playerName,
      isHost: effectiveIsHost,
      playerCount: getNonHostPlayerCount(room),
      hybridInPersonPlusOnline: !!room.hybridInPersonPlusOnline,
      venueBranding: venueBrandingForRoom(room),
    });

    // Log available devices for debugging
    console.log('Available devices:', Array.from(room.players.values()).map(p => p.name));

    // If a game is already in progress or mix is finalized, provide the joining player with state
    (async () => {
      try {
        // HOST RECONNECTION: Send comprehensive state sync
        if (effectiveIsHost) {
          console.log(`🔄 Host reconnecting - sending full state sync for ${playerName}`);
          
          // Send current game state
          const playedSongIds = Array.isArray(room.calledSongIds) ? [...room.calledSongIds] : [];
          if (room.currentSong && room.currentSong.id && !playedSongIds.includes(room.currentSong.id)) {
            playedSongIds.push(room.currentSong.id);
          }
          
          socket.emit('room-state', {
            isPlaying: room.gameState === 'playing',
            pattern: room.pattern || 'line',
            customMask: Array.from(room.customPattern || []),
            currentSong: room.currentSong || null,
            snippetLength: room.snippetLength || 30,
            playerCount: getNonHostPlayerCount(room),
            gameState: room.gameState,
            winners: room.winners || [],
            playedSongs: playedSongIds,
            roundWinners: room.roundWinners || [],
            mixFinalized: room.mixFinalized || false,
            playlists: room.finalizedPlaylists || room.playlists || [],
            selectedDeviceId: room.selectedDeviceId || null,
            hybridInPersonPlusOnline: !!room.hybridInPersonPlusOnline,
            venueBranding: venueBrandingForRoom(room),
          });
          
          // Send current song info if playing
          if (room.currentSong && room.snippetLength) {
            const idx = room.currentSongIndex || 0;
            const poolSong = room.playlistSongs?.[idx];
            const explicit =
              room.currentSong.explicit === true || poolSong?.explicit === true;
            socket.emit('song-playing', {
              songId: room.currentSong.id,
              songName: room.currentSong.name,
              artistName: room.currentSong.artist,
              explicit,
              snippetLength: room.snippetLength,
              currentIndex: idx,
              totalSongs: room.playlistSongs?.length || 0,
              previewUrl: poolSong?.previewUrl || null
            });
          }
          
          // Immediately send player cards to reconnecting host
          sendPlayerCardUpdates(roomId, true); // Immediate update for reconnecting host
          
          // Note: Pending verifications are sent to all hosts when bingo is called,
          // so if host reconnects during verification, they'll receive it via the normal flow
          
          console.log(`✅ Host reconnection state sync complete for ${playerName}`);
        } else {
          // Non-host player: Emit current song to sync display timing
          if (room.currentSong && room.snippetLength) {
            const idx = room.currentSongIndex || 0;
            const poolSong = room.playlistSongs?.[idx];
            const explicit =
              room.currentSong.explicit === true || poolSong?.explicit === true;
            socket.emit('song-playing', {
              songId: room.currentSong.id,
              songName: room.currentSong.name,
              artistName: room.currentSong.artist,
              explicit,
              snippetLength: room.snippetLength,
              currentIndex: idx,
              totalSongs: room.playlistSongs?.length || 0,
              previewUrl: poolSong?.previewUrl || null
            });
          }
        }

        // Ensure bingo card exists for ALL players (including hosts) if cards are available
        if (!room.bingoCards) room.bingoCards = new Map();
        const bySocket = room.bingoCards.get(socket.id);
        if (bySocket) {
          player.bingoCard = bySocket; // Ensure it's also on the player object
          // Card already has marks preserved from room.bingoCards
          // Don't send isNewCard flag on reconnect - this is an existing card with marks
          io.to(socket.id).emit('bingo-card', bySocket);
        } else if (clientId && room.clientCards && room.clientCards.has(clientId)) {
          const existingCard = room.clientCards.get(clientId);
          // CRITICAL: Restore card to room.bingoCards with preserved marks
          room.bingoCards.set(socket.id, existingCard);
          player.bingoCard = existingCard; // Set on player object
          // Card already has marks preserved from clientCards
          // Don't send isNewCard flag on reconnect - this is an existing card with marks
          io.to(socket.id).emit('bingo-card', existingCard);
        } else if (room.playlistSongs?.length || room.playlists?.length || room.finalizedPlaylists?.length) {
          // Generate card for any player (host or not) if playlists exist
          console.log(`🎲 Generating bingo card for ${effectiveIsHost ? 'host' : 'player'} ${playerName}`);
          const card = await generateBingoCardForPlayer(roomId, socket.id);
          if (card && clientId) {
            if (!room.clientCards) room.clientCards = new Map();
            room.clientCards.set(clientId, card);
          }
        }
      } catch (e) {
        console.error('❌ Error preparing join-in-progress state:', e?.message || e);
      }
    })();
  });

  // Start game
  socket.on('finalize-mix', async (data) => {
    const { roomId, playlists, songList, freeSpace } = data;
    console.log('🎵 Finalizing mix for room:', roomId);
    
    const room = rooms.get(roomId);
    if (!room) {
      console.log('❌ Room not found for mix finalization');
      return;
    }

    // Enhanced host validation with detailed logging
    const player = room.players.get(socket.id);
    const roomHostId = room.host;
    const currentSocketId = socket.id;
    const playerIsHost = player && player.isHost;
    const socketIsRoomHost = roomHostId === currentSocketId;
    const isCurrentHost = socketIsRoomHost || playerIsHost;
    
    console.log(`🔍 Host validation - Room: ${roomId}, Socket: ${currentSocketId}, Room Host: ${roomHostId}, Player Found: ${!!player}, Player isHost: ${!!playerIsHost}, Valid: ${isCurrentHost}`);
    
    if (!isCurrentHost) {
      console.log('❌ Only host can finalize mix');
      socket.emit('error', { message: 'Only the host can finalize the mix' });
      return;
    }

    // Prevent duplicate finalization
    if (room.mixFinalized) {
      console.log('⚠️ Mix already finalized for room:', roomId);
      socket.emit('mix-finalized', { playlists: room.finalizedPlaylists });
      return;
    }

    try {
      // Persist finalized data, including host-ordered song list if provided
      room.finalizedPlaylists = playlists;
      room.finalizedSongOrder = Array.isArray(songList) ? songList : null;
      room.freeSpaceEnabled = !!freeSpace;
      
      // Store the full song objects for song replacement functionality
      if (Array.isArray(songList) && songList.length > 0) {
        console.log('📋 Received songList for finalization:', {
          length: songList.length,
          hasPlaylistInfo: songList.length > 0 ? !!songList[0]?.sourcePlaylistId : false,
          firstSong: songList.length > 0 ? {
            id: songList[0].id,
            name: songList[0].name,
            sourcePlaylistId: songList[0].sourcePlaylistId,
            sourcePlaylistName: songList[0].sourcePlaylistName
          } : null
        });
        
        room.finalizedSongs = songList; // Store full song objects with sourcePlaylistId, etc.
        console.log(`📝 Stored ${songList.length} finalized songs for room ${roomId}`);
      } else {
        console.log('⚠️ No songList received or empty songList for finalization');
      }
      
      // Generate bingo cards for all players (respect host order where applicable)
      await generateBingoCards(roomId, playlists, room.finalizedSongOrder || null);
      
      // Update room state to indicate mix is finalized
      room.mixFinalized = true;
      
      // Notify all players that mix is finalized
      io.to(roomId).emit('mix-finalized', { playlists });
      
      console.log('✅ Mix finalized for room:', roomId);
    } catch (error) {
      console.error('❌ Error finalizing mix:', error);
    }
  });

  // Set game pattern
  socket.on('set-pattern', (data = {}) => {
    try {
      const { roomId, pattern, customMask } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
      if (!isCurrentHost) return;
      const allowed = new Set(['line', 'four_corners', 'x', 'full_card', 't', 'l', 'u', 'plus', 'custom']);
      room.pattern = allowed.has(pattern) ? pattern : 'line';
      if (room.pattern === 'custom') {
        const mask = Array.isArray(customMask) ? customMask.filter(p => /^(0|1|2|3|4)-(0|1|2|3|4)$/.test(p)) : [];
        room.customPattern = new Set(mask);
      } else {
        room.customPattern = undefined;
      }
      io.to(roomId).emit('pattern-updated', { pattern: room.pattern, customMask: Array.from(room.customPattern || []) });
      console.log(`🎯 Pattern set to ${room.pattern} for room ${roomId}`);
    } catch (e) {
      console.error('❌ Error setting pattern:', e?.message || e);
    }
  });

  // Hybrid in-person + online: only in-person verified bingos end the round / prize
  socket.on('set-hybrid-mode', (data = {}) => {
    try {
      const { roomId, hybridInPersonPlusOnline } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
      if (!isCurrentHost) return;
      room.hybridInPersonPlusOnline = !!hybridInPersonPlusOnline;
      io.to(roomId).emit('hybrid-mode-updated', { hybridInPersonPlusOnline: room.hybridInPersonPlusOnline });
      console.log(`🌐 Hybrid in-person+online for room ${roomId}: ${room.hybridInPersonPlusOnline}`);
    } catch (e) {
      console.error('❌ Error setting hybrid mode:', e?.message || e);
    }
  });

  // Set public display font size multiplier
  socket.on('set-public-display-font-size', (data = {}) => {
    try {
      const { roomId, fontSize } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
      if (!isCurrentHost) return;
      
      // Validate font size (0.5 to 3.0 multiplier)
      const validFontSize = Math.max(0.5, Math.min(3.0, parseFloat(fontSize) || 1.0));
      room.publicDisplayFontSize = validFontSize;
      
      // Broadcast to all clients in room
      io.to(roomId).emit('public-display-font-size-updated', { fontSize: validFontSize });
      console.log(`📏 Public display font size set to ${validFontSize}x for room ${roomId}`);
    } catch (e) {
      console.error('❌ Error setting public display font size:', e?.message || e);
    }
  });

  // Player calls BINGO (validated server-side)
  socket.on('player-bingo', (data) => {
    const { roomId } = data || {};
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('bingo-result', { success: false, reason: 'Room not found' });
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      console.error(`❌ Player not found for socket ${socket.id} in room ${roomId}`);
      console.log(`Room has players:`, Array.from(room.players.keys()));
      socket.emit('bingo-result', { success: false, reason: 'Player not found in room' });
      return;
    }
    if (player.inPerson === undefined) player.inPerson = true;
    if (!player.bingoCard) {
      console.error(`❌ Player ${player.name} (${socket.id}) has no bingo card`);
      console.log(`Room bingo cards:`, Array.from(room.bingoCards?.keys() || []));
      socket.emit('bingo-result', { success: false, reason: 'No bingo card assigned. Please refresh and rejoin.' });
      return;
    }
    
    if (player.hasBingo) {
      socket.emit('bingo-result', { success: false, reason: 'You have already called bingo!' });
      return;
    }
    
    // CRITICAL: Mark current song as played BEFORE validation so it's included in validation
    // This ensures that if a player calls bingo while a song is playing, that song counts
    if (room.currentSong && room.currentSong.id) {
      room.calledSongIds = Array.isArray(room.calledSongIds) ? room.calledSongIds : [];
      if (!room.calledSongIds.includes(room.currentSong.id)) {
        room.calledSongIds.push(room.currentSong.id);
        console.log(`📝 BINGO CALL: Marked current song as played BEFORE validation: ${room.currentSong.name} (${room.currentSong.id})`);
      } else {
        console.log(`✅ BINGO CALL: Current song already in played list: ${room.currentSong.name} (${room.currentSong.id})`);
      }
      console.log(`📋 BINGO CALL: Total played songs before validation: ${room.calledSongIds.length}`);
    } else {
      console.warn(`⚠️ BINGO CALL: No current song to mark as played! This could cause validation issues.`);
    }
    
    const validationResult = validateBingoForPattern(player.bingoCard, room);

    const hybridMode = !!room.hybridInPersonPlusOnline;
    const isRemotePlayer = hybridMode && player.inPerson === false;

    if (isRemotePlayer) {
      if (validationResult.valid) {
        player.hasBingo = true;
        socket.emit('bingo-result', {
          success: true,
          hybridUnofficial: true,
          message: 'You completed the pattern! (Online — the round continues until an in-person player wins.)',
          awaitingVerification: false,
          isWinner: false
        });
        io.to(roomId).emit('bingo-remote-unofficial', {
          playerId: socket.id,
          playerName: player.name,
          patternType: validationResult.type || room.pattern,
          timestamp: Date.now()
        });
        console.log(`🌐 Remote hybrid bingo (unofficial) for ${player.name}`);
      } else {
        socket.emit('bingo-result', {
          success: false,
          reason: validationResult.reason || 'Pattern not complete or invalid marks',
          hybridUnofficial: true
        });
      }
      return;
    }

    // Get winning pattern positions for verification display
    const winningPatternPositions = getWinningPatternPositions(player.bingoCard, room, validationResult);
    
    if (validationResult.valid) {
      // AUTO-PAUSE the game for host verification
      if (room.gameState === 'playing') {
        room.gameState = 'paused_for_verification';
        clearRoomTimer(roomId);
        
        // Pause Spotify playback during verification
        (async () => {
          try {
            const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
            if (deviceId) {
              await spotifyFor(roomId).pausePlayback(deviceId);
              console.log(`⏸️ Spotify paused for bingo verification by ${player.name}`);
            } else {
              console.log(`⚠️ No device ID available for pausing during bingo verification`);
            }
          } catch (error) {
            console.log(`⚠️ Failed to pause Spotify during bingo verification: ${error.message}`);
          }
        })();
        
        console.log(`🛑 Game auto-paused for bingo verification by ${player.name}`);
      }
      
      // Current song already added to calledSongIds before validation above
      // No need to add it again here
      
      player.hasBingo = true;
      const winnerData = { playerId: socket.id, playerName: player.name, timestamp: Date.now() };
      room.winners.push(winnerData);
      
      // Send success to the caller
      socket.emit('bingo-result', { 
        success: true, 
        message: 'BINGO! Waiting for host verification...',
        isWinner: true,
        totalWinners: room.winners.length,
        awaitingVerification: true
      });
      
      // Send detailed verification data to ALL HOSTS (in case host reconnected)
      // Build actual played songs from calledSongIds with enhanced validation
      const actuallyPlayedSongs = [];
      const calledIds = room.calledSongIds || [];
      const missingFromPlaylist = [];
      
      console.log(`🔍 BINGO VERIFICATION: Building played songs list from ${calledIds.length} called IDs`);
      console.log(`🔍 Called song IDs: [${calledIds.join(', ')}]`);
      
      for (const songId of calledIds) {
        // Find the song in the playlist
        const foundSong = room.playlistSongs?.find(s => s.id === songId);
        if (foundSong) {
          actuallyPlayedSongs.push({
            id: foundSong.id,
            name: foundSong.name,
            artist: foundSong.artist
          });
          console.log(`✅ Found played song: ${foundSong.name} by ${foundSong.artist}`);
        } else {
          missingFromPlaylist.push(songId);
          console.warn(`⚠️ Song ID ${songId} in calledSongIds but NOT found in room.playlistSongs`);
        }
      }
      
      console.log(`📊 VERIFICATION SUMMARY: ${actuallyPlayedSongs.length} played songs found, ${missingFromPlaylist.length} missing from playlist`);
      if (missingFromPlaylist.length > 0) {
        console.warn(`🚨 MISSING SONGS: [${missingFromPlaylist.join(', ')}] - This could indicate a data integrity issue`);
      }
      
      // CRITICAL: Use room.bingoCards as source of truth (it's kept in sync with marks)
      // Fallback to player.bingoCard if room card doesn't exist
      const sourceCard = room.bingoCards?.get(socket.id) || player.bingoCard;
      if (!sourceCard) {
        console.error(`❌ No card found for player ${player.name} (${socket.id})`);
        socket.emit('bingo-result', { success: false, reason: 'Card data not found' });
        return;
      }
      
      // Validate marked squares data using the source card
      const markedSquares = sourceCard.squares.filter(s => s.marked);
      console.log(`🔍 MARKED SQUARES: Player has ${markedSquares.length} marked squares`);
      console.log(`🔍 VERIFICATION DEBUG: Using ${room.bingoCards?.get(socket.id) ? 'room.bingoCards' : 'player.bingoCard'} as source`);
      markedSquares.forEach((square, index) => {
        const wasPlayed = actuallyPlayedSongs.some(played => played.id === square.songId);
        console.log(`${index + 1}. ${square.songName} by ${square.artistName} (${square.songId}) - ${wasPlayed ? '✅ PLAYED' : '❌ NOT PLAYED'}`);
      });
      
      // Debug: Verify card has marked properties before sending
      const markedCount = sourceCard.squares.filter(s => s.marked).length;
      console.log(`🔍 VERIFICATION DEBUG: Card has ${markedCount} marked squares out of ${sourceCard.squares.length} total`);
      console.log(`🔍 VERIFICATION DEBUG: Sample square marked state:`, sourceCard.squares[0]?.marked);
      console.log(`🔍 VERIFICATION DEBUG: Marked squares positions:`, sourceCard.squares.filter(s => s.marked).map(s => `${s.position} (${s.songName})`));
      
      // Create a deep copy to ensure we're sending fresh data
      const cardToSend = {
        ...sourceCard,
        squares: sourceCard.squares.map(s => ({
          ...s,
          marked: s.marked === true // Explicit boolean conversion
        }))
      };
      
      const verificationData = {
        playerId: socket.id,
        playerName: player.name,
        playerCard: cardToSend, // Use the synchronized card with explicit marked properties
        markedSquares: markedSquares,
        requiredPattern: room.pattern,
        customMask: room.pattern === 'custom' ? Array.from(room.customPattern || []) : null,
        playedSongs: actuallyPlayedSongs, // Use the proper actually played songs
        calledSongIds: room.calledSongIds || [],
        currentSongIndex: room.currentSongIndex || 0,
        timestamp: Date.now(),
        validationReason: validationResult.reason,
        winningPatternPositions: winningPatternPositions, // Positions that form the winning pattern
        winningPatternType: validationResult.type || room.pattern, // Type of winning pattern
        // Add debug info for troubleshooting
        debugInfo: {
          totalCalledIds: calledIds.length,
          totalPlayedSongs: actuallyPlayedSongs.length,
          totalMarkedSquares: markedSquares.length,
          missingFromPlaylist: missingFromPlaylist.length,
          cardMarkedCount: markedCount,
          cardSource: room.bingoCards?.get(socket.id) ? 'room.bingoCards' : 'player.bingoCard'
        }
      };
      
      // Send to ALL hosts in the room (handles reconnection case)
      let hostsFound = 0;
      room.players.forEach((playerData, playerId) => {
        if (playerData.isHost) {
          const hostSocket = io.sockets.sockets.get(playerId);
          if (hostSocket) {
            hostSocket.emit('bingo-verification-needed', verificationData);
            hostsFound++;
            console.log(`📤 Sent bingo verification to host: ${playerData.name} (${playerId})`);
          } else {
            console.warn(`⚠️ Host socket not found for ${playerData.name} (${playerId}) - may have disconnected`);
          }
        }
      });
      
      // Fallback: Also try room.host if no hosts found via player list
      if (hostsFound === 0 && room.host) {
        const fallbackHostSocket = io.sockets.sockets.get(room.host);
        if (fallbackHostSocket) {
          fallbackHostSocket.emit('bingo-verification-needed', verificationData);
          console.log(`📤 Sent bingo verification to fallback host (${room.host})`);
        } else {
          console.error(`❌ CRITICAL: No host sockets found! Room host: ${room.host}, Hosts in players: ${Array.from(room.players.entries()).filter(([_, p]) => p.isHost).map(([id, p]) => `${p.name}(${id})`).join(', ')}`);
          // Emit to room as last resort - host should still receive it
          io.to(roomId).emit('bingo-verification-needed', verificationData);
          console.log(`📤 Emitted bingo verification to entire room as fallback`);
        }
      }
      
      // Notify all players about the bingo call (but not confirmed yet)
      io.to(roomId).emit('bingo-verification-pending', { 
        playerId: socket.id, 
        playerName: player.name, 
        awaitingVerification: true
      });
    } else {
      // INVALID BINGO: Still send to host for verification (host can reject)
      // This allows players to attempt bingo calls even with invalid marks
      console.log(`⚠️ Invalid bingo call from ${player.name}, but sending to host for verification`);
      
      // AUTO-PAUSE the game for host verification even if invalid
      if (room.gameState === 'playing') {
        room.gameState = 'paused_for_verification';
        clearRoomTimer(roomId);
        
        // Pause Spotify playback during verification
        (async () => {
          try {
            const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
            if (deviceId) {
              await spotifyFor(roomId).pausePlayback(deviceId);
              console.log(`⏸️ Spotify paused for invalid bingo verification by ${player.name}`);
            }
          } catch (error) {
            console.log(`⚠️ Failed to pause Spotify during bingo verification: ${error.message}`);
          }
        })();
        
        console.log(`🛑 Game auto-paused for invalid bingo verification by ${player.name}`);
      }
      
      // Build played songs list
      const actuallyPlayedSongs = [];
      const calledIds = room.calledSongIds || [];
      
      for (const songId of calledIds) {
        const foundSong = room.playlistSongs?.find(s => s.id === songId);
        if (foundSong) {
          actuallyPlayedSongs.push({
            id: foundSong.id,
            name: foundSong.name,
            artist: foundSong.artist
          });
        }
      }
      
      // Use room.bingoCards as source of truth
      const sourceCard = room.bingoCards?.get(socket.id) || player.bingoCard;
      if (!sourceCard) {
        socket.emit('bingo-result', { success: false, reason: 'Card data not found' });
        return;
      }
      
      const markedSquares = sourceCard.squares.filter(s => s.marked);
      const winningPatternPositions = getWinningPatternPositions(player.bingoCard, room, validationResult);
      
      const cardToSend = {
        ...sourceCard,
        squares: sourceCard.squares.map(s => ({
          ...s,
          marked: s.marked === true
        }))
      };
      
      const verificationData = {
        playerId: socket.id,
        playerName: player.name,
        playerCard: cardToSend,
        markedSquares: markedSquares,
        requiredPattern: room.pattern,
        customMask: room.pattern === 'custom' ? Array.from(room.customPattern || []) : null,
        playedSongs: actuallyPlayedSongs,
        calledSongIds: room.calledSongIds || [],
        currentSongIndex: room.currentSongIndex || 0,
        timestamp: Date.now(),
        validationReason: validationResult.reason || 'Invalid bingo pattern',
        isValid: false, // Mark as invalid for host
        winningPatternPositions: winningPatternPositions,
        winningPatternType: validationResult.type || room.pattern
      };
      
      // Send to ALL hosts even though validation failed
      let hostsFound = 0;
      room.players.forEach((playerData, playerId) => {
        if (playerData.isHost) {
          const hostSocket = io.sockets.sockets.get(playerId);
          if (hostSocket) {
            hostSocket.emit('bingo-verification-needed', verificationData);
            hostsFound++;
            console.log(`📤 Sent invalid bingo verification to host: ${playerData.name} (${playerId})`);
          }
        }
      });
      
      if (hostsFound === 0 && room.host) {
        const fallbackHostSocket = io.sockets.sockets.get(room.host);
        if (fallbackHostSocket) {
          fallbackHostSocket.emit('bingo-verification-needed', verificationData);
          console.log(`📤 Sent invalid bingo verification to fallback host (${room.host})`);
        } else {
          io.to(roomId).emit('bingo-verification-needed', verificationData);
          console.log(`📤 Emitted invalid bingo verification to entire room as fallback`);
        }
      }
      
      // Notify player that bingo call was received (awaiting host verification)
      socket.emit('bingo-result', { 
        success: true, 
        message: 'BINGO! Waiting for host verification...',
        isWinner: false,
        awaitingVerification: true,
        isValid: false // Let player know validation failed but host will verify
      });
      
      // Notify all players about the bingo call
      io.to(roomId).emit('bingo-verification-pending', { 
        playerId: socket.id, 
        playerName: player.name, 
        awaitingVerification: true
      });
    }
  });

  // Host approves or rejects bingo verification
  socket.on('verify-bingo', (data) => {
    const { roomId, playerId, approved, reason, playerName: bodyPlayerName } = data || {};
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('bingo-verified', {
        approved: false,
        error: 'no_room',
        reason: 'Room not found — refresh and try again.',
        playerName: bodyPlayerName || 'Unknown'
      });
      return;
    }
    const isHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
    if (!isHost) {
      socket.emit('bingo-verified', {
        approved: false,
        error: 'not_host',
        reason: 'Only the host can approve or reject bingo.',
        playerName: bodyPlayerName || 'Unknown'
      });
      return;
    }
    
    let resolvedPlayerId = playerId;
    let player = room.players.get(playerId);
    // If caller reconnected, socket id in verification payload may be stale — resolve by display name
    if (!player && bodyPlayerName) {
      for (const [pid, p] of room.players) {
        if (p.name === bodyPlayerName && !p.isHost) {
          player = p;
          resolvedPlayerId = pid;
          console.log(`verify-bingo: resolved "${bodyPlayerName}" by name → socket ${pid}`);
          break;
        }
      }
    }
    if (!player) {
      console.warn(`verify-bingo: player not found (id=${playerId}, name=${bodyPlayerName || 'n/a'}) — host UI was waiting forever`);
      socket.emit('bingo-verified', {
        approved: false,
        error: 'player_not_found',
        reason: 'That player disconnected or reconnected before approval. Dismiss and continue.',
        playerName: bodyPlayerName || 'Unknown'
      });
      return;
    }
    
    if (approved) {
      // APPROVED: Confirm the win and resume/end game
      console.log(`✅ Host approved bingo for ${player.name}`);
      
      // Current song already marked as played during bingo call
      
      // Notify the winner (use resolved socket id — may differ after player reconnect)
      io.to(resolvedPlayerId).emit('bingo-result', {
        success: true,
        message: 'BINGO CONFIRMED! You win!',
        isWinner: true,
        verified: true
      });
      
      // Notify all players of confirmed win
      io.to(roomId).emit('bingo-confirmed', {
        playerId: resolvedPlayerId,
        playerName: player.name,
        verified: true
      });
      
      // Serialize winning card + pattern positions for public display modal
      const sourceCard = room.bingoCards?.get(resolvedPlayerId) || player.bingoCard;
      let winningCardPayload = null;
      let winningPositions = [];
      if (sourceCard && Array.isArray(sourceCard.squares)) {
        const validationResult = validateBingoForPattern(sourceCard, room);
        winningPositions = getWinningPatternPositions(sourceCard, room, validationResult);
        if (!winningPositions.length) {
          winningPositions = sourceCard.squares.filter((s) => s.marked).map((s) => s.position);
        }
        winningCardPayload = {
          size: sourceCard.size || 5,
          squares: sourceCard.squares.map((s) => ({
            position: s.position,
            songId: s.songId,
            songName: s.songName,
            customSongName: s.customSongName,
            artistName: s.artistName,
            marked: !!s.marked,
            isFreeSpace: !!s.isFreeSpace,
          })),
        };
      }

      // NOW emit the actual winner event for public display
      io.to(roomId).emit('bingo-called', { 
        playerId: resolvedPlayerId, 
        playerName: player.name, 
        winners: room.winners,
        totalWinners: room.winners.length,
        isFirstWinner: room.winners.length === 1,
        awaitingVerification: false,
        verified: true,
        pattern: room.pattern || 'line',
        winningCard: winningCardPayload,
        winningPositions,
      });
      
      // PAUSE GAME for host to decide: next round or end completely
      room.gameState = 'round_complete';
      clearRoomTimer(roomId);
      clearPlaybackWatcher(roomId);
      
      // CRITICAL: Stop Spotify playback when round completes
      (async () => {
        try {
          const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
          if (deviceId) {
            await spotifyFor(roomId).pausePlayback(deviceId);
            console.log(`⏸️ Spotify paused - round complete`);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to pause Spotify on round complete: ${error.message}`);
        }
      })();
      
      console.log(`🏁 Round complete - ${player.name} wins! Waiting for host decision...`);
      
      // Store round winner
      if (!room.roundWinners) room.roundWinners = [];
      room.roundWinners.push({
        roundNumber: (room.roundWinners.length || 0) + 1,
        playerName: player.name,
        playerId: resolvedPlayerId,
        timestamp: new Date().toISOString()
      });
      
      // Notify ALL hosts with next round options (not just the approving host)
      // This ensures modal appears even if host reconnected or multiple hosts exist
      let hostsNotified = 0;
      room.players.forEach((playerData, hostSocketId) => {
        if (playerData.isHost) {
          const hostSocket = io.sockets.sockets.get(hostSocketId);
          if (hostSocket) {
            hostSocket.emit('bingo-verified', { 
              approved: true, 
              playerName: player.name,
              gameEnded: false,
              roundComplete: true,
              roundNumber: room.roundWinners.length,
              message: `Round ${room.roundWinners.length} complete - ${player.name} wins!`,
              options: {
                nextRound: true,
                endGame: true,
                changePattern: true,
                changePlaylists: true
              }
            });
            hostsNotified++;
            console.log(`📤 Sent round-complete notification to host: ${playerData.name} (${hostSocketId})`);
          }
        }
      });
      
      // Fallback: if no active host sockets found, try room.host
      if (hostsNotified === 0 && room.host) {
        const fallbackHostSocket = io.sockets.sockets.get(room.host);
        if (fallbackHostSocket) {
          fallbackHostSocket.emit('bingo-verified', { 
            approved: true, 
            playerName: player.name,
            gameEnded: false,
            roundComplete: true,
            roundNumber: room.roundWinners.length,
            message: `Round ${room.roundWinners.length} complete - ${player.name} wins!`,
            options: {
              nextRound: true,
              endGame: true,
              changePattern: true,
              changePlaylists: true
            }
          });
          console.log(`📤 Sent round-complete notification to fallback host (${room.host})`);
        } else {
          // Last resort: emit to entire room
          io.to(roomId).emit('bingo-verified', { 
            approved: true, 
            playerName: player.name,
            gameEnded: false,
            roundComplete: true,
            roundNumber: room.roundWinners.length,
            message: `Round ${room.roundWinners.length} complete - ${player.name} wins!`,
            options: {
              nextRound: true,
              endGame: true,
              changePattern: true,
              changePlaylists: true
            }
          });
          console.log(`📤 Emitted round-complete notification to entire room as last resort`);
        }
      }
      
      // Notify all clients that round is complete (not game ended)
      io.to(roomId).emit('round-complete', { 
        roomId, 
        winner: player.name,
        roundNumber: room.roundWinners.length,
        roundWinners: room.roundWinners,
        message: `Round ${room.roundWinners.length} complete! Waiting for next round...`
      });
      
    } else {
      // REJECTED: Remove from winners, notify player, resume game
      console.log(`❌ Host rejected bingo for ${player.name}: ${reason}`);
      
      // Remove from winners list (drop both stale and resolved ids after reconnect)
      room.winners = room.winners.filter(w => w.playerId !== playerId && w.playerId !== resolvedPlayerId);
      player.hasBingo = false;
      player.patternComplete = false; // Allow them to call again
      
      // Notify the player
      io.to(resolvedPlayerId).emit('bingo-result', {
        success: false,
        message: `Bingo rejected: ${reason || 'Invalid pattern'}`,
        rejected: true
      });
      
      // Notify host
      socket.emit('bingo-verified', { 
        approved: false, 
        playerName: player.name,
        reason: reason 
      });
      
      // Current song already marked as played during bingo call
      
      // Auto-resume the game
      if (room.gameState === 'paused_for_verification') {
        room.gameState = 'playing';
        // Resume from where we left off - first resume Spotify playback, then start progression timer
        (async () => {
          try {
            const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
            if (deviceId) {
              await spotifyFor(roomId).resumePlayback(deviceId);
              console.log(`▶️ Spotify resumed after rejecting ${player.name}'s bingo`);
            } else {
              console.log(`⚠️ No device ID available for resuming after bingo rejection`);
            }
            // Now start the progression timer for the remainder of the current song
            startSimpleProgression(roomId, room.selectedDeviceId, room.snippetLength || 30);
          } catch (error) {
            console.log(`⚠️ Failed to resume Spotify after bingo rejection: ${error.message}`);
            // Still start progression timer as fallback
            startSimpleProgression(roomId, room.selectedDeviceId, room.snippetLength || 30);
          }
        })();
        console.log(`▶️ Game resumed after rejecting ${player.name}'s bingo`);
        
        // Notify all clients that game has resumed
        io.to(roomId).emit('game-resumed', { reason: 'Bingo rejected, game continues' });
      }
    }
  });

  // Host manually resumes game (for recovery if verification modal didn't appear)
  socket.on('manual-resume-game', (data) => {
    const { roomId } = data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Verify this is the host
    const isHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
    if (!isHost) return;
    
    // Only resume if game is paused for verification
    if (room.gameState === 'paused_for_verification') {
      console.log(`▶️ Host manually resuming game from paused_for_verification state`);
      room.gameState = 'playing';
      
      // Resume Spotify playback
      (async () => {
        try {
          const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
          if (deviceId) {
            await spotifyFor(roomId).resumePlayback(deviceId);
            console.log(`▶️ Spotify resumed after manual resume`);
          }
          // Start progression timer for the remainder of the current song
          startSimpleProgression(roomId, room.selectedDeviceId, room.snippetLength || 30);
        } catch (error) {
          console.log(`⚠️ Failed to resume Spotify: ${error.message}`);
          // Still start progression timer as fallback
          startSimpleProgression(roomId, room.selectedDeviceId, room.snippetLength || 30);
        }
      })();
      
      // Notify all clients that game has resumed
      io.to(roomId).emit('game-resumed', { reason: 'Host manually resumed game' });
      console.log(`✅ Game manually resumed by host`);
    } else {
      console.log(`⚠️ Cannot manually resume: game state is ${room.gameState}, expected paused_for_verification`);
    }
  });

  // Host chooses to continue or end after approving bingo
  socket.on('continue-or-end', (data) => {
    const { roomId, action } = data || {}; // action: 'continue' or 'end'
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Verify this is the host
    const isHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
    if (!isHost) return;
    
    if (action === 'continue') {
      // Resume the game
      if (room.gameState === 'paused_for_verification') {
        room.gameState = 'playing';
        startSimpleProgression(roomId, room.selectedDeviceId, room.snippetLength || 30);
        console.log(`▶️ Host chose to continue game after bingo verification`);
        
        io.to(roomId).emit('game-resumed', { reason: 'Host continued after bingo' });
      }
    } else if (action === 'end') {
      // End the current round
      room.gameState = 'ended';
      clearRoomTimer(roomId);
      console.log(`🏁 Host ended game after bingo verification`);
      
      io.to(roomId).emit('game-ended', { reason: 'Host ended after bingo', winners: room.winners });
    }
  });

  // Emergency stop - immediate halt of all playback
  socket.on('emergency-stop', (data) => {
    const { roomId } = data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Verify this is the host
    const isHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
    if (!isHost) return;
    
    console.log(`🚨 EMERGENCY STOP requested for room ${roomId}`);
    
    // Immediate stop
    clearRoomTimer(roomId);
    
    // Try to pause Spotify immediately
    (async () => {
      try {
        if (room.selectedDeviceId) {
          await spotifyApi.pause();
          console.log('🛑 Emergency stop: Spotify paused');
        }
      } catch (error) {
        console.log('Emergency stop: Spotify pause failed (continuing anyway)');
      }
    })();
    
    // Notify all clients
    io.to(roomId).emit('emergency-stopped', { message: 'Emergency stop activated by host' });
  });

  // Host restarts the game completely
  socket.on('restart-game', (data) => {
    const { roomId } = data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Verify this is the host
    const isHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
    if (!isHost) return;
    
    console.log(`🔄 Host restarting game for room ${roomId}`);
    
    // Stop any current playback
    clearRoomTimer(roomId);
    
    // Reset game state
    room.gameState = 'waiting';
    room.currentSong = null;
    room.currentSongIndex = 0;
    room.currentSongStartMs = 0;
    room.winners = [];
    room.playedSongs = [];
    room.calledSongIds = [];
    room.roundWinners = []; // Reset round winners
    
    // Reset all player bingo status but keep their cards
    room.players.forEach((player) => {
      player.hasBingo = false;
      player.patternComplete = false; // Reset pattern completion flag
      if (player.bingoCard) resetBingoCardMarks(player.bingoCard);
    });
    
    if (room.bingoCards) {
      room.bingoCards.forEach((card) => resetBingoCardMarks(card));
    }
    if (room.clientCards) {
      room.clientCards.forEach((card) => resetBingoCardMarks(card));
    }
    
    // Notify all clients of the restart
    io.to(roomId).emit('game-restarted', {
      message: 'Game has been restarted by the host',
      roomState: {
        gameState: room.gameState,
        currentSong: null,
        winners: [],
        playedSongs: [],
        roundWinners: []
      }
    });
    
    console.log(`✅ Game restarted successfully for room ${roomId}`);
  });

  // NEW: Host starts next round after a bingo win (FULL RESET to setup)
  socket.on('start-next-round', (data) => {
    const { roomId, fullReset = true } = data || {};
    const room = rooms.get(roomId);
    if (!room) {
      console.error(`❌ start-next-round: Room ${roomId} not found`);
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    // Verify this is the host
    const isHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
    if (!isHost) {
      console.warn(`⚠️ start-next-round: Socket ${socket.id} is not host for room ${roomId}`);
      socket.emit('error', { message: 'Only host can start next round' });
      return;
    }
    
    // Allow starting next round from round_complete or waiting (in case state got stuck)
    // Also allow from 'playing' or 'paused_for_verification' as fallback recovery
    const allowedStates = ['round_complete', 'waiting', 'playing', 'paused_for_verification'];
    if (!allowedStates.includes(room.gameState)) {
      console.warn(`⚠️ start-next-round: Unexpected game state ${room.gameState} for room ${roomId}. Forcing reset anyway...`);
      // Don't return - allow the reset to proceed to fix stuck states
    } else {
      console.log(`✅ start-next-round: Game state is ${room.gameState} - proceeding with reset`);
    }
    
    console.log(`🔄 Host starting FRESH round ${(room.roundWinners?.length || 0) + 1} for room ${roomId}`);
    
    // CRITICAL: Clean up all active timers and watchers BEFORE reset
    clearRoomTimer(roomId);
    clearPlaybackWatcher(roomId);
    clearPlayerCardUpdateTimer(roomId); // Clear debounce timer
    
    // CRITICAL: Stop Spotify playback before reset
    (async () => {
      try {
        const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
        if (deviceId) {
          await spotifyFor(roomId).pausePlayback(deviceId);
          console.log(`⏸️ Spotify paused before round reset`);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to pause Spotify before reset: ${error.message}`);
      }
    })();
    
    // FULL RESET - back to point 0 of game setup (but keep players & Spotify)
    const playersToKeep = room.players; // Preserve players
    const hostToKeep = room.host; // Preserve host
    const roundWinnersToKeep = room.roundWinners || []; // Preserve round history
    const deviceToKeep = room.selectedDeviceId; // Preserve Spotify device
    
    // Reset EVERYTHING else back to initial setup state
    room.gameState = 'waiting';
    room.currentSong = null;
    room.currentSongIndex = 0;
    room.currentSongStartMs = 0;
    room.winners = [];
    room.playedSongs = [];
    room.calledSongIds = [];
    
    // Reset playlist and mix state - host needs to select playlists again
    room.playlists = [];
    room.selectedPlaylists = [];
    room.finalizedPlaylists = [];
    room.playlistSongs = [];
    room.mixFinalized = false;
    room.temporaryPlaylistId = null;
    room.finalizedSongOrder = [];
    
    // Reset pattern to default
    room.pattern = 'line';
    room.customPattern = new Set();
    
    // Reset settings to defaults  
    room.snippetLength = 30;
    room.randomStarts = 'none';
    room.revealMode = 'off';
    
    // Clear all bingo cards - they'll be regenerated when new playlists are selected
    room.bingoCards = new Map();
    room.clientCards = new Map();
    room.oneBySeventyFivePool = [];
    room.fiveByFifteenColumnsIds = [];
    room.fiveByFifteenPlaylistNames = [];
    room.fiveByFifteenMeta = {};
    
    // Reset all player states but keep them in the room
    room.players.forEach((player) => {
      player.hasBingo = false;
      player.patternComplete = false;
      player.bingoCard = null; // Will be regenerated with new playlists
    });
    
    // Preserve what we want to keep
    room.players = playersToKeep;
    room.host = hostToKeep;
    room.roundWinners = roundWinnersToKeep;
    room.selectedDeviceId = deviceToKeep;
    
    // CRITICAL: Clean up temporary playlist if it exists
    if (room.temporaryPlaylistId) {
      spotifyFor(roomId).deleteTemporaryPlaylist(room.temporaryPlaylistId).catch(err => 
        console.warn('⚠️ Failed to delete temporary playlist during reset:', err)
      );
      room.temporaryPlaylistId = null;
    }
    
    console.log(`🔄 Room ${roomId} reset to setup state, keeping ${room.players.size} players and Spotify connection`);
    
    // Notify all clients that we're starting fresh
    io.to(roomId).emit('next-round-reset', {
      message: `Round ${roundWinnersToKeep.length + 1} - Fresh Setup!`,
      roundNumber: roundWinnersToKeep.length + 1,
      totalRounds: roundWinnersToKeep.length,
      roundWinners: roundWinnersToKeep,
      resetToSetup: true,
      roomState: {
        gameState: 'waiting',
        pattern: 'line',
        currentSong: null,
        winners: [],
        playedSongs: [],
        mixFinalized: false,
        playlists: [],
        snippetLength: 30
      }
    });
    
    // Also emit game-restarted for players to reset their cards
    // Include clearCard flag so players know to clear their cards completely
    io.to(roomId).emit('game-restarted', {
      roomId,
      roundNumber: roundWinnersToKeep.length + 1,
      message: 'New round starting - fresh setup!',
      clearCard: true, // Signal that cards should be cleared (will be regenerated)
      resetToSetup: true
    });
    
    console.log(`✅ Fresh round ${roundWinnersToKeep.length + 1} setup ready for room ${roomId}`);
  });

  // NEW: Host ends the entire multi-round game session
  socket.on('end-game-session', (data) => {
    const { roomId } = data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Verify this is the host
    const isHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
    if (!isHost) return;
    
    console.log(`🏁 Host ending game session for room ${roomId}`);
    
    // Stop any current playback and clean up
    clearRoomTimer(roomId);
    clearPlaybackWatcher(roomId);
    clearPlayerCardUpdateTimer(roomId); // Clear debounce timer
    
    try {
      const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
      if (deviceId) {
        spotifyFor(roomId).pausePlayback(deviceId).catch(() => {});
      }
    } catch (e) {}
    
    // Clean up temporary playlist
    if (room.temporaryPlaylistId) {
      spotifyFor(roomId).deleteTemporaryPlaylist(room.temporaryPlaylistId).catch(err => 
        console.warn('⚠️ Failed to delete temporary playlist:', err)
      );
      room.temporaryPlaylistId = null;
    }
    
    // Set final game state
    room.gameState = 'ended';
    
    // Notify all clients that the entire game session has ended
    io.to(roomId).emit('game-session-ended', { 
      roomId,
      totalRounds: room.roundWinners?.length || 0,
      roundWinners: room.roundWinners || [],
      finalMessage: `Game session complete! ${room.roundWinners?.length || 0} rounds played.`
    });
    
    console.log(`✅ Game session ended for room ${roomId} after ${room.roundWinners?.length || 0} rounds`);
  });

  // Client requests a state sync (useful if they joined before start or missed events)
  socket.on('sync-state', (data = {}) => {
    try {
      const { roomId } = data;
      const room = rooms.get(roomId);
      if (!room) {
        console.log(`🔄 SYNC-STATE: Room ${roomId} not found`);
        return;
      }
      
      console.log(`🔄 SYNC-STATE: Sending state to ${socket.id} for room ${roomId}`);
      
      // Build played songs list that includes current song if it exists
      const playedSongIds = Array.isArray(room.calledSongIds) ? [...room.calledSongIds] : [];
      if (room.currentSong && room.currentSong.id && !playedSongIds.includes(room.currentSong.id)) {
        playedSongIds.push(room.currentSong.id);
      }
      
      // Enhanced payload with more comprehensive state data
      const payload = {
        isPlaying: room.gameState === 'playing',
        pattern: room.pattern || 'line',
        customMask: Array.from(room.customPattern || []),
        currentSong: room.currentSong || null,
        snippetLength: room.snippetLength || 30,
        playerCount: getNonHostPlayerCount(room),
        gameState: room.gameState,
        winners: room.winners || [],
        roundWinners: room.roundWinners || [],
        publicDisplayFontSize: room.publicDisplayFontSize || 1.0,
        venueBranding: venueBrandingForRoom(room),
        // Include played songs for PublicDisplay sync (includes current song)
        playedSongs: playedSongIds.map(songId => {
          const foundSong = room.playlistSongs?.find(s => s.id === songId);
          return foundSong ? {
            id: foundSong.id,
            name: foundSong.name,
            artist: foundSong.artist
          } : null;
        }).filter(Boolean),
        // Also send song IDs array for client state sync
        playedSongIds: playedSongIds,
        totalPlayedCount: playedSongIds.length,
        currentSongIndex: room.currentSongIndex || 0,
        totalSongs: room.playlistSongs?.length || 0,
        // Sync timestamp for client reference
        syncTimestamp: Date.now(),
        hybridInPersonPlusOnline: !!room.hybridInPersonPlusOnline
      };
      
      // Include fiveby15 columns if available (for public display)
      if (room.fiveByFifteenColumnsIds && Array.isArray(room.fiveByFifteenColumnsIds) && room.fiveByFifteenColumnsIds.length === 5) {
        const idToCol = {};
        room.fiveByFifteenColumnsIds.forEach((colIds, colIdx) => {
          colIds.forEach((id) => { idToCol[id] = colIdx; });
        });
        // Emit fiveby15-pool and map to ensure display has columns
        socket.emit('fiveby15-pool', { 
          columns: room.fiveByFifteenColumnsIds, 
          names: room.fiveByFifteenPlaylistNames || [],
          meta: room.fiveByFifteenMeta || {}
        });
        socket.emit('fiveby15-map', { idToColumn: idToCol });
      }
      
      // Include oneby75 pool if available (for public display fallback)
      if (room.oneBySeventyFivePool && Array.isArray(room.oneBySeventyFivePool) && room.oneBySeventyFivePool.length > 0) {
        const oneBy75Ids = room.oneBySeventyFivePool.map(s => s.id).filter(Boolean);
        socket.emit('oneby75-pool', { ids: oneBy75Ids });
      }
      
      io.to(socket.id).emit('room-state', payload);
      console.log(`✅ SYNC-STATE: Sent comprehensive state (${payload.totalPlayedCount} played songs, ${payload.playerCount} players)`);
    } catch (e) {
      console.error('❌ SYNC-STATE error:', e?.message || e);
    }
  });

  // Host requests to view all player cards
  socket.on('request-player-cards', (data = {}) => {
    try {
      const { roomId } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      
      // Verify this is the host
      const isHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
      if (!isHost) return;
      
      // Build playedSongs array that includes current song if it exists
      const playedSongs = Array.isArray(room.calledSongIds) ? [...room.calledSongIds] : [];
      if (room.currentSong && room.currentSong.id && !playedSongs.includes(room.currentSong.id)) {
        playedSongs.push(room.currentSong.id);
      }
      
      const playerCardsData = {};
      if (room.bingoCards) {
        room.bingoCards.forEach((card, playerId) => {
          const player = room.players.get(playerId);
          if (player && card) {
            // Only include actual players (not hosts or public display)
            if (!player.isHost && player.name !== 'Display') {
              playerCardsData[playerId] = {
                playerName: player.name,
                card: card,
                playedSongs: playedSongs // Include current song if playing
              };
            }
          }
        });
      }
      
      socket.emit('player-cards-update', playerCardsData);
      console.log(`📋 Sent ${Object.keys(playerCardsData).length} player cards to host in room ${roomId}`);
      console.log(`📋 CalledSongIds being sent:`, room.calledSongIds);
      console.log(`📋 CalledSongIds length:`, room.calledSongIds?.length || 0);
    } catch (e) {
      console.error('❌ Error sending player cards:', e?.message || e);
    }
  });

  // New Round (preserve device and snippet)
  socket.on('new-round', (data = {}) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    if (!room) return;
    const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
    if (!isCurrentHost) return;
    try {
      room.winners = [];
      room.calledSongIds = [];
      room.bingoCards = new Map();
      // Reset persistent client-to-card mapping for the new round
      room.clientCards = new Map();
      room.currentSong = null;
      room.currentSongIndex = 0;
      // Queue cleared by removing pre-queue system
      room.round = (room.round || 0) + 1;
      io.to(roomId).emit('round-reset', { round: room.round });
      console.log(`🔄 New round started for room ${roomId} (round ${room.round})`);
    } catch (e) {
      console.error('❌ Error starting new round:', e?.message || e);
    }
  });

  // Pre-queue system removed - deterministic playback only

  // Toggle super-strict lock mode from Host
  socket.on('set-super-strict', (data = {}) => {
    try {
      const { roomId, enabled } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
      if (!isCurrentHost) return;
      room.superStrictLock = !!enabled;
      io.to(roomId).emit('super-strict-updated', { enabled: room.superStrictLock });
      console.log(`🔒 Super-Strict Lock set to ${room.superStrictLock} for room ${roomId}`);
      // Restart simple context monitor (no aggressive pausing)
      if (room.gameState === 'playing') {
        startSimpleContextMonitor(roomId, room.selectedDeviceId);
      }
    } catch (e) {
      console.error('❌ Error setting super-strict lock:', e?.message || e);
    }
  });

  socket.on('start-game', async (data) => {
    console.log('🎮 Start game event received:', data);
    const { roomId, playlists, snippetLength = 30, deviceId, songList, randomStarts = 'none', pattern: incomingPattern, freeSpace } = data;
    const room = rooms.get(roomId);
    
    console.log('🔍 Room found:', !!room);
    console.log('🔍 Room host:', room?.host);
    console.log('🔍 Socket ID:', socket.id);
    console.log('🔍 Is host:', room?.host === socket.id);
    console.log('🔍 Available rooms:', Array.from(rooms.keys()));
    console.log('🔍 Room players:', Array.from(room?.players.entries() || []).map(([id, player]) => `${player.name}(${player.isHost ? 'host' : 'player'})`));
    
    // Check if this socket is the host (either by room.host or by player.isHost)
    const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
    console.log('🔍 Is current host check:', { roomHost: room?.host, socketId: socket.id, playerIsHost: room?.players.get(socket.id)?.isHost, isCurrentHost });
    
    if (room && isCurrentHost) {
      try {
        console.log('✅ Starting game for room:', roomId);
      room.gameState = 'playing';
      room.snippetLength = snippetLength;
      room.playlists = playlists;
        room.selectedDeviceId = deviceId; // Store the selected device ID
        room.randomStarts = randomStarts || 'none';
        // Initialize call history and round
        room.calledSongIds = [];
        room.round = (room.round || 0) + 1;
        // Apply pattern from host if provided; default to 'line' if still unset
        try {
          const allowed = new Set(['line', 'four_corners', 'x', 'full_card', 't', 'l', 'u', 'plus']);
          if (incomingPattern && allowed.has(incomingPattern)) {
            room.pattern = incomingPattern;
          }
        } catch {}
        room.pattern = room.pattern || 'line';

        console.log('🎵 Generating bingo cards...');
        // If mix is already finalized and cards exist, do NOT regenerate to avoid reshuffle
        if (!room.mixFinalized || !room.bingoCards || room.bingoCards.size === 0) {
          if (freeSpace !== undefined) {
            room.freeSpaceEnabled = !!freeSpace;
          }
          // Clear old cards before generating new ones to ensure fresh start
          if (room.bingoCards) {
            room.bingoCards.clear();
          }
          if (room.clientCards) {
            room.clientCards.clear();
          }
          // CRITICAL: Use finalizedPlaylists if available to preserve order, otherwise use playlists
          const playlistsToUse = room.finalizedPlaylists && room.finalizedPlaylists.length > 0 
            ? room.finalizedPlaylists 
            : playlists;
          console.log(`📋 Using ${room.finalizedPlaylists ? 'finalized' : 'regular'} playlists for card generation`);
          console.log(`📋 Playlist order: ${playlistsToUse.map((p, i) => `${i + 1}. ${p.name}`).join(', ')}`);
          // If mix was finalized, reuse finalized song order to enforce 1x75 deterministically
          await generateBingoCards(roomId, playlistsToUse, room.finalizedSongOrder || null);
          
          // CRITICAL: Auto-set pattern to 'full_card' for 1x75 mode if pattern wasn't explicitly set
          if (room.oneBySeventyFivePool && room.oneBySeventyFivePool.length === 75 && !incomingPattern) {
            console.log('🎯 1x75 mode detected: Auto-setting pattern to full_card');
            room.pattern = 'full_card';
          }
        } else {
          console.log('🛑 Skipping card regeneration (mix finalized and cards already exist)');
          
          // Also check for 1x75 mode when cards already exist
          if (room.oneBySeventyFivePool && room.oneBySeventyFivePool.length === 75 && !incomingPattern && room.pattern === 'line') {
            console.log('🎯 1x75 mode detected (existing cards): Auto-setting pattern to full_card');
            room.pattern = 'full_card';
          }
          
          // BUT check for any players who don't have cards (joined after finalization)
          const playersWithoutCards = [];
          room.players.forEach((player, playerId) => {
            if (!player.isHost && player.name !== 'Display' && !room.bingoCards.has(playerId)) {
              playersWithoutCards.push({ playerId, playerName: player.name });
            }
          });
          
          if (playersWithoutCards.length > 0) {
            console.log(`🎲 Generating cards for ${playersWithoutCards.length} late-joining players:`, playersWithoutCards.map(p => p.playerName));
            for (const { playerId, playerName } of playersWithoutCards) {
              try {
                const card = await generateBingoCardForPlayer(roomId, playerId);
                if (card) {
                  console.log(`✅ Generated bingo card for late-joiner: ${playerName}`);
                }
              } catch (error) {
                console.error(`❌ Failed to generate card for ${playerName}:`, error);
              }
            }
          }
        }

        // Emit game started AFTER columns are ready so display can receive them immediately
        io.to(roomId).emit('game-started', {
          roomId,
          snippetLength,
          deviceId,
          pattern: room.pattern,
          customMask: Array.from(room.customPattern || [])
        });
        
        // Emit fiveby15 columns if computed during card generation (AFTER game-started so display can sync)
        if (room.fiveByFifteenColumnsIds) {
          console.log(`📊 Emitting fiveby15-pool with ${room.fiveByFifteenColumnsIds.length} columns`);
          io.to(roomId).emit('fiveby15-pool', { 
            columns: room.fiveByFifteenColumnsIds, 
            names: room.fiveByFifteenPlaylistNames || [],
            meta: room.fiveByFifteenMeta || {}
          });
          // Build id->column map for clients
          const idToCol = {};
          room.fiveByFifteenColumnsIds.forEach((colIds, colIdx) => {
            colIds.forEach((id) => { idToCol[id] = colIdx; });
          });
          io.to(roomId).emit('fiveby15-map', { idToColumn: idToCol });
        }
      
        console.log('🎵 Starting automatic playback...');
        // Start automatic playback with the client's shuffled song list
        await startAutomaticPlayback(roomId, playlists, deviceId, songList);
        
        console.log('✅ Game state set and playback attempt triggered');
      } catch (error) {
        console.error('❌ Error starting game:', error);
        socket.emit('error', { message: 'Failed to start game' });
      }
    } else {
      console.log('❌ Cannot start game: Room not found or not host');
      console.log('🔍 Room details:', room);
      console.log('🔍 Socket details:', { id: socket.id, roomId });
      
      // Try to recreate the room if it doesn't exist
      if (!room) {
        console.log('🔄 Attempting to recreate room:', roomId);
        const newRoom = {
          id: roomId,
          host: socket.id,
          players: new Map(),
          gameState: 'waiting',
          snippetLength: 30,
          winners: [],
          repeatMode: false,
          volume: 100,
          playlistSongs: [],
          currentSongIndex: 0,
          pattern: 'line', // Default pattern
          customPattern: undefined // Will be set when custom pattern is chosen
        };
        rooms.set(roomId, newRoom);
        socket.join(roomId);
        
        // Try starting the game again
        setTimeout(async () => {
          try {
            console.log('🔄 Retrying game start for recreated room:', roomId);
            newRoom.gameState = 'playing';
            newRoom.snippetLength = snippetLength;
            newRoom.playlists = playlists;
            newRoom.selectedDeviceId = deviceId;
            
            // Emit immediately so UI updates even if playback has issues
      io.to(roomId).emit('game-started', {
              roomId,
        snippetLength,
              deviceId,
              pattern: room.pattern
            });

            if (!newRoom.mixFinalized || !newRoom.bingoCards || newRoom.bingoCards.size === 0) {
              await generateBingoCards(roomId, playlists, newRoom.finalizedSongOrder || null);
            } else {
              console.log('🛑 Skipping card regeneration after room recreation');
            }
            await startAutomaticPlayback(roomId, playlists, deviceId, songList);
            
            console.log('✅ Game state set and playback attempt triggered after room recreation');
          } catch (error) {
            console.error('❌ Error starting game after room recreation:', error);
            socket.emit('error', { message: 'Failed to start game after room recreation' });
          }
        }, 1000);
      } else {
        socket.emit('error', { message: 'Cannot start game: Room not found or not host' });
      }
    }
  });

  // End current game gracefully (stop timers, optionally pause Spotify, keep cards/history)
  socket.on('end-game', async (data) => {
    const { roomId, stopPlayback = true } = data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.host !== socket.id && !room.players.get(socket.id)?.isHost) return;
    try {
      clearRoomTimer(roomId);
      if (stopPlayback) {
        try {
          const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
          if (deviceId) {
            try { await spotifyFor(roomId).transferPlayback(deviceId, false); } catch {}
            await spotifyFor(roomId).pausePlayback(deviceId);
          }
        } catch (e) {
          console.warn('⚠️ Pause on end-game failed:', e?.message || e);
        }
      }
      room.gameState = 'ended';
      
      // Clean up temporary playlist
      if (room.temporaryPlaylistId) {
        spotifyFor(roomId).deleteTemporaryPlaylist(room.temporaryPlaylistId).catch(err => 
          console.warn('⚠️ Failed to delete temporary playlist:', err)
        );
        room.temporaryPlaylistId = null;
      }
      
      io.to(roomId).emit('game-ended', { roomId });
      console.log(`🛑 Game ended gracefully for room ${roomId}`);
    } catch (e) {
      console.error('❌ Error ending game:', e?.message || e);
    }
  });

  // Reset room to a fresh waiting state (clears cards, winners, playlist order)
  socket.on('reset-game', async (data) => {
    const { roomId, stopPlayback = true } = data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.host !== socket.id && !room.players.get(socket.id)?.isHost) return;
    try {
      clearRoomTimer(roomId);
      if (stopPlayback) {
        try {
          const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
          if (deviceId) {
            try { await spotifyFor(roomId).transferPlayback(deviceId, false); } catch {}
            await spotifyFor(roomId).pausePlayback(deviceId);
          }
        } catch (e) {
          console.warn('⚠️ Pause on reset-game failed:', e?.message || e);
        }
      }
      // Reset state but keep players and host
      room.gameState = 'waiting';
      room.winners = [];
      room.playlistSongs = [];
      room.currentSongIndex = 0;
      room.currentSong = null;
      room.mixFinalized = false;
      room.finalizedPlaylists = undefined;
      room.finalizedSongOrder = null;
      room.bingoCards = new Map();
      io.to(roomId).emit('game-reset', { roomId });
      console.log(`🔁 Game reset for room ${roomId}`);
    } catch (e) {
      console.error('❌ Error resetting game:', e?.message || e);
    }
  });

  // Advanced playback controls
  socket.on('skip-song', async (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      try {
        console.log('⏭️ Skipping to next song in room:', roomId);
        // Clear existing timer and immediately play next song under our control
        clearRoomTimer(roomId);
        await playNextSong(roomId, room.selectedDeviceId);
      } catch (error) {
        console.error('❌ Error skipping song:', error);
        socket.emit('error', { message: 'Failed to skip song' });
      }
    }
  });

  socket.on('pause-song', async (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      try {
        const pauseTime = Date.now();
        console.log(`⏸️ PAUSE REQUESTED - Room: ${roomId}, Time: ${pauseTime}`);
        console.log(`⏸️ Current Song: ${room.currentSong?.name} by ${room.currentSong?.artist}`);
        console.log(`⏸️ Game State: ${room.gameState}`);
        
        // Clear the timer when pausing
        clearRoomTimer(roomId);
        const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
        if (!deviceId) {
          console.error('❌ No device found for pause');
          socket.emit('error', { message: 'No device available for pause' });
          return;
        }
        try {
          // Ensure control on the locked device (do not auto-play)
          await spotifyFor(roomId).transferPlayback(deviceId, false);
        } catch (e) {
          console.warn('⚠️ Transfer before pause failed:', e?.message || e);
        }

        // If already paused, treat as success
        try {
          const state = await spotifyFor(roomId).getCurrentPlaybackState();
          const isPlaying = !!state?.is_playing;
          if (!isPlaying) {
            console.log('⏸️ Already paused according to playback state — treating as success');
          room.gameState = 'paused';
          io.to(roomId).emit('playback-paused');
            return;
          }
        } catch (_) {}

        // Attempt to pause; add fallbacks for restriction errors
        try {
          await spotifyFor(roomId).pausePlayback(deviceId);
        } catch (pauseErr) {
          const msg = pauseErr?.body?.error?.message || pauseErr?.message || String(pauseErr);
          const status = pauseErr?.body?.error?.status || pauseErr?.statusCode;
          const isRestriction = /Restriction/i.test(msg) || status === 403;
          if (isRestriction) {
            console.warn('⚠️ Pause restricted; attempting device activation then retry');
            try {
              await spotifyFor(roomId).activateDevice(deviceId);
              await new Promise(r => setTimeout(r, 200));
              await spotifyFor(roomId).pausePlayback(deviceId);
            } catch (retryErr) {
              console.warn('⚠️ Pause retry failed:', retryErr?.message || retryErr);
              // Don't mute as fallback - let the user handle this manually
              throw retryErr;
            }
        } else {
            throw pauseErr;
        }
        }
        room.gameState = 'paused';
        io.to(roomId).emit('playback-paused');
        console.log('✅ Playback paused successfully');
      } catch (error) {
        const msg = error?.body?.error?.message || error?.message || 'Failed to pause song';
        console.error('❌ Error pausing song:', msg);
        
        // Provide specific guidance for restriction errors
        if (/restriction/i.test(msg) || error?.body?.error?.status === 403) {
          io.to(roomId).emit('playback-warning', { 
            message: `Pause restricted: ${msg}`,
            type: 'restriction',
            suggestions: [
              'Ensure you have Spotify Premium (required for remote control)',
              'Try using the Spotify app directly to pause',
              'Check if the device allows remote control',
              'Wait a moment and try again'
            ]
          });
        } else {
          io.to(roomId).emit('playback-warning', { message: `Pause problem: ${msg}` });
        }
      }
    }
  });

  socket.on('resume-song', async (data) => {
    const { roomId, resumePosition } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      try {
        console.log('▶️ Resuming song in room:', roomId);
        const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
        if (!deviceId) {
          console.error('❌ No device found for resume');
          socket.emit('error', { message: 'No device available for resume' });
          return;
        }

        // Ensure playback is locked to the device before resuming
        try {
          await spotifyFor(roomId).transferPlayback(deviceId, false);
          } catch (e) {
            console.warn('⚠️ Transfer playback failed before resume:', e?.message || e);
          }

          if (resumePosition !== undefined) {
            console.log(`🎯 Resuming from position: ${resumePosition}ms`);
          await spotifyFor(roomId).resumePlayback(deviceId);
          await spotifyFor(roomId).seekToPosition(resumePosition, deviceId);
            console.log(`✅ Resumed and seeked to position: ${resumePosition}ms`);
          } else {
          await spotifyFor(roomId).resumePlayback(deviceId);
            console.log('✅ Playback resumed successfully');
          }
          
          // Restore volume to match room's saved volume or default to 100%
          try {
            const targetVolume = room.volume || 100;
            await spotifyFor(roomId).setVolume(targetVolume, deviceId);
            console.log(`🔊 Restored volume to ${targetVolume}% on resume`);
          } catch (volumeError) {
            console.warn('⚠️ Failed to restore volume on resume:', volumeError?.message || volumeError);
          }
          
          room.gameState = 'playing';
          io.to(roomId).emit('playback-resumed');
          
          // Calculate remaining time and set timer
          if (room.snippetLength) {
            const remainingTime = room.snippetLength * 1000 - (resumePosition || 0);
            if (remainingTime > 0) {
              setRoomTimer(roomId, () => {
                playNextSong(roomId, room.selectedDeviceId);
              }, remainingTime);
            } else {
              playNextSong(roomId, room.selectedDeviceId);
            }
        }
      } catch (error) {
        const msg = error?.body?.error?.message || error?.message || 'Failed to resume song';
        console.error('❌ Error resuming song:', msg);
        
        // Provide specific guidance for restriction errors
        if (/restriction/i.test(msg) || error?.body?.error?.status === 403) {
          io.to(roomId).emit('playback-warning', { 
            message: `Resume restricted: ${msg}`,
            type: 'restriction',
            suggestions: [
              'Ensure you have Spotify Premium (required for remote control)',
              'Try using the Spotify app directly to resume',
              'Check if the device allows remote control',
              'Wait a moment and try again'
            ]
          });
        } else {
          socket.emit('error', { message: `Failed to resume song: ${msg}` });
        }
      }
    }
  });

  socket.on('previous-song', async (data) => {
    const { roomId, currentPosition = 0 } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      try {
        console.log(`⏮️ Previous button clicked at position: ${currentPosition}ms in room:`, roomId);
        
        // Clear existing timer
        clearRoomTimer(roomId);
        
        // If we're in the first second of the song, go to previous song
        // Otherwise, restart the current song from the beginning
        if (currentPosition <= 1000) {
          console.log('📍 Position ≤ 1 second, going to previous song');
          if (room.playlistSongs && room.currentSongIndex > 0) {
            room.currentSongIndex = room.currentSongIndex - 1;
          } else if (room.playlistSongs) {
            room.currentSongIndex = room.playlistSongs.length - 1;
          }
        } else {
          console.log('📍 Position > 1 second, restarting current song');
          // Keep the same song index, just restart it
        }
        
        // Use the new function to play the song at the current index without incrementing
        await playSongAtIndex(roomId, room.selectedDeviceId, room.currentSongIndex);
      } catch (error) {
        console.error('❌ Error playing previous song:', error);
        socket.emit('error', { message: 'Failed to play previous song' });
      }
    }
  });

  socket.on('shuffle-playlist', async (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      try {
        console.log('🔀 Shuffling playlist in room:', roomId);
        if (room.playlistSongs) {
          // Use proper Fisher-Yates shuffle function
          room.playlistSongs = properShuffle(room.playlistSongs);
          room.currentSongIndex = 0;
          console.log('✅ Playlist shuffled successfully with proper Fisher-Yates algorithm');
          io.to(roomId).emit('playlist-shuffled');
        }
      } catch (error) {
        console.error('❌ Error shuffling playlist:', error);
        socket.emit('error', { message: 'Failed to shuffle playlist' });
      }
    }
  });

  socket.on('toggle-repeat', async (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      try {
        room.repeatMode = !room.repeatMode;
        console.log(`🔁 Repeat mode ${room.repeatMode ? 'enabled' : 'disabled'} in room:`, roomId);
        io.to(roomId).emit('repeat-toggled', { repeatMode: room.repeatMode });
      } catch (error) {
        console.error('❌ Error toggling repeat:', error);
        socket.emit('error', { message: 'Failed to toggle repeat' });
      }
    }
  });

  // Host-triggered staged call reveal (separate from playback)
  socket.on('reveal-call', (data = {}) => {
    try {
      const { roomId, revealToDisplay = true, revealToPlayers = false, hint = 'full' } = data;
      const room = rooms.get(roomId);
      if (!room) {
        console.warn(`⚠️ Reveal-call: Room ${roomId} not found`);
        return;
      }
      // Only host can reveal
      const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
      if (!isCurrentHost) {
        console.warn(`⚠️ Reveal-call: Socket ${socket.id} is not the host for room ${roomId}`);
        return;
      }
      // Allow reveals even when game is paused for verification - use currentSong or last played song
      let song = room.currentSong;
      
      // Fallback strategies if currentSong is null:
      // 1. If we have played songs (calledSongIds), use the last one from playlistSongs
      // 2. If currentSongIndex is valid, use that song from playlistSongs
      // 3. If no songs have played yet, use the first song from playlistSongs (for reveals before game starts)
      if (!song && room.playlistSongs && room.playlistSongs.length > 0) {
        // Try to find last played song from calledSongIds
        if (room.calledSongIds && room.calledSongIds.length > 0) {
          const lastPlayedId = room.calledSongIds[room.calledSongIds.length - 1];
          song = room.playlistSongs.find(s => s.id === lastPlayedId);
          if (song) {
            console.log(`📣 Reveal-call: Using last played song as fallback: "${song.name}"`);
          }
        }
        
        // If still no song, try using currentSongIndex
        if (!song && room.currentSongIndex !== undefined && room.currentSongIndex >= 0) {
          const index = Math.min(room.currentSongIndex, room.playlistSongs.length - 1);
          song = room.playlistSongs[index];
          if (song) {
            console.log(`📣 Reveal-call: Using song at currentSongIndex ${index} as fallback: "${song.name}"`);
          }
        }
        
        // Last resort: use first song in playlist (for reveals before any songs have played)
        if (!song) {
          song = room.playlistSongs[0];
          if (song) {
            console.log(`📣 Reveal-call: Using first song in playlist as fallback: "${song.name}"`);
          }
        }
      }
      
      if (!song) {
        console.warn(`⚠️ Reveal-call: No song available in room ${roomId}. GameState: ${room.gameState}, CurrentSongIndex: ${room.currentSongIndex}, PlaylistSongs: ${room.playlistSongs?.length || 0}, CalledSongIds: ${room.calledSongIds?.length || 0}`);
        return;
      }
      console.log(`📣 Reveal-call: Revealing ${hint} for song "${song.name}" by ${song.artist} in room ${roomId}`);
      // Build payload according to hint level
      let payload = {
        roomId,
        songId: song.id,
        snippetLength: room.snippetLength,
        revealToDisplay: !!revealToDisplay,
        revealToPlayers: !!revealToPlayers,
        hint
      };
      if (hint === 'artist') {
        payload = { ...payload, artistName: song.artist };
      } else if (hint === 'title') {
        payload = { ...payload, songName: song.name };
      } else {
        payload = { ...payload, songName: song.name, artistName: song.artist };
      }
      // Emit one event; clients choose what to show
      io.to(roomId).emit('call-revealed', payload);
      if (VERBOSE) console.log('📣 Call revealed:', payload);
    } catch (e) {
      console.error('❌ Error revealing call:', e?.message || e);
    }
  });

  // Host-triggered hard refresh/reset for all clients in room
  socket.on('force-refresh', (data = {}) => {
    try {
      const { roomId, reason = 'host-request' } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
      if (!isCurrentHost) return;
      const ts = Date.now();
      io.to(roomId).emit('force-refresh', { ts, reason });
      if (VERBOSE) console.log(`🔁 Force refresh broadcast to room ${roomId} (reason=${reason})`);
    } catch (e) {
      console.error('❌ Error forcing refresh:', e?.message || e);
    }
  });

  socket.on('set-volume', async (data) => {
    const { roomId, volume } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      try {
        console.log(`🔊 Setting volume to ${volume}% in room:`, roomId);
        // TODO: Implement volume control via Spotify API
        room.volume = volume;
        io.to(roomId).emit('volume-changed', { volume });
      } catch (error) {
        console.error('❌ Error setting volume:', error);
        socket.emit('error', { message: 'Failed to set volume' });
      }
    }
  });

  socket.on('seek-song', async (data) => {
    const { roomId, position } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      try {
        console.log(`⏱️ Seeking to position ${position}ms in room:`, roomId);
        // TODO: Implement seek via Spotify API
        io.to(roomId).emit('song-seeked', { position });
      } catch (error) {
        console.error('❌ Error seeking song:', error);
        socket.emit('error', { message: 'Failed to seek song' });
      }
    }
  });

  // Play song
  socket.on('play-song', (data) => {
    const { roomId, songId, songName, artistName } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      const fromPool = room.playlistSongs?.find((s) => s.id === songId);
      room.currentSong = {
        id: songId,
        name: songName,
        artist: artistName,
        explicit: fromPool?.explicit === true
      };
      
      io.to(roomId).emit('song-playing', {
        songId,
        songName,
        customSongName: customSongTitles.get(songId) || cleanSongTitle(songName),
        artistName,
        explicit: fromPool?.explicit === true,
        snippetLength: room.snippetLength
      });
      
      // Send real-time player card updates to host
      sendPlayerCardUpdates(roomId, true); // Immediate update on game start
    }
  });

  // Mark bingo square
  socket.on('mark-square', (data) => {
    const { roomId, songId, position } = data;
    const room = rooms.get(roomId);
    
    if (room) {
      const player = room.players.get(socket.id);
      if (player && player.bingoCard) {
        // Mark the square
        const card = player.bingoCard;
        const square = card.squares.find(s => s.position === position);
        if (square && (square.isFreeSpace || square.songId === FREE_SPACE_SONG_ID)) {
          return;
        }
        if (square && square.songId === songId) {
          // Toggle mark state to support unmarking
          square.marked = !square.marked;
          
          // CRITICAL: Persist mark to room.bingoCards FIRST (source of truth for host)
          if (room.bingoCards && room.bingoCards.has(socket.id)) {
            const roomCard = room.bingoCards.get(socket.id);
            const roomSquare = roomCard.squares.find(s => s.position === position);
            if (roomSquare && roomSquare.songId === songId) {
              roomSquare.marked = square.marked;
              // CRITICAL: Also update player.bingoCard to keep them in sync
              player.bingoCard = roomCard;
            }
          }
          
          // Also persist to clientCards if clientId exists (for reconnection)
          if (player.clientId && room.clientCards && room.clientCards.has(player.clientId)) {
            const clientCard = room.clientCards.get(player.clientId);
            const clientSquare = clientCard.squares.find(s => s.position === position);
            if (clientSquare && clientSquare.songId === songId) {
              clientSquare.marked = square.marked;
            }
          }
          
          // CRITICAL: Send confirmation back to player to ensure their state matches server
          // This prevents desync where server has mark but player doesn't
          socket.emit('mark-confirmed', {
            position,
            songId,
            marked: square.marked
          });
          
          // Send real-time player card updates to host (immediate so marks show without delay)
          sendPlayerCardUpdates(roomId, true);
          
          // Check for bingo pattern completion (but don't auto-announce)
          // Use the same validation logic as the actual bingo call for consistency
          const validationResult = validateBingoForPattern(card, room);
          if (validationResult.valid && !player.patternComplete) {
            player.patternComplete = true; // Use separate flag for pattern completion
            console.log(`🎯 Player ${player.name} completed bingo pattern but hasn't called it yet`);
            
            // Send notification to player that they can call bingo
            socket.emit('pattern-complete', {
              message: 'You have a bingo pattern! Hold the BINGO button to call it.',
              hasPattern: true
            });
          } else if (!validationResult.valid && player.patternComplete) {
            // Reset pattern completion flag if pattern is no longer valid (e.g., player unmarked a square)
            player.patternComplete = false;
            console.log(`🎯 Player ${player.name} no longer has a valid bingo pattern`);
            
            // Notify player that pattern is no longer complete
            socket.emit('pattern-complete', {
              message: '',
              hasPattern: false
            });
          }
        }
      }
    }
  });

  // Display control events
  socket.on('display-show-rules', (data) => {
    const { roomId } = data;
    if (roomId && rooms.has(roomId)) {
      // Hide other screens first, then show rules
      io.to(roomId).emit('display-hide-splash');
      io.to(roomId).emit('display-show-rules');
      console.log(`📋 Rules screen shown for room ${roomId}`);
    }
  });

  socket.on('display-show-splash', (data) => {
    const { roomId } = data;
    if (roomId && rooms.has(roomId)) {
      // Hide other screens first, then show splash
      io.to(roomId).emit('display-hide-rules');
      io.to(roomId).emit('display-show-splash');
      console.log(`🎬 Splash screen shown for room ${roomId}`);
    }
  });

  socket.on('display-show-call-list', (data) => {
    const { roomId } = data;
    if (roomId && rooms.has(roomId)) {
      // Hide all overlay screens to show main display (which is the call list)
      io.to(roomId).emit('display-hide-rules');
      io.to(roomId).emit('display-hide-splash');
      console.log(`🎵 Main display (call list) shown for room ${roomId}`);
    }
  });

  socket.on('display-reset-letters', (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Only host can reset letters
    const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
    if (!isCurrentHost) return;
    
    console.log(`🔤 Letter reset requested for public display in room ${roomId}`);
    io.to(roomId).emit('display-reset-letters');
  });

  // Custom song title management
  socket.on('set-custom-song-title', (data) => {
    const { songId, customTitle } = data;
    if (songId && customTitle) {
      customSongTitles.set(songId, customTitle);
      console.log(`✏️ Custom title set for song ${songId}: "${customTitle}"`);
      // Broadcast to all clients in all rooms
      io.emit('custom-song-title-updated', { songId, customTitle });
    }
  });

  socket.on('get-custom-song-title', (data) => {
    const { songId } = data;
    if (songId) {
      const customTitle = customSongTitles.get(songId);
      socket.emit('custom-song-title-response', { songId, customTitle });
    }
  });

  socket.on('get-all-custom-titles', () => {
    const allTitles = Object.fromEntries(customSongTitles);
    socket.emit('all-custom-titles-response', allTitles);
  });


  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Find and remove player from all rooms
    for (const [roomId, room] of rooms.entries()) {
      if (room.players.has(socket.id)) {
        const player = room.players.get(socket.id);
        room.players.delete(socket.id);
        
        console.log(`Player ${player.name} left room ${roomId}`);
        
        // If the host disconnected, assign a new host or end the game
        if (room.host === socket.id) {
          if (room.players.size > 0) {
            // Assign the first remaining player as host
            const newHost = room.players.values().next().value;
            room.host = newHost.id;
            console.log(`Assigned ${newHost.name} as new host for room ${roomId}`);
          } else {
            // No players left, remove the room
            rooms.delete(roomId);
            console.log(`Removed empty room: ${roomId}`);
          }
        }
        
        // Notify remaining players
        io.to(roomId).emit('player-left', {
          playerId: socket.id,
          playerName: player.name,
          playerCount: getNonHostPlayerCount(room)
        });
        
        break; // Player can only be in one room
      }
    }
  });
});

// Helper functions

// Proper Fisher-Yates shuffle algorithm (replaces biased Math.random() - 0.5 sorts)
function properShuffle(array) {
  const shuffled = [...array]; // Don't mutate original
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** Center square (2-2): pre-marked, counts toward patterns without a played song */
const FREE_SPACE_SONG_ID = '__FREE_SPACE__';

function makeFreeSpaceSquare() {
  return {
    position: '2-2',
    songId: FREE_SPACE_SONG_ID,
    songName: 'FREE',
    customSongName: 'FREE',
    artistName: '',
    marked: true,
    isFreeSpace: true,
  };
}

function resetBingoCardMarks(card) {
  if (!card?.squares) return;
  for (const square of card.squares) {
    if (square.isFreeSpace || square.songId === FREE_SPACE_SONG_ID) square.marked = true;
    else square.marked = false;
  }
}

async function generateBingoCards(roomId, playlists, songOrder = null) {
  console.log('🎲 Generating bingo cards for room:', roomId);
  const room = rooms.get(roomId);
  if (!room) {
    console.log('❌ Room not found for bingo card generation');
    return;
  }

  const org = spotifyOrgForRoom(room);
  const tokensOk = await multiTenantSpotify.ensureOrgTokensLoaded(org);
  if (!tokensOk) {
    console.error('❌ Cannot generate bingo cards: Spotify not connected for this host');
    return;
  }

  try {
    console.log('📋 Fetching songs from playlists...');
    console.log(`📋 Playlist order received: ${playlists.map((p, i) => `${i + 1}. ${p.name}`).join(', ')}`);
    // Fetch songs from each playlist
    const playlistsWithSongs = [];
    for (let i = 0; i < playlists.length; i++) {
      const playlist = playlists[i];
      try {
        console.log(`📋 [${i + 1}/${playlists.length}] Fetching songs for playlist: ${playlist.name}`);
        const songs = await spotifyFor(roomId).getPlaylistTracks(playlist.id, playlist);
        console.log(`✅ Found ${songs.length} songs in playlist: ${playlist.name}`);
        playlistsWithSongs.push({ ...playlist, songs, originalIndex: i });
      } catch (error) {
        console.error(`❌ Error fetching songs for playlist ${playlist.id}:`, error);
        playlistsWithSongs.push({ ...playlist, songs: [], originalIndex: i });
      }
    }

    const useFreeSpace = !!room.freeSpaceEnabled;
    const songsNeededPerCard = useFreeSpace ? 24 : 25;
    if (useFreeSpace) {
      console.log('🆓 Free space enabled: center square (2-2) is FREE (24 song squares per card)');
    }

    // Helper: dedup by ID preserving order
    const dedup = (arr) => {
      const seen = new Set();
      const out = [];
      for (const s of arr) { if (s && s.id && !seen.has(s.id)) { seen.add(s.id); out.push(s); } }
      return out;
    };

    // Prepare per-playlist unique arrays (dedup within each playlist first)
    const perListUnique = playlistsWithSongs.map(pl => ({
      id: pl.id,
      name: pl.name,
      songs: dedup(Array.isArray(pl.songs) ? pl.songs : [])
    }));

    // For 5x15 mode, we need to remove duplicates ACROSS playlists
    let perListGloballyUnique = perListUnique;
    if (perListUnique.length === 5) {
      console.log('🔍 Checking for cross-playlist duplicates in 5x15 mode...');
      const globalSeen = new Set();
      const warnings = [];
      
      perListGloballyUnique = perListUnique.map((pl, index) => {
        const uniqueSongs = [];
        const duplicatesFound = [];
        const replacementsFound = [];
        
        // First pass: collect unique songs and identify duplicates
        for (const song of pl.songs) {
          if (!globalSeen.has(song.id)) {
            globalSeen.add(song.id);
            uniqueSongs.push(song);
          } else {
            duplicatesFound.push(song);
          }
        }
        
        // Second pass: replace duplicates with alternative songs from the same playlist
        if (duplicatesFound.length > 0 && uniqueSongs.length < 15) {
          const needed = 15 - uniqueSongs.length;
          let replacementsAdded = 0;
          
          // Look for replacement songs from the same playlist
          for (const song of pl.songs) {
            if (replacementsAdded >= needed) break;
            
            // Skip if already in uniqueSongs or if it's a duplicate we're replacing
            const isAlreadyIncluded = uniqueSongs.some(s => s.id === song.id);
            const isDuplicate = duplicatesFound.some(d => d.id === song.id);
            
            if (!isAlreadyIncluded && !isDuplicate && !globalSeen.has(song.id)) {
              globalSeen.add(song.id);
              uniqueSongs.push(song);
              replacementsFound.push(song);
              replacementsAdded++;
              console.log(`✅ Replacement found for playlist "${pl.name}": "${song.name}" by ${song.artist}`);
            }
          }
          
          if (duplicatesFound.length > 0) {
            console.log(`⚠️ Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
            duplicatesFound.forEach(dup => {
              console.log(`   - Duplicate: "${dup.name}" by ${dup.artist}`);
            });
          }
          
          if (replacementsFound.length > 0) {
            console.log(`✅ Playlist "${pl.name}" had ${replacementsFound.length} replacement songs added`);
            replacementsFound.forEach(rep => {
              console.log(`   + Replacement: "${rep.name}" by ${rep.artist}`);
            });
          }
        } else if (duplicatesFound.length > 0) {
          // Log duplicates even if we don't need replacements
          console.log(`⚠️ Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
          duplicatesFound.forEach(dup => {
            console.log(`   - Duplicate: "${dup.name}" by ${dup.artist}`);
          });
        }
        
        if (uniqueSongs.length < 15) {
          const shortage = 15 - uniqueSongs.length;
          warnings.push(`Playlist "${pl.name}" only has ${uniqueSongs.length} unique songs after deduplication and replacement (needs 15, short by ${shortage})`);
        }
        
        return {
          ...pl,
          songs: uniqueSongs,
          originalCount: pl.songs.length,
          duplicatesRemoved: duplicatesFound.length,
          replacementsAdded: replacementsFound.length
        };
      });
      
      // If any playlist doesn't have enough songs after deduplication, warn and fall back
      if (warnings.length > 0) {
        console.warn('⚠️ Cannot use 5x15 mode due to insufficient unique songs after cross-playlist deduplication:');
        warnings.forEach(warning => console.warn(`   ${warning}`));
        io.to(roomId).emit('mode-warning', { 
          type: 'insufficient-unique-songs-5x15',
          message: 'Cannot use 5x15 mode: Some playlists have fewer than 15 unique songs after removing cross-playlist duplicates.',
          details: warnings
        });
        // Fall back to using original perListUnique for other modes
        perListGloballyUnique = perListUnique;
      } else {
        const totalDuplicates = perListGloballyUnique.reduce((sum, pl) => sum + (pl.duplicatesRemoved || 0), 0);
        const totalReplacements = perListGloballyUnique.reduce((sum, pl) => sum + (pl.replacementsAdded || 0), 0);
        if (totalDuplicates > 0 || totalReplacements > 0) {
          console.log(`✅ Successfully processed duplicates: ${totalDuplicates} removed, ${totalReplacements} replaced. All playlists still have ≥15 unique songs.`);
          io.to(roomId).emit('deduplication-success', {
            totalDuplicatesRemoved: totalDuplicates,
            totalReplacementsAdded: totalReplacements,
            playlistDetails: perListGloballyUnique.map(pl => ({
              name: pl.name,
              originalCount: pl.originalCount,
              finalCount: pl.songs.length,
              duplicatesRemoved: pl.duplicatesRemoved || 0,
              replacementsAdded: pl.replacementsAdded || 0
            }))
          });
        }
      }
    }

    let mode = 'fallback';
    // 1x75 mode: exactly 1 playlist with at least 75 unique songs
    if (perListGloballyUnique.length === 1 && perListGloballyUnique[0].songs.length >= 75) {
      mode = '1x75';
    }
    // 5x15 mode: exactly 5 playlists each with at least 15 unique songs (after global deduplication)
    if (perListGloballyUnique.length === 5 && perListGloballyUnique.every(pl => pl.songs.length >= 15)) {
      mode = '5x15';
    }

    console.log(`🎯 Card generation mode: ${mode}`);

    // If 5x15, compute and broadcast fixed 5 columns × 15 songs for the display
    if (mode === '5x15') {
      try {
        console.log(`🎯 5x15 Mode: Assigning columns based on playlist order:`);
        perListGloballyUnique.forEach((pl, idx) => {
          console.log(`   Column ${idx} (left-to-right position ${idx + 1}): ${pl.name}`);
        });
        
        const fiveCols = [];
        const colNames = [];
        const metaMap = {};
        for (let col = 0; col < 5; col++) {
          // Use the globally deduplicated song pools - order matches input playlist order
          const src = properShuffle(perListGloballyUnique[col].songs).slice(0, 15);
          fiveCols.push(src);
          colNames.push(perListGloballyUnique[col].name || `Column ${col+1}`);
          console.log(`   ✅ Column ${col} assigned to playlist: ${perListGloballyUnique[col].name}`);
          src.forEach(s => { if (s && s.id) metaMap[s.id] = { name: s.name, artist: s.artist }; });
        }
        const roomRef = rooms.get(roomId);
        if (roomRef) {
          roomRef.fiveByFifteenColumnsIds = fiveCols.map(col => col.map(s => s.id));
          roomRef.fiveByFifteenPlaylistNames = colNames;
          roomRef.fiveByFifteenMeta = metaMap;
          // Finalize a single global shuffled order of the 75 picks
          const globalOrder = properShuffle(fiveCols.flat().map(s => s.id));
          // Deduplicate IDs to prevent duplicates in output playlist
          roomRef.finalizedSongOrder = [...new Set(globalOrder)];
          console.log(`📊 Final column assignment for display:`);
          colNames.forEach((name, idx) => {
            console.log(`   Column ${idx} (left-to-right position ${idx + 1}): "${name}"`);
          });
          
          io.to(roomId).emit('fiveby15-pool', { columns: roomRef.fiveByFifteenColumnsIds, names: colNames, meta: metaMap });
          
          // Build and emit id->column map for clients (needed for display)
          const idToCol = {};
          roomRef.fiveByFifteenColumnsIds.forEach((colIds, colIdx) => {
            colIds.forEach((id) => { idToCol[id] = colIdx; });
          });
          io.to(roomId).emit('fiveby15-map', { idToColumn: idToCol });
          
          // Emit finalized global order for Host UI
          try {
            const orderWithMeta = globalOrder.map(id => ({ id, name: metaMap[id]?.name || '', artist: metaMap[id]?.artist || '' }));
            io.to(roomId).emit('finalized-order', { order: orderWithMeta });
          } catch (_) {}
        }
      } catch (e) {
        console.warn('⚠️ Failed to compute/emit fiveby15-pool:', e?.message || e);
      }
    }

    // Build fallback global pool when needed (INDEPENDENT from playback order)
    const buildGlobalPool = () => {
      // CRITICAL FIX: Never use host-provided songOrder for bingo cards in fallback mode
      // This was causing massive bias - cards were limited to songs that would play early
      console.log('🎲 Building INDEPENDENT global pool for bingo cards (ignoring playback order)');
      const map = new Map();
      // Use globally deduplicated pools to ensure no cross-playlist duplicates
      for (const pl of perListGloballyUnique) {
        for (const s of pl.songs) { if (!map.has(s.id)) map.set(s.id, s); }
      }
      return Array.from(map.values());
    };

    // Validate we have enough songs in any mode
    const ensureEnough = (available) => {
      if (available < songsNeededPerCard) {
        const message = `Need at least ${songsNeededPerCard} unique songs to generate a card. Only ${available} available.`;
    console.error(`❌ ${message}`);
        io.to(roomId).emit('bingo-card-error', { message, required: songsNeededPerCard, available });
        return false;
      }
      return true;
    };

    // If 1x75, compute the fixed pool of 75 and share it with clients (ids only)
    if (mode === '1x75') {
      let base = [];
      if (Array.isArray(songOrder) && songOrder.length > 0) {
        // CRITICAL: Use the host-provided order for PERFECT alignment with playback
        console.log('🎯 1x75: Using client songList order for perfect playback/card alignment');
        const allowed = new Set(perListUnique[0].songs.map(s => s.id));
        base = dedup(songOrder.filter(s => allowed.has(s.id))).slice(0, 75);
      } else {
        // Fallback: server-side shuffle (should rarely happen)
        console.log('🎯 1x75: Using server-side shuffle (no client songList provided)');
        base = properShuffle(perListUnique[0].songs).slice(0, 75);
      }
      const roomRef = rooms.get(roomId);
      if (roomRef) {
        roomRef.oneBySeventyFivePool = base.map(s => ({ id: s.id }));
        console.log(`✅ 1x75: Stored ${base.length} songs in oneBySeventyFivePool for card/playback alignment`);
        io.to(roomId).emit('oneby75-pool', { ids: base.map(s => s.id) });
      }
  }

  const cards = new Map();
    if (!room.clientCards) room.clientCards = new Map();
  console.log(`👥 Generating cards for ${room.players.size} players`);

  for (const [playerId, player] of room.players) {
    try {
      console.log(`🎲 Generating card for player: ${player.name} (${playerId})`);
      let chosen25 = [];
      if (mode === '1x75') {
        // Use the same base computed above to ensure consistency
        const base = (rooms.get(roomId)?.oneBySeventyFivePool || []).map(x => perListGloballyUnique[0].songs.find(s => s.id === x.id)).filter(Boolean);
        if (!ensureEnough(base.length)) {
          console.error(`❌ Not enough songs for 1x75 mode for player ${player.name}: need ${songsNeededPerCard}, have ${base.length}`);
          continue; // Skip this player but continue with others
        }
        chosen25 = properShuffle(base).slice(0, songsNeededPerCard);
      } else if (mode === '5x15') {
        // For each of 5 playlists, sample unique tracks from globally deduplicated pools
        // With free space: middle column (2) has 4 songs; center cell (2-2) is FREE
        // Note: Cross-playlist duplicates are already removed, so we only need cross-column uniqueness within this card
        // CRITICAL: Use perListGloballyUnique in the SAME ORDER as display columns to ensure alignment
        const used = new Set();
        const columns = [];
        let ok = true;
        for (let col = 0; col < 5; col++) {
          const need = useFreeSpace && col === 2 ? 4 : 5;
          // Use perListGloballyUnique[col] which matches display column col
          const playlistName = perListGloballyUnique[col].name || `Column ${col}`;
          const pool = properShuffle(perListGloballyUnique[col].songs);
          const colPicks = [];
          for (const s of pool) {
            if (!used.has(s.id)) { colPicks.push(s); used.add(s.id); }
            if (colPicks.length === need) break;
          }
          if (colPicks.length < need) { ok = false; break; }
          columns.push(colPicks);
          console.log(`🎯 Card for ${player.name}: Column ${col} (${playlistName}) - ${colPicks.length} songs selected`);
        }
        if (!ok) {
          console.error(`❌ 5x15 mode failed for player ${player.name} - insufficient unique songs per column`);
          console.error(`❌ This should not happen if playlists have enough songs. Skipping player.`);
          continue; // Skip this player - don't use fallback that creates different card types
        } else {
          // Flatten column-major into row-major 5x5 (skip center when free space)
          // This ensures column 0 songs go to card column 0, column 1 to card column 1, etc.
          for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 5; col++) {
              if (useFreeSpace && row === 2 && col === 2) continue;
              if (useFreeSpace && col === 2) {
                const idxInCol = row < 2 ? row : row - 1;
                chosen25.push(columns[2][idxInCol]);
              } else {
                chosen25.push(columns[col][row]);
              }
            }
          }
          console.log(`✅ Card for ${player.name}: Built with columns in order: ${columns.map((_, idx) => perListGloballyUnique[idx].name).join(', ')}`);
        }
      } else {
        const pool = buildGlobalPool();
        if (!ensureEnough(pool.length)) {
          console.error(`❌ Not enough songs in global pool for player ${player.name}: need ${songsNeededPerCard}, have ${pool.length}`);
          continue; // Skip this player but continue with others
        }
        // CRITICAL: Use completely independent shuffle for bingo cards
        // This ensures fair randomness separate from playback order
        chosen25 = properShuffle(pool).slice(0, songsNeededPerCard);
        console.log(`🎲 Generated TRULY FAIR blackout card for ${player.name} from ${pool.length} song pool`);
      }

      // Build card
      const card = { id: playerId, squares: [] };
      let idx = 0;
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
          if (useFreeSpace && row === 2 && col === 2) {
            card.squares.push(makeFreeSpaceSquare());
            continue;
          }
          const s = chosen25[idx++];
          if (!s || !s.id) {
            console.error(`❌ Invalid song at position ${row}-${col} for player ${player.name}`);
            continue;
          }
          card.squares.push({
            position: `${row}-${col}`,
            songId: s.id,
            songName: s.name,
            customSongName: customSongTitles.get(s.id) || cleanSongTitle(s.name),
            artistName: s.artist,
            marked: false
          });
        }
      }

      if (card.squares.length < 25) {
        console.error(`❌ Card incomplete for player ${player.name}: only ${card.squares.length}/25 squares`);
        continue; // Skip this player
    }

    const uniqueOnCard = new Set(card.squares.map(q => q.songId));
      console.log(`✅ Generated card for ${player.name} with ${uniqueOnCard.size} unique songs (mode=${mode})`);
      console.log(`🎲 Card generation method: ${mode === '5x15' ? '5x15 column-based' : mode === '1x75' ? '1x75 pool-based' : 'global pool'}`);

      if (!room.bingoCards) room.bingoCards = new Map();
    player.bingoCard = card;
    cards.set(playerId, card);
      // Persist by clientId if available to survive refreshes
      if (player.clientId) {
        room.clientCards.set(player.clientId, card);
      }
    // Emit card with isNewCard flag to help client detect new rounds
    io.to(playerId).emit('bingo-card', { ...card, isNewCard: true });
    } catch (e) {
      console.error(`❌ Error generating card for player ${player.name} (${playerId}):`, e?.message || e);
      // Continue with other players
    }
  }

  room.bingoCards = cards;
  console.log(`✅ Generated ${cards.size} bingo cards for room ${roomId}`);
  console.log(`📋 Players with cards: ${Array.from(cards.keys()).map(id => room.players.get(id)?.name || id).join(', ')}`);
  console.log(`⚠️ Players without cards: ${Array.from(room.players.keys()).filter(id => !cards.has(id)).map(id => room.players.get(id)?.name || id).join(', ') || 'None'}`);
  } catch (error) {
    console.error('❌ Error generating bingo cards:', error);
  }
}

// Generate a single bingo card for one player (if they join mid-game)
async function generateBingoCardForPlayer(roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  // CRITICAL: Use finalized playlists if available to preserve order, otherwise fall back to regular playlists
  const playlists = room.finalizedPlaylists && room.finalizedPlaylists.length > 0 
    ? room.finalizedPlaylists 
    : room.playlists;
  if (!Array.isArray(playlists)) return;
  console.log(`📋 Late-join card generation using ${room.finalizedPlaylists ? 'finalized' : 'regular'} playlists`);
  console.log(`📋 Playlist order: ${playlists.map((p, i) => `${i + 1}. ${p.name}`).join(', ')}`);
  
  // Build a single card using the same 1x75 / 5x15 logic used for all players
  try {
    // Fetch per-playlist songs and de-duplicate per list
    const playlistsWithSongs = [];
    for (const playlist of playlists) {
      try {
        const songs = await spotifyFor(roomId).getPlaylistTracks(playlist.id, playlist);
        playlistsWithSongs.push({ ...playlist, songs });
      } catch (error) {
        console.error(`❌ Error fetching songs for playlist ${playlist.id}:`, error);
        playlistsWithSongs.push({ ...playlist, songs: [] });
      }
    }

    const useFreeSpace = !!room.freeSpaceEnabled;
    const songsNeededPerCard = useFreeSpace ? 24 : 25;
    const dedup = (arr) => {
      const seen = new Set();
      const out = [];
      for (const s of arr) { if (s && s.id && !seen.has(s.id)) { seen.add(s.id); out.push(s); } }
      return out;
    };

    const perListUnique = playlistsWithSongs.map(pl => ({
      id: pl.id,
      name: pl.name,
      songs: dedup(Array.isArray(pl.songs) ? pl.songs : [])
    }));

    // For 5x15 mode, apply global deduplication (same logic as main card generation)
    let perListGloballyUnique = perListUnique;
    if (perListUnique.length === 5) {
      console.log('🔍 Late-join: Checking for cross-playlist duplicates in 5x15 mode...');
      const globalSeen = new Set();
      
      perListGloballyUnique = perListUnique.map((pl, index) => {
        const uniqueSongs = [];
        const duplicatesFound = [];
        const replacementsFound = [];
        
        // First pass: collect unique songs and identify duplicates
        for (const song of pl.songs) {
          if (!globalSeen.has(song.id)) {
            globalSeen.add(song.id);
            uniqueSongs.push(song);
          } else {
            duplicatesFound.push(song);
          }
        }
        
        // Second pass: replace duplicates with alternative songs from the same playlist
        if (duplicatesFound.length > 0 && uniqueSongs.length < 15) {
          const needed = 15 - uniqueSongs.length;
          let replacementsAdded = 0;
          
          // Look for replacement songs from the same playlist
          for (const song of pl.songs) {
            if (replacementsAdded >= needed) break;
            
            // Skip if already in uniqueSongs or if it's a duplicate we're replacing
            const isAlreadyIncluded = uniqueSongs.some(s => s.id === song.id);
            const isDuplicate = duplicatesFound.some(d => d.id === song.id);
            
            if (!isAlreadyIncluded && !isDuplicate && !globalSeen.has(song.id)) {
              globalSeen.add(song.id);
              uniqueSongs.push(song);
              replacementsFound.push(song);
              replacementsAdded++;
              console.log(`✅ Late-join replacement found for playlist "${pl.name}": "${song.name}" by ${song.artist}`);
            }
          }
          
          if (duplicatesFound.length > 0) {
            console.log(`⚠️ Late-join: Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
          }
          if (replacementsFound.length > 0) {
            console.log(`✅ Late-join: Playlist "${pl.name}" had ${replacementsFound.length} replacement songs added`);
          }
        } else if (duplicatesFound.length > 0) {
          console.log(`⚠️ Late-join: Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
        }
        
        return {
          ...pl,
          songs: uniqueSongs,
          duplicatesRemoved: duplicatesFound.length,
          replacementsAdded: replacementsFound.length
        };
      });
    }

    let mode = 'fallback';
    if (perListGloballyUnique.length === 1 && perListGloballyUnique[0].songs.length >= 75) mode = '1x75';
    if (perListGloballyUnique.length === 5 && perListGloballyUnique.every(pl => pl.songs.length >= 15)) mode = '5x15';
    console.log(`🎯 Late-join card mode: ${mode}`);

    const buildGlobalPool = () => {
      // CRITICAL FIX: Never use finalizedSongOrder for bingo cards in fallback mode
      // This was causing massive bias - cards were limited to songs that would play early
      console.log('🎲 Late-join: Building INDEPENDENT global pool for bingo card (ignoring playback order)');
      const map = new Map();
      // Use globally deduplicated pools to ensure no cross-playlist duplicates
      for (const pl of perListGloballyUnique) { for (const s of pl.songs) { if (!map.has(s.id)) map.set(s.id, s); } }
      return Array.from(map.values());
    };
    const ensureEnough = (available) => {
      if (available < songsNeededPerCard) {
        const message = `Need at least ${songsNeededPerCard} unique songs to generate a card. Only ${available} available.`;
        console.error(`❌ ${message}`);
        io.to(playerId).emit('bingo-card-error', { message, required: songsNeededPerCard, available });
        return false;
      }
      return true;
    };

    let chosen25 = [];
    if (mode === '1x75') {
      let base = [];
      if (Array.isArray(room.finalizedSongOrder) && room.finalizedSongOrder.length > 0) {
        const allowed = new Set(perListGloballyUnique[0].songs.map(s => s.id));
        base = dedup(room.finalizedSongOrder.filter(s => allowed.has(s.id))).slice(0, 75);
      } else {
        base = properShuffle(perListGloballyUnique[0].songs).slice(0, 75);
      }
      if (!ensureEnough(base.length)) return;
      chosen25 = properShuffle(base).slice(0, songsNeededPerCard);
    } else if (mode === '5x15') {
      const used = new Set();
      const columns = [];
      let ok = true;
      for (let col = 0; col < 5; col++) {
        const need = useFreeSpace && col === 2 ? 4 : 5;
        // Use globally deduplicated pools for late-join cards
        const pool = properShuffle(perListGloballyUnique[col].songs);
        const colPicks = [];
        for (const s of pool) {
          if (!used.has(s.id)) { colPicks.push(s); used.add(s.id); }
          if (colPicks.length === need) break;
        }
        if (colPicks.length < need) { ok = false; break; }
        columns.push(colPicks);
      }
      if (!ok) {
        console.error('❌ 5x15 late-join failed - insufficient unique songs per column');
        console.error('❌ This should not happen if playlists have enough songs. Cannot generate card.');
        return; // Don't use fallback that creates different card types
      } else {
        for (let row = 0; row < 5; row++) {
          for (let col = 0; col < 5; col++) {
            if (useFreeSpace && row === 2 && col === 2) continue;
            if (useFreeSpace && col === 2) {
              const idxInCol = row < 2 ? row : row - 1;
              chosen25.push(columns[2][idxInCol]);
            } else {
              chosen25.push(columns[col][row]);
            }
          }
        }
      }
    } else {
      const pool = buildGlobalPool();
      if (!ensureEnough(pool.length)) return;
      // CRITICAL: Use completely independent shuffle for late-join bingo cards
      chosen25 = properShuffle(pool).slice(0, songsNeededPerCard);
      console.log(`🎲 Generated TRULY FAIR late-join card from ${pool.length} song pool`);
    }

    const card = { id: playerId, squares: [] };
    let idx = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        if (useFreeSpace && row === 2 && col === 2) {
          card.squares.push(makeFreeSpaceSquare());
          continue;
        }
        const s = chosen25[idx++];
        card.squares.push({
          position: `${row}-${col}`,
          songId: s.id,
          songName: s.name,
          customSongName: customSongTitles.get(s.id) || cleanSongTitle(s.name),
          artistName: s.artist,
          marked: false
        });
      }
    }
    if (!room.bingoCards) room.bingoCards = new Map();
    room.bingoCards.set(playerId, card);
    // Also store on player if present
    const p = room.players.get(playerId);
    if (p) p.bingoCard = card;
    // Emit card with isNewCard flag to help client detect new rounds
    io.to(playerId).emit('bingo-card', { ...card, isNewCard: true });
    return card;
  } catch (e) {
    console.error('❌ Error generating single player card:', e?.message || e);
  }
}

async function startAutomaticPlayback(roomId, playlists, deviceId, songList = null) {
  console.log('🎵 Starting automatic playback for room:', roomId);
  const room = rooms.get(roomId);
  if (!room) {
    console.log('❌ Room not found for automatic playback');
    return;
  }

  const org = spotifyOrgForRoom(room);
  const tokensOk = await multiTenantSpotify.ensureOrgTokensLoaded(org);
  if (!tokensOk) {
    console.error('❌ Cannot start playback: Spotify not connected for this host (no tokens in memory or DB)');
    io.to(roomId).emit('playback-error', {
      message: 'Spotify is not connected for this host. Open Connection and connect Spotify, then try Start Game again.',
    });
    return;
  }

  try {
    // Ensure token is valid before proceeding
    await spotifyFor(roomId).ensureValidToken();
    
    let allSongs = [];
    const perListFetched = [];
    
    if (songList && songList.length > 0) {
      // If we have a finalized song order, use it exactly (it's the source of truth)
      if (Array.isArray(room.finalizedSongOrder) && room.finalizedSongOrder.length > 0) {
        // finalizedSongOrder can be either IDs or full song objects
        const isIdArray = typeof room.finalizedSongOrder[0] === 'string';
        if (isIdArray) {
          // If it's IDs, map them to full song objects from songList
          console.log('📋 Using finalizedSongOrder (IDs) to reorder songList');
          const idToSong = new Map(songList.map(s => [s.id, s]));
          const mapped = room.finalizedSongOrder.map(id => idToSong.get(id)).filter(Boolean);
          allSongs = mapped.length > 0 ? mapped : songList;
        } else {
          // If it's full objects, use them directly (they're already in the correct order)
          console.log('📋 Using finalizedSongOrder (full objects) directly');
          allSongs = room.finalizedSongOrder;
        }
      } else if (Array.isArray(room.oneBySeventyFivePool) && room.oneBySeventyFivePool.length > 0) {
        // CRITICAL FIX: For 1x75 mode, use the EXACT same 75-song pool as bingo cards
        console.log('📋 1x75 detected: using server-side 75-song pool to match bingo cards EXACTLY');
        const idToSong = new Map(songList.map(s => [s.id, s]));
        const mapped = room.oneBySeventyFivePool.map(poolItem => idToSong.get(poolItem.id)).filter(Boolean);
        allSongs = mapped.length > 0 ? mapped : songList;
      } else {
      // Use the song list provided by the client (already shuffled)
      console.log(`📋 Using client-provided song list with ${songList.length} songs`);
      allSongs = songList;
      }
    } else {
      // Fallback: fetch songs from playlists (for backward compatibility)
      console.log('📋 Fetching songs from playlists for playback...');
      for (const playlist of playlists) {
        try {
          console.log(`📋 Fetching songs for playlist: ${playlist.name}`);
          const songs = await spotifyFor(roomId).getPlaylistTracks(playlist.id, playlist);
          console.log(`✅ Found ${songs.length} songs in playlist: ${playlist.name}`);
          perListFetched.push({ id: playlist.id, name: playlist.name, songs });
          allSongs.push(...songs);
        } catch (error) {
          console.error(`❌ Error fetching songs for playlist ${playlist.id}:`, error);
          perListFetched.push({ id: playlist.id, name: playlist.name, songs: [] });
        }
      }
    }

    // If 5x15 columns were finalized during card generation, prefer those 75 songs for playback
    let fiveCols = Array.isArray(room.fiveByFifteenColumns) ? room.fiveByFifteenColumns : null;
    // If not present (e.g., starting without regenerating cards), compute columns now from fetched playlists
    if (!fiveCols && Array.isArray(perListFetched) && perListFetched.length === 5) {
      const dedup = (arr) => {
        const seen = new Set();
        const out = [];
        for (const s of arr) { if (s && s.id && !seen.has(s.id)) { seen.add(s.id); out.push(s); } }
        return out;
      };
      const perListUnique = perListFetched.map(pl => ({ id: pl.id, name: pl.name, songs: dedup(Array.isArray(pl.songs) ? pl.songs : []) }));
      
      // Apply global deduplication for 5x15 mode (same logic as card generation)
      let perListGloballyUnique = perListUnique;
      if (perListUnique.length === 5) {
        console.log('🔍 Playback: Applying cross-playlist deduplication for 5x15 mode...');
        const globalSeen = new Set();
        
        perListGloballyUnique = perListUnique.map((pl, index) => {
          const uniqueSongs = [];
          const duplicatesFound = [];
          const replacementsFound = [];
          
          // First pass: collect unique songs and identify duplicates
          for (const song of pl.songs) {
            if (!globalSeen.has(song.id)) {
              globalSeen.add(song.id);
              uniqueSongs.push(song);
            } else {
              duplicatesFound.push(song);
            }
          }
          
          // Second pass: replace duplicates with alternative songs from the same playlist
          if (duplicatesFound.length > 0 && uniqueSongs.length < 15) {
            const needed = 15 - uniqueSongs.length;
            let replacementsAdded = 0;
            
            // Look for replacement songs from the same playlist
            for (const song of pl.songs) {
              if (replacementsAdded >= needed) break;
              
              // Skip if already in uniqueSongs or if it's a duplicate we're replacing
              const isAlreadyIncluded = uniqueSongs.some(s => s.id === song.id);
              const isDuplicate = duplicatesFound.some(d => d.id === song.id);
              
              if (!isAlreadyIncluded && !isDuplicate && !globalSeen.has(song.id)) {
                globalSeen.add(song.id);
                uniqueSongs.push(song);
                replacementsFound.push(song);
                replacementsAdded++;
                console.log(`✅ Playback replacement found for playlist "${pl.name}": "${song.name}" by ${song.artist}`);
              }
            }
            
            if (duplicatesFound.length > 0) {
              console.log(`⚠️ Playback: Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
            }
            if (replacementsFound.length > 0) {
              console.log(`✅ Playback: Playlist "${pl.name}" had ${replacementsFound.length} replacement songs added`);
            }
          } else if (duplicatesFound.length > 0) {
            console.log(`⚠️ Playback: Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
          }
          
          return {
            ...pl,
            songs: uniqueSongs,
            duplicatesRemoved: duplicatesFound.length,
            replacementsAdded: replacementsFound.length
          };
        });
      }
      
      if (perListGloballyUnique.every(pl => pl.songs.length >= 15)) {
        try {
          const built = [];
          const colNames = [];
          const metaMap = {};
          // Note: Cross-playlist duplicates already removed, just need to ensure we get exactly 15 per column
          for (let col = 0; col < 5; col++) {
            const pool = properShuffle(perListGloballyUnique[col].songs);
            const picks = pool.slice(0, 15); // Take first 15 from shuffled deduplicated pool
            built.push(picks);
            colNames.push(perListGloballyUnique[col].name || `Column ${col + 1}`);
            picks.forEach(s => { if (s && s.id) metaMap[s.id] = { name: s.name, artist: s.artist }; });
          }
          fiveCols = built.map(col => col.map(s => ({ id: s.id })));
          room.fiveByFifteenColumns = fiveCols;
          room.fiveByFifteenColumnsIds = built.map(col => col.map(s => s.id));
          room.fiveByFifteenPlaylistNames = colNames;
          room.fiveByFifteenMeta = metaMap;
          // Emit to clients so Public Display can render immediately (columns + names + meta + map)
          io.to(roomId).emit('fiveby15-pool', { columns: room.fiveByFifteenColumnsIds, names: colNames, meta: metaMap });
          const idToCol = {};
          room.fiveByFifteenColumnsIds.forEach((colIds, colIdx) => { colIds.forEach(id => { idToCol[id] = colIdx; }); });
          io.to(roomId).emit('fiveby15-map', { idToColumn: idToCol });
        } catch (e) {
          console.warn('⚠️ Could not compute 5x15 columns at playback start:', e?.message || e);
        }
      }
    }
    if (!songList && fiveCols && Array.isArray(room.fiveByFifteenColumnsIds) && room.fiveByFifteenColumnsIds.length === 5) {
      try {
        // Use the finalized global shuffle order if present
        if (Array.isArray(room.finalizedSongOrder) && room.finalizedSongOrder.length > 0) {
          const isIdArray = typeof room.finalizedSongOrder[0] === 'string';
          if (isIdArray) {
            const idToSong = new Map(allSongs.map(s => [s.id, s]));
            allSongs = room.finalizedSongOrder.map(id => idToSong.get(id)).filter(Boolean);
            console.log('🎼 Using finalized 5x15 global shuffled order (75 songs) from IDs');
          } else {
            allSongs = room.finalizedSongOrder;
            console.log('🎼 Using finalized 5x15 global shuffled order (75 songs) from full objects');
          }
        }
      } catch (e) {
        console.warn('⚠️ Failed to align playback with 5x15 columns:', e?.message || e);
      }
    }

    console.log(`📊 Total songs available: ${allSongs.length}`);

    if (allSongs.length === 0) {
      console.error('❌ No songs available for playback');
      return;
    }

    // CRITICAL: If finalizedSongOrder exists, ensure allSongs matches that exact order
    // This ensures the Spotify playlist order matches what the host interface shows
    if (Array.isArray(room.finalizedSongOrder) && room.finalizedSongOrder.length > 0) {
      const idToSong = new Map(allSongs.map(s => [s.id, s]));
      // Deduplicate finalizedSongOrder IDs to prevent duplicate songs in output playlist
      const seenIds = new Set();
      const orderedSongs = room.finalizedSongOrder
        .map(id => {
          if (seenIds.has(id)) {
            console.log(`⚠️ Skipping duplicate ID in finalizedSongOrder: ${id}`);
            return null;
          }
          seenIds.add(id);
          return idToSong.get(id);
        })
        .filter(Boolean);
      if (orderedSongs.length > 0) {
        console.log(`🎯 Reordering allSongs to match finalizedSongOrder (${orderedSongs.length} unique songs)`);
        allSongs = orderedSongs;
      }
    }
    
    // Store the song list in the room for ordered playback
    room.playlistSongs = allSongs;
    room.currentSongIndex = 0;
    room.gameState = 'playing';
    console.log(`📝 Stored ${allSongs.length} songs in room ${roomId} for ordered playback`);
    console.log(`📋 First 5 songs in order: ${allSongs.slice(0, 5).map(s => `${s.name} (${s.id})`).join(', ')}`);
    
    // Create temporary playlist for context-based playback to prevent hijacks
    try {
      try {
        await spotifyFor(roomId).deleteAllGameOfTonesOutputPlaylists();
      } catch (clearErr) {
        console.warn(
          '⚠️ Could not auto-clear prior GOT output playlists (non-fatal):',
          clearErr?.message || clearErr
        );
      }
      const trackUris = allSongs.map(song => `spotify:track:${song.id}`);
      const playlistName = `TEMPO Bingo Room ${roomId} - ${new Date().toISOString().slice(0,16)}`;
      room.temporaryPlaylistId = await spotifyFor(roomId).createTemporaryPlaylist(playlistName, trackUris);
      console.log(`🎼 Created temporary playlist for context: ${room.temporaryPlaylistId}`);
      console.log(`📋 Playlist track order (first 5): ${trackUris.slice(0, 5).join(', ')}`);
    } catch (error) {
      console.warn('⚠️ Failed to create temporary playlist, falling back to individual track playback:', error);
      room.temporaryPlaylistId = null;
    }
    
    // Play the first song from the list
    const firstSong = allSongs[0];
    console.log(`🎵 Playing song 1/${allSongs.length}: ${firstSong.name} by ${firstSong.artist}`);

    // Use provided deviceId or fall back to saved device (STRICT-ONLY: no other fallback)
    let targetDeviceId = deviceId;
    if (!targetDeviceId) {
      const savedDevice = loadSavedDeviceForRoom(roomId);
      if (savedDevice) {
        targetDeviceId = savedDevice.id;
        console.log(`🎵 Using saved device for playback: ${savedDevice.name}`);
      }
    }
    // Strict-only: if still no device, abort
    if (!targetDeviceId) {
      console.error('❌ Strict mode: no locked device available for playback');
      io.to(roomId).emit('playback-error', { message: 'Locked device not available. Open Spotify on your chosen device or reselect in Host.' });
      return;
    }

    console.log(`🎵 Starting playback on device: ${targetDeviceId}`);

    try {
      // Ensure device reports in current devices list; try to activate if needed
      const devices = await spotifyFor(roomId).getUserDevices();
      const deviceInList = devices.find(d => d.id === targetDeviceId);
      if (!deviceInList) {
        console.log('⚠️ Locked device not in list; attempting activation...');
        await spotifyFor(roomId).activateDevice(targetDeviceId);
      }

      await spotifyFor(roomId).transferPlayback(targetDeviceId, false);
      // Skip-based queue clearing removed to avoid context hijacks
      // Enforce deterministic playback mode to avoid context/radio fallbacks with delays
      try { await spotifyFor(roomId).withRetries('setShuffle(false)', () => spotifyFor(roomId).setShuffleState(false, targetDeviceId), { attempts: 2, backoffMs: 200 }); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 200));
      // Note: Skip setting repeat to 'off' - startPlaybackFromPlaylist will set it to 'track' to prevent auto-advance
      await new Promise(resolve => setTimeout(resolve, 200));
      // Use explicit device_id and uris as fallback in case transfer isn't picked up
      // Randomized start position within track when enabled and safe
      let startMs = 0;
      if (room.randomStarts && room.randomStarts !== 'none' && Number.isFinite(firstSong.duration)) {
        const dur = Math.max(0, Number(firstSong.duration));
        const snippetMs = room.snippetLength * 1000;
        const bufferMs = 1500;
        
        if (room.randomStarts === 'early') {
          // Early random: first 90 seconds
          const maxStartMs = 90000; // 90 seconds
          const safeWindow = Math.min(maxStartMs, Math.max(0, dur - snippetMs - bufferMs));
          if (safeWindow > 3000) {
            startMs = Math.floor(Math.random() * safeWindow);
          }
        } else if (room.randomStarts === 'random') {
          // Random: anywhere but last 30+ seconds
          const safeWindow = Math.max(0, dur - snippetMs - bufferMs - 30000); // 30 second buffer
          if (safeWindow > 3000) {
            startMs = Math.floor(Math.random() * safeWindow);
          }
        }
      }
      console.log(`🎯 Starting first song with randomized offset: ${startMs}ms (${Math.floor(startMs/1000)}s)`);
      
      // Use playlist context if available, otherwise fall back to individual track
      if (room.temporaryPlaylistId) {
        console.log(`🎼 Playing from temporary playlist context: ${room.temporaryPlaylistId}`);
        await spotifyFor(roomId).withRetries('startPlaybackFromPlaylist(initial)', () => spotifyFor(roomId).startPlaybackFromPlaylist(targetDeviceId, room.temporaryPlaylistId, 0, startMs), { attempts: 3, backoffMs: 400 });
      } else {
        await spotifyFor(roomId).withRetries('startPlayback(initial)', () => spotifyFor(roomId).startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], startMs), { attempts: 3, backoffMs: 400 });
      }
      console.log(`✅ Successfully started playback on device: ${targetDeviceId}`);
      try { 
        const r = rooms.get(roomId); 
        if (r) {
          r.songStartAtMs = Date.now() - (startMs || 0);
          r.currentSongStartMs = startMs; // Store for restart correction
        }
      } catch {}
      
      // Stabilization delay to prevent context hijacks from volume changes
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Set initial volume to 100% (or room's saved volume)
      try {
        const initialVolume = room.volume || 100;
        await spotifyFor(roomId).withRetries('setVolume(initial)', () => spotifyFor(roomId).setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
        console.log(`🔊 Set initial volume to ${initialVolume}%`);
      } catch (volumeError) {
        console.error('❌ Error setting initial volume:', volumeError);
      }
    } catch (playbackError) {
      console.error('❌ Error starting playback in strict mode:', playbackError);
      const message = playbackError?.body?.error?.message || playbackError?.message || '';
      if (/token expired/i.test(message)) {
        console.log('🔄 Token expired, refreshing and retrying...');
        try {
          await spotifyFor(roomId).refreshAccessToken();
          // Re-check device after refresh
          const devicesAfter = await spotifyFor(roomId).getUserDevices();
          const stillMissing = !devicesAfter.find(d => d.id === targetDeviceId);
          if (stillMissing) {
            console.log('⚠️ Locked device still missing after refresh; attempting activation...');
            await spotifyFor(roomId).activateDevice(targetDeviceId);
          }
          await spotifyFor(roomId).withRetries('transferPlayback(after-refresh)', () => spotifyFor(roomId).transferPlayback(targetDeviceId, false), { attempts: 3, backoffMs: 300 });
          // Skip-based queue clearing removed to avoid context hijacks
          await spotifyFor(roomId).withRetries('startPlayback(after-refresh)', () => spotifyFor(roomId).startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], startMs), { attempts: 3, backoffMs: 400 });
          console.log(`✅ Successfully started playback after token refresh`);
          try { const r = rooms.get(roomId); if (r) r.songStartAtMs = Date.now() - (startMs || 0); } catch {}
          
          // Stabilization delay to prevent context hijacks from volume changes
          await new Promise(resolve => setTimeout(resolve, 800));
          
          // Set initial volume to 100% (or room's saved volume)
          try {
            const initialVolume = room.volume || 100;
            await spotifyFor(roomId).withRetries('setVolume(after-refresh)', () => spotifyFor(roomId).setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
            console.log(`🔊 Set initial volume to ${initialVolume}% after token refresh`);
          } catch (volumeError) {
            console.error('❌ Error setting initial volume after token refresh:', volumeError);
          }
        } catch (refreshError) {
          console.error('❌ Error after token refresh:', refreshError);
          return;
        }
      } else {
        io.to(roomId).emit('playback-error', { message: 'Unable to start on locked device. Ensure it is online and try again.' });
        return;
      }
    }

    // Track called song
    room.calledSongIds = Array.isArray(room.calledSongIds) ? room.calledSongIds : [];
    room.calledSongIds.push(firstSong.id);
    room.currentSong = {
      id: firstSong.id,
      name: firstSong.name,
      artist: firstSong.artist,
      explicit: firstSong.explicit === true
    };

    io.to(roomId).emit('song-playing', {
      songId: firstSong.id,
      songName: firstSong.name,
      customSongName: customSongTitles.get(firstSong.id) || cleanSongTitle(firstSong.name),
      artistName: firstSong.artist,
      explicit: firstSong.explicit === true,
      snippetLength: room.snippetLength,
      currentIndex: 0,
      totalSongs: allSongs.length,
      previewUrl: (allSongs[0]?.previewUrl) || null
    });

  

    console.log(`✅ Started automatic playback in room ${roomId}: ${firstSong.name} by ${firstSong.artist} on device ${targetDeviceId}`);

    room.playlistSongs = allSongs;
    room.currentSongIndex = 0;

    // Verify playback actually started and is the correct track; attempt resume/correct if needed
    try {
      let playing = false;
      let correctTrack = false;
      for (let i = 0; i < 3; i++) { // Reduced from 5 to 3 attempts
        await new Promise(r => setTimeout(r, 500)); // Increased delay from 300ms to 500ms
        const state = await spotifyFor(roomId).getCurrentPlaybackState();
        playing = !!state?.is_playing;
        const currentId = state?.item?.id;
        correctTrack = currentId === firstSong.id;
        if (!QUIET_MODE) logger.log(`🔎 Playback verify attempt ${i + 1}: is_playing=${playing} correct_track=${correctTrack} progress=${state?.progress_ms}ms`, 'playback-verify', 5);
        if (playing && correctTrack) break; // Only break if BOTH conditions are met
        
        // Only try resume if not playing AND we have the right track (avoid restriction errors)
        if (!playing && correctTrack) {
          try { 
            await spotifyFor(roomId).resumePlayback(targetDeviceId); 
          } catch (e) {
            if (!e?.message?.includes('Restriction violated')) {
              logger.warn('⚠️ Resume during verify failed:', 'resume-verify-error', 5);
            }
          }
        }
      }
      if (!playing || !correctTrack) {
        // Attempt to correct to the intended track once using the same randomized offset
        console.log(`🔧 Verification failed (playing=${playing}, correctTrack=${correctTrack}), correcting with startMs=${startMs}ms`);
        try { 
          if (room.temporaryPlaylistId) {
            await spotifyFor(roomId).startPlaybackFromPlaylist(targetDeviceId, room.temporaryPlaylistId, 0, startMs);
          } else {
            await spotifyFor(roomId).startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], startMs); 
          }
        } catch {}
      }
      if (!playing) {
        io.to(roomId).emit('playback-warning', { message: 'Playback did not start reliably on the locked device. Please check Spotify is active and not muted.' });
      }
    } catch (e) {
      console.warn('⚠️ Playback verification error:', e?.message || e);
      io.to(roomId).emit('playback-warning', { message: `Playback verification error: ${e?.message || 'Unknown error'}` });
    }

    // NEW: Use simplified timer-based progression
    console.log(`🚀 Starting simplified playback control for room ${roomId}`);
    startSimpleProgression(roomId, targetDeviceId, room.snippetLength);

  } catch (error) {
    console.error('❌ Error starting automatic playback:', error);
  }
}

async function playNextSong(roomId, deviceId) {
  console.log('🎵 PLAY NEXT SONG CALLED for room:', roomId, 'deviceId:', deviceId);
  const room = rooms.get(roomId);
  if (!room || room.gameState !== 'playing' || !room.playlistSongs) {
    console.log(`❌ Cannot play next song: Room not in playing state or no playlist songs`);
    console.log(`❌ Room exists: ${!!room}, GameState: ${room?.gameState}, HasPlaylistSongs: ${!!room?.playlistSongs}`);
    console.log(`❌ Room details: ${JSON.stringify({
      gameState: room?.gameState,
      currentSongIndex: room?.currentSongIndex,
      playlistSongsLength: room?.playlistSongs?.length,
      currentSong: room?.currentSong
    })}`);
    return;
  }

  try {
    // Handle repeat mode / end-of-playlist (prevent wrap for 1x75)
    if (room.repeatMode) {
      // Stay on the same song
      console.log('🔁 Repeat mode: staying on current song');
    } else {
      // If we're at the end, end the game instead of wrapping
      if (room.currentSongIndex + 1 >= room.playlistSongs.length) {
        console.log('🏁 Playlist complete. Ending game for room', roomId);
        room.gameState = 'ended';
        clearRoomTimer(roomId);
        try {
          const deviceToPause = deviceId || room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
          if (deviceToPause) { await spotifyFor(roomId).pausePlayback(deviceToPause); }
        } catch (_) {}
        
        // Clean up temporary playlist
        if (room.temporaryPlaylistId) {
          spotifyFor(roomId).deleteTemporaryPlaylist(room.temporaryPlaylistId).catch(err => 
            console.warn('⚠️ Failed to delete temporary playlist:', err)
          );
          room.temporaryPlaylistId = null;
        }
        
        io.to(roomId).emit('game-ended', { roomId, reason: 'playlist-complete' });
        return;
      }
      // Move to next song
      room.currentSongIndex = room.currentSongIndex + 1;
    }
    
    const nextSong = room.playlistSongs[room.currentSongIndex];
    console.log(`🎵 Playing song ${room.currentSongIndex + 1}/${room.playlistSongs.length}: ${nextSong.name} by ${nextSong.artist}`);

    // STRICT device control: use provided device or saved device only
    let targetDeviceId = deviceId;
    if (!targetDeviceId) {
      const savedDevice = loadSavedDeviceForRoom(roomId);
      if (savedDevice) {
        targetDeviceId = savedDevice.id;
        console.log(`🎵 Using saved device for next song: ${savedDevice.name}`);
      }
    }
    if (!targetDeviceId) {
      console.error('❌ Strict mode: no locked device available for playback');
      io.to(roomId).emit('playback-error', { message: 'Locked device not available. Open Spotify on your chosen device or reselect in Host.' });
          return;
    }

    // Assert playback on the locked/saved device to prevent hijacking
    try {
      let needTransfer = true;
      try {
        const current = await spotifyFor(roomId).getCurrentPlaybackState();
        const currentDeviceId = current?.device?.id;
        if (currentDeviceId === targetDeviceId) {
          needTransfer = false;
          if (VERBOSE) console.log('🔒 Already on locked device; skipping transfer');
        }
      } catch (_) {}
      if (needTransfer) {
        await spotifyFor(roomId).withRetries('transferPlayback(next)', () => spotifyFor(roomId).transferPlayback(targetDeviceId, false), { attempts: 3, backoffMs: 300 });
        // Skip-based queue clearing removed to avoid context hijacks
      }
    } catch (e) {
      console.warn('⚠️ Transfer playback failed (will still try play):', e?.message || e);
    }
    console.log(`🎵 Starting playback on device: ${targetDeviceId}`);

    try {
      // Ensure device still visible; attempt activation if not
      const devices = await spotifyFor(roomId).getUserDevices();
      const deviceInList = devices.find(d => d.id === targetDeviceId);
      if (!deviceInList) {
        console.log('⚠️ Locked device not in list before next song; attempting activation...');
        await spotifyFor(roomId).activateDevice(targetDeviceId);
      }

      const playbackStartTime = Date.now();
      console.log(`🎵 Starting Spotify playback for: ${nextSong.name}`);
      // Enforce deterministic playback mode on each advance with delays
      try { await spotifyFor(roomId).withRetries('setShuffle(false,next)', () => spotifyFor(roomId).setShuffleState(false, targetDeviceId), { attempts: 2, backoffMs: 200 }); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 200));
      // Reset repeat to 'off' before advancing (clears any previous 'track' repeat)
      try { await spotifyFor(roomId).withRetries('setRepeat(off,next)', () => spotifyFor(roomId).setRepeatState('off', targetDeviceId), { attempts: 2, backoffMs: 200 }); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 200));
      // Randomized start position within track when enabled and safe
      let startMs = 0;
      if (room.randomStarts && room.randomStarts !== 'none' && Number.isFinite(nextSong.duration)) {
        const dur = Math.max(0, Number(nextSong.duration));
        const snippetMs = room.snippetLength * 1000;
        const bufferMs = 1500;
        
        if (room.randomStarts === 'early') {
          // Early random: first 90 seconds
          const maxStartMs = 90000; // 90 seconds
          const safeWindow = Math.min(maxStartMs, Math.max(0, dur - snippetMs - bufferMs));
          if (safeWindow > 3000) {
            startMs = Math.floor(Math.random() * safeWindow);
          }
        } else if (room.randomStarts === 'random') {
          // Random: anywhere but last 30+ seconds
          const safeWindow = Math.max(0, dur - snippetMs - bufferMs - 30000); // 30 second buffer
          if (safeWindow > 3000) {
            startMs = Math.floor(Math.random() * safeWindow);
          }
        }
      }
      // Use playlist context if available, otherwise fall back to individual track
      if (room.temporaryPlaylistId) {
        console.log(`🎼 Playing next song from playlist context at index ${room.currentSongIndex}`);
        await spotifyFor(roomId).withRetries('startPlaybackFromPlaylist(next)', () => spotifyFor(roomId).startPlaybackFromPlaylist(targetDeviceId, room.temporaryPlaylistId, room.currentSongIndex, startMs), { attempts: 3, backoffMs: 400 });
      } else {
        await spotifyFor(roomId).withRetries('startPlayback(next)', () => spotifyFor(roomId).startPlayback(targetDeviceId, [`spotify:track:${nextSong.id}`], startMs), { attempts: 3, backoffMs: 400 });
      }
      const playbackEndTime = Date.now();
      console.log(`✅ Successfully started playback on device: ${targetDeviceId}`);
      
      // Stabilization delay to prevent context hijacks from volume changes
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Set initial volume to 100% (or room's saved volume) with single retry
            try {
              const initialVolume = room.volume || 100;
        await spotifyFor(roomId).withRetries('setVolume(next)', () => spotifyFor(roomId).setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
        console.log(`🔊 Set initial volume to ${initialVolume}%`);
            } catch (volumeError) {
        console.warn('⚠️ Volume setting failed, continuing anyway:', volumeError?.message || volumeError);
      }
    } catch (playbackError) {
      console.error('❌ Error starting playback:', playbackError);
      
      // In strict mode, do not fallback silently
      console.error('❌ Playback error in strict mode:', playbackError?.body?.error?.message || playbackError?.message || playbackError);
      const errorMsg = playbackError?.body?.error?.message || playbackError?.message || '';
      if (/restriction/i.test(errorMsg) || playbackError?.body?.error?.status === 403) {
        io.to(roomId).emit('playback-error', { 
          message: `Playback restricted: ${errorMsg}`,
          type: 'restriction',
          suggestions: [
            'Ensure you have Spotify Premium (required for remote control)',
            'Check if the device allows remote control',
            'Try opening Spotify on the target device first',
            'Wait a moment and try again'
          ]
        });
      } else {
        io.to(roomId).emit('playback-error', { message: 'Playback failed on locked device. Ensure it is online and try again.' });
      }
            return;
    }

    // Track called song
    room.calledSongIds = Array.isArray(room.calledSongIds) ? room.calledSongIds : [];
    room.calledSongIds.push(nextSong.id);
    room.currentSong = {
      id: nextSong.id,
      name: nextSong.name,
      artist: nextSong.artist,
      explicit: nextSong.explicit === true
    };

    io.to(roomId).emit('song-playing', {
      songId: nextSong.id,
      songName: nextSong.name,
      customSongName: customSongTitles.get(nextSong.id) || cleanSongTitle(nextSong.name),
      artistName: nextSong.artist,
      explicit: nextSong.explicit === true,
      snippetLength: room.snippetLength,
      currentIndex: room.currentSongIndex,
      totalSongs: room.playlistSongs.length,
      previewUrl: (room.playlistSongs[room.currentSongIndex]?.previewUrl) || null
    });

    // Send real-time player card updates to host
    sendPlayerCardUpdates(roomId, true); // Immediate update on game start

    console.log(`✅ Playing next song in room ${roomId}: ${nextSong.name} by ${nextSong.artist} on device ${targetDeviceId}`);

    // Verify playback actually started and is the correct track; attempt resume/correct if needed
    try {
      let playing = false;
      let correctTrack = false;
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 300));
        const state = await spotifyFor(roomId).getCurrentPlaybackState();
        playing = !!state?.is_playing;
        const currentId = state?.item?.id;
        correctTrack = currentId === nextSong.id;
        if (!QUIET_MODE) logger.log(`🔎 Playback verify (next) attempt ${i + 1}: is_playing=${playing} correct_track=${correctTrack}`, 'next-verify', 5);
        if (playing) break;
        try { await spotifyFor(roomId).withRetries('resumePlayback(verify-next)', () => spotifyFor(roomId).resumePlayback(targetDeviceId), { attempts: 2, backoffMs: 200 }); } catch {}
      }
      if (!playing || !correctTrack) {
        // Attempt to correct to the intended track once
        try { await spotifyFor(roomId).withRetries('startPlayback(correct-next)', () => spotifyFor(roomId).startPlayback(targetDeviceId, [`spotify:track:${nextSong.id}`], startMs), { attempts: 2, backoffMs: 300 }); } catch {}
      }
      if (!playing) {
        io.to(roomId).emit('playback-warning', { message: 'Playback did not resume on next track. Verify Spotify device and try transferring playback again.' });
      }
    } catch (e) {
      console.warn('⚠️ Playback verification (next) error:', e?.message || e);
      io.to(roomId).emit('playback-warning', { message: `Playback verification (next) error: ${e?.message || 'Unknown error'}` });
    }

    // Early-fail check: if progress is still near zero after a few seconds, advance using our controlled flow
    try {
      await new Promise(r => setTimeout(r, 2000)); // Reduced to 2s to minimize transition delay
      const state = await spotifyFor(roomId).getCurrentPlaybackState();
      const progress = Number(state?.progress_ms || 0);
      const isPlaying = !!state?.is_playing;
      if (!isPlaying || progress < 2000) { // Increased threshold from 1s to 2s
        console.warn(`⚠️ Early-fail detected (playing=${isPlaying}, progress=${progress}ms); advancing via playNextSong`);
        clearRoomTimer(roomId);
        await playNextSong(roomId, targetDeviceId);
        return; // Prevent duplicate timer setting below
      }
    } catch (e) {
      console.warn('⚠️ Early-fail check error:', e?.message || e);
    }

    // No pre-queue - deterministic playback only

    // Start watchdog to recover from stalls, and schedule next song
    // Use full snippet duration for consistency with initial song timer
    const playbackDuration = room.snippetLength * 1000;
    console.log(`⏰ Setting next song timer for room ${roomId}: ${playbackDuration}ms (${room.snippetLength}s full duration)`);
    setRoomTimer(roomId, async () => {
      const transitionTime = Date.now();
      if (VERBOSE) console.log(`🔄 TRANSITION STARTING - Room: ${roomId}, Time: ${transitionTime}`);
      if (VERBOSE) console.log(`🔄 Song ending: ${nextSong.name} by ${nextSong.artist}`);
      
      // Skip-based queue clearing removed to avoid context hijacks
      clearRoomTimer(roomId);
      playNextSong(roomId, targetDeviceId);
    }, playbackDuration);

  } catch (error) {
    console.error('❌ Error playing next song:', error);
    // Try to continue with next song after a delay using timer management
    setRoomTimer(roomId, () => {
      playNextSong(roomId, deviceId);
    }, 5000);
  }
}

// Helper function to send real-time player card updates to host
// Debounce timers for player card updates (one per room)
const playerCardUpdateTimers = new Map();

function sendPlayerCardUpdates(roomId, immediate = false) {
  try {
    const room = rooms.get(roomId);
    if (!room || !room.bingoCards) return;
    
    // If immediate flag is set (e.g., game start/end), send right away
    if (immediate) {
      clearPlayerCardUpdateTimer(roomId);
      sendPlayerCardUpdatesNow(roomId);
      return;
    }
    
    // Debounce: clear existing timer and set new one
    clearPlayerCardUpdateTimer(roomId);
    const timerId = setTimeout(() => {
      sendPlayerCardUpdatesNow(roomId);
      playerCardUpdateTimers.delete(roomId);
    }, 120); // debounce for batched updates (marks use immediate path)
    playerCardUpdateTimers.set(roomId, timerId);
  } catch (e) {
    console.error('❌ Error scheduling player card updates:', e?.message || e);
  }
}

function clearPlayerCardUpdateTimer(roomId) {
  const timerId = playerCardUpdateTimers.get(roomId);
  if (timerId) {
    clearTimeout(timerId);
    playerCardUpdateTimers.delete(roomId);
  }
}

function sendPlayerCardUpdatesNow(roomId) {
  try {
    const room = rooms.get(roomId);
    if (!room || !room.bingoCards) return;
    
    // Build playedSongs array that includes current song if it exists
    const playedSongs = Array.isArray(room.calledSongIds) ? [...room.calledSongIds] : [];
    if (room.currentSong && room.currentSong.id && !playedSongs.includes(room.currentSong.id)) {
      playedSongs.push(room.currentSong.id);
    }
    
    const playerCardsData = {};
    room.bingoCards.forEach((card, playerId) => {
      const player = room.players.get(playerId);
      if (player && card) {
        // Only include actual players (not hosts or public display)
        if (!player.isHost && player.name !== 'Display') {
          playerCardsData[playerId] = {
            playerName: player.name,
            card: card,
            playedSongs: playedSongs // Include current song if playing
          };
        }
      }
    });
    
    // Send to all hosts in the room
    room.players.forEach((player, playerId) => {
      if (player.isHost) {
        const hostSocket = io.sockets.sockets.get(playerId);
        if (hostSocket) {
          hostSocket.emit('player-cards-update', playerCardsData);
        }
      }
    });
    
    console.log(`📋 Real-time update: Sent ${Object.keys(playerCardsData).length} player cards to host(s) in room ${roomId}`);
  } catch (e) {
    console.error('❌ Error sending real-time player card updates:', e?.message || e);
  }
}

function checkBingo(card) {
  // Check rows
  for (let row = 0; row < 5; row++) {
    let rowComplete = true;
    for (let col = 0; col < 5; col++) {
      const square = card.squares.find(s => s.position === `${row}-${col}`);
      if (!square || !square.marked) {
        rowComplete = false;
        break;
      }
    }
    if (rowComplete) return true;
  }
  
  // Check columns
  for (let col = 0; col < 5; col++) {
    let colComplete = true;
    for (let row = 0; row < 5; row++) {
      const square = card.squares.find(s => s.position === `${row}-${col}`);
      if (!square || !square.marked) {
        colComplete = false;
        break;
      }
    }
    if (colComplete) return true;
  }
  
  // Check diagonals
  let diag1Complete = true;
  let diag2Complete = true;
  for (let i = 0; i < 5; i++) {
    const square1 = card.squares.find(s => s.position === `${i}-${i}`);
    const square2 = card.squares.find(s => s.position === `${i}-${4-i}`);
    
    if (!square1 || !square1.marked) diag1Complete = false;
    if (!square2 || !square2.marked) diag2Complete = false;
  }
  
  return diag1Complete || diag2Complete;
}

function checkBingoWithPlayedSongs(card, playedSongIds) {
  // Helper function to check if a marked square corresponds to a played song (or free space)
  const isMarkedSquareValid = (square) => {
    return square && square.marked && (square.isFreeSpace || playedSongIds.includes(square.songId));
  };
  
  // Check rows
  for (let row = 0; row < 5; row++) {
    let rowComplete = true;
    for (let col = 0; col < 5; col++) {
      const square = card.squares.find(s => s.position === `${row}-${col}`);
      if (!isMarkedSquareValid(square)) {
        rowComplete = false;
        break;
      }
    }
    if (rowComplete) return { valid: true, type: `Row ${row + 1}` };
  }
  
  // Check columns
  for (let col = 0; col < 5; col++) {
    let colComplete = true;
    for (let row = 0; row < 5; row++) {
      const square = card.squares.find(s => s.position === `${row}-${col}`);
      if (!isMarkedSquareValid(square)) {
        colComplete = false;
        break;
      }
    }
    if (colComplete) return { valid: true, type: `Column ${col + 1}` };
  }
  
  // Check diagonals
  let diag1Complete = true;
  let diag2Complete = true;
  for (let i = 0; i < 5; i++) {
    const square1 = card.squares.find(s => s.position === `${i}-${i}`);
    const square2 = card.squares.find(s => s.position === `${i}-${4-i}`);
    
    if (!isMarkedSquareValid(square1)) diag1Complete = false;
    if (!isMarkedSquareValid(square2)) diag2Complete = false;
  }
  
  if (diag1Complete) return { valid: true, type: 'Diagonal (top-left to bottom-right)' };
  if (diag2Complete) return { valid: true, type: 'Diagonal (top-right to bottom-left)' };
  
  return { valid: false, type: null };
}

function validateBingoCardGrid(card) {
  if (!card?.squares || !Array.isArray(card.squares) || card.squares.length !== 25) return false;
  const seen = new Set();
  for (const sq of card.squares) {
    const pos = sq && sq.position;
    if (!pos || !/^[0-4]-[0-4]$/.test(pos)) return false;
    if (seen.has(pos)) return false;
    seen.add(pos);
  }
  return seen.size === 25;
}

function validateBingoForPattern(card, room) {
  const pattern = room?.pattern || 'line';
  // Make a copy to avoid race conditions during validation
  const playedSongIds = Array.isArray(room?.calledSongIds) ? [...room.calledSongIds] : [];
  
  // CRITICAL: Always include current song if it exists (defensive programming against race conditions)
  // This ensures validation works even if current song hasn't been added to calledSongIds yet
  if (room?.currentSong?.id && !playedSongIds.includes(room.currentSong.id)) {
    playedSongIds.push(room.currentSong.id);
    console.log(`🎯 Added current song to validation list: ${room.currentSong.name} (${room.currentSong.id})`);
  }
  
  console.log(`🎯 Validating bingo for pattern: "${pattern}" (room pattern: "${room?.pattern}")`);
  console.log(`🎯 Played songs count: ${playedSongIds.length}`);
  console.log(`🎯 Called song IDs:`, playedSongIds.slice(-10)); // Show last 10 for debugging
  console.log(`🎯 Card has ${card.squares.length} squares, ${card.squares.filter(s => s.marked).length} marked`);
  
  // Debug: Show card song IDs vs played song IDs
  const cardSongIds = card.squares.map(s => s.songId);
  const markedCardSongIds = card.squares.filter(s => s.marked).map(s => s.songId);
  console.log(`🎯 Card song IDs (first 10):`, cardSongIds.slice(0, 10));
  console.log(`🎯 Marked card song IDs (first 10):`, markedCardSongIds.slice(0, 10));
  
  // Helper function to check if a marked square corresponds to a played song (or free space)
  const isMarkedSquareValid = (square) => {
    const isValid = square && square.marked && (square.isFreeSpace || playedSongIds.includes(square.songId));
    if (!isValid && square && square.marked) {
      console.log(`🎯 Invalid marked square: ${square.position} - songId: ${square.songId}, marked: ${square.marked}, inPlayedList: ${playedSongIds.includes(square.songId)}`);
    }
    return isValid;
  };
  
  if (pattern === 'custom' && room?.customPattern && room.customPattern.size > 0) {
    // All positions in customPattern must be marked AND correspond to played songs
    const invalidPositions = [];
    for (const pos of room.customPattern) {
      const sq = card.squares.find(s => s.position === pos);
      if (!isMarkedSquareValid(sq)) {
        invalidPositions.push(pos);
      }
    }
    if (invalidPositions.length > 0) {
      return { 
        valid: false, 
        reason: `Custom pattern incomplete. Need ${invalidPositions.length} more squares marked with played songs.`
      };
    }
    return { valid: true, reason: 'Custom pattern complete!' };
  }
  
  if (pattern === 'full_card') {
    if (!validateBingoCardGrid(card)) {
      return {
        valid: false,
        reason: 'Invalid bingo card (need 25 unique squares with positions 0-0 through 4-4).',
      };
    }
    // All squares must be marked AND correspond to played songs
    let invalidCount = 0;
    let invalidSquares = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const square = card.squares.find(s => s.position === `${row}-${col}`);
        if (!isMarkedSquareValid(square)) {
          invalidCount++;
          if (square) {
            invalidSquares.push({
              position: square.position,
              songId: square.songId,
              marked: square.marked,
              played: playedSongIds.includes(square.songId)
            });
          }
        }
      }
    }
    if (invalidCount > 0) {
      console.log(`🎯 Full card validation failed: ${invalidCount} invalid squares`);
      console.log(`🎯 Invalid squares:`, invalidSquares.slice(0, 5)); // Log first 5 for debugging
      return { 
        valid: false, 
        reason: `Full card incomplete. Need ${invalidCount} more squares marked with played songs.`
      };
    }
    console.log(`🎯 Full card validation passed: all 25 squares marked with played songs`);
    return { valid: true, reason: 'Full card complete!' };
  }
  
  if (pattern === 'four_corners') {
    const required = ['0-0', '0-4', '4-0', '4-4'];
    const invalid = required.filter(pos => {
      const sq = card.squares.find(s => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `Four corners incomplete. Need ${invalid.length} more corners marked with played songs.`
      };
    }
    return { valid: true, reason: 'Four corners complete!' };
  }
  
  if (pattern === 'x') {
    const invalid = [];
    for (let i = 0; i < 5; i++) {
      const a = card.squares.find(s => s.position === `${i}-${i}`);
      const b = card.squares.find(s => s.position === `${i}-${4 - i}`);
      if (!isMarkedSquareValid(a)) invalid.push(`${i}-${i}`);
      if (!isMarkedSquareValid(b)) invalid.push(`${i}-${4 - i}`);
    }
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `X pattern incomplete. Need ${invalid.length} more diagonal squares marked with played songs.`
      };
    }
    return { valid: true, reason: 'X pattern complete!' };
  }
  
  if (pattern === 't') {
    // T pattern: top row + middle column
    const tPositions = ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2'];
    const invalid = tPositions.filter(pos => {
      const sq = card.squares.find(s => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `T pattern incomplete. Need ${invalid.length} more squares marked with played songs.`
      };
    }
    return { valid: true, reason: 'T pattern complete!' };
  }
  
  if (pattern === 'l') {
    // L pattern: left column + bottom row
    const lPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4'];
    const invalid = lPositions.filter(pos => {
      const sq = card.squares.find(s => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `L pattern incomplete. Need ${invalid.length} more squares marked with played songs.`
      };
    }
    return { valid: true, reason: 'L pattern complete!' };
  }
  
  if (pattern === 'u') {
    // U pattern: left column + right column + bottom row
    const uPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3'];
    const invalid = uPositions.filter(pos => {
      const sq = card.squares.find(s => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `U pattern incomplete. Need ${invalid.length} more squares marked with played songs.`
      };
    }
    return { valid: true, reason: 'U pattern complete!' };
  }
  
  if (pattern === 'plus') {
    // Plus pattern: middle row + middle column
    const plusPositions = ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2'];
    const invalid = plusPositions.filter(pos => {
      const sq = card.squares.find(s => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `Plus pattern incomplete. Need ${invalid.length} more squares marked with played songs.`
      };
    }
    return { valid: true, reason: 'Plus pattern complete!' };
  }
  
  // default: any single line with played song validation
  const lineResult = checkBingoWithPlayedSongs(card, playedSongIds);
  if (lineResult.valid) {
    return { valid: true, reason: `Line bingo complete! (${lineResult.type})` };
  } else {
    return { 
      valid: false, 
      reason: 'No complete lines found. Need a full row, column, or diagonal with played songs.'
    };
  }
}

// Helper function to get winning pattern positions for verification display
function getWinningPatternPositions(card, room, validationResult) {
  const pattern = room?.pattern || 'line';
  const playedSongIds = Array.isArray(room?.calledSongIds) ? [...room.calledSongIds] : [];
  
  // Include current song if it exists
  if (room?.currentSong?.id && !playedSongIds.includes(room.currentSong.id)) {
    playedSongIds.push(room.currentSong.id);
  }
  
  const isMarkedSquareValid = (square) => {
    return square && square.marked && (square.isFreeSpace || playedSongIds.includes(square.songId));
  };
  
  if (pattern === 'custom' && room?.customPattern && room.customPattern.size > 0) {
    return Array.from(room.customPattern);
  }
  
  if (pattern === 'full_card') {
    // All 25 squares
    const positions = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        positions.push(`${row}-${col}`);
      }
    }
    return positions;
  }
  
  if (pattern === 'four_corners') {
    return ['0-0', '0-4', '4-0', '4-4'];
  }
  
  if (pattern === 'x') {
    const positions = [];
    for (let i = 0; i < 5; i++) {
      positions.push(`${i}-${i}`);
      positions.push(`${i}-${4-i}`);
    }
    return positions;
  }
  
  if (pattern === 't') {
    return ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2'];
  }
  
  if (pattern === 'l') {
    return ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4'];
  }
  
  if (pattern === 'u') {
    return ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3'];
  }
  
  if (pattern === 'plus') {
    return ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2'];
  }
  
  // Default: line pattern - find which line won
  if (validationResult.valid && validationResult.type) {
    const type = validationResult.type;
    const positions = [];
    
    // Extract row/column number from type string like "Row 1" or "Column 3"
    if (type.startsWith('Row')) {
      const rowNum = parseInt(type.replace('Row ', '')) - 1;
      for (let col = 0; col < 5; col++) {
        positions.push(`${rowNum}-${col}`);
      }
    } else if (type.startsWith('Column')) {
      const colNum = parseInt(type.replace('Column ', '')) - 1;
      for (let row = 0; row < 5; row++) {
        positions.push(`${row}-${colNum}`);
      }
    } else if (type.includes('top-left to bottom-right')) {
      for (let i = 0; i < 5; i++) {
        positions.push(`${i}-${i}`);
      }
    } else if (type.includes('top-right to bottom-left')) {
      for (let i = 0; i < 5; i++) {
        positions.push(`${i}-${4-i}`);
      }
    }
    
    return positions;
  }
  
  // Fallback: return empty array if pattern not found
  return [];
}

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'TEMPO - Music Bingo Server Running' });
});

app.get('/api/rooms', (req, res) => {
  try {
    const list = Array.from(rooms.values()).map((room) => ({
      id: room.id,
      playerCount: getNonHostPlayerCount(room),
      gameState: room.gameState,
      pattern: room.pattern || 'line',
      started: room.gameState === 'playing',
      mixFinalized: !!room.mixFinalized,
      currentSong: room.currentSong
        ? { id: room.currentSong.id, name: room.currentSong.name, artist: room.currentSong.artist }
        : null
    }));
    // Filter archived rooms from the response
    const active = list.filter(r => !rooms.get(r.id)?.archived);
    res.json({ rooms: active });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list rooms' });
  }
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (room) {
    res.json({
      id: room.id,
      playerCount: getNonHostPlayerCount(room),
      gameState: room.gameState,
      currentSong: room.currentSong,
      mixFinalized: !!room.mixFinalized,
      snippetLength: room.snippetLength,
      hasPlaylist: Array.isArray(room.playlistSongs) && room.playlistSongs.length > 0
    });
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

app.post('/api/rooms/:roomId/end', async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    try {
      clearRoomTimer(roomId);
      try {
        const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
        if (deviceId) {
          try { await spotifyFor(roomId).transferPlayback(deviceId, false); } catch {}
          await spotifyFor(roomId).pausePlayback(deviceId);
        }
      } catch {}
      room.gameState = 'ended';
      
      // Clean up temporary playlist
      if (room.temporaryPlaylistId) {
        spotifyFor(roomId).deleteTemporaryPlaylist(room.temporaryPlaylistId).catch(err => 
          console.warn('⚠️ Failed to delete temporary playlist:', err)
        );
        room.temporaryPlaylistId = null;
      }
      
      io.to(roomId).emit('game-ended', { roomId });
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to end game' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Failed to process request' });
  }
});

app.post('/api/rooms/:roomId/archive', (req, res) => {
  try {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    room.archived = true;
    room.archivedAt = Date.now();
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to archive room' });
  }
});

// Serve React build (after API routes). Do it whenever build exists (prod or not)
if (hasClientBuild) {
  // Strong-cache hashed assets, but keep index.html no-cache so UI updates immediately.
  app.use(express.static(clientBuildPath, {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const isHtml = ext === '.html' || /index\.html$/i.test(filePath);
      if (isHtml) {
        // Ensure the HTML shell is always revalidated
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else if (/\.(js|css|png|jpg|jpeg|svg|ico|webp|woff2?|ttf|eot|map)$/i.test(ext)) {
        // Fingerprinted assets can be cached for a year
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        // Default
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    }
  }));

  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

/** Scheme + host (+ port). Strips paths so PUBLIC_APP_URL can be a full URL without doubling `/api/auth/google/callback`. */
function publicAppOrigin() {
  const raw = (process.env.PUBLIC_APP_URL || process.env.CLIENT_APP_URL || '').trim();
  if (!raw) return '';
  let s = raw;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s).origin;
  } catch {
    return '';
  }
}

function publicAppOriginOrDefault() {
  return publicAppOrigin() || 'http://localhost:3000';
}

function getGoogleOAuthClient() {
  const base = publicAppOriginOrDefault();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${base}/api/auth/google/callback`;
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

// --- Host account (Google) ---
app.get('/api/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)' });
  }
  const client = getGoogleOAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
    state: hostAuth.randomStateToken(),
  });
  res.redirect(302, url);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const appBase = publicAppOriginOrDefault();
  try {
    if (!db) {
      return res.status(503).send('DATABASE_URL is required for host accounts.');
    }
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(503).send('Google OAuth not configured.');
    }
    const { code } = req.query;
    if (!code || typeof code !== 'string') {
      return res.redirect(302, `${appBase}/?auth_error=missing_code`);
    }
    const client = getGoogleOAuthClient();
    const r = await client.getToken(code);
    const tokens = r.tokens || r;
    if (!tokens.id_token) {
      return res.redirect(302, `${appBase}/?auth_error=no_id_token`);
    }
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const googleSub = payload?.sub;
    const email = payload?.email;
    const displayName = payload?.name || payload?.email;
    if (!googleSub) {
      return res.redirect(302, `${appBase}/?auth_error=no_sub`);
    }
    const normEmail = usersStore.normalizeHostEmail(email || '');
    /** TEMPO_APPROVED_HOSTS_ONLY=1: only allowlisted emails may obtain a host session (new and existing users). */
    if (usersStore.isApprovedHostsOnlyMode()) {
      if (!normEmail || !(await usersStore.isEmailAllowlistedForHostSignin(db, normEmail))) {
        return res.redirect(302, `${appBase}/?auth_error=not_invited`);
      }
    } else if (String(process.env.TEMPO_HOST_SIGNIN_MODE || '').trim().toLowerCase() === 'allowlist') {
      /** Legacy: new Google accounts only — existing users always sign in. Prefer TEMPO_APPROVED_HOSTS_ONLY=1 for full enforcement. */
      const existing = await usersStore.getUserByGoogleSub(db, googleSub);
      if (!existing) {
        const allowed = await usersStore.isEmailAllowlistedForHostSignin(db, normEmail);
        if (!allowed) {
          return res.redirect(302, `${appBase}/?auth_error=not_invited`);
        }
      }
    }
    const row = await usersStore.upsertUserByGoogle(db, {
      googleSub,
      email,
      displayName,
    });
    const signedEmail = usersStore.normalizeHostEmail(normEmail || row.email || '');
    const token = hostAuth.signHostJwt(row.id, signedEmail);
    hostAuth.setSessionCookie(res, row.id, signedEmail);
    return res.redirect(302, `${appBase}/callback-google?token=${encodeURIComponent(token)}&userId=${row.id}`);
  } catch (e) {
    console.error('Google callback error:', e?.message || e);
    return res.redirect(302, `${appBase}/?auth_error=1`);
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (!uid) return res.status(401).json({ user: null });
    const rawJwt = hostAuth.getHostJwtRawFromRequest(req);
    if (!db) {
      return res.json({
        user: { id: uid },
        ...(rawJwt ? { hostToken: rawJwt } : {}),
      });
    }
    const row = await usersStore.getUserById(db, uid);
    return res.json({
      user: row ? { id: row.id, email: row.email, displayName: row.display_name } : { id: uid },
      ...(rawJwt ? { hostToken: rawJwt } : {}),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load user' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  hostAuth.clearSessionCookie(res);
  res.json({ success: true });
});

/** Shared secret for scripts/curl. Also send X-Admin-Secret so it never conflicts with a Bearer JWT. */
function verifyAdminSecret(req) {
  const secret = (process.env.TEMPO_ADMIN_SECRET || '').trim();
  if (!secret) return false;
  const h = req.headers['x-admin-secret'];
  if (typeof h === 'string' && h.trim() === secret) return true;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t === secret) return true;
  }
  return false;
}

function getAdminConfigured() {
  return (
    !!(process.env.TEMPO_ADMIN_SECRET || '').trim() ||
    !!(process.env.TEMPO_ADMIN_EMAILS || '').trim()
  );
}

/** Returns true if authorized; otherwise sends response and returns false. */
async function requireAdmin(req, res) {
  if (!getAdminConfigured()) {
    res.status(503).json({
      error: 'admin_not_configured',
      message:
        'Set TEMPO_ADMIN_EMAILS (comma-separated Google emails) and/or TEMPO_ADMIN_SECRET on the server.',
    });
    return false;
  }
  if (verifyAdminSecret(req)) return true;
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (!uid || !db) {
    res.status(401).json({
      error: 'admin_session_required',
      message: 'Sign in with Google as an admin, or use X-Admin-Secret with the configured secret.',
    });
    return false;
  }
  const row = await usersStore.getUserById(db, uid);
  const email = usersStore.normalizeHostEmail(row?.email || '');
  const adminEmails = (process.env.TEMPO_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (email && adminEmails.includes(email)) return true;
  res.status(401).json({
    error: 'forbidden',
    message: 'This account is not listed in TEMPO_ADMIN_EMAILS.',
  });
  return false;
}

app.get('/api/admin/me', async (req, res) => {
  try {
    const adminConfigured = getAdminConfigured();
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (!uid || !db) {
      return res.json({
        admin: false,
        adminConfigured,
        signedIn: false,
        allowlistMode:
          usersStore.isApprovedHostsOnlyMode() ||
          String(process.env.TEMPO_HOST_SIGNIN_MODE || '').trim().toLowerCase() === 'allowlist',
        approvedHostsOnly: usersStore.isApprovedHostsOnlyMode(),
      });
    }
    const row = await usersStore.getUserById(db, uid);
    const email = usersStore.normalizeHostEmail(row?.email || '');
    const adminEmails = (process.env.TEMPO_ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const admin = !!(email && adminEmails.includes(email));
    return res.json({
      admin,
      adminConfigured,
      signedIn: true,
      email: row?.email ?? null,
      displayName: row?.display_name ?? null,
      allowlistMode:
        usersStore.isApprovedHostsOnlyMode() ||
        String(process.env.TEMPO_HOST_SIGNIN_MODE || '').trim().toLowerCase() === 'allowlist',
      approvedHostsOnly: usersStore.isApprovedHostsOnlyMode(),
    });
  } catch (e) {
    console.error('GET /api/admin/me:', e);
    res.status(500).json({ error: 'failed' });
  }
});

/**
 * Invite a host email so they can complete Google sign-in when TEMPO_HOST_SIGNIN_MODE=allowlist.
 * Also useful to record who is cleared before you turn allowlist on.
 */
app.post('/api/admin/host-allowlist', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    if (!db) return res.status(503).json({ error: 'database_required', message: 'DATABASE_URL is required.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const raw = typeof body.email === 'string' ? body.email : '';
    const email = usersStore.normalizeHostEmail(raw);
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'invalid_email', message: 'Provide { "email": "user@example.com" }' });
    }
    const row = await usersStore.addHostAllowlistEmail(db, email);
    return res.json({ ok: true, email: row.email, createdAt: row.created_at });
  } catch (e) {
    console.error('POST /api/admin/host-allowlist:', e);
    res.status(500).json({ error: 'failed', message: e?.message || 'Failed' });
  }
});

app.get('/api/admin/host-allowlist', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    if (!db) return res.status(503).json({ error: 'database_required', message: 'DATABASE_URL is required.' });
    const rows = await usersStore.listHostAllowlist(db);
    return res.json({ emails: rows });
  } catch (e) {
    console.error('GET /api/admin/host-allowlist:', e);
    res.status(500).json({ error: 'failed', message: e?.message || 'Failed' });
  }
});

app.delete('/api/admin/host-allowlist', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    if (!db) return res.status(503).json({ error: 'database_required', message: 'DATABASE_URL is required.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const raw = typeof body.email === 'string' ? body.email : '';
    const email = usersStore.normalizeHostEmail(raw);
    if (!email) {
      return res.status(400).json({ error: 'invalid_email', message: 'Provide { "email": "..." } in body.' });
    }
    const removed = await usersStore.removeHostAllowlistEmail(db, email);
    return res.json({ ok: true, removed: !!removed, email });
  } catch (e) {
    console.error('DELETE /api/admin/host-allowlist:', e);
    res.status(500).json({ error: 'failed', message: e?.message || 'Failed' });
  }
});

/** Enterprise: tenant-specific Spotify Developer apps (credentials encrypted with TEMPO_ORG_CREDENTIALS_KEY). */
app.get('/api/admin/organizations', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    if (!db) return res.status(503).json({ error: 'database_required', message: 'DATABASE_URL is required.' });
    const organizations = await organizationsStore.listOrganizations(db);
    res.json({ organizations });
  } catch (e) {
    console.error('GET /api/admin/organizations:', e);
    res.status(500).json({ error: 'failed', message: e?.message || 'Failed' });
  }
});

app.post('/api/admin/organizations', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    if (!db) return res.status(503).json({ error: 'database_required', message: 'DATABASE_URL is required.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const organization = await organizationsStore.createOrganization(db, {
      name: body.name,
      spotifyClientId: body.spotifyClientId,
      spotifyClientSecret: body.spotifyClientSecret,
    });
    res.json({ ok: true, organization });
  } catch (e) {
    console.error('POST /api/admin/organizations:', e);
    res.status(400).json({ error: 'failed', message: e?.message || 'Failed' });
  }
});

app.patch('/api/admin/users/:userId/organization', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    if (!db) return res.status(503).json({ error: 'database_required', message: 'DATABASE_URL is required.' });
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'invalid_user_id', message: 'userId must be a number.' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const raw = body.organizationId;
    const organizationId =
      raw === null || raw === undefined || raw === '' ? null : parseInt(String(raw), 10);
    if (organizationId != null && !Number.isFinite(organizationId)) {
      return res.status(400).json({ error: 'invalid_organization_id', message: 'organizationId must be a number or null.' });
    }
    const result = await organizationsStore.setUserOrganizationId(db, userId, organizationId);
    await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, userId);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('PATCH /api/admin/users/:userId/organization:', e);
    res.status(400).json({ error: 'failed', message: e?.message || 'Failed' });
  }
});

app.get('/api/admin/organizations/:id', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    if (!db) return res.status(503).json({ error: 'database_required', message: 'DATABASE_URL is required.' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'invalid_id', message: 'Invalid organization id.' });
    }
    const org = await organizationsStore.getOrganizationById(db, id);
    if (!org) return res.status(404).json({ error: 'not_found', message: 'Organization not found.' });
    res.json({ organization: org });
  } catch (e) {
    console.error('GET /api/admin/organizations/:id:', e);
    res.status(500).json({ error: 'failed', message: e?.message || 'Failed' });
  }
});

app.patch('/api/admin/organizations/:id', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    if (!db) return res.status(503).json({ error: 'database_required', message: 'DATABASE_URL is required.' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'invalid_id', message: 'Invalid organization id.' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const patch = body.venueSettings;
    if (patch == null || typeof patch !== 'object') {
      return res.status(400).json({
        error: 'invalid_body',
        message: 'Provide { "venueSettings": { ... } } with venue / corporate fields.',
      });
    }
    const venueSettings = await organizationsStore.patchOrganizationVenueSettings(db, id, patch);
    res.json({ ok: true, venueSettings });
  } catch (e) {
    console.error('PATCH /api/admin/organizations/:id:', e);
    const msg = e?.message || 'Failed';
    const code = msg === 'organization not found' ? 404 : 400;
    res.status(code).json({ error: 'failed', message: msg });
  }
});

/** Hints for onboarding tenant Spotify apps: exact redirect URIs and encryption key status. */
app.get('/api/admin/spotify-tenant-setup', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    res.json({
      spotifyDashboardUrl: 'https://developer.spotify.com/dashboard',
      redirectUris: collectSpotifySpaRedirectUrisForAdmin(),
      orgEncryptionKeyConfigured: credentialCrypto.isOrgCredentialsKeyConfigured(),
    });
  } catch (e) {
    console.error('GET /api/admin/spotify-tenant-setup:', e);
    res.status(500).json({ error: 'failed', message: e?.message || 'Failed' });
  }
});

/**
 * When TEMPO_APPROVED_HOSTS_ONLY is on, require JWT + allowlisted email. Sends response and returns null if denied.
 */
async function requireApprovedHostUid(req, res) {
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (!uid) {
    res.status(401).json({
      error: 'login_required',
      loginUrl: '/api/auth/google',
      message: 'Sign in with Google first.',
    });
    return null;
  }
  if (!usersStore.isApprovedHostsOnlyMode()) return uid;
  if (!db) {
    res.status(503).json({ error: 'database_required', message: 'DATABASE_URL required' });
    return null;
  }
  const urow = await usersStore.getUserById(db, uid);
  const jwtEmail = hostAuth.getHostEmailFromRequest(req);
  const dbEmail = urow?.email;
  if (
    !usersStore.normalizeHostEmail(jwtEmail || '') &&
    !usersStore.normalizeHostEmail(dbEmail || '')
  ) {
    res.status(403).json({
      error: 'host_profile_incomplete',
      message:
        'Your host account has no email on file. Sign out, then sign in with Google again so your email can be verified against the allowlist.',
    });
    return null;
  }
  if (!(await usersStore.isEmailAllowlistedForHostUser(db, jwtEmail, dbEmail))) {
    res.status(403).json({
      error: 'host_not_approved',
      message:
        'This account is not approved to host games. Ask your organizer to add your exact Google email (or an equivalent Gmail address) to the allowlist.',
    });
    return null;
  }
  return uid;
}

/**
 * Pick a room id for a host: reuse default MDY+userId if free; claim socket-created rooms with no owner;
 * idempotent if this host already owns that id; otherwise try random suffixes.
 */
function allocateHostOwnedRoom(uid, options = {}) {
  const forceNew = options.forceNew === true;
  const base = hostAuth.buildDefaultRoomCode(uid);
  const candidates = [base];
  for (let i = 0; i < 32; i++) {
    candidates.push(`${base}${Math.random().toString(36).slice(2, 6)}`);
  }
  for (const code of candidates) {
    if (!rooms.has(code)) {
      return { code, mode: 'create' };
    }
    const room = rooms.get(code);
    if (!room || typeof room !== 'object') {
      rooms.delete(code);
      return { code, mode: 'create' };
    }
    const owner = room.ownerUserId;
    if (owner == null) {
      room.ownerUserId = uid;
      return { code, mode: 'claim' };
    }
    if (Number(owner) === Number(uid)) {
      if (!forceNew) {
        return { code, mode: 'reuse' };
      }
      continue;
    }
  }
  return null;
}

/** Create a new room owned by the logged-in host (default code = MDY + user id). */
app.post('/api/host/rooms', async (req, res) => {
  try {
    const uid = await requireApprovedHostUid(req, res);
    if (!uid) return;
    if (!db) return res.status(503).json({ error: 'DATABASE_URL required' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const forceNewRoom = body.forceNewRoom === true || body.forceNew === true;
    const picked = allocateHostOwnedRoom(uid, { forceNew: forceNewRoom });
    if (!picked) {
      return res.status(409).json({ error: 'room_code_collision', message: 'Try again in a moment.' });
    }
    const { code, mode } = picked;
    if (mode === 'create') {
      const newRoom = {
        id: code,
        organizationId: 'DEFAULT',
        ownerUserId: uid,
        licenseKey: null,
        host: null,
        hostClientId: null,
        players: new Map(),
        gameState: 'waiting',
        snippetLength: 30,
        winners: [],
        repeatMode: false,
        volume: 100,
        hybridInPersonPlusOnline: false,
        playlistSongs: [],
        currentSongIndex: 0,
        superStrictLock: false,
        pattern: 'line',
        customPattern: undefined,
        createdAt: new Date().toISOString(),
      };
      rooms.set(code, newRoom);
    }
    const roomRef = rooms.get(code);
    if (roomRef) {
      try {
        await resolveRoomVenueBranding(roomRef);
        const b = roomRef.venueBranding;
        if (b && typeof b.defaultSnippetLength === 'number') {
          roomRef.snippetLength = b.defaultSnippetLength;
        }
        if (b && typeof b.volumeCap === 'number') {
          roomRef.volume = Math.min(typeof roomRef.volume === 'number' ? roomRef.volume : 100, b.volumeCap);
        }
      } catch (e) {
        console.error('resolveRoomVenueBranding:', e?.message || e);
      }
    }
    return res.json({ roomId: code, ownerUserId: uid, mode });
  } catch (e) {
    console.error('POST /api/host/rooms:', e);
    res.status(500).json({ error: 'Failed to create room', message: e?.message || 'Failed to create room' });
  }
});

/** Load venue / corporate branding for a host-owned room (organization venue_settings). */
async function resolveRoomVenueBranding(room) {
  if (!room) return;
  if (!db || room.ownerUserId == null) {
    room.venueBranding = null;
    return;
  }
  const uid = Number(room.ownerUserId);
  if (!Number.isFinite(uid)) {
    room.venueBranding = null;
    return;
  }
  room.venueBranding = await organizationsStore.getVenueBrandingForHostUserId(db, uid);
}

function venueBrandingForRoom(room) {
  return room && room.venueBranding ? room.venueBranding : null;
}

/** Normalize to origin for Spotify app redirect allowlist (https; localhost http allowed). */
function normalizeHttpsOrigin(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !isLocal) return '';
    return u.origin;
  } catch {
    return '';
  }
}

/**
 * SPA origins allowed to complete Spotify OAuth on /callback (must match Spotify app redirect URIs).
 * Set TEMPO_ALLOWED_APP_ORIGINS=https://got.example.com,https://tempo.example.com when using multiple subdomains.
 */
function isAllowedSpotifyAppOrigin(origin) {
  const o = normalizeHttpsOrigin(origin);
  if (!o) return false;
  const extras = (process.env.TEMPO_ALLOWED_APP_ORIGINS || '')
    .split(',')
    .map((x) => normalizeHttpsOrigin(x.trim()))
    .filter(Boolean);
  const base = publicAppOrigin();
  const allowed = new Set([base, publicAppOriginOrDefault(), ...extras].filter(Boolean));
  if (allowed.has(o)) return true;
  const parent = (process.env.TEMPO_TRUST_PARENT_DOMAIN || '').trim().toLowerCase();
  if (parent && base) {
    try {
      const bh = new URL(base).hostname.toLowerCase();
      const oh = new URL(o).hostname.toLowerCase();
      if (oh === parent || oh.endsWith(`.${parent}`)) {
        if (bh === parent || bh.endsWith(`.${parent}`)) return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

function spotifyRedirectUriFromAppOrigin(appOrigin) {
  const o = normalizeHttpsOrigin(appOrigin);
  if (!o || !isAllowedSpotifyAppOrigin(appOrigin)) return null;
  return `${o}/callback`;
}

/** Redirect URIs to register in each tenant Spotify app (SPA /callback + optional server SPOTIFY_REDIRECT_URI). */
function collectSpotifySpaRedirectUrisForAdmin() {
  const entries = [];
  const seenUris = new Set();
  const addOrigin = (originInput, label) => {
    const o = normalizeHttpsOrigin(originInput);
    if (!o) return;
    const uri = `${o}/callback`;
    if (seenUris.has(uri)) return;
    seenUris.add(uri);
    entries.push({ redirectUri: uri, origin: o, label });
  };

  const base = publicAppOrigin();
  if (base) {
    addOrigin(base, 'Primary app URL (PUBLIC_APP_URL or CLIENT_APP_URL)');
  } else {
    addOrigin('http://localhost:3000', 'When PUBLIC_APP_URL is unset (typical local dev)');
  }

  const def = publicAppOriginOrDefault();
  addOrigin(def, 'Resolved public app default');

  const extras = (process.env.TEMPO_ALLOWED_APP_ORIGINS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  extras.forEach((raw, i) => {
    addOrigin(
      raw,
      extras.length > 1
        ? `Extra allowed origin #${i + 1} (TEMPO_ALLOWED_APP_ORIGINS)`
        : 'Extra allowed origin (TEMPO_ALLOWED_APP_ORIGINS)'
    );
  });

  const srv = (process.env.SPOTIFY_REDIRECT_URI || '').trim();
  if (srv) {
    try {
      const u = new URL(/^https?:\/\//i.test(srv) ? srv : `https://${srv}`);
      const full = u.href.split('?')[0];
      if (!seenUris.has(full)) {
        seenUris.add(full);
        entries.push({ redirectUri: full, origin: u.origin, label: 'SPOTIFY_REDIRECT_URI (server OAuth default)' });
      }
    } catch {
      /* ignore */
    }
  }

  return entries;
}

// Spotify API Routes — hosts must be signed in (Google JWT); each host uses their own Spotify tokens (user_${id}).
app.use('/api/spotify', async (req, res, next) => {
  const full = (req.originalUrl || req.url || '').split('?')[0];
  const rel = (req.path || '').split('?')[0] || full.replace(/^.*\/api\/spotify/, '') || full;
  if (full.includes('/api/spotify/callback') || rel === '/callback' || rel.endsWith('/callback')) return next();
  if (req.method === 'GET' && (full.endsWith('/api/spotify/status') || rel === '/status')) return next();
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (!uid) {
    return res.status(401).json({
      error: 'login_required',
      loginUrl: '/api/auth/google',
      message: 'Sign in with Google to use Spotify as a host.',
    });
  }
  try {
    if (db) await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, uid);
  } catch (e) {
    console.error('primeTenantSpotifyCredentials:', e?.message || e);
  }
  next();
});

app.get('/api/spotify/auth', async (req, res) => {
  try {
    const uid = await requireApprovedHostUid(req, res);
    if (!uid) return;
    const roomId = String(req.query.roomId || '').trim();
    if (!roomId) {
      return res.status(400).json({
        error: 'room_required',
        message: 'Open a host room before connecting Spotify (stay on /host/your-room).',
      });
    }
    let spotifyRedirectUri = null;
    const appOrigin = String(req.query.appOrigin || '').trim();
    if (appOrigin) {
      spotifyRedirectUri = spotifyRedirectUriFromAppOrigin(appOrigin);
      if (!spotifyRedirectUri) {
        return res.status(400).json({
          error: 'invalid_app_origin',
          message:
            'This app origin is not allowed for Spotify OAuth. Set TEMPO_ALLOWED_APP_ORIGINS to include it, or omit appOrigin to use SPOTIFY_REDIRECT_URI.',
        });
      }
    }
    const state = hostAuth.signSpotifyOAuthState({
      userId: uid,
      roomId,
      spotifyRedirectUri: spotifyRedirectUri || undefined,
    });
    if (db) await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, uid);
    const svc = multiTenantSpotify.getService(`user_${uid}`);
    const authUrl = svc.getAuthorizationURL(state, spotifyRedirectUri);
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

app.get('/api/spotify/status', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (uid != null && db) await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, uid);
    const orgId = uid != null ? `user_${uid}` : 'DEFAULT';
    const tok = multiTenantSpotify.getTokens(orgId);
    if (!tok || !tok.accessToken) {
      return res.json({ connected: false, hasTokens: false, organizationId: orgId });
    }
    const svc = multiTenantSpotify.getService(orgId);
    await svc.ensureValidToken();
    return res.json({ connected: true, hasTokens: true, organizationId: orgId });
  } catch (error) {
    console.error('Spotify status error:', error);
    res.status(500).json({ connected: false, hasTokens: false, error: 'Status check failed' });
  }
});

// Get current tokens for debugging (signed-in host only — their own Spotify connection)
app.get('/api/spotify/tokens', (req, res) => {
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (!uid) {
    return res.status(401).json({ error: 'login_required', message: 'Sign in with Google first.' });
  }
  const tok = multiTenantSpotify.getTokens(`user_${uid}`);
  if (!tok || !tok.accessToken || !tok.refreshToken) {
    return res.status(404).json({
      error: 'No Spotify tokens for this host. Connect Spotify from the host screen first.',
    });
  }

  res.json({
    success: true,
    message: 'These tokens belong to the signed-in host Spotify account (user-specific).',
    envVars: {
      SPOTIFY_ACCESS_TOKEN: tok.accessToken,
      SPOTIFY_REFRESH_TOKEN: tok.refreshToken,
    },
    instructions: [
      'Per-host tokens are stored in the database under organization_id user_<hostId>.',
      'You normally do not need to copy these; use Connect Spotify in the app.',
    ],
  });
});

// Force clear Spotify tokens (for testing)
app.post('/api/spotify/clear', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    spotifyTokens = null;
    if (uid != null) {
      await multiTenantSpotify.clearOrgTokens(`user_${uid}`);
      try {
        const devFile = deviceFileForUserId(uid);
        if (fs.existsSync(devFile)) fs.unlinkSync(devFile);
      } catch (_) {}
    } else {
      await multiTenantSpotify.clearOrgTokens('DEFAULT');
      if (spotifyServiceDefault && typeof spotifyServiceDefault.setTokens === 'function') {
        spotifyServiceDefault.setTokens(null, null);
      }
    }
    try {
      if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
    } catch (_) {}
    spotifyTokens = multiTenantSpotify.getTokens('DEFAULT');
    res.json({ success: true, message: 'Spotify tokens cleared' });
  } catch (error) {
    console.error('❌ Error in /api/spotify/clear:', error);
    res.status(500).json({ success: false, error: 'Failed to clear tokens' });
  }
});

/** Fetch/XHR to /api/spotify/callback should get JSON; top-level Spotify redirect should get 302. */
function spotifyCallbackWantsJson(req) {
  const sec = req.get('Sec-Fetch-Mode') || '';
  if (sec === 'cors' || sec === 'same-origin') return true;
  const accept = req.headers.accept || '';
  if (accept.includes('application/json')) return true;
  return false;
}

/** Decode `rid` from state JWT payload without verify (redirect URL only; tokens use verified state). */
function roomIdFromSpotifyStatePayload(state) {
  if (!state || typeof state !== 'string') return '';
  try {
    const parts = String(state).split('.');
    if (parts.length < 2) return '';
    const seg = parts[1];
    const pad = seg.length % 4 === 0 ? '' : '='.repeat(4 - (seg.length % 4));
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (json.typ !== 'spotify_oauth' || json.rid == null || json.rid === '') return '';
    return String(json.rid).trim();
  } catch {
    return '';
  }
}

app.get('/api/spotify/callback', async (req, res) => {
  const { code, state } = req.query;

  const appBase = publicAppOrigin();
  const wantsJson = spotifyCallbackWantsJson(req);
  const shouldRedirectBrowser = appBase && !wantsJson;

  if (!code) {
    if (shouldRedirectBrowser) {
      return res.redirect(302, `${appBase}/?spotify_error=missing_code`);
    }
    return res.status(400).json({ error: 'Authorization code required' });
  }

  try {
    const parsed = state ? hostAuth.verifySpotifyOAuthState(String(state)) : null;
    const redirectForGrant = parsed?.spotifyRedirectUri || null;
    if (parsed?.userId != null && db) {
      await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, parsed.userId);
    }
    const svc =
      parsed?.userId != null
        ? multiTenantSpotify.getService(`user_${parsed.userId}`)
        : spotifyServiceDefault;
    const tokens = await svc.handleCallback(code, redirectForGrant);
    if (parsed && parsed.userId != null) {
      await multiTenantSpotify.setTokens(`user_${parsed.userId}`, tokens);
    } else {
      await multiTenantSpotify.setTokens('DEFAULT', tokens);
      spotifyTokens = tokens;
      saveTokens(tokens);
    }

    if (shouldRedirectBrowser) {
      const room =
        (parsed?.roomId && String(parsed.roomId)) ||
        (state ? roomIdFromSpotifyStatePayload(String(state)) : '');
      const path = room ? `/host/${encodeURIComponent(room)}` : '/';
      return res.redirect(302, `${appBase}${path}?spotify=connected`);
    }

    res.json({ success: true, message: 'Spotify connected' });
  } catch (error) {
    console.error('❌ Spotify callback failed:', error);
    if (shouldRedirectBrowser) {
      return res.redirect(302, `${appBase}/?spotify_error=1`);
    }
    res.status(500).json({ error: 'Failed to connect Spotify' });
  }
});

app.get('/api/spotify/playlists', async (req, res) => {
  try {
    const svc = spotifyForRequest(req);
    if (!svc) {
      return res.status(401).json({ error: 'login_required', message: 'Sign in with Google to load playlists.' });
    }
    const uid = hostAuth.getHostUserIdFromRequest(req);
    const orgId = `user_${uid}`;
    const orgTokens = multiTenantSpotify.getTokens(orgId);
    if (!orgTokens) {
      return res.status(401).json({
        error: `Spotify not connected for ${orgId}`,
        organizationId: orgId,
      });
    }
    const playlists = await svc.getUserPlaylists();
    res.json({ success: true, playlists, organizationId: orgId });
  } catch (error) {
    console.error('Error getting playlists:', error);
    res.status(500).json({ error: 'Failed to get playlists' });
  }
});

app.get('/api/spotify/playlists/:playlistId/tracks', async (req, res) => {
  try {
    const { playlistId } = req.params;
    const tracks = await spotifyForRequest(req).getPlaylistTracks(playlistId);
    res.json(tracks);
  } catch (error) {
    console.error('Error getting playlist tracks:', error);
    res.status(500).json({ error: 'Failed to get playlist tracks' });
  }
});

// Spotify API endpoints
app.get('/api/spotify/devices', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    const orgId = `user_${uid}`;
    const orgTokens = multiTenantSpotify.getTokens(orgId);
    if (!orgTokens || !orgTokens.accessToken) {
      return res.status(401).json({ error: 'Spotify not connected', organizationId: orgId });
    }

    console.log(`📱 Fetching available Spotify devices (org ${orgId})...`);
    const devices = await spotifyForRequest(req).getUserDevices();
    let currentPlayback = null;
    try {
      currentPlayback = await spotifyForRequest(req).getCurrentPlaybackState();
    } catch (_) {}
    const currentDevice = currentPlayback?.device || null;
    
    const savedDevice = loadSavedDeviceForUser(uid);
    
    if (devices.length === 0) {
      console.log('⚠️  No devices found - user may need to open Spotify on a device');
    } else {
      console.log(`✅ Found ${devices.length} devices:`);
      devices.forEach(device => {
        const status = device.is_active ? '🟢 Active' : '⚪ Inactive';
        const isSaved = savedDevice && savedDevice.id === device.id ? ' 💾 Saved' : '';
        console.log(`  - ${device.name} (${device.type}) ${status}${isSaved}`);
      });
    }
    
    // If we have a saved device but it's not in the current list, add it
    let allDevices = [...devices];
    if (savedDevice && !devices.find(d => d.id === savedDevice.id)) {
      console.log(`📁 Adding saved device to list: ${savedDevice.name}`);
      allDevices.push({
        ...savedDevice,
        is_active: false,
        is_restricted: false,
        is_private_session: false
      });
    }
    
    res.json({ 
      devices: allDevices,
      savedDevice: savedDevice,
      currentDevice: currentDevice
    });
  } catch (error) {
    console.error('Error getting devices:', error);
    res.status(500).json({ error: 'Failed to retrieve devices' });
  }
});

// Save selected device
app.post('/api/spotify/save-device', async (req, res) => {
  try {
    const { device } = req.body;
    const uid = hostAuth.getHostUserIdFromRequest(req);
    
    if (!device || !device.id) {
      return res.status(400).json({ error: 'Device information required' });
    }
    if (uid == null) {
      return res.status(401).json({ error: 'login_required' });
    }

    saveDeviceForUser(uid, device);
    console.log(`💾 Device saved: ${device.name} (${device.id})`);
    
    res.json({ 
      success: true, 
      message: `Device saved: ${device.name}`,
      device: device
    });
  } catch (error) {
    console.error('Error saving device:', error);
    res.status(500).json({ error: 'Failed to save device' });
  }
});

app.post('/api/spotify/play', async (req, res) => {
  try {
    const { deviceId, uris, position } = req.body;
    await spotifyForRequest(req).startPlayback(deviceId, uris, position);
    res.json({ success: true, message: 'Playback started' });
  } catch (error) {
    console.error('Error starting playback:', error);
    res.status(500).json({ error: 'Failed to start playback' });
  }
});

app.post('/api/spotify/pause', async (req, res) => {
  try {
    const { deviceId } = req.body;
    await spotifyForRequest(req).pausePlayback(deviceId);
    res.json({ success: true, message: 'Playback paused' });
  } catch (error) {
    console.error('Error pausing playback:', error);
    res.status(500).json({ error: 'Failed to pause playback' });
  }
});

app.post('/api/spotify/next', async (req, res) => {
  try {
    const { deviceId } = req.body;
    await spotifyForRequest(req).nextTrack(deviceId);
    res.json({ success: true, message: 'Skipped to next track' });
  } catch (error) {
    console.error('Error skipping track:', error);
    res.status(500).json({ error: 'Failed to skip track' });
  }
});

// Explicit transfer playback control
app.post('/api/spotify/transfer', async (req, res) => {
  try {
    const { deviceId, play = true } = req.body || {};
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ success: false, error: 'Spotify not connected' });
    }
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ success: false, error: 'deviceId required' });
    }

    console.log(`🔀 Transfer request to device ${deviceId} (play=${!!play})`);
    await spotifyForRequest(req).ensureValidToken();

    // Verify device presence; attempt activation if missing
    const devices = await spotifyForRequest(req).getUserDevices();
    const found = devices.find(d => d.id === deviceId);
    if (!found) {
      console.log('⚠️ Target device not in list; attempting activation...');
      const activated = await spotifyForRequest(req).activateDevice(deviceId);
      if (!activated) {
        return res.status(404).json({ success: false, error: 'Device not available; open Spotify on that device and try again' });
      }
    }

    await spotifyForRequest(req).transferPlayback(deviceId, !!play);
    console.log(`✅ Transferred playback to ${deviceId}`);

    // Return diagnostic info to help verify account/device context
    let profile = null;
    try { profile = await spotifyForRequest(req).getCurrentUserProfile(); } catch (_) {}
    const devicesAfter = await spotifyForRequest(req).getUserDevices();
    const currentPlayback = await spotifyForRequest(req).getCurrentPlaybackState();
    res.json({ 
      success: true, 
      deviceId,
      profile,
      devices: devicesAfter,
      currentPlayback
    });
  } catch (error) {
    const msg = error?.body?.error?.message || error?.message || 'Unknown error';
    console.error('❌ Error transferring playback:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

app.get('/api/spotify/current', async (req, res) => {
  try {
    const track = await spotifyForRequest(req).getCurrentTrack();
    res.json(track);
  } catch (error) {
    console.error('Error getting current track:', error);
    res.status(500).json({ error: 'Failed to get current track' });
  }
});

// QR proxy to avoid cross-origin embed restrictions
app.get('/api/qr', (req, res) => {
  try {
    const data = req.query.data;
    const size = String(req.query.size || '192');
    if (!data) return res.status(400).send('data required');
    const primary = `https://api.qrserver.com/v1/create-qr-code/?size=${encodeURIComponent(size)}x${encodeURIComponent(size)}&data=${encodeURIComponent(data)}`;
    const fallback = `https://chart.googleapis.com/chart?cht=qr&chs=${encodeURIComponent(size)}x${encodeURIComponent(size)}&chl=${encodeURIComponent(data)}`;

    const pipeImage = (url) => {
      https.get(url, (r) => {
        if (r.statusCode && r.statusCode >= 400) {
          // try fallback
          if (url !== fallback) return pipeImage(fallback);
          return res.status(502).send('QR service failed');
        }
        res.setHeader('Content-Type', r.headers['content-type'] || 'image/png');
        r.pipe(res);
      }).on('error', () => {
        if (url !== fallback) return pipeImage(fallback);
        res.status(502).send('QR fetch error');
      });
    };

    pipeImage(primary);
  } catch (e) {
    res.status(500).send('QR error');
  }
});

// Extended Spotify control endpoints
app.post('/api/spotify/shuffle', async (req, res) => {
  try {
    const { shuffle, deviceId } = req.body;
    if (shuffle === undefined) return res.status(400).json({ success: false, error: 'shuffle boolean required' });
    await spotifyForRequest(req).ensureValidToken();
    await spotifyForRequest(req).setShuffleState(!!shuffle, deviceId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error setting shuffle:', error);
    res.status(500).json({ success: false, error: 'Failed to set shuffle' });
  }
});

app.post('/api/spotify/repeat', async (req, res) => {
  try {
    const { state, deviceId } = req.body;
    if (!['track', 'context', 'off'].includes(state)) {
      return res.status(400).json({ success: false, error: 'Invalid repeat state' });
    }
    await spotifyForRequest(req).ensureValidToken();
    await spotifyForRequest(req).setRepeatState(state, deviceId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error setting repeat:', error);
    res.status(500).json({ success: false, error: 'Failed to set repeat' });
  }
});

app.post('/api/spotify/previous', async (req, res) => {
  try {
    const { deviceId } = req.body;
    await spotifyForRequest(req).ensureValidToken();
    await spotifyForRequest(req).previousTrack(deviceId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error going to previous track:', error);
    res.status(500).json({ success: false, error: 'Failed to go to previous track' });
  }
});

app.post('/api/spotify/queue', async (req, res) => {
  try {
    const { uri, deviceId } = req.body;
    if (!uri) return res.status(400).json({ success: false, error: 'uri required' });
    await spotifyForRequest(req).ensureValidToken();
    await spotifyForRequest(req).addToQueue(uri, deviceId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error adding to queue:', error);
    res.status(500).json({ success: false, error: 'Failed to add to queue' });
  }
});

// Force device detection by attempting playback
app.post('/api/spotify/force-device', async (req, res) => {
  try {
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }

    console.log('🔄 Attempting to force device detection...');
    
    // Use the enhanced forceDeviceActivation method
    const result = await spotifyForRequest(req).forceDeviceActivation();
    
    if (result.success) {
      console.log(`✅ Device activated: ${result.device.name}`);
      res.json({ 
        success: true, 
        message: `Device activated: ${result.device.name}`,
        device: result.device
      });
    } else {
      console.log('❌ No devices available for activation');
      res.status(404).json({ 
        success: false, 
        error: 'No devices available for activation',
        message: 'Please open Spotify on any device and try again'
      });
    }
  } catch (error) {
    console.error('Error forcing device detection:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to force device detection',
      message: 'Please try again or open Spotify on your device'
    });
  }
});

// Refresh Spotify connection endpoint (current host's tokens only)
app.post('/api/spotify/refresh', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (!uid) return res.status(401).json({ error: 'login_required' });
    const orgId = `user_${uid}`;
    const tok = multiTenantSpotify.getTokens(orgId);
    if (!tok || !tok.refreshToken) {
      return res.status(401).json({ error: 'No refresh token available' });
    }

    console.log('🔄 Refreshing Spotify access token for', orgId);
    const svc = multiTenantSpotify.getService(orgId);
    await svc.refreshAccessToken();
    await multiTenantSpotify.setTokens(orgId, {
      accessToken: svc.accessToken,
      refreshToken: svc.refreshToken || tok.refreshToken,
      expiresIn: 3600,
    });

    console.log('✅ Spotify access token refreshed successfully');
    res.json({ success: true, message: 'Spotify connection refreshed' });
  } catch (error) {
    console.error('❌ Error refreshing Spotify connection:', error);
    res.status(500).json({ error: 'Failed to refresh Spotify connection' });
  }
});

// Volume control endpoint
app.post('/api/spotify/volume', async (req, res) => {
  try {
    const { volume, deviceId, roomId } = req.body;
    
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (volume === undefined || volume < 0 || volume > 100) {
      return res.status(400).json({ error: 'Invalid volume level (0-100)' });
    }
    
    console.log(`🔊 Setting volume to ${volume}% on device: ${deviceId}`);
    
    await spotifyForRequest(req).ensureValidToken();
    await spotifyForRequest(req).setVolume(volume, deviceId);
    
    // Save volume to room state if roomId is provided
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.volume = volume;
        console.log(`💾 Saved volume ${volume}% to room ${roomId}`);
      }
    }
    
    console.log('✅ Volume set successfully');
    res.json({ success: true, message: 'Volume updated' });
  } catch (error) {
    console.error('❌ Error setting volume:', error);
    res.status(500).json({ error: 'Failed to set volume' });
  }
});

// Seek endpoint
app.post('/api/spotify/seek', async (req, res) => {
  try {
    const { position, deviceId } = req.body;
    
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (position === undefined || position < 0) {
      return res.status(400).json({ error: 'Invalid position' });
    }
    
    console.log(`⏩ Seeking to position ${position}ms on device: ${deviceId}`);
    
    await spotifyForRequest(req).ensureValidToken();
    await spotifyForRequest(req).seekToPosition(position, deviceId);
    
    console.log('✅ Seek successful');
    res.json({ success: true, message: 'Seek completed' });
  } catch (error) {
    console.error('❌ Error seeking:', error);
    res.status(500).json({ error: 'Failed to seek' });
  }
});

// Get current playback state (normalized for client)
app.get('/api/spotify/current-playback', async (req, res) => {
  try {
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ success: false, error: 'Spotify not connected' });
    }
    
    await spotifyForRequest(req).ensureValidToken();
    const playback = await spotifyForRequest(req).getCurrentPlaybackState();
    res.json({ success: true, playbackState: playback || null });
  } catch (error) {
    console.error('❌ Error getting current playback:', error);
    res.status(500).json({ success: false, error: 'Failed to get current playback' });
  }
});

// Get playlist tracks
app.get('/api/spotify/playlist-tracks/:playlistId', async (req, res) => {
  try {
    const { playlistId } = req.params;
    
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    await spotifyForRequest(req).ensureValidToken();
    
    // First get the playlist information to include in track data
    let playlistInfo = null;
    try {
      const playlistResponse = await spotifyForRequest(req).spotifyApi.getPlaylist(playlistId);
      playlistInfo = {
        id: playlistResponse.body.id,
        name: playlistResponse.body.name
      };
    } catch (error) {
      console.warn('⚠️ Could not fetch playlist info for', playlistId, ':', error.message);
      // Continue without playlist info
    }
    
    const tracks = await spotifyForRequest(req).getPlaylistTracks(playlistId, playlistInfo);
    
    res.json({
      success: true,
      tracks: tracks
    });
  } catch (error) {
    console.error('❌ Error getting playlist tracks:', error);
    res.status(500).json({ error: 'Failed to get playlist tracks' });
  }
});

/** Batch: explicit vs total track counts per playlist (Spotify `track.explicit`). */
app.post('/api/spotify/playlists/explicit-stats-batch', async (req, res) => {
  try {
    const svc = spotifyForRequest(req);
    if (!svc) {
      return res.status(401).json({ error: 'login_required', message: 'Sign in with Google to load playlists.' });
    }
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (uid == null) {
      return res.status(401).json({ error: 'login_required' });
    }
    const orgId = `user_${uid}`;
    await multiTenantSpotify.ensureOrgTokensLoaded(orgId);
    const orgTokens = multiTenantSpotify.getTokens(orgId);
    if (!orgTokens || !orgTokens.accessToken) {
      return res.status(401).json({
        error: `Spotify not connected for ${orgId}`,
        organizationId: orgId,
      });
    }
    await svc.ensureValidToken();
    const raw = req.body && Array.isArray(req.body.playlistIds) ? req.body.playlistIds : [];
    const ids = raw.map((x) => String(x).trim()).filter(Boolean).slice(0, 80);
    if (ids.length === 0) {
      return res.json({ results: {} });
    }
    const results = await mapPlaylistIdsWithConcurrency(ids, 8, (pid) => svc.getPlaylistExplicitStats(pid));
    res.json({ results });
  } catch (e) {
    console.error('POST /api/spotify/playlists/explicit-stats-batch:', e);
    res.status(500).json({ error: 'Failed to load explicit stats' });
  }
});

// Create permanent output playlist
app.post('/api/spotify/create-output-playlist', async (req, res) => {
  try {
    const { name, trackIds, description } = req.body;
    
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (!name || !trackIds || !Array.isArray(trackIds)) {
      return res.status(400).json({ error: 'Name and trackIds array required' });
    }
    
    await spotifyForRequest(req).ensureValidToken();
    
    // Convert track IDs to URIs
    const trackUris = trackIds.map(id => `spotify:track:${id}`);
    
    // Create the output playlist
    const result = await spotifyForRequest(req).createOutputPlaylist(name, trackUris, description);
    
    res.json({
      success: true,
      playlistId: result.playlistId,
      playlistName: result.name,
      trackCount: trackIds.length
    });
  } catch (error) {
    console.error('Error creating output playlist:', error);
    res.status(500).json({ error: 'Failed to create output playlist' });
  }
});

// Get user's Game Of Tones output playlists
app.get('/api/spotify/got-playlists', async (req, res) => {
  try {
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    await spotifyForRequest(req).ensureValidToken();
    const playlists = await spotifyForRequest(req).getGameOfTonesPlaylists();
    
    res.json({
      success: true,
      playlists: playlists
    });
  } catch (error) {
    console.error('Error getting Game Of Tones playlists:', error);
    res.status(500).json({ error: 'Failed to get playlists' });
  }
});

// Delete multiple playlists
app.post('/api/spotify/delete-playlists', async (req, res) => {
  console.log('🗑️ Delete playlists request received');
  try {
    const { playlistIds } = req.body;
    console.log('🗑️ Request body:', { playlistIds: playlistIds?.length ? `${playlistIds.length} playlists` : 'none' });
    
    if (!hostSpotifyHasTokens(req)) {
      console.log('❌ Spotify not connected');
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (!playlistIds || !Array.isArray(playlistIds) || playlistIds.length === 0) {
      console.log('❌ Invalid playlistIds:', playlistIds);
      return res.status(400).json({ error: 'playlistIds array required' });
    }
    
    console.log('🔑 Ensuring valid token...');
    await spotifyForRequest(req).ensureValidToken();
    
    console.log('🗑️ Deleting playlists...');
    const results = await spotifyForRequest(req).deleteMultiplePlaylists(playlistIds, {
      requireGotOutputPrefix: true
    });
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`✅ Delete results: ${successful} successful, ${failed} failed`);
    
    res.json({
      success: true,
      deleted: successful,
      failed: failed,
      results: results
    });
  } catch (error) {
    console.error('❌ Error deleting playlists:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to delete playlists', details: error.message });
  }
});

// Search for tracks
app.get('/api/spotify/search-tracks', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }
    
    await spotifyForRequest(req).ensureValidToken();
    
    const tracks = await spotifyForRequest(req).searchTracks(q, parseInt(limit));
    
    res.json({
      success: true,
      tracks: tracks
    });
  } catch (error) {
    console.error('Error searching tracks:', error);
    res.status(500).json({ error: 'Failed to search tracks', details: error.message });
  }
});

// Replace a song in the finalized playlist and update the original playlist
app.post('/api/spotify/replace-song', async (req, res) => {
  try {
    const { roomId, oldSongId, newSongId, position } = req.body;
    
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (!roomId || !oldSongId || !newSongId) {
      return res.status(400).json({ error: 'roomId, oldSongId, and newSongId are required' });
    }
    
    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    await spotifyForRequest(req).ensureValidToken();
    
    // Find the old song in various possible data structures
    let oldSong = null;
    
    // Check room.playlistSongs first (for active games)
    if (room.playlistSongs) {
      oldSong = room.playlistSongs.find(song => song.id === oldSongId);
    }
    
    // If not found, check finalizedSongOrder (for 5x15 mode)
    if (!oldSong && room.finalizedSongOrder) {
      // For finalizedSongOrder, we need to find the song in the original song list
      // This is a bit tricky since finalizedSongOrder only contains IDs
      console.log('🔍 Searching in finalizedSongOrder for song:', oldSongId);
    }
    
    // If not found, check oneBySeventyFivePool (for 1x75 mode)
    if (!oldSong && room.oneBySeventyFivePool) {
      oldSong = room.oneBySeventyFivePool.find(song => song.id === oldSongId);
    }
    
    // If not found, check fiveByFifteenColumns (for 5x15 mode)
    if (!oldSong && room.fiveByFifteenColumns) {
      for (const column of room.fiveByFifteenColumns) {
        oldSong = column.find(song => song.id === oldSongId);
        if (oldSong) break;
      }
    }
    
    // If not found, check finalizedSongs (for pre-game song replacement)
    if (!oldSong && room.finalizedSongs) {
      oldSong = room.finalizedSongs.find(song => song.id === oldSongId);
    }
    
    if (!oldSong) {
      console.log('❌ Song not found in any room data structure:', oldSongId);
      console.log('📊 Room data structures available:', {
        hasPlaylistSongs: !!room.playlistSongs,
        playlistSongsLength: room.playlistSongs?.length || 0,
        hasFinalizedSongOrder: !!room.finalizedSongOrder,
        finalizedSongOrderLength: room.finalizedSongOrder?.length || 0,
        hasFinalizedSongs: !!room.finalizedSongs,
        finalizedSongsLength: room.finalizedSongs?.length || 0,
        hasOneBySeventyFivePool: !!room.oneBySeventyFivePool,
        oneBySeventyFivePoolLength: room.oneBySeventyFivePool?.length || 0,
        hasFiveByFifteenColumns: !!room.fiveByFifteenColumns,
        fiveByFifteenColumnsLength: room.fiveByFifteenColumns?.length || 0
      });
      return res.status(404).json({ error: 'Old song not found in playlist' });
    }
    
    // Get the new song details from Spotify
    const newSongResponse = await spotifyForRequest(req).spotifyApi.getTrack(newSongId);
    const newSongData = newSongResponse.body;
    
    const newSong = {
      id: newSongData.id,
      name: newSongData.name,
      artist: newSongData.artists.map(artist => artist.name).join(', '),
      album: newSongData.album.name,
      duration: newSongData.duration_ms,
      uri: newSongData.uri,
      previewUrl: newSongData.preview_url || null,
      sourcePlaylistId: oldSong.sourcePlaylistId,
      sourcePlaylistName: oldSong.sourcePlaylistName
    };
    
    // Replace the song in the original Spotify playlist
    if (oldSong.sourcePlaylistId) {
      try {
        await spotifyForRequest(req).replaceTrackInPlaylist(
          oldSong.sourcePlaylistId,
          `spotify:track:${oldSongId}`,
          `spotify:track:${newSongId}`,
          position
        );
        console.log(`✅ Replaced song in original playlist: ${oldSong.sourcePlaylistName}`);
      } catch (error) {
        console.error('❌ Failed to replace song in original playlist:', error);
        // Continue with local replacement even if Spotify update fails
      }
    }
    
    // Update the song in all relevant data structures
    let updatedInAnyStructure = false;
    
    // Update room.playlistSongs if it exists
    if (room.playlistSongs) {
      const songIndex = room.playlistSongs.findIndex(song => song.id === oldSongId);
      if (songIndex !== -1) {
        room.playlistSongs[songIndex] = newSong;
        updatedInAnyStructure = true;
        console.log(`✅ Updated song in room.playlistSongs at index ${songIndex}`);
      }
    }
    
    // Update finalized song order if it exists (this only contains IDs, so we just replace the ID)
    if (room.finalizedSongOrder) {
      const orderIndex = room.finalizedSongOrder.indexOf(oldSongId);
      if (orderIndex !== -1) {
        room.finalizedSongOrder[orderIndex] = newSongId;
        updatedInAnyStructure = true;
        console.log(`✅ Updated song ID in room.finalizedSongOrder at index ${orderIndex}`);
      }
    }
    
    // Update oneBySeventyFivePool if it exists
    if (room.oneBySeventyFivePool) {
      const poolIndex = room.oneBySeventyFivePool.findIndex(item => item.id === oldSongId);
      if (poolIndex !== -1) {
        room.oneBySeventyFivePool[poolIndex] = newSong;
        updatedInAnyStructure = true;
        console.log(`✅ Updated song in room.oneBySeventyFivePool at index ${poolIndex}`);
      }
    }
    
    // Update fiveByFifteenColumns if they exist
    if (room.fiveByFifteenColumns) {
      for (let col = 0; col < room.fiveByFifteenColumns.length; col++) {
        const colIndex = room.fiveByFifteenColumns[col].findIndex(item => item.id === oldSongId);
        if (colIndex !== -1) {
          room.fiveByFifteenColumns[col][colIndex] = newSong;
          updatedInAnyStructure = true;
          console.log(`✅ Updated song in room.fiveByFifteenColumns[${col}] at index ${colIndex}`);
        }
      }
    }
    
    // Update finalizedSongs if it exists (for pre-game song replacement)
    if (room.finalizedSongs) {
      const finalizedIndex = room.finalizedSongs.findIndex(item => item.id === oldSongId);
      if (finalizedIndex !== -1) {
        room.finalizedSongs[finalizedIndex] = newSong;
        updatedInAnyStructure = true;
        console.log(`✅ Updated song in room.finalizedSongs at index ${finalizedIndex}`);
      }
    }
    
    if (!updatedInAnyStructure) {
      console.log('⚠️ Song was found but not updated in any data structure');
    }
    
    // Broadcast the song replacement to all clients
    io.to(roomId).emit('song-replaced', {
      oldSongId,
      newSong,
      position: songIndex
    });
    
    console.log(`✅ Song replaced successfully: ${oldSong.name} -> ${newSong.name}`);
    
    res.json({
      success: true,
      oldSong: oldSong,
      newSong: newSong,
      position: songIndex
    });
    
  } catch (error) {
    console.error('Error replacing song:', error);
    res.status(500).json({ error: 'Failed to replace song', details: error.message });
  }
});

// AI-powered song suggestions for playlists
app.post('/api/spotify/suggest-songs', async (req, res) => {
  try {
    console.log('🤖 AI suggestion request received');
    console.log('🤖 Request body keys:', Object.keys(req.body || {}));
    try {
      console.log('🤖 Request body:', JSON.stringify(req.body, null, 2));
    } catch (jsonError) {
      console.log('🤖 Request body (stringify failed):', req.body);
      console.log('🤖 JSON stringify error:', jsonError.message);
    }
    
    const { playlistId, playlistName, existingSongs, targetCount } = req.body || {};
    
    console.log('🤖 Extracted values:', { 
      playlistId, 
      playlistName, 
      existingSongsCount: existingSongs?.length || 0, 
      targetCount 
    });
    
    if (!hostSpotifyHasTokens(req)) {
      console.log('🤖 Returning Spotify not connected error');
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    await spotifyForRequest(req).ensureValidToken();
    
    console.log(`🤖 Generating AI suggestions for playlist: "${playlistName}"`);
    console.log(`📊 Current songs: ${existingSongs?.length || 0}, Target: ${targetCount}`);
    
    // Analyze playlist name for themes and keywords
    const spotifySvc = spotifyForRequest(req);
    if (!spotifySvc) {
      return res.status(401).json({ error: 'login_required' });
    }
    const suggestions = await generateSmartSuggestions(playlistName, existingSongs, targetCount, spotifySvc);
    
    res.json({
      success: true,
      suggestions: suggestions,
      analysis: {
        playlistTheme: suggestions.theme,
        searchStrategies: suggestions.strategies,
        confidence: suggestions.confidence
      }
    });
  } catch (error) {
    console.error('❌ Error generating song suggestions:', error);
    
    // Provide more specific error messages based on the error type
    let errorMessage = 'Failed to generate suggestions';
    let statusCode = 500;
    
    if (error.message) {
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        errorMessage = 'Spotify API rate limit exceeded. Please wait a moment and try again.';
        statusCode = 429;
      } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
        errorMessage = 'Network error connecting to Spotify. Please check your internet connection.';
        statusCode = 503;
      } else if (error.message.includes('token') || error.message.includes('401')) {
        errorMessage = 'Spotify authentication expired. Please reconnect to Spotify.';
        statusCode = 401;
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Request timed out. Spotify may be experiencing issues. Please try again.';
        statusCode = 504;
      } else {
        errorMessage = `Suggestion generation failed: ${error.message}`;
      }
    }
    
    console.error(`🤖 Returning error (${statusCode}): ${errorMessage}`);
    res.status(statusCode).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Smart suggestion generation function
async function generateSmartSuggestions(playlistName, existingSongs = [], targetCount = 15, spotifyService) {
  if (!spotifyService) {
    throw new Error('Spotify service required');
  }
  const songsNeeded = Math.max(0, targetCount - existingSongs.length);
  
  if (songsNeeded <= 0) {
    return {
      theme: 'Playlist is already sufficient',
      strategies: [],
      confidence: 1.0,
      songs: []
    };
  }
  
  // Analyze playlist name for themes, genres, eras, and patterns
  const analysis = analyzePlaylistName(playlistName);
  
  // Extract common elements from existing songs
  const existingAnalysis = analyzeExistingSongs(existingSongs);
  
  // Generate search queries based on analysis
  const searchQueries = generateSearchQueries(analysis, existingAnalysis);
  
  console.log(`🔍 Generated ${searchQueries.length} search strategies for "${playlistName}"`);
  
  // Search for songs using multiple strategies
  const allSuggestions = [];
  const seenSongs = new Set(existingSongs.map(s => s.id));
  
  for (const query of searchQueries.slice(0, 5)) { // Limit to 5 strategies to avoid rate limits
    try {
      console.log(`🎵 Searching: "${query.query}" (${query.strategy})`);
      const results = await spotifyService.searchTracks(query.query, 10);
      
      const filteredResults = results
        .filter(song => !seenSongs.has(song.id))
        .map(song => ({
          ...song,
          strategy: query.strategy,
          confidence: query.confidence,
          reasoning: query.reasoning
        }));
      
      filteredResults.forEach(song => seenSongs.add(song.id));
      allSuggestions.push(...filteredResults);
      
    } catch (error) {
      console.warn(`⚠️ Search failed for "${query.query}":`, error.message);
    }
  }
  
  // Score and rank suggestions
  const rankedSuggestions = rankSuggestions(allSuggestions, analysis, existingAnalysis);
  
  // Return top suggestions
  const topSuggestions = rankedSuggestions.slice(0, Math.min(songsNeeded * 2, 20));
  
  console.log(`✅ Generated ${topSuggestions.length} ranked suggestions`);
  
  return {
    theme: analysis.primaryTheme,
    strategies: searchQueries.map(q => q.strategy),
    confidence: analysis.confidence,
    songs: topSuggestions,
    songsNeeded: songsNeeded
  };
}

// Analyze playlist name for themes, genres, eras, etc.
function analyzePlaylistName(name) {
  const cleanName = name.toLowerCase().replace(/^got\s*[-–:]*\s*/i, '').trim();
  
  // Genre patterns
  const genrePatterns = {
    rock: /rock|metal|punk|grunge|alternative/i,
    pop: /pop|mainstream|hits|chart|radio/i,
    jazz: /jazz|swing|bebop|smooth/i,
    blues: /blues|bb king|muddy waters/i,
    country: /country|nashville|honky|bluegrass/i,
    hiphop: /hip.?hop|rap|urban|trap/i,
    electronic: /electronic|edm|techno|house|synth/i,
    classical: /classical|symphony|orchestra|baroque/i,
    folk: /folk|acoustic|singer.songwriter/i,
    reggae: /reggae|ska|dub/i,
    latin: /latin|salsa|bachata|reggaeton/i
  };
  
  // Era patterns
  const eraPatterns = {
    '60s': /60s?|sixties|1960/i,
    '70s': /70s?|seventies|1970/i,
    '80s': /80s?|eighties|1980/i,
    '90s': /90s?|nineties|1990/i,
    '2000s': /2000s?|millennium|y2k/i,
    'oldies': /oldies|classic|vintage|retro/i,
    'modern': /modern|current|recent|new/i
  };
  
  // Theme patterns with semantic concepts
  const themePatterns = {
    love: /love|romantic|valentine|heart|crush/i,
    party: /party|dance|club|celebration|fun/i,
    sad: /sad|melancholy|heartbreak|tears|blue/i,
    workout: /workout|gym|fitness|running|energy/i,
    chill: /chill|relax|mellow|calm|ambient/i,
    driving: /driving|road|highway|cruise/i,
    summer: /summer|beach|sun|vacation/i,
    winter: /winter|christmas|holiday|snow/i,
    duos: /duos?|pairs?|featuring|feat|collaboration/i,
    covers: /covers?|tribute|version/i,
    instrumentals: /instrumental|no vocals|background/i,
    transportation: /transportation|transport|travel|vehicle|car|truck|bike|plane|train|boat|ship|motorcycle|bus|taxi|drive|fly|sail|ride/i,
    animals: /animals?|pets?|dog|cat|bird|horse|lion|tiger|bear|wolf|elephant|monkey|zoo|wild/i,
    colors: /colors?|red|blue|green|yellow|orange|purple|pink|black|white|rainbow|bright/i,
    weather: /weather|rain|snow|sun|storm|cloud|wind|thunder|lightning|hurricane|tornado/i,
    food: /food|eat|drink|hungry|restaurant|kitchen|cook|recipe|meal|dinner|lunch|breakfast/i,
    emotions: /emotions?|feelings?|happy|sad|angry|excited|nervous|scared|proud|jealous|lonely/i,
    time: /time|clock|hour|minute|second|morning|afternoon|evening|night|today|tomorrow|yesterday/i,
    nature: /nature|forest|mountain|ocean|river|lake|tree|flower|garden|park|outdoor/i,
    city: /city|town|urban|street|building|downtown|neighborhood|metro|skyline/i,
    space: /space|star|moon|planet|galaxy|universe|cosmic|astronaut|rocket|satellite/i,
    sports: /sports?|game|team|player|win|lose|championship|football|basketball|baseball|soccer/i,
    music: /music|song|band|singer|guitar|piano|drum|concert|album|melody|rhythm/i
  };
  
  const analysis = {
    genres: [],
    eras: [],
    themes: [],
    keywords: [],
    confidence: 0.5
  };
  
  // Check for genre matches
  for (const [genre, pattern] of Object.entries(genrePatterns)) {
    if (pattern.test(cleanName)) {
      analysis.genres.push(genre);
      analysis.confidence += 0.2;
    }
  }
  
  // Check for era matches
  for (const [era, pattern] of Object.entries(eraPatterns)) {
    if (pattern.test(cleanName)) {
      analysis.eras.push(era);
      analysis.confidence += 0.15;
    }
  }
  
  // Check for theme matches
  for (const [theme, pattern] of Object.entries(themePatterns)) {
    if (pattern.test(cleanName)) {
      analysis.themes.push(theme);
      analysis.confidence += 0.1;
    }
  }
  
  // Extract potential artist names or specific keywords
  const words = cleanName.split(/\s+/).filter(word => word.length > 2);
  analysis.keywords = words;
  
  // Determine primary theme
  if (analysis.genres.length > 0) {
    analysis.primaryTheme = `${analysis.genres[0]} music`;
  } else if (analysis.themes.length > 0) {
    analysis.primaryTheme = `${analysis.themes[0]} songs`;
  } else if (analysis.eras.length > 0) {
    analysis.primaryTheme = `${analysis.eras[0]} music`;
  } else {
    analysis.primaryTheme = cleanName;
  }
  
  analysis.confidence = Math.min(analysis.confidence, 1.0);
  
  return analysis;
}

// Analyze existing songs to find common patterns
function analyzeExistingSongs(songs) {
  if (!songs || songs.length === 0) {
    return { artists: [], commonWords: [], avgYear: null };
  }
  
  const artists = {};
  const words = {};
  
  songs.forEach(song => {
    // Count artists
    if (song.artist) {
      const artistNames = song.artist.split(/,|\s+&\s+|\s+feat\.?\s+/i);
      artistNames.forEach(artist => {
        const cleanArtist = artist.trim().toLowerCase();
        artists[cleanArtist] = (artists[cleanArtist] || 0) + 1;
      });
    }
    
    // Count words in song titles
    if (song.name) {
      const titleWords = song.name.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2 && !['the', 'and', 'for', 'you', 'are', 'not'].includes(word));
      
      titleWords.forEach(word => {
        words[word] = (words[word] || 0) + 1;
      });
    }
  });
  
  // Get most common artists and words
  const topArtists = Object.entries(artists)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([artist]) => artist);
  
  const commonWords = Object.entries(words)
    .filter(([,count]) => count > 1)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([word]) => word);
  
  // Detect strong patterns - words that appear in most songs (like "Sun" in "Sun songs")
  const strongPatterns = Object.entries(words)
    .filter(([,count]) => count >= Math.max(2, Math.ceil(songs.length * 0.4))) // At least 40% of songs or 2 minimum
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3)
    .map(([word]) => word);

  return {
    artists: topArtists,
    commonWords: commonWords,
    strongPatterns: strongPatterns, // NEW: Words that appear in most songs
    songCount: songs.length
  };
}

// Generate search queries based on analysis
function generateSearchQueries(analysis, existingAnalysis) {
  const queries = [];
  
  // PRIORITY: Strong pattern-based searches (like "Sun" in "Sun songs")
  if (existingAnalysis.strongPatterns && existingAnalysis.strongPatterns.length > 0) {
    existingAnalysis.strongPatterns.forEach(pattern => {
      queries.push({
        query: `"${pattern}"`,
        strategy: 'Pattern Match',
        confidence: 0.95,
        reasoning: `Songs with "${pattern}" (detected pattern from existing tracks)`
      });
      
      // Also search in artist names
      queries.push({
        query: `artist:"${pattern}"`,
        strategy: 'Artist Pattern',
        confidence: 0.9,
        reasoning: `Artists with "${pattern}" in their name`
      });
    });
  }
  
  // Genre-based searches
  analysis.genres.forEach(genre => {
    queries.push({
      query: `genre:"${genre}"`,
      strategy: 'Genre Match',
      confidence: 0.8,
      reasoning: `Songs in the ${genre} genre`
    });
    
    if (analysis.eras.length > 0) {
      queries.push({
        query: `genre:"${genre}" year:${analysis.eras[0]}`,
        strategy: 'Genre + Era',
        confidence: 0.9,
        reasoning: `${genre} songs from the ${analysis.eras[0]}`
      });
    }
  });
  
  // Era-based searches
  analysis.eras.forEach(era => {
    const yearRange = getYearRange(era);
    if (yearRange) {
      queries.push({
        query: `year:${yearRange}`,
        strategy: 'Era Match',
        confidence: 0.7,
        reasoning: `Songs from the ${era}`
      });
    }
  });
  
  // Theme-based searches
  analysis.themes.forEach(theme => {
    const themeQueries = getThemeQueries(theme);
    themeQueries.forEach(q => {
      queries.push({
        query: q,
        strategy: 'Theme Match',
        confidence: 0.6,
        reasoning: `Songs matching the ${theme} theme`
      });
    });
  });
  
  // Artist similarity searches (if we have existing songs)
  existingAnalysis.artists.slice(0, 3).forEach(artist => {
    queries.push({
      query: `artist:"${artist}"`,
      strategy: 'Artist Match',
      confidence: 0.8,
      reasoning: `More songs by ${artist}`
    });
  });
  
  // Keyword-based searches
  analysis.keywords.slice(0, 3).forEach(keyword => {
    queries.push({
      query: keyword,
      strategy: 'Keyword Match',
      confidence: 0.4,
      reasoning: `Songs related to "${keyword}"`
    });
  });
  
  // Fallback: general searches based on primary theme
  if (queries.length === 0) {
    queries.push({
      query: analysis.primaryTheme,
      strategy: 'Theme Search',
      confidence: 0.3,
      reasoning: `General search for ${analysis.primaryTheme}`
    });
  }
  
  return queries.sort((a, b) => b.confidence - a.confidence);
}

// Helper function to get year ranges for eras
function getYearRange(era) {
  const ranges = {
    '60s': '1960-1969',
    '70s': '1970-1979',
    '80s': '1980-1989',
    '90s': '1990-1999',
    '2000s': '2000-2009',
    'oldies': '1950-1979',
    'modern': '2010-2024'
  };
  return ranges[era];
}

// Helper function to get theme-specific search queries
function getThemeQueries(theme) {
  const themeQueries = {
    love: ['love song', 'romantic', 'valentine', 'heart', 'crush', 'romance'],
    party: ['party', 'dance', 'celebration', 'fun', 'club', 'disco'],
    sad: ['sad song', 'heartbreak', 'melancholy', 'blues', 'tears', 'lonely'],
    workout: ['workout', 'energy', 'pump up', 'motivation', 'gym', 'running'],
    chill: ['chill', 'relax', 'mellow', 'ambient', 'calm', 'peaceful'],
    driving: ['driving', 'road trip', 'highway', 'cruise', 'car', 'journey'],
    summer: ['summer', 'beach', 'sunshine', 'vacation', 'hot', 'sunny'],
    winter: ['winter', 'christmas', 'holiday', 'snow', 'cold', 'cozy'],
    duos: ['duet', 'featuring', 'collaboration', 'feat', 'with', 'together'],
    covers: ['cover version', 'tribute', 'acoustic version', 'remake'],
    instrumentals: ['instrumental', 'no vocals', 'background music', 'piano', 'guitar'],
    transportation: [
      'car', 'truck', 'motorcycle', 'bike', 'bicycle', 'vehicle',
      'plane', 'airplane', 'flight', 'fly', 'pilot', 'airport',
      'train', 'railroad', 'locomotive', 'subway', 'metro',
      'boat', 'ship', 'sail', 'ocean', 'cruise', 'yacht',
      'bus', 'taxi', 'ride', 'drive', 'highway', 'road',
      'travel', 'journey', 'trip', 'transportation', 'moving'
    ],
    animals: [
      'dog', 'cat', 'bird', 'horse', 'lion', 'tiger', 'bear', 'wolf',
      'elephant', 'monkey', 'rabbit', 'fox', 'deer', 'eagle', 'snake',
      'fish', 'shark', 'whale', 'dolphin', 'butterfly', 'bee', 'spider'
    ],
    colors: [
      'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink',
      'black', 'white', 'brown', 'gray', 'silver', 'gold', 'rainbow'
    ],
    weather: [
      'rain', 'snow', 'sun', 'storm', 'thunder', 'lightning', 'wind',
      'cloud', 'hurricane', 'tornado', 'sunshine', 'rainbow', 'fog'
    ],
    food: [
      'food', 'eat', 'drink', 'hungry', 'restaurant', 'kitchen', 'cook',
      'pizza', 'burger', 'coffee', 'wine', 'beer', 'chocolate', 'sugar'
    ],
    emotions: [
      'happy', 'sad', 'angry', 'excited', 'nervous', 'scared', 'proud',
      'jealous', 'lonely', 'grateful', 'hopeful', 'worried', 'calm'
    ],
    time: [
      'time', 'clock', 'morning', 'afternoon', 'evening', 'night',
      'today', 'tomorrow', 'yesterday', 'midnight', 'dawn', 'sunset'
    ],
    nature: [
      'nature', 'forest', 'mountain', 'ocean', 'river', 'lake', 'tree',
      'flower', 'garden', 'park', 'outdoor', 'wilderness', 'valley'
    ],
    city: [
      'city', 'town', 'urban', 'street', 'building', 'downtown',
      'neighborhood', 'metro', 'skyline', 'lights', 'traffic'
    ],
    space: [
      'space', 'star', 'moon', 'planet', 'galaxy', 'universe', 'cosmic',
      'astronaut', 'rocket', 'satellite', 'mars', 'earth', 'sky'
    ],
    sports: [
      'sports', 'game', 'team', 'player', 'win', 'lose', 'championship',
      'football', 'basketball', 'baseball', 'soccer', 'tennis', 'golf'
    ],
    music: [
      'music', 'song', 'band', 'singer', 'guitar', 'piano', 'drum',
      'concert', 'album', 'melody', 'rhythm', 'rock', 'jazz', 'blues'
    ]
  };
  
  return themeQueries[theme] || [theme];
}

// Rank suggestions based on relevance
function rankSuggestions(suggestions, analysis, existingAnalysis) {
  return suggestions.map(song => {
    let score = song.confidence || 0.5;
    
    // Boost score for popularity
    if (song.popularity) {
      score += (song.popularity / 100) * 0.2;
    }
    
    // Boost score if artist appears in existing songs
    if (existingAnalysis.artists.some(artist => 
      song.artist.toLowerCase().includes(artist) || artist.includes(song.artist.toLowerCase())
    )) {
      score += 0.3;
    }
    
    // Boost score for common words in title
    if (existingAnalysis.commonWords.some(word => 
      song.name.toLowerCase().includes(word)
    )) {
      score += 0.2;
    }
    
    // Boost score for genre matches in song name
    analysis.genres.forEach(genre => {
      if (song.name.toLowerCase().includes(genre) || song.artist.toLowerCase().includes(genre)) {
        score += 0.1;
      }
    });
    
    return { ...song, score };
  }).sort((a, b) => b.score - a.score);
}

// Resume playback endpoint
app.post('/api/spotify/resume', async (req, res) => {
  try {
    const { deviceId } = req.body;
    
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    console.log(`▶️ Resuming playback on device: ${deviceId}`);
    
    await spotifyForRequest(req).ensureValidToken();
    await spotifyForRequest(req).resumePlayback(deviceId);
    
    console.log('✅ Playback resumed successfully');
    res.json({ success: true, message: 'Playback resumed' });
  } catch (error) {
    console.error('❌ Error resuming playback:', error);
    res.status(500).json({ error: 'Failed to resume playback' });
  }
});

// Keep device active with periodic activation
function startDeviceKeepAlive() {
  console.log('🔋 Starting device keep-alive (every 5 minutes)...');
  
  setInterval(async () => {
    try {
      if (spotifyTokens && spotifyTokens.accessToken) {
        await spotifyServiceDefault.ensureValidToken();
        
        // Only activate device if no active games are playing (to avoid interrupting songs)
        const hasActiveGames = Array.from(rooms.values()).some(room => room.gameState === 'playing');
        if (!hasActiveGames) {
        await activatePreferredDevice();
        } else {
          console.log('🎵 Skipping device activation - games are actively playing');
        }
      }
    } catch (error) {
      console.log('⚠️ Device keep-alive failed (this is normal if no active session)');
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}

// Start the server
const PORT = process.env.PORT || 7093;
server.listen(PORT, async () => {
  console.log(`🎵 TEMPO - Music Bingo server running on port ${PORT}`);
  console.log('🎮 Ready for some musical bingo action!');
  console.log('🚀 Cache-busting fix deployed - version 2.0');
  
  // Initialize database
  await initializeDatabase();

  if (db) {
    try {
      const r = await db.query('SELECT id FROM users WHERE organization_id IS NOT NULL');
      for (const row of r.rows) {
        await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, row.id);
      }
    } catch (e) {
      console.error('Startup tenant Spotify prime:', e?.message || e);
    }
  }

  if (usersStore.isApprovedHostsOnlyMode()) {
    console.log(
      '🔒 TEMPO_APPROVED_HOSTS_ONLY: only allowlisted emails may sign in as hosts, create rooms, or join as host (see TEMPO_HOST_ALLOWLIST_EMAILS + host_allowlist).'
    );
  }

  // Auto-connect to Spotify
  await autoConnectSpotify();
  
  // Start device keep-alive
  startDeviceKeepAlive();
});

// Auto-connect to Spotify on server startup (SIMPLIFIED FOR TONIGHT)
async function autoConnectSpotify() {
  console.log('🔄 Attempting automatic Spotify connection (single-tenant mode)...');
  
  try {
    // Use DEFAULT organization for everyone
    const defaultTokens = multiTenantSpotify.getTokens('DEFAULT');
    if (defaultTokens && defaultTokens.accessToken && defaultTokens.refreshToken) {
      try {
        const defaultService = multiTenantSpotify.getService('DEFAULT');
        await defaultService.ensureValidToken();
        console.log('✅ Restored DEFAULT Spotify connection from saved tokens');
        
        // Activate preferred device
        await activatePreferredDevice();
        console.log('🎵 Ready to serve playlists and control playback');
        return true;
      } catch (error) {
        console.log('❌ DEFAULT tokens are invalid, clearing...');
        multiTenantSpotify.clearOrgTokens('DEFAULT');
      }
    }
    
    console.log('⚠️ Manual Spotify connection required');
    return false;
  } catch (error) {
    console.error('❌ Error in auto-connect:', error);
    return false;
  }
}

// Activate the preferred device automatically
async function activatePreferredDevice() {
  try {
    console.log('🔧 Activating preferred device...');
    
    // Get available devices
    const devices = await spotifyServiceDefault.getUserDevices();
    const savedDevice = loadSavedDevice();
    
    if (devices.length === 0) {
      console.log('⚠️ No devices available, will activate when needed');
      return;
    }
    
    // Try to use saved device first, then any available device
    let targetDevice = null;
    if (savedDevice) {
      targetDevice = devices.find(d => d.id === savedDevice.id);
      if (targetDevice) {
        console.log(`🎯 Found saved device: ${targetDevice.name}`);
      }
    }
    
    // If saved device not found, use first available
    if (!targetDevice && devices.length > 0) {
      targetDevice = devices[0];
      console.log(`🎯 Using first available device: ${targetDevice.name}`);
    }
    
    if (targetDevice) {
      // Assert control on the device without starting playback
      try {
        await spotifyServiceDefault.transferPlayback(targetDevice.id, false);
        try { await spotifyServiceDefault.setShuffleState(false, targetDevice.id); } catch (_) {}
        try { await spotifyServiceDefault.setRepeatState('off', targetDevice.id); } catch (_) {}
        console.log(`✅ Asserted control on device without playback: ${targetDevice.name}`);
          } catch (error) {
        console.log(`⚠️ Could not assert control on ${targetDevice.name}, but device is available`);
      }
    }
  } catch (error) {
    console.error('❌ Error activating preferred device:', error);
  }
} 

