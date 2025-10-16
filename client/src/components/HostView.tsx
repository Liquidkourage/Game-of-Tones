import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Play, 
  Pause, 
  SkipForward, 
  Music, 
  Trophy
} from 'lucide-react';
import io from 'socket.io-client';
import { API_BASE, SOCKET_URL } from '../config';
import RoundPlanner from './RoundPlanner';

interface Playlist {
  id: string;
  name: string;
  tracks: number;
  description?: string;
  public?: boolean;
  collaborative?: boolean;
  owner?: string;
}

interface Song {
  id: string;
  name: string;
  artist: string;
  duration?: number; // Make duration optional
}

interface EventRound {
  id: string;
  name: string;
  playlistIds: string[];
  playlistNames: string[];
  songCount: number;
  status: 'completed' | 'active' | 'planned' | 'unplanned';
  startedAt?: number;
  completedAt?: number;
}

interface Player {
  id: string;
  name: string;
  isHost: boolean;
  hasBingo: boolean;
}

interface Device {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
}

interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  currentSong: Song | null;
  queue: Song[];
  currentQueueIndex: number;
}

const HostView: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [socket, setSocket] = useState<any>(null);
  const [gameState, setGameState] = useState<'waiting' | 'playing' | 'ended'>('waiting');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylists, setSelectedPlaylists] = useState<Playlist[]>([]);
  const [snippetLength, setSnippetLength] = useState(() => {
    const saved = localStorage.getItem('game-snippet-length');
    return saved ? parseInt(saved) : 30;
  });
  const [winners, setWinners] = useState<Player[]>([]);
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);
  const [isSpotifyConnecting, setIsSpotifyConnecting] = useState(false);
  const [pendingVerification, setPendingVerification] = useState<any>(null);
  const [gamePaused, setGamePaused] = useState(false);
  const [mixFinalized, setMixFinalized] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [randomStarts, setRandomStarts] = useState<boolean>(() => {
    const saved = localStorage.getItem('game-random-starts');
    return saved ? saved === 'true' : false;
  });
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [playedSoFar, setPlayedSoFar] = useState<Array<{ id: string; name: string; artist: string }>>([]);
  const [logs, setLogs] = useState<Array<{ level: 'info' | 'warn' | 'error'; message: string; ts: number }>>([]);
  const [revealMode, setRevealMode] = useState<'off' | 'artist' | 'title' | 'full'>('off');
  const [pattern, setPattern] = useState<'line' | 'four_corners' | 'x' | 'full_card' | 'custom'>('line');
  const [showSetup, setShowSetup] = useState<boolean>(false);
  const [lockJoins, setLockJoins] = useState<boolean>(false);
  const [preQueueEnabled, setPreQueueEnabled] = useState<boolean>(false);
  const [preQueueWindow, setPreQueueWindow] = useState<number>(5);
  const [isProcessingVerification, setIsProcessingVerification] = useState<boolean>(false);
  const [roundComplete, setRoundComplete] = useState<any>(null);
  const [roundWinners, setRoundWinners] = useState<Array<any>>([]);
  const [stripGoTPrefix, setStripGoTPrefix] = useState<boolean>(true);
  const [showPlaylists, setShowPlaylists] = useState<boolean>(true);
  const [showLogs, setShowLogs] = useState<boolean>(true);
  const [customMask, setCustomMask] = useState<string[]>([]);
  const [showSongList, setShowSongList] = useState(false);
  const [playedInOrder, setPlayedInOrder] = useState<Array<{ id: string; name: string; artist: string }>>([]);
  const [superStrict, setSuperStrict] = useState<boolean>(false);
  const [showAllControls, setShowAllControls] = useState<boolean>(false);
  const [showRooms, setShowRooms] = useState<boolean>(false);
  const [rooms, setRooms] = useState<Array<any>>([]);
  const [showPlayerCards, setShowPlayerCards] = useState<boolean>(false);
  const [playerCards, setPlayerCards] = useState<Map<string, any>>(new Map());
  const [showRoundManager, setShowRoundManager] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'setup' | 'play' | 'manage'>('setup');
  
  // Pause position tracking
  const [pausePosition, setPausePosition] = useState<number>(0);
  const [isPausedByInterface, setIsPausedByInterface] = useState(false);

  // Round management state
  interface EventRound {
    id: string;
    name: string;
    playlistIds: string[];
    playlistNames: string[];
    songCount: number;
    status: 'completed' | 'active' | 'planned' | 'unplanned';
    startedAt?: number;
    completedAt?: number;
  }

  const [eventRounds, setEventRounds] = useState<EventRound[]>([
    {
      id: 'round-1',
      name: 'Round 1',
      playlistIds: [],
      playlistNames: [],
      songCount: 0,
      status: 'unplanned'
    }
  ]);
  const [currentRoundIndex, setCurrentRoundIndex] = useState<number>(-1);

  const addLog = (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    setLogs(prev => [{ level, message, ts: Date.now() }, ...prev].slice(0, 50));
  };

  // Advanced playback states
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: parseInt(localStorage.getItem('spotify-volume') || '100'),
    playbackRate: 1,
    currentSong: null,
    queue: [],
    currentQueueIndex: 0
  });
   
  const [isSeeking, setIsSeeking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(100);
  const [songList, setSongList] = useState<Song[]>([]);
  const [finalizedOrder, setFinalizedOrder] = useState<Song[] | null>(null);
  // Playlists state
  const [visiblePlaylists, setVisiblePlaylists] = useState<Playlist[]>([]);
  const [playlistQuery, setPlaylistQuery] = useState('');
  const [suggestionsModal, setSuggestionsModal] = useState<{
    isOpen: boolean;
    playlist: Playlist | null;
    suggestions: any[];
    loading: boolean;
    analysis: any;
    error?: { message: string; details: string } | null;
  }>({
    isOpen: false,
    playlist: null,
    suggestions: [],
    loading: false,
    analysis: null,
    error: null
  });
  // const [playedInOrder, setPlayedInOrder] = useState<Array<{ id: string; name: string; artist: string }>>([]); // duplicate removed
  
  // Pause position tracking (duplicates removed below)
  // const [pausePosition, setPausePosition] = useState<number>(0);
  // const [isPausedByInterface, setIsPausedByInterface] = useState(false);

  // Pre-queue profiles (persisted locally)
  const [profiles, setProfiles] = useState<Array<{ name: string; snippet: number; random: boolean; window: number }>>(() => {
    try {
      const raw = localStorage.getItem('prequeue_profiles_v1');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(p => p && typeof p.name === 'string');
      return [];
    } catch {
      return [];
    }
  });
  const persistProfiles = (list: Array<{ name: string; snippet: number; random: boolean; window: number }>) => {
    setProfiles(list);
    try { localStorage.setItem('prequeue_profiles_v1', JSON.stringify(list)); } catch {}
  };
  const saveCurrentAsProfile = () => {
    const name = prompt('Save profile as:');
    if (!name) return;
    const next = profiles.filter(p => p.name.toLowerCase() !== name.toLowerCase());
    next.push({ name, snippet: snippetLength, random: randomStarts, window: preQueueWindow });
    persistProfiles(next);
  };
  const applyProfile = (name: string) => {
    const p = profiles.find(x => x.name === name);
    if (!p) return;
    setSnippetLength(p.snippet);
    setRandomStarts(p.random);
    // Pre-queue removed, only snippet and random settings apply
  };
  const deleteProfile = (name: string) => {
    const next = profiles.filter(p => p.name !== name);
    persistProfiles(next);
  };

  const loadPlaylists = useCallback(async () => {
    try {
      console.log('Loading playlists...');
      const response = await fetch(`${API_BASE || ''}/api/spotify/playlists`);
      if (response.status === 401) {
        console.warn('Spotify not connected (401) while loading playlists');
        // Don't override isSpotifyConnected here - let status endpoint be authoritative
        console.log('�� loadPlaylists got 401, but not overriding connection state');
        setSpotifyError('Spotify is not connected. Click Connect Spotify.');
        setPlaylists([]);
        return;
      }
      const data = await response.json();
      
      if (data.success) {
        // Filter out temporary TEMPO playlists
        const filteredPlaylists = data.playlists.filter((playlist: Playlist) => 
          !playlist.name.startsWith('TEMPO')
        );
        
        setPlaylists(filteredPlaylists);
        // Show all playlists (no pagination)
        setVisiblePlaylists(filteredPlaylists);
        console.log('Playlists loaded:', filteredPlaylists.length, 'playlists (filtered out', data.playlists.length - filteredPlaylists.length, 'TEMPO playlists)');
      } else {
        console.error('Failed to load playlists:', data.error);
      }
    } catch (error) {
      console.error('Error loading playlists:', error);
    }
  }, []);


  // Get all playlist IDs that are already assigned to rounds
  const assignedPlaylistIds = new Set(
    eventRounds.flatMap(round => round.playlistIds || [])
  );

  // Filter playlists by query and exclude already assigned playlists
  const filteredPlaylists = (playlistQuery ? visiblePlaylists.filter(p => {
    const q = playlistQuery.toLowerCase();
    return (
      !assignedPlaylistIds.has(p.id) && // Exclude assigned playlists
      ((p.name || '').toLowerCase().includes(q) ||
      (p.owner || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q))
    );
  }) : visiblePlaylists.filter(p => !assignedPlaylistIds.has(p.id))); // Exclude assigned playlists even without query

  // Update visible playlists when rounds change to exclude newly assigned playlists
  useEffect(() => {
    if (playlists && playlists.length > 0) {
      const availablePlaylists = playlists.filter(p => !assignedPlaylistIds.has(p.id));
      // Only update if the current visible playlists include assigned ones
      const hasAssignedInVisible = visiblePlaylists.some(p => assignedPlaylistIds.has(p.id));
      if (hasAssignedInVisible) {
        setVisiblePlaylists(availablePlaylists);
      }
    }
  }, [eventRounds, playlists]); // Re-run when rounds or playlists change

  // Auto-switch tabs based on game state
  useEffect(() => {
    if (gameState === 'playing') {
      setActiveTab('play');
    } else if (gameState === 'waiting' && mixFinalized) {
      setActiveTab('play');
    } else if (eventRounds.some(r => r.status === 'completed' || r.status === 'active')) {
      setActiveTab('manage');
    } else {
      setActiveTab('setup');
    }
  }, [gameState, mixFinalized, eventRounds]);

  const refreshRooms = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE || ''}/api/rooms`);
      const data = await res.json();
      setRooms(Array.isArray(data?.rooms) ? data.rooms : []);
    } catch {
      setRooms([]);
    }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      setIsLoadingDevices(true);
      console.log('Loading Spotify devices...');
      const response = await fetch(`${API_BASE || ''}/api/spotify/devices`);
      if (response.status === 401) {
        console.warn('Spotify not connected (401) while loading devices');
        setIsSpotifyConnected(false);
        setIsSpotifyConnecting(false);
        setSpotifyError('Spotify is not connected. Click Connect Spotify.');
        setDevices([]);
        return;
      }
      const data = await response.json();
      
      if (data.devices) {
        setDevices(data.devices);
        console.log('Devices loaded:', data.devices.length, 'devices');
        console.log('Device details:', data.devices);
        if (data.currentDevice) {
          console.log('Current playback device:', data.currentDevice.name, data.currentDevice.id);
        }
        
        // Auto-select the saved device if available, otherwise first device
        if (data.savedDevice) {
          const savedDevice = data.devices.find((d: Device) => d.id === data.savedDevice.id);
          if (savedDevice) {
            setSelectedDevice(savedDevice);
            console.log('Auto-selected saved device:', savedDevice.name);
          }
        } else if (data.currentDevice) {
          // Prefer the device currently in playback
          const current = data.devices.find((d: Device) => d.id === data.currentDevice.id);
          if (current) {
            setSelectedDevice(current);
            console.log('Auto-selected current playback device:', current.name);
          } else if (data.devices.length > 0 && !selectedDevice) {
            setSelectedDevice(data.devices[0]);
          }
        } else if (data.devices.length > 0 && !selectedDevice) {
          setSelectedDevice(data.devices[0]);
        }
      } else {
        console.error('Failed to load devices:', data.error);
      }
    } catch (error) {
      console.error('Error loading devices:', error);
    } finally {
      setIsLoadingDevices(false);
    }
  }, []);

  const fetchPlaybackState = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE || ''}/api/spotify/current-playback`);
      if (!resp.ok) {
        if (resp.status >= 500) return; // ignore transient 5xx
        return;
      }
      const data = await resp.json();
      if (data.success && data.playbackState) {
        // Shuffle/repeat state removed - not used in UI
        // setShuffleEnabled(!!data.playbackState.shuffle_state);
        // const rep = (data.playbackState.repeat_state || 'off') as 'off' | 'track' | 'context';
        // setRepeatState(rep);
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const saveSelectedDevice = useCallback(async () => {
    if (!selectedDevice) {
      alert('Please select a device first');
      return;
    }

    try {
      console.log('Saving device:', selectedDevice.name);
      const response = await fetch(`${API_BASE || ''}/api/spotify/save-device`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device: selectedDevice })
      });

      const data = await response.json();
      if (data.success) {
        console.log('Device saved successfully:', data.message);
        alert(`Device saved: ${selectedDevice.name}`);
      } else {
        console.error('Failed to save device:', data.error);
        alert('Failed to save device');
      }
    } catch (error) {
      console.error('Error saving device:', error);
      alert('Error saving device');
    }
  }, [selectedDevice]);

  useEffect(() => {
    console.log('HostView useEffect triggered');
    console.log('Current window.location.pathname:', window.location.pathname);
    console.log('Current window.location.href:', window.location.href);
    console.log('Room ID from params:', roomId);

    // Initialize socket connection
    const newSocket = io(SOCKET_URL || undefined, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    setSocket(newSocket);

    // Socket event listeners
    newSocket.on('player-joined', (data: any) => {
      console.log('Player joined:', data);
    });
    newSocket.on('lock-joins-updated', (data: any) => {
      setLockJoins(!!data?.locked);
      addLog(`Room lock ${data?.locked ? 'enabled' : 'disabled'}`, 'info');
    });
    newSocket.on('prequeue-updated', (data: any) => {
      setPreQueueEnabled(!!data?.enabled);
      if (typeof data?.window === 'number') setPreQueueWindow(data.window);
      addLog(`Pre-queue ${data?.enabled ? 'enabled' : 'disabled'} (window=${data?.window ?? preQueueWindow})`, 'info');
    });

    newSocket.on('game-started', (data: any) => {
      console.log('?? GAME-STARTED EVENT RECEIVED:', data);
      setGameState('playing');
      console.log('?? SET GAME STATE TO PLAYING');
      setIsStartingGame(false);
      addLog('Game started - state set to playing', 'info');
      // Auto-collapse lists during gameplay
      setShowSongList(false);
      setShowPlaylists(false);
      setShowLogs(false);
    });

    // Receive the finalized shuffled order for 5x15
    newSocket.on('finalized-order', (data: any) => {
      try {
        const arr = Array.isArray(data?.order) ? data.order.map((o: any) => ({ id: o.id, name: o.name, artist: o.artist })) : [];
        if (arr.length > 0) {
          setFinalizedOrder(arr);
          addLog(`Finalized order received (${arr.length} tracks)`, 'info');
        }
      } catch (e) {
        console.warn('Failed to parse finalized order:', e);
      }
    });

    newSocket.on('song-playing', (data: any) => {
      setCurrentSong({
        id: data.songId,
        name: data.songName,
        artist: data.artistName,
      });
      lastSongEventAtRef.current = Date.now();
      setIsPlaying(true);
      setPlaybackState(prev => ({
        ...prev,
        isPlaying: true,
        currentSong: {
          id: data.songId,
          name: data.songName,
          artist: data.artistName,
        },
        duration: data.snippetLength * 1000, // Convert to milliseconds
        currentTime: 0
      }));
      setPlayedInOrder(prev => {
        if (prev.find(p => p.id === data.songId)) return prev; // prevent dupes
        return [...prev, { id: data.songId, name: data.songName, artist: data.artistName }];
      });
      
      // Reset pause tracking for new song
      setPausePosition(0);
      setIsPausedByInterface(false);
      
      console.log('Song playing:', data);
      addLog(`Now playing: ${data.songName} — ${data.artistName}`, 'info');
      
      // Don't sync volume when song starts playing - preserve user's volume setting
      // setTimeout(() => {
      //   fetchCurrentVolume();
      // }, 500);
    });

    // Handle bingo verification pending
    newSocket.on('bingo-verification-pending', (data: any) => {
      console.log('Bingo verification pending:', data.playerName);
      setGamePaused(true);
      // Play alert sound for host
      playHostAlertSound();
    });

    // Handle confirmed bingo wins (for winner tracking)
    newSocket.on('bingo-called', (data: any) => {
      // Only update winners list if this is a verified bingo
      if (data.verified && !data.awaitingVerification) {
        setWinners(prev => [...prev, data]);
        console.log('Bingo confirmed for:', data.playerName);
      }
    });

    // Host verification needed
    newSocket.on('bingo-verification-needed', (data: any) => {
      console.log('Bingo verification needed:', data);
      setPendingVerification(data);
      setGamePaused(true);
      // Play urgent alert sound
      playHostAlertSound();
    });

    // Verification completed
    newSocket.on('bingo-verified', (data: any) => {
      console.log('Bingo verified:', data);
      setPendingVerification(null);
      setGamePaused(false);
      setIsProcessingVerification(false);
      
      if (data.approved) {
        if (data.roundComplete) {
          // NEW: Round complete - show multi-round options
          setRoundComplete(data);
          addLog(`Round ${data.roundNumber} complete - ${data.playerName} wins!`, 'info');
          console.log('Round complete, showing options to host');
        } else if (data.gameEnded) {
          // OLD: Game automatically ended with verified bingo
          addLog(`Game ended - ${data.playerName} wins!`, 'info');
          setGameState('ended');
          setIsPlaying(false);
        }
      }
    });

    newSocket.on('game-resumed', () => {
      setGamePaused(false);
    });

    newSocket.on('game-ended', () => {
      setGamePaused(false);
      setIsPlaying(false);
    });

    newSocket.on('game-restarted', (data: any) => {
      console.log('Game restarted:', data);
      // Reset host state
      setWinners([]);
      setRoundWinners([]);
      setRoundComplete(null);
      setIsPlaying(false);
      setGamePaused(false);
      setPendingVerification(null);
      setCurrentSong(null);
      addLog('Game restarted by host', 'info');
    });

    // NEW: Handle next round reset (back to setup)
    newSocket.on('next-round-reset', (data: any) => {
      console.log('Next round reset to setup:', data);
      setRoundComplete(null);
      setWinners([]);
      setGamePaused(false);
      setIsPlaying(false);
      setCurrentSong(null);
      setMixFinalized(false);
      setPlaylists([]);
      setSelectedPlaylists([]);
      setPattern('line');
      setSnippetLength(30);
      setRandomStarts(false);
      setRevealMode('off');
      setPlayedSoFar([]);
      if (data.roundWinners) {
        setRoundWinners(data.roundWinners);
      }
      addLog(`Round ${data.roundNumber} - Fresh setup ready!`, 'info');
    });

    // NEW: Handle game session ended
    newSocket.on('game-session-ended', (data: any) => {
      console.log('Game session ended:', data);
      setRoundComplete(null);
      setGameState('ended');
      setIsPlaying(false);
      if (data.roundWinners) {
        setRoundWinners(data.roundWinners);
      }
      addLog(`Game session ended after ${data.totalRounds} rounds`, 'info');
    });

    newSocket.on('sync-state-response', (data: any) => {
      console.log('Sync state response:', data);
      if (data.gameState) {
        setGameState(data.gameState);
        addLog(`Synced game state to: ${data.gameState}`, 'info');
      }
      if (data.currentSong) {
        setCurrentSong(data.currentSong);
      }
      if (data.isPlaying !== undefined) {
        setIsPlaying(data.isPlaying);
      }
    });

    newSocket.on('player-left', (data: any) => {
      console.log('Player left:', data);
    });

    newSocket.on('super-strict-updated', (data: any) => {
      setSuperStrict(!!data?.enabled);
      addLog(`Super-Strict Lock ${data?.enabled ? 'enabled' : 'disabled'}`, 'warn');
    });

    // Listen for player card updates
    newSocket.on('player-cards-update', (data: any) => {
      try {
        if (data && typeof data === 'object') {
          const newPlayerCards = new Map();
          Object.entries(data).forEach(([playerId, cardData]: [string, any]) => {
            if (cardData && cardData.card) {
              newPlayerCards.set(playerId, {
                playerName: cardData.playerName || 'Unknown',
                card: cardData.card
              });
            }
          });
          setPlayerCards(newPlayerCards);
        }
      } catch (e) {
        console.warn('Failed to parse player cards:', e);
      }
    });

    newSocket.on('playback-update', (data: any) => {
      setPlaybackState(prev => ({
        ...prev,
        currentTime: data.currentTime,
        isPlaying: data.isPlaying,
        volume: data.volume
      }));
    });

    newSocket.on('queue-update', (data: any) => {
      setPlaybackState(prev => ({
        ...prev,
        queue: data.queue,
        currentQueueIndex: data.currentIndex
      }));
    });

    newSocket.on('error', (data: any) => {
      const msg = data?.message || 'Unknown server error';
      console.error('Socket error:', msg);
      setIsStartingGame(false);
      alert(`Server error: ${msg}`);
      addLog(`Server error: ${msg}`, 'error');
    });

    newSocket.on('connect_error', (err: any) => {
      console.error('Socket connect_error:', err?.message || err);
    });

    newSocket.on('disconnect', (reason: string) => {
      console.warn('Socket disconnected:', reason);
    });
    newSocket.io.on('reconnect_attempt', (attempt) => {
      console.log(`Reconnecting socket (attempt ${attempt})...`);
    });
    newSocket.io.on('reconnect', () => {
      console.log('Socket reconnected. Refreshing Spotify status and devices.');
      lastReconnectAtRef.current = Date.now();
      ignorePollingUntilRef.current = Date.now() + 15000; // ignore polling flips for 15s
      if (roomId && gameState === 'playing') {
        const now = Date.now();
        if (now - lastResumePingAtRef.current > 10000) {
          lastResumePingAtRef.current = now;
          setTimeout(() => {
            try { newSocket.emit('resume-song', { roomId }); } catch {}
          }, 500);
        }
      }
      (async () => {
        await fetchPlaybackState();
        await loadDevices();
        await loadPlaylists();
      })();
    });
    newSocket.io.on('reconnect_error', (err: any) => {
      console.warn('Reconnection error:', err?.message || err);
    });

    newSocket.on('game-ended', () => {
      setGameState('ended');
      console.log('�� Game ended');
      // Allow reopening
      setShowPlaylists(true);
      setShowLogs(true);
    });

    newSocket.on('game-reset', () => {
      setIsPlaying(false);
      setGameState('waiting');
      setCurrentSong(null);
      setWinners([]);
      setMixFinalized(false);
      setSongList([]);
      console.log('�� Game reset');
    });

    newSocket.on('playback-error', (data: any) => {
      const msg = data?.message || 'Playback error: Could not start on locked device.';
      console.error('Playback error:', msg);
      setSpotifyError(msg);
      alert(msg + '\n\nTip: Ensure Spotify is open and active on your chosen device, then use "Transfer Playback" or click Force Detection.');
      addLog(`Playback error: ${msg}`, 'error');
    });

    newSocket.on('playback-warning', (data: any) => {
      const msg = data?.message || 'Playback warning occurred';
      console.warn('Playback warning:', msg);
      setShowLogs(true);
      addLog(`Playback warning: ${msg}`, 'warn');
      // Non-blocking toast instead of alert to avoid desync
      try {
        const toast = document.createElement('div');
        toast.textContent = '⚠️ ' + msg;
        Object.assign(toast.style, {
          position: 'fixed', bottom: '14px', left: '14px', maxWidth: '70vw',
          background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)',
          padding: '10px 12px', borderRadius: '10px', zIndex: 9999, fontWeight: 700
        } as unknown as CSSStyleDeclaration);
        document.body.appendChild(toast);
        setTimeout(() => { try { document.body.removeChild(toast); } catch {} }, 3000);
      } catch {}
    });

    newSocket.on('playback-diagnostic', (diag: any) => {
      try {
        setShowLogs(true);
        const payload = JSON.stringify(diag, null, 2);
        addLog(`Playback diagnostic: ${payload}`, 'warn');
        // Also print to console for devs
        console.log('�� Playback diagnostic', diag);
      } catch {}
    });

    // Handle 5x15 deduplication warnings
    newSocket.on('mode-warning', (data: any) => {
      const msg = data?.message || 'Mode warning occurred';
      console.warn('Mode warning:', msg);
      setShowLogs(true);
      addLog(`Mode warning: ${msg}`, 'warn');
      if (data?.details && Array.isArray(data.details)) {
        data.details.forEach((detail: string) => {
          addLog(`  ${detail}`, 'warn');
        });
      }
      // Show toast notification
      try {
        const toast = document.createElement('div');
        toast.textContent = '⚠️ ' + msg;
        Object.assign(toast.style, {
          position: 'fixed', bottom: '14px', left: '14px', maxWidth: '70vw',
          background: 'rgba(255,193,7,0.1)', color: '#fff', border: '1px solid rgba(255,193,7,0.5)',
          padding: '10px 12px', borderRadius: '10px', zIndex: 9999, fontWeight: 700
        } as unknown as CSSStyleDeclaration);
        document.body.appendChild(toast);
        setTimeout(() => { try { document.body.removeChild(toast); } catch {} }, 5000);
      } catch {}
    });

    // Handle successful deduplication notifications
    newSocket.on('deduplication-success', (data: any) => {
      if (data?.totalDuplicatesRemoved > 0) {
        const msg = `Removed ${data.totalDuplicatesRemoved} duplicate songs across playlists for 5x15 mode`;
        console.log('Deduplication success:', msg);
        addLog(`✅ ${msg}`, 'info');
        if (data?.playlistDetails && Array.isArray(data.playlistDetails)) {
          data.playlistDetails.forEach((detail: any) => {
            if (detail.duplicatesRemoved > 0) {
              addLog(`  ${detail.name}: ${detail.originalCount} → ${detail.finalCount} songs (${detail.duplicatesRemoved} duplicates removed)`, 'info');
            }
          });
        }
      }
    });

    // Acknowledge reveal events
    newSocket.on('call-revealed', (data: any) => {
      addLog(`Call revealed: ${data.hint || 'full'} ${data.songName ? '— ' + data.songName : ''} ${data.artistName ? '— ' + data.artistName : ''}`, 'info');
    });

    // Join room as host
    if (roomId) {
      newSocket.emit('join-room', { roomId, playerName: 'Host', isHost: true });
    }

    // Check Spotify status and load playlists if connected
    const checkSpotifyStatus = async () => {
      try {
        console.log('Host view loaded, checking Spotify status...');
        // Add cache-busting parameter to force fresh request
        const cacheBuster = Date.now();
        const response = await fetch(`${API_BASE || ''}/api/spotify/status?_=${cacheBuster}`);
        const data = await response.json();

        if (data.connected) {
          console.log('Spotify already connected, loading playlists...');
          console.log('�� Status API returned connected=true, setting state to true');
          setIsSpotifyConnected(true);
          setIsSpotifyConnecting(false);
          await loadPlaylists();
          await loadDevices(); // Load devices when connected
          
          // Don't sync initial volume - keep user's 100% default
          // setTimeout(() => {
          //   fetchCurrentVolume();
          // }, 1000);
        } else {
          console.log('Spotify not connected');
          console.log('�� Status API returned connected=false, setting state to false');
          setIsSpotifyConnected(false);
          setIsSpotifyConnecting(false);
        }
      } catch (error) {
        console.error('Error checking Spotify status:', error);
        setIsSpotifyConnected(false);
        setIsSpotifyConnecting(false);
      }
    };

    checkSpotifyStatus();

    // Cleanup socket on unmount
    return () => {
      newSocket.close();
      // Clear any pending volume timeout
      if (volumeTimeout) {
        clearTimeout(volumeTimeout);
      }
    };
  }, [roomId, loadPlaylists, loadDevices]);



  const connectSpotify = useCallback(async () => {
    try {
      console.log('Initiating Spotify connection...');
      setIsSpotifyConnecting(true);
      setSpotifyError(null);
      
      // Check if Spotify is already connected (with cache-busting)
      const cacheBuster = Date.now();
      const statusResponse = await fetch(`${API_BASE || ''}/api/spotify/status?_=${cacheBuster}`);
      const statusData = await statusResponse.json();
      
      if (statusData.connected) {
        console.log('Spotify already connected, loading playlists...');
        setIsSpotifyConnected(true);
        setIsSpotifyConnecting(false);
        await loadPlaylists();
        return;
      }
      
      // If not connected, initiate OAuth flow
      const response = await fetch(`${API_BASE || ''}/api/spotify/auth`);
      const data = await response.json();
      
      if (data.authUrl) {
        console.log('Redirecting to Spotify authorization...');
        
        // Store the current URL to return to after Spotify auth
        const returnUrl = `/host/${roomId}`;
        console.log('�� Storing return URL in localStorage:', returnUrl);
        localStorage.setItem('spotify_return_url', returnUrl);
        if (roomId) {
          console.log('�� Storing room ID in localStorage:', roomId);
          localStorage.setItem('spotify_room_id', roomId);
        }
        
        // Add room ID to the auth URL as a state parameter
        const authUrlWithState = `${data.authUrl}&state=${encodeURIComponent(roomId || '')}`;
        console.log('�� Redirecting to Spotify with room ID in state parameter');
        
        // Redirect to Spotify
        window.location.href = authUrlWithState;
      } else {
        console.error('Failed to get Spotify authorization URL');
        setSpotifyError('Failed to get Spotify authorization URL. Please try again.');
        setIsSpotifyConnecting(false);
      }
    } catch (error) {
      console.error('Error connecting to Spotify:', error);
      setSpotifyError('Failed to connect to Spotify. Please check your internet connection and try again.');
      setIsSpotifyConnecting(false);
    }
  }, [roomId]); // Remove loadPlaylists from dependencies

  const handleSuggestSongs = async (playlist: Playlist) => {
    try {
      setSuggestionsModal(prev => ({
        ...prev,
        isOpen: true,
        playlist: playlist,
        loading: true,
        suggestions: [],
        analysis: null,
        error: null
      }));

      // Fetch existing songs from the playlist
      const tracksResponse = await fetch(`${API_BASE || ''}/api/spotify/playlist-tracks/${playlist.id}`);
      const tracksData = await tracksResponse.json();
      
      const existingSongs = tracksData.success ? tracksData.tracks : [];
      const targetCount = playlist.tracks >= 60 ? 75 : 15;

      // Get AI suggestions
      const apiUrl = `${API_BASE || ''}/api/spotify/suggest-songs`;
      console.log('�� Making AI suggestion request to:', apiUrl);
      console.log('�� Request payload:', { playlistId: playlist.id, playlistName: playlist.name, existingSongs: existingSongs.length, targetCount });
      
      const suggestionsResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          playlistId: playlist.id,
          playlistName: playlist.name,
          existingSongs: existingSongs,
          targetCount: targetCount
        })
      });

      console.log('�� Response status:', suggestionsResponse.status);
      console.log('�� Response headers:', Object.fromEntries(suggestionsResponse.headers.entries()));
      
      // Check if we got HTML instead of JSON (common when server returns error page)
      const contentType = suggestionsResponse.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        const htmlText = await suggestionsResponse.text();
        console.error('�� Received HTML instead of JSON:', htmlText.substring(0, 200) + '...');
        throw new Error('Server returned HTML error page instead of JSON. Check if the server is running properly.');
      }
      
      const suggestionsData = await suggestionsResponse.json();
      console.log('�� Response data:', suggestionsData);

      if (suggestionsData.success) {
        setSuggestionsModal(prev => ({
          ...prev,
          loading: false,
          suggestions: suggestionsData.suggestions.songs || [],
          analysis: suggestionsData.analysis
        }));
      } else {
        throw new Error(suggestionsData.error || 'Failed to get suggestions');
      }
    } catch (error: any) {
      console.error('❌ Error getting song suggestions:', error);
      
      // Determine specific error message based on the error type
      let errorMessage = 'Failed to get song suggestions. ';
      let errorDetails = '';
      
      if (error.message) {
        if (error.message.includes('Spotify not connected')) {
          errorMessage = '🎵 Spotify Connection Required';
          errorDetails = 'Please connect to Spotify first using the "Connect Spotify" button, then try getting suggestions again.';
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = '�� Network Connection Error';
          errorDetails = 'Unable to reach the server. Please check your internet connection and make sure the server is running.';
        } else if (error.message.includes('401')) {
          errorMessage = '�� Authentication Error';
          errorDetails = 'Your Spotify session may have expired. Please reconnect to Spotify and try again.';
        } else if (error.message.includes('500')) {
          errorMessage = '�� Server Error';
          errorDetails = 'The server encountered an error while generating suggestions. Please try again in a moment.';
        } else if (error.message.includes('HTML error page') || error.message.includes('DOCTYPE')) {
          errorMessage = '�� Server Restart Required';
          errorDetails = 'The server appears to be restarting or crashed. Please wait a moment for it to fully start up, then try again.';
        } else {
          errorMessage = '❌ Suggestion Generation Failed';
          errorDetails = `Error: ${error.message}. Please check the console for more details.`;
        }
      } else {
        errorMessage = '❓ Unknown Error';
        errorDetails = 'An unexpected error occurred. Please check the browser console (F12) for more details and try again.';
      }
      
      setSuggestionsModal(prev => ({
        ...prev,
        loading: false,
        suggestions: [],
        analysis: null,
        error: { message: errorMessage, details: errorDetails }
      }));
      
      // Also show a more informative alert
      alert(`${errorMessage}\n\n${errorDetails}`);
    }
  };

  const finalizeMix = async () => {
    if (!socket || selectedPlaylists.length === 0) return;
    
    try {
      // Include current host-side songList ordering to enforce 1x75 pool deterministically
      socket.emit('finalize-mix', {
        roomId: roomId,
        playlists: selectedPlaylists,
        songList
      });
      
      // Listen for mix finalized confirmation
      socket.once('mix-finalized', (data: any) => {
        console.log('Mix finalized:', data);
        setMixFinalized(true);
      });
    } catch (error) {
      console.error('Error finalizing mix:', error);
    }
  };

  const startGame = async () => {
    if (selectedPlaylists.length === 0) {
      alert('Please select at least one playlist');
      return;
    }

    if (!selectedDevice) {
      alert('Please select a Spotify playback device first (Playback Device section).');
      return;
    }

    if (!socket) {
      console.error('Socket not connected');
      return;
    }

    if (!isSpotifyConnected) {
      alert('Spotify is not connected. Click Connect Spotify first.');
      return;
    }

    if (songList.length === 0) {
      alert('No songs loaded from playlists. Ensure Spotify is connected and playlists have tracks, then try again.');
      return;
    }

    try {
      console.log('Starting game with playlists:', selectedPlaylists);
      setIsStartingGame(true);
      socket.emit('start-game', {
        roomId,
        playlists: selectedPlaylists,
        snippetLength,
        deviceId: selectedDevice.id, // Require the selected device ID
        songList: songList, // Send the shuffled song list to ensure server uses same order
        randomStarts,
        pattern,
        customMask
      });
      // Safety timeout in case no response comes back
      setTimeout(() => setIsStartingGame(false), 8000);
    } catch (error) {
      console.error('Error starting game:', error);
      setIsStartingGame(false);
    }
  };

  const endGame = () => {
    if (!socket || !roomId) return;
    socket.emit('end-game', { roomId, stopPlayback: true });
    addLog('End game requested', 'info');
  };

  const resetGame = () => {
    if (!socket || !roomId) return;
    socket.emit('reset-game', { roomId, stopPlayback: true });
    addLog('Reset game requested', 'info');
  };

  const revealCall = (mode: 'artist' | 'title' | 'full') => {
    if (!socket || !roomId) return;
    socket.emit('reveal-call', { roomId, revealToDisplay: true, revealToPlayers: false, hint: mode });
    addLog(`Reveal: ${mode}`, 'info');
  };

  const forceRefreshAll = () => {
    if (!socket || !roomId) return;
    socket.emit('force-refresh', { roomId, reason: 'host-request' });
    addLog('Force refresh broadcast', 'warn');
  };

  // Round management functions



  const resetEvent = () => {
    if (window.confirm('⚠️ Reset entire event?\n\nThis will:\n• Reset all rounds to unplanned status\n• Clear all round progress\n• End the current game if running\n• Allow you to replay from Round 1\n\nThis cannot be undone. Continue?')) {
      // End current game if running
      if (gameState === 'playing') {
        endGame();
      }
      
      // Reset all rounds to unplanned status
      const resetRounds = eventRounds.map((round, index) => ({
        ...round,
        status: 'unplanned' as const,
        startedAt: undefined,
        completedAt: undefined
      }));
      
      // Update rounds and reset current round index
      setEventRounds(resetRounds);
      setCurrentRoundIndex(-1);
      
      // Save to localStorage
      if (roomId) {
        localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(resetRounds));
      }
      
      // Clear selected playlists and reset game state
      setSelectedPlaylists([]);
      setMixFinalized(false);
      setSongList([]);
      setGameState('waiting');
      
      addLog('🔄 Event reset - All rounds returned to unplanned status', 'info');
    }
  };


  const updatePattern = (next: 'line' | 'four_corners' | 'x' | 'full_card' | 'custom') => {
    setPattern(next);
    if (socket && roomId) {
      socket.emit('set-pattern', { roomId, pattern: next, customMask });
      addLog(`Pattern set to ${next}`, 'info');
    }
  };

  const playSong = async (song: Song) => {
    if (!socket) {
      console.error('Socket not connected');
      return;
    }

    try {
      // If we're already playing this song, justResume
      if (isPlaying && currentSong?.id === song.id) {
        socket.emit('resume-song', { roomId });
        setIsPlaying(true);
        setPlaybackState(prev => ({ ...prev, isPlaying: true }));
        console.log('Resumed song via socket');
      } else {
        // Check if we were paused by the interface and need toResume from exact position
        if (isPausedByInterface && currentSong?.id === song.id) {
          console.log(`??� Resuming from exact pause position: ${pausePosition}ms`);
          socket.emit('resume-song', { 
            roomId, 
           ResumePosition: pausePosition 
          });
          setIsPlaying(true);
          setPlaybackState(prev => ({ 
            ...prev, 
            isPlaying: true,
            currentTime: pausePosition 
          }));
          setIsPausedByInterface(false);
        } else {
          // For new songs or external changes, justResume normally
          socket.emit('resume-song', { roomId });
          setIsPlaying(true);
          setPlaybackState(prev => ({ ...prev, isPlaying: true }));
          console.log('Started/resumed song via socket');
        }
      }
    } catch (error) {
      console.error('Error playing song:', error);
    }
  };

  const pauseSong = async () => {
    try {
      if (socket) {
        // Store the exact position where we're pausing
        setPausePosition(playbackState.currentTime);
        setIsPausedByInterface(true);
        
        socket.emit('pause-song', { roomId });
        setIsPlaying(false);
        setPlaybackState(prev => ({ ...prev, isPlaying: false }));
        console.log(`⏸️ Paused song at position: ${playbackState.currentTime}ms`);
      }
    } catch (error) {
      console.error('Error pausing song:', error);
    }
  };

  const skipSong = async () => {
    try {
      if (socket) {
        socket.emit('skip-song', { roomId });
        console.log('Skipped to next track via socket');
      }
    } catch (error) {
      console.error('Error skipping song:', error);
    }
  };

  const requestPlayerCards = () => {
    if (socket) {
      socket.emit('request-player-cards', { roomId });
      addLog('Requested player cards', 'info');
    }
  };

  // Host alert sound for bingo calls
  const playHostAlertSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Urgent attention-getting sound
      const playNote = (freq: number, startTime: number, duration: number) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.4, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      
      const now = audioContext.currentTime;
      // Attention-getting pattern
      playNote(800, now, 0.15);
      playNote(1000, now + 0.2, 0.15);
      playNote(800, now + 0.4, 0.15);
    } catch (error) {
      console.log('Audio not supported');
    }
  };

  const handleVerifyBingo = (approved: boolean, reason?: string) => {
    if (!pendingVerification) {
      console.error('No pending verification to process');
      addLog('Error: No bingo verification pending', 'error');
      return;
    }
    
    if (!socket) {
      console.error('Socket not connected');
      addLog('Error: Connection lost - please refresh page', 'error');
      return;
    }
    
    console.log(`Sending verification: ${approved ? 'APPROVED' : 'REJECTED'} for ${pendingVerification.playerName}`);
    addLog(`${approved ? 'Approving' : 'Rejecting'} ${pendingVerification.playerName}'s bingo`, 'info');
    
    setIsProcessingVerification(true);
    
    socket.emit('verify-bingo', {
      roomId,
      playerId: pendingVerification.playerId,
      approved,
      reason: reason || (approved ? 'Valid pattern' : 'Invalid pattern')
    });
    
    // Add timeout fallback to prevent eternal freeze
    setTimeout(() => {
      if (isProcessingVerification) {
        console.warn('Verification response timeout - clearing modal');
        addLog('Verification response timeout - modal cleared', 'warn');
        setPendingVerification(null);
        setGamePaused(false);
        setIsProcessingVerification(false);
      }
    }, 10000); // 10 second timeout
  };

  // Removed handleContinueOrEnd - games now end automatically on first verified bingo

  const handleRestartGame = () => {
    if (!socket) return;
    
    const confirmed = window.confirm(
      'Are you sure you want to restart the game?\n\n' +
      'This will:\n' +
      '• Stop current playback\n' +
      '• Reset all marked squares\n' +
      '• Clear all winners\n' +
      '• Reset to waiting state\n' +
      '• Keep existing bingo cards'
    );
    
    if (confirmed) {
      socket.emit('restart-game', { roomId });
      addLog('Restarting game...', 'info');
    }
  };

  // NEW: Multi-round system handlers
  const handleStartNextRound = () => {
    if (!socket) return;
    
    const confirmed = window.confirm(
      'Start next round with fresh setup?\n\n' +
      'This will:\n' +
      '• Keep all players connected\n' +
      '• Keep Spotify connection\n' +
      '• Reset to setup screen for new playlists/pattern\n' +
      '• Clear all bingo cards'
    );
    
    if (confirmed) {
      console.log('Starting next round with full reset');
      socket.emit('start-next-round', { roomId });
      addLog(`Starting fresh round setup`, 'info');
    }
  };

  const handleEndGameSession = () => {
    if (!socket) return;
    
    const confirmed = window.confirm(
      'Are you sure you want to end the entire game session?\n\n' +
      'This will permanently end the game for all players.'
    );
    
    if (confirmed) {
      console.log('Ending game session...');
      socket.emit('end-game-session', { roomId });
      addLog('Ending game session', 'info');
    }
  };





  const selectPlaylist = (playlist: Playlist) => {
    setSelectedPlaylists(prev => {
      const isSelected = prev.find(p => p.id === playlist.id);
      if (isSelected) {
        return prev.filter(p => p.id !== playlist.id);
      } else {
        return [...prev, playlist];
      }
    });
  };

  // Generate and shuffle song list from selected playlists
  const generateSongList = useCallback(async () => {
    if (!isSpotifyConnected) {
      console.warn('Cannot generate song list: Spotify not connected');
      console.log('�� isSpotifyConnected state is currently:', isSpotifyConnected);
      setSongList([]);
      return;
    }
    if (selectedPlaylists.length === 0) {
      setSongList([]);
      return;
    }

    try {
      const allSongs: Song[] = [];
      
      for (const playlist of selectedPlaylists) {
        const response = await fetch(`${API_BASE || ''}/api/spotify/playlist-tracks/${playlist.id}`);
        const data = await response.json();
        
        if (data.success && data.tracks) {
          allSongs.push(...data.tracks);
        }
      }

      // Shuffle the songs using Fisher-Yates algorithm
      const shuffledSongs = [...allSongs];
      for (let i = shuffledSongs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledSongs[i], shuffledSongs[j]] = [shuffledSongs[j], shuffledSongs[i]];
      }

      setSongList(shuffledSongs);
      console.log(`Generated ${shuffledSongs.length} shuffled songs`);
    } catch (error) {
      console.error('Error generating song list:', error);
    }
  }, [selectedPlaylists]);

  // Advanced playback functions
  const [volumeTimeout, setVolumeTimeout] = useState<NodeJS.Timeout | null>(null);

  // Function to fetch current Spotify volume
  const fetchCurrentVolume = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE || ''}/api/spotify/current-playback`);
      if (!resp.ok) return;
      const data = await resp.json();
        if (data.success && data.playbackState) {
        const spotifyVolume = (data.playbackState.device?.volume_percent ?? 100) as number;
          setPlaybackState(prev => ({ ...prev, volume: spotifyVolume }));
          console.log(`�� Synced volume from Spotify: ${spotifyVolume}%`);
        }
    } catch {
      // ignore
    }
  }, []);

  const transferToSelectedDevice = useCallback(async () => {
    if (!selectedDevice) {
      alert('Please select a device first');
      return;
    }
    try {
      const response = await fetch(`${API_BASE || ''}/api/spotify/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: selectedDevice.id, play: false })
      });
      if (response.ok) {
        console.log('✅ Transferred playback to selected device');
        await fetchPlaybackState();
        // NudgeResume to ensure correct track/context
        if (socket && roomId) {
          socket.emit('resume-song', { roomId });
        }
      } else {
        let msg = 'Failed to transfer playback';
        try {
          const err = await response.json();
          if (err?.error) msg = String(err.error);
        } catch {}
        console.error('❌ Failed to transfer playback:', msg);
        alert(`Transfer failed: ${msg}`);
      }
    } catch (e) {
      console.error('❌ Error transferring playback:', e);
    }
  }, [selectedDevice, fetchPlaybackState]);

  const recoverPlayback = useCallback(async () => {
    try {
      if (!selectedDevice?.id) {
        alert('Select a Spotify device first');
        return;
      }
      // Try to regain control and auto-play on selected device
      await fetch(`${API_BASE || ''}/api/spotify/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: selectedDevice.id, play: false })
      });
    } catch {}
    try {
      await fetchPlaybackState();
      if (socket && roomId) {
        // NudgeResume if host believes a song is active
        socket.emit('resume-song', { roomId });
      }
    } catch {}
  }, [selectedDevice?.id, fetchPlaybackState, socket, roomId]);


  // Debounced volume change with strict synchronization
  const handleVolumeChange = useCallback(async (newVolume: number) => {
    // Clear any existing timeout
    if (volumeTimeout) {
      clearTimeout(volumeTimeout);
    }

    // Set local state immediately for responsive UI
    setPlaybackState(prev => ({ ...prev, volume: newVolume }));
    setIsMuted(false);
    
    // Persist volume to localStorage
    localStorage.setItem('spotify-volume', newVolume.toString());

    // Debounce the actual volume change to prevent rapid API calls
    const timeout = setTimeout(async () => {
      try {
        console.log(`�� Setting volume to ${newVolume}% on Spotify`);
        const response = await fetch(`${API_BASE || ''}/api/spotify/volume`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            volume: newVolume,
            deviceId: selectedDevice?.id,
            roomId: roomId
          })
        });
        
        if (response.ok) {
          // Don't fetch current volume - trust our local state
          console.log(`✅ Volume set to ${newVolume}% successfully`);
        } else {
          console.error('Failed to set volume, reverting to Spotify state');
          fetchCurrentVolume(); // Only revert on error
        }
      } catch (error) {
        console.error('Error setting volume:', error);
        fetchCurrentVolume(); // Revert to actual Spotify volume
      }
    }, 100); // 100ms debounce

    setVolumeTimeout(timeout);
  }, [selectedDevice?.id, volumeTimeout, fetchCurrentVolume, roomId]);

  const handleMuteToggle = useCallback(async () => {
    if (isMuted) {
      // Unmute - restore previous volume
      setPlaybackState(prev => ({ ...prev, volume: previousVolume }));
      setIsMuted(false);
      
      try {
        console.log(`�� Unmuting, setting volume to ${previousVolume}%`);
        const response = await fetch(`${API_BASE || ''}/api/spotify/volume`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            volume: previousVolume,
            deviceId: selectedDevice?.id,
            roomId: roomId
          })
        });
        
        if (response.ok) {
          // Don't fetch current volume - trust our local state
          console.log(`✅ Unmuted to ${previousVolume}% successfully`);
        } else {
          console.error('Failed to unmute, reverting to Spotify state');
          fetchCurrentVolume();
        }
      } catch (error) {
        console.error('Error unmuting:', error);
        fetchCurrentVolume();
      }
    } else {
      // Mute - save current volume and set to 0
      setPreviousVolume(playbackState.volume);
      setPlaybackState(prev => ({ ...prev, volume: 0 }));
      setIsMuted(true);
      
      try {
        console.log(`�� Muting, setting volume to 0%`);
        const response = await fetch(`${API_BASE || ''}/api/spotify/volume`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            volume: 0,
            deviceId: selectedDevice?.id,
            roomId: roomId
          })
        });
        
        if (response.ok) {
          // Don't fetch current volume - trust our local state
          console.log(`✅ Muted successfully`);
        } else {
          console.error('Failed to mute, reverting to Spotify state');
          fetchCurrentVolume();
        }
      } catch (error) {
        console.error('Error muting:', error);
        fetchCurrentVolume();
      }
    }
  }, [isMuted, previousVolume, playbackState.volume, selectedDevice?.id, fetchCurrentVolume, roomId]);

  const handleSeek = useCallback(async (newTime: number) => {
    setPlaybackState(prev => ({ ...prev, currentTime: newTime }));
    
    try {
        const response = await fetch(`${API_BASE || ''}/api/spotify/seek`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          position: newTime,
          deviceId: selectedDevice?.id 
        })
      });
      
      if (!response.ok) {
        console.error('Failed to seek');
      }
    } catch (error) {
      console.error('Error seeking:', error);
    }
  }, [selectedDevice?.id]);

  const handleSkipToNext = useCallback(() => {
    if (socket) {
      socket.emit('skip-song', { roomId });
    }
  }, [socket, roomId]);

  const handleSkipToPrevious = useCallback(() => {
    if (socket) {
      // Send current playback position to determine if we should restart current song or go to previous
      const currentPosition = playbackState.currentTime;
      socket.emit('previous-song', { 
        roomId, 
        currentPosition: currentPosition 
      });
      console.log(`Previous button clicked at position: ${currentPosition}ms`);
    }
  }, [socket, roomId, playbackState.currentTime]);

  // Force device detection
  const forceDeviceDetection = useCallback(async () => {
    try {
      setIsLoadingDevices(true);
      console.log('�� Forcing device detection...');
      
      const response = await fetch('/api/spotify/force-device', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (response.ok) {
        console.log('✅ Device detection forced successfully');
        await loadDevices();
      } else {
        console.error('❌ Failed to force device detection');
      }
    } catch (error) {
      console.error('❌ Error forcing device detection:', error);
    } finally {
      setIsLoadingDevices(false);
    }
  }, [loadDevices]);

  // Refresh Spotify connection
  const refreshSpotifyConnection = useCallback(async () => {
    try {
      setIsLoadingDevices(true);
      console.log('�� Refreshing Spotify connection...');
      
      const response = await fetch('/api/spotify/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (response.ok) {
        console.log('✅ Spotify connection refreshed');
        await loadDevices();
        await loadPlaylists();
      } else {
        console.error('❌ Failed to refresh Spotify connection');
      }
    } catch (error) {
      console.error('❌ Error refreshing Spotify connection:', error);
    } finally {
      setIsLoadingDevices(false);
    }
  }, [loadDevices, loadPlaylists]);

  // Format time helper
  const formatTime = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Progress tracking for time slider
  useEffect(() => {
    if (!isPlaying || !currentSong) return;
    
    const interval = setInterval(() => {
      setPlaybackState(prev => ({
        ...prev,
        currentTime: Math.min(prev.currentTime + 1000, prev.duration)
      }));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isPlaying, currentSong]);

  // DISABLED: Periodic volume synchronization to preserve user's volume setting
  // useEffect(() => {
  //   if (!isPlaying || !currentSong) return;
  //   const volumeSyncInterval = setInterval(() => {
  //     // Only sync volume every 15s to reduce noise
  //     fetchCurrentVolume();
  //   }, 15000);
  //   return () => clearInterval(volumeSyncInterval);
  // }, [isPlaying, currentSong, fetchCurrentVolume]);

  // Periodic playback state synchronization
  useEffect(() => {
    if (!currentSong) return;
    const playbackSyncInterval = setInterval(async () => {
      try {
        const resp = await fetch(`${API_BASE || ''}/api/spotify/current-playback`);
        if (!resp.ok) {
          if (resp.status >= 500) return; // ignore 5xx
          return;
        }
        const data = await resp.json();
          if (data.success && data.playbackState) {
          const spotifyIsPlaying = !!data.playbackState.is_playing;
            const spotifyPosition = data.playbackState.progress_ms || 0;
          // Shuffle/repeat state removed - not used in UI
          // setShuffleEnabled(!!data.playbackState.shuffle_state);
          // const rep = (data.playbackState.repeat_state || 'off') as 'off' | 'track' | 'context';
          // setRepeatState(rep);
          // Guards: ignore polling false near reconnect or a recent song event
          const now = Date.now();
          if (!spotifyIsPlaying) {
            if (now < ignorePollingUntilRef.current) return;
            if (now - lastSongEventAtRef.current < 15000) return;
          }
            if (spotifyIsPlaying !== isPlaying) {
              console.log(`�� Spotify playback state changed: ${spotifyIsPlaying}, updating interface`);
              setIsPlaying(spotifyIsPlaying);
            setPlaybackState(prev => ({ ...prev, isPlaying: spotifyIsPlaying, currentTime: spotifyPosition }));
              if (spotifyIsPlaying && isPausedByInterface) {
                console.log('�� SpotifyResumed externally, clearing pause tracking');
                setIsPausedByInterface(false);
                setPausePosition(0);
              }
            }
          }
      } catch {
        // ignore
      }
    }, 30000); // 30s throttle
    return () => clearInterval(playbackSyncInterval);
  }, [currentSong, isPlaying, isPausedByInterface]);

  // Generate song list when selected playlists change
  useEffect(() => {
    generateSongList();
  }, [selectedPlaylists, generateSongList]);
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (!currentSong) return;
      
             switch (event.code) {
         case 'Space':
           event.preventDefault();
           playSong(currentSong);
           break;
         case 'ArrowLeft':
           event.preventDefault();
           handleSkipToPrevious();
           break;
         case 'ArrowRight':
           event.preventDefault();
           handleSkipToNext();
           break;
         case 'KeyM':
           event.preventDefault();
           handleMuteToggle();
           break;
       }
    };

         document.addEventListener('keydown', handleKeyPress);
     return () => document.removeEventListener('keydown', handleKeyPress);
   }, [currentSong, handleMuteToggle]);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = React.useRef<string | null>(null);
  const lastReconnectAtRef = React.useRef<number>(0);
  const lastResumePingAtRef = React.useRef<number>(0);
  const ignorePollingUntilRef = React.useRef<number>(0);
  const lastSongEventAtRef = React.useRef<number>(0);

  useEffect(() => {
    // Ensure a single audio element exists
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'auto';
      audioRef.current.crossOrigin = 'anonymous';
      audioRef.current.volume = 1.0;
    }
  }, []);

  // When a new song starts via socket, prefetch preview if available
  useEffect(() => {
    if (!currentSong) return;
    const handlePrefetch = async () => {
      try {
        // previewUrl is delivered on song-playing payload via server
        const previewUrl = (currentSong as any).previewUrl as string | undefined;
        if (previewUrl) {
          audioUrlRef.current = previewUrl;
          if (audioRef.current) {
            audioRef.current.src = previewUrl;
            await audioRef.current.load?.();
          }
        } else {
          audioUrlRef.current = null;
        }
      } catch {}
    };
    handlePrefetch();
  }, [currentSong]);

  // Early-fail guard on the host (client-side): if playback hasn't advanced soon after start, play preview
  useEffect(() => {
    if (!isPlaying || !currentSong) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      try {
        const resp = await fetch(`${API_BASE || ''}/api/spotify/current-playback`);
        if (!resp.ok) return;
        const data = await resp.json();
        const progress = Number(data?.playbackState?.progress_ms || 0);
        const is_sp_playing = !!data?.playbackState?.is_playing;
        if ((!is_sp_playing || progress < 1000) && audioRef.current && audioUrlRef.current) {
          console.warn('⚠️ Spotify stall detected on host; playing preview fallback');
          try { await audioRef.current.play(); } catch {}
        }
      } catch {}
    }, 4000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [isPlaying, currentSong]);

  const confirmAndResetGame = () => {
    if (!roomId) return;
    if (window.confirm('Reset the current game? This clears current round state.')) {
      resetGame();
    }
  };

  const confirmAndNewRound = () => {
    if (!roomId || !socket) return;
    if (window.confirm('Start a new round? This keeps playlists but resets progress.')) {
      // Mark current round as completed
      if (currentRoundIndex >= 0 && currentRoundIndex < eventRounds.length) {
        const updatedRounds = [...eventRounds];
        updatedRounds[currentRoundIndex] = {
          ...updatedRounds[currentRoundIndex],
          status: 'completed',
          completedAt: Date.now()
        };
        setEventRounds(updatedRounds);
        
        // Store updated rounds
        try {
          localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(updatedRounds));
        } catch (error) {
          console.warn('Failed to save rounds to localStorage:', error);
        }
      }
      
      socket.emit('new-round', { roomId });
      addLog('New Round requested', 'info');
    }
  };

  // Round management functions
  const handleUpdateRounds = useCallback((newRounds: EventRound[]) => {
    setEventRounds(newRounds);
    // Store in localStorage for persistence
    try {
      localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(newRounds));
    } catch (error) {
      console.warn('Failed to save rounds to localStorage:', error);
    }
  }, [roomId]);


  const handleStartRound = useCallback((roundIndex: number) => {
    const round = eventRounds[roundIndex];
    if (!round || round.playlistIds.length === 0) {
      alert('Please select at least one playlist for this round first.');
      return;
    }

    // Mark current round as completed if it exists
    if (currentRoundIndex >= 0 && currentRoundIndex < eventRounds.length) {
      const updatedRounds = [...eventRounds];
      updatedRounds[currentRoundIndex] = {
        ...updatedRounds[currentRoundIndex],
        status: 'completed',
        completedAt: Date.now()
      };
      setEventRounds(updatedRounds);
    }

    // Set new round as active
    const updatedRounds = [...eventRounds];
    updatedRounds[roundIndex] = {
      ...updatedRounds[roundIndex],
      status: 'active',
      startedAt: Date.now()
    };
    setEventRounds(updatedRounds);
    setCurrentRoundIndex(roundIndex);

    // Update selected playlists to match the round
    const roundPlaylists = playlists.filter(p => round.playlistIds.includes(p.id));
    if (roundPlaylists.length > 0) {
      setSelectedPlaylists(roundPlaylists);
      const playlistNames = round.playlistNames.join(', ');
      addLog(`Started ${round.name}: ${playlistNames}`, 'info');
    }

    // Store updated rounds
    try {
      localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(updatedRounds));
    } catch (error) {
      console.warn('Failed to save rounds to localStorage:', error);
    }
  }, [eventRounds, currentRoundIndex, playlists, roomId]);

  // Advanced round management functions
  const jumpToRound = useCallback((roundIndex: number) => {
    if (roundIndex >= 0 && roundIndex < eventRounds.length) {
      const round = eventRounds[roundIndex];
      if (round.status !== 'completed' && (round.playlistIds || []).length > 0) {
        handleStartRound(roundIndex);
        setShowRoundManager(false);
        addLog(`Jumped to ${round.name}`, 'info');
      }
    }
  }, [eventRounds, handleStartRound]);

  const completeCurrentRound = useCallback(() => {
    if (currentRoundIndex >= 0 && currentRoundIndex < eventRounds.length) {
      const updatedRounds = [...eventRounds];
      updatedRounds[currentRoundIndex] = {
        ...updatedRounds[currentRoundIndex],
        status: 'completed',
        completedAt: Date.now()
      };
      handleUpdateRounds(updatedRounds);
      addLog(`Completed ${updatedRounds[currentRoundIndex].name}`, 'info');
    }
  }, [currentRoundIndex, eventRounds, handleUpdateRounds]);

  const resetCurrentRound = useCallback(() => {
    if (gameState === 'playing') {
      // Reset the current game state
      setGameState('waiting');
      setCurrentSong(null);
      setPlayedSoFar([]);
      setWinners([]);
      setRoundComplete(null);
      setRoundWinners([]);
      
      // Emit reset to all clients
      if (socket) {
        socket.emit('game-reset');
      }
      
      addLog(`Reset current round`, 'info');
    }
  }, [gameState, socket]);

  const getNextPlannedRound = useCallback(() => {
    return eventRounds.findIndex(round => 
      round.status === 'planned' && (round.playlistIds || []).length > 0
    );
  }, [eventRounds]);

  const getRoundStatusSummary = useCallback(() => {
    const completed = eventRounds.filter(r => r.status === 'completed').length;
    const active = eventRounds.filter(r => r.status === 'active').length;
    const planned = eventRounds.filter(r => r.status === 'planned' && (r.playlistIds || []).length > 0).length;
    const unplanned = eventRounds.filter(r => r.status === 'unplanned' || (r.playlistIds || []).length === 0).length;
    
    return { completed, active, planned, unplanned, total: eventRounds.length };
  }, [eventRounds]);

  // Load rounds from localStorage on component mount
  useEffect(() => {
    if (!roomId) return;
    
    try {
      const savedRounds = localStorage.getItem(`event-rounds-${roomId}`);
      if (savedRounds) {
        const rounds = JSON.parse(savedRounds);
        if (Array.isArray(rounds) && rounds.length > 0) {
          // Migrate old single-playlist format to new multi-playlist format
          const migratedRounds = rounds.map((round: any) => {
            // Check if this is old format (has playlistId instead of playlistIds)
            if (round.playlistId && !round.playlistIds) {
              return {
                ...round,
                playlistIds: round.playlistId ? [round.playlistId] : [],
                playlistNames: round.playlistName ? [round.playlistName] : [],
                // Remove old properties
                playlistId: undefined,
                playlistName: undefined
              };
            }
            // Ensure new format has required arrays
            return {
              ...round,
              playlistIds: round.playlistIds || [],
              playlistNames: round.playlistNames || []
            };
          });
          
          setEventRounds(migratedRounds);
          
          // Save migrated data back to localStorage
          localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(migratedRounds));
          
          // Find the active round
          const activeIndex = migratedRounds.findIndex((r: EventRound) => r.status === 'active');
          if (activeIndex >= 0) {
            setCurrentRoundIndex(activeIndex);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load rounds from localStorage:', error);
    }
  }, [roomId]);

  // Calculate win progress for a player's bingo card
  const calculateWinProgress = (card: any, currentPattern: string) => {
    if (!card || !card.squares) return { needed: 25, marked: 0, progress: 0 };
    
    const squares = card.squares;
    const markedCount = squares.filter((s: any) => s.marked).length;
    
    if (currentPattern === 'full_card') {
      const needed = Math.max(0, 25 - markedCount);
      return { needed, marked: markedCount, progress: Math.round((markedCount / 25) * 100) };
    }
    
    if (currentPattern === 'four_corners') {
      const corners = ['0-0', '0-4', '4-0', '4-4'];
      const markedCorners = corners.filter(pos => 
        squares.find((s: any) => s.position === pos && s.marked)
      ).length;
      const needed = Math.max(0, 4 - markedCorners);
      return { needed, marked: markedCorners, progress: Math.round((markedCorners / 4) * 100) };
    }
    
    if (currentPattern === 'x') {
      let diag1Marked = 0, diag2Marked = 0;
      for (let i = 0; i < 5; i++) {
        if (squares.find((s: any) => s.position === `${i}-${i}` && s.marked)) diag1Marked++;
        if (squares.find((s: any) => s.position === `${i}-${4-i}` && s.marked)) diag2Marked++;
      }
      const totalDiagSquares = 9; // 5 + 5 - 1 (center overlap)
      const markedDiagSquares = Math.min(diag1Marked + diag2Marked, totalDiagSquares);
      const needed = Math.max(0, totalDiagSquares - markedDiagSquares);
      return { needed, marked: markedDiagSquares, progress: Math.round((markedDiagSquares / totalDiagSquares) * 100) };
    }
    
    if (currentPattern === 'line') {
      // For line pattern, find the closest line to completion
      let bestLineProgress = 0;
      let bestLineNeeded = 5;
      
      // Check rows
      for (let row = 0; row < 5; row++) {
        let rowMarked = 0;
        for (let col = 0; col < 5; col++) {
          if (squares.find((s: any) => s.position === `${row}-${col}` && s.marked)) rowMarked++;
        }
        if (rowMarked > bestLineProgress) {
          bestLineProgress = rowMarked;
          bestLineNeeded = 5 - rowMarked;
        }
      }
      
      // Check columns
      for (let col = 0; col < 5; col++) {
        let colMarked = 0;
        for (let row = 0; row < 5; row++) {
          if (squares.find((s: any) => s.position === `${row}-${col}` && s.marked)) colMarked++;
        }
        if (colMarked > bestLineProgress) {
          bestLineProgress = colMarked;
          bestLineNeeded = 5 - colMarked;
        }
      }
      
      // Check diagonals
      let diag1Marked = 0, diag2Marked = 0;
      for (let i = 0; i < 5; i++) {
        if (squares.find((s: any) => s.position === `${i}-${i}` && s.marked)) diag1Marked++;
        if (squares.find((s: any) => s.position === `${i}-${4-i}` && s.marked)) diag2Marked++;
      }
      if (diag1Marked > bestLineProgress) {
        bestLineProgress = diag1Marked;
        bestLineNeeded = 5 - diag1Marked;
      }
      if (diag2Marked > bestLineProgress) {
        bestLineProgress = diag2Marked;
        bestLineNeeded = 5 - diag2Marked;
      }
      
      return { needed: bestLineNeeded, marked: bestLineProgress, progress: Math.round((bestLineProgress / 5) * 100) };
    }
    
    // Default fallback
    return { needed: 25, marked: markedCount, progress: Math.round((markedCount / 25) * 100) };
  };

  return (
    <div className="host-view">
      <motion.div 
        className="host-container"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ minHeight: 0 }}
      >
        {/* Header */}
        <div className="host-header">
          <h1>🎮 Game Host</h1>
          <div className="room-info" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="room-code">Room: {roomId}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={showAllControls} onChange={(e) => setShowAllControls(!!e.target.checked)} />
              <span>Show All Controls</span>
            </label>
            <button className="btn-secondary" onClick={() => setShowLogs(v => !v)}>{showLogs ? 'Hide Logs' : 'Show Logs'}</button>
          </div>
        </div>

        {/* Main Content */}
        <div className="host-content">
          {/* Tab Navigation */}
          <div className="tab-navigation" style={{
            display: 'flex',
            gap: 2,
            marginBottom: 20,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            paddingBottom: 0
          }}>
            {[
              { id: 'setup', label: '🎵 Setup', desc: 'Connect & Configure' },
              { id: 'play', label: '🎮 Play', desc: 'Game Controls' },
              { id: 'manage', label: '🎯 Manage', desc: 'Rounds & Players' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  border: 'none',
                  borderRadius: '8px 8px 0 0',
                  background: activeTab === tab.id 
                    ? 'linear-gradient(135deg, rgba(0,255,136,0.2), rgba(0,255,136,0.1))'
                    : 'rgba(255,255,255,0.05)',
                  color: activeTab === tab.id ? '#00ff88' : '#b3b3b3',
                  borderBottom: activeTab === tab.id ? '2px solid #00ff88' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  fontSize: '0.9rem',
                  fontWeight: activeTab === tab.id ? 600 : 400
                }}
              >
                <div>{tab.label}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>{tab.desc}</div>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="tab-content">
            {activeTab === 'setup' && (
              <div className="setup-tab">
                {/* Spotify Connection */}
          <motion.div 
            className="spotify-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
                         <h2>🎵 Spotify Connection</h2>
             {!isSpotifyConnected ? (
               <div className="spotify-connection-section">
                 {spotifyError && (
                   <div className="spotify-error">
                     <p>{spotifyError}</p>
                     <button 
                       className="retry-btn"
                       onClick={() => {
                         setSpotifyError(null);
                         connectSpotify();
                       }}
                     >
                       Try Again
                     </button>
                   </div>
                 )}
                                   <button 
                    className="spotify-connect-btn"
                    onClick={() => {
                      console.log('Connect Spotify button clicked!');
                      console.log('About to call connectSpotify function...');
                      connectSpotify();
                    }}
                    disabled={isSpotifyConnecting}
                  >
                    <Music className="btn-icon" />
                    {isSpotifyConnecting ? 'Connecting...' : 'Connect Spotify'}
                  </button>
               </div>
             ) : (
               <div className="spotify-connected">
                 <Music className="connected-icon" />
                 <span>Connected to Spotify</span>
                 <button 
                   className="disconnect-btn"
                   onClick={async () => {
                     try {
                      await fetch(`${API_BASE || ''}/api/spotify/clear`, { method: 'POST' });
                       setIsSpotifyConnected(false);
                       setPlaylists([]);
                       setSpotifyError(null);
                     } catch (error) {
                       console.error('Error disconnecting Spotify:', error);
                     }
                   }}
                 >
                   Disconnect
                 </button>
               </div>
             )}
          </motion.div>

          {/* Round Planner */}
          {isSpotifyConnected && (
            <RoundPlanner
              rounds={eventRounds}
              onUpdateRounds={handleUpdateRounds}
              playlists={playlists}
              currentRound={currentRoundIndex}
              onStartRound={handleStartRound}
              gameState={gameState}
            />
          )}

                {/* Playlists Section */}
                {(showPlaylists || showAllControls) && isSpotifyConnected && (
                  <motion.div 
                    className="playlists-section"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                  >
                    <h2>📚 Available Playlists</h2>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        placeholder="Search playlists..."
                        value={playlistQuery}
                        onChange={(e) => setPlaylistQuery(e.target.value)}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '6px',
                          border: '1px solid rgba(255,255,255,0.2)',
                          background: 'rgba(0,0,0,0.3)',
                          color: '#fff',
                          minWidth: '200px'
                        }}
                      />
                      <button 
                        className="btn-secondary"
                        onClick={() => {
                          setVisiblePlaylists(playlists.filter(p => !assignedPlaylistIds.has(p.id)));
                          setPlaylistQuery('');
                        }}
                      >
                        Show All
                      </button>
                      <button 
                        className="btn-secondary"
                        onClick={() => {
                          const gotPlaylists = playlists.filter(p => 
                            p.name.toLowerCase().includes('got') && !assignedPlaylistIds.has(p.id)
                          );
                          setVisiblePlaylists(gotPlaylists);
                          setPlaylistQuery('');
                        }}
                      >
                        GOT Playlists
                      </button>
                    </div>
                    
                    <div style={{ 
                      maxHeight: 400, 
                      overflowY: 'auto', 
                      border: '1px solid rgba(255,255,255,0.1)', 
                      borderRadius: 8, 
                      padding: 8 
                    }}>
                      {(() => {
                        // Get all playlist IDs that are already assigned to rounds
                        const assignedPlaylistIds = new Set(
                          eventRounds.flatMap(round => round.playlistIds || [])
                        );

                        // Filter playlists by query and exclude already assigned playlists
                        const filteredPlaylists = (playlistQuery ? playlists.filter(p => {
                          const q = playlistQuery.toLowerCase();
                          return (
                            !assignedPlaylistIds.has(p.id) && // Exclude assigned playlists
                            ((p.name || '').toLowerCase().includes(q) ||
                            (p.owner || '').toLowerCase().includes(q) ||
                            (p.description || '').toLowerCase().includes(q))
                          );
                        }) : playlists.filter(p => !assignedPlaylistIds.has(p.id))); // Exclude assigned playlists even without query

                        return filteredPlaylists.length === 0 ? (
                          <div style={{ padding: 20, textAlign: 'center', opacity: 0.7 }}>
                            {playlistQuery ? 'No playlists match your search.' : 'No available playlists.'}
                          </div>
                        ) : (
                          filteredPlaylists.map((p) => {
                          const isSelected = selectedPlaylists.some(sp => sp.id === p.id);
                          const isInsufficient = p.tracks < 25;
                          
                          return (
                            <div 
                              key={p.id} 
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', p.id);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: 10, 
                                padding: '6px 8px', 
                                borderBottom: '1px solid rgba(255,255,255,0.08)',
                                backgroundColor: isInsufficient ? 'rgba(255, 193, 7, 0.1)' : 'transparent',
                                border: isInsufficient ? '1px solid rgba(255, 193, 7, 0.3)' : 'none',
                                borderRadius: isInsufficient ? '4px' : '0',
                                margin: isInsufficient ? '2px 0' : '0',
                                cursor: 'grab'
                              }}
                              onMouseDown={(e) => e.currentTarget.style.cursor = 'grabbing'}
                              onMouseUp={(e) => e.currentTarget.style.cursor = 'grab'}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedPlaylists([...selectedPlaylists, p]);
                                  } else {
                                    setSelectedPlaylists(selectedPlaylists.filter(sp => sp.id !== p.id));
                                  }
                                }}
                              />
                              <span style={{ 
                                flex: 1, 
                                fontSize: '0.9rem',
                                color: isInsufficient ? '#ffc107' : '#fff'
                              }}>
                                {stripGoTPrefix ? p.name.replace(/^GoT\s*[-–:]*\s*/i, '') : p.name}
                              </span>
                              <span style={{ 
                                fontSize: '0.8rem', 
                                opacity: 0.7,
                                color: isInsufficient ? '#ffc107' : '#b3b3b3'
                              }}>
                                {p.tracks} songs
                              </span>
                              {isInsufficient && (
                                <button
                                  onClick={() => handleSuggestSongs(p)}
                                  className="btn-accent"
                                  style={{ 
                                    padding: '4px 8px', 
                                    fontSize: '0.75rem',
                                    background: 'linear-gradient(135deg, #ff6b35, #f7931e)',
                                    border: '1px solid rgba(255, 107, 53, 0.5)'
                                  }}
                                  title="Get AI suggestions to reach 25+ songs"
                                >
                                  🤖 Suggest Songs
                                </button>
                              )}
                            </div>
                          );
                        })
                        );
                      })()}
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {activeTab === 'play' && (
              <div className="play-tab">
                {/* Game Controls */}
                <motion.div 
                  className="controls-section"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <h2>🎮 Game Controls</h2>
                  
                  {/* Game Settings */}
                  <div style={{ 
                    background: 'rgba(255,255,255,0.05)', 
                    padding: 16, 
                    borderRadius: 8, 
                    marginBottom: 16 
                  }}>
                    {/* Track Length Control */}
                    <div style={{ marginBottom: 16 }}>
                      <h4 style={{ fontSize: '0.9rem', color: '#00ff88', marginBottom: 8, fontWeight: 600 }}>
                        🎵 Track Playback Settings
                      </h4>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ opacity: 0.85, minWidth: '80px' }}>Track Length:</span>
                          <input
                            type="range"
                            min="5"
                            max="60"
                            value={snippetLength}
                            onChange={(e) => {
                              const newLength = Number(e.target.value);
                              setSnippetLength(newLength);
                              localStorage.setItem('game-snippet-length', newLength.toString());
                            }}
                            style={{ width: '120px' }}
                          />
                          <span style={{ width: 40, textAlign: 'right', color: '#00ff88', fontWeight: 'bold' }}>
                            {snippetLength}s
                          </span>
                        </label>
                      </div>
                      
                      {/* Start Position Control */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <span style={{ opacity: 0.85, minWidth: '80px' }}>Start Position:</span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="radio"
                            name="startPosition"
                            checked={!randomStarts}
                            onChange={() => {
                              setRandomStarts(false);
                              localStorage.setItem('game-random-starts', 'false');
                            }}
                          />
                          <span>From beginning</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="radio"
                            name="startPosition"
                            checked={randomStarts}
                            onChange={() => {
                              setRandomStarts(true);
                              localStorage.setItem('game-random-starts', 'true');
                            }}
                          />
                          <span>Random position</span>
                        </label>
                      </div>
                      
                      {/* Description */}
                      <div style={{ 
                        fontSize: '0.8rem', 
                        color: '#b3b3b3', 
                        marginTop: 8, 
                        padding: '8px 12px', 
                        background: 'rgba(255,255,255,0.03)', 
                        borderRadius: 4,
                        borderLeft: '3px solid #00ff88'
                      }}>
                        {randomStarts 
                          ? `Each track will play for ${snippetLength} seconds starting from a random position (avoiding the very end)`
                          : `Each track will play for ${snippetLength} seconds starting from the beginning`
                        }
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={lockJoins}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setLockJoins(val);
                            if (socket && roomId) socket.emit('set-lock-joins', { roomId, locked: val });
                          }}
                        />
                        <span>Lock new joins</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={superStrict}
                          onChange={(e) => {
                            const val = !!e.target.checked;
                            setSuperStrict(val);
                            if (socket && roomId) socket.emit('set-super-strict', { roomId, enabled: val });
                          }}
                        />
                        <span>Super-Strict Lock</span>
                      </label>
                    </div>
                  </div>

                  {/* Main Game Controls */}
                  <div className="control-buttons">
                    {gameState === 'waiting' && !currentSong ? (
                      <>
                        {!mixFinalized && (
                          <button 
                            className="control-button finalize-mix"
                            onClick={finalizeMix}
                            disabled={selectedPlaylists.length === 0 || isSpotifyConnecting}
                          >
                            🎵 Finalize Mix
                          </button>
                        )}
                        {mixFinalized && (
                          <div className="mix-finalized-status">
                            <p className="status-text">✅ Mix finalized - Cards generated for players</p>
                          </div>
                        )}
                        <button
                          onClick={startGame}
                          disabled={selectedPlaylists.length === 0 || isSpotifyConnecting}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '14px 22px',
                            fontSize: '1.05rem',
                            fontWeight: 900,
                            letterSpacing: '0.02em',
                            borderRadius: 12,
                            border: (selectedPlaylists.length === 0 || isSpotifyConnecting) ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,255,136,0.6)',
                            color: (selectedPlaylists.length === 0 || isSpotifyConnecting) ? '#c8c8c8' : '#0b0e12',
                            background: (selectedPlaylists.length === 0 || isSpotifyConnecting)
                              ? 'rgba(255,255,255,0.08)'
                              : 'linear-gradient(180deg, #00ff88 0%, #00cc6d 100%)',
                            boxShadow: (selectedPlaylists.length === 0 || isSpotifyConnecting)
                              ? 'none'
                              : '0 10px 30px rgba(0,255,136,0.25), inset 0 1px 0 rgba(255,255,255,0.4)',
                            cursor: (selectedPlaylists.length === 0 || isSpotifyConnecting) ? 'not-allowed' : 'pointer',
                            opacity: (isSpotifyConnecting) ? 0.8 : 1
                          }}
                        >
                          <Play className="btn-icon" />
                          {isSpotifyConnecting ? 'Connecting Spotify...' : 'Start Game'}
                        </button>
                      </>
                    ) : (
                      <div className="game-status">
                        <p className="status-text">🎵 Game is running - Use the Now Playing controls below</p>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          <button className="btn-secondary" onClick={endGame}>End Game</button>
                          <button className="btn-secondary" onClick={confirmAndResetGame}>🔄 Reset</button>
                          <button className="btn-secondary" onClick={confirmAndNewRound}>🆕 New Round</button>
                          <button className="btn-accent" onClick={() => setShowRoundManager(!showRoundManager)}>
                            🎯 Round Manager
                          </button>
                          <button 
                            className="btn-danger" 
                            onClick={handleRestartGame}
                            style={{ background: '#ff6b6b', borderColor: '#ff4757' }}
                            title="Complete restart: reset all progress, keep cards"
                          >
                            🔄 Restart
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                          <span style={{ opacity: 0.9 }}>Call Reveal:</span>
                          <button className="btn-secondary" onClick={() => revealCall('artist')}>Artist</button>
                          <button className="btn-secondary" onClick={() => revealCall('title')}>Title</button>
                          <button className="btn-secondary" onClick={() => revealCall('full')}>Full</button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button className="btn-secondary" onClick={forceRefreshAll}>🧹 Force Refresh Clients</button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            )}

            {activeTab === 'manage' && (
              <div className="manage-tab">
                {/* Round Manager */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="bg-rgba(42, 42, 42, 0.95) backdrop-blur-[20px] border border-rgba(0, 255, 136, 0.3) rounded-2xl p-6 mb-6"
                >
                  <h2>🎯 Round & Event Management</h2>
                  
                  {/* Round Status Summary */}
                  <div className="mb-6 p-4 bg-rgba(255, 255, 255, 0.05) rounded-xl">
                    <h4 className="text-lg font-semibold text-white mb-3">Event Overview</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {(() => {
                        const summary = getRoundStatusSummary();
                        return (
                          <>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-green-400">{summary.completed}</div>
                              <div className="text-sm text-gray-400">Completed</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-blue-400">{summary.active}</div>
                              <div className="text-sm text-gray-400">Active</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-yellow-400">{summary.planned}</div>
                              <div className="text-sm text-gray-400">Planned</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-gray-400">{summary.unplanned}</div>
                              <div className="text-sm text-gray-400">Unplanned</div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="mb-6">
                    <h4 className="text-lg font-semibold text-white mb-3">Quick Actions</h4>
                    <div className="flex gap-3 flex-wrap">
                      {gameState === 'playing' && (
                        <>
                          <button
                            onClick={completeCurrentRound}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                          >
                            ✅ Complete Current Round
                          </button>
                          <button
                            onClick={resetCurrentRound}
                            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
                          >
                            🔄 Reset Current Round
                          </button>
                        </>
                      )}
                      {(() => {
                        const nextRound = getNextPlannedRound();
                        return nextRound >= 0 ? (
                          <button
                            onClick={() => jumpToRound(nextRound)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            ⏭️ Start Next Planned Round
                          </button>
                        ) : null;
                      })()}
                      
                      {/* Reset Event Button - Always available */}
                      <button
                        onClick={resetEvent}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                        title="Reset entire event back to the beginning"
                      >
                        🔄 Reset Event
                      </button>
                    </div>
                  </div>

                  {/* Round List */}
                  <div>
                    <h4 className="text-lg font-semibold text-white mb-3">All Rounds</h4>
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                      {eventRounds.map((round, index) => {
                        const isCurrentRound = index === currentRoundIndex;
                        const canStart = round.status !== 'completed' && (round.playlistIds || []).length > 0;
                        
                        return (
                          <div
                            key={round.id}
                            className={`p-4 rounded-xl border-2 ${
                              isCurrentRound
                                ? 'border-green-400 bg-green-400/10'
                                : round.status === 'completed'
                                ? 'border-gray-600 bg-gray-600/10'
                                : canStart
                                ? 'border-blue-400 bg-blue-400/10'
                                : 'border-yellow-600 bg-yellow-600/10'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-white">{round.name}</span>
                                  {isCurrentRound && (
                                    <span className="px-2 py-1 bg-green-400 text-black text-xs font-bold rounded-full">
                                      CURRENT
                                    </span>
                                  )}
                                  {round.status === 'completed' && (
                                    <span className="px-2 py-1 bg-gray-600 text-white text-xs font-bold rounded-full">
                                      DONE
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-gray-400 mt-1">
                                  {(round.playlistIds || []).length} playlist{(round.playlistIds || []).length !== 1 ? 's' : ''} • {round.songCount} songs
                                  {round.status === 'completed' && round.completedAt && (
                                    <span className="ml-2">
                                      • Completed {new Date(round.completedAt).toLocaleTimeString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                {canStart && !isCurrentRound && (
                                  <button
                                    onClick={() => jumpToRound(index)}
                                    className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                                  >
                                    Start
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>

                {/* Player Cards */}
                {showPlayerCards && playerCards.size > 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="player-cards-section"
                  >
                    <h2>👥 Player Cards & Progress</h2>
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', 
                      gap: 16 
                    }}>
                      {Array.from(playerCards.entries()).map(([playerId, playerData]) => (
                        <div key={playerId} style={{ 
                          background: 'linear-gradient(135deg, #1a1a1a, #2a2a2a)',
                          border: '1px solid rgba(0,255,136,0.3)', 
                          borderRadius: '12px', 
                          padding: '16px',
                          boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
                        }}>
                          <div style={{ 
                            fontWeight: 'bold', 
                            marginBottom: '8px', 
                            color: '#00ff88',
                            fontSize: '1rem',
                            textAlign: 'center'
                          }}>
                            {playerData.playerName}
                          </div>
                          
                          {/* Win Progress Indicator */}
                          {(() => {
                            const progress = calculateWinProgress(playerData.card, pattern);
                            const progressColor = progress.needed === 0 ? '#00ff88' : 
                                                progress.needed <= 2 ? '#ffaa00' : 
                                                progress.progress >= 50 ? '#66ccff' : '#888';
                            const progressText = progress.needed === 0 ? '🎉 BINGO!' : 
                                               progress.needed === 1 ? '1 more needed!' :
                                               `${progress.needed} more needed`;
                            
                            return (
                              <div style={{ 
                                marginBottom: '12px', 
                                textAlign: 'center',
                                fontSize: '0.85rem'
                              }}>
                                <div style={{ 
                                  color: progressColor,
                                  fontWeight: 600,
                                  marginBottom: '4px'
                                }}>
                                  {progressText}
                                </div>
                                <div style={{ 
                                  background: 'rgba(255,255,255,0.1)',
                                  borderRadius: '8px',
                                  height: '6px',
                                  overflow: 'hidden',
                                  margin: '0 auto',
                                  maxWidth: '200px'
                                }}>
                                  <div style={{
                                    background: progressColor,
                                    height: '100%',
                                    width: `${progress.progress}%`,
                                    transition: 'width 0.3s ease'
                                  }} />
                                </div>
                                <div style={{ 
                                  fontSize: '0.75rem',
                                  color: '#b3b3b3',
                                  marginTop: '2px'
                                }}>
                                  {progress.marked}/{pattern === 'full_card' ? 25 : pattern === 'four_corners' ? 4 : pattern === 'x' ? 9 : 5} ({progress.progress}%)
                                </div>
                              </div>
                            );
                          })()}
                          <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(5, 1fr)', 
                            gap: '4px', 
                            maxWidth: '300px',
                            aspectRatio: '1/1',
                            margin: '0 auto'
                          }}>
                            {playerData.card.squares.map((square: any) => (
                              <div 
                                key={square.position}
                                style={{ 
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: square.marked 
                                    ? 'linear-gradient(135deg, #00ff88, #00cc6d)' 
                                    : 'rgba(255,255,255,0.1)',
                                  border: square.marked 
                                    ? '2px solid #00ff88' 
                                    : '1px solid rgba(255,255,255,0.3)',
                                  borderRadius: '8px',
                                  padding: '4px',
                                  fontSize: '0.7rem',
                                  fontWeight: square.marked ? 700 : 400,
                                  color: square.marked ? '#001a0d' : '#ffffff',
                                  textAlign: 'center',
                                  lineHeight: 1.1,
                                  overflow: 'hidden'
                                }}
                                title={`${square.songName} — ${square.artistName}`}
                              >
                                {square.marked && <span style={{ marginRight: 2 }}>✓</span>}
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {square.songName.length > 12 ? square.songName.substring(0, 12) + '...' : square.songName}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
            )}
          </div>


          {/* Legacy sections removed - now in tabbed interface */}
        </div>

        {/* Now Playing Interface - Always visible when active */}
        {currentSong && (
          <motion.div 
            className="now-playing-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <h2>🎵 Now Playing</h2>
            <div className="now-playing-content">
              {/* Song Info */}
              <div style={{ 
                background: 'rgba(255,255,255,0.05)', 
                padding: 16, 
                borderRadius: 8, 
                marginBottom: 16,
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#00ff88', marginBottom: 8 }}>
                  {currentSong.name}
                </div>
                <div style={{ fontSize: '1rem', color: '#b3b3b3' }}>
                  by {currentSong.artist}
                </div>
              </div>

              {/* Playback Controls */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
                <button className="btn-secondary" onClick={pauseSong}>
                  {!isPlaying ? 'Resume' : 'Pause'}
                </button>
                <button className="btn-secondary" onClick={skipSong}>Skip</button>
                <button className="btn-secondary" onClick={endGame}>End Game</button>
              </div>

              {/* Volume Control */}
              <div style={{ 
                background: 'rgba(255,255,255,0.05)', 
                padding: 16, 
                borderRadius: 8, 
                display: 'flex', 
                alignItems: 'center', 
                gap: 12,
                justifyContent: 'center'
              }}>
                <button 
                  className="btn-secondary"
                  onClick={handleMuteToggle}
                  style={{ 
                    minWidth: '60px',
                    fontSize: '0.9rem'
                  }}
                >
                  {isMuted ? '🔇' : '🔊'}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: '300px' }}>
                  <span style={{ fontSize: '0.9rem', color: '#b3b3b3', minWidth: '30px' }}>
                    {isMuted ? 0 : playbackState.volume}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isMuted ? 0 : playbackState.volume}
                    onChange={(e) => {
                      const newVolume = parseInt(e.target.value);
                      if (isMuted && newVolume > 0) {
                        setIsMuted(false);
                      }
                      setPlaybackState(prev => ({ ...prev, volume: newVolume }));
                      localStorage.setItem('spotify-volume', newVolume.toString());
                      handleVolumeChange(newVolume);
                    }}
                    style={{
                      flex: 1,
                      height: '6px',
                      borderRadius: '3px',
                      background: `linear-gradient(to right, #00ff88 0%, #00ff88 ${isMuted ? 0 : playbackState.volume}%, #333 ${isMuted ? 0 : playbackState.volume}%, #333 100%)`,
                      outline: 'none',
                      cursor: 'pointer',
                      WebkitAppearance: 'none',
                      MozAppearance: 'none',
                      border: 'none'
                    }}
                    className="volume-slider"
                  />
                  <span style={{ fontSize: '0.8rem', color: '#666', minWidth: '40px' }}>100%</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* AI Suggestions Modal */}
        {suggestionsModal.isOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              background: 'linear-gradient(135deg, #1a1a1a, #2a2a2a)',
              border: '1px solid rgba(0,255,136,0.3)',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '90vw',
              maxHeight: '90vh',
              overflow: 'auto',
              minWidth: '600px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ color: '#00ff88', fontSize: '1.2rem', fontWeight: 'bold' }}>
                  🤖 AI Song Suggestions
                </h3>
                <button
                  onClick={() => setSuggestionsModal({ isOpen: false, playlist: null, suggestions: [], loading: false, analysis: null, error: null })}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#b3b3b3',
                    fontSize: '1.5rem',
                    cursor: 'pointer'
                  }}
                >
                  ?
                </button>
              </div>

              {suggestionsModal.error ? (
                <div style={{ color: '#ff6b6b', padding: '16px', textAlign: 'center' }}>
                  {suggestionsModal.error.message}
                  {suggestionsModal.error.details && (
                    <div style={{ fontSize: '0.8rem', marginTop: '8px', opacity: 0.8 }}>
                      {suggestionsModal.error.details}
                    </div>
                  )}
                </div>
              ) : suggestionsModal.suggestions.length > 0 ? (
                <div>
                  <p style={{ marginBottom: '16px', color: '#b3b3b3' }}>
                    Suggestions for: <strong style={{ color: '#00ff88' }}>{suggestionsModal.playlist?.name}</strong>
                  </p>
                  <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                    {suggestionsModal.suggestions.map((song: any, index: number) => (
                      <div key={index} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '8px',
                        borderBottom: '1px solid rgba(255,255,255,0.1)',
                        fontSize: '0.9rem'
                      }}>
                        <span style={{ color: '#00ff88', fontWeight: 'bold', minWidth: '24px' }}>
                          {index + 1}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 'bold', color: '#fff' }}>{song.name}</div>
                          <div style={{ color: '#b3b3b3' }}>by {song.artist}</div>
                        </div>
                        {song.preview_url && (
                          <a
                            href={song.preview_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: '#00ff88',
                              textDecoration: 'none',
                              fontSize: '0.8rem',
                              padding: '4px 8px',
                              border: '1px solid rgba(0,255,136,0.3)',
                              borderRadius: '4px'
                            }}
                          >
                            🎵 Preview
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '32px', color: '#b3b3b3' }}>
                  Generating suggestions...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Logs */}
        {showLogs && (
          <motion.div 
            className="logs-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            <h2>📋 Event Log</h2>
            <div style={{ 
              maxHeight: 200, 
              overflow: 'auto', 
              border: '1px solid rgba(255,255,255,0.1)', 
              borderRadius: 8, 
              padding: 8,
              background: 'rgba(0,0,0,0.3)'
            }}>
              {logs.length === 0 ? (
                <div style={{ color: '#b3b3b3', fontStyle: 'italic', textAlign: 'center', padding: 16 }}>
                  No events logged yet
                </div>
              ) : (
                logs.slice().reverse().map((log, index) => (
                  <div key={index} style={{ 
                    padding: '4px 0', 
                    borderBottom: index < logs.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    fontSize: '0.85rem'
                  }}>
                    <span style={{ 
                      color: log.level === 'error' ? '#ff6b6b' : log.level === 'warn' ? '#ffc107' : '#b3b3b3',
                      marginRight: 8
                    }}>
                      [{new Date(log.ts).toLocaleTimeString()}]
                    </span>
                    <span style={{ color: '#fff' }}>{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};

export default HostView;

