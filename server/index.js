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
const hostRoomPrepStore = require('./hostRoomPrep');
const venueLogoCache = require('./venueLogoCache');
const credentialCrypto = require('./credentialCrypto');
const spotifyPipelineLog = require('./spotifyPipelineLog');
const catalogSpotify = require('./catalogSpotify');
const youtubeMusic = require('./youtubeMusic');
const { applyYoutubeCatalogTrackVerification } = require('./youtubeTrackCatalogVerify');

/** Host-facing bingo patterns; `blackout` incoming values normalize to `full_card`. */
const ALLOWED_BINGO_PATTERNS = new Set([
  'line',
  'four_corners',
  'x',
  'full_card',
  'blackout',
  't',
  'l',
  'u',
  'plus',
  'custom',
  'composite',
]);

function canonicalHostBingoPattern(pattern) {
  return pattern === 'blackout' ? 'full_card' : pattern;
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
  routineServerLog('🗄️ Database connection initialized');
} else {
  routineServerLog('⚠️ No DATABASE_URL found - using file-based storage (not persistent on Railway)');
}

/** When MISSION_CRITICAL_LOGS=1 (or true), suppress routine logs; keep console.error and Spotify [SPOTIFY_429_DIAGNOSTIC]. */
function missionCriticalLogsOnly() {
  const v = process.env.MISSION_CRITICAL_LOGS;
  return v === '1' || String(v || '').toLowerCase() === 'true';
}

function routineServerLog(...args) {
  if (missionCriticalLogsOnly()) return;
  console.log(...args);
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
    if (this.quietMode || missionCriticalLogsOnly()) return;
    if (throttleKey && !this.throttle(throttleKey, maxPerMinute)) return;
    routineServerLog(message);
  }

  // Debug logs are suppressed in production unless explicitly enabled
  debug(message, throttleKey = null, maxPerMinute = 5) {
    if (missionCriticalLogsOnly()) return;
    if (this.isProduction && !process.env.DEBUG) return;
    if (throttleKey && !this.throttle(throttleKey, maxPerMinute)) return;
    routineServerLog(`[DEBUG] ${message}`);
  }

  // Info logs are throttled more aggressively in production
  info(message, throttleKey = null, maxPerMinute = 10) {
    if (missionCriticalLogsOnly()) return;
    const limit = this.isProduction ? Math.min(maxPerMinute, 5) : maxPerMinute;
    if (throttleKey && !this.throttle(throttleKey, limit)) return;
    routineServerLog(message);
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

  routineServerLog('✅ Environment validation passed');
}

// Validate environment before starting
validateEnvironment();
if (spotifyPipelineLog.isEnabled()) {
  routineServerLog(
    '📣 TEMPO_SPOTIFY_PIPELINE_LOG: ON — structured logs for host user → org credentials → tokens → Spotify (no secrets).'
  );
  if (spotifyPipelineLog.isWebApiLogEnabled()) {
    routineServerLog('📣 TEMPO_SPOTIFY_LOG_WEBAPI: ON — logs each api.spotify.com path + HTTP status (verbose).');
  }
}

const app = express();
// Logging verbosity
const VERBOSE = process.env.VERBOSE_LOGS === '1' || process.env.DEBUG === '1';
const QUIET_MODE = process.env.QUIET_MODE === '1'; // Reduce logging for production
const server = http.createServer(app);
const clientBuildPath = path.join(__dirname, '..', 'client', 'build');
const hasClientBuild = fs.existsSync(clientBuildPath);
routineServerLog('NODE_ENV:', process.env.NODE_ENV, 'Client build exists:', hasClientBuild, 'at', clientBuildPath);

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
    routineServerLog('🔓 CORS: Allowing ALL origins (*)');
  } else {
    routineServerLog('🔒 CORS: Restricting to origins:', corsAllowedOrigins);
  }
}

const io = socketIo(server, {
  cors: {
    origin: allowAllCors ? '*' : corsAllowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware — allow Synapse (and self) to embed this app in an iframe; rely on CSP, not X-Frame-Options
// (default helmet SAMEORIGIN blocks cross-origin parents even if CSP allows them).
const helmetCspDirectives = {
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
};
delete helmetCspDirectives['frame-ancestors'];
helmetCspDirectives.frameAncestors = ["'self'", 'https://synapse.liquidkourage.com'];

// YouTube IFrame API + embedded player (host playback for YouTube Music tracks)
helmetCspDirectives['script-src'] = [
  ...(helmetCspDirectives['script-src'] || ["'self'"]),
  'https://www.youtube.com',
  'https://s.ytimg.com',
];
helmetCspDirectives['frame-src'] = [
  "'self'",
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
];
helmetCspDirectives['img-src'] = [
  ...(helmetCspDirectives['img-src'] || ["'self'"]),
  'https://i.ytimg.com',
  'https://yt3.ggpht.com',
  // Venue / corporate branding: hosts paste arbitrary logo URLs in Admin
  'https:',
  'data:',
];

app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: {
      directives: helmetCspDirectives,
    },
  }),
);
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
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
app.use(express.static('public'));
venueLogoCache.registerVenueLogoRoutes(app);

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
      routineServerLog('🌍 Loaded Spotify tokens from environment variables');
      return {
        accessToken: process.env.SPOTIFY_ACCESS_TOKEN,
        refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
        expiresIn: 3600 // Default 1 hour, will be refreshed automatically
      };
    }
    
    // Fallback to file (for local development)
    if (fs.existsSync(TOKEN_FILE)) {
      const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      routineServerLog('📁 Loaded Spotify tokens from file');
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
    routineServerLog('🚀 To persist Spotify tokens across Railway deployments, set these environment variables:');
    routineServerLog(`   SPOTIFY_ACCESS_TOKEN=${tokens.accessToken}`);
    routineServerLog(`   SPOTIFY_REFRESH_TOKEN=${tokens.refreshToken}`);
    routineServerLog('   Add these in your Railway project settings under "Variables"');
    
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
    routineServerLog('💾 Saved device to file:', device.name);
  } catch (error) {
    console.error('❌ Error saving device to file:', error);
  }
}

function saveDeviceForUser(uid, device) {
  try {
    const file = deviceFileForUserId(uid);
    fs.writeFileSync(file, JSON.stringify(device, null, 2), 'utf8');
    routineServerLog(`💾 Saved device for host user ${uid}:`, device.name);
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
    routineServerLog(`🔍 TIMER CLEARED - Room: ${roomId}, Time: ${currentTime}`);
    routineServerLog(`🔍 Reason: Manual interruption (skip/pause/previous)`);
    routineServerLog(`🔍 Current Song: ${room?.currentSong?.name} by ${room?.currentSong?.artist}`);
    routineServerLog(`🔍 Stack trace:`, new Error().stack?.split('\n').slice(1, 4).join('\n'));
    }
    
    clearTimeout(roomTimers.get(roomId));
    roomTimers.delete(roomId);
    routineServerLog(`⏰ Cleared timer for room: ${roomId}`);
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
    routineServerLog(`🔍 TIMER FIRED - Room: ${roomId}, Time: ${currentTime}, Expected Duration: ${delay}ms, Actual Duration: ${actualDelay}ms`);
    routineServerLog(`🔍 Room State - GameState: ${room?.gameState}, CurrentSongIndex: ${room?.currentSongIndex}, TotalSongs: ${room?.playlistSongs?.length}`);
    routineServerLog(`🔍 Current Song - ${room?.currentSong?.name} by ${room?.currentSong?.artist}`);
    routineServerLog(`🔍 Room exists: ${!!room}, Room ID: ${room?.id}`);
    }
    
    roomTimers.delete(roomId);
    if (VERBOSE) routineServerLog(`🔍 About to execute callback for room ${roomId}`);
    callback();
    if (VERBOSE) routineServerLog(`🔍 Callback executed for room ${roomId}`);
  }, actualDelay);
  
  roomTimers.set(roomId, timerId);
  routineServerLog(`⏰ Set timer for room ${roomId}: ${actualDelay}ms (${actualDelay/1000}s)`);
}

