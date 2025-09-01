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
require('dotenv').config();

const app = express();
// Logging verbosity
const VERBOSE = process.env.VERBOSE_LOGS === '1' || process.env.DEBUG === '1';
const server = http.createServer(app);
const clientBuildPath = path.join(__dirname, '..', 'client', 'build');
const hasClientBuild = fs.existsSync(clientBuildPath);
console.log('NODE_ENV:', process.env.NODE_ENV, 'Client build exists:', hasClientBuild, 'at', clientBuildPath);

// CORS configuration
const isProduction = process.env.NODE_ENV === 'production';
const allowedOriginsEnv = process.env.CORS_ORIGINS || '';
const allowAllCors = allowedOriginsEnv === '*' || (!allowedOriginsEnv && isProduction);
const allowedOrigins = allowedOriginsEnv
  ? allowedOriginsEnv.split(',').map(s => s.trim()).filter(Boolean)
  : ["http://127.0.0.1:7094", "http://localhost:7094", "http://127.0.0.1:3002", "http://localhost:3002"];

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
const PREQUEUE_WINDOW_DEFAULT = 5;
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

// Load tokens from file if they exist
function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      console.log('📁 Loaded Spotify tokens from file');
      return tokenData;
    }
  } catch (error) {
    console.error('❌ Error loading tokens from file:', error);
  }
  return null;
}

// Save tokens to file
function saveTokens(tokens) {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    console.log('💾 Saved Spotify tokens to file');
  } catch (error) {
    console.error('❌ Error saving tokens to file:', error);
  }
}

// Load saved device from file
function loadSavedDevice() {
  try {
    if (fs.existsSync(DEVICE_FILE)) {
      const deviceData = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
      console.log('📁 Loaded saved device:', deviceData.name);
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
    // Enforce lock-joins if enabled (non-hosts only)
    if (!isHost && room && room.lockJoins) {
      socket.emit('room-locked', { message: 'Room is locked. Please wait for the next round.' });
      return;
    }
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
  
  // Add a small buffer to prevent premature song changes
  const bufferedDelay = Math.max(delay - 500, delay * 0.95); // 500ms buffer or 95% of original time
  
  // Set new timer
  const timerId = setTimeout(() => {
    const room = rooms.get(roomId);
    const currentTime = Date.now();
    if (VERBOSE) {
      console.log(`🔍 TIMER FIRED - Room: ${roomId}, Time: ${currentTime}, Expected Duration: ${delay}ms, Actual Duration: ${bufferedDelay}ms`);
      console.log(`🔍 Room State - GameState: ${room?.gameState}, CurrentSongIndex: ${room?.currentSongIndex}, TotalSongs: ${room?.playlistSongs?.length}`);
      console.log(`🔍 Current Song - ${room?.currentSong?.name} by ${room?.currentSong?.artist}`);
      console.log(`🔍 Room exists: ${!!room}, Room ID: ${room?.id}`);
    }
    
    roomTimers.delete(roomId);
    if (VERBOSE) console.log(`🔍 About to execute callback for room ${roomId}`);
    callback();
    if (VERBOSE) console.log(`🔍 Callback executed for room ${roomId}`);
  }, bufferedDelay);
  
  roomTimers.set(roomId, timerId);
  if (VERBOSE) console.log(`⏰ Set timer for room ${roomId}: ${bufferedDelay}ms (original: ${delay}ms) at ${Date.now()}`);
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
      await spotifyService.transferPlayback(targetDeviceId, true);
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
      await spotifyService.startPlayback(targetDeviceId, [`spotify:track:${song.id}`], 0);
      const endTime = Date.now();
      console.log(`✅ Successfully started playback on device: ${targetDeviceId} (took ${endTime - startTime}ms)`);
      
      // Set initial volume to 50% (or room's saved volume) with retry
      let volumeSet = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const initialVolume = room.volume || 50;
          await spotifyService.setVolume(initialVolume, targetDeviceId);
          console.log(`🔊 Set initial volume to ${initialVolume}% (attempt ${attempt + 1})`);
          volumeSet = true;
          break;
        } catch (volumeError) {
          console.error(`❌ Error setting initial volume (attempt ${attempt + 1}):`, volumeError);
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 200)); // Wait 200ms before retry
          }
        }
      }
      
      if (!volumeSet) {
        console.warn('⚠️ Failed to set volume after 3 attempts, continuing anyway');
      }
    } catch (playbackError) {
      console.error('❌ Error starting playback:', playbackError);
      
      // In strict mode, do not fallback silently
      console.error('❌ Playback error in strict mode:', playbackError?.body?.error?.message || playbackError?.message || playbackError);
      io.to(roomId).emit('playback-error', { message: 'Playback failed on locked device. Ensure it is online and try again.' });
      return;
    }

    room.currentSong = {
      id: song.id,
      name: song.name,
      artist: song.artist
    };

    io.to(roomId).emit('song-playing', {
      songId: song.id,
      songName: song.name,
      artistName: song.artist,
      snippetLength: room.snippetLength,
      currentIndex: songIndex,
      totalSongs: room.playlistSongs.length,
      previewUrl: (room.playlistSongs[songIndex]?.previewUrl) || null
    });

    console.log(`✅ Playing song in room ${roomId}: ${song.name} by ${song.artist} on device ${targetDeviceId}`);

    // Schedule next song using timer management and ensure watchdog running
    setRoomTimer(roomId, () => {
      playNextSong(roomId, targetDeviceId);
    }, room.snippetLength * 1000);
    startPlaybackWatchdog(roomId, targetDeviceId, room.snippetLength * 1000);
  } catch (error) {
    console.error('❌ Error playing song at index:', error);
    // Try to continue with next song after a delay using timer management
    setRoomTimer(roomId, () => {
      playNextSong(roomId, deviceId);
    }, 5000);
  }
}

