const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const SpotifyService = require('./spotify');
const fs = require('fs');
const path = require('path');

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

// Log CORS configuration for debugging
if (isProduction) {
  if (allowAllCors) {
    console.log('🔓 CORS: Allowing ALL origins (*)');
  } else {
    console.log('🔒 CORS: Restricting to origins:', allowedOrigins);
  }
}

const io = socketIo(server, {
  cors: {
    origin: allowAllCors ? '*' : allowedOrigins,
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
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());
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

// Load saved device from file
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

// Save device to file
function saveDevice(device) {
  try {
    fs.writeFileSync(DEVICE_FILE, JSON.stringify(device, null, 2), 'utf8');
    console.log('💾 Saved device to file:', device.name);
  } catch (error) {
    console.error('❌ Error saving device to file:', error);
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
      const savedDevice = loadSavedDevice();
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
      await spotifyService.withRetries('transferPlayback(initial)', () => spotifyService.transferPlayback(targetDeviceId, false), { attempts: 3, backoffMs: 300 });
    } catch (e) {
      console.warn('⚠️ Transfer playback failed (will still try play):', e?.message || e);
    }
    console.log(`🎵 Starting playback on device: ${targetDeviceId}`);

    try {
      const startTime = Date.now();
      console.log(`🎵 Starting playback at ${startTime} - Song: ${song.name} by ${song.artist}`);
      // Enforce deterministic playback mode for direct index plays
      try { await spotifyService.setShuffleState(false, targetDeviceId); } catch (_) {}
      try { await spotifyService.setRepeatState('off', targetDeviceId); } catch (_) {}
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
      await spotifyService.startPlayback(targetDeviceId, [`spotify:track:${song.id}`], startMs);
      const endTime = Date.now();
      console.log(`✅ Successfully started playback on device: ${targetDeviceId} (took ${endTime - startTime}ms)`);
      
      // Stabilization delay to prevent context hijacks from volume changes
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Set initial volume to 100% (or room's saved volume) with single retry
        try {
          const initialVolume = room.volume || 100;
        await spotifyService.withRetries('setVolume(index)', () => spotifyService.setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
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
      artist: song.artist
    };
    try { const r = rooms.get(roomId); if (r) r.songStartAtMs = Date.now() - (startMs || 0); } catch {}

    io.to(roomId).emit('song-playing', {
      songId: song.id,
      songName: song.name,
      customSongName: customSongTitles.get(song.id) || song.name,
      customSongName: customSongTitles.get(song.id) || song.name,
      artistName: song.artist,
      snippetLength: room.snippetLength,
      currentIndex: songIndex,
      totalSongs: room.playlistSongs.length,
      previewUrl: (room.playlistSongs[songIndex]?.previewUrl) || null
    });

    // Send real-time player card updates to host
    sendPlayerCardUpdates(roomId);

    console.log(`✅ Playing song in room ${roomId}: ${song.name} by ${song.artist} on device ${targetDeviceId}`);

    // Use simplified progression system
    startSimpleProgression(roomId, targetDeviceId, room.snippetLength);
  } catch (error) {
    console.error('❌ Error playing song at index:', error);
    // Try to continue with next song after a delay using simple system
    setTimeout(() => playNextSongSimple(roomId, deviceId), 3000);
  }
}

// Multi-Tenant Spotify Manager
class MultiTenantSpotifyManager {
  constructor() {
    this.orgServices = new Map();
    this.orgTokens = new Map();
    this.defaultOrg = 'DEFAULT';
  }
  
  getService(organizationId = this.defaultOrg) {
    if (!this.orgServices.has(organizationId)) {
      const service = new SpotifyService();
      this.orgServices.set(organizationId, service);
      
      // Load org-specific tokens
      const tokens = this.loadOrgTokens(organizationId);
      if (tokens) {
        service.setTokens(tokens.accessToken, tokens.refreshToken);
        this.orgTokens.set(organizationId, tokens);
        console.log(`✅ Loaded Spotify tokens for organization: ${organizationId}`);
      }
    }
    return this.orgServices.get(organizationId);
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

// Legacy support - keep these for backward compatibility
const spotifyService = multiTenantSpotify.getService('DEFAULT');
let spotifyTokens = multiTenantSpotify.getTokens('DEFAULT');

// Helper function to get organization from room
function getOrganizationFromRoom(roomId) {
  const room = rooms[roomId];
  return room && room.organizationId ? room.organizationId : 'DEFAULT';
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

// NEW: Simplified context monitor - only watches for context hijacks
function startSimpleContextMonitor(roomId, deviceId) {
  clearPlaybackWatcher(roomId);
  
  const intervalId = setInterval(async () => {
    try {
      const room = rooms.get(roomId);
      if (!room || room.gameState !== 'playing') { 
        clearPlaybackWatcher(roomId); 
        return; 
      }
      
      const state = await spotifyService.getCurrentPlaybackState();
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
          // Restore playlist context with original start position
          const originalStartMs = room.currentSongStartMs || 0;
          if (room.currentSongIndex !== undefined) {
            await spotifyService.startPlaybackFromPlaylist(deviceId, room.temporaryPlaylistId, room.currentSongIndex, originalStartMs);
          }
        } catch (e) {
          console.warn('⚠️ Context restore failed:', e?.message);
        }
      }
      // Case 2: Same track restarted from beginning (back button pressed)
      else if (currentTrackId === expectedTrackId && progress < 3000 && room.currentSongStartMs > 0) {
        console.log(`🔄 Track restart detected. Restoring original start position: ${room.currentSongStartMs}ms`);
        
        try {
          // Restore original start position for this track
          await spotifyService.seekToPosition(room.currentSongStartMs, deviceId);
        } catch (e) {
          console.warn('⚠️ Failed to restore original start position:', e?.message);
        }
      }
    } catch (_e) {
      // Ignore monitor errors to prevent spam
    }
  }, 5000); // Check every 5 seconds - much less aggressive
  
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
      spotifyService.deleteTemporaryPlaylist(room.temporaryPlaylistId).catch(err => 
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
    artist: nextSong.artist
  };
  room.currentSongStartMs = startMs; // Store for restart correction

  try {
    console.log(`🎵 Starting playback for: ${nextSong.name} by ${nextSong.artist} at ${startMs}ms`);
    
    // Brief delay to ensure smooth transition without dead air
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Simple playlist playback with enhanced logging
    if (room.temporaryPlaylistId) {
      console.log(`🎼 Using playlist context: ${room.temporaryPlaylistId}, track ${room.currentSongIndex}`);
      await spotifyService.startPlaybackFromPlaylist(deviceId, room.temporaryPlaylistId, room.currentSongIndex, startMs);
    } else {
      console.log(`🎵 Using individual track: ${nextSong.id}`);
      await spotifyService.startPlayback(deviceId, [`spotify:track:${nextSong.id}`], startMs);
    }

    console.log(`✅ Playback started successfully for: ${nextSong.name}`);

    // Emit song update
    io.to(roomId).emit('song-playing', {
      songId: nextSong.id,
      songName: nextSong.name,
      customSongName: customSongTitles.get(nextSong.id) || nextSong.name,
      artistName: nextSong.artist,
      snippetLength: room.snippetLength,
      currentIndex: room.currentSongIndex,
      totalSongs: room.playlistSongs.length,
      previewUrl: nextSong.previewUrl || null
    });

    // Send real-time player card updates to host
    sendPlayerCardUpdates(roomId);

    console.log(`✅ Simple advance: ${nextSong.name} by ${nextSong.artist}`);

    // Start simple progression for next song
    startSimpleProgression(roomId, deviceId, room.snippetLength);

  } catch (error) {
    console.error('❌ Error in simple song advance:', error);
    console.error('❌ Error details:', error?.message, error?.body?.error);
    
    // Try to resume playback if it got stuck in paused state
    try {
      console.log('🔄 Attempting to resume playback after song advance failure...');
      await spotifyService.resumePlayback(deviceId);
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
      const state = await spotifyService.getCurrentPlaybackState();
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
          try { await spotifyService.transferPlayback(deviceId, false); } catch {}
          // Hard pause to stop any stray context audio before restart
          try { await spotifyService.pausePlayback(deviceId); } catch {}
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
            await spotifyService.startPlaybackFromPlaylist(deviceId, room.temporaryPlaylistId, room.currentSongIndex, expectedProgress);
          } else {
            await spotifyService.startPlayback(deviceId, [`spotify:track:${expectedId}`], expectedProgress);
          }
          // Double-seek to clamp exact resume position and avoid restart sputter
          try {
            await new Promise(r => setTimeout(r, 150));
            await spotifyService.seekToPosition(expectedProgress, deviceId);
            await new Promise(r => setTimeout(r, 120));
            await spotifyService.seekToPosition(expectedProgress, deviceId);
          } catch {}
          // Verify and seek precisely if needed
          try {
            const verify = await spotifyService.getCurrentPlaybackState();
            const vid = verify?.item?.id;
            const vprog = Number(verify?.progress_ms || 0);
            if (vid === expectedId && Math.abs(vprog - expectedProgress) > 1200) {
              try { await spotifyService.seekToPosition(expectedProgress, deviceId); } catch {}
            }
          } catch {}
          // Enforce deterministic playback settings after correction
          try { await spotifyService.setShuffleState(false, deviceId); } catch {}
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
          const ctx = await spotifyService.getCurrentPlaybackState();
          const devices = await spotifyService.getUserDevices();
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
        try { await spotifyService.resumePlayback(deviceId); } catch {}
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
            try { await spotifyService.transferPlayback(deviceId, false); } catch {}
            try { await spotifyService.pausePlayback(deviceId); } catch {}
            await spotifyService.startPlayback(deviceId, [`spotify:track:${currentExpectedId}`], expectedProgress);
            try { await new Promise(res => setTimeout(res, 150)); await spotifyService.seekToPosition(expectedProgress, deviceId); } catch {}
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
          await spotifyService.pausePlayback(deviceId);
          // Let timer handle the next song transition
        } catch (e) {
          console.warn('⚠️ Failed to pause at snippet limit:', e?.message);
        }
      }
      
      // Also enforce repeat mode but it's secondary to the pause strategy
      if (room.temporaryPlaylistId && state?.repeat_state !== 'track') {
        try {
          console.log(`🔄 Enforcing repeat 'track' mode (was: ${state?.repeat_state})`);
          await spotifyService.setRepeatState('track', deviceId);
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

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.log('User connected:', 'user-connect', 20);

  // Join room
  socket.on('join-room', (data) => {
    const { roomId, playerName, isHost = false, clientId, licenseKey } = data;
    logger.info(`Player ${playerName} (${isHost ? 'host' : 'player'}) joining room: ${roomId}`, 'player-join');
    
    // TEMPORARILY DISABLED: Multi-tenant license validation
    // Everyone uses the same Spotify account for now
    let organizationId = 'DEFAULT';
    console.log(`🔓 License validation disabled - using DEFAULT organization for all users`);
    
    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      logger.info(`Creating new room: ${roomId} for organization: ${organizationId}`, 'room-create');
      const newRoom = {
        id: roomId,
        organizationId: organizationId, // Add organization support
        licenseKey: licenseKey || null, // Store license key
        host: isHost ? socket.id : null,
        players: new Map(),
        gameState: 'waiting',
        snippetLength: 30,
        winners: [],
        repeatMode: false,
        volume: 100,
        playlistSongs: [],
        currentSongIndex: 0,
        // Pre-queue system removed for deterministic playback
        superStrictLock: false,
        createdAt: new Date().toISOString()
      };
      rooms.set(roomId, newRoom);
      
      // Log organization info
      if (organizationId !== 'DEFAULT') {
        console.log(`🏢 Room ${roomId} created for organization ${organizationId} with license ${licenseKey}`);
      }
    }

    const room = rooms.get(roomId);
    
    // Join the socket room
    socket.join(roomId);
    
    // Add player to room
    const player = {
      id: socket.id,
      name: playerName,
      isHost: isHost,
      hasBingo: false,
      clientId: clientId || null
    };
    
    room.players.set(socket.id, player);
    
    // If this is the host and no host is set, set this player as host
    if (isHost && !room.host) {
      room.host = socket.id;
      console.log(`Set ${playerName} as host for room: ${roomId}`);
    }
    
    // If this is the host and there's already a host, update the host (for reconnections)
    if (isHost && room.host && room.host !== socket.id) {
      console.log(`Updating host from ${room.host} to ${socket.id} for ${playerName}`);
      room.host = socket.id;
    }
    
    // If this is the host and no host is set, set this player as host
    if (isHost && !room.host) {
      room.host = socket.id;
      console.log(`Set ${playerName} as host for room: ${roomId}`);
    }
    
    // Clean up old host entries if there are multiple hosts
    if (isHost) {
      // Remove any other players marked as host
      for (const [playerId, player] of room.players) {
        if (playerId !== socket.id && player.isHost) {
          console.log(`Removing old host entry for ${player.name} (${playerId})`);
          player.isHost = false;
        }
      }
    }
    
    console.log(`Player ${playerName} joined room ${roomId}. Total players: ${room.players.size}`);
    console.log(`Room host: ${room.host}, Current socket: ${socket.id}`);
    
    // Emit player joined event to all players in the room
    io.to(roomId).emit('player-joined', {
      playerId: socket.id,
      playerName: playerName,
      isHost: isHost,
      playerCount: getNonHostPlayerCount(room)
    });

    // Emit successful room join confirmation to the joining socket
    socket.emit('room-joined', {
      roomId: roomId,
      organizationId: organizationId,
      playerName: playerName,
      isHost: isHost,
      playerCount: getNonHostPlayerCount(room)
    });

    // Log available devices for debugging
    console.log('Available devices:', Array.from(room.players.values()).map(p => p.name));

    // If a game is already in progress or mix is finalized, provide the joining player with state
    (async () => {
      try {
        // Emit current song to the joining player to sync display timing (non-hosts only)
        if (!isHost && room.currentSong && room.snippetLength) {
            socket.emit('song-playing', {
              songId: room.currentSong.id,
              songName: room.currentSong.name,
              artistName: room.currentSong.artist,
              snippetLength: room.snippetLength,
              currentIndex: room.currentSongIndex || 0,
              totalSongs: room.playlistSongs?.length || 0,
              previewUrl: (room.playlistSongs?.[room.currentSongIndex || 0]?.previewUrl) || null
            });
          }

        // Ensure bingo card exists for ALL players (including hosts) if cards are available
          if (!room.bingoCards) room.bingoCards = new Map();
          const bySocket = room.bingoCards.get(socket.id);
          if (bySocket) {
          player.bingoCard = bySocket; // Ensure it's also on the player object
            io.to(socket.id).emit('bingo-card', bySocket);
          } else if (clientId && room.clientCards && room.clientCards.has(clientId)) {
            const existingCard = room.clientCards.get(clientId);
            room.bingoCards.set(socket.id, existingCard);
          player.bingoCard = existingCard; // Set on player object
            io.to(socket.id).emit('bingo-card', existingCard);
          } else if (room.playlistSongs?.length || room.playlists?.length || room.finalizedPlaylists?.length) {
          // Generate card for any player (host or not) if playlists exist
          console.log(`🎲 Generating bingo card for ${isHost ? 'host' : 'player'} ${playerName}`);
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
    const { roomId, playlists, songList } = data;
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
    
    const validationResult = validateBingoForPattern(player.bingoCard, room);
    
    if (validationResult.valid) {
      // AUTO-PAUSE the game for host verification
      if (room.gameState === 'playing') {
        room.gameState = 'paused_for_verification';
        clearRoomTimer(roomId);
        
        // Pause Spotify playback during verification
        (async () => {
          try {
            const deviceId = room.selectedDeviceId || loadSavedDevice()?.id;
            if (deviceId) {
              await spotifyService.pausePlayback(deviceId);
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
      
      // CRITICAL: Mark current song as played BEFORE verification modal so it shows in verification
      if (room.currentSong && room.currentSong.id) {
        room.calledSongIds = Array.isArray(room.calledSongIds) ? room.calledSongIds : [];
        if (!room.calledSongIds.includes(room.currentSong.id)) {
          room.calledSongIds.push(room.currentSong.id);
          console.log(`📝 BINGO CALL: Marked current song as played for verification: ${room.currentSong.name} (${room.currentSong.id})`);
        } else {
          console.log(`✅ BINGO CALL: Current song already in played list: ${room.currentSong.name} (${room.currentSong.id})`);
        }
        console.log(`📋 BINGO CALL: Total played songs now: ${room.calledSongIds.length}`);
      } else {
        console.warn(`⚠️ BINGO CALL: No current song to mark as played! This could cause verification issues.`);
      }
      
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
      
      // Send detailed verification data to HOST ONLY
      const hostSocket = io.sockets.sockets.get(room.host);
      if (hostSocket) {
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
        
        // Validate marked squares data
        const markedSquares = player.bingoCard.squares.filter(s => s.marked);
        console.log(`🔍 MARKED SQUARES: Player has ${markedSquares.length} marked squares`);
        markedSquares.forEach((square, index) => {
          const wasPlayed = actuallyPlayedSongs.some(played => played.id === square.songId);
          console.log(`${index + 1}. ${square.songName} by ${square.artistName} (${square.songId}) - ${wasPlayed ? '✅ PLAYED' : '❌ NOT PLAYED'}`);
        });
        
        hostSocket.emit('bingo-verification-needed', {
          playerId: socket.id,
          playerName: player.name,
          playerCard: player.bingoCard,
          markedSquares: markedSquares,
          requiredPattern: room.pattern,
          customMask: room.pattern === 'custom' ? Array.from(room.customPattern || []) : null,
          playedSongs: actuallyPlayedSongs, // Use the proper actually played songs
          calledSongIds: room.calledSongIds || [],
          currentSongIndex: room.currentSongIndex || 0,
          timestamp: Date.now(),
          validationReason: validationResult.reason,
          // Add debug info for troubleshooting
          debugInfo: {
            totalCalledIds: calledIds.length,
            totalPlayedSongs: actuallyPlayedSongs.length,
            totalMarkedSquares: markedSquares.length,
            missingFromPlaylist: missingFromPlaylist.length
          }
        });
      }
      
      // Notify all players about the bingo call (but not confirmed yet)
      io.to(roomId).emit('bingo-verification-pending', { 
        playerId: socket.id, 
        playerName: player.name, 
        awaitingVerification: true
      });
    } else {
      // Send detailed failure reason
      socket.emit('bingo-result', { 
        success: false, 
        reason: validationResult.reason || 'Invalid bingo pattern',
        requiredPattern: room.pattern,
        customMask: room.pattern === 'custom' ? Array.from(room.customPattern || []) : null
      });
    }
  });

  // Host approves or rejects bingo verification
  socket.on('verify-bingo', (data) => {
    const { roomId, playerId, approved, reason } = data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Verify this is the host
    const isHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
    if (!isHost) return;
    
    const player = room.players.get(playerId);
    if (!player) return;
    
    if (approved) {
      // APPROVED: Confirm the win and resume/end game
      console.log(`✅ Host approved bingo for ${player.name}`);
      
      // Current song already marked as played during bingo call
      
      // Notify the winner
      io.to(playerId).emit('bingo-result', {
        success: true,
        message: 'BINGO CONFIRMED! You win!',
        isWinner: true,
        verified: true
      });
      
      // Notify all players of confirmed win
      io.to(roomId).emit('bingo-confirmed', {
        playerId: playerId,
        playerName: player.name,
        verified: true
      });
      
      // NOW emit the actual winner event for public display
      io.to(roomId).emit('bingo-called', { 
        playerId: playerId, 
        playerName: player.name, 
        winners: room.winners,
        totalWinners: room.winners.length,
        isFirstWinner: room.winners.length === 1,
        awaitingVerification: false,
        verified: true
      });
      
      // PAUSE GAME for host to decide: next round or end completely
      room.gameState = 'round_complete';
      clearRoomTimer(roomId);
      console.log(`🏁 Round complete - ${player.name} wins! Waiting for host decision...`);
      
      // Store round winner
      if (!room.roundWinners) room.roundWinners = [];
      room.roundWinners.push({
        roundNumber: (room.roundWinners.length || 0) + 1,
        playerName: player.name,
        playerId: playerId,
        timestamp: new Date().toISOString()
      });
      
      // Notify host with next round options
      socket.emit('bingo-verified', { 
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
      
      // Remove from winners list
      room.winners = room.winners.filter(w => w.playerId !== playerId);
      player.hasBingo = false;
      player.patternComplete = false; // Allow them to call again
      
      // Notify the player
      io.to(playerId).emit('bingo-result', {
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
            const deviceId = room.selectedDeviceId || loadSavedDevice()?.id;
            if (deviceId) {
              await spotifyService.resumePlayback(deviceId);
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
    room.roundWinners = []; // Reset round winners
    
    // Reset all player bingo status but keep their cards
    room.players.forEach((player) => {
      player.hasBingo = false;
      player.patternComplete = false; // Reset pattern completion flag
      // Reset card marked state
      if (player.bingoCard && player.bingoCard.squares) {
        player.bingoCard.squares.forEach(square => {
          square.marked = false;
        });
      }
    });
    
    // Reset bingo cards marked state
    if (room.bingoCards) {
      room.bingoCards.forEach((card) => {
        if (card && card.squares) {
          card.squares.forEach(square => {
            square.marked = false;
          });
        }
      });
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
    if (!room) return;
    
    // Verify this is the host
    const isHost = room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost);
    if (!isHost) return;
    
    if (room.gameState !== 'round_complete') {
      console.warn(`⚠️ Cannot start next round: game state is ${room.gameState}, expected 'round_complete'`);
      return;
    }
    
    console.log(`🔄 Host starting FRESH round ${(room.roundWinners?.length || 0) + 1} for room ${roomId}`);
    
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
    
    try {
      const deviceId = room.selectedDeviceId || loadSavedDevice()?.id;
      if (deviceId) {
        spotifyService.pausePlayback(deviceId).catch(() => {});
      }
    } catch (e) {}
    
    // Clean up temporary playlist
    if (room.temporaryPlaylistId) {
      spotifyService.deleteTemporaryPlaylist(room.temporaryPlaylistId).catch(err => 
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
        // Include played songs for PublicDisplay sync
        playedSongs: (room.calledSongIds || []).map(songId => {
          const foundSong = room.playlistSongs?.find(s => s.id === songId);
          return foundSong ? {
            id: foundSong.id,
            name: foundSong.name,
            artist: foundSong.artist
          } : null;
        }).filter(Boolean),
        totalPlayedCount: (room.calledSongIds || []).length,
        currentSongIndex: room.currentSongIndex || 0,
        totalSongs: room.playlistSongs?.length || 0,
        // Sync timestamp for client reference
        syncTimestamp: Date.now()
      };
      
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
                playedSongs: room.calledSongIds || [] // Include list of actually played songs
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

  // Host can lock/unlock room joins
  socket.on('set-lock-joins', (data = {}) => {
    try {
      const { roomId, locked } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
      if (!isCurrentHost) return;
      room.lockJoins = !!locked;
      io.to(roomId).emit('lock-joins-updated', { locked: room.lockJoins });
      console.log(`🔒 Lock joins set to ${room.lockJoins} for room ${roomId}`);
    } catch (e) {
      console.error('❌ Error setting lock joins:', e?.message || e);
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
    const { roomId, playlists, snippetLength = 30, deviceId, songList, randomStarts = 'none', pattern: incomingPattern } = data;
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

        // Emit game started as soon as state is ready so UI can show controls
        io.to(roomId).emit('game-started', {
          roomId,
          snippetLength,
          deviceId,
          pattern: room.pattern,
          customMask: Array.from(room.customPattern || [])
        });
      
        console.log('🎵 Generating bingo cards...');
        // If mix is already finalized and cards exist, do NOT regenerate to avoid reshuffle
        if (!room.mixFinalized || !room.bingoCards || room.bingoCards.size === 0) {
          // If mix was finalized, reuse finalized song order to enforce 1x75 deterministically
          await generateBingoCards(roomId, playlists, room.finalizedSongOrder || null);
        } else {
          console.log('🛑 Skipping card regeneration (mix finalized and cards already exist)');
          
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

        // Emit fiveby15 columns if computed during card generation
        if (room.fiveByFifteenColumnsIds) {
          io.to(roomId).emit('fiveby15-pool', { columns: room.fiveByFifteenColumnsIds, names: room.fiveByFifteenPlaylistNames || [] });
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
          currentSongIndex: 0
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
          const deviceId = room.selectedDeviceId || loadSavedDevice()?.id;
          if (deviceId) {
            try { await spotifyService.transferPlayback(deviceId, false); } catch {}
            await spotifyService.pausePlayback(deviceId);
          }
        } catch (e) {
          console.warn('⚠️ Pause on end-game failed:', e?.message || e);
        }
      }
      room.gameState = 'ended';
      
      // Clean up temporary playlist
      if (room.temporaryPlaylistId) {
        spotifyService.deleteTemporaryPlaylist(room.temporaryPlaylistId).catch(err => 
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
          const deviceId = room.selectedDeviceId || loadSavedDevice()?.id;
          if (deviceId) {
            try { await spotifyService.transferPlayback(deviceId, false); } catch {}
            await spotifyService.pausePlayback(deviceId);
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
        const deviceId = room.selectedDeviceId || loadSavedDevice()?.id;
        if (!deviceId) {
          console.error('❌ No device found for pause');
          socket.emit('error', { message: 'No device available for pause' });
          return;
        }
        try {
          // Ensure control on the locked device (do not auto-play)
          await spotifyService.transferPlayback(deviceId, false);
        } catch (e) {
          console.warn('⚠️ Transfer before pause failed:', e?.message || e);
        }

        // If already paused, treat as success
        try {
          const state = await spotifyService.getCurrentPlaybackState();
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
          await spotifyService.pausePlayback(deviceId);
        } catch (pauseErr) {
          const msg = pauseErr?.body?.error?.message || pauseErr?.message || String(pauseErr);
          const status = pauseErr?.body?.error?.status || pauseErr?.statusCode;
          const isRestriction = /Restriction/i.test(msg) || status === 403;
          if (isRestriction) {
            console.warn('⚠️ Pause restricted; attempting device activation then retry');
            try {
              await spotifyService.activateDevice(deviceId);
              await new Promise(r => setTimeout(r, 200));
              await spotifyService.pausePlayback(deviceId);
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
        const deviceId = room.selectedDeviceId || loadSavedDevice()?.id;
        if (!deviceId) {
          console.error('❌ No device found for resume');
          socket.emit('error', { message: 'No device available for resume' });
          return;
        }

        // Ensure playback is locked to the device before resuming
        try {
          await spotifyService.transferPlayback(deviceId, false);
          } catch (e) {
            console.warn('⚠️ Transfer playback failed before resume:', e?.message || e);
          }

          if (resumePosition !== undefined) {
            console.log(`🎯 Resuming from position: ${resumePosition}ms`);
          await spotifyService.resumePlayback(deviceId);
          await spotifyService.seekToPosition(resumePosition, deviceId);
            console.log(`✅ Resumed and seeked to position: ${resumePosition}ms`);
          } else {
          await spotifyService.resumePlayback(deviceId);
            console.log('✅ Playback resumed successfully');
          }
          
          // Restore volume to match room's saved volume or default to 100%
          try {
            const targetVolume = room.volume || 100;
            await spotifyService.setVolume(targetVolume, deviceId);
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
      if (!room) return;
      // Only host can reveal
      const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
      if (!isCurrentHost) return;
      const song = room.currentSong;
      if (!song) return;
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
      room.currentSong = { id: songId, name: songName, artist: artistName };
      
      io.to(roomId).emit('song-playing', {
        songId,
        songName,
        customSongName: customSongTitles.get(songId) || songName,
        artistName,
        snippetLength: room.snippetLength
      });
      
      // Send real-time player card updates to host
      sendPlayerCardUpdates(roomId);
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
        if (square && square.songId === songId) {
          // Toggle mark state to support unmarking
          square.marked = !square.marked;
          
          // Send real-time player card updates to host
          sendPlayerCardUpdates(roomId);
          
          // Check for bingo pattern completion (but don't auto-announce)
          const hasBingo = checkBingo(card);
          if (hasBingo && !player.patternComplete) {
            player.patternComplete = true; // Use separate flag for pattern completion
            console.log(`🎯 Player ${player.name} completed bingo pattern but hasn't called it yet`);
            
            // Send notification to player that they can call bingo
            socket.emit('pattern-complete', {
              message: 'You have a bingo pattern! Hold the BINGO button to call it.',
              hasPattern: true
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
      io.to(roomId).emit('display-hide-call-list');
      io.to(roomId).emit('display-show-rules');
      console.log(`📋 Rules screen shown for room ${roomId}`);
    }
  });

  socket.on('display-show-splash', (data) => {
    const { roomId } = data;
    if (roomId && rooms.has(roomId)) {
      // Hide other screens first, then show splash
      io.to(roomId).emit('display-hide-rules');
      io.to(roomId).emit('display-hide-call-list');
      io.to(roomId).emit('display-show-splash');
      console.log(`🎬 Splash screen shown for room ${roomId}`);
    }
  });

  socket.on('display-show-call-list', (data) => {
    const { roomId } = data;
    if (roomId && rooms.has(roomId)) {
      // Hide other screens first, then show call list
      io.to(roomId).emit('display-hide-rules');
      io.to(roomId).emit('display-hide-splash');
      io.to(roomId).emit('display-show-call-list');
      console.log(`🎵 Call list screen shown for room ${roomId}`);
    }
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

async function generateBingoCards(roomId, playlists, songOrder = null) {
  console.log('🎲 Generating bingo cards for room:', roomId);
  const room = rooms.get(roomId);
  if (!room) {
    console.log('❌ Room not found for bingo card generation');
    return;
  }

  // Check if Spotify is connected
  if (!spotifyTokens || !spotifyTokens.accessToken) {
    console.error('❌ Cannot generate bingo cards: Spotify not connected');
    return;
  }

  try {
    console.log('📋 Fetching songs from playlists...');
    // Fetch songs from each playlist
    const playlistsWithSongs = [];
    for (const playlist of playlists) {
      try {
        console.log(`📋 Fetching songs for playlist: ${playlist.name}`);
        const songs = await spotifyService.getPlaylistTracks(playlist.id);
        console.log(`✅ Found ${songs.length} songs in playlist: ${playlist.name}`);
        playlistsWithSongs.push({ ...playlist, songs });
      } catch (error) {
        console.error(`❌ Error fetching songs for playlist ${playlist.id}:`, error);
        playlistsWithSongs.push({ ...playlist, songs: [] });
      }
    }

    const songsNeededPerCard = 25;

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
        
        for (const song of pl.songs) {
          if (!globalSeen.has(song.id)) {
            globalSeen.add(song.id);
            uniqueSongs.push(song);
          } else {
            duplicatesFound.push(song);
          }
        }
        
        if (duplicatesFound.length > 0) {
          console.log(`⚠️ Playlist "${pl.name}" had ${duplicatesFound.length} duplicate songs removed`);
          duplicatesFound.forEach(dup => {
            console.log(`   - Duplicate: "${dup.name}" by ${dup.artist}`);
          });
        }
        
        if (uniqueSongs.length < 15) {
          const shortage = 15 - uniqueSongs.length;
          warnings.push(`Playlist "${pl.name}" only has ${uniqueSongs.length} unique songs after deduplication (needs 15, short by ${shortage})`);
        }
        
        return {
          ...pl,
          songs: uniqueSongs,
          originalCount: pl.songs.length,
          duplicatesRemoved: duplicatesFound.length
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
        const totalDuplicates = perListGloballyUnique.reduce((sum, pl) => sum + pl.duplicatesRemoved, 0);
        if (totalDuplicates > 0) {
          console.log(`✅ Successfully removed ${totalDuplicates} cross-playlist duplicates. All playlists still have ≥15 unique songs.`);
          io.to(roomId).emit('deduplication-success', {
            totalDuplicatesRemoved: totalDuplicates,
            playlistDetails: perListGloballyUnique.map(pl => ({
              name: pl.name,
              originalCount: pl.originalCount,
              finalCount: pl.songs.length,
              duplicatesRemoved: pl.duplicatesRemoved
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
        const fiveCols = [];
        const colNames = [];
        const metaMap = {};
        for (let col = 0; col < 5; col++) {
          // Use the globally deduplicated song pools
          const src = properShuffle(perListGloballyUnique[col].songs).slice(0, 15);
          fiveCols.push(src);
          colNames.push(perListGloballyUnique[col].name || `Column ${col+1}`);
          src.forEach(s => { if (s && s.id) metaMap[s.id] = { name: s.name, artist: s.artist }; });
        }
        const roomRef = rooms.get(roomId);
        if (roomRef) {
          roomRef.fiveByFifteenColumnsIds = fiveCols.map(col => col.map(s => s.id));
          roomRef.fiveByFifteenPlaylistNames = colNames;
          roomRef.fiveByFifteenMeta = metaMap;
          // Finalize a single global shuffled order of the 75 picks
          const globalOrder = properShuffle(fiveCols.flat().map(s => s.id));
          roomRef.finalizedSongOrder = globalOrder;
          io.to(roomId).emit('fiveby15-pool', { columns: roomRef.fiveByFifteenColumnsIds, names: colNames, meta: metaMap });
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
        // For each of 5 playlists, sample 5 unique tracks from globally deduplicated pools
        // Note: Cross-playlist duplicates are already removed, so we only need cross-column uniqueness within this card
        const used = new Set();
        const columns = [];
        let ok = true;
        for (let col = 0; col < 5; col++) {
          const pool = properShuffle(perListGloballyUnique[col].songs);
          const colPicks = [];
          for (const s of pool) {
            if (!used.has(s.id)) { colPicks.push(s); used.add(s.id); }
            if (colPicks.length === 5) break;
          }
          if (colPicks.length < 5) { ok = false; break; }
          columns.push(colPicks);
        }
        if (!ok) {
          console.warn(`⚠️ 5x15 mode fell short for player ${player.name}; falling back to global pool`);
          const global = buildGlobalPool();
          if (!ensureEnough(global.length)) {
            console.error(`❌ Not enough songs in global pool for player ${player.name}: need ${songsNeededPerCard}, have ${global.length}`);
            continue; // Skip this player but continue with others
          }
          chosen25 = properShuffle(global).slice(0, songsNeededPerCard);
        } else {
          // Flatten column-major into row-major 5x5
          for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 5; col++) {
              chosen25.push(columns[col][row]);
            }
          }
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
          const s = chosen25[idx++];
          if (!s || !s.id) {
            console.error(`❌ Invalid song at position ${row}-${col} for player ${player.name}`);
            continue;
          }
        card.squares.push({
          position: `${row}-${col}`,
          songId: s.id,
          songName: s.name,
          customSongName: customSongTitles.get(s.id) || s.name,
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

      if (!room.bingoCards) room.bingoCards = new Map();
    player.bingoCard = card;
    cards.set(playerId, card);
      // Persist by clientId if available to survive refreshes
      if (player.clientId) {
        room.clientCards.set(player.clientId, card);
      }
    io.to(playerId).emit('bingo-card', card);
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
  
  // Use finalized playlists if available, otherwise fall back to regular playlists
  const playlists = room.finalizedPlaylists || room.playlists;
  if (!Array.isArray(playlists)) return;
  
  // Build a single card using the same 1x75 / 5x15 logic used for all players
  try {
    // Fetch per-playlist songs and de-duplicate per list
    const playlistsWithSongs = [];
    for (const playlist of playlists) {
      try {
        const songs = await spotifyService.getPlaylistTracks(playlist.id);
        playlistsWithSongs.push({ ...playlist, songs });
      } catch (error) {
        console.error(`❌ Error fetching songs for playlist ${playlist.id}:`, error);
        playlistsWithSongs.push({ ...playlist, songs: [] });
      }
    }

    const songsNeededPerCard = 25;
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
        
        for (const song of pl.songs) {
          if (!globalSeen.has(song.id)) {
            globalSeen.add(song.id);
            uniqueSongs.push(song);
          }
        }
        
        return {
          ...pl,
          songs: uniqueSongs
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
        // Use globally deduplicated pools for late-join cards
        const pool = properShuffle(perListGloballyUnique[col].songs);
        const colPicks = [];
        for (const s of pool) {
          if (!used.has(s.id)) { colPicks.push(s); used.add(s.id); }
          if (colPicks.length === 5) break;
        }
        if (colPicks.length < 5) { ok = false; break; }
        columns.push(colPicks);
      }
      if (!ok) {
        console.warn('⚠️ 5x15 late-join fell short; falling back to global pool');
        const global = buildGlobalPool();
        if (!ensureEnough(global.length)) return;
        chosen25 = properShuffle(global).slice(0, songsNeededPerCard);
      } else {
        for (let row = 0; row < 5; row++) {
          for (let col = 0; col < 5; col++) {
            chosen25.push(columns[col][row]);
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
        const s = chosen25[idx++];
        card.squares.push({
          position: `${row}-${col}`,
          songId: s.id,
          songName: s.name,
          customSongName: customSongTitles.get(s.id) || s.name,
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
    io.to(playerId).emit('bingo-card', card);
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

  // Check if Spotify is connected and refresh token if needed
  if (!spotifyTokens || !spotifyTokens.accessToken) {
    console.error('❌ Cannot start playback: Spotify not connected');
    return;
  }

  try {
    // Ensure token is valid before proceeding
    await spotifyService.ensureValidToken();
    
    let allSongs = [];
    const perListFetched = [];
    
    if (songList && songList.length > 0) {
      // If we are in 5x15 mode and have a finalized global order, honor it exactly
      if (Array.isArray(room.finalizedSongOrder) && room.finalizedSongOrder.length > 0) {
        console.log('📋 5x15 detected: overriding client-provided songList with finalized global shuffle');
        const idToSong = new Map(songList.map(s => [s.id, s]));
        const mapped = room.finalizedSongOrder.map(id => idToSong.get(id)).filter(Boolean);
        allSongs = mapped.length > 0 ? mapped : songList;
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
          const songs = await spotifyService.getPlaylistTracks(playlist.id);
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
          
          for (const song of pl.songs) {
            if (!globalSeen.has(song.id)) {
              globalSeen.add(song.id);
              uniqueSongs.push(song);
            }
          }
          
          return {
            ...pl,
            songs: uniqueSongs
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
          const idToSong = new Map(allSongs.map(s => [s.id, s]));
          allSongs = room.finalizedSongOrder.map(id => idToSong.get(id)).filter(Boolean);
          console.log('🎼 Using finalized 5x15 global shuffled order (75 songs)');
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

    // Store the song list in the room for ordered playback
    room.playlistSongs = allSongs;
    room.currentSongIndex = 0;
    room.gameState = 'playing';
    console.log(`📝 Stored ${allSongs.length} songs in room ${roomId} for ordered playback`);
    
    // Create temporary playlist for context-based playback to prevent hijacks
    try {
      const trackUris = allSongs.map(song => `spotify:track:${song.id}`);
      const playlistName = `TEMPO Bingo Room ${roomId} - ${new Date().toISOString().slice(0,16)}`;
      room.temporaryPlaylistId = await spotifyService.createTemporaryPlaylist(playlistName, trackUris);
      console.log(`🎼 Created temporary playlist for context: ${room.temporaryPlaylistId}`);
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
      const savedDevice = loadSavedDevice();
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
      const devices = await spotifyService.getUserDevices();
      const deviceInList = devices.find(d => d.id === targetDeviceId);
      if (!deviceInList) {
        console.log('⚠️ Locked device not in list; attempting activation...');
        await spotifyService.activateDevice(targetDeviceId);
      }

      await spotifyService.transferPlayback(targetDeviceId, false);
      // Skip-based queue clearing removed to avoid context hijacks
      // Enforce deterministic playback mode to avoid context/radio fallbacks with delays
      try { await spotifyService.withRetries('setShuffle(false)', () => spotifyService.setShuffleState(false, targetDeviceId), { attempts: 2, backoffMs: 200 }); } catch (_) {}
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
        await spotifyService.withRetries('startPlaybackFromPlaylist(initial)', () => spotifyService.startPlaybackFromPlaylist(targetDeviceId, room.temporaryPlaylistId, 0, startMs), { attempts: 3, backoffMs: 400 });
      } else {
        await spotifyService.withRetries('startPlayback(initial)', () => spotifyService.startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], startMs), { attempts: 3, backoffMs: 400 });
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
        await spotifyService.withRetries('setVolume(initial)', () => spotifyService.setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
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
          await spotifyService.refreshAccessToken();
          // Re-check device after refresh
          const devicesAfter = await spotifyService.getUserDevices();
          const stillMissing = !devicesAfter.find(d => d.id === targetDeviceId);
          if (stillMissing) {
            console.log('⚠️ Locked device still missing after refresh; attempting activation...');
            await spotifyService.activateDevice(targetDeviceId);
          }
          await spotifyService.withRetries('transferPlayback(after-refresh)', () => spotifyService.transferPlayback(targetDeviceId, false), { attempts: 3, backoffMs: 300 });
          // Skip-based queue clearing removed to avoid context hijacks
          await spotifyService.withRetries('startPlayback(after-refresh)', () => spotifyService.startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], startMs), { attempts: 3, backoffMs: 400 });
          console.log(`✅ Successfully started playback after token refresh`);
          try { const r = rooms.get(roomId); if (r) r.songStartAtMs = Date.now() - (startMs || 0); } catch {}
          
          // Stabilization delay to prevent context hijacks from volume changes
          await new Promise(resolve => setTimeout(resolve, 800));
          
          // Set initial volume to 100% (or room's saved volume)
          try {
            const initialVolume = room.volume || 100;
            await spotifyService.withRetries('setVolume(after-refresh)', () => spotifyService.setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
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
      artist: firstSong.artist
    };

    io.to(roomId).emit('song-playing', {
      songId: firstSong.id,
      songName: firstSong.name,
      customSongName: customSongTitles.get(firstSong.id) || firstSong.name,
      artistName: firstSong.artist,
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
        const state = await spotifyService.getCurrentPlaybackState();
        playing = !!state?.is_playing;
        const currentId = state?.item?.id;
        correctTrack = currentId === firstSong.id;
        if (!QUIET_MODE) logger.log(`🔎 Playback verify attempt ${i + 1}: is_playing=${playing} correct_track=${correctTrack} progress=${state?.progress_ms}ms`, 'playback-verify', 5);
        if (playing && correctTrack) break; // Only break if BOTH conditions are met
        
        // Only try resume if not playing AND we have the right track (avoid restriction errors)
        if (!playing && correctTrack) {
          try { 
            await spotifyService.resumePlayback(targetDeviceId); 
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
            await spotifyService.startPlaybackFromPlaylist(targetDeviceId, room.temporaryPlaylistId, 0, startMs);
          } else {
            await spotifyService.startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], startMs); 
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
          const deviceToPause = deviceId || room.selectedDeviceId || loadSavedDevice()?.id;
          if (deviceToPause) { await spotifyService.pausePlayback(deviceToPause); }
        } catch (_) {}
        
        // Clean up temporary playlist
        if (room.temporaryPlaylistId) {
          spotifyService.deleteTemporaryPlaylist(room.temporaryPlaylistId).catch(err => 
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
      const savedDevice = loadSavedDevice();
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
        const current = await spotifyService.getCurrentPlaybackState();
        const currentDeviceId = current?.device?.id;
        if (currentDeviceId === targetDeviceId) {
          needTransfer = false;
          if (VERBOSE) console.log('🔒 Already on locked device; skipping transfer');
        }
      } catch (_) {}
      if (needTransfer) {
        await spotifyService.withRetries('transferPlayback(next)', () => spotifyService.transferPlayback(targetDeviceId, false), { attempts: 3, backoffMs: 300 });
        // Skip-based queue clearing removed to avoid context hijacks
      }
    } catch (e) {
      console.warn('⚠️ Transfer playback failed (will still try play):', e?.message || e);
    }
    console.log(`🎵 Starting playback on device: ${targetDeviceId}`);

    try {
      // Ensure device still visible; attempt activation if not
      const devices = await spotifyService.getUserDevices();
      const deviceInList = devices.find(d => d.id === targetDeviceId);
      if (!deviceInList) {
        console.log('⚠️ Locked device not in list before next song; attempting activation...');
        await spotifyService.activateDevice(targetDeviceId);
      }

      const playbackStartTime = Date.now();
      console.log(`🎵 Starting Spotify playback for: ${nextSong.name}`);
      // Enforce deterministic playback mode on each advance with delays
      try { await spotifyService.withRetries('setShuffle(false,next)', () => spotifyService.setShuffleState(false, targetDeviceId), { attempts: 2, backoffMs: 200 }); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 200));
      // Reset repeat to 'off' before advancing (clears any previous 'track' repeat)
      try { await spotifyService.withRetries('setRepeat(off,next)', () => spotifyService.setRepeatState('off', targetDeviceId), { attempts: 2, backoffMs: 200 }); } catch (_) {}
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
        await spotifyService.withRetries('startPlaybackFromPlaylist(next)', () => spotifyService.startPlaybackFromPlaylist(targetDeviceId, room.temporaryPlaylistId, room.currentSongIndex, startMs), { attempts: 3, backoffMs: 400 });
      } else {
        await spotifyService.withRetries('startPlayback(next)', () => spotifyService.startPlayback(targetDeviceId, [`spotify:track:${nextSong.id}`], startMs), { attempts: 3, backoffMs: 400 });
      }
      const playbackEndTime = Date.now();
      console.log(`✅ Successfully started playback on device: ${targetDeviceId}`);
      
      // Stabilization delay to prevent context hijacks from volume changes
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Set initial volume to 100% (or room's saved volume) with single retry
            try {
              const initialVolume = room.volume || 100;
        await spotifyService.withRetries('setVolume(next)', () => spotifyService.setVolume(initialVolume, targetDeviceId), { attempts: 2, backoffMs: 300 });
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
      artist: nextSong.artist
    };

    io.to(roomId).emit('song-playing', {
      songId: nextSong.id,
      songName: nextSong.name,
      customSongName: customSongTitles.get(nextSong.id) || nextSong.name,
      artistName: nextSong.artist,
      snippetLength: room.snippetLength,
      currentIndex: room.currentSongIndex,
      totalSongs: room.playlistSongs.length,
      previewUrl: (room.playlistSongs[room.currentSongIndex]?.previewUrl) || null
    });

    // Send real-time player card updates to host
    sendPlayerCardUpdates(roomId);

    console.log(`✅ Playing next song in room ${roomId}: ${nextSong.name} by ${nextSong.artist} on device ${targetDeviceId}`);

    // Verify playback actually started and is the correct track; attempt resume/correct if needed
    try {
      let playing = false;
      let correctTrack = false;
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 300));
        const state = await spotifyService.getCurrentPlaybackState();
        playing = !!state?.is_playing;
        const currentId = state?.item?.id;
        correctTrack = currentId === nextSong.id;
        if (!QUIET_MODE) logger.log(`🔎 Playback verify (next) attempt ${i + 1}: is_playing=${playing} correct_track=${correctTrack}`, 'next-verify', 5);
        if (playing) break;
        try { await spotifyService.withRetries('resumePlayback(verify-next)', () => spotifyService.resumePlayback(targetDeviceId), { attempts: 2, backoffMs: 200 }); } catch {}
      }
      if (!playing || !correctTrack) {
        // Attempt to correct to the intended track once
        try { await spotifyService.withRetries('startPlayback(correct-next)', () => spotifyService.startPlayback(targetDeviceId, [`spotify:track:${nextSong.id}`], startMs), { attempts: 2, backoffMs: 300 }); } catch {}
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
      const state = await spotifyService.getCurrentPlaybackState();
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
function sendPlayerCardUpdates(roomId) {
  try {
    const room = rooms.get(roomId);
    if (!room || !room.bingoCards) return;
    
    const playerCardsData = {};
    room.bingoCards.forEach((card, playerId) => {
      const player = room.players.get(playerId);
      if (player && card) {
        // Only include actual players (not hosts or public display)
        if (!player.isHost && player.name !== 'Display') {
          playerCardsData[playerId] = {
            playerName: player.name,
            card: card,
            playedSongs: room.calledSongIds || []
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
  // Helper function to check if a marked square corresponds to a played song
  const isMarkedSquareValid = (square) => {
    return square && square.marked && playedSongIds.includes(square.songId);
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

function validateBingoForPattern(card, room) {
  const pattern = room?.pattern || 'full_card';
  const playedSongIds = room?.calledSongIds || [];
  
  // Helper function to check if a marked square corresponds to a played song
  const isMarkedSquareValid = (square) => {
    return square && square.marked && playedSongIds.includes(square.songId);
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
    // All squares must be marked AND correspond to played songs
    let invalidCount = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const square = card.squares.find(s => s.position === `${row}-${col}`);
        if (!isMarkedSquareValid(square)) {
          invalidCount++;
        }
      }
    }
    if (invalidCount > 0) {
      return { 
        valid: false, 
        reason: `Full card incomplete. Need ${invalidCount} more squares marked with played songs.`
      };
    }
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
        const deviceId = room.selectedDeviceId || loadSavedDevice()?.id;
        if (deviceId) {
          try { await spotifyService.transferPlayback(deviceId, false); } catch {}
          await spotifyService.pausePlayback(deviceId);
        }
      } catch {}
      room.gameState = 'ended';
      
      // Clean up temporary playlist
      if (room.temporaryPlaylistId) {
        spotifyService.deleteTemporaryPlaylist(room.temporaryPlaylistId).catch(err => 
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

// Spotify API Routes
app.get('/api/spotify/auth', (req, res) => {
  console.log('Auth endpoint called');
  try {
    // Clear any existing tokens when starting a new OAuth flow
    spotifyTokens = null;
    console.log('Cleared existing tokens for new OAuth flow');
    
    const authUrl = spotifyService.getAuthorizationURL();
    console.log('Generated auth URL:', authUrl);
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

app.get('/api/spotify/status', async (req, res) => {
  console.log('🚨 EMERGENCY SPOTIFY STATUS - Bypassing multi-tenant system');
  try {
    // Check direct global tokens
    console.log('🔍 Checking direct spotifyTokens:', !!spotifyTokens, spotifyTokens ? 'has accessToken: ' + !!spotifyTokens.accessToken : 'no tokens');
    
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      console.log('❌ No direct tokens available - returning disconnected');
      return res.json({ 
        connected: false,
        hasTokens: false,
        mode: 'emergency'
      });
    }

    console.log('🔑 Direct tokens exist, validating...');
    // Validate tokens by trying to ensure they're valid
    try {
      await spotifyService.ensureValidToken();
      // If we get here, tokens are valid
      console.log('✅ Direct tokens valid - returning connected');
      return res.json({ 
        connected: true,
        hasTokens: true,
        mode: 'emergency'
      });
    } catch (error) {
      console.error('❌ Direct token validation failed:', error?.message || error);
      // Clear invalid tokens
      spotifyTokens = null;
      return res.json({ 
        connected: false,
        hasTokens: false,
        mode: 'emergency',
        error: 'Token validation failed'
      });
    }
  } catch (error) {
    console.error('❌ Emergency status check error:', error);
    res.status(500).json({ 
      connected: false,
      hasTokens: false,
      error: 'Status check failed',
      details: error.message 
    });
  }
});

// Get current tokens for environment variable setup
app.get('/api/spotify/tokens', (req, res) => {
  if (!spotifyTokens || !spotifyTokens.accessToken || !spotifyTokens.refreshToken) {
    return res.status(404).json({ 
      error: 'No Spotify tokens available. Connect Spotify first.' 
    });
  }
  
  res.json({ 
    success: true,
    message: 'Copy these environment variables to Railway project settings:',
    envVars: {
      SPOTIFY_ACCESS_TOKEN: spotifyTokens.accessToken,
      SPOTIFY_REFRESH_TOKEN: spotifyTokens.refreshToken
    },
    instructions: [
      '1. Go to your Railway project dashboard',
      '2. Click on "Variables" tab',
      '3. Add these two environment variables',
      '4. Redeploy your app',
      '5. Spotify will auto-connect on future deployments!'
    ]
  });
});

// Force clear Spotify tokens (for testing)
app.post('/api/spotify/clear', (req, res) => {
  try {
    console.log('🗑️  Starting Spotify tokens clear...');
    
    // Clear in-memory tokens
  spotifyTokens = null;
    console.log('✅ Cleared in-memory tokens');
    
    // Clear service tokens
    if (spotifyService && typeof spotifyService.setTokens === 'function') {
  spotifyService.setTokens(null, null);
      console.log('✅ Cleared service tokens');
    } else {
      console.warn('⚠️ spotifyService.setTokens not available');
    }
  
  // Remove saved tokens file
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
        console.log('✅ Removed saved Spotify tokens file');
      } else {
        console.log('ℹ️ No tokens file to remove');
    }
    } catch (fileError) {
      console.error('❌ Error removing tokens file:', fileError);
      // Don't fail the whole request for file errors
  }
  
    console.log('✅ Successfully cleared Spotify tokens');
  res.json({ success: true, message: 'Spotify tokens cleared' });
    
  } catch (error) {
    console.error('❌ Error in /api/spotify/clear:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to clear tokens',
      details: error.message 
    });
  }
});

app.get('/api/spotify/callback', async (req, res) => {
  const { code, state } = req.query;
  
  console.log('🚨 EMERGENCY SPOTIFY CALLBACK - Bypassing multi-tenant system');
  console.log('Spotify callback received with code:', code ? code.substring(0, 20) + '...' : 'NO CODE');
  
  if (!code) {
    console.error('No authorization code provided');
    return res.status(400).json({ error: 'Authorization code required' });
  }

  try {
    console.log('🔧 Using direct spotifyService.handleCallback...');
    const tokens = await spotifyService.handleCallback(code);
    console.log('✅ Got tokens from Spotify, saving directly...');
    
    // Save tokens directly to global variables AND file
    spotifyTokens = tokens;
    saveTokens(tokens);
    
    console.log('✅ Tokens saved directly - Emergency fix active');
    res.json({ 
      success: true, 
      message: 'Spotify connected successfully (emergency mode)',
      tokens
    });
  } catch (error) {
    console.error('❌ Emergency callback failed:', error);
    res.status(500).json({ error: 'Failed to connect Spotify' });
  }
});

app.get('/api/spotify/playlists', async (req, res) => {
  try {
    // SIMPLIFIED: Always use DEFAULT organization
    const organizationId = 'DEFAULT';
    
    const orgSpotifyService = multiTenantSpotify.getService(organizationId);
    const orgTokens = multiTenantSpotify.getTokens(organizationId);
    
    if (!orgTokens) {
      return res.status(401).json({ 
        error: `Spotify not connected for organization: ${organizationId}`,
        organizationId: organizationId
      });
    }
    
    const playlists = await orgSpotifyService.getUserPlaylists();
    res.json({ 
      success: true, 
      playlists: playlists,
      organizationId: organizationId
    });
  } catch (error) {
    console.error('Error getting playlists:', error);
    res.status(500).json({ error: 'Failed to get playlists' });
  }
});

app.get('/api/spotify/playlists/:playlistId/tracks', async (req, res) => {
  try {
    const { playlistId } = req.params;
    const tracks = await spotifyService.getPlaylistTracks(playlistId);
    res.json(tracks);
  } catch (error) {
    console.error('Error getting playlist tracks:', error);
    res.status(500).json({ error: 'Failed to get playlist tracks' });
  }
});

// Spotify API endpoints
app.get('/api/spotify/devices', async (req, res) => {
  try {
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }

    console.log('📱 Fetching available Spotify devices...');
    const devices = await spotifyService.getUserDevices();
    let currentPlayback = null;
    try {
      currentPlayback = await spotifyService.getCurrentPlaybackState();
    } catch (_) {}
    const currentDevice = currentPlayback?.device || null;
    
    // Load saved device
    const savedDevice = loadSavedDevice();
    
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
    
    if (!device || !device.id) {
      return res.status(400).json({ error: 'Device information required' });
    }
    
    saveDevice(device);
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
    await spotifyService.startPlayback(deviceId, uris, position);
    res.json({ success: true, message: 'Playback started' });
  } catch (error) {
    console.error('Error starting playback:', error);
    res.status(500).json({ error: 'Failed to start playback' });
  }
});

app.post('/api/spotify/pause', async (req, res) => {
  try {
    const { deviceId } = req.body;
    await spotifyService.pausePlayback(deviceId);
    res.json({ success: true, message: 'Playback paused' });
  } catch (error) {
    console.error('Error pausing playback:', error);
    res.status(500).json({ error: 'Failed to pause playback' });
  }
});

app.post('/api/spotify/next', async (req, res) => {
  try {
    const { deviceId } = req.body;
    await spotifyService.nextTrack(deviceId);
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
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      return res.status(401).json({ success: false, error: 'Spotify not connected' });
    }
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ success: false, error: 'deviceId required' });
    }

    console.log(`🔀 Transfer request to device ${deviceId} (play=${!!play})`);
    await spotifyService.ensureValidToken();

    // Verify device presence; attempt activation if missing
    const devices = await spotifyService.getUserDevices();
    const found = devices.find(d => d.id === deviceId);
    if (!found) {
      console.log('⚠️ Target device not in list; attempting activation...');
      const activated = await spotifyService.activateDevice(deviceId);
      if (!activated) {
        return res.status(404).json({ success: false, error: 'Device not available; open Spotify on that device and try again' });
      }
    }

    await spotifyService.transferPlayback(deviceId, !!play);
    console.log(`✅ Transferred playback to ${deviceId}`);

    // Return diagnostic info to help verify account/device context
    let profile = null;
    try { profile = await spotifyService.getCurrentUserProfile(); } catch (_) {}
    const devicesAfter = await spotifyService.getUserDevices();
    const currentPlayback = await spotifyService.getCurrentPlaybackState();
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
    const track = await spotifyService.getCurrentTrack();
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
    await spotifyService.ensureValidToken();
    await spotifyService.setShuffleState(!!shuffle, deviceId);
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
    await spotifyService.ensureValidToken();
    await spotifyService.setRepeatState(state, deviceId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error setting repeat:', error);
    res.status(500).json({ success: false, error: 'Failed to set repeat' });
  }
});

app.post('/api/spotify/previous', async (req, res) => {
  try {
    const { deviceId } = req.body;
    await spotifyService.ensureValidToken();
    await spotifyService.previousTrack(deviceId);
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
    await spotifyService.ensureValidToken();
    await spotifyService.addToQueue(uri, deviceId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error adding to queue:', error);
    res.status(500).json({ success: false, error: 'Failed to add to queue' });
  }
});

// Force device detection by attempting playback
app.post('/api/spotify/force-device', async (req, res) => {
  try {
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }

    console.log('🔄 Attempting to force device detection...');
    
    // Use the enhanced forceDeviceActivation method
    const result = await spotifyService.forceDeviceActivation();
    
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

// Refresh Spotify connection endpoint
app.post('/api/spotify/refresh', async (req, res) => {
  try {
    if (!spotifyTokens || !spotifyTokens.refreshToken) {
      return res.status(401).json({ error: 'No refresh token available' });
    }

    console.log('🔄 Refreshing Spotify access token...');
    
    // Refresh the access token
    const newAccessToken = await spotifyService.refreshAccessToken();
    
    // Update stored tokens
    spotifyTokens.accessToken = newAccessToken;
    saveTokens(spotifyTokens);
    
    console.log('✅ Spotify access token refreshed successfully');
    
    // Reactivate the preferred device
    await activatePreferredDevice();
    
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
    
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (volume === undefined || volume < 0 || volume > 100) {
      return res.status(400).json({ error: 'Invalid volume level (0-100)' });
    }
    
    console.log(`🔊 Setting volume to ${volume}% on device: ${deviceId}`);
    
    await spotifyService.ensureValidToken();
    await spotifyService.setVolume(volume, deviceId);
    
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
    
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (position === undefined || position < 0) {
      return res.status(400).json({ error: 'Invalid position' });
    }
    
    console.log(`⏩ Seeking to position ${position}ms on device: ${deviceId}`);
    
    await spotifyService.ensureValidToken();
    await spotifyService.seekToPosition(position, deviceId);
    
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
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      return res.status(401).json({ success: false, error: 'Spotify not connected' });
    }
    
    await spotifyService.ensureValidToken();
    const playback = await spotifyService.getCurrentPlaybackState();
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
    
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    await spotifyService.ensureValidToken();
    const tracks = await spotifyService.getPlaylistTracks(playlistId);
    
    res.json({
      success: true,
      tracks: tracks
    });
  } catch (error) {
    console.error('❌ Error getting playlist tracks:', error);
    res.status(500).json({ error: 'Failed to get playlist tracks' });
  }
});

// Create permanent output playlist
app.post('/api/spotify/create-output-playlist', async (req, res) => {
  try {
    const { name, trackIds, description } = req.body;
    
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (!name || !trackIds || !Array.isArray(trackIds)) {
      return res.status(400).json({ error: 'Name and trackIds array required' });
    }
    
    await spotifyService.ensureValidToken();
    
    // Convert track IDs to URIs
    const trackUris = trackIds.map(id => `spotify:track:${id}`);
    
    // Create the output playlist
    const result = await spotifyService.createOutputPlaylist(name, trackUris, description);
    
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
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    await spotifyService.ensureValidToken();
    const playlists = await spotifyService.getGameOfTonesPlaylists();
    
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
    
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      console.log('❌ Spotify not connected');
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    if (!playlistIds || !Array.isArray(playlistIds) || playlistIds.length === 0) {
      console.log('❌ Invalid playlistIds:', playlistIds);
      return res.status(400).json({ error: 'playlistIds array required' });
    }
    
    console.log('🔑 Ensuring valid token...');
    await spotifyService.ensureValidToken();
    
    console.log('🗑️ Deleting playlists...');
    const results = await spotifyService.deleteMultiplePlaylists(playlistIds);
    
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
    
    console.log('🤖 Spotify tokens status:', { 
      hasTokens: !!spotifyTokens, 
      hasAccessToken: !!(spotifyTokens && spotifyTokens.accessToken) 
    });
    
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      console.log('🤖 Returning Spotify not connected error');
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    await spotifyService.ensureValidToken();
    
    console.log(`🤖 Generating AI suggestions for playlist: "${playlistName}"`);
    console.log(`📊 Current songs: ${existingSongs?.length || 0}, Target: ${targetCount}`);
    
    // Analyze playlist name for themes and keywords
    const suggestions = await generateSmartSuggestions(playlistName, existingSongs, targetCount);
    
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
async function generateSmartSuggestions(playlistName, existingSongs = [], targetCount = 15) {
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
    
    if (!spotifyTokens || !spotifyTokens.accessToken) {
      return res.status(401).json({ error: 'Spotify not connected' });
    }
    
    console.log(`▶️ Resuming playback on device: ${deviceId}`);
    
    await spotifyService.ensureValidToken();
    await spotifyService.resumePlayback(deviceId);
    
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
        await spotifyService.ensureValidToken();
        
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
    const devices = await spotifyService.getUserDevices();
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
        await spotifyService.transferPlayback(targetDevice.id, false);
        try { await spotifyService.setShuffleState(false, targetDevice.id); } catch (_) {}
        try { await spotifyService.setRepeatState('off', targetDevice.id); } catch (_) {}
        console.log(`✅ Asserted control on device without playback: ${targetDevice.name}`);
          } catch (error) {
        console.log(`⚠️ Could not assert control on ${targetDevice.name}, but device is available`);
      }
    }
  } catch (error) {
    console.error('❌ Error activating preferred device:', error);
  }
} 