// Play song at specific index without changing the index
async function playSongAtIndex(roomId, deviceId, songIndex) {
  routineServerLog(`🎵 Playing song at index ${songIndex} for room:`, roomId);
  const room = rooms.get(roomId);
  if (!room || room.gameState !== 'playing' || !room.playlistSongs) {
    routineServerLog('❌ Cannot play song: Room not in playing state or no playlist songs');
    return;
  }

  try {
    const song = room.playlistSongs[songIndex];
    routineServerLog(`🎵 Playing song ${songIndex + 1}/${room.playlistSongs.length}: ${song.name} by ${song.artist}`);

    if (songUsesYoutubePlayback(song)) {
      const startMs = computeSnippetRandomStartMs(room, song);
      room.currentSongStartMs = startMs;
      room.currentSong = {
        id: song.id,
        name: song.name,
        artist: song.artist,
        explicit: song.explicit === true,
        youtubeMusic: true,
      };
      try {
        const r = rooms.get(roomId);
        if (r) r.songStartAtMs = Date.now() - (startMs || 0);
      } catch {}
      io.to(roomId).emit('song-playing', buildSongPlayingPayload(room, song, songIndex));
      sendPlayerCardUpdates(roomId, true);
      routineServerLog(`✅ YouTube snippet (host browser): ${song.name}`);
      const saved = loadSavedDeviceForRoom(roomId);
      const dev = deviceId || (saved && saved.id) || '';
      startSimpleProgression(roomId, dev, room.snippetLength);
      return;
    }

    // STRICT device control: use provided device or saved device only
    let targetDeviceId = deviceId;
    if (!targetDeviceId) {
      const savedDevice = loadSavedDeviceForRoom(roomId);
      if (savedDevice) {
        targetDeviceId = savedDevice.id;
        routineServerLog(`🎵 Using saved device for song: ${savedDevice.name}`);
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
    routineServerLog(`🎵 Starting playback on device: ${targetDeviceId}`);

    try {
      const startTime = Date.now();
      routineServerLog(`🎵 Starting playback at ${startTime} - Song: ${song.name} by ${song.artist}`);
      // Enforce deterministic playback mode for direct index plays
      try { await spotifyFor(roomId).setShuffleState(false, targetDeviceId); } catch (_) {}
      try { await spotifyFor(roomId).setRepeatState('off', targetDeviceId); } catch (_) {}
      const startMs = computeSpotifySnippetRandomStartMs(room, song, 'playSongAtIndex');
      await spotifyFor(roomId).startPlayback(targetDeviceId, [`spotify:track:${song.id}`], startMs);
      const endTime = Date.now();
      routineServerLog(`✅ Successfully started playback on device: ${targetDeviceId} (took ${endTime - startTime}ms)`);
      
      // Stabilization delay to prevent context hijacks from volume changes
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Set initial volume to 100% (or room's saved volume) with single retry
        try {
          const initialVolume = room.volume || 100;
        await spotifyFor(roomId).withRetries('setVolume(index)', () => spotifyFor(roomId).setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
        routineServerLog(`🔊 Set initial volume to ${initialVolume}%`);
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

    routineServerLog(`✅ Playing song in room ${roomId}: ${song.name} by ${song.artist} on device ${targetDeviceId}`);

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
      const credDesc =
        credentialOverride === undefined
          ? 'unprimed_map_uses_env'
          : credentialOverride === null
            ? 'primed_no_org_row_uses_env'
            : 'organizations_table_client';
      const newClientPrefix =
        credentialOverride && credentialOverride.clientId
          ? spotifyPipelineLog.clientIdPrefix(credentialOverride.clientId)
          : spotifyPipelineLog.clientIdPrefix(process.env.SPOTIFY_CLIENT_ID);
      if (spotifyPipelineLog.isEnabled()) {
        spotifyPipelineLog.log('spotify_service_constructed', {
          organization_id: organizationId,
          host_user_id: uid != null ? String(uid) : 'n/a',
          credential_path: credDesc,
          client_id_prefix: newClientPrefix,
        });
      }
      const service = new SpotifyService(credentialOverride);
      this.orgServices.set(organizationId, service);
      // Tokens are applied via setTokens() after OAuth, or ensureOrgTokensLoaded() from DB.
      // Do NOT call async loadOrgTokens here without await (would store a Promise in orgTokens).
    }
    const service = this.orgServices.get(organizationId);
    // After invalidateUserService, the new SpotifyService has no tokens even though orgTokens may still hold them.
    const tok = this.orgTokens.get(organizationId);
    if (tok && tok.accessToken && (!service.accessToken || !service.refreshToken)) {
      if (spotifyPipelineLog.isEnabled()) {
        spotifyPipelineLog.log('spotify_service_rehydrate_tokens', {
          organization_id: organizationId,
          has_access_token: '1',
          has_refresh_token: tok.refreshToken ? '1' : '0',
        });
      }
      service.setTokens(tok.accessToken, tok.refreshToken);
    }
    return service;
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
    if (tok && tok.accessToken) {
      if (spotifyPipelineLog.isEnabled()) {
        spotifyPipelineLog.log('org_tokens_in_memory', { organization_id: organizationId, source: 'cache' });
      }
      return true;
    }
    if (spotifyPipelineLog.isEnabled()) {
      spotifyPipelineLog.log('org_tokens_load_start', { organization_id: organizationId, source: 'db_or_env' });
    }
    const loaded = await this.loadOrgTokens(organizationId);
    if (!loaded || !loaded.accessToken) {
      if (spotifyPipelineLog.isEnabled()) {
        spotifyPipelineLog.log('org_tokens_load_miss', { organization_id: organizationId });
      }
      return false;
    }
    if (spotifyPipelineLog.isEnabled()) {
      spotifyPipelineLog.log('org_tokens_load_ok', {
        organization_id: organizationId,
        has_refresh: loaded.refreshToken ? '1' : '0',
      });
    }
    await this.setTokens(organizationId, loaded);
    return true;
  }
  
  getTokens(organizationId = this.defaultOrg) {
    return this.orgTokens.get(organizationId);
  }

  /** Org keys that currently have an access token (for failsafe / bulk clear). */
  getOrganizationIdsWithStoredTokens() {
    const out = [];
    for (const [k, v] of this.orgTokens.entries()) {
      if (v && v.accessToken) out.push(k);
    }
    return out;
  }
  
  async setTokens(organizationId, tokens) {
    this.orgTokens.set(organizationId, tokens);
    if (spotifyPipelineLog.isEnabled()) {
      spotifyPipelineLog.log('org_tokens_set', {
        organization_id: organizationId,
        has_access_token: tokens && tokens.accessToken ? '1' : '0',
        has_refresh_token: tokens && tokens.refreshToken ? '1' : '0',
        persist: 'db',
      });
    }
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
        routineServerLog(`🌍 Loaded Spotify tokens for ${organizationId} from environment variables`);
        const tokens = {
          accessToken,
          refreshToken,
          expiresIn: 3600
        };
        
        // Migrate to database for future persistence
        await saveTokensToDatabase(organizationId, tokens);
        routineServerLog(`🔄 Migrated ${organizationId} tokens to database`);
        
        return tokens;
      }
      
      // Fallback to file (for local development)
      const tokenFile = organizationId === this.defaultOrg ? 
        TOKEN_FILE : 
        path.join(__dirname, `spotify_tokens_${organizationId.toLowerCase()}.json`);
        
      if (fs.existsSync(tokenFile)) {
        const tokenData = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
        routineServerLog(`📁 Loaded Spotify tokens for ${organizationId} from file`);
        
        // Migrate to database for future persistence
        await saveTokensToDatabase(organizationId, tokenData);
        routineServerLog(`🔄 Migrated ${organizationId} tokens from file to database`);
        
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
        routineServerLog(`✅ Tokens for ${organizationId} saved to database - will persist across deployments`);
      } else {
        // Fallback to file (for local development)
        const tokenFile = organizationId === this.defaultOrg ? 
          TOKEN_FILE : 
          path.join(__dirname, `spotify_tokens_${organizationId.toLowerCase()}.json`);
          
        fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), 'utf8');
        routineServerLog(`📁 Tokens for ${organizationId} saved to file (local development only)`);
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
          routineServerLog(`✅ Removed token file for ${organizationId}`);
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
    await hostRoomPrepStore.ensureHostRoomPrepTable(db);
    await db.query(`
      CREATE TABLE IF NOT EXISTS host_spotify_playlist_list_cache (
        organization_id VARCHAR(50) PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS catalog_pack_summaries_cache (
        cache_key VARCHAR(128) PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    routineServerLog('✅ Database tables initialized');
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
    
    routineServerLog(`💾 Saved Spotify tokens for ${organizationId} to database`);
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
      routineServerLog(`📁 Loaded Spotify tokens for ${organizationId} from database`);
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
    routineServerLog(`🗑️ Deleted Spotify tokens for ${organizationId} from database`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to delete tokens for ${organizationId}:`, error);
    return false;
  }
}

function parseSpotifyPlaylistIdFromUserInput(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const mUrl = s.match(/playlist\/([a-zA-Z0-9]+)/);
  if (mUrl) return mUrl[1];
  const mUri = s.match(/spotify:playlist:([a-zA-Z0-9]+)/i);
  if (mUri) return mUri[1];
  if (/^[a-zA-Z0-9]{8,}$/.test(s) && !s.includes('/') && !s.includes(':')) {
    return s;
  }
  return null;
}

async function saveHostPlaylistListCache(organizationId, { playlists, spotifyListTotal }) {
  if (!db) return false;
  try {
    const payload = {
      playlists: Array.isArray(playlists) ? playlists : [],
      spotifyListTotal: spotifyListTotal != null && Number.isFinite(spotifyListTotal) ? spotifyListTotal : null,
    };
    await db.query(
      `
      INSERT INTO host_spotify_playlist_list_cache (organization_id, data, updated_at)
      VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (organization_id) DO UPDATE SET data = $2::jsonb, updated_at = CURRENT_TIMESTAMP
    `,
      [organizationId, JSON.stringify(payload)]
    );
    return true;
  } catch (e) {
    console.error('saveHostPlaylistListCache:', e?.message || e);
    return false;
  }
}

async function loadHostPlaylistListCache(organizationId) {
  if (!db) return null;
  try {
    const r = await db.query(
      'SELECT data, updated_at FROM host_spotify_playlist_list_cache WHERE organization_id = $1',
      [organizationId]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    const d = row.data;
    if (!d || typeof d !== 'object') return null;
    const playlists = Array.isArray(d.playlists) ? d.playlists : [];
    const st = d.spotifyListTotal;
    const spotifyListTotal = typeof st === 'number' && st >= 0 ? st : null;
    return {
      playlists,
      spotifyListTotal,
      updatedAt: row.updated_at,
    };
  } catch (e) {
    console.error('loadHostPlaylistListCache:', e?.message || e);
    return null;
  }
}

/** TTL for Postgres snapshot of official catalog packs (`TEMPO_CATALOG_PACKS_SERVER_CACHE_MS`). Default 7d; 0 = always fetch live (still use stale row on hard errors). */
function readCatalogPacksServerCacheTtlMs() {
  const raw = process.env.TEMPO_CATALOG_PACKS_SERVER_CACHE_MS;
  if (raw === '0') return 0;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  return 7 * 86400000;
}

/** Optional background refresh interval for Postgres catalog pack snapshots (`TEMPO_CATALOG_PACKS_BACKGROUND_WARM_MS`). Minimum 300000 (5m); unset or lower disables. */
function readCatalogPacksBackgroundWarmIntervalMs() {
  const raw = process.env.TEMPO_CATALOG_PACKS_BACKGROUND_WARM_MS;
  if (raw == null || String(raw).trim() === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 300000) return 0;
  return Math.floor(n);
}

/**
 * @returns {Promise<null | { data: { packs: unknown[], catalogPrefixDiscoverySkipped: boolean }, updatedAtMs: number, updatedAtIso: string }>}
 */
async function loadCatalogPackSummariesCacheRow(cacheKey) {
  if (!db) return null;
  try {
    const r = await db.query(
      'SELECT data, updated_at FROM catalog_pack_summaries_cache WHERE cache_key = $1',
      [cacheKey]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    const d = row.data;
    if (!d || typeof d !== 'object') return null;
    const packs = Array.isArray(d.packs) ? d.packs : [];
    const catalogPrefixDiscoverySkipped = d.catalogPrefixDiscoverySkipped === true;
    const updatedAt = row.updated_at;
    const updatedAtMs = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
    const updatedAtIso =
      updatedAt instanceof Date ? updatedAt.toISOString() : new Date(updatedAt).toISOString();
    return {
      data: { packs, catalogPrefixDiscoverySkipped },
      updatedAtMs,
      updatedAtIso,
    };
  } catch (e) {
    console.error('loadCatalogPackSummariesCacheRow:', e?.message || e);
    return null;
  }
}

async function saveCatalogPackSummariesCacheRow(cacheKey, payload) {
  if (!db) return false;
  try {
    await db.query(
      `
      INSERT INTO catalog_pack_summaries_cache (cache_key, data, updated_at)
      VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (cache_key) DO UPDATE SET data = $2::jsonb, updated_at = CURRENT_TIMESTAMP
    `,
      [cacheKey, JSON.stringify(payload)]
    );
    return true;
  } catch (e) {
    console.error('saveCatalogPackSummariesCacheRow:', e?.message || e);
    return false;
  }
}

/**
 * Persist live catalog pack summaries to Postgres using the same rules as GET /api/spotify/catalog/packs.
 * @returns {Promise<boolean>} true if a row was written
 */
async function persistCatalogPackSummariesToPostgresIfAllowed(catalogResult) {
  if (!db || !catalogResult || !Array.isArray(catalogResult.packs)) return false;
  const ttlMs = readCatalogPacksServerCacheTtlMs();
  const prefixSkipped = catalogResult.catalogPrefixDiscoverySkipped === true;
  const wipeWouldErasePrior = catalogResult.packs.length === 0 && prefixSkipped && ttlMs > 0;
  if (wipeWouldErasePrior) return false;
  const cacheKey = catalogSpotify.getCatalogPackSummariesCacheKey();
  await saveCatalogPackSummariesCacheRow(cacheKey, {
    packs: catalogResult.packs,
    catalogPrefixDiscoverySkipped: prefixSkipped,
  });
  return true;
}

// Initialize Multi-Tenant Spotify Manager
const multiTenantSpotify = new MultiTenantSpotifyManager();

// Backward compatibility - initialize default organization
(async () => {
  const defaultTokens = loadTokens();
  if (defaultTokens) {
    await multiTenantSpotify.setTokens('DEFAULT', defaultTokens);
    routineServerLog('✅ Restored default Spotify connection from saved tokens');
  }
})();

// Legacy support - DEFAULT org (no host user on room)
const spotifyServiceDefault = multiTenantSpotify.getService('DEFAULT');
let spotifyTokens = multiTenantSpotify.getTokens('DEFAULT');

const spotifyWebApiMeter = require('./spotifyWebApiMeter');
spotifyWebApiMeter.setFailsafeHandler(async (info) => {
  const orgIds = multiTenantSpotify.getOrganizationIdsWithStoredTokens();
  console.error(
    `🛡️ TEMPO_SPOTIFY_FAILSAFE: ~${info.count30s} Spotify Web API calls in the last 30s (threshold ${info.max}). Clearing all in-memory and stored host tokens to protect the developer app.`
  );
  for (const orgId of orgIds) {
    try {
      await multiTenantSpotify.clearOrgTokens(orgId);
      if (db && orgId.startsWith('user_')) {
        try {
          await db.query('DELETE FROM host_spotify_playlist_list_cache WHERE organization_id = $1', [orgId]);
        } catch (e) {
          console.error('TEMPO_SPOTIFY_FAILSAFE playlist list cache delete:', e?.message || e);
        }
      }
      const u = parseUserIdFromSpotifyOrgKey(orgId);
      if (u != null) {
        try {
          const f = deviceFileForUserId(u);
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch (_) {}
      }
    } catch (e) {
      console.error('TEMPO_SPOTIFY_FAILSAFE clear org', orgId, e);
    }
  }
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch (_) {}
  spotifyTokens = multiTenantSpotify.getTokens('DEFAULT');
  try {
    io.emit('spotify-failsafe', {
      message:
        'Spotify was disconnected automatically: very high API traffic in the last 30 seconds. Reconnect Spotify from the host when you are ready.',
      count30s: info.count30s,
      max: info.max,
      reason: 'web_api_30s_burst',
    });
  } catch (e) {
    console.error('TEMPO_SPOTIFY_FAILSAFE socket emit', e);
  }
});

function spotifyOrgForRoom(room) {
  if (!room) return 'DEFAULT';
  if (room.ownerUserId != null && Number.isFinite(Number(room.ownerUserId))) return `user_${room.ownerUserId}`;
  return room.organizationId || 'DEFAULT';
}

function spotifyFor(roomId) {
  const room = rooms.get(roomId);
  return multiTenantSpotify.getService(spotifyOrgForRoom(room));
}

/** True when playback uses host browser YouTube iframe (not Spotify Web API transport). */
function songUsesYoutubePlayback(song) {
  return !!(song && song.youtubeMusic === true);
}

/** Spotify track ids are 22-char base62; YouTube video ids are often 11 chars. */
function looksLikeSpotifyTrackId(id) {
  const s = String(id || '');
  return s.length === 22 && /^[a-zA-Z0-9]{22}$/.test(s);
}

function looksLikeYoutubeVideoId(id) {
  const s = String(id || '');
  return s.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(s);
}

/**
 * Host payloads sometimes omit `youtubeMusic` on tracks; 5x15 card generation also replaces
 * finalizedSongOrder with ids only. Recover flags from playlist rows and/or id shape.
 */
function applyYoutubePlaybackHints(playlists, songs) {
  if (!Array.isArray(songs) || songs.length === 0) return songs;
  const ytPlaylistIds = new Set(
    (Array.isArray(playlists) ? playlists : [])
      .filter((p) => p && p.youtubeMusic === true)
      .map((p) => String(p.id))
  );
  let tagged = 0;
  const out = songs.map((s) => {
    if (!s || s.youtubeMusic === true) return s;
    const pid = s.sourcePlaylistId != null ? String(s.sourcePlaylistId) : '';
    if (pid && ytPlaylistIds.has(pid)) {
      tagged++;
      return { ...s, youtubeMusic: true };
    }
    if (!looksLikeSpotifyTrackId(s.id) && looksLikeYoutubeVideoId(s.id)) {
      tagged++;
      return { ...s, youtubeMusic: true };
    }
    return s;
  });
  if (tagged > 0) {
    routineServerLog(`🎬 Tagged ${tagged} song row(s) as YouTube playback (playlist metadata and/or id shape)`);
  }
  return out;
}

const DEFAULT_LETTER_REVEAL_INTERVAL_SEC = 15;
const MIN_LETTER_REVEAL_INTERVAL_SEC = 5;
const MAX_LETTER_REVEAL_INTERVAL_SEC = 120;

function clampLetterRevealIntervalSec(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_LETTER_REVEAL_INTERVAL_SEC;
  return Math.min(MAX_LETTER_REVEAL_INTERVAL_SEC, Math.max(MIN_LETTER_REVEAL_INTERVAL_SEC, n));
}

function letterRevealIntervalSecForRoom(room) {
  return clampLetterRevealIntervalSec(room?.letterRevealIntervalSec ?? DEFAULT_LETTER_REVEAL_INTERVAL_SEC);
}

const DEFAULT_PUBLIC_DISPLAY_TITLE_REVEAL_MODE = 'letter';

/** How projector shows song titles: letter-by-letter, full at clip start, or full at clip end. */
function publicDisplayTitleRevealModeForRoom(room) {
  const m = String(room?.publicDisplayTitleRevealMode || '').toLowerCase().replace(/-/g, '_');
  if (m === 'track_start' || m === 'beginning' || m === 'start') return 'track_start';
  if (m === 'track_end' || m === 'end') return 'track_end';
  return DEFAULT_PUBLIC_DISPLAY_TITLE_REVEAL_MODE;
}

const YOUTUBE_FALLBACK_DURATION_MS = 10 * 60 * 1000;

function computeSnippetRandomStartMs(room, song) {
  if (!room.randomStarts || room.randomStarts === 'none') return 0;
  const snippetMs = (room.snippetLength || 30) * 1000;
  const bufferMs = 1500;
  const durationMs =
    Number.isFinite(song.duration) && Number(song.duration) > 0
      ? Math.max(0, Number(song.duration))
      : YOUTUBE_FALLBACK_DURATION_MS;
  let startMs = 0;
  if (room.randomStarts === 'early') {
    const maxStartMs = 90000;
    const safeWindow = Math.min(maxStartMs, Math.max(0, durationMs - snippetMs - bufferMs));
    if (safeWindow > 3000) startMs = Math.floor(Math.random() * safeWindow);
  } else if (room.randomStarts === 'random') {
    const safeWindow = Math.max(0, durationMs - snippetMs - bufferMs - 30000);
    if (safeWindow > 3000) startMs = Math.floor(Math.random() * safeWindow);
  }
  return startMs;
}

/**
 * Spotify rows in room.playlistSongs often omit `duration` after ID-only finalized reorder merges.
 * Use duration_ms when present, then duration, then the same fallback as YouTube snippet math.
 */
function resolveSpotifyTrackDurationMsForRandomStart(song, contextLabel) {
  const raw = song && (song.duration_ms != null ? song.duration_ms : song.duration);
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  routineServerLog(
    `⚠️ Random start (${contextLabel || 'spotify'}): missing/zero duration on "${song?.name || song?.id || '?'}" (raw=${raw}) — using ${YOUTUBE_FALLBACK_DURATION_MS}ms fallback for offset math`
  );
  return YOUTUBE_FALLBACK_DURATION_MS;
}

/** Randomized start offset (ms) for Spotify transport — mirrors early/full-track logic with resilient duration. */
function computeSpotifySnippetRandomStartMs(room, song, contextLabel) {
  if (!room.randomStarts || room.randomStarts === 'none') return 0;
  const snippetMs = (room.snippetLength || 30) * 1000;
  const bufferMs = 1500;
  const durationMs = resolveSpotifyTrackDurationMsForRandomStart(song, contextLabel);
  let startMs = 0;
  if (room.randomStarts === 'early') {
    const maxStartMs = 90000;
    const safeWindow = Math.min(maxStartMs, Math.max(0, durationMs - snippetMs - bufferMs));
    if (safeWindow > 3000) startMs = Math.floor(Math.random() * safeWindow);
  } else if (room.randomStarts === 'random') {
    const safeWindow = Math.max(0, durationMs - snippetMs - bufferMs - 30000);
    if (safeWindow > 3000) startMs = Math.floor(Math.random() * safeWindow);
  }
  return startMs;
}

function buildSongPlayingPayload(room, song, currentIndex) {
  const yt = songUsesYoutubePlayback(song);
  const startMs = room.currentSongStartMs || 0;
  const payload = {
    songId: song.id,
    songName: song.name,
    customSongName: customSongTitles.get(song.id) || cleanSongTitle(song.name),
    artistName: song.artist,
    explicit: song.explicit === true,
    snippetLength: room.snippetLength,
    currentIndex,
    totalSongs: room.playlistSongs.length,
    previewUrl: song.previewUrl || null,
    youtubeMusic: yt,
  };
  if (yt) {
    payload.youtubeVideoId = song.id;
    payload.startMs = startMs;
  }
  return payload;
}

/** Display titles for room-state: matches song-playing (host overrides + cleaned Spotify titles). */
function clientSongMetaFromPlaylistSong(foundSong) {
  if (!foundSong) return null;
  return {
    id: foundSong.id,
    name: foundSong.name,
    artist: foundSong.artist,
    customSongName: customSongTitles.get(foundSong.id) || cleanSongTitle(foundSong.name),
  };
}

function currentSongPayloadForRoomState(currentSong) {
  if (!currentSong || !currentSong.id) return currentSong || null;
  return {
    ...currentSong,
    customSongName:
      customSongTitles.get(currentSong.id) || cleanSongTitle(currentSong.name || ''),
  };
}

function syncRoomStateAfterSongStart(roomId, room) {
  const playedSongIds = Array.isArray(room.calledSongIds) ? [...room.calledSongIds] : [];
  if (room.currentSong && room.currentSong.id && !playedSongIds.includes(room.currentSong.id)) {
    playedSongIds.push(room.currentSong.id);
  }
  const syncPayload = {
    isPlaying: room.gameState === 'playing',
    pattern: room.pattern || 'line',
    customMask: Array.from(room.customPattern || []),
    patternComposite: patternCompositeForClient(room),
    ...patternExtrasForClient(room),
    currentSong: currentSongPayloadForRoomState(room.currentSong),
    snippetLength: room.snippetLength || 30,
    playerCount: getNonHostPlayerCount(room),
    gameState: room.gameState,
    winners: room.winners || [],
    roundWinners: room.roundWinners || [],
    publicDisplayFontSize: room.publicDisplayFontSize || 1.0,
    publicDisplayCallListMode: room.publicDisplayCallListMode || 'auto',
    letterRevealIntervalSec: letterRevealIntervalSecForRoom(room),
    publicDisplayTitleRevealMode: publicDisplayTitleRevealModeForRoom(room),
    venueBranding: venueBrandingForRoom(room),
    playedSongs: playedSongIds
      .map((songId) => {
        const foundSong = room.playlistSongs?.find((s) => s.id === songId);
        return clientSongMetaFromPlaylistSong(foundSong);
      })
      .filter(Boolean),
    playedSongIds,
    totalPlayedCount: playedSongIds.length,
    currentSongIndex: room.currentSongIndex || 0,
    totalSongs: room.playlistSongs?.length || 0,
    syncTimestamp: Date.now(),
  };
  io.to(roomId).emit('room-state', syncPayload);
  routineServerLog(`🔄 Synced room-state after song start: ${playedSongIds.length} played songs`);
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

      const idx = room.currentSongIndex;
      const activeSong =
        Array.isArray(room.playlistSongs) && typeof idx === 'number' && idx >= 0
          ? room.playlistSongs[idx]
          : null;
      if (songUsesYoutubePlayback(activeSong)) return;
      
      // Get current playback state to check device
      const spMon = spotifyFor(roomId);
      const state = await spMon.getCurrentPlaybackState();
      if (state == null && spMon._playbackNullDueToRateLimit) return;
      const currentDeviceId = state?.device?.id;
      
      // CRITICAL: Check if playback has switched to a different device
      if (targetDeviceId && currentDeviceId && currentDeviceId !== targetDeviceId) {
        console.warn(`⚠️ Device switch detected! Expected: ${targetDeviceId}, Got: ${currentDeviceId}. Transferring back...`);
        
        try {
          // Immediately transfer playback back to the correct device
          await spotifyFor(roomId).transferPlayback(targetDeviceId, false);
          routineServerLog(`✅ Transferred playback back to locked device: ${targetDeviceId}`);
          
          // Small delay then verify it worked
          await new Promise(resolve => setTimeout(resolve, 500));
          const verifyState = await spotifyFor(roomId).getCurrentPlaybackState();
          if (verifyState?.device?.id === targetDeviceId) {
            routineServerLog(`✅ Device lock restored successfully`);
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
        routineServerLog(`🔄 Track restart detected. Restoring original start position: ${room.currentSongStartMs}ms`);
        
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
  }, 12_000); // Polling /v1/me/player (was 6s; 12s cuts API volume ~in half, slower device-context detection)
  
  roomPlaybackWatchers.set(roomId, intervalId);
}

// NEW: Simple timer-based song progression - let timer control everything
function startSimpleProgression(roomId, deviceId, snippetLengthSeconds) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  routineServerLog(`⏰ Starting simple progression: ${snippetLengthSeconds}s per song`);
  
  // Clear any existing timer
  clearRoomTimer(roomId);
  
  // Start context monitor for hijack detection only
  startSimpleContextMonitor(roomId, deviceId);
  
  // Set timer for exact snippet duration
  setRoomTimer(roomId, async () => {
    routineServerLog(`⏰ Timer fired - advancing to next song`);
    
    // Immediately advance to next song (don't pause first to avoid dead air)
    await playNextSongSimple(roomId, deviceId);
  }, snippetLengthSeconds * 1000);
}

// NEW: Simplified song progression without complex verification
async function playNextSongSimple(roomId, deviceId) {
  routineServerLog('🎵 Simple next song for room:', roomId);
  const room = rooms.get(roomId);
  
  if (!room || room.gameState !== 'playing' || !room.playlistSongs) {
    routineServerLog('❌ Cannot advance: invalid room state');
    return;
  }

  // Check if we're at the end
  if (room.currentSongIndex + 1 >= room.playlistSongs.length) {
    routineServerLog('🏁 Playlist complete. Ending game.');
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
    routineServerLog('❌ No next song found');
    return;
  }

  if (songUsesYoutubePlayback(nextSong)) {
    const startMsYt = computeSnippetRandomStartMs(room, nextSong);
    room.currentSongStartMs = startMsYt;
    room.calledSongIds = Array.isArray(room.calledSongIds) ? room.calledSongIds : [];
    room.calledSongIds.push(nextSong.id);
    room.currentSong = {
      id: nextSong.id,
      name: nextSong.name,
      artist: nextSong.artist,
      explicit: nextSong.explicit === true,
      youtubeMusic: true,
    };
    try {
      const r = rooms.get(roomId);
      if (r) r.songStartAtMs = Date.now() - (startMsYt || 0);
    } catch {}
    io.to(roomId).emit('song-playing', buildSongPlayingPayload(room, nextSong, room.currentSongIndex));
    syncRoomStateAfterSongStart(roomId, room);
    sendPlayerCardUpdates(roomId, true);
    routineServerLog(`✅ Simple advance (YouTube): ${nextSong.name}`);
    startSimpleProgression(roomId, deviceId, room.snippetLength);
    return;
  }

  const startMs = computeSpotifySnippetRandomStartMs(room, nextSong, 'playNextSongSimple');

    // Track called song
    room.calledSongIds = Array.isArray(room.calledSongIds) ? room.calledSongIds : [];
    room.calledSongIds.push(nextSong.id);
    routineServerLog(`📝 SIMPLE PLAYBACK: Marked song as played: ${nextSong.name} (${nextSong.id}) - Total played: ${room.calledSongIds.length}`);
    routineServerLog(`📋 SIMPLE PLAYBACK: Current calledSongIds array:`, room.calledSongIds);

  // Update current song and store original start position
  room.currentSong = {
    id: nextSong.id,
    name: nextSong.name,
    artist: nextSong.artist,
    explicit: nextSong.explicit === true
  };
  room.currentSongStartMs = startMs; // Store for restart correction

  try {
    routineServerLog(`🎵 Starting playback for: ${nextSong.name} by ${nextSong.artist} at ${startMs}ms`);
    
    // Brief delay to ensure smooth transition without dead air
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Simple playlist playback with enhanced logging
    if (room.temporaryPlaylistId) {
      routineServerLog(`🎼 Using playlist context: ${room.temporaryPlaylistId}, track ${room.currentSongIndex}`);
      await spotifyFor(roomId).startPlaybackFromPlaylist(deviceId, room.temporaryPlaylistId, room.currentSongIndex, startMs);
    } else {
      routineServerLog(`🎵 Using individual track: ${nextSong.id}`);
      await spotifyFor(roomId).startPlayback(deviceId, [`spotify:track:${nextSong.id}`], startMs);
    }

    routineServerLog(`✅ Playback started successfully for: ${nextSong.name}`);

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
      patternComposite: patternCompositeForClient(room),
      ...patternExtrasForClient(room),
      currentSong: currentSongPayloadForRoomState(room.currentSong),
      snippetLength: room.snippetLength || 30,
      playerCount: getNonHostPlayerCount(room),
      gameState: room.gameState,
      winners: room.winners || [],
      roundWinners: room.roundWinners || [],
      publicDisplayFontSize: room.publicDisplayFontSize || 1.0,
      publicDisplayCallListMode: room.publicDisplayCallListMode || 'auto',
      letterRevealIntervalSec: letterRevealIntervalSecForRoom(room),
      publicDisplayTitleRevealMode: publicDisplayTitleRevealModeForRoom(room),
      venueBranding: venueBrandingForRoom(room),
      playedSongs: playedSongIds.map(songId => {
        const foundSong = room.playlistSongs?.find(s => s.id === songId);
        return clientSongMetaFromPlaylistSong(foundSong);
      }).filter(Boolean),
      playedSongIds: playedSongIds,
      totalPlayedCount: playedSongIds.length,
      currentSongIndex: room.currentSongIndex || 0,
      totalSongs: room.playlistSongs?.length || 0,
      syncTimestamp: Date.now()
    };
    
    io.to(roomId).emit('room-state', syncPayload);
    routineServerLog(`🔄 Synced room-state after song start: ${playedSongIds.length} played songs`);

    // Send real-time player card updates to host
    sendPlayerCardUpdates(roomId, true); // Immediate update on game start

    routineServerLog(`✅ Simple advance: ${nextSong.name} by ${nextSong.artist}`);

    // Start simple progression for next song
    startSimpleProgression(roomId, deviceId, room.snippetLength);

  } catch (error) {
    console.error('❌ Error in simple song advance:', error);
    console.error('❌ Error details:', error?.message, error?.body?.error);
    
    // Try to resume playback if it got stuck in paused state
    try {
      routineServerLog('🔄 Attempting to resume playback after song advance failure...');
      await spotifyFor(roomId).resumePlayback(deviceId);
      routineServerLog('✅ Resume attempt completed');
    } catch (resumeError) {
      console.warn('⚠️ Failed to resume playback:', resumeError?.message);
    }
    
    // Try to continue with next song after delay
    routineServerLog('🔄 Retrying song advance in 3 seconds...');
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
      const spPlayback = spotifyFor(roomId);
      const state = await spPlayback.getCurrentPlaybackState();
      if (state == null && spPlayback._playbackNullDueToRateLimit) return;
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
            routineServerLog(`🎼 Watchdog correcting via playlist context at index ${room.currentSongIndex}`);
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
          let devices = [];
          const r = rooms.get(roomId);
          const devGate = 60000; // do not list devices on every correction (extra API weight)
          if (r && (!r._lastPlaybackDiagDeviceFetchAt || now - r._lastPlaybackDiagDeviceFetchAt > devGate)) {
            r._lastPlaybackDiagDeviceFetchAt = now;
            try {
              devices = (await spotifyFor(roomId).getUserDevices()) || [];
            } catch (_) {
              devices = [];
            }
          }
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
          routineServerLog(`⏸️ AGGRESSIVE PAUSE: Progress ${progress}ms exceeds snippet limit ${snippetLimitMs}ms. Pausing to prevent auto-advance.`);
          await spotifyFor(roomId).pausePlayback(deviceId);
          // Let timer handle the next song transition
        } catch (e) {
          console.warn('⚠️ Failed to pause at snippet limit:', e?.message);
        }
      }
      
      // Enforce repeat mode (throttled: avoid setRepeat on every poll tick)
      if (room.temporaryPlaylistId && state?.repeat_state !== 'track') {
        const rptLast = room._lastRepeatEnforceAtMs || 0;
        if (now - rptLast > 20000) {
          room._lastRepeatEnforceAtMs = now;
        try {
            routineServerLog(`🔄 Enforcing repeat 'track' mode (was: ${state?.repeat_state})`);
            await spotifyFor(roomId).setRepeatState('track', deviceId);
        } catch (e) {
          console.warn('⚠️ Failed to enforce repeat mode:', e?.message);
          }
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
  // Intervals: avoid sustained sub-3s polling of /v1/me/player (Spotify quota + enforcement risk)
  }, ((room && room.superStrictLock && room.stormUntilMs && Date.now() < room.stormUntilMs) ? 4000 : (strict ? 4000 : Math.max(5000, Math.min(10000, snippetMs / 4)))));
  roomPlaybackWatchers.set(roomId, intervalId);
}

/** Ordered playlist ids from finalize payload — column order matters for 5×15. */
function finalizeMixPlaylistFingerprint(playlists) {
  if (!Array.isArray(playlists) || playlists.length === 0) return '';
  return playlists.map((p) => (p && p.id != null ? String(p.id).trim() : '')).join('|');
}

/**
 * Host sent finalize-mix while room is already finalized — refinalize when playlists or free-space
 * changed (e.g. Save round for another prep bucket). Otherwise replay cached order only.
 */
function hostFinalizeNeedsPlaylistRefinal(room, playlists, freeSpace) {
  if (!room || !room.mixFinalized) return false;
  const oldFp = finalizeMixPlaylistFingerprint(room.finalizedPlaylists);
  const newFp = finalizeMixPlaylistFingerprint(playlists);
  if (oldFp !== newFp) return true;
  if (!!freeSpace !== !!room.freeSpaceEnabled) return true;
  return false;
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

/** Attach queue depth so host UI can show “N waiting behind this one”. */
function attachVerificationQueueMeta(room, verificationData) {
  const depth = Array.isArray(room.bingoVerificationQueue) ? room.bingoVerificationQueue.length : 0;
  verificationData.verificationQueueDepth = Math.max(1, depth);
  verificationData.verificationQueueAheadCount = Math.max(0, depth - 1);
}

function emitBingoVerificationToHosts(io, room, roomId, verificationData) {
  attachVerificationQueueMeta(room, verificationData);
  let hostsFound = 0;
  room.players.forEach((playerData, pid) => {
    if (playerData.isHost) {
      const hostSocket = io.sockets.sockets.get(pid);
      if (hostSocket) {
        hostSocket.emit('bingo-verification-needed', verificationData);
        hostsFound++;
        routineServerLog(`📤 Sent bingo verification to host: ${playerData.name} (${pid})`);
      } else {
        console.warn(`⚠️ Host socket not found for ${playerData.name} (${pid}) - may have disconnected`);
      }
    }
  });
  if (hostsFound === 0 && room.host) {
    const fallbackHostSocket = io.sockets.sockets.get(room.host);
    if (fallbackHostSocket) {
      fallbackHostSocket.emit('bingo-verification-needed', verificationData);
      routineServerLog(`📤 Sent bingo verification to fallback host (${room.host})`);
    } else {
      console.error(
        `❌ CRITICAL: No host sockets found! Room host: ${room.host}, Hosts in players: ${Array.from(room.players.entries())
          .filter(([_, p]) => p.isHost)
          .map(([id, p]) => `${p.name}(${id})`)
          .join(', ')}`,
      );
      io.to(roomId).emit('bingo-verification-needed', verificationData);
      routineServerLog(`📤 Emitted bingo verification to entire room as fallback`);
    }
  }
}

function enqueueBingoVerification(io, room, roomId, verificationData, callerDisplayName) {
  if (!room.bingoVerificationQueue) room.bingoVerificationQueue = [];
  room.bingoVerificationQueue.push({
    verificationData,
    enqueuedAt: Date.now(),
  });
  const depth = room.bingoVerificationQueue.length;
  if (depth === 1) {
    emitBingoVerificationToHosts(io, room, roomId, verificationData);
  } else {
    routineServerLog(`📋 Bingo verification queued (${depth} total): ${callerDisplayName}`);
    io.to(roomId).emit('bingo-verification-queued', {
      playerId: verificationData.playerId,
      playerName: callerDisplayName,
      queueDepth: depth,
      waitingAhead: depth - 1,
    });
  }
}

function supersedeRemainingBingoQueue(room, roomId, io) {
  if (!Array.isArray(room.bingoVerificationQueue)) return;
  while (room.bingoVerificationQueue.length > 0) {
    const item = room.bingoVerificationQueue.shift();
    const vd = item.verificationData;
    let pid = vd.playerId;
    if (!room.players.has(pid) && vd.playerName) {
      for (const [id, p] of room.players) {
        if (p.name === vd.playerName && !p.isHost) {
          pid = id;
          break;
        }
      }
    }
    const victim = room.players.get(pid);
    if (victim) {
      victim.hasBingo = false;
      victim.patternComplete = false;
    }
    room.winners = room.winners.filter((w) => w.playerId !== pid);
    io.to(pid).emit('bingo-result', {
      success: false,
      rejected: true,
      superseded: true,
      message: "Another player's bingo was confirmed first.",
    });
  }
}

function resumeGameAfterVerificationQueueEmpty(roomId, room) {
  if (room.gameState !== 'paused_for_verification') return;
  room.gameState = 'playing';
  (async () => {
    try {
      const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
      if (deviceId) {
        await spotifyFor(roomId).resumePlayback(deviceId);
        routineServerLog(`▶️ Spotify resumed — bingo verification queue empty`);
      } else {
        routineServerLog(`⚠️ No device ID available for resuming after bingo verification`);
      }
      startSimpleProgression(roomId, room.selectedDeviceId, room.snippetLength || 30);
    } catch (error) {
      routineServerLog(`⚠️ Failed to resume Spotify after bingo verification: ${error.message}`);
      startSimpleProgression(roomId, room.selectedDeviceId, room.snippetLength || 30);
    }
  })();
  io.to(roomId).emit('game-resumed', { reason: 'Bingo verification queue cleared' });
}

function advanceBingoVerificationQueueAfterReject(io, room, roomId) {
  const q = room.bingoVerificationQueue;
  if (!Array.isArray(q)) return;
  q.shift();
  if (q.length > 0) {
    emitBingoVerificationToHosts(io, room, roomId, q[0].verificationData);
  } else {
    room.bingoVerificationQueue = [];
    resumeGameAfterVerificationQueueEmpty(roomId, room);
  }
}

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
        linesRequired: 1,
        customPattern: undefined, // Will be set when custom pattern is chosen
        customPatternName: '',
        customPatternAllowRotation: false,
        customPatternAllowMirror: false,
        patternComposite: undefined,
        letterRevealIntervalSec: DEFAULT_LETTER_REVEAL_INTERVAL_SEC,
        publicDisplayTitleRevealMode: DEFAULT_PUBLIC_DISPLAY_TITLE_REVEAL_MODE,
        createdAt: new Date().toISOString()
      };
      rooms.set(roomId, newRoom);
      
      // Log organization info
      if (organizationId !== 'DEFAULT') {
        routineServerLog(`🏢 Room ${roomId} created for organization ${organizationId} with license ${licenseKey}`);
      }
    }

    const room = rooms.get(roomId);

    /**
     * Socket-first room creation (above) does not set ownerUserId. Without it, spotifyOrgForRoom()
     * falls back to DEFAULT and uses the wrong token row — refresh can fail with invalid_client
     * when env/DB was migrated to a new Spotify app while user tokens live on user_${uid}.
     * Claim the room for the first signed-in host (same as POST /api/host/rooms pre-seeded rooms).
     */
    if (wantsHost && claimUid != null && room && room.ownerUserId == null) {
      room.ownerUserId = claimUid;
    }

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
        routineServerLog(`Set ${playerName} as host for room: ${roomId}`);
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
          routineServerLog(`Host reconnected (clientId) for room ${roomId}`);
        } else if (!oldHostConnected) {
          room.host = socket.id;
          if (clientId) room.hostClientId = clientId;
          effectiveIsHost = true;
          routineServerLog(`New host claimed room ${roomId} (previous host disconnected)`);
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
            routineServerLog(`Host takeover by room owner (uid ${ownerUid}) for room ${roomId}`);
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

    ensureRoomOwnerFromHostSocket(room);
    
    if (room.ownerUserId != null && db) {
      try {
        await resolveRoomVenueBranding(room);
      } catch (e) {
        console.error('join-room resolveRoomVenueBranding:', e?.message || e);
      }
    }
    try {
      io.to(roomId).emit('venue-branding', { venueBranding: venueBrandingForRoom(room) });
    } catch (e) {
      console.error('join-room venue-branding emit:', e?.message || e);
    }

    if (effectiveIsHost) {
      for (const [pid, p] of room.players) {
        if (pid !== socket.id && p.isHost) {
          routineServerLog(`Removing old host entry for ${p.name} (${pid})`);
          p.isHost = false;
        }
      }
    }
    
    routineServerLog(`Player ${playerName} joined room ${roomId}. Total players: ${room.players.size}`);
    routineServerLog(`Room host: ${room.host}, Current socket: ${socket.id}`);
    
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
    routineServerLog('Available devices:', Array.from(room.players.values()).map(p => p.name));

    // If a game is already in progress or mix is finalized, provide the joining player with state
    (async () => {
      try {
        // HOST RECONNECTION: Send comprehensive state sync
        if (effectiveIsHost) {
          routineServerLog(`🔄 Host reconnecting - sending full state sync for ${playerName}`);
          
          // Send current game state
          const playedSongIds = Array.isArray(room.calledSongIds) ? [...room.calledSongIds] : [];
          if (room.currentSong && room.currentSong.id && !playedSongIds.includes(room.currentSong.id)) {
            playedSongIds.push(room.currentSong.id);
          }
          
          socket.emit('room-state', {
            isPlaying: room.gameState === 'playing',
            pattern: room.pattern || 'line',
            customMask: Array.from(room.customPattern || []),
            patternComposite: patternCompositeForClient(room),
            ...patternExtrasForClient(room),
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
            publicDisplayFontSize: room.publicDisplayFontSize || 1.0,
            publicDisplayCallListMode: room.publicDisplayCallListMode || 'auto',
            letterRevealIntervalSec: letterRevealIntervalSecForRoom(room),
            publicDisplayTitleRevealMode: publicDisplayTitleRevealModeForRoom(room),
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

          if (Array.isArray(room.bingoVerificationQueue) && room.bingoVerificationQueue.length > 0) {
            const head = room.bingoVerificationQueue[0]?.verificationData;
            if (head) {
              emitBingoVerificationToHosts(io, room, roomId, head);
              routineServerLog(`📤 Re-sent head bingo verification to reconnecting host (${room.bingoVerificationQueue.length} in queue)`);
            }
          }
          
          // Note: Pending verifications use bingoVerificationQueue; head is replayed above.
          
          routineServerLog(`✅ Host reconnection state sync complete for ${playerName}`);
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
          routineServerLog(`🎲 Generating bingo card for ${effectiveIsHost ? 'host' : 'player'} ${playerName}`);
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
    routineServerLog('🎵 Finalizing mix for room:', roomId);
    
    const room = rooms.get(roomId);
    if (!room) {
      routineServerLog('❌ Room not found for mix finalization');
      return;
    }

    // Enhanced host validation with detailed logging
    const player = room.players.get(socket.id);
    const roomHostId = room.host;
    const currentSocketId = socket.id;
    const playerIsHost = player && player.isHost;
    const socketIsRoomHost = roomHostId === currentSocketId;
    const isCurrentHost = socketIsRoomHost || playerIsHost;
    
    routineServerLog(`🔍 Host validation - Room: ${roomId}, Socket: ${currentSocketId}, Room Host: ${roomHostId}, Player Found: ${!!player}, Player isHost: ${!!playerIsHost}, Valid: ${isCurrentHost}`);
    
    if (!isCurrentHost) {
      routineServerLog('❌ Only host can finalize mix');
      socket.emit('error', { message: 'Only the host can finalize the mix' });
      return;
    }

    if (socket.hostUserId != null && room.ownerUserId == null) {
      room.ownerUserId = socket.hostUserId;
    }
    if (room.ownerUserId != null && db) {
      try {
        await resolveRoomVenueBranding(room);
        io.to(roomId).emit('venue-branding', { venueBranding: venueBrandingForRoom(room) });
      } catch (e) {
        console.error('finalize-mix resolveRoomVenueBranding:', e?.message || e);
      }
    }

    // Already finalized: replay only if playlists + free-space unchanged; otherwise full refinalize
    // (Save round / switching prep rounds sends new playlists — must not reuse prior 75 pool).
    if (room.mixFinalized) {
      if (!hostFinalizeNeedsPlaylistRefinal(room, playlists, freeSpace)) {
        routineServerLog('⚠️ Mix already finalized for room (unchanged):', roomId);
        emitFinalizedOrderFromRoomState(roomId, room);
        socket.emit('mix-finalized', { playlists: room.finalizedPlaylists });
        return;
      }
      routineServerLog('🔄 Refinalizing mix — playlist selection or free-space changed:', roomId);
      room.mixFinalized = false;
      room.finalizedPlaylists = null;
      room.finalizedSongOrder = null;
      room.finalizedSongs = null;
      room.freeSpaceEnabled = false;
      if (room.bingoCards) room.bingoCards.clear();
      if (room.clientCards) room.clientCards.clear();
      room.fiveByFifteenColumnsIds = null;
      room.fiveByFifteenColumns = null;
      room.fiveByFifteenPlaylistNames = null;
      room.fiveByFifteenMeta = null;
      room.oneBySeventyFivePool = null;
    }

    try {
      if (!Array.isArray(songList) || songList.length === 0) {
        console.warn('⚠️ finalize-mix rejected: empty songList');
        socket.emit('finalize-mix-failed', {
          code: 'empty_song_list',
          message:
            'No songs were loaded from Spotify for your playlists. Wait out rate limits, refresh your library, then finalize again.',
        });
        return;
      }

      // Persist finalized data; song order is set after optional YouTube → catalog title pass
      room.finalizedPlaylists = playlists;
      room.freeSpaceEnabled = !!freeSpace;
      
      routineServerLog('📋 Received songList for finalization:', {
          length: songList.length,
        hasPlaylistInfo: !!songList[0]?.sourcePlaylistId,
        firstSong: {
            id: songList[0].id,
            name: songList[0].name,
            sourcePlaylistId: songList[0].sourcePlaylistId,
          sourcePlaylistName: songList[0].sourcePlaylistName,
        },
      });

      let songListVerified = songList;
      try {
        songListVerified = await applyYoutubeCatalogTrackVerification(songList, {
          log: (...a) => routineServerLog('[yt-metadata]', ...a),
        });
      } catch (e) {
        routineServerLog('⚠️ YouTube metadata verification failed (using heuristic titles):', e?.message || e);
        songListVerified = songList;
      }

      room.finalizedSongOrder = songListVerified;
      room.finalizedSongs = songListVerified;
      routineServerLog(`📝 Stored ${songListVerified.length} finalized songs for room ${roomId}`);

      const bingoOk = await generateBingoCards(roomId, playlists, room.finalizedSongOrder || null);
      if (!bingoOk) {
        room.finalizedPlaylists = null;
        room.finalizedSongOrder = null;
        room.finalizedSongs = null;
        room.freeSpaceEnabled = false;
        socket.emit('finalize-mix-failed', {
          code: 'bingo_generation_failed',
          message:
            'Could not generate bingo cards (Spotify rate limit or missing playlist tracks). Wait for cooldown, reconnect Spotify, then finalize again.',
        });
        return;
      }

      emitFinalizedOrderFromRoomState(roomId, room);

      room.mixFinalized = true;
      
      io.to(roomId).emit('mix-finalized', { playlists, songList: songListVerified });
      
      routineServerLog('✅ Mix finalized for room:', roomId);
    } catch (error) {
      console.error('❌ Error finalizing mix:', error);
      room.finalizedPlaylists = null;
      room.finalizedSongOrder = null;
      room.finalizedSongs = null;
      room.freeSpaceEnabled = false;
      socket.emit('finalize-mix-failed', {
        code: 'server_error',
        message: error && error.message ? String(error.message) : 'Finalize failed on server.',
      });
    }
  });

  socket.on('request-finalized-order', (data = {}) => {
    try {
      const roomId = data.roomId;
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room || !room.mixFinalized) return;
      const player = room.players.get(socket.id);
      const isCurrentHost = room.host === socket.id || !!(player && player.isHost);
      if (!isCurrentHost) return;
      emitFinalizedOrderFromRoomState(roomId, room);
    } catch (e) {
      console.warn('request-finalized-order:', e?.message || e);
    }
  });

  socket.on('request-printable-cards', (data = {}) => {
    void (async () => {
      try {
        const roomId = data.roomId;
        const raw = Number(data.count);
        const count = Number.isFinite(raw) ? Math.min(200, Math.max(1, Math.floor(raw))) : 30;
        const room = rooms.get(roomId);
        if (!room) {
          socket.emit('printable-cards-error', { message: 'Room not found.' });
          return;
        }
        const player = room.players.get(socket.id);
        const isCurrentHost = room.host === socket.id || !!(player && player.isHost);
        if (!isCurrentHost) {
          socket.emit('printable-cards-error', { message: 'Only the host can export printable cards.' });
          return;
        }
        ensureRoomOwnerFromHostSocket(room);
        try {
          await resolveRoomVenueBranding(room);
        } catch (e) {
          console.warn('request-printable-cards resolveRoomVenueBranding:', e?.message || e);
        }
        const useFreeSpace =
          typeof data.freeSpace === 'boolean' ? data.freeSpace : !!room.freeSpaceEnabled;

        if (!room.mixFinalized) {
          socket.emit('printable-cards-error', {
            message: 'Finalize the mix first so the bingo pool is locked.',
          });
          return;
        }

        const cards = [];
        for (let i = 0; i < count; i++) {
          const chosen25 = pickChosen25ForPrintableCard(room, useFreeSpace);
          if (!chosen25) {
            socket.emit('printable-cards-error', {
              message:
                'Could not build cards from the current room pool. Try finalizing again or check playlist sizes.',
            });
            return;
          }
          const card = buildPrintableCardFromChosen(chosen25, useFreeSpace, i);
          if (!card) {
            socket.emit('printable-cards-error', { message: 'Card build failed.' });
            return;
          }
          cards.push(card);
        }
        socket.emit('printable-cards-result', {
          cards,
          roomId,
          freeSpace: useFreeSpace,
          venueBranding: venueBrandingForRoom(room),
        });
        routineServerLog(`📄 Exported ${count} printable bingo cards for room ${roomId} (full finalized pool)`);
      } catch (e) {
        console.error('request-printable-cards:', e);
        socket.emit('printable-cards-error', {
          message: e && e.message ? String(e.message) : 'Export failed.',
        });
      }
    })();
  });

  // Set game pattern
  socket.on('set-pattern', (data = {}) => {
    try {
      const {
        roomId,
        pattern,
        customMask,
        patternComposite: incomingComposite,
        linesRequired: lrIn,
        customMatchAllowRotation,
        customMatchAllowMirror,
        customPatternName: incomingCustomPatternName,
      } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
      if (!isCurrentHost) return;
      const allowed = ALLOWED_BINGO_PATTERNS;
      const canonPattern = canonicalHostBingoPattern(pattern);
      room.pattern = allowed.has(canonPattern) ? canonPattern : 'line';
      room.customPatternAllowRotation = false;
      room.customPatternAllowMirror = false;
      room.customPatternName = '';
      if (room.pattern === 'custom') {
        const mask = Array.isArray(customMask) ? customMask.filter(p => /^(0|1|2|3|4)-(0|1|2|3|4)$/.test(p)) : [];
        room.customPattern = new Set(mask);
        room.patternComposite = undefined;
        room.customPatternAllowRotation = readOrientationBoolSrv(customMatchAllowRotation);
        room.customPatternAllowMirror = readOrientationBoolSrv(customMatchAllowMirror);
        room.customPatternName = sanitizeCustomPatternNameSrv(incomingCustomPatternName);
      } else if (room.pattern === 'composite') {
        room.customPattern = undefined;
        room.patternComposite = normalizePatternComposite(incomingComposite);
        if (!room.patternComposite) room.pattern = 'line';
      } else {
        room.customPattern = undefined;
        room.patternComposite = undefined;
      }
      if (room.pattern === 'line') {
        room.linesRequired = normalizeLinesRequiredSrv(lrIn != null ? lrIn : room.linesRequired != null ? room.linesRequired : 1);
      } else {
        room.linesRequired = 1;
      }
      io.to(roomId).emit('pattern-updated', {
        pattern: room.pattern,
        customMask: Array.from(room.customPattern || []),
        patternComposite: patternCompositeForClient(room),
        ...patternExtrasForClient(room),
      });
      routineServerLog(`🎯 Pattern set to ${room.pattern} for room ${roomId}`);
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
      routineServerLog(`🌐 Hybrid in-person+online for room ${roomId}: ${room.hybridInPersonPlusOnline}`);
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
      routineServerLog(`📏 Public display font size set to ${validFontSize}x for room ${roomId}`);
    } catch (e) {
      console.error('❌ Error setting public display font size:', e?.message || e);
    }
  });

  // Host: force public display call list layout (5×15 BINGO columns vs 1×75 carousel) or follow mix/URL
  socket.on('set-public-display-call-list-mode', (data = {}) => {
    try {
      const { roomId, mode } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
      if (!isCurrentHost) return;
      const m = String(mode || '').toLowerCase();
      const next = m === 'grouped' || m === '1x75' ? 'grouped' : m === '5x15' || m === 'columns' ? '5x15' : 'auto';
      room.publicDisplayCallListMode = next;
      io.to(roomId).emit('public-display-call-list-mode-updated', { mode: next });
      routineServerLog(`🖥️ Public display call list mode for room ${roomId}: ${next}`);
    } catch (e) {
      console.error('❌ Error setting public display call list mode:', e?.message || e);
    }
  });

  // Host: interval between automatic letter reveals on the public display (seconds)
  socket.on('set-public-display-letter-reveal-interval', (data = {}) => {
    try {
      const { roomId, intervalSec } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost =
        room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
      if (!isCurrentHost) return;
      const clamped = clampLetterRevealIntervalSec(intervalSec);
      room.letterRevealIntervalSec = clamped;
      io.to(roomId).emit('public-display-letter-reveal-interval-updated', { intervalSec: clamped });
      routineServerLog(`🔤 Public display letter reveal interval for room ${roomId}: ${clamped}s`);
    } catch (e) {
      console.error('❌ Error setting letter reveal interval:', e?.message || e);
    }
  });

  // Host: projector title masking — letter timing vs full title at clip start/end
  socket.on('set-public-display-title-reveal-mode', (data = {}) => {
    try {
      const { roomId, mode } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost =
        room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
      if (!isCurrentHost) return;
      const m = String(mode || '').toLowerCase().replace(/-/g, '_');
      const next =
        m === 'track_start' || m === 'beginning' || m === 'start'
          ? 'track_start'
          : m === 'track_end' || m === 'end'
            ? 'track_end'
            : 'letter';
      room.publicDisplayTitleRevealMode = next;
      io.to(roomId).emit('public-display-title-reveal-mode-updated', { mode: next });
      routineServerLog(`🖥️ Public display title reveal mode for room ${roomId}: ${next}`);
    } catch (e) {
      console.error('❌ Error setting title reveal mode:', e?.message || e);
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
      routineServerLog(`Room has players:`, Array.from(room.players.keys()));
      socket.emit('bingo-result', { success: false, reason: 'Player not found in room' });
      return;
    }
    if (player.inPerson === undefined) player.inPerson = true;
    if (!player.bingoCard) {
      console.error(`❌ Player ${player.name} (${socket.id}) has no bingo card`);
      routineServerLog(`Room bingo cards:`, Array.from(room.bingoCards?.keys() || []));
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
        logger.debug(`📝 BINGO CALL: Marked current song as played BEFORE validation: ${room.currentSong.name} (${room.currentSong.id})`);
      } else {
        logger.debug(`✅ BINGO CALL: Current song already in played list: ${room.currentSong.name} (${room.currentSong.id})`);
      }
    } else {
      console.warn(`⚠️ BINGO CALL: No current song to mark as played! This could cause validation issues.`);
    }
    logger.log(
      `Bingo: ${player.name} — ${(room.calledSongIds || []).length} call(s) on list, validating…`,
      'bingo-call-summary',
      20
    );
    
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
        routineServerLog(`🌐 Remote hybrid bingo (unofficial) for ${player.name}`);
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
              routineServerLog(`⏸️ Spotify paused for bingo verification by ${player.name}`);
            } else {
              routineServerLog(`⚠️ No device ID available for pausing during bingo verification`);
            }
          } catch (error) {
            routineServerLog(`⚠️ Failed to pause Spotify during bingo verification: ${error.message}`);
          }
        })();
        
        routineServerLog(`🛑 Game auto-paused for bingo verification by ${player.name}`);
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
      
      logger.debug(`🔍 BINGO VERIFICATION: Building played songs list from ${calledIds.length} called IDs`);
      const idSample =
        calledIds.length <= 12
          ? calledIds.join(', ')
          : `${calledIds.slice(0, 8).join(', ')} … +${calledIds.length - 8} more`;
      logger.debug(`🔍 Called song IDs (sample): [${idSample}]`);
      
      for (const songId of calledIds) {
        // Find the song in the playlist
        const foundSong = room.playlistSongs?.find(s => s.id === songId);
        if (foundSong) {
          actuallyPlayedSongs.push({
            id: foundSong.id,
            name: foundSong.name,
            artist: foundSong.artist
          });
        } else {
          missingFromPlaylist.push(songId);
          console.warn(`⚠️ Song ID ${songId} in calledSongIds but NOT found in room.playlistSongs`);
        }
      }
      
      logger.log(
        `Bingo verify: ${actuallyPlayedSongs.length} resolved from playlist, ${missingFromPlaylist.length} id(s) missing (player ${player.name})`,
        'bingo-verify-summary',
        20
      );
      logger.debug(
        `📊 VERIFICATION: first songs ${actuallyPlayedSongs.slice(0, 3).map(s => s.name).join('; ') || '—'} … (${actuallyPlayedSongs.length} total)`
      );
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
      const notPlayedMarks = markedSquares.filter(
        (sq) => !actuallyPlayedSongs.some((p) => p.id === sq.songId) && !sq.isFreeSpace
      );
      logger.debug(`🔍 MARKED SQUARES: ${markedSquares.length} marked; ${notPlayedMarks.length} not in played list (non-free)`);
      logger.debug(
        `🔍 Card source: ${room.bingoCards?.get(socket.id) ? 'room.bingoCards' : 'player.bingoCard'}`
      );
      if (notPlayedMarks.length) {
        logger.warn(
          `⚠️ Bingo host verify: ${notPlayedMarks.length} marked square(s) not in playedSongs: ${notPlayedMarks
            .slice(0, 5)
            .map((s) => s.songId)
            .join(', ')}${notPlayedMarks.length > 5 ? '…' : ''}`
        );
      }
      const markedCount = sourceCard.squares.filter(s => s.marked).length;
      logger.debug(
        `🔍 Card: ${markedCount} marked / ${sourceCard.squares.length} sq; positions: ${sourceCard.squares
          .filter((s) => s.marked)
          .map((s) => s.position)
          .join(', ')}`
      );
      
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

      enqueueBingoVerification(io, room, roomId, verificationData, player.name);

      // Notify all players about the bingo call (but not confirmed yet)
      io.to(roomId).emit('bingo-verification-pending', { 
        playerId: socket.id, 
        playerName: player.name, 
        awaitingVerification: true
      });
    } else {
      // INVALID BINGO: Still send to host for verification (host can reject)
      // This allows players to attempt bingo calls even with invalid marks
      routineServerLog(`⚠️ Invalid bingo call from ${player.name}, but sending to host for verification`);
      
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
              routineServerLog(`⏸️ Spotify paused for invalid bingo verification by ${player.name}`);
            }
          } catch (error) {
            routineServerLog(`⚠️ Failed to pause Spotify during bingo verification: ${error.message}`);
          }
        })();
        
        routineServerLog(`🛑 Game auto-paused for invalid bingo verification by ${player.name}`);
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

      enqueueBingoVerification(io, room, roomId, verificationData, player.name);

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
    
    const q = room.bingoVerificationQueue;
    if (!Array.isArray(q) || q.length === 0) {
      socket.emit('bingo-verified', {
        approved: false,
        error: 'no_pending',
        reason: 'No bingo claim is pending verification.',
        playerName: bodyPlayerName || 'Unknown',
      });
      return;
    }

    const headData = q[0].verificationData;
    let resolvedPlayerId = headData.playerId;
    let player = room.players.get(resolvedPlayerId);

    if (!player && headData.playerName) {
      for (const [pid, p] of room.players) {
        if (p.name === headData.playerName && !p.isHost) {
          player = p;
          resolvedPlayerId = pid;
          routineServerLog(`verify-bingo: queue head "${headData.playerName}" → socket ${pid}`);
          break;
        }
      }
    }

    if (!player) {
      routineServerLog(
        `verify-bingo: dropping stale queue head ${headData.playerName || headData.playerId} — player gone`,
      );
      q.shift();
      if (q.length > 0) {
        emitBingoVerificationToHosts(io, room, roomId, q[0].verificationData);
      } else {
        room.bingoVerificationQueue = [];
        resumeGameAfterVerificationQueueEmpty(roomId, room);
      }
      return;
    }

    if (
      playerId &&
      playerId !== resolvedPlayerId &&
      bodyPlayerName &&
      bodyPlayerName !== headData.playerName
    ) {
      routineServerLog(
        `verify-bingo: host sent (${playerId} / ${bodyPlayerName}) but FIFO queue head is (${resolvedPlayerId} / ${headData.playerName}) — using queue`,
      );
    }
    if (approved) {
      // APPROVED: Confirm the win and resume/end game
      routineServerLog(`✅ Host approved bingo for ${player.name}`);
      
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
            youtubeMusic: s.youtubeMusic === true,
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
            routineServerLog(`⏸️ Spotify paused - round complete`);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to pause Spotify on round complete: ${error.message}`);
        }
      })();
      
      routineServerLog(`🏁 Round complete - ${player.name} wins! Waiting for host decision...`);
      
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
            routineServerLog(`📤 Sent round-complete notification to host: ${playerData.name} (${hostSocketId})`);
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
          routineServerLog(`📤 Sent round-complete notification to fallback host (${room.host})`);
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
          routineServerLog(`📤 Emitted round-complete notification to entire room as last resort`);
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

      // Pop confirmed winner from FIFO queue; dismiss anyone still waiting (same round ended)
      if (Array.isArray(room.bingoVerificationQueue) && room.bingoVerificationQueue.length > 0) {
        room.bingoVerificationQueue.shift();
      }
      supersedeRemainingBingoQueue(room, roomId, io);
      
    } else {
      // REJECTED: Remove from winners, notify player, resume game
      routineServerLog(`❌ Host rejected bingo for ${player.name}: ${reason}`);
      
      // Remove from winners list (drop both stale and resolved ids after reconnect)
      room.winners = room.winners.filter((w) => w.playerId !== resolvedPlayerId);
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
      
      // Advance FIFO: show next pending bingo, or resume if queue empty
      advanceBingoVerificationQueueAfterReject(io, room, roomId);
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

    if (Array.isArray(room.bingoVerificationQueue) && room.bingoVerificationQueue.length > 0) {
      routineServerLog(
        `⚠️ manual-resume blocked: ${room.bingoVerificationQueue.length} bingo verification(s) pending`,
      );
      socket.emit('error', {
        message: `Finish bingo verification first (${room.bingoVerificationQueue.length} pending).`,
      });
      return;
    }
    
    // Only resume if game is paused for verification
    if (room.gameState === 'paused_for_verification') {
      routineServerLog(`▶️ Host manually resuming game from paused_for_verification state`);
      room.gameState = 'playing';
      
      // Resume Spotify playback
      (async () => {
        try {
          const deviceId = room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id;
          if (deviceId) {
            await spotifyFor(roomId).resumePlayback(deviceId);
            routineServerLog(`▶️ Spotify resumed after manual resume`);
          }
          // Start progression timer for the remainder of the current song
          startSimpleProgression(roomId, room.selectedDeviceId, room.snippetLength || 30);
        } catch (error) {
          routineServerLog(`⚠️ Failed to resume Spotify: ${error.message}`);
          // Still start progression timer as fallback
          startSimpleProgression(roomId, room.selectedDeviceId, room.snippetLength || 30);
        }
      })();
      
      // Notify all clients that game has resumed
      io.to(roomId).emit('game-resumed', { reason: 'Host manually resumed game' });
      routineServerLog(`✅ Game manually resumed by host`);
    } else {
      routineServerLog(`⚠️ Cannot manually resume: game state is ${room.gameState}, expected paused_for_verification`);
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
        routineServerLog(`▶️ Host chose to continue game after bingo verification`);
        
        io.to(roomId).emit('game-resumed', { reason: 'Host continued after bingo' });
      }
    } else if (action === 'end') {
      // End the current round
      room.gameState = 'ended';
      clearRoomTimer(roomId);
      routineServerLog(`🏁 Host ended game after bingo verification`);
      
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
    
    routineServerLog(`🚨 EMERGENCY STOP requested for room ${roomId}`);
    
    // Immediate stop
    clearRoomTimer(roomId);
    
    // Try to pause Spotify immediately
    (async () => {
      try {
        if (room.selectedDeviceId) {
          await spotifyApi.pause();
          routineServerLog('🛑 Emergency stop: Spotify paused');
        }
      } catch (error) {
        routineServerLog('Emergency stop: Spotify pause failed (continuing anyway)');
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
    
    routineServerLog(`🔄 Host restarting game for room ${roomId}`);
    
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
    room.bingoVerificationQueue = [];
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
    
    routineServerLog(`✅ Game restarted successfully for room ${roomId}`);
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
      routineServerLog(`✅ start-next-round: Game state is ${room.gameState} - proceeding with reset`);
    }
    
    routineServerLog(`🔄 Host starting FRESH round ${(room.roundWinners?.length || 0) + 1} for room ${roomId}`);
    
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
          routineServerLog(`⏸️ Spotify paused before round reset`);
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
    room.bingoVerificationQueue = [];
    
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
    room.customPatternName = '';
    room.patternComposite = undefined;
    
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
    
    routineServerLog(`🔄 Room ${roomId} reset to setup state, keeping ${room.players.size} players and Spotify connection`);
    
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
    
    routineServerLog(`✅ Fresh round ${roundWinnersToKeep.length + 1} setup ready for room ${roomId}`);
  });

  // NEW: Host ends the entire multi-round game session
  socket.on('end-game-session', (data) => {
    const { roomId } = data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Verify this is the host
    const isHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
    if (!isHost) return;
    
    routineServerLog(`🏁 Host ending game session for room ${roomId}`);
    
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
    
    routineServerLog(`✅ Game session ended for room ${roomId} after ${room.roundWinners?.length || 0} rounds`);
  });

  // Client requests a state sync (useful if they joined before start or missed events)
  socket.on('sync-state', async (data = {}) => {
    try {
      const { roomId } = data;
      const room = rooms.get(roomId);
      if (!room) {
        routineServerLog(`🔄 SYNC-STATE: Room ${roomId} not found`);
        return;
      }

      ensureRoomOwnerFromHostSocket(room);

      if (room.ownerUserId != null && db) {
        try {
          await resolveRoomVenueBranding(room);
          const b = room.venueBranding;
          routineServerLog(
            `🎨 SYNC-STATE venue: room ${roomId} ownerUserId=${room.ownerUserId} ` +
              `${b ? `logo=${!!b.logoUrl} title=${!!b.eventTitle}` : 'branding=null'}`
          );
          try {
            io.to(roomId).emit('venue-branding', { venueBranding: venueBrandingForRoom(room) });
          } catch (emitErr) {
            console.error('sync-state venue-branding emit:', emitErr?.message || emitErr);
          }
        } catch (e) {
          console.error('sync-state resolveRoomVenueBranding:', e?.message || e);
        }
      } else {
        routineServerLog(
          `🎨 SYNC-STATE venue skipped: room ${roomId} ownerUserId=${room.ownerUserId ?? 'null'} db=${!!db}`
        );
      }

      routineServerLog(`🔄 SYNC-STATE: Sending state to ${socket.id} for room ${roomId}`);
      
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
        patternComposite: patternCompositeForClient(room),
        ...patternExtrasForClient(room),
        currentSong: currentSongPayloadForRoomState(room.currentSong),
        snippetLength: room.snippetLength || 30,
        playerCount: getNonHostPlayerCount(room),
        gameState: room.gameState,
        winners: room.winners || [],
        roundWinners: room.roundWinners || [],
        publicDisplayFontSize: room.publicDisplayFontSize || 1.0,
        publicDisplayCallListMode: room.publicDisplayCallListMode || 'auto',
        letterRevealIntervalSec: letterRevealIntervalSecForRoom(room),
        publicDisplayTitleRevealMode: publicDisplayTitleRevealModeForRoom(room),
        venueBranding: venueBrandingForRoom(room),
        // Include played songs for PublicDisplay sync (includes current song)
        playedSongs: playedSongIds.map(songId => {
          const foundSong = room.playlistSongs?.find(s => s.id === songId);
          return clientSongMetaFromPlaylistSong(foundSong);
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
      
      // Include oneby75 pool only when not in 5×15 (avoid wiping display columns via stale pool)
      const hasFiveBy15Active =
        room.fiveByFifteenColumnsIds &&
        Array.isArray(room.fiveByFifteenColumnsIds) &&
        room.fiveByFifteenColumnsIds.length === 5;
      if (
        !hasFiveBy15Active &&
        room.oneBySeventyFivePool &&
        Array.isArray(room.oneBySeventyFivePool) &&
        room.oneBySeventyFivePool.length > 0
      ) {
        const oneBy75Ids = room.oneBySeventyFivePool.map(s => s.id).filter(Boolean);
        socket.emit('oneby75-pool', { ids: oneBy75Ids });
      }
      
      io.to(socket.id).emit('room-state', payload);
      routineServerLog(`✅ SYNC-STATE: Sent comprehensive state (${payload.totalPlayedCount} played songs, ${payload.playerCount} players)`);
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
      routineServerLog(`📋 Sent ${Object.keys(playerCardsData).length} player cards to host in room ${roomId}`);
      routineServerLog(`📋 CalledSongIds being sent:`, room.calledSongIds);
      routineServerLog(`📋 CalledSongIds length:`, room.calledSongIds?.length || 0);
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
      routineServerLog(`🔄 New round started for room ${roomId} (round ${room.round})`);
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
      routineServerLog(`🔒 Super-Strict Lock set to ${room.superStrictLock} for room ${roomId}`);
      // Restart simple context monitor (no aggressive pausing)
      if (room.gameState === 'playing') {
        startSimpleContextMonitor(roomId, room.selectedDeviceId);
      }
    } catch (e) {
      console.error('❌ Error setting super-strict lock:', e?.message || e);
    }
  });

  socket.on('start-game', async (data) => {
    routineServerLog('🎮 Start game event received:', data);
    const { roomId, playlists, snippetLength = 30, deviceId, songList, randomStarts = 'none', pattern: incomingPattern, customMask: incomingCustomMask, patternComposite: incomingPatternComposite, linesRequired: incomingLinesRequired, customMatchAllowRotation: incomingCustomRot, customMatchAllowMirror: incomingCustomMir, customPatternName: incomingCustomPatternName, freeSpace, savedRoundPlayback } = data;
    const room = rooms.get(roomId);
    
    routineServerLog('🔍 Room found:', !!room);
    routineServerLog('🔍 Room host:', room?.host);
    routineServerLog('🔍 Socket ID:', socket.id);
    routineServerLog('🔍 Is host:', room?.host === socket.id);
    routineServerLog('🔍 Available rooms:', Array.from(rooms.keys()));
    routineServerLog('🔍 Room players:', Array.from(room?.players.entries() || []).map(([id, player]) => `${player.name}(${player.isHost ? 'host' : 'player'})`));
    
    // Check if this socket is the host (either by room.host or by player.isHost)
    const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
    routineServerLog('🔍 Is current host check:', { roomHost: room?.host, socketId: socket.id, playerIsHost: room?.players.get(socket.id)?.isHost, isCurrentHost });
    
    if (room && isCurrentHost) {
      try {
        routineServerLog('✅ Starting game for room:', roomId);
      room.gameState = 'playing';
      room.snippetLength = snippetLength;
      room.playlists = playlists;
        room.selectedDeviceId = deviceId; // Store the selected device ID
        room.randomStarts = randomStarts || 'none';
        // Initialize call history and round
        room.calledSongIds = [];
        room.bingoVerificationQueue = [];
        room.round = (room.round || 0) + 1;
        // Apply pattern from host if provided; default to 'line' if still unset
        try {
          const allowed = ALLOWED_BINGO_PATTERNS;
          if (incomingPattern && allowed.has(canonicalHostBingoPattern(incomingPattern))) {
            room.pattern = canonicalHostBingoPattern(incomingPattern);
          }
          if (room.pattern === 'custom' && Array.isArray(incomingCustomMask)) {
            const mask = incomingCustomMask.filter((p) => /^(0|1|2|3|4)-(0|1|2|3|4)$/.test(p));
            room.customPattern = mask.length > 0 ? new Set(mask) : undefined;
            room.patternComposite = undefined;
            room.customPatternName = sanitizeCustomPatternNameSrv(incomingCustomPatternName);
          } else if (room.pattern === 'composite') {
            room.customPattern = undefined;
            room.customPatternName = '';
            room.patternComposite = normalizePatternComposite(incomingPatternComposite);
            if (!room.patternComposite) room.pattern = 'line';
          } else if (room.pattern !== 'custom') {
            room.customPattern = undefined;
            room.customPatternName = '';
            room.patternComposite = undefined;
          }
        } catch {}
        room.pattern = room.pattern || 'line';
        room.linesRequired =
          room.pattern === 'line'
            ? normalizeLinesRequiredSrv(incomingLinesRequired != null ? incomingLinesRequired : room.linesRequired)
            : 1;
        if (room.pattern === 'custom') {
          room.customPatternAllowRotation = readOrientationBoolSrv(incomingCustomRot);
          room.customPatternAllowMirror = readOrientationBoolSrv(incomingCustomMir);
        } else {
          room.customPatternAllowRotation = false;
          room.customPatternAllowMirror = false;
        }

        const savedRoundSongs =
          savedRoundPlayback === true ? normalizeSongSnapshotForPrint(songList) || [] : [];
        const fsForMin = freeSpace !== undefined ? !!freeSpace : !!room.freeSpaceEnabled;
        const minSnapTracks = fsForMin ? 24 : 25;
        if (savedRoundPlayback === true && savedRoundSongs.length < minSnapTracks) {
          socket.emit('error', {
            message: `Saved round playback needs at least ${minSnapTracks} tracks in the snapshot (have ${savedRoundSongs.length}). Save the round again after loading playlists.`,
          });
          return;
        }
        const useSavedRoundPlayback =
          savedRoundPlayback === true && savedRoundSongs.length >= minSnapTracks;

        routineServerLog('🎵 Generating bingo cards...');
        const forceRegenerateCards =
          useSavedRoundPlayback || !room.mixFinalized || !room.bingoCards || room.bingoCards.size === 0;
        // If mix is already finalized and cards exist, do NOT regenerate to avoid reshuffle
        if (forceRegenerateCards) {
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

          const SNAP = '__saved_round_snap__';
          let playlistsToUse;
          let songOrderForCards;
          if (useSavedRoundPlayback) {
            routineServerLog(`📋 Saved-round playback: generating cards from ${savedRoundSongs.length} snapshot tracks`);
            room.oneBySeventyFivePool = null;
            const useFiveByFifteenSnap = snapshotSupportsFiveByFifteenStartGame(playlists, savedRoundSongs);
            if (useFiveByFifteenSnap) {
              routineServerLog(
                '📋 Saved-round 5×15: partitioning snapshot by sourcePlaylistId into host five playlists (display columns)',
              );
              playlistsToUse = playlists;
              songOrderForCards = savedRoundSongs;
            } else {
              routineServerLog('📋 Saved-round playback: synthetic single pool (1×75 / merged fallback)');
              room.fiveByFifteenColumnsIds = null;
              room.fiveByFifteenColumns = null;
              room.fiveByFifteenPlaylistNames = null;
              room.fiveByFifteenMeta = null;
              const tagged = savedRoundSongs.map((s) => ({
                ...s,
                sourcePlaylistId: SNAP,
                sourcePlaylistName: 'Saved round',
              }));
              playlistsToUse = [{ id: SNAP, name: 'Saved round snapshot', songs: tagged }];
              songOrderForCards = tagged;
            }
            if (useFiveByFifteenSnap) {
              room.fiveByFifteenColumnsIds = null;
              room.fiveByFifteenColumns = null;
              room.fiveByFifteenPlaylistNames = null;
              room.fiveByFifteenMeta = null;
            }
          } else {
            playlistsToUse =
              room.finalizedPlaylists && room.finalizedPlaylists.length > 0
                ? room.finalizedPlaylists
                : playlists;
            routineServerLog(`📋 Using ${room.finalizedPlaylists ? 'finalized' : 'regular'} playlists for card generation`);
            routineServerLog(`📋 Playlist order: ${playlistsToUse.map((p, i) => `${i + 1}. ${p.name}`).join(', ')}`);
            songOrderForCards =
              room.finalizedSongOrder ||
              (Array.isArray(songList) && songList.length > 0 ? songList : null);
          }
          await generateBingoCards(roomId, playlistsToUse, songOrderForCards);

          if (useSavedRoundPlayback) {
            room.finalizedSongOrder = savedRoundSongs.map((s) => ({ ...s }));
            room.oneBySeventyFivePool = null;
            // Do not wipe 5×15 column caches after generate — Public Display needs fiveby15-pool.
            // (Older bug: always nulling here forced oneby75-style layouts during saved playback.)
            if (!(Array.isArray(room.fiveByFifteenColumnsIds) && room.fiveByFifteenColumnsIds.length === 5)) {
              room.fiveByFifteenColumnsIds = null;
              room.fiveByFifteenColumns = null;
              room.fiveByFifteenPlaylistNames = null;
              room.fiveByFifteenMeta = null;
            }
            try {
              io.to(roomId).emit('finalized-order', {
                order: savedRoundSongs.map((s) => ({
                  id: s.id,
                  name: s.name || '',
                  artist: s.artist || '',
                  explicit: s.explicit === true,
                  youtubeMusic: s.youtubeMusic === true,
                  sourcePlaylistId: s.sourcePlaylistId,
                  sourcePlaylistName: s.sourcePlaylistName,
                })),
              });
            } catch (_) {}
          }

          // CRITICAL: Auto-set pattern to 'full_card' for 1x75 mode if pattern wasn't explicitly set
          if (room.oneBySeventyFivePool && room.oneBySeventyFivePool.length === 75 && !incomingPattern) {
            routineServerLog('🎯 1x75 mode detected: Auto-setting pattern to full_card');
            room.pattern = 'full_card';
            room.patternComposite = undefined;
          }
        } else {
          routineServerLog('🛑 Skipping card regeneration (mix finalized and cards already exist)');
          
          // BUT check for any players who don't have cards (joined after finalization)
          const playersWithoutCards = [];
          room.players.forEach((player, playerId) => {
            if (!player.isHost && player.name !== 'Display' && !room.bingoCards.has(playerId)) {
              playersWithoutCards.push({ playerId, playerName: player.name });
            }
          });
          
          if (playersWithoutCards.length > 0) {
            routineServerLog(`🎲 Generating cards for ${playersWithoutCards.length} late-joining players:`, playersWithoutCards.map(p => p.playerName));
            for (const { playerId, playerName } of playersWithoutCards) {
              try {
                const card = await generateBingoCardForPlayer(roomId, playerId);
                if (card) {
                  routineServerLog(`✅ Generated bingo card for late-joiner: ${playerName}`);
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
          customMask: Array.from(room.customPattern || []),
          patternComposite: patternCompositeForClient(room),
          ...patternExtrasForClient(room),
        });
        
        // Emit fiveby15 columns if computed during card generation (AFTER game-started so display can sync)
        if (room.fiveByFifteenColumnsIds) {
          routineServerLog(`📊 Emitting fiveby15-pool with ${room.fiveByFifteenColumnsIds.length} columns`);
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
      
        routineServerLog('🎵 Starting automatic playback...');
        const playbackSongList =
          useSavedRoundPlayback && savedRoundSongs.length > 0 ? savedRoundSongs : songList;
        await startAutomaticPlayback(roomId, playlists, deviceId, playbackSongList);
        
        routineServerLog('✅ Game state set and playback attempt triggered');
      } catch (error) {
        console.error('❌ Error starting game:', error);
        socket.emit('error', { message: 'Failed to start game' });
      }
    } else {
      routineServerLog('❌ Cannot start game: Room not found or not host');
      routineServerLog('🔍 Room details:', room);
      routineServerLog('🔍 Socket details:', { id: socket.id, roomId });
      
      // Try to recreate the room if it doesn't exist
      if (!room) {
        routineServerLog('🔄 Attempting to recreate room:', roomId);
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
          linesRequired: 1,
          customPattern: undefined, // Will be set when custom pattern is chosen
          customPatternName: '',
          customPatternAllowRotation: false,
          customPatternAllowMirror: false,
          patternComposite: undefined,
          letterRevealIntervalSec: DEFAULT_LETTER_REVEAL_INTERVAL_SEC,
          publicDisplayTitleRevealMode: DEFAULT_PUBLIC_DISPLAY_TITLE_REVEAL_MODE,
        };
        rooms.set(roomId, newRoom);
        socket.join(roomId);
        
        // Try starting the game again
        setTimeout(async () => {
          try {
            routineServerLog('🔄 Retrying game start for recreated room:', roomId);
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
              const orderRec =
                newRoom.finalizedSongOrder ||
                (Array.isArray(songList) && songList.length > 0 ? songList : null);
              await generateBingoCards(roomId, playlists, orderRec);
            } else {
              routineServerLog('🛑 Skipping card regeneration after room recreation');
            }
            await startAutomaticPlayback(roomId, playlists, deviceId, songList);
            
            routineServerLog('✅ Game state set and playback attempt triggered after room recreation');
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
      routineServerLog(`🛑 Game ended gracefully for room ${roomId}`);
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
      routineServerLog(`🔁 Game reset for room ${roomId}`);
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
        routineServerLog('⏭️ Skipping to next song in room:', roomId);
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
        routineServerLog(`⏸️ PAUSE REQUESTED - Room: ${roomId}, Time: ${pauseTime}`);
        routineServerLog(`⏸️ Current Song: ${room.currentSong?.name} by ${room.currentSong?.artist}`);
        routineServerLog(`⏸️ Game State: ${room.gameState}`);
        
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
            routineServerLog('⏸️ Already paused according to playback state — treating as success');
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
        routineServerLog('✅ Playback paused successfully');
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
        routineServerLog('▶️ Resuming song in room:', roomId);
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
            routineServerLog(`🎯 Resuming from position: ${resumePosition}ms`);
          await spotifyFor(roomId).resumePlayback(deviceId);
          await spotifyFor(roomId).seekToPosition(resumePosition, deviceId);
            routineServerLog(`✅ Resumed and seeked to position: ${resumePosition}ms`);
          } else {
          await spotifyFor(roomId).resumePlayback(deviceId);
            routineServerLog('✅ Playback resumed successfully');
          }
          
          // Restore volume to match room's saved volume or default to 100%
          try {
            const targetVolume = room.volume || 100;
            await spotifyFor(roomId).setVolume(targetVolume, deviceId);
            routineServerLog(`🔊 Restored volume to ${targetVolume}% on resume`);
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
        routineServerLog(`⏮️ Previous button clicked at position: ${currentPosition}ms in room:`, roomId);
        
        // Clear existing timer
        clearRoomTimer(roomId);
        
        // If we're in the first second of the song, go to previous song
        // Otherwise, restart the current song from the beginning
        if (currentPosition <= 1000) {
          routineServerLog('📍 Position ≤ 1 second, going to previous song');
          if (room.playlistSongs && room.currentSongIndex > 0) {
            room.currentSongIndex = room.currentSongIndex - 1;
          } else if (room.playlistSongs) {
            room.currentSongIndex = room.playlistSongs.length - 1;
          }
        } else {
          routineServerLog('📍 Position > 1 second, restarting current song');
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
        routineServerLog('🔀 Shuffling playlist in room:', roomId);
        if (room.playlistSongs) {
          // Use proper Fisher-Yates shuffle function
          room.playlistSongs = properShuffle(room.playlistSongs);
          room.currentSongIndex = 0;
          routineServerLog('✅ Playlist shuffled successfully with proper Fisher-Yates algorithm');
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
        routineServerLog(`🔁 Repeat mode ${room.repeatMode ? 'enabled' : 'disabled'} in room:`, roomId);
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
            routineServerLog(`📣 Reveal-call: Using last played song as fallback: "${song.name}"`);
          }
        }
        
        // If still no song, try using currentSongIndex
        if (!song && room.currentSongIndex !== undefined && room.currentSongIndex >= 0) {
          const index = Math.min(room.currentSongIndex, room.playlistSongs.length - 1);
          song = room.playlistSongs[index];
          if (song) {
            routineServerLog(`📣 Reveal-call: Using song at currentSongIndex ${index} as fallback: "${song.name}"`);
          }
        }
        
        // Last resort: use first song in playlist (for reveals before any songs have played)
        if (!song) {
          song = room.playlistSongs[0];
          if (song) {
            routineServerLog(`📣 Reveal-call: Using first song in playlist as fallback: "${song.name}"`);
          }
        }
      }
      
      if (!song) {
        console.warn(`⚠️ Reveal-call: No song available in room ${roomId}. GameState: ${room.gameState}, CurrentSongIndex: ${room.currentSongIndex}, PlaylistSongs: ${room.playlistSongs?.length || 0}, CalledSongIds: ${room.calledSongIds?.length || 0}`);
        return;
      }
      routineServerLog(`📣 Reveal-call: Revealing ${hint} for song "${song.name}" by ${song.artist} in room ${roomId}`);
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
      if (VERBOSE) routineServerLog('📣 Call revealed:', payload);
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
      if (VERBOSE) routineServerLog(`🔁 Force refresh broadcast to room ${roomId} (reason=${reason})`);
    } catch (e) {
      console.error('❌ Error forcing refresh:', e?.message || e);
    }
  });

  socket.on('set-volume', async (data) => {
    const { roomId, volume } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === socket.id) {
      try {
        routineServerLog(`🔊 Setting volume to ${volume}% in room:`, roomId);
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
        routineServerLog(`⏱️ Seeking to position ${position}ms in room:`, roomId);
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
            routineServerLog(`🎯 Player ${player.name} completed bingo pattern but hasn't called it yet`);
            
            // Send notification to player that they can call bingo
            socket.emit('pattern-complete', {
              message: 'You have a bingo pattern! Hold the BINGO button to call it.',
              hasPattern: true
            });
          } else if (!validationResult.valid && player.patternComplete) {
            // Reset pattern completion flag if pattern is no longer valid (e.g., player unmarked a square)
            player.patternComplete = false;
            routineServerLog(`🎯 Player ${player.name} no longer has a valid bingo pattern`);
            
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
      routineServerLog(`📋 Rules screen shown for room ${roomId}`);
    }
  });

  socket.on('display-show-splash', (data) => {
    const { roomId } = data;
    if (roomId && rooms.has(roomId)) {
      // Hide other screens first, then show splash
      io.to(roomId).emit('display-hide-rules');
      io.to(roomId).emit('display-show-splash');
      routineServerLog(`🎬 Splash screen shown for room ${roomId}`);
    }
  });

  socket.on('display-show-call-list', (data) => {
    const { roomId } = data;
    if (roomId && rooms.has(roomId)) {
      // Hide all overlay screens to show main display (which is the call list)
      io.to(roomId).emit('display-hide-rules');
      io.to(roomId).emit('display-hide-splash');
      routineServerLog(`🎵 Main display (call list) shown for room ${roomId}`);
    }
  });

  socket.on('display-reset-letters', (data) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Only host can reset letters
    const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
    if (!isCurrentHost) return;
    
    routineServerLog(`🔤 Letter reset requested for public display in room ${roomId}`);
    io.to(roomId).emit('display-reset-letters');
  });

  // Custom song title management
  socket.on('set-custom-song-title', (data) => {
    const { songId, customTitle } = data;
    if (songId && customTitle) {
      customSongTitles.set(songId, customTitle);
      routineServerLog(`✏️ Custom title set for song ${songId}: "${customTitle}"`);
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
    routineServerLog(`User disconnected: ${socket.id}`);
    
    // Find and remove player from all rooms
    for (const [roomId, room] of rooms.entries()) {
      if (room.players.has(socket.id)) {
        const player = room.players.get(socket.id);
        room.players.delete(socket.id);
        
        routineServerLog(`Player ${player.name} left room ${roomId}`);
        
        // If the host disconnected, promote another HOST-role socket only — never the TV Display client.
        if (room.host === socket.id) {
          if (room.players.size > 0) {
            const nmLower = (n) => String(n || '').trim().toLowerCase();
            const candidates = Array.from(room.players.values()).filter(
              (p) =>
                p &&
                p.isHost === true &&
                nmLower(p.name) !== 'display'
            );
            if (candidates.length > 0) {
              const newHost = candidates[0];
              room.host = newHost.id;
              routineServerLog(`Assigned ${newHost.name} as new host for room ${roomId}`);
            } else {
              room.host = null;
              routineServerLog(
                `Host disconnected from room ${roomId}; host cleared until a host reconnects (players unchanged)`
              );
            }
          } else {
            // No players left, remove the room
            rooms.delete(roomId);
            routineServerLog(`Removed empty room: ${roomId}`);
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

/** Dedupe songs by Spotify track id (order-preserving). */
function dedupeSongsByIdPreserveOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    if (s && s.id && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}

/**
 * When the host already fetched tracks client-side, partition finalize songList by sourcePlaylistId
 * so generateBingoCards skips redundant GET /v1/playlists/{id}/items pagination (major 429 source).
 */
function playlistsWithSongsFromHostSongOrder(playlists, songOrder) {
  if (!Array.isArray(playlists) || playlists.length === 0) return null;
  if (!Array.isArray(songOrder) || songOrder.length === 0) return null;
  const byPid = new Map();
  for (const s of songOrder) {
    if (!s || typeof s !== 'object' || !s.id) return null;
    const pid = s.sourcePlaylistId != null ? String(s.sourcePlaylistId).trim() : '';
    if (!pid) return null;
    if (!byPid.has(pid)) byPid.set(pid, []);
    byPid.get(pid).push(s);
  }
  const rows = [];
  for (let i = 0; i < playlists.length; i++) {
    const pl = playlists[i];
    const pid = String(pl.id).trim();
    const songs = dedupeSongsByIdPreserveOrder(byPid.get(pid) || []);
    rows.push({ ...pl, songs, originalIndex: i });
  }
  if (!rows.every((r) => r.songs.length > 0)) return null;
  return rows;
}

/** Saved-round Start Game: use real 5 playlists + snapshot only when each playlist has ≥15 snapshot tracks (real sourcePlaylistIds). */
function snapshotSupportsFiveByFifteenStartGame(playlists, savedRoundSongs) {
  if (!Array.isArray(playlists) || playlists.length !== 5) return false;
  if (!Array.isArray(savedRoundSongs) || savedRoundSongs.length === 0) return false;
  const rows = playlistsWithSongsFromHostSongOrder(playlists, savedRoundSongs);
  if (!rows) return false;
  return rows.every((r) => Array.isArray(r.songs) && r.songs.length >= 15);
}

/**
 * Rebuild host/public `finalized-order` payload from room caches (5×15 meta + id order, 1×75 pool, or full objects).
 * Used when replaying to hosts who missed the original emit (refresh, race, skip-refinalize client path).
 */
function buildFinalizedOrderPayloadFromRoom(room) {
  if (!room || !room.mixFinalized) return [];

  const fos = room.finalizedSongOrder;
  const meta5 = room.fiveByFifteenMeta;

  if (
    meta5 &&
    typeof meta5 === 'object' &&
    Array.isArray(fos) &&
    fos.length > 0 &&
    typeof fos[0] === 'string'
  ) {
    const order = fos
      .map((id) => {
        const m = meta5[id];
        if (!m) return null;
        return {
          id,
          name: m.name || '',
          artist: m.artist || '',
          explicit: m.explicit === true,
          youtubeMusic: m.youtubeMusic === true,
          sourcePlaylistId: m.sourcePlaylistId,
          sourcePlaylistName: m.sourcePlaylistName,
        };
      })
      .filter(Boolean);
    if (order.length > 0) return order;
  }

  const ob75 = room.oneBySeventyFivePool;
  if (Array.isArray(ob75) && ob75.length > 0) {
    const idToSong = new Map();
    const addSong = (s) => {
      if (s && typeof s === 'object' && s.id) idToSong.set(s.id, s);
    };
    if (Array.isArray(room.finalizedSongOrder)) {
      for (const entry of room.finalizedSongOrder) {
        if (typeof entry === 'string') continue;
        addSong(entry);
      }
    }
    if (Array.isArray(room.finalizedSongs)) {
      for (const s of room.finalizedSongs) addSong(s);
    }
    const solePl =
      Array.isArray(room.finalizedPlaylists) && room.finalizedPlaylists.length === 1
        ? room.finalizedPlaylists[0]
        : null;
    const solePlaylistId = solePl != null && solePl.id != null ? String(solePl.id).trim() : '';
    const solePlaylistName = solePl != null && typeof solePl.name === 'string' ? solePl.name : '';

    return ob75
      .map((row) => {
        const id = row && row.id != null ? row.id : null;
        if (!id) return null;
        const s = idToSong.get(id);
        return {
          id,
          name: s?.name || '',
          artist: s?.artist || '',
          explicit: s?.explicit === true,
          youtubeMusic: s?.youtubeMusic === true,
          sourcePlaylistId:
            s?.sourcePlaylistId != null && String(s.sourcePlaylistId).trim() !== ''
              ? String(s.sourcePlaylistId)
              : solePlaylistId || undefined,
          sourcePlaylistName:
            typeof s?.sourcePlaylistName === 'string' && s.sourcePlaylistName.trim() !== ''
              ? s.sourcePlaylistName
              : solePlaylistName || undefined,
        };
      })
      .filter(Boolean);
  }

  if (Array.isArray(fos) && fos.length > 0 && typeof fos[0] === 'object') {
    return fos.map((s) => ({
      id: s.id,
      name: s.name || '',
      artist: s.artist || '',
      explicit: s.explicit === true,
      youtubeMusic: s.youtubeMusic === true,
      sourcePlaylistId: s.sourcePlaylistId != null ? String(s.sourcePlaylistId) : undefined,
      sourcePlaylistName: typeof s.sourcePlaylistName === 'string' ? s.sourcePlaylistName : undefined,
    }));
  }

  if (
    Array.isArray(fos) &&
    fos.length > 0 &&
    typeof fos[0] === 'string' &&
    Array.isArray(room.finalizedSongs)
  ) {
    const idToSong = new Map(
      room.finalizedSongs.filter((s) => s && s.id).map((s) => [s.id, s]),
    );
    return fos.map((id) => {
      const s = idToSong.get(id);
      if (!s) {
        return {
          id,
          name: '',
          artist: '',
          explicit: false,
          youtubeMusic: false,
        };
      }
      return {
        id,
        name: s.name || '',
        artist: s.artist || '',
        explicit: s.explicit === true,
        youtubeMusic: s.youtubeMusic === true,
        sourcePlaylistId: s.sourcePlaylistId != null ? String(s.sourcePlaylistId) : undefined,
        sourcePlaylistName: typeof s.sourcePlaylistName === 'string' ? s.sourcePlaylistName : undefined,
      };
    });
  }

  return [];
}

function emitFinalizedOrderFromRoomState(roomId, room) {
  try {
    const order = buildFinalizedOrderPayloadFromRoom(room);
    if (order.length > 0) {
      io.to(roomId).emit('finalized-order', { order });
      routineServerLog(`📻 finalized-order replay (${order.length} tracks) → room ${roomId}`);
      return true;
    }
  } catch (e) {
    console.warn('emitFinalizedOrderFromRoomState:', e?.message || e);
  }
  return false;
}

async function generateBingoCards(roomId, playlists, songOrder = null) {
  routineServerLog('🎲 Generating bingo cards for room:', roomId);
  const room = rooms.get(roomId);
  if (!room) {
    routineServerLog('❌ Room not found for bingo card generation');
    return false;
  }

  if (room.ownerUserId == null && room.host) {
    const hs = io.sockets.sockets.get(room.host);
    if (hs && hs.hostUserId != null) {
      room.ownerUserId = hs.hostUserId;
      routineServerLog(`📌 Room ${roomId}: ownerUserId=${room.ownerUserId} (from host socket — Spotify org key)`);
    }
  }

  try {
    routineServerLog(`📋 Playlist order received: ${playlists.map((p, i) => `${i + 1}. ${p.name}`).join(', ')}`);

    let playlistsWithSongs = playlistsWithSongsFromHostSongOrder(playlists, songOrder);

    if (playlistsWithSongs) {
      const trackTotal = playlistsWithSongs.reduce((n, pl) => n + (Array.isArray(pl.songs) ? pl.songs.length : 0), 0);
      routineServerLog(
        `📋 Using host-provided track lists (${trackTotal} songs) — skipping Spotify /items pagination for bingo`
      );
    } else {
      const ytOnly =
        (Array.isArray(playlists) && playlists.length > 0 && playlists.every((p) => p && p.youtubeMusic === true)) ||
        (Array.isArray(songOrder) &&
          songOrder.length > 0 &&
          songOrder.every((s) => s && typeof s === 'object' && s.youtubeMusic === true));

      if (ytOnly) {
        const uid = room.ownerUserId;
        if (uid == null || !youtubeMusic.hasCredentials(uid)) {
          console.error('❌ Cannot generate bingo cards: YouTube Music not connected for this host');
          return false;
        }
        routineServerLog('📋 Fetching songs from playlists via YouTube Data API...');
        playlistsWithSongs = [];
        for (let i = 0; i < playlists.length; i++) {
          const playlist = playlists[i];
          try {
            routineServerLog(`📋 [${i + 1}/${playlists.length}] Fetching YouTube items for playlist: ${playlist.name}`);
            const songs = await youtubeMusic.listPlaylistItems(uid, String(playlist.id), {
              playlistName: playlist.name || '',
            });
            routineServerLog(`✅ Found ${songs.length} videos in playlist: ${playlist.name}`);
            playlistsWithSongs.push({ ...playlist, songs, originalIndex: i });
          } catch (error) {
            console.error(`❌ Error fetching YouTube playlist ${playlist.id}:`, error);
            playlistsWithSongs.push({ ...playlist, songs: [], originalIndex: i });
          }
        }
      } else {
        const org = spotifyOrgForRoom(room);
        const tokensOk = await multiTenantSpotify.ensureOrgTokensLoaded(org);
        if (!tokensOk) {
          console.error('❌ Cannot generate bingo cards: Spotify not connected for this host');
          return false;
        }
        routineServerLog('📋 Fetching songs from playlists via Spotify Web API...');
        playlistsWithSongs = [];
        for (let i = 0; i < playlists.length; i++) {
          const playlist = playlists[i];
          try {
            routineServerLog(`📋 [${i + 1}/${playlists.length}] Fetching songs for playlist: ${playlist.name}`);
            const songs = await spotifyFor(roomId).getPlaylistTracks(playlist.id, playlist);
            routineServerLog(`✅ Found ${songs.length} songs in playlist: ${playlist.name}`);
            playlistsWithSongs.push({ ...playlist, songs, originalIndex: i });
          } catch (error) {
            console.error(`❌ Error fetching songs for playlist ${playlist.id}:`, error);
            playlistsWithSongs.push({ ...playlist, songs: [], originalIndex: i });
          }
        }
      }
    }

    const useFreeSpace = !!room.freeSpaceEnabled;
    const songsNeededPerCard = useFreeSpace ? 24 : 25;
    if (useFreeSpace) {
      routineServerLog('🆓 Free space enabled: center square (2-2) is FREE (24 song squares per card)');
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
      routineServerLog('🔍 Checking for cross-playlist duplicates in 5x15 mode...');
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
              routineServerLog(`✅ Replacement found for playlist "${pl.name}": "${song.name}" by ${song.artist}`);
            }
          }
          
          if (duplicatesFound.length > 0) {
            routineServerLog(`⚠️ Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
            duplicatesFound.forEach(dup => {
              routineServerLog(`   - Duplicate: "${dup.name}" by ${dup.artist}`);
            });
          }
          
          if (replacementsFound.length > 0) {
            routineServerLog(`✅ Playlist "${pl.name}" had ${replacementsFound.length} replacement songs added`);
            replacementsFound.forEach(rep => {
              routineServerLog(`   + Replacement: "${rep.name}" by ${rep.artist}`);
            });
          }
        } else if (duplicatesFound.length > 0) {
          // Log duplicates even if we don't need replacements
          routineServerLog(`⚠️ Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
          duplicatesFound.forEach(dup => {
            routineServerLog(`   - Duplicate: "${dup.name}" by ${dup.artist}`);
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
          routineServerLog(`✅ Successfully processed duplicates: ${totalDuplicates} removed, ${totalReplacements} replaced. All playlists still have ≥15 unique songs.`);
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

    routineServerLog(`🎯 Card generation mode: ${mode}`);

    // Keep 1×75 and 5×15 room caches mutually exclusive. Stale oneBySeventyFivePool caused
    // sync-state to emit oneby75-pool after fiveby15-pool; PublicDisplay clears column layout
    // when handling oneby75-pool — playlists looked "merged" into sequential buckets (YT + Spotify).
    const roomForMode = rooms.get(roomId);
    if (roomForMode) {
      if (mode !== '5x15') {
        roomForMode.fiveByFifteenColumnsIds = null;
        roomForMode.fiveByFifteenColumns = null;
        roomForMode.fiveByFifteenPlaylistNames = null;
        roomForMode.fiveByFifteenMeta = null;
      }
      if (mode !== '1x75') {
        roomForMode.oneBySeventyFivePool = null;
      }
    }

    // If 5x15, compute and broadcast fixed 5 columns × 15 songs for the display
    if (mode === '5x15') {
      try {
        routineServerLog(`🎯 5x15 Mode: Assigning columns based on playlist order:`);
        perListGloballyUnique.forEach((pl, idx) => {
          routineServerLog(`   Column ${idx} (left-to-right position ${idx + 1}): ${pl.name}`);
        });
        
        const fiveCols = [];
        const colNames = [];
        const metaMap = {};
        for (let col = 0; col < 5; col++) {
          // Use the globally deduplicated song pools - order matches input playlist order
          const src = properShuffle(perListGloballyUnique[col].songs).slice(0, 15);
          fiveCols.push(src);
          colNames.push(perListGloballyUnique[col].name || `Column ${col+1}`);
          routineServerLog(`   ✅ Column ${col} assigned to playlist: ${perListGloballyUnique[col].name}`);
          src.forEach(s => {
            if (s && s.id) {
              const plRow = perListGloballyUnique[col];
              metaMap[s.id] = {
                name: s.name,
                artist: s.artist,
                explicit: s.explicit === true,
                youtubeMusic: s.youtubeMusic === true,
                sourcePlaylistId:
                  s.sourcePlaylistId != null ? String(s.sourcePlaylistId) : String(plRow?.id ?? ''),
                sourcePlaylistName:
                  typeof s.sourcePlaylistName === 'string'
                    ? s.sourcePlaylistName
                    : typeof plRow?.name === 'string'
                      ? plRow.name
                      : '',
              };
            }
          });
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
          routineServerLog(`📊 Final column assignment for display:`);
          colNames.forEach((name, idx) => {
            routineServerLog(`   Column ${idx} (left-to-right position ${idx + 1}): "${name}"`);
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
            const orderWithMeta = globalOrder.map((id) => {
              const m = metaMap[id];
              return {
                id,
                name: m?.name || '',
                artist: m?.artist || '',
                explicit: m?.explicit === true,
                youtubeMusic: m?.youtubeMusic === true,
                sourcePlaylistId: m?.sourcePlaylistId,
                sourcePlaylistName: m?.sourcePlaylistName,
              };
            });
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
      routineServerLog('🎲 Building INDEPENDENT global pool for bingo cards (ignoring playback order)');
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
        routineServerLog('🎯 1x75: Using client songList order for perfect playback/card alignment');
        const allowed = new Set(perListUnique[0].songs.map(s => s.id));
        base = dedup(songOrder.filter(s => allowed.has(s.id))).slice(0, 75);
      } else {
        // Fallback: server-side shuffle (should rarely happen)
        routineServerLog('🎯 1x75: Using server-side shuffle (no client songList provided)');
        base = properShuffle(perListUnique[0].songs).slice(0, 75);
      }
      const roomRef = rooms.get(roomId);
      if (roomRef) {
        roomRef.oneBySeventyFivePool = base.map(s => ({ id: s.id }));
        routineServerLog(`✅ 1x75: Stored ${base.length} songs in oneBySeventyFivePool for card/playback alignment`);
        io.to(roomId).emit('oneby75-pool', { ids: base.map(s => s.id) });
        try {
          if (base.length > 0) {
            const solePl = Array.isArray(playlists) && playlists.length > 0 ? playlists[0] : null;
            const solePlaylistId =
              solePl != null && solePl.id != null ? String(solePl.id).trim() : '';
            const solePlaylistName =
              solePl != null && typeof solePl.name === 'string' ? solePl.name : '';
            const orderWithMeta = base.map((s) => ({
              id: s.id,
              name: s.name || '',
              artist: s.artist || '',
              explicit: s.explicit === true,
              youtubeMusic: s.youtubeMusic === true,
              sourcePlaylistId:
                s.sourcePlaylistId != null && String(s.sourcePlaylistId).trim() !== ''
                  ? String(s.sourcePlaylistId)
                  : solePlaylistId || undefined,
              sourcePlaylistName:
                typeof s.sourcePlaylistName === 'string' && s.sourcePlaylistName.trim() !== ''
                  ? s.sourcePlaylistName
                  : solePlaylistName || undefined,
            }));
            io.to(roomId).emit('finalized-order', { order: orderWithMeta });
          }
        } catch (_) {}
      }
  }

    if (mode === 'fallback') {
      try {
        const poolSongs = buildGlobalPool();
        if (poolSongs.length > 0) {
          const orderWithMeta = poolSongs.map(s => ({
            id: s.id,
            name: s.name || '',
            artist: s.artist || '',
            explicit: s.explicit === true,
            youtubeMusic: s.youtubeMusic === true,
            sourcePlaylistId: s.sourcePlaylistId != null ? String(s.sourcePlaylistId) : undefined,
            sourcePlaylistName: typeof s.sourcePlaylistName === 'string' ? s.sourcePlaylistName : undefined,
          }));
          io.to(roomId).emit('finalized-order', { order: orderWithMeta });
        }
      } catch (e) {
        console.warn('⚠️ Failed to emit finalized-order for fallback mode:', e?.message || e);
      }
  }

  const cards = new Map();
    if (!room.clientCards) room.clientCards = new Map();
  routineServerLog(`👥 Generating cards for ${room.players.size} players`);

  for (const [playerId, player] of room.players) {
    try {
      routineServerLog(`🎲 Generating card for player: ${player.name} (${playerId})`);
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
          routineServerLog(`🎯 Card for ${player.name}: Column ${col} (${playlistName}) - ${colPicks.length} songs selected`);
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
          routineServerLog(`✅ Card for ${player.name}: Built with columns in order: ${columns.map((_, idx) => perListGloballyUnique[idx].name).join(', ')}`);
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
        routineServerLog(`🎲 Generated TRULY FAIR blackout card for ${player.name} from ${pool.length} song pool`);
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
          youtubeMusic: s.youtubeMusic === true,
          ...(s.youtubeMusic === true &&
          typeof s.youtubeRawTitle === 'string' &&
          s.youtubeRawTitle.trim() !== ''
            ? { youtubeRawTitle: s.youtubeRawTitle.trim() }
            : {}),
          ...(s.youtubeMusic === true && s.catalogDisplayVerified ? { catalogDisplayVerified: true } : {}),
          marked: false
        });
      }
    }

      if (card.squares.length < 25) {
        console.error(`❌ Card incomplete for player ${player.name}: only ${card.squares.length}/25 squares`);
        continue; // Skip this player
    }

    const uniqueOnCard = new Set(card.squares.map(q => q.songId));
      routineServerLog(`✅ Generated card for ${player.name} with ${uniqueOnCard.size} unique songs (mode=${mode})`);
      routineServerLog(`🎲 Card generation method: ${mode === '5x15' ? '5x15 column-based' : mode === '1x75' ? '1x75 pool-based' : 'global pool'}`);

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
  routineServerLog(`✅ Generated ${cards.size} bingo cards for room ${roomId}`);
  routineServerLog(`📋 Players with cards: ${Array.from(cards.keys()).map(id => room.players.get(id)?.name || id).join(', ')}`);
  routineServerLog(`⚠️ Players without cards: ${Array.from(room.players.keys()).filter(id => !cards.has(id)).map(id => room.players.get(id)?.name || id).join(', ') || 'None'}`);
    return cards.size > 0;
  } catch (error) {
    console.error('❌ Error generating bingo cards:', error);
    return false;
  }
}

/** Pick 24/25 for one printable card using frozen 5×15 columns (same geometry as live cards). */
function pickChosen25ForPrintableFiveByFifteen(room, useFreeSpace) {
  const songsNeededPerCard = useFreeSpace ? 24 : 25;
  const mode5x15 =
    Array.isArray(room.fiveByFifteenColumnsIds) &&
    room.fiveByFifteenColumnsIds.length === 5 &&
    room.fiveByFifteenColumnsIds.every((col) => Array.isArray(col) && col.length >= 15);
  if (!mode5x15) return null;

  const map = buildCanonicalSongMapFromRoom(room);
  const meta =
    room.fiveByFifteenMeta && typeof room.fiveByFifteenMeta === 'object' ? room.fiveByFifteenMeta : {};
  const perListGloballyUnique = room.fiveByFifteenColumnsIds.map((colIds) =>
    colIds
      .map((id) => {
        let s = map.get(id);
        if (!s && meta[id]) {
          s = {
            id,
            name: meta[id].name || '',
            artist: meta[id].artist || '',
            explicit: meta[id].explicit === true,
            youtubeMusic: meta[id].youtubeMusic === true,
          };
        }
        return s;
      })
      .filter(Boolean),
  );

  for (let col = 0; col < 5; col++) {
    const need = useFreeSpace && col === 2 ? 4 : 5;
    if (perListGloballyUnique[col].length < need) return null;
  }

  const used = new Set();
  const columns = [];
  let ok = true;
  for (let col = 0; col < 5; col++) {
    const need = useFreeSpace && col === 2 ? 4 : 5;
    const pool = properShuffle(perListGloballyUnique[col]);
    const colPicks = [];
    for (const s of pool) {
      if (!used.has(s.id)) {
        colPicks.push(s);
        used.add(s.id);
      }
      if (colPicks.length === need) break;
    }
    if (colPicks.length < need) {
      ok = false;
      break;
    }
    columns.push(colPicks);
  }
  if (!ok) return null;

  const chosen25 = [];
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

  if (chosen25.length !== songsNeededPerCard) return null;
  return chosen25;
}

/**
 * Pick 24 or 25 songs for one extra printable card using the same geometry as generateBingoCards,
 * from pools stored on the room at finalize time (1x75, 5x15 columns, or canonical fallback pool).
 */
function pickChosen25ForPrintableCard(room, useFreeSpaceOpt) {
  const useFreeSpace =
    typeof useFreeSpaceOpt === 'boolean' ? useFreeSpaceOpt : !!room.freeSpaceEnabled;
  const songsNeededPerCard = useFreeSpace ? 24 : 25;
  const map = buildCanonicalSongMapFromRoom(room);

  const mode5x15 =
    Array.isArray(room.fiveByFifteenColumnsIds) &&
    room.fiveByFifteenColumnsIds.length === 5 &&
    room.fiveByFifteenColumnsIds.every((col) => Array.isArray(col) && col.length >= 15);
  const mode1x75 =
    Array.isArray(room.oneBySeventyFivePool) && room.oneBySeventyFivePool.length >= songsNeededPerCard;

  let chosen25 = [];

  if (mode5x15) {
    return pickChosen25ForPrintableFiveByFifteen(room, useFreeSpace);
  } else if (mode1x75) {
    const base = room.oneBySeventyFivePool
      .map((e) => map.get(typeof e === 'string' ? e : e.id))
      .filter(Boolean);
    if (base.length < songsNeededPerCard) return null;
    chosen25 = properShuffle(base).slice(0, songsNeededPerCard);
  } else {
    const pool = Array.from(map.values());
    if (pool.length < songsNeededPerCard) return null;
    chosen25 = properShuffle(pool).slice(0, songsNeededPerCard);
  }

  if (chosen25.length !== songsNeededPerCard) return null;
  return chosen25;
}

function buildPrintableCardFromChosen(chosen25, useFreeSpace, index) {
  const card = {
    id: `print-${index}-${Date.now()}`,
    printableIndex: index + 1,
    squares: [],
  };
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      if (useFreeSpace && row === 2 && col === 2) {
        card.squares.push({
          position: '2-2',
          songId: FREE_SPACE_SONG_ID,
          songName: 'FREE',
          customSongName: 'FREE',
          artistName: '',
          marked: false,
          isFreeSpace: true,
        });
        continue;
      }
      const s = chosen25[idx++];
      if (!s || !s.id) return null;
      card.squares.push({
        position: `${row}-${col}`,
        songId: s.id,
        songName: s.name,
        customSongName: customSongTitles.get(s.id) || cleanSongTitle(s.name),
        artistName: s.artist || '',
        youtubeMusic: s.youtubeMusic === true,
        ...(s.youtubeMusic === true &&
        typeof s.youtubeRawTitle === 'string' &&
        s.youtubeRawTitle.trim() !== ''
          ? { youtubeRawTitle: s.youtubeRawTitle.trim() }
          : {}),
        ...(s.youtubeMusic === true && s.catalogDisplayVerified ? { catalogDisplayVerified: true } : {}),
        marked: false,
      });
    }
  }
  if (card.squares.length !== 25) return null;
  return card;
}

/** Merge playback/finalized caches into full song rows for late-join cards. */
function buildCanonicalSongMapFromRoom(room) {
  const map = new Map();
  function addSong(s) {
    if (!s || !s.id) return;
    if (!map.has(s.id)) map.set(s.id, s);
  }
  function ingestObjects(arr) {
    if (!Array.isArray(arr)) return;
    for (const entry of arr) {
      if (entry && typeof entry === 'object' && entry.id) addSong(entry);
    }
  }
  ingestObjects(room.playlistSongs);
  ingestObjects(room.finalizedSongs);
  ingestObjects(room.finalizedSongOrder);

  const meta =
    room.fiveByFifteenMeta && typeof room.fiveByFifteenMeta === 'object' ? room.fiveByFifteenMeta : null;
  function rowFromMeta(id) {
    const m = meta && meta[id];
    if (!m) return null;
    return {
      id,
      name: m.name || '',
      artist: m.artist || '',
      explicit: m.explicit === true,
      youtubeMusic: m.youtubeMusic === true,
    };
  }
  function resolveBareId(id) {
    if (typeof id !== 'string' || map.has(id)) return;
    const fromMeta = rowFromMeta(id);
    if (fromMeta) addSong(fromMeta);
  }
  if (Array.isArray(room.finalizedSongOrder)) {
    for (const entry of room.finalizedSongOrder) {
      if (typeof entry === 'string') resolveBareId(entry);
    }
  }
  if (Array.isArray(room.oneBySeventyFivePool)) {
    for (const entry of room.oneBySeventyFivePool) {
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (id) resolveBareId(id);
    }
  }
  return map;
}

function songsForPlaylistFromRoomCache(room, playlistId) {
  const pid = String(playlistId);
  const map = buildCanonicalSongMapFromRoom(room);
  const out = [];
  for (const s of map.values()) {
    if (s.sourcePlaylistId != null && String(s.sourcePlaylistId) === pid) out.push(s);
  }
  return out;
}

/** Host-provided frozen pool for saved-round playback / start-game snapshot — deduped, capped. */
function normalizeSongSnapshotForPrint(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = [];
  const seen = new Set();
  for (const item of raw.slice(0, 650)) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: typeof item.name === 'string' ? item.name : '',
      artist: typeof item.artist === 'string' ? item.artist : '',
      explicit: item.explicit === true,
      youtubeMusic: item.youtubeMusic === true,
      sourcePlaylistId: item.sourcePlaylistId != null ? String(item.sourcePlaylistId) : undefined,
      sourcePlaylistName: typeof item.sourcePlaylistName === 'string' ? item.sourcePlaylistName : undefined,
      duration: typeof item.duration === 'number' ? item.duration : undefined,
      youtubeRawTitle: typeof item.youtubeRawTitle === 'string' ? item.youtubeRawTitle : undefined,
      catalogDisplayVerified: item.catalogDisplayVerified === true,
    });
  }
  return out.length ? out : null;
}

async function fetchTracksForLateJoinPlaylist(roomId, room, playlist) {
  const cached = songsForPlaylistFromRoomCache(room, playlist.id);
  if (cached.length > 0) {
    routineServerLog(`📋 Late-join: ${cached.length} cached tracks for playlist "${playlist.name}" (${playlist.id})`);
    return cached;
  }
  if (playlist.youtubeMusic === true) {
    const uid = room.ownerUserId;
    if (uid != null && youtubeMusic.hasCredentials(uid)) {
      try {
        const tracks = await youtubeMusic.listPlaylistItems(uid, String(playlist.id), {
          playlistName: playlist.name || '',
        });
        routineServerLog(`📋 Late-join: fetched ${tracks.length} YouTube tracks for "${playlist.name}"`);
        return tracks;
      } catch (e) {
        console.error(`❌ Late-join YouTube fetch failed for ${playlist.id}:`, e?.message || e);
        return [];
      }
    }
    routineServerLog(
      `⚠️ Late-join: YouTube playlist "${playlist.name}" — no cached tracks and no YouTube token in memory for host`
    );
    return [];
  }
  try {
    const songs = await spotifyFor(roomId).getPlaylistTracks(playlist.id, playlist);
    return songs;
  } catch (error) {
    console.error(`❌ Error fetching Spotify songs for playlist ${playlist.id}:`, error);
    return [];
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
  routineServerLog(`📋 Late-join card generation using ${room.finalizedPlaylists ? 'finalized' : 'regular'} playlists`);
  routineServerLog(`📋 Playlist order: ${playlists.map((p, i) => `${i + 1}. ${p.name}`).join(', ')}`);
  
  // Build a single card using the same 1x75 / 5x15 logic used for all players
  try {
    const useFreeSpace = !!room.freeSpaceEnabled;
    const songsNeededPerCard = useFreeSpace ? 24 : 25;

    const playlistsWithSongs = [];
    for (const playlist of playlists) {
      const songs = await fetchTracksForLateJoinPlaylist(roomId, room, playlist);
      playlistsWithSongs.push({ ...playlist, songs });
    }

    let totalFetched = playlistsWithSongs.reduce((n, pl) => n + (Array.isArray(pl.songs) ? pl.songs.length : 0), 0);
    if (totalFetched === 0) {
      const flat = Array.from(buildCanonicalSongMapFromRoom(room).values());
      const plMeta = Array.isArray(room.finalizedPlaylists) ? room.finalizedPlaylists : room.playlists;
      const hinted = applyYoutubePlaybackHints(Array.isArray(plMeta) ? plMeta : [], flat);
      if (hinted.length >= songsNeededPerCard) {
        routineServerLog(`🎯 Late-join: using flat room song cache (${hinted.length} tracks, no per-playlist split)`);
        playlistsWithSongs.length = 0;
        playlistsWithSongs.push({ id: '__room_flat__', name: 'Room song cache', songs: hinted });
      }
    }

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
      routineServerLog('🔍 Late-join: Checking for cross-playlist duplicates in 5x15 mode...');
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
              routineServerLog(`✅ Late-join replacement found for playlist "${pl.name}": "${song.name}" by ${song.artist}`);
            }
          }
          
          if (duplicatesFound.length > 0) {
            routineServerLog(`⚠️ Late-join: Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
          }
          if (replacementsFound.length > 0) {
            routineServerLog(`✅ Late-join: Playlist "${pl.name}" had ${replacementsFound.length} replacement songs added`);
          }
        } else if (duplicatesFound.length > 0) {
          routineServerLog(`⚠️ Late-join: Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
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
    routineServerLog(`🎯 Late-join card mode: ${mode}`);

    const buildGlobalPool = () => {
      // CRITICAL FIX: Never use finalizedSongOrder for bingo cards in fallback mode
      // This was causing massive bias - cards were limited to songs that would play early
      routineServerLog('🎲 Late-join: Building INDEPENDENT global pool for bingo card (ignoring playback order)');
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
      routineServerLog(`🎲 Generated TRULY FAIR late-join card from ${pool.length} song pool`);
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
          youtubeMusic: s.youtubeMusic === true,
          ...(s.youtubeMusic === true &&
          typeof s.youtubeRawTitle === 'string' &&
          s.youtubeRawTitle.trim() !== ''
            ? { youtubeRawTitle: s.youtubeRawTitle.trim() }
            : {}),
          ...(s.youtubeMusic === true && s.catalogDisplayVerified ? { catalogDisplayVerified: true } : {}),
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
  routineServerLog('🎵 Starting automatic playback for room:', roomId);
  const room = rooms.get(roomId);
  if (!room) {
    routineServerLog('❌ Room not found for automatic playback');
    return;
  }

  const org = spotifyOrgForRoom(room);

  try {
    let allSongs = [];
    const perListFetched = [];
    
    if (songList && songList.length > 0) {
      // If we have a finalized song order, use it exactly (it's the source of truth)
      if (Array.isArray(room.finalizedSongOrder) && room.finalizedSongOrder.length > 0) {
        // finalizedSongOrder can be either IDs or full song objects
        const isIdArray = typeof room.finalizedSongOrder[0] === 'string';
        if (isIdArray) {
          // If it's IDs, map them to full song objects from songList
          routineServerLog('📋 Using finalizedSongOrder (IDs) to reorder songList');
          const idToSong = new Map(songList.map(s => [s.id, s]));
          const mapped = room.finalizedSongOrder.map(id => idToSong.get(id)).filter(Boolean);
          allSongs = mapped.length > 0 ? mapped : songList;
        } else {
          // If it's full objects, use them directly (they're already in the correct order)
          routineServerLog('📋 Using finalizedSongOrder (full objects) directly');
          allSongs = room.finalizedSongOrder;
        }
      } else if (Array.isArray(room.oneBySeventyFivePool) && room.oneBySeventyFivePool.length > 0) {
        // CRITICAL FIX: For 1x75 mode, use the EXACT same 75-song pool as bingo cards
        routineServerLog('📋 1x75 detected: using server-side 75-song pool to match bingo cards EXACTLY');
        const idToSong = new Map(songList.map(s => [s.id, s]));
        const mapped = room.oneBySeventyFivePool.map(poolItem => idToSong.get(poolItem.id)).filter(Boolean);
        allSongs = mapped.length > 0 ? mapped : songList;
      } else {
      // Use the song list provided by the client (already shuffled)
      routineServerLog(`📋 Using client-provided song list with ${songList.length} songs`);
      allSongs = songList;
      }
    } else {
      // Fallback: fetch songs from playlists (for backward compatibility)
      routineServerLog('📋 Fetching songs from playlists for playback...');
      for (const playlist of playlists) {
        try {
          routineServerLog(`📋 Fetching songs for playlist: ${playlist.name}`);
          const songs = await spotifyFor(roomId).getPlaylistTracks(playlist.id, playlist);
          routineServerLog(`✅ Found ${songs.length} songs in playlist: ${playlist.name}`);
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
        routineServerLog('🔍 Playback: Applying cross-playlist deduplication for 5x15 mode...');
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
                routineServerLog(`✅ Playback replacement found for playlist "${pl.name}": "${song.name}" by ${song.artist}`);
              }
            }
            
            if (duplicatesFound.length > 0) {
              routineServerLog(`⚠️ Playback: Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
            }
            if (replacementsFound.length > 0) {
              routineServerLog(`✅ Playback: Playlist "${pl.name}" had ${replacementsFound.length} replacement songs added`);
            }
          } else if (duplicatesFound.length > 0) {
            routineServerLog(`⚠️ Playback: Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
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
            picks.forEach(s => {
              if (s && s.id) {
                metaMap[s.id] = {
                  name: s.name,
                  artist: s.artist,
                  explicit: s.explicit === true,
                  youtubeMusic: s.youtubeMusic === true,
                };
              }
            });
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
            routineServerLog('🎼 Using finalized 5x15 global shuffled order (75 songs) from IDs');
          } else {
            allSongs = room.finalizedSongOrder;
            routineServerLog('🎼 Using finalized 5x15 global shuffled order (75 songs) from full objects');
          }
        }
      } catch (e) {
        console.warn('⚠️ Failed to align playback with 5x15 columns:', e?.message || e);
      }
    }

    routineServerLog(`📊 Total songs available: ${allSongs.length}`);

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
        .map((entry) => {
          const id = typeof entry === 'string' ? entry : entry && entry.id;
          if (!id) return null;
          if (seenIds.has(id)) {
            routineServerLog(`⚠️ Skipping duplicate ID in finalizedSongOrder: ${id}`);
            return null;
          }
          seenIds.add(id);
          return idToSong.get(id);
        })
        .filter(Boolean);
      if (orderedSongs.length > 0) {
        routineServerLog(`🎯 Reordering allSongs to match finalizedSongOrder (${orderedSongs.length} unique songs)`);
        allSongs = orderedSongs;
      }
    }

    allSongs = applyYoutubePlaybackHints(playlists, allSongs);

    const needsSpotifyTransport = allSongs.some((s) => !songUsesYoutubePlayback(s));
    const playlistHasYoutube = allSongs.some((s) => songUsesYoutubePlayback(s));
    if (needsSpotifyTransport) {
      const tokensOk = await multiTenantSpotify.ensureOrgTokensLoaded(org);
      if (!tokensOk) {
        console.error('❌ Cannot start playback: Spotify not connected for this host (no tokens in memory or DB)');
        io.to(roomId).emit('playback-error', {
          message: 'Spotify is not connected for this host. Open Connection and connect Spotify, then try Start Game again.',
        });
        return;
      }
      await spotifyFor(roomId).ensureValidToken();
    } else {
      routineServerLog('🎬 YouTube-only mix — Spotify Web API not required for playback transport');
    }

    // Store the song list in the room for ordered playback
    room.playlistSongs = allSongs;
    room.currentSongIndex = 0;
    room.gameState = 'playing';
    routineServerLog(`📝 Stored ${allSongs.length} songs in room ${roomId} for ordered playback`);
    routineServerLog(`📋 First 5 songs in order: ${allSongs.slice(0, 5).map(s => `${s.name} (${s.id})`).join(', ')}`);
    
    // Spotify-only: build a temp playlist in the background for reliable context on song 2+.
    // Do not await creation before first play — each Web API call is paced (~550ms default), so
    // create+add-items alone costs >1s before audio; first track uses URIs + repeat 'track' immediately.
    if (needsSpotifyTransport && !playlistHasYoutube) {
      try {
        void spotifyFor(roomId)
          .deleteAllGameOfTonesOutputPlaylists()
          .catch((clearErr) => {
            console.warn(
              '⚠️ Deferred GOT output playlist cleanup failed (non-fatal):',
              clearErr?.message || clearErr
            );
          });
        const trackUris = allSongs.map((song) => `spotify:track:${song.id}`);
        const playlistName = `TEMPO Bingo Room ${roomId} - ${new Date().toISOString().slice(0, 16)}`;
        room.temporaryPlaylistId = null;
        void (async () => {
          try {
            const id = await spotifyFor(roomId).createTemporaryPlaylist(playlistName, trackUris);
            const r = rooms.get(roomId);
            if (r && r.gameState === 'playing') {
              r.temporaryPlaylistId = id;
              routineServerLog(`🎼 Background temp playlist ready: ${id} (${trackUris.length} tracks)`);
            }
          } catch (err) {
            console.warn(
              '⚠️ Background temp playlist failed (per-track playback continues):',
              err?.message || err
            );
          }
        })();
        routineServerLog(`📋 Queued background playlist; first track via URIs (first 5): ${trackUris.slice(0, 5).join(', ')}`);
      } catch (error) {
        console.warn('⚠️ Failed to queue temporary playlist, falling back to individual track playback:', error);
        room.temporaryPlaylistId = null;
      }
    } else {
      room.temporaryPlaylistId = null;
      if (playlistHasYoutube && needsSpotifyTransport) {
        routineServerLog('🎬 Mixed Spotify + YouTube list — skipping temporary Spotify playlist (per-track playback)');
      }
    }

    // Play the first song from the list
    const firstSong = allSongs[0];
    routineServerLog(`🎵 Playing song 1/${allSongs.length}: ${firstSong.name} by ${firstSong.artist}`);

    let targetDeviceId = deviceId;
    if (!targetDeviceId && needsSpotifyTransport) {
      const savedDevice = loadSavedDeviceForRoom(roomId);
      if (savedDevice) {
        targetDeviceId = savedDevice.id;
        routineServerLog(`🎵 Using saved device for playback: ${savedDevice.name}`);
      }
    }

    if (songUsesYoutubePlayback(firstSong)) {
      const startMsYt = computeSnippetRandomStartMs(room, firstSong);
      room.currentSongStartMs = startMsYt;
      room.calledSongIds = Array.isArray(room.calledSongIds) ? room.calledSongIds : [];
      room.calledSongIds.push(firstSong.id);
      room.currentSong = {
        id: firstSong.id,
        name: firstSong.name,
        artist: firstSong.artist,
        explicit: firstSong.explicit === true,
        youtubeMusic: true,
      };
      try {
        const r = rooms.get(roomId);
        if (r) r.songStartAtMs = Date.now() - (startMsYt || 0);
      } catch {}
      io.to(roomId).emit('song-playing', buildSongPlayingPayload(room, firstSong, 0));
      syncRoomStateAfterSongStart(roomId, room);
      sendPlayerCardUpdates(roomId, true);
      routineServerLog(`✅ Started automatic playback (YouTube host browser): ${firstSong.name} by ${firstSong.artist}`);
      startSimpleProgression(roomId, targetDeviceId || '', room.snippetLength);
      return;
    }

    if (!targetDeviceId) {
      console.error('❌ Strict mode: no locked device available for playback');
      io.to(roomId).emit('playback-error', { message: 'Locked device not available. Open Spotify on your chosen device or reselect in Host.' });
      return;
    }

    routineServerLog(`🎵 Starting playback on device: ${targetDeviceId}`);

    let startMs = 0;
    try {
      // Prefer transfer first (saves one paced GET /me/player/devices when the device is already valid).
      let transferred = false;
      try {
        await spotifyFor(roomId).transferPlayback(targetDeviceId, false);
        transferred = true;
      } catch (e) {
        routineServerLog('⚠️ transfer-first failed; resolving device list…', e?.body?.error?.message || e?.message || e);
      }
      if (!transferred) {
        const devices = await spotifyFor(roomId).getUserDevices();
        const deviceInList = devices.find((d) => d.id === targetDeviceId);
        if (!deviceInList) {
          routineServerLog('⚠️ Locked device not in list; attempting activation...');
          await spotifyFor(roomId).activateDevice(targetDeviceId);
        }
        await spotifyFor(roomId).transferPlayback(targetDeviceId, false);
      }
      // Skip-based queue clearing removed to avoid context hijacks
      // Enforce deterministic playback mode to avoid context/radio fallbacks with delays
      try { await spotifyFor(roomId).withRetries('setShuffle(false)', () => spotifyFor(roomId).setShuffleState(false, targetDeviceId), { attempts: 2, backoffMs: 200 }); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
      // First track always starts via URIs (temp playlist, if any, is still building asynchronously)
      await new Promise(resolve => setTimeout(resolve, 100));
      startMs = computeSpotifySnippetRandomStartMs(room, firstSong, 'auto first');
      routineServerLog(`🎯 Starting first song with randomized offset: ${startMs}ms (${Math.floor(startMs / 1000)}s) mode=${room.randomStarts}`);
      
      await spotifyFor(roomId).withRetries('startPlayback(initial)', () => spotifyFor(roomId).startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], startMs), { attempts: 3, backoffMs: 400 });
      try {
        await spotifyFor(roomId).withRetries('setRepeat(track,initial)', () => spotifyFor(roomId).setRepeatState('track', targetDeviceId), { attempts: 2, backoffMs: 200 });
      } catch (_) {}
      routineServerLog(`✅ Successfully started playback on device: ${targetDeviceId}`);
      try { 
        const r = rooms.get(roomId); 
        if (r) {
          r.songStartAtMs = Date.now() - (startMs || 0);
          r.currentSongStartMs = startMs; // Store for restart correction
        }
      } catch {}
      
      // Brief settle before volume API (shorter than historical 800ms — audio already started)
      await new Promise(resolve => setTimeout(resolve, 400));
      
      // Set initial volume to 100% (or room's saved volume)
      try {
        const initialVolume = room.volume || 100;
        await spotifyFor(roomId).withRetries('setVolume(initial)', () => spotifyFor(roomId).setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
        routineServerLog(`🔊 Set initial volume to ${initialVolume}%`);
      } catch (volumeError) {
        console.error('❌ Error setting initial volume:', volumeError);
      }
    } catch (playbackError) {
      console.error('❌ Error starting playback in strict mode:', playbackError);
      const message = playbackError?.body?.error?.message || playbackError?.message || '';
      if (/token expired/i.test(message)) {
        routineServerLog('🔄 Token expired, refreshing and retrying...');
        try {
          await spotifyFor(roomId).refreshAccessToken();
          // Re-check device after refresh
          const devicesAfter = await spotifyFor(roomId).getUserDevices();
          const stillMissing = !devicesAfter.find(d => d.id === targetDeviceId);
          if (stillMissing) {
            routineServerLog('⚠️ Locked device still missing after refresh; attempting activation...');
            await spotifyFor(roomId).activateDevice(targetDeviceId);
          }
          await spotifyFor(roomId).withRetries('transferPlayback(after-refresh)', () => spotifyFor(roomId).transferPlayback(targetDeviceId, false), { attempts: 3, backoffMs: 300 });
          // Skip-based queue clearing removed to avoid context hijacks
          await spotifyFor(roomId).withRetries('startPlayback(after-refresh)', () => spotifyFor(roomId).startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], startMs), { attempts: 3, backoffMs: 400 });
          try {
            await spotifyFor(roomId).withRetries('setRepeat(track,after-refresh)', () => spotifyFor(roomId).setRepeatState('track', targetDeviceId), { attempts: 2, backoffMs: 200 });
          } catch (_) {}
          routineServerLog(`✅ Successfully started playback after token refresh`);
          try {
            const r = rooms.get(roomId);
            if (r) {
              r.songStartAtMs = Date.now() - (startMs || 0);
              r.currentSongStartMs = startMs;
            }
          } catch {}
          
          await new Promise(resolve => setTimeout(resolve, 400));
          
          // Set initial volume to 100% (or room's saved volume)
          try {
            const initialVolume = room.volume || 100;
            await spotifyFor(roomId).withRetries('setVolume(after-refresh)', () => spotifyFor(roomId).setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
            routineServerLog(`🔊 Set initial volume to ${initialVolume}% after token refresh`);
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
      explicit: firstSong.explicit === true,
    };

    io.to(roomId).emit('song-playing', buildSongPlayingPayload(room, firstSong, 0));
    syncRoomStateAfterSongStart(roomId, room);
    sendPlayerCardUpdates(roomId, true);

    routineServerLog(`✅ Started automatic playback in room ${roomId}: ${firstSong.name} by ${firstSong.artist} on device ${targetDeviceId}`);

    routineServerLog(`🚀 Starting simplified playback control for room ${roomId}`);
    startSimpleProgression(roomId, targetDeviceId, room.snippetLength);

    // Verify playback actually started and is the correct track; attempt resume/correct if needed
    try {
      let playing = false;
      let correctTrack = false;
      for (let i = 0; i < 2; i++) {
        await new Promise(r => setTimeout(r, 220));
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
        routineServerLog(`🔧 Verification failed (playing=${playing}, correctTrack=${correctTrack}), correcting with startMs=${startMs}ms`);
        try { 
          if (room.temporaryPlaylistId) {
            await spotifyFor(roomId).startPlaybackFromPlaylist(targetDeviceId, room.temporaryPlaylistId, 0, startMs);
          } else {
            await spotifyFor(roomId).startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], startMs);
            try {
              await spotifyFor(roomId).setRepeatState('track', targetDeviceId);
            } catch (_) {}
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

  } catch (error) {
    console.error('❌ Error starting automatic playback:', error);
  }
}

async function playNextSong(roomId, deviceId) {
  routineServerLog('🎵 PLAY NEXT SONG CALLED for room:', roomId, 'deviceId:', deviceId);
  const room = rooms.get(roomId);
  if (!room || room.gameState !== 'playing' || !room.playlistSongs) {
    routineServerLog(`❌ Cannot play next song: Room not in playing state or no playlist songs`);
    routineServerLog(`❌ Room exists: ${!!room}, GameState: ${room?.gameState}, HasPlaylistSongs: ${!!room?.playlistSongs}`);
    routineServerLog(`❌ Room details: ${JSON.stringify({
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
      routineServerLog('🔁 Repeat mode: staying on current song');
    } else {
      // If we're at the end, end the game instead of wrapping
      if (room.currentSongIndex + 1 >= room.playlistSongs.length) {
        routineServerLog('🏁 Playlist complete. Ending game for room', roomId);
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
    routineServerLog(`🎵 Playing song ${room.currentSongIndex + 1}/${room.playlistSongs.length}: ${nextSong.name} by ${nextSong.artist}`);

    if (songUsesYoutubePlayback(nextSong)) {
      const startMsYt = computeSnippetRandomStartMs(room, nextSong);
      room.currentSongStartMs = startMsYt;
      room.calledSongIds = Array.isArray(room.calledSongIds) ? room.calledSongIds : [];
      room.calledSongIds.push(nextSong.id);
      room.currentSong = {
        id: nextSong.id,
        name: nextSong.name,
        artist: nextSong.artist,
        explicit: nextSong.explicit === true,
        youtubeMusic: true,
      };
      try {
        const r = rooms.get(roomId);
        if (r) r.songStartAtMs = Date.now() - (startMsYt || 0);
      } catch {}
      io.to(roomId).emit('song-playing', buildSongPlayingPayload(room, nextSong, room.currentSongIndex));
      syncRoomStateAfterSongStart(roomId, room);
      sendPlayerCardUpdates(roomId, true);
      routineServerLog(`✅ Playing next song (YouTube host browser): ${nextSong.name}`);
      const devPass = deviceId || room.selectedDeviceId || loadSavedDeviceForRoom(roomId)?.id || '';
      const playbackDuration = room.snippetLength * 1000;
      setRoomTimer(roomId, async () => {
        clearRoomTimer(roomId);
        playNextSong(roomId, devPass);
      }, playbackDuration);
      return;
    }

    // STRICT device control: use provided device or saved device only
    let targetDeviceId = deviceId;
    if (!targetDeviceId) {
      const savedDevice = loadSavedDeviceForRoom(roomId);
      if (savedDevice) {
        targetDeviceId = savedDevice.id;
        routineServerLog(`🎵 Using saved device for next song: ${savedDevice.name}`);
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
          if (VERBOSE) routineServerLog('🔒 Already on locked device; skipping transfer');
        }
      } catch (_) {}
      if (needTransfer) {
        await spotifyFor(roomId).withRetries('transferPlayback(next)', () => spotifyFor(roomId).transferPlayback(targetDeviceId, false), { attempts: 3, backoffMs: 300 });
        // Skip-based queue clearing removed to avoid context hijacks
      }
    } catch (e) {
      console.warn('⚠️ Transfer playback failed (will still try play):', e?.message || e);
    }
    routineServerLog(`🎵 Starting playback on device: ${targetDeviceId}`);

    try {
      // Ensure device still visible; attempt activation if not
      const devices = await spotifyFor(roomId).getUserDevices();
      const deviceInList = devices.find(d => d.id === targetDeviceId);
      if (!deviceInList) {
        routineServerLog('⚠️ Locked device not in list before next song; attempting activation...');
        await spotifyFor(roomId).activateDevice(targetDeviceId);
      }

      const playbackStartTime = Date.now();
      routineServerLog(`🎵 Starting Spotify playback for: ${nextSong.name}`);
      // Enforce deterministic playback mode on each advance with delays
      try { await spotifyFor(roomId).withRetries('setShuffle(false,next)', () => spotifyFor(roomId).setShuffleState(false, targetDeviceId), { attempts: 2, backoffMs: 200 }); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 200));
      // Reset repeat to 'off' before advancing (clears any previous 'track' repeat)
      try { await spotifyFor(roomId).withRetries('setRepeat(off,next)', () => spotifyFor(roomId).setRepeatState('off', targetDeviceId), { attempts: 2, backoffMs: 200 }); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 200));
      const startMs = computeSpotifySnippetRandomStartMs(room, nextSong, 'playNextSong');
      // Use playlist context if available, otherwise fall back to individual track
      if (room.temporaryPlaylistId) {
        routineServerLog(`🎼 Playing next song from playlist context at index ${room.currentSongIndex}`);
        await spotifyFor(roomId).withRetries('startPlaybackFromPlaylist(next)', () => spotifyFor(roomId).startPlaybackFromPlaylist(targetDeviceId, room.temporaryPlaylistId, room.currentSongIndex, startMs), { attempts: 3, backoffMs: 400 });
      } else {
        await spotifyFor(roomId).withRetries('startPlayback(next)', () => spotifyFor(roomId).startPlayback(targetDeviceId, [`spotify:track:${nextSong.id}`], startMs), { attempts: 3, backoffMs: 400 });
      }
      const playbackEndTime = Date.now();
      routineServerLog(`✅ Successfully started playback on device: ${targetDeviceId}`);
      
      // Stabilization delay to prevent context hijacks from volume changes
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Set initial volume to 100% (or room's saved volume) with single retry
            try {
              const initialVolume = room.volume || 100;
        await spotifyFor(roomId).withRetries('setVolume(next)', () => spotifyFor(roomId).setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
        routineServerLog(`🔊 Set initial volume to ${initialVolume}%`);
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

    routineServerLog(`✅ Playing next song in room ${roomId}: ${nextSong.name} by ${nextSong.artist} on device ${targetDeviceId}`);

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
    routineServerLog(`⏰ Setting next song timer for room ${roomId}: ${playbackDuration}ms (${room.snippetLength}s full duration)`);
    setRoomTimer(roomId, async () => {
      const transitionTime = Date.now();
      if (VERBOSE) routineServerLog(`🔄 TRANSITION STARTING - Room: ${roomId}, Time: ${transitionTime}`);
      if (VERBOSE) routineServerLog(`🔄 Song ending: ${nextSong.name} by ${nextSong.artist}`);
      
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
    
    routineServerLog(`📋 Real-time update: Sent ${Object.keys(playerCardsData).length} player cards to host(s) in room ${roomId}`);
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

function normalizeLinesRequiredSrv(raw) {
  const x = parseInt(raw, 10);
  if (!Number.isFinite(x)) return 1;
  return Math.min(12, Math.max(1, Math.round(x)));
}

function sanitizeCustomPatternNameSrv(raw) {
  if (raw == null) return '';
  const s = String(raw).trim().slice(0, 80);
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function patternExtrasForClient(room) {
  const pat = room?.pattern || 'line';
  if (pat === 'line') {
    return { linesRequired: normalizeLinesRequiredSrv(room.linesRequired) };
  }
  if (pat === 'custom') {
    return {
      customMatchAllowRotation: !!room.customPatternAllowRotation,
      customMatchAllowMirror: !!room.customPatternAllowMirror,
      customPatternName: room.customPatternName || '',
    };
  }
  return {};
}

function listCompletedLinesPlayedStrict(card, isMarkedSquareValid) {
  const out = [];
  for (let row = 0; row < 5; row++) {
    const positions = [];
    let ok = true;
    for (let col = 0; col < 5; col++) {
      const pos = `${row}-${col}`;
      positions.push(pos);
      const sq = card.squares.find((s) => s.position === pos);
      if (!isMarkedSquareValid(sq)) ok = false;
    }
    if (ok) out.push({ type: `Row ${row + 1}`, positions });
  }
  for (let col = 0; col < 5; col++) {
    const positions = [];
    let ok = true;
    for (let row = 0; row < 5; row++) {
      const pos = `${row}-${col}`;
      positions.push(pos);
      const sq = card.squares.find((s) => s.position === pos);
      if (!isMarkedSquareValid(sq)) ok = false;
    }
    if (ok) out.push({ type: `Column ${col + 1}`, positions });
  }
  const d1 = [0, 1, 2, 3, 4].map((i) => `${i}-${i}`);
  if (d1.every((pos) => isMarkedSquareValid(card.squares.find((s) => s.position === pos)))) {
    out.push({ type: 'Diagonal (top-left to bottom-right)', positions: d1 });
  }
  const d2 = [0, 1, 2, 3, 4].map((i) => `${i}-${4 - i}`);
  if (d2.every((pos) => isMarkedSquareValid(card.squares.find((s) => s.position === pos)))) {
    out.push({ type: 'Diagonal (top-right to bottom-left)', positions: d2 });
  }
  return out;
}

function unionLineWinningPositions(lineObjs) {
  const s = new Set();
  for (const o of lineObjs) {
    for (const p of o.positions) s.add(p);
  }
  return Array.from(s);
}

function checkBingoWithPlayedSongs(card, playedSongIds, linesRequiredRaw) {
  const isMarkedSquareValid = (square) =>
    square && square.marked && (square.isFreeSpace || playedSongIds.includes(square.songId));
  const need = normalizeLinesRequiredSrv(linesRequiredRaw != null ? linesRequiredRaw : 1);
  const completed = listCompletedLinesPlayedStrict(card, isMarkedSquareValid);
  if (completed.length >= need) {
    const used = completed.slice(0, need);
    const winningPositions = unionLineWinningPositions(used);
    const type = need === 1 ? used[0].type : `${need} lines`;
    return {
      valid: true,
      type,
      winningPositions,
      completedLineCount: completed.length,
    };
  }
  return {
    valid: false,
    type: null,
    winningPositions: [],
    completedLineCount: completed.length,
  };
}

const COMPOSITE_PRESET_KEYS = new Set([
  'line',
  'four_corners',
  'x',
  't',
  'l',
  'u',
  'plus',
  'full_card',
]);

function normalizeCompositeMatchVariants(raw) {
  const ALLOWED = new Set(['rotateCw', 'rotateCcw', 'rotate180', 'flipH', 'flipV']);
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    if (typeof x === 'string' && ALLOWED.has(x) && !out.includes(x)) out.push(x);
    if (out.length >= 8) break;
  }
  return out;
}

function readOrientationBoolSrv(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(s);
  }
  return false;
}

function deriveCompositeOrientationFlags(c) {
  let rot = readOrientationBoolSrv(c.matchAllowRotation);
  let mir = readOrientationBoolSrv(c.matchAllowMirror);
  const legacy = normalizeCompositeMatchVariants(c.matchVariants);
  for (const t of legacy) {
    if (t === 'rotateCw' || t === 'rotateCcw' || t === 'rotate180') rot = true;
    if (t === 'flipH' || t === 'flipV') mir = true;
  }
  return { rot, mir };
}

/** Same semantics as client `clauseOrientationTransforms`. */
function compositeClauseTransformsFromClause(clause) {
  const { rot, mir } = deriveCompositeOrientationFlags(clause);
  const acc = [];
  if (rot) acc.push('rotateCw', 'rotate180', 'rotateCcw');
  if (mir) acc.push('flipH', 'flipV');
  return normalizeCompositeMatchVariants(acc);
}

function parseRcComposite(pos) {
  const [a, b] = String(pos).split('-').map(Number);
  return [a, b];
}

/** Rotate/mirror positions on 5×5 grid — mirrors patternDefinitions.transformPositions */
function transformGridPositions(positions, t) {
  const out = new Set();
  for (const pos of positions) {
    if (!/^[0-4]-[0-4]$/.test(pos)) continue;
    let [r, c] = parseRcComposite(pos);
    switch (t) {
      case 'rotateCw':
        [r, c] = [c, 4 - r];
        break;
      case 'rotateCcw':
        [r, c] = [4 - c, r];
        break;
      case 'rotate180':
        [r, c] = [4 - r, 4 - c];
        break;
      case 'flipH':
        c = 4 - c;
        break;
      case 'flipV':
        r = 4 - r;
        break;
      default:
        break;
    }
    out.add(`${r}-${c}`);
  }
  return Array.from(out).sort();
}

function expandCompositeShapeVariants(baseSorted, transforms) {
  const tArr = Array.isArray(transforms) ? transforms : [];
  const masks = new Map();
  const keyFn = (m) => m.slice().join('|');
  const add = (arr) => {
    const sorted = [...arr].sort();
    masks.set(keyFn(sorted), sorted);
  };
  add(baseSorted);
  for (const t of tArr) {
    add(transformGridPositions(baseSorted, t));
  }
  return [...masks.values()];
}

function customPatternOrientationTransformsSrv(room) {
  const rot = readOrientationBoolSrv(room && room.customPatternAllowRotation);
  const mir = readOrientationBoolSrv(room && room.customPatternAllowMirror);
  const acc = [];
  if (rot) acc.push('rotateCw', 'rotate180', 'rotateCcw');
  if (mir) acc.push('flipH', 'flipV');
  return normalizeCompositeMatchVariants(acc);
}

function patternCompositeForClient(room) {
  return room && room.pattern === 'composite' && room.patternComposite ? room.patternComposite : null;
}

function normalizePatternComposite(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const op = raw.op === 'and' || raw.op === 'or' ? raw.op : null;
  if (!op || !Array.isArray(raw.clauses)) return null;
  const clauses = [];
  for (const c of raw.clauses) {
    if (!c || typeof c !== 'object') continue;
    if (c.kind === 'preset' && typeof c.preset === 'string') {
      let preset = c.preset === 'blackout' ? 'full_card' : c.preset;
      if (!COMPOSITE_PRESET_KEYS.has(preset)) continue;
      if (preset === 'line') {
        const lr = normalizeLinesRequiredSrv(c.linesRequired);
        clauses.push({
          kind: 'preset',
          preset,
          ...(lr !== 1 ? { linesRequired: lr } : {}),
        });
        continue;
      }
      if (preset === 'full_card') {
        clauses.push({ kind: 'preset', preset });
        continue;
      }
      const { rot, mir } = deriveCompositeOrientationFlags(c);
      clauses.push({
        kind: 'preset',
        preset,
        ...(rot ? { matchAllowRotation: true } : {}),
        ...(mir ? { matchAllowMirror: true } : {}),
      });
    } else if (c.kind === 'mask' && Array.isArray(c.positions)) {
      const mask = [
        ...new Set(c.positions.filter((p) => typeof p === 'string' && /^[0-4]-[0-4]$/.test(p))),
      ];
      if (mask.length === 0) continue;
      const { rot, mir } = deriveCompositeOrientationFlags(c);
      clauses.push({
        kind: 'mask',
        positions: mask.sort(),
        ...(rot ? { matchAllowRotation: true } : {}),
        ...(mir ? { matchAllowMirror: true } : {}),
      });
    }
  }
  if (clauses.length === 0 || clauses.length > 12) return null;
  return { op, clauses };
}

function positionsFromLineBingoType(type) {
  if (!type || typeof type !== 'string') return [];
  if (type.startsWith('Row')) {
    const rowNum = parseInt(type.replace('Row ', ''), 10) - 1;
    const positions = [];
    for (let col = 0; col < 5; col++) positions.push(`${rowNum}-${col}`);
    return positions;
  }
  if (type.startsWith('Column')) {
    const colNum = parseInt(type.replace('Column ', ''), 10) - 1;
    const positions = [];
    for (let row = 0; row < 5; row++) positions.push(`${row}-${colNum}`);
    return positions;
  }
  if (type.includes('top-left to bottom-right')) {
    return [0, 1, 2, 3, 4].map((i) => `${i}-${i}`);
  }
  if (type.includes('top-right to bottom-left')) {
    return [0, 1, 2, 3, 4].map((i) => `${i}-${4 - i}`);
  }
  return [];
}

const COMPOSITE_SHAPE_BASE = {
  four_corners: ['0-0', '0-4', '4-0', '4-4'],
  x: ['0-0', '1-1', '2-2', '3-3', '4-4', '0-4', '1-3', '3-1', '4-0'],
  t: ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2'],
  l: ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4'],
  u: ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3'],
  plus: ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2'],
};

const COMPOSITE_SHAPE_LABEL = {
  four_corners: 'Four corners',
  x: 'X pattern',
  t: 'T pattern',
  l: 'L pattern',
  u: 'U pattern',
  plus: 'Plus pattern',
};

function validateCompositeClauseResult(card, playedSongIds, clause, isMarkedSquareValid) {
  if (!clause || typeof clause !== 'object') {
    return { valid: false, reason: 'Invalid clause', positions: [] };
  }

  function tryMaskVariants(baseSorted, transforms, okReason, failReason) {
    const variants = expandCompositeShapeVariants(baseSorted, transforms);
    for (const mask of variants) {
      const invalid = [];
      for (const pos of mask) {
        const sq = card.squares.find((s) => s.position === pos);
        if (!isMarkedSquareValid(sq)) invalid.push(pos);
      }
      if (invalid.length === 0) return { valid: true, reason: okReason, positions: mask };
    }
    return { valid: false, reason: failReason, positions: [] };
  }

  if (clause.kind === 'mask' && Array.isArray(clause.positions)) {
    const base = [...clause.positions].sort();
    const transforms = compositeClauseTransformsFromClause(clause);
    if (transforms.length === 0) {
      const invalid = [];
      for (const pos of base) {
        const sq = card.squares.find((s) => s.position === pos);
        if (!isMarkedSquareValid(sq)) invalid.push(pos);
      }
      if (invalid.length > 0) {
        return {
          valid: false,
          reason: `Painted shape needs ${invalid.length} more squares marked with played songs`,
          positions: [],
        };
      }
      return { valid: true, reason: 'Painted shape complete', positions: base };
    }
    return tryMaskVariants(
      base,
      transforms,
      'Painted shape complete',
      'Painted shape incomplete — no chosen orientation fully marked with played songs yet',
    );
  }

  if (clause.kind !== 'preset' || typeof clause.preset !== 'string') {
    return { valid: false, reason: 'Invalid clause', positions: [] };
  }
  const p = clause.preset;
  if (p === 'line') {
    const need = normalizeLinesRequiredSrv(clause.linesRequired);
    const lineResult = checkBingoWithPlayedSongs(card, playedSongIds, need);
    if (!lineResult.valid) {
      const msg =
        need > 1
          ? `Need ${need} complete lines with played songs (have ${lineResult.completedLineCount})`
          : 'No complete line with played songs';
      return { valid: false, reason: msg, positions: [] };
    }
    const positions =
      Array.isArray(lineResult.winningPositions) && lineResult.winningPositions.length > 0
        ? lineResult.winningPositions
        : positionsFromLineBingoType(lineResult.type);
    return {
      valid: true,
      reason: `Line (${lineResult.type})`,
      positions,
    };
  }
  if (p === 'full_card' || p === 'blackout') {
    if (!validateBingoCardGrid(card)) {
      return { valid: false, reason: 'Invalid bingo card grid', positions: [] };
    }
    const positions = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) positions.push(`${row}-${col}`);
    }
    let invalidCount = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const square = card.squares.find((s) => s.position === `${row}-${col}`);
        if (!isMarkedSquareValid(square)) invalidCount++;
      }
    }
    if (invalidCount > 0) {
      return { valid: false, reason: 'Full card incomplete', positions: [] };
    }
    return { valid: true, reason: 'Full card complete', positions };
  }

  const baseShape = COMPOSITE_SHAPE_BASE[p];
  const shapeLabel = COMPOSITE_SHAPE_LABEL[p];
  if (!baseShape || !shapeLabel) {
    return { valid: false, reason: 'Unknown sub-pattern', positions: [] };
  }
  const transforms = compositeClauseTransformsFromClause(clause);
  const sortedBase = [...baseShape].sort();
  if (transforms.length === 0) {
    const invalid = sortedBase.filter((pos) => {
      const sq = card.squares.find((s) => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      let msg = `${shapeLabel} incomplete — need ${invalid.length} more squares`;
      if (p === 'four_corners') {
        msg = `Four corners incomplete — need ${invalid.length} more corners`;
      } else if (p === 'x') {
        msg = `X pattern incomplete — ${invalid.length} diagonal squares left`;
      }
      return { valid: false, reason: msg, positions: [] };
    }
    return { valid: true, reason: `${shapeLabel}`, positions: sortedBase };
  }
  return tryMaskVariants(
    sortedBase,
    transforms,
    `${shapeLabel} complete`,
    `${shapeLabel} incomplete — no matching orientation yet`,
  );
}

function validateBingoCompositePattern(card, playedSongIds, composite, isMarkedSquareValid) {
  const op = composite && composite.op;
  const clauses = composite && composite.clauses;
  if (!op || !Array.isArray(clauses) || clauses.length === 0) {
    return { valid: false, reason: 'Combined pattern is not configured' };
  }
  if (op === 'or') {
    const fails = [];
    for (const cl of clauses) {
      const r = validateCompositeClauseResult(card, playedSongIds, cl, isMarkedSquareValid);
      if (r.valid) {
        return {
          valid: true,
          reason: `Win: ${r.reason}`,
          type: 'Composite',
          winningPositions: r.positions,
        };
      }
      fails.push(r.reason);
    }
    return {
      valid: false,
      reason: `No winning combination (${fails.slice(0, 2).join(' · ')})`,
    };
  }
  const union = [];
  for (const cl of clauses) {
    const r = validateCompositeClauseResult(card, playedSongIds, cl, isMarkedSquareValid);
    if (!r.valid) {
      return { valid: false, reason: `Combined (all): ${r.reason}`, type: 'Composite' };
    }
    union.push(...r.positions);
  }
  const winningPositions = [...new Set(union)];
  return {
    valid: true,
    reason: 'Combined pattern (all parts) complete!',
    type: 'Composite',
    winningPositions,
  };
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
    logger.debug(`🎯 Added current song to validation list: ${room.currentSong.name} (${room.currentSong.id})`);
  }
  
  logger.debug(`🎯 Validating bingo for pattern: "${pattern}" (room pattern: "${room?.pattern}")`);
  logger.debug(`🎯 Played songs count: ${playedSongIds.length}`);
  logger.debug(`🎯 Called song IDs (last 10): ${JSON.stringify(playedSongIds.slice(-10))}`);
  logger.debug(`🎯 Card has ${card.squares.length} squares, ${card.squares.filter(s => s.marked).length} marked`);
  
  // Debug: Show card song IDs vs played song IDs
  const cardSongIds = card.squares.map(s => s.songId);
  const markedCardSongIds = card.squares.filter(s => s.marked).map(s => s.songId);
  logger.debug(`🎯 Card song IDs (first 10): ${JSON.stringify(cardSongIds.slice(0, 10))}`);
  logger.debug(`🎯 Marked card song IDs (first 10): ${JSON.stringify(markedCardSongIds.slice(0, 10))}`);
  
  // Helper function to check if a marked square corresponds to a played song (or free space)
  const isMarkedSquareValid = (square) => {
    const isValid = square && square.marked && (square.isFreeSpace || playedSongIds.includes(square.songId));
    if (!isValid && square && square.marked) {
      logger.debug(
        `🎯 Invalid marked square: ${square.position} - songId: ${square.songId}, marked: ${square.marked}, inPlayedList: ${playedSongIds.includes(square.songId)}`
      );
    }
    return isValid;
  };

  if (pattern === 'composite' && room?.patternComposite) {
    return validateBingoCompositePattern(card, playedSongIds, room.patternComposite, isMarkedSquareValid);
  }

  if (pattern === 'custom' && room?.customPattern && room.customPattern.size > 0) {
    const baseSorted = Array.from(room.customPattern).sort();
    const transforms = customPatternOrientationTransformsSrv(room);
    const variants = expandCompositeShapeVariants(baseSorted, transforms);
    for (const mask of variants) {
      const bad = [];
      for (const pos of mask) {
        const sq = card.squares.find((s) => s.position === pos);
        if (!isMarkedSquareValid(sq)) bad.push(pos);
      }
      if (bad.length === 0) {
        return {
          valid: true,
          reason: 'Custom pattern complete!',
          type: 'custom',
          customWinningMask: mask,
        };
      }
    }
    return {
      valid: false,
      reason:
        transforms.length > 0
          ? 'Custom pattern incomplete — no allowed orientation fully marked with played songs.'
          : 'Custom pattern incomplete. Need more squares marked with played songs.',
      type: null,
      customWinningMask: null,
    };
  }
  
  if (pattern === 'full_card' || pattern === 'blackout') {
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
      logger.debug(`🎯 Cover-all validation failed (${pattern}): ${invalidCount} invalid squares`);
      logger.debug(`🎯 Invalid squares (first 5): ${JSON.stringify(invalidSquares.slice(0, 5))}`);
      const label = pattern === 'blackout' ? 'Blackout' : 'Full card';
      return { 
        valid: false, 
        reason: `${label} incomplete. Need ${invalidCount} more squares marked with played songs.`
      };
    }
    logger.debug(`🎯 Cover-all validation passed (${pattern}): all 25 squares marked with played songs`);
    const okReason = pattern === 'blackout' ? 'Blackout complete!' : 'Full card complete!';
    return { valid: true, reason: okReason };
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
  
  if (pattern === 'line') {
    const need = normalizeLinesRequiredSrv(room.linesRequired);
    const lineResult = checkBingoWithPlayedSongs(card, playedSongIds, need);
    if (lineResult.valid) {
      return {
        valid: true,
        reason:
          need === 1
            ? `Line bingo complete! (${lineResult.type})`
            : `${need}-line bingo complete!`,
        type: lineResult.type,
        lineWinningPositions: lineResult.winningPositions || [],
      };
    }
    return {
      valid: false,
      reason: `Need ${need} complete line(s) with played songs (have ${lineResult.completedLineCount}).`,
      type: null,
      lineWinningPositions: [],
    };
  }

  return { valid: false, reason: `Unsupported bingo pattern: ${pattern}` };
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
  
  if (pattern === 'composite' && Array.isArray(validationResult?.winningPositions) && validationResult.winningPositions.length > 0) {
    return validationResult.winningPositions;
  }

  if (pattern === 'custom' && Array.isArray(validationResult?.customWinningMask) && validationResult.customWinningMask.length > 0) {
    return validationResult.customWinningMask;
  }
  if (pattern === 'custom' && room?.customPattern && room.customPattern.size > 0) {
    return Array.from(room.customPattern);
  }

  if (pattern === 'line' && Array.isArray(validationResult?.lineWinningPositions) && validationResult.lineWinningPositions.length > 0) {
    return validationResult.lineWinningPositions;
  }  
  if (pattern === 'full_card' || pattern === 'blackout') {
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

/**
 * Public display: venue branding as soon as the room exists (HTTP races the socket join handshake).
 * No auth — same information shown on the projector splash; logo URL is host-configured public asset.
 */
app.get('/api/display/:roomId/venue-branding', async (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim();
    if (!roomId || roomId.length > 80) {
      return res.status(400).json({ error: 'invalid_room_id' });
    }
    const room = rooms.get(roomId);
    if (!room) {
      return res.json({ ok: true, roomExists: false, venueBranding: null });
    }
    try {
      ensureRoomOwnerFromHostSocket(room);
      if (room.ownerUserId != null && db) {
        await resolveRoomVenueBranding(room);
      }
    } catch (e) {
      console.error('GET /api/display/:roomId/venue-branding resolve:', e?.message || e);
    }
    return res.json({
      ok: true,
      roomExists: true,
      venueBranding: venueBrandingForRoom(room),
    });
  } catch (e) {
    console.error('GET /api/display/:roomId/venue-branding', e);
    return res.status(500).json({ error: 'failed' });
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
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    // 200 + { user: null } (not 401) so the SPA "am I a host?" probe does not look like a failed request in DevTools.
    if (!uid) return res.json({ user: null });
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

/**
 * After host logout, full-page redirect target (hardening — only allow our app surfaces).
 * Used by GET /api/auth/logout; fetch + Set-Cookie often fails to clear session across origins (CORS).
 */
function getLogoutRedirectTarget(req) {
  const fallback = `${publicAppOriginOrDefault()}/`;
  const raw = (req.query && (req.query.return || req.query.next)) || '';
  if (!raw || typeof raw !== 'string') return fallback;
  const s = raw.trim();
  if (s.length > 2048) return fallback;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
    const o = u.origin;
    if (corsAllowedOrigins.includes(o)) return s;
    if (publicAppOriginForCors && o === publicAppOriginForCors) return s;
    if (/^https:\/\/[a-z0-9-]+\.liquidkourage\.com$/i.test(o)) return s;
    if (o.startsWith('https://') && /\.railway\.app$/i.test(o)) return s;
    if (o.startsWith('https://') && /\.vercel\.app$/i.test(o)) return s;
    if (/^http:\/\/localhost(:\d+)?$/.test(o) || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(o)) return s;
  } catch (e) {
    /* ignore */
  }
  return fallback;
}

app.get('/api/auth/logout', (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  hostAuth.clearSessionCookie(res);
  res.redirect(302, getLogoutRedirectTarget(req));
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
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
        patternComposite: undefined,
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

function sanitizeHostPrepRoomId(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  try {
    const s = decodeURIComponent(raw).trim();
    if (s.length === 0 || s.length > 64) return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(s)) return null;
    return s;
  } catch {
    return null;
  }
}

/** Load persisted prep rounds for this host + room (survives browser clearing site data). */
app.get('/api/host/rooms/:roomId/prep', async (req, res) => {
  try {
    const uid = await requireApprovedHostUid(req, res);
    if (!uid) return;
    if (!db) return res.status(503).json({ error: 'database_unavailable', message: 'DATABASE_URL required for cloud prep.' });
    const roomId = sanitizeHostPrepRoomId(req.params.roomId);
    if (!roomId) return res.status(400).json({ error: 'invalid_room_id' });
    const row = await hostRoomPrepStore.getHostRoomPrep(db, uid, roomId);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const updatedAt =
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt != null
          ? String(row.updatedAt)
          : new Date().toISOString();
    res.json({
      rounds: Array.isArray(p.rounds) ? p.rounds : [],
      currentRoundIndex: typeof p.currentRoundIndex === 'number' ? p.currentRoundIndex : -1,
      updatedAt,
    });
  } catch (e) {
    console.error('GET /api/host/rooms/:roomId/prep:', e?.message || e);
    res.status(500).json({ error: 'failed', message: e?.message || 'Failed to load prep' });
  }
});

/** Save prep rounds for this host + room (debounced client uploads). */
app.put('/api/host/rooms/:roomId/prep', async (req, res) => {
  try {
    const uid = await requireApprovedHostUid(req, res);
    if (!uid) return;
    if (!db) return res.status(503).json({ error: 'database_unavailable', message: 'DATABASE_URL required for cloud prep.' });
    const roomId = sanitizeHostPrepRoomId(req.params.roomId);
    if (!roomId) return res.status(400).json({ error: 'invalid_room_id' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!Array.isArray(body.rounds)) {
      return res.status(400).json({ error: 'invalid_body', message: '`rounds` array required' });
    }
    if (body.rounds.length > 64) {
      return res.status(400).json({ error: 'too_many_rounds', message: 'At most 64 rounds per save.' });
    }
    const currentRoundIndex = typeof body.currentRoundIndex === 'number' ? body.currentRoundIndex : -1;
    const payload = { v: 1, rounds: body.rounds, currentRoundIndex };
    const updatedAt = await hostRoomPrepStore.upsertHostRoomPrep(db, uid, roomId, payload);
    const iso =
      updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt != null ? String(updatedAt) : new Date().toISOString();
    res.json({ ok: true, updatedAt: iso });
  } catch (e) {
    console.error('PUT /api/host/rooms/:roomId/prep:', e?.message || e);
    res.status(500).json({ error: 'failed', message: e?.message || 'Failed to save prep' });
  }
});

/**
 * If the room was created before ownerUserId was persisted (e.g. display joined first),
 * copy hostUserId from the current host socket so venue branding and Spotify org key resolve.
 */
function ensureRoomOwnerFromHostSocket(room) {
  if (!room || room.ownerUserId != null || !room.host) return;
  try {
    const hostSocket = io.sockets.sockets.get(room.host);
    if (hostSocket && hostSocket.hostUserId != null) {
      room.ownerUserId = hostSocket.hostUserId;
      routineServerLog(`📌 Room ${room.id}: ownerUserId backfilled from host socket → ${room.ownerUserId}`);
    }
  } catch (e) {
    console.warn('ensureRoomOwnerFromHostSocket:', e?.message || e);
  }
}

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
  const { branding, orgId } = await organizationsStore.getVenueBrandingContextForHostUserId(db, uid);
  let b = branding;
  if (b && b.logoUrl && orgId != null) {
    try {
      const local = await venueLogoCache.mirroredPublicPathOrNull(b.logoUrl, orgId);
      if (local) b = { ...b, logoUrl: local };
    } catch (e) {
      console.warn('[venue-logo-cache] mirror:', e?.message || e);
    }
  }
  room.venueBranding = b;
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
/** HttpOnly cookie: host explicitly opted into Spotify Web API this browser session (survives new tabs vs sessionStorage). */
const SPOTIFY_WEB_SESSION_COOKIE = 'TempoHostSpotifyWeb';

function spotifyWebSessionCookieOpts() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 90 * 24 * 3600 * 1000,
    path: '/',
  };
}

function hasSpotifyWebSessionCookie(req) {
  return req.cookies && String(req.cookies[SPOTIFY_WEB_SESSION_COOKIE] || '') === '1';
}

function clearSpotifyWebSessionCookie(res) {
  res.clearCookie(SPOTIFY_WEB_SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}

app.use('/api/spotify', async (req, res, next) => {
  const full = (req.originalUrl || req.url || '').split('?')[0];
  const rel = (req.path || '').split('?')[0] || full.replace(/^.*\/api\/spotify/, '') || full;
  if (full.includes('/api/spotify/callback') || rel === '/callback' || rel.endsWith('/callback')) return next();
  if (req.method === 'GET' && (full.endsWith('/api/spotify/status') || rel === '/status')) return next();
  if (req.method === 'GET' && (full.endsWith('/api/spotify/link-state') || rel === '/link-state')) return next();
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (!uid) {
    return res.status(401).json({
      error: 'login_required',
      loginUrl: '/api/auth/google',
      message: 'Sign in with Google to use Spotify as a host.',
    });
  }

  const tailNorm = String(rel || '/').replace(/^\/+/, '');
  const exemptNoWebSession =
    (req.method === 'POST' && tailNorm === 'clear') ||
    (req.method === 'POST' && tailNorm === 'web-session/start') ||
    (req.method === 'GET' && tailNorm === 'auth');

  if (!exemptNoWebSession && !hasSpotifyWebSessionCookie(req)) {
    return res.status(403).json({
      error: 'spotify_web_session_required',
      message: 'Open Connection and use Connect Spotify before loading your Spotify library.',
    });
  }

  try {
    if (db) await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, uid);
  } catch (e) {
    console.error('primeTenantSpotifyCredentials:', e?.message || e);
  }
  if (spotifyPipelineLog.isEnabled() && spotifyPipelineLog.isApiRequestLogEnabled()) {
    spotifyPipelineLog.log('api_spotify_request', {
      method: req.method,
      path: rel,
      host_user_id: String(uid),
      org_key: `user_${uid}`,
    });
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

/** Marks this browser as allowed to call Spotify Web API routes until Disconnect (HttpOnly cookie). */
app.post('/api/spotify/web-session/start', async (req, res) => {
  try {
    const uid = await requireApprovedHostUid(req, res);
    if (!uid) return;
    res.cookie(SPOTIFY_WEB_SESSION_COOKIE, '1', spotifyWebSessionCookieOpts());
    res.json({ ok: true });
  } catch (error) {
    console.error('Spotify web-session/start:', error?.message || error);
    res.status(500).json({ ok: false, error: 'web_session_start_failed' });
  }
});

app.get('/api/spotify/status', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (uid != null && db) await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, uid);
    const orgId = uid != null ? `user_${uid}` : 'DEFAULT';
    const tok = multiTenantSpotify.getTokens(orgId);
    if (!tok || !tok.accessToken) {
      return res.json({ connected: false, hasTokens: false, organizationId: orgId, webApiQuarantine: { active: false } });
    }
    const svc = multiTenantSpotify.getService(orgId);
    const webApiQuarantine = svc.getWebApiQuarantineInfo();
    if (!hasSpotifyWebSessionCookie(req)) {
      return res.json({
        connected: false,
        hasTokens: true,
        organizationId: orgId,
        webApiQuarantine,
        spotifyWebSessionRequired: true,
      });
    }
    try {
      await svc.ensureValidToken();
    } catch (e) {
      console.error('Spotify status ensureValidToken:', e?.message || e);
      return res.json({
        connected: true,
        hasTokens: true,
        organizationId: orgId,
        webApiQuarantine,
        tokenRefreshError: e && e.message ? String(e.message) : 'token_refresh_failed',
      });
    }
    return res.json({ connected: true, hasTokens: true, organizationId: orgId, webApiQuarantine });
  } catch (error) {
    console.error('Spotify status error:', error);
    res.status(500).json({ 
      connected: false,
      hasTokens: false,
      error: 'Status check failed',
      webApiQuarantine: { active: false },
    });
  }
});

/** Token presence only — no ensureValidToken / no Spotify HTTP (for UI before host opts into Web API). */
app.get('/api/spotify/link-state', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (!uid) {
      return res.status(401).json({ error: 'login_required', linked: false });
    }
    if (db) await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, uid);
    const orgId = `user_${uid}`;
    const tok = multiTenantSpotify.getTokens(orgId);
    const linked = !!(tok && (tok.accessToken || tok.refreshToken));
    return res.json({ linked, organizationId: orgId });
  } catch (error) {
    console.error('Spotify link-state error:', error);
    res.status(500).json({ linked: false, error: 'link_state_failed' });
  }
});

/** Rolling estimate of api.spotify.com calls (30s) + current failsafe threshold (no extra Spotify request). */
app.get('/api/spotify/web-api-meter', (req, res) => {
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (uid == null) {
    return res.status(401).json({ error: 'login_required' });
  }
  res.json({
    windowMs: 30_000,
    estimate: spotifyWebApiMeter.getEstimateLast30s(),
    threshold: spotifyWebApiMeter.getThreshold(),
    failsafeEnabled: spotifyWebApiMeter.isFailsafeEnabled(),
  });
});

/**
 * Returns which Spotify user the stored token represents (GET /v1/me). Check in DevTools or curl; does not return email.
 */
app.get('/api/spotify/whoami', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (uid == null) {
      return res
        .status(401)
        .json({ error: 'login_required', message: 'Sign in with Google to verify Spotify account.' });
    }
    const orgId = `user_${uid}`;
    await multiTenantSpotify.ensureOrgTokensLoaded(orgId);
    const svc = spotifyForRequest(req);
    if (!svc) {
      return res.status(401).json({ error: 'login_required' });
    }
    if (!multiTenantSpotify.getTokens(orgId)) {
      return res.status(401).json({
        error: 'spotify_not_connected',
        message: 'Connect Spotify on the host screen first.',
        organizationId: orgId,
      });
    }
    if (svc.isQuarantined()) {
      return res.status(429).json({
        error: 'spotify_rate_limited',
        message: 'Spotify API quarantine active (recent 429).',
        retryAfterSec: svc.getQuarantineRemainingSec(),
        webApiQuarantine: svc.getWebApiQuarantineInfo(),
      });
    }
    const me = await svc.getCurrentUserProfileBrief();
    return res.json({
      success: true,
      organizationId: orgId,
      source: 'https://api.spotify.com/v1/me',
      spotifyUserId: me.spotifyUserId,
      displayName: me.displayName,
      product: me.product,
      country: me.country,
      hint: 'In development mode, this Spotify user id must be among users allowed in the Spotify app dashboard.',
    });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
    console.error('GET /api/spotify/whoami:', error);
    return res
      .status(500)
      .json({ error: 'whoami_failed', message: error?.message || 'Failed to load Spotify profile' });
  }
});

/**
 * Direct probe of api.spotify.com (bypasses in-process 429 quarantine). Open in a browser while
 * signed in as a host (same site cookie) — no command line. Add ?playlists=1 to also call playlists.
 * Compare with /api/spotify/whoami when isolating our quarantine vs Spotify.
 */
app.get('/api/spotify/diagnostic-raw', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (uid == null) {
      return res.status(401).json({
        error: 'login_required',
        message: 'Sign in with Google, then open this URL again in the same browser.',
      });
    }
    const orgId = `user_${uid}`;
    const ok = await multiTenantSpotify.ensureOrgTokensLoaded(orgId);
    if (!ok || !multiTenantSpotify.getTokens(orgId)) {
      return res.status(400).json({
        error: 'spotify_not_connected',
        message: 'Connect Spotify from the host screen first, then use this link again.',
      });
    }
    const svc = spotifyForRequest(req);
    if (!svc) {
      return res.status(401).json({ error: 'login_required' });
    }
    try {
      await svc.ensureValidToken();
    } catch (e) {
      return res.status(401).json({
        error: 'token_refresh_failed',
        message: e && e.message ? String(e.message) : 'Could not refresh Spotify access token',
      });
    }
    const access = svc.accessToken;
    if (!access) {
      return res.status(500).json({ error: 'no_access_token' });
    }

    const withPlaylists =
      req.query.playlists === '1' || req.query.playlists === 'true' || req.query.playlists === 'yes';
    const note =
      'Bypasses TEMPO in-process 429 quarantine. status/retry-after are from api.spotify.com.';

    async function one(url) {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${access}` },
      });
      const ra = r.headers.get('retry-after') || r.headers.get('Retry-After') || null;
      const text = await r.text();
      let body;
      try {
        const j = JSON.parse(text);
        if (j && (j.id || j.error)) {
          body = j;
        } else {
          body = { _preview: text.length > 400 ? text.slice(0, 400) + '…' : text };
        }
      } catch {
        body = { _raw: text.length > 400 ? text.slice(0, 400) + '…' : text };
      }
      return { url, status: r.status, retryAfter: ra, body };
    }

    const results = [];
    results.push(await one('https://api.spotify.com/v1/me'));
    if (withPlaylists) {
      results.push(await one('https://api.spotify.com/v1/me/playlists?limit=1'));
    }

    return res.json({ ok: true, note, client_id_prefix: svc._pipelineClientIdPrefix, results });
  } catch (error) {
    console.error('GET /api/spotify/diagnostic-raw:', error);
    return res
      .status(500)
      .json({ error: 'diagnostic_raw_failed', message: error && error.message ? String(error.message) : 'error' });
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
        if (db) {
          await db.query('DELETE FROM host_spotify_playlist_list_cache WHERE organization_id = $1', [
            `user_${uid}`,
          ]);
        }
      } catch (e) {
        console.error('clear playlist list cache:', e?.message || e);
      }
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
    clearSpotifyWebSessionCookie(res);
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

function roomIdFromYoutubeMusicStatePayload(state) {
  if (!state || typeof state !== 'string') return '';
  try {
    const parts = String(state).split('.');
    if (parts.length < 2) return '';
    const seg = parts[1];
    const pad = seg.length % 4 === 0 ? '' : '='.repeat(4 - (seg.length % 4));
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (json.typ !== 'ytm_oauth' || json.rid == null || json.rid === '') return '';
    return String(json.rid).trim();
  } catch {
    return '';
  }
}

/** User-safe detail for client when token exchange or OAuth pre-check fails. */
function spotifyCallbackUserMessage(err) {
  const body = err?.body;
  const desc = body && (body.error_description || body.error);
  if (typeof desc === 'string' && desc.length > 0) {
    const s = desc.length > 220 ? `${desc.slice(0, 217)}…` : desc;
    return s;
  }
  if (err?.message && typeof err.message === 'string' && !err.message.includes('Webapi')) {
    return err.message.length > 220 ? `${err.message.slice(0, 217)}…` : err.message;
  }
  return 'Failed to connect Spotify';
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

  const rawState = state != null ? String(state).trim() : '';
  const parsed = rawState ? hostAuth.verifySpotifyOAuthState(rawState) : null;
  if (rawState && !parsed) {
    if (shouldRedirectBrowser) {
      return res.redirect(302, `${appBase}/?spotify_error=state`);
    }
    return res.status(400).json({
      success: false,
      error: 'oauth_state_expired',
      message:
        'The Spotify sign-in page was open too long, or the session was invalid. Close this tab, go back to the host room, and click Connect to Spotify again.',
    });
  }

  try {
    const redirectForGrant = parsed?.spotifyRedirectUri || null;
    if (parsed?.userId != null && db) {
      await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, parsed.userId);
    }
    if (parsed?.userId != null) {
      const copt = organizationsStore.getCredentialOptionsForUser(parsed.userId);
      const envCid = String(process.env.SPOTIFY_CLIENT_ID || '').trim();
      if (copt && copt.clientId) {
        routineServerLog(
          `[Spotify OAuth] user_${parsed.userId} token exchange: ORGANIZATION row client_id prefix ${String(
            copt.clientId
          ).slice(0, 8)}… (must match secret in same row; TEMPO_ORG_CREDENTIALS_KEY must match encrypt step)`
        );
      } else {
        routineServerLog(
          `[Spotify OAuth] user_${parsed.userId} token exchange: server ENV SPOTIFY_CLIENT_ID/SECRET${
            envCid
              ? ` (client_id prefix ${envCid.slice(0, 8)}…)`
              : ' (SPOTIFY_CLIENT_ID unset — fix Railway)'
          }`
        );
      }
      if (spotifyPipelineLog.isEnabled()) {
        spotifyPipelineLog.log('oauth_code_exchange', {
          host_user_id: String(parsed.userId),
          org_key: `user_${parsed.userId}`,
          client_source: copt && copt.clientId ? 'organizations_table' : 'env',
          client_id_prefix: spotifyPipelineLog.clientIdPrefix(
            copt && copt.clientId ? copt.clientId : process.env.SPOTIFY_CLIENT_ID
          ),
        });
      }
    }
    // New OAuth must not reuse a SpotifyService that is still in 429 quarantine: getService()
    // returns the same instance until invalidated; fresh tokens on a quarantined instance keep
    // /api/spotify/* returning 429 without calling api.spotify.com (playlists, devices, etc.).
    if (parsed?.userId != null) {
      multiTenantSpotify.invalidateUserService(parsed.userId);
    }
    const svc =
      parsed?.userId != null
        ? multiTenantSpotify.getService(`user_${parsed.userId}`)
        : spotifyServiceDefault;
    const tokens = await svc.handleCallback(code, redirectForGrant);
    if (parsed && parsed.userId != null) {
      await multiTenantSpotify.setTokens(`user_${parsed.userId}`, tokens);
      if (spotifyPipelineLog.isEnabled()) {
        spotifyPipelineLog.log('oauth_callback_tokens_stored', {
          org_key: `user_${parsed.userId}`,
          host_user_id: String(parsed.userId),
        });
      }
    } else {
      await multiTenantSpotify.setTokens('DEFAULT', tokens);
    spotifyTokens = tokens;
    saveTokens(tokens);
      if (spotifyPipelineLog.isEnabled()) {
        spotifyPipelineLog.log('oauth_callback_tokens_stored', { org_key: 'DEFAULT' });
      }
    }

    if (shouldRedirectBrowser) {
      const room =
        (parsed?.roomId && String(parsed.roomId)) ||
        (state ? roomIdFromSpotifyStatePayload(String(state)) : '');
      const path = room ? `/host/${encodeURIComponent(room)}` : '/';
      res.cookie(SPOTIFY_WEB_SESSION_COOKIE, '1', spotifyWebSessionCookieOpts());
      return res.redirect(302, `${appBase}${path}?spotify=connected`);
    }

    res.cookie(SPOTIFY_WEB_SESSION_COOKIE, '1', spotifyWebSessionCookieOpts());
    res.json({ success: true, message: 'Spotify connected' });
  } catch (error) {
    const detail = spotifyCallbackUserMessage(error);
    if (spotifyPipelineLog.isEnabled()) {
      spotifyPipelineLog.log('oauth_callback_fail', { message: detail });
    }
    console.error('❌ Spotify callback failed:', error?.body || error?.message || error);
    if (shouldRedirectBrowser) {
      return res.redirect(302, `${appBase}/?spotify_error=1`);
    }
    res.status(500).json({
      success: false,
      error: 'Failed to connect Spotify',
      message: detail,
    });
  }
});

// --- YouTube Music (library via Google APIs; host playback in browser is a separate milestone) ---
app.get('/api/youtube/music/status', (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    res.json({
      success: true,
      configured: youtubeMusic.isConfigured(),
      connected: uid != null && youtubeMusic.hasCredentials(uid),
    });
  } catch (_) {
    res.status(500).json({ success: false, error: 'status_failed' });
  }
});

app.get('/api/youtube/music/callback', async (req, res) => {
  const { code, state } = req.query;

  const appBase = publicAppOrigin();
  const wantsJson = spotifyCallbackWantsJson(req);
  const shouldRedirectBrowser = appBase && !wantsJson;

  if (!youtubeMusic.isConfigured()) {
    if (shouldRedirectBrowser) {
      return res.redirect(302, `${appBase}/?youtube_music_error=not_configured`);
    }
    return res.status(503).json({
      success: false,
      error: 'youtube_music_not_configured',
      message: 'Server is missing YouTube Music OAuth credentials.',
    });
  }

  if (!code) {
    if (shouldRedirectBrowser) {
      return res.redirect(302, `${appBase}/?youtube_music_error=missing_code`);
    }
    return res.status(400).json({ error: 'Authorization code required' });
  }

  const rawState = state != null ? String(state).trim() : '';
  const parsed = rawState ? hostAuth.verifyYoutubeMusicOAuthState(rawState) : null;
  if (!parsed) {
    if (shouldRedirectBrowser) {
      return res.redirect(302, `${appBase}/?youtube_music_error=state`);
    }
    return res.status(400).json({
      success: false,
      error: 'oauth_state_expired',
      message:
        'The Google sign-in page was open too long, or the session was invalid. Close this tab, go back to the host room, and connect again.',
    });
  }

  try {
    await youtubeMusic.handleCallback(String(code), parsed.userId);
    if (shouldRedirectBrowser) {
      const room =
        (parsed.roomId && String(parsed.roomId)) ||
        (rawState ? roomIdFromYoutubeMusicStatePayload(rawState) : '');
      const path = room ? `/host/${encodeURIComponent(room)}` : '/';
      return res.redirect(302, `${appBase}${path}?youtube_music=connected`);
    }
    res.json({ success: true, message: 'YouTube Music connected' });
  } catch (error) {
    console.error('❌ YouTube Music callback failed:', error?.message || error);
    if (shouldRedirectBrowser) {
      return res.redirect(302, `${appBase}/?youtube_music_error=1`);
    }
    res.status(500).json({
      success: false,
      error: 'Failed to connect YouTube Music',
      message: typeof error?.message === 'string' ? error.message : 'token_exchange_failed',
    });
  }
});

app.use('/api/youtube/music', (req, res, next) => {
  const full = (req.originalUrl || req.url || '').split('?')[0];
  if (full.includes('/api/youtube/music/callback')) return next();
  if (req.method === 'GET' && full.endsWith('/status')) return next();
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (!uid) {
    return res.status(401).json({
      error: 'login_required',
      loginUrl: '/api/auth/google',
      message: 'Sign in with Google to connect YouTube Music for this host.',
    });
  }
  next();
});

app.get('/api/youtube/music/auth-url', (req, res) => {
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (!uid) {
    return res.status(401).json({ error: 'login_required', loginUrl: '/api/auth/google' });
  }
  if (!youtubeMusic.isConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'youtube_music_not_configured',
      message:
        'Set YOUTUBE_MUSIC_GOOGLE_CLIENT_ID and YOUTUBE_MUSIC_GOOGLE_CLIENT_SECRET for YouTube Music hosting.',
    });
  }
  const roomId = typeof req.query.roomId === 'string' ? req.query.roomId.trim() : '';
  try {
    const url = youtubeMusic.generateAuthUrl(uid, roomId || null);
    res.json({ success: true, url });
  } catch (e) {
    console.error('YouTube Music auth-url:', e?.message || e);
    res.status(500).json({ success: false, error: 'auth_url_failed' });
  }
});

app.get('/api/youtube/music/playlists', async (req, res) => {
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (!uid) return res.status(401).json({ error: 'login_required' });
  try {
    const playlists = await youtubeMusic.listMyPlaylists(uid);
    res.json({ success: true, playlists });
  } catch (e) {
    const sc = e && e.statusCode;
    if (sc === 401) {
      return res.status(401).json({
        success: false,
        error: 'youtube_not_connected',
        message: 'Connect YouTube Music first.',
      });
    }
    console.error('YouTube Music playlists:', e?.message || e);
    res.status(500).json({ success: false, error: 'playlists_failed' });
  }
});

/** Full video list for a host-owned playlist (same shape as Spotify playlist-tracks `tracks`). */
app.get('/api/youtube/music/playlist/:playlistId/items', async (req, res) => {
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (!uid) return res.status(401).json({ error: 'login_required' });
  const { playlistId } = req.params;
  const q = req.query || {};
  const rawName = q.playlistName != null ? q.playlistName : q.name;
  const playlistName =
    rawName != null && String(rawName).trim() !== '' ? String(rawName).trim() : '';
  try {
    const tracks = await youtubeMusic.listPlaylistItems(uid, playlistId, {
      playlistName,
    });
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.json({ success: true, tracks });
  } catch (e) {
    const sc = e && e.statusCode;
    if (sc === 401) {
      return res.status(401).json({
        success: false,
        error: 'youtube_not_connected',
        message: 'Connect YouTube Music first.',
      });
    }
    if (sc === 400) {
      return res.status(400).json({
        success: false,
        error: 'bad_request',
        message: e.message || 'Invalid playlist id.',
      });
    }
    console.error('YouTube Music playlist items:', e?.message || e);
    res.status(500).json({ success: false, error: 'playlist_items_failed' });
  }
});

app.post('/api/youtube/music/disconnect', (req, res) => {
  const uid = hostAuth.getHostUserIdFromRequest(req);
  if (!uid) return res.status(401).json({ error: 'login_required' });
  youtubeMusic.clearHost(uid);
  res.json({ success: true });
});

function isSpotifyHttp429(e) {
  return !!(e && (e.statusCode === 429 || e?.body?.error?.status === 429));
}

function sendSpotify429IfNeeded(res, error) {
  if (!isSpotifyHttp429(error)) return false;
  const h = error.headers || {};
  const ra = h['retry-after'] ?? h['Retry-After'];
  const raNum = ra != null && !Number.isNaN(Number(ra)) ? Number(ra) : null;
  res.status(429).json({
    error: 'spotify_rate_limited',
    message:
      'Spotify is rate-limiting this application. Check the app in the Spotify Developer Dashboard; the server will avoid hammering the API until Retry-After elapses.',
    retryAfterSec: raNum,
  });
  return true;
}

/** Map Web API / HTTP layer errors to JSON for clients; returns true if response was sent. */
function sendSpotifyWebApiErrorIfNeeded(res, error) {
  if (sendSpotify429IfNeeded(res, error)) return true;
  const sc = Number(
    error?.statusCode ?? error?.body?.error?.status ?? error?.code ?? 0
  );
  if (!sc) return false;
  const msg =
    (error.body && error.body.error && (error.body.error.message || String(error.body.error))) ||
    error?.message ||
    'Spotify request failed';
  const payload = { error: 'spotify_error', message: msg, status: sc, details: error?.body || null };
  if (sc === 401) {
    res.status(401).json({ ...payload, error: 'spotify_unauthorized' });
    return true;
  }
  if (sc === 403) {
    res.status(403).json({ ...payload, error: 'spotify_forbidden' });
    return true;
  }
  if (sc === 404) {
    res.status(404).json({ ...payload, error: 'spotify_not_found' });
    return true;
  }
  if (sc >= 500 && sc < 600) {
    res.status(502).json({ ...payload, error: 'spotify_unavailable' });
    return true;
  }
  return false;
}

/** When TEMPO_SPOTIFY_LOG_ACCOUNT_PROOF=1, log GET /v1/me once per org (extra API call) alongside playlist proof. */
const spotifyAccountProofLoggedForOrg = new Set();

/**
 * Railway-friendly proof that Spotify returned real playlist data (no extra API calls).
 * Optional env adds one /v1/me per org for account id + display name.
 */
function logSpotifyPlaylistSuccessProof(orgId, svc, { spotifyListTotal, playlists }) {
  const rows = playlists || [];
  const sample = rows
    .slice(0, 3)
    .map((p) => (p && p.name ? String(p.name).slice(0, 80) : ''))
    .filter(Boolean);
  const sampleStr = sample.length ? ` sample_first_playlist_names=${JSON.stringify(sample)}` : '';
  const base = `✅ Spotify playlist data [${orgId}]: source=GET /v1/me/playlists spotify_paging_total=${
    spotifyListTotal ?? 'n/a'
  } returned_rows=${rows.length}${sampleStr}`;

  const wantMe =
    process.env.TEMPO_SPOTIFY_LOG_ACCOUNT_PROOF === '1' || process.env.TEMPO_SPOTIFY_LOG_ACCOUNT_PROOF === 'true';
  if (wantMe && !spotifyAccountProofLoggedForOrg.has(orgId)) {
    spotifyAccountProofLoggedForOrg.add(orgId);
    (async () => {
      try {
        const me = await svc.getCurrentUserProfileBrief();
        routineServerLog(
          `${base} | account_proof=GET /v1/me spotify_user_id=${me.spotifyUserId || 'n/a'} display_name=${JSON.stringify(
            me.displayName || ''
          )} product=${me.product || 'n/a'} country=${me.country || 'n/a'}`
        );
      } catch (e) {
        console.warn(`Spotify account proof (GET /v1/me) failed for ${orgId}:`, e?.message || e);
        routineServerLog(base);
      }
    })();
    return;
  }
  routineServerLog(base);
}

app.get('/api/spotify/playlists', async (req, res) => {
  let orgId;
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (uid == null) {
      return res.status(401).json({ error: 'login_required', message: 'Sign in with Google to load playlists.' });
    }
    orgId = `user_${uid}`;
    await multiTenantSpotify.ensureOrgTokensLoaded(orgId);
    const svc = spotifyForRequest(req);
    if (!svc) {
      return res.status(401).json({ error: 'login_required', message: 'Sign in with Google to load playlists.' });
    }
    const orgTokens = multiTenantSpotify.getTokens(orgId);
    if (!orgTokens) {
      return res.status(401).json({ 
        error: `Spotify not connected for ${orgId}`,
        organizationId: orgId,
      });
    }

    /** Host asks for live Spotify list (`?refresh=1`). Normal loads use DB cache when present — avoids redundant GET /v1/me/playlists. */
    const forceLivePlaylistList =
      String(process.env.SPOTIFY_PLAYLIST_LIST_ALWAYS_LIVE || '').trim() === '1' ||
      req.query.refresh === '1' ||
      req.query.force_refresh === '1';

    const playlistListCacheRow = await loadHostPlaylistListCache(orgId);
    const playlistListCacheUsable =
      playlistListCacheRow &&
      Array.isArray(playlistListCacheRow.playlists) &&
      playlistListCacheRow.playlists.length > 0;

    if (svc.isQuarantined()) {
      if (playlistListCacheUsable) {
        if (spotifyPipelineLog.isEnabled()) {
          spotifyPipelineLog.log('playlists_serving_from_list_cache', { org_key: orgId, reason: 'in_process_quarantine' });
        }
        return res.json({
          success: true,
          playlists: playlistListCacheRow.playlists,
          organizationId: orgId,
          spotifyListTotal:
            playlistListCacheRow.spotifyListTotal != null ? playlistListCacheRow.spotifyListTotal : undefined,
          fromSpotifyListCache: true,
          stale: true,
          cacheUpdatedAt: playlistListCacheRow.updatedAt,
          cacheMessage:
            'TEMPO is pausing Spotify calls after a recent rate limit. Showing the last library list we saved. Use Add by link below or tap Refresh Spotify library after cooldown.',
          webApiQuarantine: svc.getWebApiQuarantineInfo(),
        });
      }
      if (spotifyPipelineLog.isEnabled()) {
        spotifyPipelineLog.log('playlists_route_skip_quarantined', {
          org_key: orgId,
          host_user_id: String(uid),
          remaining_s: String(svc.getQuarantineRemainingSec()),
        });
      }
      return res.status(429).json({
        error: 'spotify_rate_limited',
        message: 'Spotify API quarantine active (recent 429). Try again after Retry-After.',
        retryAfterSec: svc.getQuarantineRemainingSec(),
        webApiQuarantine: svc.getWebApiQuarantineInfo(),
      });
    }

    if (!forceLivePlaylistList && playlistListCacheUsable) {
      if (spotifyPipelineLog.isEnabled()) {
        spotifyPipelineLog.log('playlists_serving_from_list_cache', {
          org_key: orgId,
          host_user_id: String(uid),
          reason: 'server_playlist_list_cache_no_live_fetch',
        });
      }
      return res.json({
        success: true,
        playlists: playlistListCacheRow.playlists,
        organizationId: orgId,
        spotifyListTotal:
          playlistListCacheRow.spotifyListTotal != null ? playlistListCacheRow.spotifyListTotal : undefined,
        fromSpotifyListCache: true,
        stale: true,
        cacheUpdatedAt: playlistListCacheRow.updatedAt,
        cacheMessage:
          'Showing your Spotify library list cached on Tempo (no Spotify request for this load). Tap Refresh Spotify library when you create or follow new playlists — fewer live refreshes reduce Spotify rate limits.',
        webApiQuarantine: svc.getWebApiQuarantineInfo(),
      });
    }

    if (spotifyPipelineLog.isEnabled()) {
      const copt = organizationsStore.getCredentialOptionsForUser(uid);
      spotifyPipelineLog.log('playlists_route_pre_getUserPlaylists', {
        org_key: orgId,
        host_user_id: String(uid),
        cred_map: copt === undefined ? 'unprimed' : copt === null ? 'env' : 'org_row',
        org_client_id_prefix: copt && copt.clientId ? spotifyPipelineLog.clientIdPrefix(copt.clientId) : 'n/a',
        server_env_client_id_prefix: spotifyPipelineLog.clientIdPrefix(process.env.SPOTIFY_CLIENT_ID),
        spotifyService_client_id_prefix: svc._pipelineClientIdPrefix,
        spotifyService_cred_mode: svc._pipelineCredentialMode,
        force_live_playlist_list: String(forceLivePlaylistList),
      });
    }

    const { playlists, spotifyListTotal } = await svc.getUserPlaylists();
    await saveHostPlaylistListCache(orgId, { playlists, spotifyListTotal });
    logSpotifyPlaylistSuccessProof(orgId, svc, { spotifyListTotal, playlists });

    res.json({ 
      success: true, 
      playlists,
      organizationId: orgId,
      /** Spotify PagingObject total from /v1/me/playlists (same account as the access token). */
      spotifyListTotal: spotifyListTotal != null ? spotifyListTotal : undefined,
      webApiQuarantine: svc.getWebApiQuarantineInfo(),
    });
  } catch (error) {
    if (isSpotifyHttp429(error)) {
      const cached429 = await loadHostPlaylistListCache(orgId);
      if (cached429 && Array.isArray(cached429.playlists) && cached429.playlists.length > 0) {
        if (spotifyPipelineLog.isEnabled()) {
          spotifyPipelineLog.log('playlists_serving_from_list_cache', { org_key: orgId, reason: 'spotify_429' });
        }
        return res.json({
          success: true,
          playlists: cached429.playlists,
          organizationId: orgId,
          spotifyListTotal: cached429.spotifyListTotal != null ? cached429.spotifyListTotal : undefined,
          fromSpotifyListCache: true,
          stale: true,
          cacheUpdatedAt: cached429.updatedAt,
          cacheMessage:
            'Spotify is rate-limiting the library list (GET /v1/me/playlists). Showing the last list we saved. You can add a playlist by link without listing the library, or use Refresh after cooldown.',
          webApiQuarantine: spotifyForRequest(req).getWebApiQuarantineInfo(),
        });
      }
    }
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
    console.error('Error getting playlists:', error);
    res.status(500).json({ error: 'Failed to get playlists' });
  }
});

app.post('/api/spotify/playlist-lookup', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (uid == null) {
      return res.status(401).json({ error: 'login_required', message: 'Sign in with Google first.' });
    }
    const orgId = `user_${uid}`;
    await multiTenantSpotify.ensureOrgTokensLoaded(orgId);
    if (!multiTenantSpotify.getTokens(orgId)) {
      return res.status(400).json({ error: 'spotify_not_connected', message: 'Connect Spotify from the host screen first.' });
    }
    const svc = spotifyForRequest(req);
    if (!svc) {
      return res.status(401).json({ error: 'login_required' });
    }
    const raw = req.body && (req.body.urlOrId != null ? String(req.body.urlOrId) : String(req.body.input || ''));
    const pid = parseSpotifyPlaylistIdFromUserInput(raw);
    if (!pid) {
      return res.status(400).json({
        error: 'bad_input',
        message: 'Paste a Spotify playlist link (open.spotify.com/playlist/…) or the playlist id.',
      });
    }
    const playlist = await svc.getPlaylistMetadataBrief(pid, { emergencyBypassQuarantine: true });
    return res.json({ success: true, playlist });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
    console.error('POST /api/spotify/playlist-lookup:', error);
    res.status(500).json({ error: 'playlist_lookup_failed', message: error && error.message ? String(error.message) : 'error' });
  }
});

app.get('/api/spotify/playlists/:playlistId/tracks', async (req, res) => {
  try {
    const { playlistId } = req.params;
    const tracks = await spotifyForRequest(req).getPlaylistTracks(playlistId);
    res.json(tracks);
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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

    const spotifyReq = spotifyForRequest(req);
    if (spotifyReq && spotifyReq.isQuarantined()) {
      return res.status(429).json({
        error: 'spotify_rate_limited',
        message: 'Spotify API quarantine active (recent 429).',
        retryAfterSec: spotifyReq.getQuarantineRemainingSec(),
        webApiQuarantine: spotifyReq.getWebApiQuarantineInfo(),
      });
    }
    routineServerLog(`📱 Fetching available Spotify devices (org ${orgId})...`);
    const devices = await spotifyForRequest(req).getUserDevices();
    let currentPlayback = null;
    try {
      currentPlayback = await spotifyForRequest(req).getCurrentPlaybackState();
    } catch (_) {}
    const currentDevice = currentPlayback?.device || null;
    
    const savedDevice = loadSavedDeviceForUser(uid);
    
    if (devices.length === 0) {
      routineServerLog('⚠️  No devices found - user may need to open Spotify on a device');
    } else {
      routineServerLog(`✅ Found ${devices.length} devices:`);
      devices.forEach(device => {
        const status = device.is_active ? '🟢 Active' : '⚪ Inactive';
        const isSaved = savedDevice && savedDevice.id === device.id ? ' 💾 Saved' : '';
        routineServerLog(`  - ${device.name} (${device.type}) ${status}${isSaved}`);
      });
    }
    
    // If we have a saved device but it's not in the current list, add it
    let allDevices = [...devices];
    if (savedDevice && !devices.find(d => d.id === savedDevice.id)) {
      routineServerLog(`📁 Adding saved device to list: ${savedDevice.name}`);
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    routineServerLog(`💾 Device saved: ${device.name} (${device.id})`);
    
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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

    routineServerLog(`🔀 Transfer request to device ${deviceId} (play=${!!play})`);
    await spotifyForRequest(req).ensureValidToken();

    // Verify device presence; attempt activation if missing
    const devices = await spotifyForRequest(req).getUserDevices();
    const found = devices.find(d => d.id === deviceId);
    if (!found) {
      routineServerLog('⚠️ Target device not in list; attempting activation...');
      const activated = await spotifyForRequest(req).activateDevice(deviceId);
      if (!activated) {
        return res.status(404).json({ success: false, error: 'Device not available; open Spotify on that device and try again' });
      }
    }

    await spotifyForRequest(req).transferPlayback(deviceId, !!play);
    routineServerLog(`✅ Transferred playback to ${deviceId}`);

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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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

    routineServerLog('🔄 Attempting to force device detection...');
    
    // Use the enhanced forceDeviceActivation method
    const result = await spotifyForRequest(req).forceDeviceActivation();
    
    if (result.success) {
      routineServerLog(`✅ Device activated: ${result.device.name}`);
      res.json({ 
        success: true, 
        message: `Device activated: ${result.device.name}`,
        device: result.device
      });
    } else {
      routineServerLog('❌ No devices available for activation');
      res.status(404).json({ 
        success: false, 
        error: 'No devices available for activation',
        message: 'Please open Spotify on any device and try again'
      });
    }
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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

    routineServerLog('🔄 Refreshing Spotify access token for', orgId);
    const svc = multiTenantSpotify.getService(orgId);
    await svc.refreshAccessToken();
    await multiTenantSpotify.setTokens(orgId, {
      accessToken: svc.accessToken,
      refreshToken: svc.refreshToken || tok.refreshToken,
      expiresIn: 3600,
    });
    svc.clearRateLimitQuarantine();

    routineServerLog('✅ Spotify access token refreshed successfully');
    res.json({ success: true, message: 'Spotify connection refreshed' });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    
    routineServerLog(`🔊 Setting volume to ${volume}% on device: ${deviceId}`);
    
    await spotifyForRequest(req).ensureValidToken();
    await spotifyForRequest(req).setVolume(volume, deviceId);
    
    // Save volume to room state if roomId is provided
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.volume = volume;
        routineServerLog(`💾 Saved volume ${volume}% to room ${roomId}`);
      }
    }
    
    routineServerLog('✅ Volume set successfully');
    res.json({ success: true, message: 'Volume updated' });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    
    routineServerLog(`⏩ Seeking to position ${position}ms on device: ${deviceId}`);
    
    await spotifyForRequest(req).ensureValidToken();
    await spotifyForRequest(req).seekToPosition(position, deviceId);
    
    routineServerLog('✅ Seek successful');
    res.json({ success: true, message: 'Seek completed' });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    const s = spotifyForRequest(req);
    if (s && s.isQuarantined() && s.getQuarantineRemainingSec() > 0) {
      return res.status(429).json({
        success: false,
        error: 'spotify_rate_limited',
        retryAfterSec: s.getQuarantineRemainingSec(),
      });
    }
    await s.ensureValidToken();
    const playback = await s.getCurrentPlaybackState();
    res.json({ success: true, playbackState: playback || null });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    
    const svc = spotifyForRequest(req);
    await svc.ensureValidToken();
    
    // If the host already has the name (e.g. from the library), skip an extra getPlaylist() Web API call.
    const q = req.query || {};
    const rawName = q.playlistName != null ? q.playlistName : q.name;
    const nameFromClient =
      rawName != null && String(rawName).trim() !== '' ? String(rawName).trim() : '';
    let playlistInfo = null;
    if (nameFromClient) {
      playlistInfo = { id: playlistId, name: nameFromClient };
    } else {
    try {
        const playlistResponse = await svc.spotifyApi.getPlaylist(playlistId);
      playlistInfo = {
        id: playlistResponse.body.id,
        name: playlistResponse.body.name
      };
    } catch (error) {
      console.warn('⚠️ Could not fetch playlist info for', playlistId, ':', error.message);
      // Continue without playlist info
      }
    }
    
    const tracks = await svc.getPlaylistTracks(playlistId, playlistInfo);

    // Dynamic per-host Spotify data — discourage proxy/browser caching of playlist payloads (was showing as 304 + tiny transfer in DevTools).
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    
    res.json({
      success: true,
      tracks: tracks
    });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
    console.error('❌ Error getting playlist tracks:', error);
    res.status(500).json({ error: 'Failed to get playlist tracks' });
  }
});