// Initialize Spotify service and tokens
const spotifyService = new SpotifyService();
let spotifyTokens = loadTokens(); // Load tokens on startup

// If we have tokens, set them in the service
if (spotifyTokens) {
  spotifyService.setTokens(spotifyTokens.accessToken, spotifyTokens.refreshToken);
  console.log('✅ Restored Spotify connection from saved tokens');
}

// Timer management to prevent conflicts
const roomTimers = new Map();
// Playback watchdogs per room to recover from mid-snippet stalls
const roomPlaybackWatchers = new Map();

function clearPlaybackWatcher(roomId) {
  if (roomPlaybackWatchers.has(roomId)) {
    clearInterval(roomPlaybackWatchers.get(roomId));
    roomPlaybackWatchers.delete(roomId);
  }
}

function startPlaybackWatchdog(roomId, deviceId, snippetMs) {
  clearPlaybackWatcher(roomId);
  let attempts = 0;
  const intervalId = setInterval(async () => {
    try {
      const room = rooms.get(roomId);
      if (!room || room.gameState !== 'playing') { clearPlaybackWatcher(roomId); return; }
      const state = await spotifyService.getCurrentPlaybackState();
      const isPlaying = !!state?.is_playing;
      const currentId = state?.item?.id;
      const progress = Number(state?.progress_ms || 0);
      if (isPlaying) { attempts = 0; return; }
      attempts += 1;
      if (attempts === 1) {
        try { await spotifyService.resumePlayback(deviceId); } catch {}
      } else if (attempts >= 2) {
        io.to(roomId).emit('playback-warning', { message: 'Playback stalled; advancing to next track.' });
        clearPlaybackWatcher(roomId);
        clearRoomTimer(roomId);
        await playNextSong(roomId, deviceId);
      }
      // Overrun guard: if snippet time essentially elapsed on same track, force advance
      if (room?.currentSong?.id && currentId === room.currentSong.id && progress >= Math.max(0, snippetMs - 300)) {
        clearPlaybackWatcher(roomId);
        clearRoomTimer(roomId);
        await playNextSong(roomId, deviceId);
      }
    } catch (_e) {
      // ignore
    }
  }, Math.max(2500, Math.min(5000, snippetMs / 6)));
  roomPlaybackWatchers.set(roomId, intervalId);
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join room
  socket.on('join-room', (data) => {
    const { roomId, playerName, isHost = false, clientId } = data;
    console.log(`Player ${playerName} (${isHost ? 'host' : 'player'}) joining room: ${roomId}`);
    
    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      console.log(`Creating new room: ${roomId}`);
      const newRoom = {
        id: roomId,
        host: isHost ? socket.id : null,
        players: new Map(),
        gameState: 'waiting',
        snippetLength: 30,
        winners: [],
        repeatMode: false,
        volume: 50,
        playlistSongs: [],
        currentSongIndex: 0,
        preQueueEnabled: false,
        preQueueWindow: PREQUEUE_WINDOW_DEFAULT,
        queuedIndices: new Set()
      };
      rooms.set(roomId, newRoom);
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

    // Log available devices for debugging
    console.log('Available devices:', Array.from(room.players.values()).map(p => p.name));

    // If a game is already in progress or mix is finalized, provide the joining player with state
    (async () => {
      try {
        if (!isHost) {
          // Emit current song to the joining player to sync display timing
          if (room.currentSong && room.snippetLength) {
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

          // Ensure bingo card exists for this player, reusing clientId mapping if provided
          if (!room.bingoCards) room.bingoCards = new Map();
          const bySocket = room.bingoCards.get(socket.id);
          if (bySocket) {
            io.to(socket.id).emit('bingo-card', bySocket);
          } else if (clientId && room.clientCards && room.clientCards.has(clientId)) {
            const existingCard = room.clientCards.get(clientId);
            room.bingoCards.set(socket.id, existingCard);
            const p = room.players.get(socket.id);
            if (p) p.bingoCard = existingCard;
            io.to(socket.id).emit('bingo-card', existingCard);
          } else if (room.playlistSongs?.length || room.playlists?.length || room.finalizedPlaylists?.length) {
            // generate and store mapping by clientId if present
            const card = await generateBingoCardForPlayer(roomId, socket.id);
            if (clientId) {
              if (!room.clientCards) room.clientCards = new Map();
              room.clientCards.set(clientId, card);
            }
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

    // Check if this socket is the host
    const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
    
    if (!isCurrentHost) {
      console.log('❌ Only host can finalize mix');
      return;
    }

    try {
      // Persist finalized data, including host-ordered song list if provided
      room.finalizedPlaylists = playlists;
      room.finalizedSongOrder = Array.isArray(songList) ? songList : null;
      
      // Generate bingo cards for all players (respect host order where applicable)
      await generateBingoCards(roomId, playlists, room.finalizedSongOrder);
      
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
      const { roomId, pattern } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
      if (!isCurrentHost) return;
      const allowed = new Set(['line', 'four_corners', 'x', 'full_card']);
      room.pattern = allowed.has(pattern) ? pattern : 'line';
      io.to(roomId).emit('pattern-updated', { pattern: room.pattern });
      console.log(`🎯 Pattern set to ${room.pattern} for room ${roomId}`);
    } catch (e) {
      console.error('❌ Error setting pattern:', e?.message || e);
    }
  });

  // Player calls BINGO (validated server-side)
  socket.on('player-bingo', (data) => {
    const { roomId } = data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || !player.bingoCard) return;
    const valid = validateBingoForPattern(player.bingoCard, room);
    if (valid && !player.hasBingo) {
      player.hasBingo = true;
      room.winners.push({ playerId: socket.id, playerName: player.name, timestamp: Date.now() });
      io.to(roomId).emit('bingo-called', { playerId: socket.id, playerName: player.name, winners: room.winners });
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
      room.queuedIndices = new Set();
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

  // Host can enable/disable pre-queue and adjust window
  socket.on('set-prequeue', (data = {}) => {
    try {
      const { roomId, enabled, window = PREQUEUE_WINDOW_DEFAULT } = data;
      const room = rooms.get(roomId);
      if (!room) return;
      const isCurrentHost = room && (room.host === socket.id || (room.players.get(socket.id) && room.players.get(socket.id).isHost));
      if (!isCurrentHost) return;
      room.preQueueEnabled = !!enabled;
      const w = Number(window);
      room.preQueueWindow = Number.isFinite(w) && w > 0 && w <= 20 ? w : PREQUEUE_WINDOW_DEFAULT;
      if (!room.preQueueEnabled) room.queuedIndices = new Set();
      io.to(roomId).emit('prequeue-updated', { enabled: room.preQueueEnabled, window: room.preQueueWindow });
      console.log(`🎚️ Pre-queue set to ${room.preQueueEnabled} (window=${room.preQueueWindow}) for room ${roomId}`);
    } catch (e) {
      console.error('❌ Error setting pre-queue:', e?.message || e);
    }
  });

  socket.on('start-game', async (data) => {
    console.log('🎮 Start game event received:', data);
    const { roomId, playlists, snippetLength = 30, deviceId, songList } = data;
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
        // Initialize call history and round
        room.calledSongIds = [];
        room.round = (room.round || 0) + 1;
        // Default pattern if not set
        room.pattern = room.pattern || 'full_card';

        // Emit game started as soon as state is ready so UI can show controls
        io.to(roomId).emit('game-started', {
          roomId,
          snippetLength,
          deviceId,
          pattern: room.pattern
        });

        console.log('🎵 Generating bingo cards...');
        // If mix is already finalized and cards exist, do NOT regenerate to avoid reshuffle
        if (!room.mixFinalized || !room.bingoCards || room.bingoCards.size === 0) {
          // If mix was finalized, reuse finalized song order to enforce 1x75 deterministically
          await generateBingoCards(roomId, playlists, room.finalizedSongOrder || null);
        } else {
          console.log('🛑 Skipping card regeneration (mix finalized and cards already exist)');
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
          volume: 50,
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
              console.warn('⚠️ Pause retry failed; muting as fallback:', retryErr?.message || retryErr);
              // Last-resort mute so show continues silently
              try { await spotifyService.setVolume(0, deviceId); } catch {}
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
        io.to(roomId).emit('playback-warning', { message: `Pause problem: ${msg}` });
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
          await spotifyService.transferPlayback(deviceId, true);
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
        socket.emit('error', { message: `Failed to resume song: ${msg}` });
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
          // Fisher-Yates shuffle
          for (let i = room.playlistSongs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [room.playlistSongs[i], room.playlistSongs[j]] = [room.playlistSongs[j], room.playlistSongs[i]];
          }
          room.currentSongIndex = 0;
          console.log('✅ Playlist shuffled successfully');
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
        artistName,
        snippetLength: room.snippetLength
      });
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
          
          // Check for bingo
          const hasBingo = checkBingo(card);
          if (hasBingo && !player.hasBingo) {
            player.hasBingo = true;
            room.winners.push({
              playerId: socket.id,
              playerName: player.name,
              timestamp: Date.now()
            });
            
            io.to(roomId).emit('bingo-called', {
              playerId: socket.id,
              playerName: player.name,
              winners: room.winners
            });
          }
        }
      }
    }
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

    // Prepare per-playlist unique arrays
    const perListUnique = playlistsWithSongs.map(pl => ({
      id: pl.id,
      name: pl.name,
      songs: dedup(Array.isArray(pl.songs) ? pl.songs : [])
    }));

    let mode = 'fallback';
    // 1x75 mode: exactly 1 playlist with at least 75 unique songs
    if (perListUnique.length === 1 && perListUnique[0].songs.length >= 75) {
      mode = '1x75';
    }
    // 5x15 mode: exactly 5 playlists each with at least 15 unique songs
    if (perListUnique.length === 5 && perListUnique.every(pl => pl.songs.length >= 15)) {
      mode = '5x15';
    }

    console.log(`🎯 Card generation mode: ${mode}`);

    // If 5x15, compute and broadcast fixed 5 columns × 15 songs for the display
    if (mode === '5x15') {
      try {
        const fiveCols = [];
        for (let col = 0; col < 5; col++) {
          const src = [...perListUnique[col].songs].sort(() => Math.random() - 0.5).slice(0, 15);
          fiveCols.push(src);
        }
        const roomRef = rooms.get(roomId);
        if (roomRef) {
          roomRef.fiveByFifteenColumns = fiveCols.map(col => col.map(s => ({ id: s.id })));
          io.to(roomId).emit('fiveby15-pool', { columns: fiveCols.map(col => col.map(s => s.id)) });
        }
      } catch (e) {
        console.warn('⚠️ Failed to compute/emit fiveby15-pool:', e?.message || e);
      }
    }

    // Build fallback global pool when needed (prefer host-provided order if available)
    const buildGlobalPool = () => {
      if (Array.isArray(songOrder) && songOrder.length > 0) {
        return dedup(songOrder);
      }
      const map = new Map();
      for (const pl of perListUnique) {
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
        const allowed = new Set(perListUnique[0].songs.map(s => s.id));
        base = dedup(songOrder.filter(s => allowed.has(s.id))).slice(0, 75);
      } else {
        base = [...perListUnique[0].songs].sort(() => Math.random() - 0.5).slice(0, 75);
      }
      const roomRef = rooms.get(roomId);
      if (roomRef) {
        roomRef.oneBySeventyFivePool = base.map(s => ({ id: s.id }));
        io.to(roomId).emit('oneby75-pool', { ids: base.map(s => s.id) });
      }
    }

    const cards = new Map();
    if (!room.clientCards) room.clientCards = new Map();
    console.log(`👥 Generating cards for ${room.players.size} players`);

    for (const [playerId, player] of room.players) {
      let chosen25 = [];
      if (mode === '1x75') {
        // Use the same base computed above to ensure consistency
        const base = (rooms.get(roomId)?.oneBySeventyFivePool || []).map(x => perListUnique[0].songs.find(s => s.id === x.id)).filter(Boolean);
        if (!ensureEnough(base.length)) return;
        chosen25 = [...base].sort(() => Math.random() - 0.5).slice(0, songsNeededPerCard);
      } else if (mode === '5x15') {
        // For each of 5 playlists, sample 5 unique tracks, ensuring cross-column uniqueness
        const used = new Set();
        const columns = [];
        let ok = true;
        for (let col = 0; col < 5; col++) {
          const pool = [...perListUnique[col].songs].sort(() => Math.random() - 0.5);
          const colPicks = [];
          for (const s of pool) {
            if (!used.has(s.id)) { colPicks.push(s); used.add(s.id); }
            if (colPicks.length === 5) break;
          }
          if (colPicks.length < 5) { ok = false; break; }
          columns.push(colPicks);
        }
        if (!ok) {
          console.warn('⚠️ 5x15 mode fell short; falling back to global pool');
          const global = buildGlobalPool();
          if (!ensureEnough(global.length)) return;
          chosen25 = [...global].sort(() => Math.random() - 0.5).slice(0, songsNeededPerCard);
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
        if (!ensureEnough(pool.length)) return;
        chosen25 = [...pool].sort(() => Math.random() - 0.5).slice(0, songsNeededPerCard);
      }

      // Build card
      const card = { id: playerId, squares: [] };
      let idx = 0;
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
          const s = chosen25[idx++];
          card.squares.push({
            position: `${row}-${col}`,
            songId: s.id,
            songName: s.name,
            artistName: s.artist,
            marked: false
          });
        }
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
    }

    room.bingoCards = cards;
    console.log(`✅ Generated bingo cards for room ${roomId}`);
  } catch (error) {
    console.error('❌ Error generating bingo cards:', error);
  }
}

// Generate a single bingo card for one player (if they join mid-game)
async function generateBingoCardForPlayer(roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room || !Array.isArray(room.playlists)) return;
  // Build a single card using the same 1x75 / 5x15 logic used for all players
  try {
    // Fetch per-playlist songs and de-duplicate per list
    const playlistsWithSongs = [];
    for (const playlist of room.playlists) {
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

    let mode = 'fallback';
    if (perListUnique.length === 1 && perListUnique[0].songs.length >= 75) mode = '1x75';
    if (perListUnique.length === 5 && perListUnique.every(pl => pl.songs.length >= 15)) mode = '5x15';
    console.log(`🎯 Late-join card mode: ${mode}`);

    const buildGlobalPool = () => {
      if (Array.isArray(room.finalizedSongOrder) && room.finalizedSongOrder.length > 0) {
        return dedup(room.finalizedSongOrder);
      }
      const map = new Map();
      for (const pl of perListUnique) { for (const s of pl.songs) { if (!map.has(s.id)) map.set(s.id, s); } }
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
        const allowed = new Set(perListUnique[0].songs.map(s => s.id));
        base = dedup(room.finalizedSongOrder.filter(s => allowed.has(s.id))).slice(0, 75);
      } else {
        base = [...perListUnique[0].songs].sort(() => Math.random() - 0.5).slice(0, 75);
      }
      if (!ensureEnough(base.length)) return;
      chosen25 = [...base].sort(() => Math.random() - 0.5).slice(0, songsNeededPerCard);
    } else if (mode === '5x15') {
      const used = new Set();
      const columns = [];
      let ok = true;
      for (let col = 0; col < 5; col++) {
        const pool = [...perListUnique[col].songs].sort(() => Math.random() - 0.5);
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
        chosen25 = [...global].sort(() => Math.random() - 0.5).slice(0, songsNeededPerCard);
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
      chosen25 = [...pool].sort(() => Math.random() - 0.5).slice(0, songsNeededPerCard);
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
    
    if (songList && songList.length > 0) {
      // Use the song list provided by the client (already shuffled)
      console.log(`📋 Using client-provided song list with ${songList.length} songs`);
      allSongs = songList;
    } else {
      // Fallback: fetch songs from playlists (for backward compatibility)
      console.log('📋 Fetching songs from playlists for playback...');
      for (const playlist of playlists) {
        try {
          console.log(`📋 Fetching songs for playlist: ${playlist.name}`);
          const songs = await spotifyService.getPlaylistTracks(playlist.id);
          console.log(`✅ Found ${songs.length} songs in playlist: ${playlist.name}`);
          allSongs.push(...songs);
        } catch (error) {
          console.error(`❌ Error fetching songs for playlist ${playlist.id}:`, error);
        }
      }
    }

    // If 5x15 columns were finalized during card generation, prefer those 75 songs for playback
    const fiveCols = Array.isArray(room.fiveByFifteenColumns) ? room.fiveByFifteenColumns : null;
    if (!songList && fiveCols && fiveCols.length === 5 && fiveCols.every(c => Array.isArray(c) && c.length === 15)) {
      try {
        const idToSong = new Map(allSongs.map(s => [s.id, s]));
        const flattened = [];
        for (let col = 0; col < 5; col++) {
          for (let row = 0; row < 15; row++) {
            const entry = fiveCols[col][row];
            const s = idToSong.get(entry.id);
            if (s) flattened.push(s);
          }
        }
        if (flattened.length === 75) {
          console.log('🎼 Using finalized 5x15 columns (75 songs) for playback');
          allSongs = flattened;
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

      await spotifyService.transferPlayback(targetDeviceId, true);
      // Enforce deterministic playback mode to avoid context/radio fallbacks
      try { await spotifyService.setShuffleState(false, targetDeviceId); } catch (_) {}
      try { await spotifyService.setRepeatState('off', targetDeviceId); } catch (_) {}
      // Use explicit device_id and uris as fallback in case transfer isn't picked up
      await spotifyService.startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], 0);
      console.log(`✅ Successfully started playback on device: ${targetDeviceId}`);
      
      // Set initial volume to 50% (or room's saved volume)
      try {
        const initialVolume = room.volume || 50;
        await spotifyService.setVolume(initialVolume, targetDeviceId);
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
          await spotifyService.transferPlayback(targetDeviceId, true);
          await spotifyService.startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], 0);
          console.log(`✅ Successfully started playback after token refresh`);
          
          // Set initial volume to 50% (or room's saved volume)
          try {
            const initialVolume = room.volume || 50;
            await spotifyService.setVolume(initialVolume, targetDeviceId);
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
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 300));
        const state = await spotifyService.getCurrentPlaybackState();
        playing = !!state?.is_playing;
        const currentId = state?.item?.id;
        correctTrack = currentId === firstSong.id;
        console.log(`🔎 Playback verify attempt ${i + 1}: is_playing=${playing} correct_track=${correctTrack}`);
        if (playing) break;
        try { await spotifyService.resumePlayback(targetDeviceId); } catch (e) {
          console.warn('⚠️ Resume during verify failed:', e?.message || e);
        }
      }
      if (!playing || !correctTrack) {
        // Attempt to correct to the intended track once
        try { await spotifyService.startPlayback(targetDeviceId, [`spotify:track:${firstSong.id}`], 0); } catch {}
      }
      if (!playing) {
        io.to(roomId).emit('playback-warning', { message: 'Playback did not start reliably on the locked device. Please check Spotify is active and not muted.' });
      }
    } catch (e) {
      console.warn('⚠️ Playback verification error:', e?.message || e);
      io.to(roomId).emit('playback-warning', { message: `Playback verification error: ${e?.message || 'Unknown error'}` });
    }

    // Optionally pre-queue next window of songs
    room.queuedIndices = room.queuedIndices instanceof Set ? room.queuedIndices : new Set();
    if (room.preQueueEnabled) {
      try {
        const w = room.preQueueWindow || PREQUEUE_WINDOW_DEFAULT;
        for (let i = 1; i <= w; i++) {
          const idx = (room.currentSongIndex + i) % allSongs.length;
          if (!room.queuedIndices.has(idx)) {
            await spotifyService.addToQueue(`spotify:track:${allSongs[idx].id}`, targetDeviceId);
            room.queuedIndices.add(idx);
          }
        }
      } catch (e) {
        console.warn('⚠️ Pre-queue (initial) failed:', e?.message || e);
      }
    }

    // Start watchdog to recover from stalls, and set timer for next song
    const songStartTime = Date.now();
    if (VERBOSE) console.log(`⏰ Setting timer for room ${roomId}: ${room.snippetLength} seconds (${room.snippetLength * 1000}ms) at ${songStartTime}`);
    startPlaybackWatchdog(roomId, targetDeviceId, room.snippetLength * 1000);
    setRoomTimer(roomId, async () => {
      const songEndTime = Date.now();
      const actualDuration = songEndTime - songStartTime;
      console.log(`⏰ TIMER CALLBACK EXECUTING for room ${roomId} - calling playNextSong (actual song duration: ${actualDuration}ms)`);
      // Add a small delay to ensure smooth transition
      await new Promise(resolve => setTimeout(resolve, 100));
      await playNextSong(roomId, targetDeviceId);
    }, room.snippetLength * 1000);

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
        await spotifyService.transferPlayback(targetDeviceId, true);
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
      if (VERBOSE) console.log(`🎵 Starting Spotify playback at ${playbackStartTime} for: ${nextSong.name}`);
      // Enforce deterministic playback mode on each advance
      try { await spotifyService.setShuffleState(false, targetDeviceId); } catch (_) {}
      try { await spotifyService.setRepeatState('off', targetDeviceId); } catch (_) {}
      await spotifyService.startPlayback(targetDeviceId, [`spotify:track:${nextSong.id}`], 0);
      const playbackEndTime = Date.now();
      if (VERBOSE) console.log(`✅ Successfully started playback on device: ${targetDeviceId} (took ${playbackEndTime - playbackStartTime}ms)`);
      
      // Set initial volume to 50% (or room's saved volume) with retry
      let volumeSet = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const initialVolume = room.volume || 50;
          await spotifyService.setVolume(initialVolume, targetDeviceId);
          console.log(`🔊 Set initial volume to ${initialVolume}% (attempt ${attempt + 1})`);
          volumeSet = true;
          break;
        } catch (volumeError) {
          console.error(`❌ Error setting initial volume (attempt ${attempt + 1}):`, volumeError);
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 200)); // Wait 200ms before retry
          }
        }
      }
      
      if (!volumeSet) {
        console.warn('⚠️ Failed to set volume after 3 attempts, continuing anyway');
      }
    } catch (playbackError) {
      console.error('❌ Error starting playback:', playbackError);
      
      // In strict mode, do not fallback silently
      console.error('❌ Playback error in strict mode:', playbackError?.body?.error?.message || playbackError?.message || playbackError);
      io.to(roomId).emit('playback-error', { message: 'Playback failed on locked device. Ensure it is online and try again.' });
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
      artistName: nextSong.artist,
      snippetLength: room.snippetLength,
      currentIndex: room.currentSongIndex,
      totalSongs: room.playlistSongs.length,
      previewUrl: (room.playlistSongs[room.currentSongIndex]?.previewUrl) || null
    });

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
        console.log(`🔎 Playback verify (next) attempt ${i + 1}: is_playing=${playing} correct_track=${correctTrack}`);
        if (playing) break;
        try { await spotifyService.resumePlayback(targetDeviceId); } catch {}
      }
      if (!playing || !correctTrack) {
        // Attempt to correct to the intended track once
        try { await spotifyService.startPlayback(targetDeviceId, [`spotify:track:${nextSong.id}`], 0); } catch {}
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
      await new Promise(r => setTimeout(r, 3500));
      const state = await spotifyService.getCurrentPlaybackState();
      const progress = Number(state?.progress_ms || 0);
      const isPlaying = !!state?.is_playing;
      if (!isPlaying || progress < 1000) {
        console.warn('⚠️ Early-fail detected; advancing via playNextSong');
        clearRoomTimer(roomId);
        await playNextSong(roomId, targetDeviceId);
      }
    } catch (e) {
      console.warn('⚠️ Early-fail check error:', e?.message || e);
    }

    // Optionally maintain pre-queue window by topping up
    if (room.preQueueEnabled) {
      try {
        const w = room.preQueueWindow || PREQUEUE_WINDOW_DEFAULT;
        for (let i = 1; i <= w; i++) {
          const idx = (room.currentSongIndex + i) % room.playlistSongs.length;
          if (!room.queuedIndices.has(idx)) {
            await spotifyService.addToQueue(`spotify:track:${room.playlistSongs[idx].id}`, targetDeviceId);
            room.queuedIndices.add(idx);
          }
        }
        // clear indices that are behind current index to keep set small
        room.queuedIndices.forEach((idx) => {
          const distance = (idx - room.currentSongIndex + room.playlistSongs.length) % room.playlistSongs.length;
          if (distance === 0 || distance > w) room.queuedIndices.delete(idx);
        });
      } catch (e) {
        console.warn('⚠️ Pre-queue (top-up) failed:', e?.message || e);
      }
    }

    // Start watchdog to recover from stalls, and schedule next song
    setRoomTimer(roomId, async () => {
      const transitionTime = Date.now();
      if (VERBOSE) console.log(`🔄 TRANSITION STARTING - Room: ${roomId}, Time: ${transitionTime}`);
      if (VERBOSE) console.log(`🔄 Song ending: ${nextSong.name} by ${nextSong.artist}`);
      
      // Add a small delay to ensure smooth transition
      await new Promise(resolve => setTimeout(resolve, 100));
      if (VERBOSE) console.log(`🔄 Transition delay complete, calling playNextSong`);
      clearRoomTimer(roomId);
      playNextSong(roomId, targetDeviceId);
    }, room.snippetLength * 1000);

  } catch (error) {
    console.error('❌ Error playing next song:', error);
    // Try to continue with next song after a delay using timer management
    setRoomTimer(roomId, () => {
      playNextSong(roomId, deviceId);
    }, 5000);
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

function validateBingoForPattern(card, room) {
  const pattern = room?.pattern || 'full_card';
  if (pattern === 'full_card') {
    // All squares must be marked
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const square = card.squares.find(s => s.position === `${row}-${col}`);
        if (!square || !square.marked) return false;
      }
    }
    return true;
  }
  if (pattern === 'four_corners') {
    const required = ['0-0', '0-4', '4-0', '4-4'];
    return required.every(pos => {
      const sq = card.squares.find(s => s.position === pos);
      return !!sq && !!sq.marked;
    });
  }
  if (pattern === 'x') {
    for (let i = 0; i < 5; i++) {
      const a = card.squares.find(s => s.position === `${i}-${i}`);
      const b = card.squares.find(s => s.position === `${i}-${4 - i}`);
      if (!a || !a.marked || !b || !b.marked) return false;
    }
    return true;
  }
  // default: any single line using existing checker
  return checkBingo(card);
}

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Game of Tones Server Running' });
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