/**
 * LK-owned catalog Spotify account — playlist summaries (allowlisted ids only).
 * Host Google session required; does not use the host’s Spotify token.
 */
app.get('/api/spotify/catalog/packs', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (uid == null) {
      return res.status(401).json({ error: 'login_required', message: 'Sign in with Google first.' });
    }
    if (catalogSpotify.isCatalogPublicFetchDisabled()) {
      routineServerLog(
        '[catalog] GET /api/spotify/catalog/packs: TEMPO_CATALOG_PUBLIC_FETCH_DISABLED — not calling Spotify'
      );
      return res.json({
        success: true,
        configured: false,
        packs: [],
        catalogPublicFetchDisabled: true,
      });
    }
    if (!catalogSpotify.isCatalogFeatureConfigured()) {
      return res.json({ success: true, configured: false, packs: [] });
    }

    const cacheKey = catalogSpotify.getCatalogPackSummariesCacheKey();
    const ttlMs = readCatalogPacksServerCacheTtlMs();

    if (db && ttlMs > 0) {
      const cached = await loadCatalogPackSummariesCacheRow(cacheKey);
      if (cached && Array.isArray(cached.data.packs)) {
        const ageMs = Date.now() - cached.updatedAtMs;
        if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < ttlMs) {
          routineServerLog(
            `[catalog] GET /api/spotify/catalog/packs: ${cached.data.packs.length} pack(s) from Postgres cache (${Math.round(ageMs / 1000)}s old, ttl ${Math.round(ttlMs / 1000)}s)`
          );
          return res.json({
            success: true,
            configured: true,
            packs: cached.data.packs,
            catalogPrefixDiscoverySkipped: cached.data.catalogPrefixDiscoverySkipped,
            fromCatalogServerCache: true,
            catalogCacheUpdatedAt: cached.updatedAtIso,
          });
        }
      }
    }

    let catalogResult;
    try {
      catalogResult = await catalogSpotify.loadCatalogPackSummariesForApi();
    } catch (fetchErr) {
      if (db) {
        const stale = await loadCatalogPackSummariesCacheRow(cacheKey);
        if (stale && Array.isArray(stale.data.packs) && stale.data.packs.length > 0) {
          routineServerLog(
            '[catalog] GET /api/spotify/catalog/packs: live fetch failed — returning stale Postgres cache'
          );
          return res.json({
            success: true,
            configured: true,
            packs: stale.data.packs,
            catalogPrefixDiscoverySkipped: stale.data.catalogPrefixDiscoverySkipped,
            fromCatalogServerCache: true,
            catalogCacheStale: true,
            catalogCacheUpdatedAt: stale.updatedAtIso,
          });
        }
      }
      throw fetchErr;
    }

    if (db && catalogResult && Array.isArray(catalogResult.packs)) {
      await persistCatalogPackSummariesToPostgresIfAllowed(catalogResult);
    }

    const packs = catalogResult.packs;
    const catalogPrefixDiscoverySkipped = catalogResult.catalogPrefixDiscoverySkipped === true;
    if (packs.length === 0) {
      routineServerLog(
        catalogPrefixDiscoverySkipped
          ? '[catalog] GET /api/spotify/catalog/packs: 0 packs — prefix discovery skipped (Spotify rate limit / quarantine); use static ids or retry later'
          : '[catalog] GET /api/spotify/catalog/packs: configured but 0 packs — check TEMPO_CATALOG_PLAYLIST_NAME_PREFIX / allowlist / playlist names on the catalog Spotify account'
      );
    } else {
      routineServerLog(`[catalog] GET /api/spotify/catalog/packs: returning ${packs.length} pack(s) from Spotify`);
    }
    res.json({
      success: true,
      configured: true,
      packs,
      catalogPrefixDiscoverySkipped,
      fromCatalogServerCache: false,
    });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
    console.error('GET /api/spotify/catalog/packs:', error);
    res.status(500).json({ error: 'catalog_packs_failed', message: error?.message || 'Failed to load catalog packs' });
  }
});

/**
 * Full track list for an allowlisted catalog playlist (catalog Spotify token — not host token).
 */
app.get('/api/spotify/catalog/playlist/:playlistId/tracks', async (req, res) => {
  try {
    const uid = hostAuth.getHostUserIdFromRequest(req);
    if (uid == null) {
      return res.status(401).json({ error: 'login_required', message: 'Sign in with Google first.' });
    }
    const { playlistId } = req.params;
    const q = req.query || {};
    const rawName = q.playlistName != null ? q.playlistName : q.name;
    const nameFromClient =
      rawName != null && String(rawName).trim() !== '' ? String(rawName).trim() : '';
    const playlistInfo = nameFromClient ? { id: playlistId, name: nameFromClient } : null;
    const tracks = await catalogSpotify.fetchCatalogPlaylistTracks(playlistId, playlistInfo);
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.json({
      success: true,
      tracks,
      source: 'tempo_catalog',
    });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
    const sc = Number(error?.statusCode ?? error?.body?.error?.status ?? 0);
    const msg = error?.message || String(error);
    if (sc === 400) {
      return res.status(400).json({ error: 'catalog_allowlist', message: msg });
    }
    if (sc === 503) {
      return res.status(503).json({ error: 'catalog_unconfigured', message: msg });
    }
    console.error('GET /api/spotify/catalog/playlist/:playlistId/tracks:', error);
    res.status(500).json({ error: 'catalog_tracks_failed', message: msg });
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
    console.error('Error getting Game Of Tones playlists:', error);
    res.status(500).json({ error: 'Failed to get playlists' });
  }
});