app.get('/api/spotify/status', (req, res) => {
  res.json({ 
    connected: !!spotifyTokens,
    hasTokens: !!spotifyTokens?.accessToken
  });
});

// Force clear Spotify tokens (for testing)
app.post('/api/spotify/clear', (req, res) => {
  spotifyTokens = null;
  spotifyService.setTokens(null, null);
  
  // Remove saved tokens file
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
      console.log('🗑️  Removed saved Spotify tokens file');
    }
  } catch (error) {
    console.error('❌ Error removing tokens file:', error);
  }
  
  console.log('Forced clear of Spotify tokens');
  res.json({ success: true, message: 'Spotify tokens cleared' });
});

app.get('/api/spotify/callback', async (req, res) => {
  const { code } = req.query;
  
  console.log('Spotify callback received with code:', code ? code.substring(0, 20) + '...' : 'NO CODE');
  
  if (!code) {
    console.error('No authorization code provided');
    return res.status(400).json({ error: 'Authorization code required' });
  }

  // Check if we already have tokens (prevent duplicate processing)
  if (spotifyTokens) {
    console.log('Already have tokens, returning success without processing code again');
    return res.json({ 
      success: true, 
      message: 'Spotify already connected',
      tokens: spotifyTokens
    });
  }

  try {
    console.log('Calling spotifyService.handleCallback...');
    const tokens = await spotifyService.handleCallback(code);
    console.log('Successfully got tokens, storing them...');
    
    // Store tokens for future use
    spotifyTokens = tokens;
    spotifyService.setTokens(tokens.accessToken, tokens.refreshToken);
    saveTokens(tokens); // Save tokens to file
    
    console.log('Spotify connection successful, sending response');
    res.json({ 
      success: true, 
      message: 'Spotify connected successfully',
      tokens
    });
  } catch (error) {
    console.error('Error handling Spotify callback:', error);
    res.status(500).json({ error: 'Failed to connect Spotify' });
  }
});