// Delete multiple playlists
app.post('/api/spotify/delete-playlists', async (req, res) => {
  routineServerLog('🗑️ Delete playlists request received');
  try {
    const { playlistIds } = req.body;
    routineServerLog('🗑️ Request body:', { playlistIds: playlistIds?.length ? `${playlistIds.length} playlists` : 'none' });
    
    if (!hostSpotifyHasTokens(req)) {
      routineServerLog('❌ Spotify not connected');
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (!playlistIds || !Array.isArray(playlistIds) || playlistIds.length === 0) {
      routineServerLog('❌ Invalid playlistIds:', playlistIds);
      return res.status(400).json({ error: 'playlistIds array required' });
    }
    
    routineServerLog('🔑 Ensuring valid token...');
    await spotifyForRequest(req).ensureValidToken();
    
    routineServerLog('🗑️ Deleting playlists...');
    const results = await spotifyForRequest(req).deleteMultiplePlaylists(playlistIds, {
      requireGotOutputPrefix: true
    });
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    routineServerLog(`✅ Delete results: ${successful} successful, ${failed} failed`);
    
    res.json({
      success: true,
      deleted: successful,
      failed: failed,
      results: results
    });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
    console.error('❌ Error deleting playlists:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to delete playlists', details: error.message });
  }
});

// Search for tracks
app.get('/api/spotify/search-tracks', async (req, res) => {
  try {
    const { q, limit: limitQ, offset: offsetQ } = req.query;
    const limit = SpotifyService.clampSearchLimit(limitQ);
    const offset = SpotifyService.normalizeSearchOffset(offsetQ);
    
    if (!hostSpotifyHasTokens(req)) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }
    
    await spotifyForRequest(req).ensureValidToken();
    
    const tracks = await spotifyForRequest(req).searchTracks(q, limit, offset);
    
    res.json({
      success: true,
      tracks: tracks
    });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
      routineServerLog('🔍 Searching in finalizedSongOrder for song:', oldSongId);
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
      routineServerLog('❌ Song not found in any room data structure:', oldSongId);
      routineServerLog('📊 Room data structures available:', {
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
        routineServerLog(`✅ Replaced song in original playlist: ${oldSong.sourcePlaylistName}`);
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
        routineServerLog(`✅ Updated song in room.playlistSongs at index ${songIndex}`);
      }
    }
    
    // Update finalized song order if it exists (this only contains IDs, so we just replace the ID)
    if (room.finalizedSongOrder) {
      const orderIndex = room.finalizedSongOrder.indexOf(oldSongId);
      if (orderIndex !== -1) {
        room.finalizedSongOrder[orderIndex] = newSongId;
        updatedInAnyStructure = true;
        routineServerLog(`✅ Updated song ID in room.finalizedSongOrder at index ${orderIndex}`);
      }
    }
    
    // Update oneBySeventyFivePool if it exists
    if (room.oneBySeventyFivePool) {
      const poolIndex = room.oneBySeventyFivePool.findIndex(item => item.id === oldSongId);
      if (poolIndex !== -1) {
        room.oneBySeventyFivePool[poolIndex] = newSong;
        updatedInAnyStructure = true;
        routineServerLog(`✅ Updated song in room.oneBySeventyFivePool at index ${poolIndex}`);
      }
    }
    
    // Update fiveByFifteenColumns if they exist
    if (room.fiveByFifteenColumns) {
      for (let col = 0; col < room.fiveByFifteenColumns.length; col++) {
        const colIndex = room.fiveByFifteenColumns[col].findIndex(item => item.id === oldSongId);
        if (colIndex !== -1) {
          room.fiveByFifteenColumns[col][colIndex] = newSong;
          updatedInAnyStructure = true;
          routineServerLog(`✅ Updated song in room.fiveByFifteenColumns[${col}] at index ${colIndex}`);
        }
      }
    }
    
    // Update finalizedSongs if it exists (for pre-game song replacement)
    if (room.finalizedSongs) {
      const finalizedIndex = room.finalizedSongs.findIndex(item => item.id === oldSongId);
      if (finalizedIndex !== -1) {
        room.finalizedSongs[finalizedIndex] = newSong;
        updatedInAnyStructure = true;
        routineServerLog(`✅ Updated song in room.finalizedSongs at index ${finalizedIndex}`);
      }
    }
    
    if (!updatedInAnyStructure) {
      routineServerLog('⚠️ Song was found but not updated in any data structure');
    }
    
    // Broadcast the song replacement to all clients
    io.to(roomId).emit('song-replaced', {
      oldSongId,
      newSong,
      position: songIndex
    });
    
    routineServerLog(`✅ Song replaced successfully: ${oldSong.name} -> ${newSong.name}`);
    
    res.json({
      success: true,
      oldSong: oldSong,
      newSong: newSong,
      position: songIndex
    });
    
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
    console.error('Error replacing song:', error);
    res.status(500).json({ error: 'Failed to replace song', details: error.message });
  }
});