app.get('/api/spotify/playlists', async (req, res) => {
  try {
    // Check if we have tokens
    if (!spotifyTokens) {
      return res.status(401).json({ error: 'Spotify not connected. Please connect first.' });
    }
    
    const playlists = await spotifyService.getUserPlaylists();
    res.json({ success: true, playlists: playlists });
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
        await activatePreferredDevice();
      }
    } catch (error) {
      console.log('⚠️ Device keep-alive failed (this is normal if no active session)');
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}

// Start the server
const PORT = process.env.PORT || 7093;
server.listen(PORT, async () => {
  console.log(`🎵 Game of Tones server running on port ${PORT}`);
  console.log('🎮 Ready for some musical bingo action!');
  
  // Auto-connect to Spotify
  await autoConnectSpotify();
  
  // Start device keep-alive
  startDeviceKeepAlive();
});

// Auto-connect to Spotify on server startup
async function autoConnectSpotify() {
  console.log('🔄 Attempting automatic Spotify connection...');
  
  try {
    // First try to load existing tokens
    const tokens = loadTokens();
    if (tokens && tokens.accessToken && tokens.refreshToken) {
      console.log('📁 Loaded Spotify tokens from file');
      spotifyTokens = tokens;
      spotifyService.setTokens(tokens.accessToken, tokens.refreshToken);
      
      // Test the connection by refreshing if needed
      try {
        await spotifyService.ensureValidToken();
        console.log('✅ Restored Spotify connection from saved tokens');
        
        // Force device activation to keep your device active
        await activatePreferredDevice();
        
        console.log('🎵 Ready to serve playlists and control playback');
        return true;
      } catch (error) {
        console.log('❌ Saved tokens are invalid, need fresh connection');
        spotifyTokens = null;
        spotifyService.setTokens(null, null);
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
      // Try to activate the device by starting a silent track
      try {
        await spotifyService.startPlayback(
          targetDevice.id, 
          ['spotify:track:4iV5W9uYEdYUVa79Axb7Rh'], // Silent test track
          0
        );
        console.log(`✅ Successfully activated device: ${targetDevice.name}`);
        
        // Pause immediately to not disturb the user
        setTimeout(async () => {
          try {
            await spotifyService.pausePlayback(targetDevice.id);
            console.log(`⏸️ Paused playback on ${targetDevice.name}`);
          } catch (error) {
            console.log('⚠️ Could not pause playback (this is normal)');
          }
        }, 1000);
        
      } catch (error) {
        console.log(`⚠️ Could not activate ${targetDevice.name}, but device is available`);
      }
    }
  } catch (error) {
    console.error('❌ Error activating preferred device:', error);
  }
} 