// AI-powered song suggestions for playlists
app.post('/api/spotify/suggest-songs', async (req, res) => {
  try {
    routineServerLog('🤖 AI suggestion request received');
    routineServerLog('🤖 Request body keys:', Object.keys(req.body || {}));
    try {
      routineServerLog('🤖 Request body:', JSON.stringify(req.body, null, 2));
    } catch (jsonError) {
      routineServerLog('🤖 Request body (stringify failed):', req.body);
      routineServerLog('🤖 JSON stringify error:', jsonError.message);
    }
    
    const { playlistId, playlistName, existingSongs, targetCount } = req.body || {};
    
    routineServerLog('🤖 Extracted values:', { 
      playlistId, 
      playlistName, 
      existingSongsCount: existingSongs?.length || 0, 
      targetCount 
    });
    
    if (!hostSpotifyHasTokens(req)) {
      routineServerLog('🤖 Returning Spotify not connected error');
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    await spotifyForRequest(req).ensureValidToken();
    
    routineServerLog(`🤖 Generating AI suggestions for playlist: "${playlistName}"`);
    routineServerLog(`📊 Current songs: ${existingSongs?.length || 0}, Target: ${targetCount}`);
    
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
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
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
  
  routineServerLog(`🔍 Generated ${searchQueries.length} search strategies for "${playlistName}"`);
  
  // Search for songs using multiple strategies
  const allSuggestions = [];
  const seenSongs = new Set(existingSongs.map(s => s.id));
  
  for (const query of searchQueries.slice(0, 5)) { // Limit to 5 strategies to avoid rate limits
    try {
      routineServerLog(`🎵 Searching: "${query.query}" (${query.strategy})`);
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
  
  routineServerLog(`✅ Generated ${topSuggestions.length} ranked suggestions`);
  
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
    
    routineServerLog(`▶️ Resuming playback on device: ${deviceId}`);
    
    await spotifyForRequest(req).ensureValidToken();
    await spotifyForRequest(req).resumePlayback(deviceId);
    
    routineServerLog('✅ Playback resumed successfully');
    res.json({ success: true, message: 'Playback resumed' });
  } catch (error) {
    if (sendSpotifyWebApiErrorIfNeeded(res, error)) return;
    console.error('❌ Error resuming playback:', error);
    res.status(500).json({ error: 'Failed to resume playback' });
  }
});

// Keep device active with periodic activation
function startDeviceKeepAlive() {
  routineServerLog('🔋 Starting device keep-alive (every 10 minutes)...');
  
  setInterval(async () => {
    try {
      if (spotifyTokens && spotifyTokens.accessToken) {
        if (typeof spotifyServiceDefault.isQuarantined === 'function' && spotifyServiceDefault.isQuarantined()) {
          return;
        }
        await spotifyServiceDefault.ensureValidToken();
        
        // Only activate device if no active games are playing (to avoid interrupting songs)
        const hasActiveGames = Array.from(rooms.values()).some(room => room.gameState === 'playing');
        if (!hasActiveGames) {
        await activatePreferredDevice();
        } else {
          routineServerLog('🎵 Skipping device activation - games are actively playing');
        }
      }
    } catch (error) {
      routineServerLog('⚠️ Device keep-alive failed (this is normal if no active session)');
    }
  }, 10 * 60 * 1000); // Every 10 minutes (5 was often enough activation; halves token/device churn)
}

// Start the server only after DB + tenant/catalog Spotify credential maps are primed (avoids accepting HTTP
// traffic during initializeDatabase and creating a stale catalog SpotifyService singleton).
const PORT = process.env.PORT || 7093;
(async function tempoServerBootstrap() {
  try {
    await initializeDatabase();

    if (db) {
      try {
        const r = await db.query('SELECT id FROM users WHERE organization_id IS NOT NULL');
        for (const row of r.rows) {
          await organizationsStore.primeTenantSpotifyCredentials(db, multiTenantSpotify, row.id);
        }
        const catalogCredUid = Number(process.env.TEMPO_CATALOG_SPOTIFY_CREDENTIALS_USER_ID);
        if (
          Number.isFinite(catalogCredUid) &&
          catalogCredUid > 0 &&
          catalogSpotify.isCatalogFeatureConfigured()
        ) {
          try {
            const catalogCreds = await organizationsStore.getCredentialsForUserId(db, catalogCredUid);
            if (catalogCreds && catalogCreds.clientId && catalogCreds.clientSecret) {
              catalogSpotify.primeCatalogSpotifyCredentialsFromOrg(catalogCreds);
              routineServerLog(
                `[catalog] Spotify client credentials for official packs loaded from organizations row (users.id=${catalogCredUid}); refresh token must be from this same Developer app.`
              );
            } else {
              console.warn(
                `[catalog] TEMPO_CATALOG_SPOTIFY_CREDENTIALS_USER_ID=${catalogCredUid} but no decrypted credentials for that user — pack refresh may fail with invalid_client until SPOTIFY_CLIENT_SECRET or TEMPO_CATALOG_SPOTIFY_CLIENT_SECRET is set.`
              );
            }
          } catch (catalogPrimeErr) {
            console.warn('[catalog] Failed to prime org credentials:', catalogPrimeErr?.message || catalogPrimeErr);
          }
        }
      } catch (e) {
        console.error('Startup tenant Spotify prime:', e?.message || e);
      }
    }

    if (usersStore.isApprovedHostsOnlyMode()) {
      routineServerLog(
        '🔒 TEMPO_APPROVED_HOSTS_ONLY: only allowlisted emails may sign in as hosts, create rooms, or join as host (see TEMPO_HOST_ALLOWLIST_EMAILS + host_allowlist).'
      );
    }

    server.listen(PORT, async () => {
      console.log(`🎵 TEMPO - Music Bingo server running on port ${PORT}`);
      routineServerLog('🎮 Ready for some musical bingo action!');
      routineServerLog('🚀 Cache-busting fix deployed - version 2.0');

      await autoConnectSpotify();

      startDeviceKeepAlive();

      const catalogWarmMs = readCatalogPacksBackgroundWarmIntervalMs();
      if (
        catalogWarmMs > 0 &&
        db &&
        catalogSpotify.isCatalogFeatureConfigured() &&
        !catalogSpotify.isCatalogPublicFetchDisabled()
      ) {
        routineServerLog(
          `[catalog] Background Postgres warm every ${Math.round(catalogWarmMs / 1000)}s (TEMPO_CATALOG_PACKS_BACKGROUND_WARM_MS)`
        );
        const runCatalogPackCacheWarm = async () => {
          try {
            const catalogResult = await catalogSpotify.loadCatalogPackSummariesForApi();
            await persistCatalogPackSummariesToPostgresIfAllowed(catalogResult);
          } catch (e) {
            console.warn('[catalog] Background pack cache warm failed:', e?.message || e);
          }
        };
        setTimeout(() => {
          void runCatalogPackCacheWarm();
          setInterval(runCatalogPackCacheWarm, catalogWarmMs);
        }, catalogWarmMs);
      }
    });
  } catch (bootstrapErr) {
    console.error('❌ Server bootstrap failed:', bootstrapErr?.message || bootstrapErr);
    process.exit(1);
  }
})();

// Auto-connect to Spotify on server startup (SIMPLIFIED FOR TONIGHT)
async function autoConnectSpotify() {
  routineServerLog('🔄 Attempting automatic Spotify connection (single-tenant mode)...');
  
  try {
    // Use DEFAULT organization for everyone
    const defaultTokens = multiTenantSpotify.getTokens('DEFAULT');
    if (defaultTokens && defaultTokens.accessToken && defaultTokens.refreshToken) {
      try {
        const defaultService = multiTenantSpotify.getService('DEFAULT');
        await defaultService.ensureValidToken();
        routineServerLog('✅ Restored DEFAULT Spotify connection from saved tokens');
        
        // Activate preferred device
        await activatePreferredDevice();
        routineServerLog('🎵 Ready to serve playlists and control playback');
        return true;
      } catch (error) {
        routineServerLog('❌ DEFAULT tokens are invalid, clearing...');
        multiTenantSpotify.clearOrgTokens('DEFAULT');
      }
    }
    
    routineServerLog('⚠️ Manual Spotify connection required');
    return false;
  } catch (error) {
    console.error('❌ Error in auto-connect:', error);
    return false;
  }
}

// Activate the preferred device automatically
async function activatePreferredDevice() {
  try {
    if (typeof spotifyServiceDefault.isQuarantined === 'function' && spotifyServiceDefault.isQuarantined()) {
      return;
    }
    routineServerLog('🔧 Activating preferred device...');
    
    // Get available devices
    const devices = await spotifyServiceDefault.getUserDevices();
    const savedDevice = loadSavedDevice();
    
    if (devices.length === 0) {
      routineServerLog('⚠️ No devices available, will activate when needed');
      return;
    }
    
    // Try to use saved device first, then any available device
    let targetDevice = null;
    if (savedDevice) {
      targetDevice = devices.find(d => d.id === savedDevice.id);
      if (targetDevice) {
        routineServerLog(`🎯 Found saved device: ${targetDevice.name}`);
      }
    }
    
    // If saved device not found, use first available
    if (!targetDevice && devices.length > 0) {
      targetDevice = devices[0];
      routineServerLog(`🎯 Using first available device: ${targetDevice.name}`);
    }
    
    if (targetDevice) {
      // Assert control on the device without starting playback
      try {
        await spotifyServiceDefault.transferPlayback(targetDevice.id, false);
        try { await spotifyServiceDefault.setShuffleState(false, targetDevice.id); } catch (_) {}
        try { await spotifyServiceDefault.setRepeatState('off', targetDevice.id); } catch (_) {}
        routineServerLog(`✅ Asserted control on device without playback: ${targetDevice.name}`);
          } catch (error) {
        routineServerLog(`⚠️ Could not assert control on ${targetDevice.name}, but device is available`);
      }
    }
  } catch (error) {
    console.error('❌ Error activating preferred device:', error);
  }
} 

