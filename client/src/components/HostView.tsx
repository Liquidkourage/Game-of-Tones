import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Play, 
  Pause, 
  SkipForward, 
  Music, 
  Trophy,
  Plus
} from 'lucide-react';
import io from 'socket.io-client';
import { API_BASE, SOCKET_URL } from '../config';
import { BingoPattern, PATTERN_OPTIONS, BINGO_PATTERNS, getPatternDisplayName, getSavedCustomPatterns, saveCustomPattern, SavedCustomPattern } from '../patternDefinitions';
import CustomPatternModal from './CustomPatternModal';
import SongTitleEditModal from './SongTitleEditModal';
import SongReplacementModal from './SongReplacementModal';
import RoundPlanner from './RoundPlanner';
import { cleanSongTitle } from '../utils/songTitleCleaner';
import { validateSongTitle, validateSongTitleSync, getValidationMessage, getValidationColor } from '../utils/songTitleValidator';

interface Playlist {
  id: string;
  name: string;
  tracks: number;
  description?: string;
  public?: boolean;
  collaborative?: boolean;
  owner?: string;
}

interface GotPlaylist {
  id: string;
  name: string;
  trackCount: number;
  createdAt: string;
  description: string;
  external_urls?: {
    spotify: string;
  };
}

interface Song {
  id: string;
  name: string;
  artist: string;
  duration?: number; // Make duration optional
  sourcePlaylistId?: string;
  sourcePlaylistName?: string;
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
  const [randomStarts, setRandomStarts] = useState<'none' | 'early' | 'random'>(() => {
    const saved = localStorage.getItem('game-random-starts');
    return (saved as 'none' | 'early' | 'random') || 'none';
  });
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [playedSoFar, setPlayedSoFar] = useState<Array<{ id: string; name: string; artist: string }>>([]);
  const [logs, setLogs] = useState<Array<{ level: 'info' | 'warn' | 'error'; message: string; ts: number }>>([]);
  const [revealMode, setRevealMode] = useState<'off' | 'artist' | 'title' | 'full'>('off');
  const [pattern, setPattern] = useState<BingoPattern>('line');
  const [selectedCustomPattern, setSelectedCustomPattern] = useState<SavedCustomPattern | null>(null);
  const [savedCustomPatterns, setSavedCustomPatterns] = useState<SavedCustomPattern[]>([]);
  const [showCustomPatternModal, setShowCustomPatternModal] = useState<boolean>(false);
  
  // Song title editing
  const [showSongTitleModal, setShowSongTitleModal] = useState(false);
  const [editingSong, setEditingSong] = useState<{id: string, title: string, artist: string} | null>(null);
  const [showSongReplacementModal, setShowSongReplacementModal] = useState(false);
  const [replacingSong, setReplacingSong] = useState<{id: string, name: string, artist: string, sourcePlaylistName?: string} | null>(null);
  const [customSongTitles, setCustomSongTitles] = useState<Record<string, string>>({});
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
  const [customPattern, setCustomPattern] = useState<string[]>([]);
  const [showSongList, setShowSongList] = useState(false);
  const [playedInOrder, setPlayedInOrder] = useState<Array<{ id: string; name: string; artist: string }>>([]);
  const [superStrict, setSuperStrict] = useState<boolean>(false);
  const [showAllControls, setShowAllControls] = useState<boolean>(false);
  const [showRooms, setShowRooms] = useState<boolean>(false);
  const [rooms, setRooms] = useState<Array<any>>([]);
  const [showPlayerCards, setShowPlayerCards] = useState<boolean>(true);
  const [playerCards, setPlayerCards] = useState<Map<string, any>>(new Map());
  const [playerCardsVersion, setPlayerCardsVersion] = useState<number>(0); // Force re-render trigger
  const [showRoundManager, setShowRoundManager] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'setup' | 'play'>('setup');
  
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
  
  // License key management
  const [licenseKey, setLicenseKey] = useState<string>(() => {
    const saved = localStorage.getItem('tempo-license-key');
    return saved || '';
  });
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [isJoiningRoom, setIsJoiningRoom] = useState<boolean>(false);
  const [isLicenseValidated, setIsLicenseValidated] = useState<boolean>(false);
  const [showLicenseModal, setShowLicenseModal] = useState<boolean>(false);

  const addLog = (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    setLogs(prev => [{ level, message, ts: Date.now() }, ...prev].slice(0, 50));
  };

  // Show toast notification to host
  const showToast = (message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const toast = document.createElement('div');
    const icons = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌' };
    const colors = { 
      info: '#00aaff', 
      success: '#00ff88', 
      warn: '#ffaa00', 
      error: '#ff4444' 
    };
    
    toast.textContent = `${icons[type]} ${message}`;
    Object.assign(toast.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      background: colors[type],
      color: type === 'warn' ? '#000' : '#fff',
      padding: '12px 20px',
      borderRadius: '8px',
      fontWeight: 'bold',
      fontSize: '14px',
      zIndex: '10000',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      animation: 'slideIn 0.3s ease-out'
    });
    
    document.body.appendChild(toast);
    setTimeout(() => { 
      try { 
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => document.body.removeChild(toast), 300);
      } catch {} 
    }, 3000);
  };

  // Handle license key changes
  const handleLicenseKeyChange = useCallback((newLicenseKey: string) => {
    setLicenseKey(newLicenseKey);
    localStorage.setItem('tempo-license-key', newLicenseKey);
    
    // Reset validation state when key changes
    if (newLicenseKey !== licenseKey) {
      setIsLicenseValidated(false);
    }
    
    // If we have a socket and room, try to rejoin with new license key
    if (socket && roomId && newLicenseKey.trim()) {
      console.log('🔑 Attempting to join room with license key:', newLicenseKey.trim());
      setIsJoiningRoom(true);
      setLicenseError(null);
      socket.emit('join-room', { roomId, playerName: 'Host', isHost: true, licenseKey: newLicenseKey.trim() });
      
      // Add timeout fallback in case server doesn't respond
      setTimeout(() => {
        if (isJoiningRoom) {
          console.log('⏰ Join timeout - clearing connecting state');
          setIsJoiningRoom(false);
          setLicenseError('Connection timeout. Please try again.');
        }
      }, 10000); // 10 second timeout
    }
  }, [socket, roomId, isJoiningRoom, licenseKey]);

  // Handle license key update/change
  const handleUpdateLicense = useCallback(() => {
    setShowLicenseModal(true);
  }, []);

  // Advanced playback states
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 100, // Always start at 100% volume
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
  const [profiles, setProfiles] = useState<Array<{ name: string; snippet: number; random: boolean | 'none' | 'early' | 'random'; window: number }>>(() => {
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
  const persistProfiles = (list: Array<{ name: string; snippet: number; random: boolean | 'none' | 'early' | 'random'; window: number }>) => {
    setProfiles(list as Array<{ name: string; snippet: number; random: boolean | 'none' | 'early' | 'random'; window: number }>);
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
    // Handle migration from old boolean values to new string values
    if (typeof p.random === 'boolean') {
      setRandomStarts(p.random ? 'random' : 'none');
    } else {
      setRandomStarts(p.random);
    }
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

    // Load saved custom patterns
    setSavedCustomPatterns(getSavedCustomPatterns());
    
    // Request all custom song titles
    if (socket) {
      socket.emit('get-all-custom-titles');
    }

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

    // Bingo verification handlers
    newSocket.on('bingo-verification-needed', (data: any) => {
      console.log('🔔 Bingo verification needed:', data);
      setPendingVerification(data);
      addLog(`🎯 ${data.playerName} called BINGO - verification needed!`, 'warn');
    });

    newSocket.on('bingo-verified', (data: any) => {
      console.log('✅ Bingo verified:', data);
      setPendingVerification(null);
      setIsProcessingVerification(false);
      if (data.approved) {
        addLog(`✅ Bingo approved for ${data.playerName}`, 'info');
      } else {
        addLog(`❌ Bingo rejected for ${data.playerName}: ${data.reason}`, 'warn');
      }
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
      
      // Sync volume when song starts playing to ensure it matches interface
      setTimeout(() => {
        syncVolumeToSpotify();
      }, 500);
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
      // Sync volume after resume to ensure it matches interface
      setTimeout(() => {
        syncVolumeToSpotify();
      }, 500);
    });

    // Custom song title events
    newSocket.on('custom-song-title-updated', (data: any) => {
      setCustomSongTitles(prev => ({
        ...prev,
        [data.songId]: data.customTitle
      }));
    });

    newSocket.on('all-custom-titles-response', (data: any) => {
      setCustomSongTitles(data);
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

    newSocket.on('song-replaced', (data: any) => {
      console.log('Song replaced:', data);
      // Update the song list with the new song
      setSongList(prev => {
        const newList = [...prev];
        const index = newList.findIndex(s => s.id === data.oldSongId);
        if (index !== -1) {
          newList[index] = data.newSong;
        }
        return newList;
      });
      
      // Update finalized order if it exists
      setFinalizedOrder(prev => {
        if (!prev) return prev;
        const newOrder = [...prev];
        const index = newOrder.findIndex(s => s.id === data.oldSongId);
        if (index !== -1) {
          newOrder[index] = data.newSong;
        }
        return newOrder;
      });
      
      addLog(`Song replaced: ${data.newSong.name} by ${data.newSong.artist}`, 'info');
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
      setRandomStarts('none');
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

    // Listen for pattern updates
    newSocket.on('pattern-updated', (data: any) => {
      if (data?.pattern) {
        setPattern(data.pattern);
        addLog(`Pattern updated to ${data.pattern}`, 'info');
      }
    });

    // Listen for player card updates
    newSocket.on('player-cards-update', (data: any) => {
      try {
        console.log('📋 Received player-cards-update:', data);
        if (data && typeof data === 'object') {
          const newPlayerCards = new Map();
          Object.entries(data).forEach(([playerId, cardData]: [string, any]) => {
            if (cardData && cardData.card) {
              console.log(`📋 Host received player card for ${cardData.playerName}:`, {
                playedSongs: cardData.playedSongs,
                playedSongsLength: cardData.playedSongs?.length || 0,
                cardSquares: cardData.card.squares?.length || 0
              });
              newPlayerCards.set(playerId, {
                playerName: cardData.playerName || 'Unknown',
                card: cardData.card,
                playedSongs: cardData.playedSongs || [] // Ensure playedSongs is included
              });
            }
          });
          console.log('📋 Setting playerCards to:', newPlayerCards.size, 'cards');
          console.log('📋 Previous playerCards size:', playerCards.size);
          console.log('📋 showPlayerCards state:', showPlayerCards);
          console.log('📋 Render condition will be:', showPlayerCards && newPlayerCards.size > 0);
          
          // Only update if data actually changed to prevent unnecessary re-renders
          const hasChanged = playerCards.size !== newPlayerCards.size || 
            Array.from(newPlayerCards.keys()).some(id => {
              const old = playerCards.get(id);
              const updated = newPlayerCards.get(id);
              if (!old) return true;
              // Compare playedSongs length as a quick check
              return (old.playedSongs?.length || 0) !== (updated?.playedSongs?.length || 0);
            });
          
          if (hasChanged) {
            setPlayerCards(newPlayerCards);
            // Only increment version on actual data changes, not on every song update
            // This prevents the visual flash when only playedSongs updates
          }
          
          // Show toast notification
          if (newPlayerCards.size > 0) {
            showToast(`Player cards loaded: ${newPlayerCards.size} players`, 'success');
          }
          
          // Force a check after state update
          setTimeout(() => {
            const element = document.querySelector('.player-cards-section');
            console.log('📋 Post-update DOM check:', element ? 'FOUND' : 'NOT FOUND');
            if (!element && newPlayerCards.size > 0) {
              showToast('Player cards not rendering - check console', 'error');
            }
          }, 200); // Increased timeout for re-render
        } else {
          console.log('📋 No valid player cards data received');
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
      if (reason !== 'io client disconnect') {
        showToast('Connection lost - reconnecting...', 'warn');
      }
    });
    newSocket.io.on('reconnect_attempt', (attempt) => {
      console.log(`Reconnecting socket (attempt ${attempt})...`);
    });
    newSocket.io.on('reconnect', () => {
      console.log('Socket reconnected. Refreshing Spotify status and devices.');
      showToast('Connection restored', 'success');
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
        // Re-request player cards after reconnection to restore UI state
        setTimeout(() => {
          showToast('Reloading player cards...', 'info');
          requestPlayerCards();
        }, 1000);
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
      const type = data?.type || 'general';
      const suggestions = data?.suggestions || [];
      
      console.error('Playback error:', msg);
      setSpotifyError(msg);
      
      if (type === 'restriction' && suggestions.length > 0) {
        const suggestionText = suggestions.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n');
        alert(`${msg}\n\nPossible solutions:\n${suggestionText}\n\nTip: Ensure Spotify is open and active on your chosen device, then use "Transfer Playback" or click Force Detection.`);
      } else {
        alert(msg + '\n\nTip: Ensure Spotify is open and active on your chosen device, then use "Transfer Playback" or click Force Detection.');
      }
      
      addLog(`Playback error: ${msg}`, 'error');
    });

    newSocket.on('playback-warning', (data: any) => {
      const msg = data?.message || 'Playback warning occurred';
      const type = data?.type || 'general';
      const suggestions = data?.suggestions || [];
      
      console.warn('Playback warning:', msg);
      setShowLogs(true);
      addLog(`Playback warning: ${msg}`, 'warn');
      
      // Show helpful suggestions for restriction warnings
      if (type === 'restriction' && suggestions.length > 0) {
        const suggestionText = suggestions.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n');
        console.log(`Restriction suggestions:\n${suggestionText}`);
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
      }
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

    // Handle join errors (license key validation)
    newSocket.on('join-error', (data: any) => {
      console.log('Join error:', data);
      setLicenseError(data.error || 'Failed to join room');
      setIsJoiningRoom(false);
    });

    // Handle successful room join
    newSocket.on('room-joined', (data: any) => {
      console.log('Successfully joined room:', data);
      setIsJoiningRoom(false);
      setLicenseError(null);
      setIsLicenseValidated(true);
      setShowLicenseModal(false);
      addLog(`Joined room ${roomId} successfully`, 'info');
      
      // Force check Spotify status after joining room
      setTimeout(async () => {
        console.log('🔄 Rechecking Spotify status after room join...');
        try {
          const cacheBuster = Date.now();
          const response = await fetch(`${API_BASE || ''}/api/spotify/status?_=${cacheBuster}`);
          const data = await response.json();
          console.log('📡 Recheck response:', data);
          console.log('📡 Recheck response details:', JSON.stringify(data, null, 2));
          
          if (data.connected) {
            console.log('✅ Spotify found connected after room join!');
            setIsSpotifyConnected(true);
            setIsSpotifyConnecting(false);
          }
        } catch (error) {
          console.error('Error rechecking Spotify status:', error);
        }
      }, 1000);
    });

    // Join room as host (license validation temporarily disabled)
    if (roomId) {
      console.log('🔓 License validation disabled - joining room directly');
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
          
          // Sync volume when Spotify connects to ensure it matches interface
          setTimeout(() => {
            syncVolumeToSpotify();
          }, 1000);
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
      
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg) {
        if (errorMsg.includes('Spotify not connected')) {
          errorMessage = '🎵 Spotify Connection Required';
          errorDetails = 'Please connect to Spotify first using the "Connect Spotify" button, then try getting suggestions again.';
        } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
          errorMessage = '🌐 Network Connection Error';
          errorDetails = 'Unable to reach the server. Please check your internet connection and make sure the server is running.';
        } else if (errorMsg.includes('401')) {
          errorMessage = '🔐 Authentication Error';
          errorDetails = 'Your Spotify session may have expired. Please reconnect to Spotify and try again.';
        } else if (errorMsg.includes('500')) {
          errorMessage = '🔥 Server Error';
          errorDetails = 'The server encountered an error while generating suggestions. Please try again in a moment.';
        } else if (errorMsg.includes('HTML error page') || errorMsg.includes('DOCTYPE')) {
          errorMessage = '🔄 Server Restart Required';
          errorDetails = 'The server appears to be restarting or crashed. Please wait a moment for it to fully start up, then try again.';
        } else {
          errorMessage = '❌ Suggestion Generation Failed';
          errorDetails = `Error: ${errorMsg}. Please check the console for more details.`;
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
      // Check if songs have playlist information, if not regenerate
      const needsRegeneration = songList.length > 0 && !songList[0]?.sourcePlaylistId;
      if (needsRegeneration) {
        console.log('🔄 Songs missing playlist info, regenerating...');
        await generateSongList();
        // Wait a moment for the song list to update
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log('📋 Finalizing mix with songList:', {
        length: songList.length,
        hasPlaylistInfo: songList.length > 0 ? !!songList[0]?.sourcePlaylistId : false,
        firstSong: songList.length > 0 ? {
          id: songList[0].id,
          name: songList[0].name,
          sourcePlaylistId: songList[0].sourcePlaylistId,
          sourcePlaylistName: songList[0].sourcePlaylistName
        } : null
      });
      
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
        
        // Request player cards immediately after finalization so host can see them pre-game
        setTimeout(() => {
          requestPlayerCards();
        }, 500); // Small delay to ensure cards are fully generated and sent to players
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
      
      // Request player cards immediately when game starts
      setTimeout(() => {
        requestPlayerCards();
      }, 1000); // Small delay to ensure game is fully started
      
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

  const requestPlayerCards = () => {
    if (!socket || !roomId) {
      console.log('❌ Cannot request player cards: socket or roomId missing', { socket: !!socket, roomId });
      showToast('Cannot request cards - not connected', 'error');
      return;
    }
    console.log('🔍 Requesting player cards for room:', roomId);
    console.log('🔍 Current playerCards state:', { size: playerCards.size, showPlayerCards });
    socket.emit('request-player-cards', { roomId });
    showToast('Requesting player cards...', 'info');
    addLog('Requested player cards', 'info');
  };

  // Calculate win progress for a player's card based on actual patterns
  const calculateWinProgress = (card: any, currentPattern: string, playedSongs: string[] = []) => {
    if (!card || !card.squares) return { marked: 0, legitimate: 0, needed: 5, progress: 0, patternProgress: 0 };
    
    const squares = card.squares;
    let markedCount = 0;
    let legitimateMarkedCount = 0;
    
    // Count all marked squares and legitimate marks
    squares.forEach((square: any) => {
      if (square.marked) {
        markedCount++;
        if (playedSongs.includes(square.songId)) {
          legitimateMarkedCount++;
        }
      }
    });
    
    // Helper function to check if a square is legitimately marked
    const isLegitimatelyMarked = (square: any) => {
      return square.marked && playedSongs.includes(square.songId);
    };
    
    // Calculate pattern-specific progress
    let patternProgress = 0;
    let totalNeeded = 5;
    let bestProgress = 0;
    
    if (currentPattern === 'line') {
      // Check rows, columns, and diagonals for the best progress
      let maxProgress = 0;
      
      // Check rows
      for (let row = 0; row < 5; row++) {
        let rowProgress = 0;
        for (let col = 0; col < 5; col++) {
          const square = squares.find((s: any) => s.position === `${row}-${col}`);
          if (square && isLegitimatelyMarked(square)) {
            rowProgress++;
          }
        }
        maxProgress = Math.max(maxProgress, rowProgress);
      }
      
      // Check columns
      for (let col = 0; col < 5; col++) {
        let colProgress = 0;
        for (let row = 0; row < 5; row++) {
          const square = squares.find((s: any) => s.position === `${row}-${col}`);
          if (square && isLegitimatelyMarked(square)) {
            colProgress++;
          }
        }
        maxProgress = Math.max(maxProgress, colProgress);
      }
      
      // Check diagonals
      let diag1Progress = 0;
      let diag2Progress = 0;
      for (let i = 0; i < 5; i++) {
        const square1 = squares.find((s: any) => s.position === `${i}-${i}`);
        const square2 = squares.find((s: any) => s.position === `${i}-${4-i}`);
        
        if (square1 && isLegitimatelyMarked(square1)) diag1Progress++;
        if (square2 && isLegitimatelyMarked(square2)) diag2Progress++;
      }
      maxProgress = Math.max(maxProgress, diag1Progress, diag2Progress);
      
      patternProgress = maxProgress;
      bestProgress = maxProgress;
    } else if (currentPattern === 'full_card') {
      patternProgress = legitimateMarkedCount;
      totalNeeded = 25;
      bestProgress = legitimateMarkedCount;
    } else if (currentPattern === 'four_corners') {
      const corners = ['0-0', '0-4', '4-0', '4-4'];
      let cornerProgress = 0;
      corners.forEach(pos => {
        const square = squares.find((s: any) => s.position === pos);
        if (square && isLegitimatelyMarked(square)) {
          cornerProgress++;
        }
      });
      patternProgress = cornerProgress;
      totalNeeded = 4;
      bestProgress = cornerProgress;
    } else if (currentPattern === 'x') {
      let xProgress = 0;
      for (let i = 0; i < 5; i++) {
        const square1 = squares.find((s: any) => s.position === `${i}-${i}`);
        const square2 = squares.find((s: any) => s.position === `${i}-${4-i}`);
        
        if (square1 && isLegitimatelyMarked(square1)) xProgress++;
        if (square2 && isLegitimatelyMarked(square2)) xProgress++;
      }
      patternProgress = xProgress;
      totalNeeded = 9;
      bestProgress = xProgress;
    } else if (currentPattern === 'custom') {
      // For custom patterns, we'd need the custom mask from the server
      // For now, fall back to line logic
      patternProgress = legitimateMarkedCount;
      bestProgress = legitimateMarkedCount;
    }
    
    const needed = Math.max(0, totalNeeded - bestProgress);
    const progress = totalNeeded > 0 ? Math.round((bestProgress / totalNeeded) * 100) : 0;
    
    return { 
      marked: markedCount, 
      legitimate: legitimateMarkedCount,
      needed, 
      progress,
      patternProgress: bestProgress,
      totalNeeded
    };
  };

  const forceRefreshAll = () => {
    if (!socket || !roomId) return;
    socket.emit('force-refresh', { roomId, reason: 'host-request' });
    addLog('Force refresh broadcast', 'warn');
  };

  const resetDisplayLetters = () => {
    if (!socket || !roomId) return;
    socket.emit('display-reset-letters', { roomId });
    showToast('Resetting letters on public display...', 'info');
    addLog('Display letters reset', 'info');
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


  const updatePattern = (next: BingoPattern) => {
    setPattern(next);
    if (socket && roomId) {
      socket.emit('set-pattern', { roomId, pattern: next, customMask });
      addLog(`Pattern set to ${next}`, 'info');
    }
  };

  const handleCustomPatternSelect = (customPattern: SavedCustomPattern) => {
    setSelectedCustomPattern(customPattern);
    setPattern('custom');
    setCustomPattern(customPattern.positions);
    if (socket && roomId) {
      socket.emit('set-pattern', { roomId, pattern: 'custom', customMask: customPattern.positions });
      addLog(`Custom pattern set to ${customPattern.name}`, 'info');
    }
  };

  const handleNewCustomPattern = () => {
    setShowCustomPatternModal(true);
  };

  const handleSaveCustomPattern = (patternData: { name: string; positions: string[] }) => {
    const savedPattern = saveCustomPattern(patternData);
    setSavedCustomPatterns(getSavedCustomPatterns());
    handleCustomPatternSelect(savedPattern);
    setShowCustomPatternModal(false);
  };

  // Song title editing functions
  const handleEditSongTitle = (song: {id: string, title: string, artist: string}) => {
    setEditingSong(song);
    setShowSongTitleModal(true);
  };

  const handleSaveSongTitle = (songId: string, customTitle: string) => {
    if (socket) {
      socket.emit('set-custom-song-title', { songId, customTitle });
    }
  };

  const handleReplaceSong = (song: {id: string, name: string, artist: string, sourcePlaylistName?: string}) => {
    setReplacingSong(song);
    setShowSongReplacementModal(true);
  };

  const handleSongReplaced = (newSongId: string) => {
    // The server will broadcast the change via socket, so we just need to close the modal
    setShowSongReplacementModal(false);
    setReplacingSong(null);
  };

  const getDisplaySongTitle = (songId: string, originalTitle: string) => {
    // If there's a custom title, use it; otherwise use auto-cleaned original title
    return customSongTitles[songId] || cleanSongTitle(originalTitle);
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
            resumePosition: pausePosition 
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
        if (isPlaying) {
          // Pause the song
          setPausePosition(playbackState.currentTime);
          setIsPausedByInterface(true);
          
          socket.emit('pause-song', { roomId });
          setIsPlaying(false);
          setPlaybackState(prev => ({ ...prev, isPlaying: false }));
          console.log(`⏸️ Paused song at position: ${playbackState.currentTime}ms`);
        } else {
          // Resume the song
          if (isPausedByInterface && currentSong) {
            console.log(`▶️ Resuming from exact pause position: ${pausePosition}ms`);
            socket.emit('resume-song', { 
              roomId, 
              resumePosition: pausePosition 
            });
            setIsPlaying(true);
            setPlaybackState(prev => ({ 
              ...prev, 
              isPlaying: true,
              currentTime: pausePosition 
            }));
            setIsPausedByInterface(false);
          } else {
            // Resume normally
            socket.emit('resume-song', { roomId });
            setIsPlaying(true);
            setPlaybackState(prev => ({ ...prev, isPlaying: true }));
            console.log('▶️ Resumed song');
          }
        }
      }
    } catch (error) {
      console.error('Error pausing/resuming song:', error);
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

  // Function to ensure Spotify volume matches interface volume
  const syncVolumeToSpotify = useCallback(async () => {
    if (!selectedDevice?.id) return;
    
    try {
      const currentVolume = playbackState.volume;
      console.log(`🔊 Syncing interface volume (${currentVolume}%) to Spotify`);
      
      const response = await fetch(`${API_BASE || ''}/api/spotify/volume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          volume: currentVolume,
          deviceId: selectedDevice.id,
          roomId: roomId
        })
      });
      
      if (response.ok) {
        console.log(`✅ Volume synced to Spotify: ${currentVolume}%`);
      } else {
        console.warn('⚠️ Failed to sync volume to Spotify');
      }
    } catch (error) {
      console.error('Error syncing volume to Spotify:', error);
    }
  }, [selectedDevice?.id, playbackState.volume, roomId]);

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

  // Manual resume game if stuck in paused state (recovery for missed verification modal)
  const handleManualResumeGame = useCallback(() => {
    if (!socket || !roomId) return;
    
    const confirmed = window.confirm(
      'Resume the game?\n\n' +
      'This will resume playback if the game is paused for verification.\n' +
      'Use this if you missed a bingo verification modal.'
    );
    
    if (confirmed) {
      socket.emit('manual-resume-game', { roomId });
      setPendingVerification(null); // Clear any stuck verification state
      setGamePaused(false);
      addLog('Manually resuming game', 'info');
    }
  }, [socket, roomId]);


  // Debounced volume change with strict synchronization
  const handleVolumeChange = useCallback(async (newVolume: number) => {
    // Clear any existing timeout
    if (volumeTimeout) {
      clearTimeout(volumeTimeout);
    }

    // Set local state immediately for responsive UI
    setPlaybackState(prev => ({ ...prev, volume: newVolume }));
    setIsMuted(false);
    
    // Don't persist volume to localStorage - always default to 100%

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

  // Bingo verification functions
  const approveBingo = useCallback(async () => {
    if (!socket || !pendingVerification) return;
    
    setIsProcessingVerification(true);
    socket.emit('verify-bingo', {
      roomId,
      playerId: pendingVerification.playerId,
      approved: true
    });
  }, [socket, roomId, pendingVerification]);

  const rejectBingo = useCallback(async (reason: string) => {
    if (!socket || !pendingVerification) return;
    
    setIsProcessingVerification(true);
    socket.emit('verify-bingo', {
      roomId,
      playerId: pendingVerification.playerId,
      approved: false,
      reason: reason || 'Invalid bingo pattern'
    });
  }, [socket, roomId, pendingVerification]);

  // Create output playlist
  const createOutputPlaylist = useCallback(async () => {
    if (!songList || songList.length === 0) {
      alert('No songs available to create playlist. Please finalize a mix first.');
      return;
    }

    const playlistName = prompt('Enter a name for your output playlist:', `Bingo ${roomId} - ${new Date().toLocaleDateString()}`);
    if (!playlistName) return;

    try {
      const trackIds = songList.map(song => song.id);
      const response = await fetch(`${API_BASE || ''}/api/spotify/create-output-playlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: playlistName,
          trackIds: trackIds,
          description: `Output playlist from TEMPO Music Bingo - Room ${roomId} - ${selectedPlaylists.map(p => p.name).join(', ')}`
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        addLog(`✅ Created output playlist: ${data.playlistName} (${data.trackCount} songs)`, 'info');
        alert(`Successfully created playlist: ${data.playlistName}\n\nIt will appear in your Spotify library under "Game Of Tones Output" playlists.`);
      } else {
        throw new Error(data.error || 'Failed to create playlist');
      }
    } catch (error) {
      console.error('Error creating output playlist:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog(`❌ Failed to create output playlist: ${errorMessage}`, 'error');
      alert(`Failed to create playlist: ${errorMessage}`);
    }
  }, [songList, roomId, selectedPlaylists, addLog]);

  // Playlist cleanup state
  const [showPlaylistCleanup, setShowPlaylistCleanup] = useState(false);
  const [gotPlaylists, setGotPlaylists] = useState<GotPlaylist[]>([]);
  const [selectedForDeletion, setSelectedForDeletion] = useState(new Set<string>());
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [isDeletingPlaylists, setIsDeletingPlaylists] = useState(false);

  // Load Game Of Tones playlists
  const loadGotPlaylists = useCallback(async () => {
    if (!isSpotifyConnected) {
      alert('Please connect Spotify first');
      return;
    }

    setIsLoadingPlaylists(true);
    try {
      const response = await fetch(`${API_BASE || ''}/api/spotify/got-playlists`);
      const data = await response.json();
      
      if (data.success) {
        setGotPlaylists(data.playlists);
        setSelectedForDeletion(new Set());
        addLog(`Found ${data.playlists.length} Game Of Tones output playlists`, 'info');
      } else {
        throw new Error(data.error || 'Failed to load playlists');
      }
    } catch (error) {
      console.error('Error loading Game Of Tones playlists:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog(`❌ Failed to load playlists: ${errorMessage}`, 'error');
      alert(`Failed to load playlists: ${errorMessage}`);
    } finally {
      setIsLoadingPlaylists(false);
    }
  }, [isSpotifyConnected, addLog]);

  // Delete selected playlists
  const deleteSelectedPlaylists = useCallback(async () => {
    if (selectedForDeletion.size === 0) {
      alert('Please select playlists to delete');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete ${selectedForDeletion.size} playlist(s)?\n\n` +
      'This action cannot be undone!'
    );

    if (!confirmed) return;

    setIsDeletingPlaylists(true);
    try {
      const playlistIds = Array.from(selectedForDeletion);
      const response = await fetch(`${API_BASE || ''}/api/spotify/delete-playlists`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ playlistIds }),
      });

      // Check if response is HTML (server error) instead of JSON
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        throw new Error('Server returned HTML error page instead of JSON. The server may have crashed or restarted.');
      }

      const data = await response.json();
      
      if (data.success) {
        addLog(`✅ Deleted ${data.deleted} playlists successfully`, 'info');
        if (data.failed > 0) {
          addLog(`⚠️ Failed to delete ${data.failed} playlists`, 'warn');
        }
        
        // Refresh the list
        await loadGotPlaylists();
        
        alert(`Successfully deleted ${data.deleted} playlist(s)${data.failed > 0 ? `\n${data.failed} failed to delete` : ''}`);
      } else {
        throw new Error(data.error || 'Failed to delete playlists');
      }
    } catch (error) {
      console.error('Error deleting playlists:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog(`❌ Failed to delete playlists: ${errorMessage}`, 'error');
      alert(`Failed to delete playlists: ${errorMessage}`);
    } finally {
      setIsDeletingPlaylists(false);
    }
  }, [selectedForDeletion, loadGotPlaylists, addLog]);

  // Toggle playlist selection
  const togglePlaylistSelection = useCallback((playlistId: string) => {
    setSelectedForDeletion(prev => {
      const newSet = new Set(prev);
      if (newSet.has(playlistId)) {
        newSet.delete(playlistId);
      } else {
        newSet.add(playlistId);
      }
      return newSet;
    });
  }, []);

  // Select all/none playlists
  const selectAllPlaylists = useCallback((selectAll: boolean) => {
    if (selectAll) {
      setSelectedForDeletion(new Set(gotPlaylists.map(p => p.id)));
    } else {
      setSelectedForDeletion(new Set());
    }
  }, [gotPlaylists]);

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
        <div className="host-content" style={{ paddingBottom: currentSong ? '450px' : '20px' }}>
          {/* Tab Navigation */}
          <div className="tab-navigation" style={{
            display: 'flex',
            gap: 2,
            marginBottom: 20,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            paddingBottom: 0
          }}>
            {[
              { id: 'setup', label: '🎯 Manager', desc: 'Setup & Management' },
              { id: 'play', label: '🎮 Game', desc: 'Live Game Controls' }
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
                {/* License Status - TEMPORARILY HIDDEN */}
                {false && (
                  <div style={{ display: 'none' }}>License validation disabled for tonight</div>
                )}

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

          {/* Pattern Selection */}
          {isSpotifyConnected && (
            <motion.div 
              className="pattern-section"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <h2>🎯 Bingo Pattern</h2>
              <div className="pattern-selection">
                {/* Main Pattern Options */}
                <div className="main-pattern-options" style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '16px' }}>
                  <button
                    className={`pattern-option ${pattern === 'line' ? 'active' : ''}`}
                    onClick={() => updatePattern('line')}
                    style={{
                      padding: '12px 20px',
                      border: pattern === 'line' ? '2px solid #00ff88' : '1px solid rgba(255,255,255,0.3)',
                      borderRadius: '8px',
                      background: pattern === 'line' ? 'rgba(0,255,136,0.1)' : 'rgba(255,255,255,0.05)',
                      color: pattern === 'line' ? '#00ff88' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      minWidth: '120px'
                    }}
                  >
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Line</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.8, textAlign: 'center' }}>Any row, column, or diagonal</div>
                  </button>
                  
                  <button
                    className={`pattern-option ${pattern === 'full_card' ? 'active' : ''}`}
                    onClick={() => updatePattern('full_card')}
                    style={{
                      padding: '12px 20px',
                      border: pattern === 'full_card' ? '2px solid #00ff88' : '1px solid rgba(255,255,255,0.3)',
                      borderRadius: '8px',
                      background: pattern === 'full_card' ? 'rgba(0,255,136,0.1)' : 'rgba(255,255,255,0.05)',
                      color: pattern === 'full_card' ? '#00ff88' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      minWidth: '120px'
                    }}
                  >
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Full Card</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.8, textAlign: 'center' }}>All 25 squares</div>
                  </button>
                </div>

                {/* Custom Pattern Section */}
                <div className="custom-pattern-section" style={{ textAlign: 'center' }}>
                  <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                    <select
                      value={selectedCustomPattern?.id || ''}
                      onChange={(e) => {
                        const patternId = e.target.value;
                        if (patternId) {
                          const customPattern = savedCustomPatterns.find(p => p.id === patternId);
                          if (customPattern) {
                            handleCustomPatternSelect(customPattern);
                          }
                        }
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.3)',
                        background: 'rgba(0,0,0,0.3)',
                        color: '#ffffff',
                        fontSize: '0.9rem',
                        minWidth: '200px'
                      }}
                    >
                      <option value="">Select Custom Pattern...</option>
                      {savedCustomPatterns.map((customPattern) => (
                        <option key={customPattern.id} value={customPattern.id}>
                          {customPattern.name}
                        </option>
                      ))}
                    </select>
                    
                    <button
                      onClick={handleNewCustomPattern}
                      style={{
                        padding: '8px 16px',
                        borderRadius: '6px',
                        border: '1px solid #00ff88',
                        background: 'rgba(0,255,136,0.1)',
                        color: '#00ff88',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <Plus size={16} />
                      New Custom Pattern
                    </button>
                  </div>
                </div>
              </div>
                <div style={{ marginTop: '8px', fontSize: '0.9rem', color: '#b3b3b3' }}>
                  Current pattern: <strong style={{ color: '#00ff88' }}>
                    {pattern === 'custom' && selectedCustomPattern 
                      ? selectedCustomPattern.name 
                      : getPatternDisplayName(pattern)}
                  </strong>
                  {pattern === 'custom' && selectedCustomPattern && (
                    <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#b3b3b3' }}>
                      Pattern: {selectedCustomPattern.positions.length} squares selected
                    </div>
                  )}
              </div>
            </motion.div>
          )}

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
                          // Insufficient: < 15 songs (not enough for any mode)
                          const isInsufficient = p.tracks < 15;
                          // Acceptable: 15+ songs (good for 5x15 mode) and 75+ songs (good for both modes)
                          const isAcceptable = p.tracks >= 15;
                          
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
                                backgroundColor: isAcceptable ? 'rgba(0, 255, 136, 0.1)' : 'transparent',
                                border: isAcceptable ? '1px solid rgba(0, 255, 136, 0.3)' : 'none',
                                borderRadius: isAcceptable ? '4px' : '0',
                                margin: isAcceptable ? '2px 0' : '0',
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
                                color: isAcceptable ? '#00ff88' : '#fff'
                              }}>
                                {stripGoTPrefix ? p.name.replace(/^GoT\s*[-–:]*\s*/i, '') : p.name}
                              </span>
                              <span style={{ 
                                fontSize: '0.8rem', 
                                opacity: 0.7,
                                color: isAcceptable ? '#00ff88' : '#b3b3b3'
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
                                  title="Get AI suggestions to reach 15+ songs"
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

                {/* Round Management Controls - Moved from Monitor Tab */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="bg-rgba(42, 42, 42, 0.95) backdrop-blur-[20px] border border-rgba(0, 255, 136, 0.3) rounded-2xl p-6 mb-6"
                >
                  <h2>🎯 Round Management Controls</h2>
                  
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
                </motion.div>

                {/* Display Controls */}
                <motion.div
                  className="display-controls-section"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '20px',
                    marginTop: '20px'
                  }}
                >
                  <h3 style={{ 
                    color: '#00ffa3', 
                    fontSize: '1.2rem', 
                    fontWeight: '600', 
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    🖥️ Display Controls
                  </h3>
                  <p style={{ 
                    color: 'rgba(255,255,255,0.7)', 
                    fontSize: '0.9rem', 
                    marginBottom: '16px',
                    lineHeight: '1.4'
                  }}>
                    Control what's displayed on the public screen for players.
                  </p>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <button 
                      className="btn-secondary" 
                      onClick={() => socket?.emit('display-show-rules', { roomId })}
                      style={{ 
                        fontSize: '0.9rem', 
                        padding: '10px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      📋 Rules
                    </button>
                    <button 
                      className="btn-secondary" 
                      onClick={() => socket?.emit('display-show-splash', { roomId })}
                      style={{ 
                        fontSize: '0.9rem', 
                        padding: '10px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      🎬 Splash
                    </button>
                    <button 
                      className="btn-secondary" 
                      onClick={() => socket?.emit('display-show-call-list', { roomId })}
                      style={{ 
                        fontSize: '0.9rem', 
                        padding: '10px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      🎵 Call List
                    </button>
                  </div>
                </motion.div>

                {/* Playlist Management */}
                <motion.div
                  className="playlist-management-section"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '20px',
                    marginTop: '20px'
                  }}
                >
                  <h3 style={{ 
                    color: '#00ffa3', 
                    fontSize: '1.2rem', 
                    fontWeight: '600', 
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    🎵 Playlist Management
                  </h3>
                  <p style={{ 
                    color: 'rgba(255,255,255,0.7)', 
                    fontSize: '0.9rem', 
                    marginBottom: '16px',
                    lineHeight: '1.4'
                  }}>
                    Manage playlists and create output playlists from your game sessions.
                  </p>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                      onClick={createOutputPlaylist}
                      disabled={!songList || songList.length === 0 || isSpotifyConnecting}
                      className="btn-secondary"
                      style={{
                        backgroundColor: '#6b46c1',
                        borderColor: '#8b5cf6',
                        color: 'white',
                        fontSize: '0.9rem',
                        padding: '10px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      📁 Create Output Playlist
                    </button>
                    <button
                      onClick={() => setShowPlaylistCleanup(true)}
                      disabled={isSpotifyConnecting}
                      className="btn-secondary"
                      style={{
                        backgroundColor: '#dc2626',
                        borderColor: '#ef4444',
                        color: 'white',
                        fontSize: '0.9rem',
                        padding: '10px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      🗑️ Cleanup Playlists
                    </button>
                  </div>
                </motion.div>
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
                            checked={randomStarts === 'none'}
                            onChange={() => {
                              setRandomStarts('none');
                              localStorage.setItem('game-random-starts', 'none');
                            }}
                          />
                          <span>From beginning</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="radio"
                            name="startPosition"
                            checked={randomStarts === 'early'}
                            onChange={() => {
                              setRandomStarts('early');
                              localStorage.setItem('game-random-starts', 'early');
                            }}
                          />
                          <span>Early random (first 90s)</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="radio"
                            name="startPosition"
                            checked={randomStarts === 'random'}
                            onChange={() => {
                              setRandomStarts('random');
                              localStorage.setItem('game-random-starts', 'random');
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
                        {randomStarts === 'none' 
                          ? `Each track will play for ${snippetLength} seconds starting from the beginning`
                          : randomStarts === 'early'
                          ? `Each track will play for ${snippetLength} seconds starting from a random position within the first 90 seconds`
                          : `Each track will play for ${snippetLength} seconds starting from a random position (avoiding the last 30+ seconds)`
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
                  {gamePaused && (
                    <div style={{ 
                      background: 'rgba(255, 170, 0, 0.2)', 
                      border: '2px solid #ffaa00', 
                      borderRadius: '8px', 
                      padding: '12px', 
                      marginBottom: '12px',
                      textAlign: 'center'
                    }}>
                      <p style={{ color: '#ffaa00', fontWeight: 'bold', marginBottom: '8px' }}>
                        ⚠️ Game is PAUSED
                      </p>
                      <p style={{ color: '#fff', fontSize: '0.9rem', marginBottom: '8px' }}>
                        {pendingVerification 
                          ? `Waiting for bingo verification: ${pendingVerification.playerName}`
                          : 'Game paused - waiting for action'}
                      </p>
                      <button 
                        className="btn-secondary" 
                        onClick={handleManualResumeGame}
                        style={{ 
                          background: '#00ff88', 
                          borderColor: '#00ff88',
                          color: '#000',
                          fontWeight: 'bold'
                        }}
                      >
                        ▶️ Resume Game
                      </button>
                    </div>
                  )}
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
                    <button 
                      className="btn-secondary" 
                      onClick={resetDisplayLetters}
                      style={{ 
                        backgroundColor: '#ffaa00', 
                        borderColor: '#ffaa00',
                        color: '#000',
                        fontWeight: 'bold',
                        marginLeft: '12px'
                      }}
                      title="Reset revealed letters on public display (fixes stuck letters)"
                    >
                      🔤 Reset Letters
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <button className="btn-secondary" onClick={forceRefreshAll}>🧹 Force Refresh Clients</button>
                    <button 
                      className="btn-secondary" 
                      onClick={requestPlayerCards}
                      style={{ 
                        backgroundColor: '#ff6b35', 
                        borderColor: '#ff6b35',
                        color: 'white',
                        fontWeight: 'bold'
                      }}
                    >
                      🔍 Request Player Cards
                    </button>
                    <button
                      onClick={requestPlayerCards}
                      className="btn-secondary"
                      style={{ 
                        backgroundColor: '#ff6b35', 
                        borderColor: '#ff6b35',
                        color: 'white',
                        fontWeight: 'bold',
                        marginRight: '8px'
                      }}
                    >
                      🔍 Request Player Cards ({playerCards.size})
                    </button>
                    {playerCards.size > 0 && (
                      <button 
                        className="btn-secondary" 
                        onClick={() => setShowPlayerCards(!showPlayerCards)}
                        title={showPlayerCards ? "Hide player bingo cards" : "Show player bingo cards and progress"}
                        style={{ 
                          backgroundColor: showPlayerCards ? '#ff6b35' : '#00ffa3', 
                          borderColor: showPlayerCards ? '#ff6b35' : '#00ffa3',
                          color: showPlayerCards ? 'white' : 'black',
                          fontWeight: 'bold'
                        }}
                      >
                        {showPlayerCards ? "👥 Hide Player Cards" : "👥 Show Player Cards"}
                      </button>
                    )}
                  </div>
                 </div>
               )}
             </div>
           </motion.div>

                {/* Debug Info */}
                <div style={{ 
                  background: 'rgba(255,0,0,0.1)', 
                  border: '1px solid rgba(255,0,0,0.3)', 
                  padding: '10px', 
                  margin: '10px 0',
                  fontSize: '0.8rem',
                  color: '#ff6666'
                }}>
                  DEBUG: songList.length = {songList.length}, finalizedOrder?.length = {finalizedOrder?.length}
                  <br />
                  Condition: {(songList.length > 0 || (finalizedOrder?.length ?? 0) > 0) ? 'TRUE' : 'FALSE'}
                  <br />
                  mixFinalized = {mixFinalized ? 'true' : 'false'}
                </div>

                {/* Finalized Playlist Display */}
                {(songList.length > 0 || (finalizedOrder?.length ?? 0) > 0 || mixFinalized) && (
                  <motion.div
                    className="finalized-playlist-section"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      padding: '20px',
                      marginTop: '20px'
                    }}
                  >
                    <h3 style={{
                      color: '#00ffa3',
                      fontSize: '1.2rem',
                      fontWeight: '600',
                      marginBottom: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      🎵 Finalized Playlist ({songList.length || finalizedOrder?.length || 0} songs)
                    </h3>
                    <p style={{
                      color: 'rgba(255,255,255,0.7)',
                      fontSize: '0.9rem',
                      marginBottom: '16px',
                      lineHeight: '1.4'
                    }}>
                      These are the songs that will be used in your bingo game. You can edit titles to make them more recognizable for players.
                    </p>
                    
                    <div style={{
                      maxHeight: '400px',
                      overflowY: 'auto',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      background: 'rgba(0,0,0,0.2)'
                    }}>
                      {(finalizedOrder || songList).map((song: any, index: number) => {
                        const displayTitle = getDisplaySongTitle(song.id, song.name);
                        const validation = validateSongTitleSync(displayTitle, song.name);
                        const validationColor = getValidationColor(validation);
                        const validationMessage = getValidationMessage(validation);
                        
                        return (
                          <div 
                            key={song.id} 
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              padding: '12px',
                              borderBottom: index < (finalizedOrder || songList).length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                              fontSize: '0.9rem',
                              // Highlight problematic titles
                              background: validation.confidence < 0.7 ? 'rgba(255,68,68,0.1)' : 'transparent',
                              borderLeft: validation.confidence < 0.7 ? `3px solid ${validationColor}` : '3px solid transparent',
                              borderRadius: '4px',
                              margin: '2px 0',
                              cursor: 'help'
                            }}
                            title={`Song Title Comparison:
                            
Original: "${song.name}"
Cleaned: "${displayTitle}"
${customSongTitles[song.id] ? 'Custom: "' + customSongTitles[song.id] + '"' : ''}

${validationMessage}
${validation.warnings.length > 0 ? '\nWarnings: ' + validation.warnings.join('; ') : ''}
${validation.suggestions.length > 0 ? '\nSuggestions: ' + validation.suggestions.slice(0, 3).join('; ') : ''}

Hover over the ${validation.confidence < 0.7 ? '⚠️' : validation.confidence < 0.8 ? '⚡' : '✅'} icon for detailed validation info.`}
                          >
                            <span style={{ 
                              color: '#00ff88', 
                              fontWeight: 'bold', 
                              minWidth: '30px',
                              fontSize: '0.8rem'
                            }}>
                              #{index + 1}
                            </span>
                            <div style={{ flex: 1 }}>
                              <div style={{ 
                                fontWeight: 'bold', 
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}>
                                {displayTitle}
                                {customSongTitles[song.id] && (
                                  <span style={{ 
                                    fontSize: '0.8rem', 
                                    color: '#00ffa3', 
                                    fontStyle: 'italic'
                                  }}>
                                    (edited)
                                  </span>
                                )}
                                {!customSongTitles[song.id] && displayTitle !== song.name && (
                                  <span style={{ 
                                    fontSize: '0.7rem', 
                                    color: '#ffaa00', 
                                    fontStyle: 'italic',
                                    marginLeft: '4px'
                                  }}>
                                    (cleaned)
                                  </span>
                                )}
                                {/* Validation indicator */}
                                <span 
                                  style={{ 
                                    fontSize: '0.7rem',
                                    color: validationColor,
                                    fontWeight: 'normal',
                                    cursor: 'help'
                                  }}
                                  title={`${validationMessage}. ${validation.warnings.join('; ')}
                                  
Original: "${song.name}"
Cleaned: "${displayTitle}"
${validation.suggestions.length > 0 ? '\nSuggestions: ' + validation.suggestions.slice(0, 2).join('; ') : ''}`}
                                >
                                  {validation.confidence < 0.7 ? '⚠️' : validation.confidence < 0.8 ? '⚡' : '✅'}
                                </span>
                              </div>
                              <div style={{ color: '#b3b3b3', fontSize: '0.8rem' }}>
                                by {song.artist}
                                {validation.warnings.length > 0 && (
                                  <span style={{ 
                                    color: validationColor, 
                                    fontSize: '0.7rem',
                                    marginLeft: '8px',
                                    fontStyle: 'italic'
                                  }}>
                                    {validation.warnings[0]}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => handleEditSongTitle({id: song.id, title: song.name, artist: song.artist})}
                                style={{
                                  background: 'rgba(0,255,163,0.1)',
                                  border: '1px solid rgba(0,255,163,0.3)',
                                  borderRadius: '6px',
                                  color: '#00ffa3',
                                  padding: '6px 10px',
                                  fontSize: '0.8rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Edit song title for Game of Tones"
                              >
                                ✏️ Edit
                              </button>
                              <button
                                onClick={() => handleReplaceSong({
                                  id: song.id,
                                  name: song.name,
                                  artist: song.artist,
                                  sourcePlaylistName: song.sourcePlaylistName
                                })}
                                style={{
                                  background: 'rgba(255,165,0,0.1)',
                                  border: '1px solid rgba(255,165,0,0.3)',
                                  borderRadius: '6px',
                                  color: '#ffa500',
                                  padding: '6px 10px',
                                  fontSize: '0.8rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title={`Replace this song in the game and in ${song.sourcePlaylistName || 'the original playlist'}`}
                              >
                                🔄 Replace
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
                </div>
          )}

            {false && (
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

                  {/* Quick Actions - Moved to Manager Tab */}

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
               key={`player-cards-${playerCardsVersion}`}
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               transition={{ delay: 0.4 }}
                    className="player-cards-section"
                    style={{ 
                      backgroundColor: 'rgba(255,0,0,0.1)', 
                      border: '2px solid red',
                      padding: '10px',
                      margin: '10px 0'
                    }}
             >
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '1rem' }}>
                      <h2>👥 Player Cards & Progress</h2>
                      <span style={{ 
                        marginLeft: '10px', 
                        fontSize: '0.8rem', 
                        color: 'red',
                        backgroundColor: 'rgba(255,0,0,0.2)',
                        padding: '2px 6px',
                        borderRadius: '3px'
                      }}>
                        DEBUG: {playerCards.size} cards, showPlayerCards: {showPlayerCards.toString()}
                      </span>
               </div>
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
                            const progress = calculateWinProgress(playerData.card, pattern, playerData.playedSongs || []);
                            const progressColor = progress.needed === 0 ? '#00ff88' : 
                                                progress.needed <= 2 ? '#ffaa00' : 
                                                progress.progress >= 50 ? '#66ccff' : '#888';
                            const progressText = progress.needed === 0 ? '🎉 BINGO!' : 
                                               progress.needed === 1 ? '1 more needed!' :
                                               `${progress.needed} more needed`;
                            const cheatingCount = progress.marked - progress.legitimate;
                            const patternText = `${progress.patternProgress}/${progress.totalNeeded} in pattern (${progress.progress}%)`;
                            
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
                                {cheatingCount > 0 && (
                                  <div style={{
                                    color: '#ff4444',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    marginBottom: '4px'
                                  }}>
                                    ⚠️ {cheatingCount} invalid mark{cheatingCount > 1 ? 's' : ''}
                   </div>
                                )}
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
                                  {patternText}
                                  {progress.marked !== progress.legitimate && (
                                    <span style={{ color: '#ff8888', marginLeft: '4px' }}>
                                      ({progress.marked} total marked)
                                    </span>
                                  )}
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
                            {playerData.card.squares.map((square: any) => {
                              const isPlayed = (playerData.playedSongs || []).includes(square.songId);
                              const isMarked = square.marked;
                              
                              // Determine square status and styling
                              let bgColor, borderColor, textColor, icon, statusText;
                              
                              if (isMarked && isPlayed) {
                                // ✅ Legitimate mark (played and marked)
                                bgColor = 'linear-gradient(135deg, #00ff88, #00cc6d)';
                                borderColor = '#00ff88';
                                textColor = '#001a0d';
                                icon = '✓';
                                statusText = 'Legitimate';
                              } else if (isMarked && !isPlayed) {
                                // ⚠️ Invalid mark (marked but not played - cheating!)
                                bgColor = 'linear-gradient(135deg, #ff6b6b, #ff4757)';
                                borderColor = '#ff4757';
                                textColor = '#ffffff';
                                icon = '⚠';
                                statusText = 'Invalid - Not played yet!';
                              } else if (!isMarked && isPlayed) {
                                // 🔵 Missed opportunity (played but not marked)
                                bgColor = 'linear-gradient(135deg, #4dabf7, #339af0)';
                                borderColor = '#339af0';
                                textColor = '#ffffff';
                                icon = '○';
                                statusText = 'Played but not marked';
                              } else {
                                // ⚪ Not played and not marked
                                bgColor = 'rgba(255,255,255,0.1)';
                                borderColor = 'rgba(255,255,255,0.3)';
                                textColor = '#ffffff';
                                icon = '';
                                statusText = 'Not played';
                              }
                              
                              return (
                                <div 
                                  key={square.position}
                                  style={{ 
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: bgColor,
                                    border: `2px solid ${borderColor}`,
                                    borderRadius: '8px',
                                    padding: '4px',
                                    fontSize: '0.7rem',
                                    fontWeight: isMarked ? 700 : 400,
                                    color: textColor,
                                    textAlign: 'center',
                                    lineHeight: 1.1,
                                    overflow: 'hidden'
                                  }}
                                  title={`${square.songName} — ${square.artistName}\nStatus: ${statusText}`}
                                >
                                {icon && <span style={{ marginRight: 2 }}>{icon}</span>}
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {square.songName.length > 12 ? square.songName.substring(0, 12) + '...' : square.songName}
                    </span>
                              </div>
                              );
                            })}
                         </div>
                  </div>
                ))}
               </div>
             </motion.div>
           )}

                {/* Finalized Playlist Display */}
                {(songList.length > 0 || (finalizedOrder?.length ?? 0) > 0 || mixFinalized) && (
                  <motion.div
                    className="finalized-playlist-section"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      padding: '20px',
                      marginTop: '20px'
                    }}
                  >
                    <h3 style={{
                      color: '#00ffa3',
                      fontSize: '1.2rem',
                      fontWeight: '600',
                      marginBottom: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      🎵 Finalized Playlist ({songList.length || finalizedOrder?.length || 0} songs)
                    </h3>
                    <p style={{
                      color: 'rgba(255,255,255,0.7)',
                      fontSize: '0.9rem',
                      marginBottom: '16px',
                      lineHeight: '1.4'
                    }}>
                      These are the songs that will be used in your bingo game. You can edit titles to make them more recognizable for players.
                    </p>
                    
                    <div style={{
                      maxHeight: '400px',
                      overflowY: 'auto',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      background: 'rgba(0,0,0,0.2)'
                    }}>
                      {(finalizedOrder || songList).map((song: any, index: number) => (
                        <div key={song.id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '12px',
                          borderBottom: index < (finalizedOrder || songList).length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                          fontSize: '0.9rem'
                        }}>
                          <span style={{ 
                            color: '#00ff88', 
                            fontWeight: 'bold', 
                            minWidth: '30px',
                            fontSize: '0.8rem'
                          }}>
                            #{index + 1}
                          </span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', color: '#fff' }}>
                              {getDisplaySongTitle(song.id, song.name)}
                              {customSongTitles[song.id] && (
                                <span style={{ 
                                  fontSize: '0.8rem', 
                                  color: '#00ffa3', 
                                  marginLeft: '8px',
                                  fontStyle: 'italic'
                                }}>
                                  (edited)
                                </span>
                              )}
                            </div>
                            <div style={{ color: '#b3b3b3', fontSize: '0.8rem' }}>
                              by {song.artist}
                            </div>
                          </div>
                          <button
                            onClick={() => handleEditSongTitle({id: song.id, title: song.name, artist: song.artist})}
                            style={{
                              background: 'rgba(0,255,163,0.1)',
                              border: '1px solid rgba(0,255,163,0.3)',
                              borderRadius: '6px',
                              color: '#00ffa3',
                              padding: '6px 10px',
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                            title="Edit song title for Game of Tones"
                          >
                            ✏️ Edit
                          </button>
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
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 1000,
              margin: 0,
              borderRadius: '15px 15px 0 0',
              boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.3)'
            }}
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
                  {suggestionsModal.error.message || 'An error occurred'}
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
                          <div style={{ fontWeight: 'bold', color: '#fff' }}>
                            {getDisplaySongTitle(song.id, song.name)}
                            {customSongTitles[song.id] && (
                              <span style={{ 
                                fontSize: '0.8rem', 
                                color: '#00ffa3', 
                                marginLeft: '8px',
                                fontStyle: 'italic'
                              }}>
                                (edited)
                              </span>
                            )}
                          </div>
                          <div style={{ color: '#b3b3b3' }}>by {song.artist}</div>
                        </div>
                        <button
                          onClick={() => handleEditSongTitle({id: song.id, title: song.name, artist: song.artist})}
                          style={{
                            background: 'rgba(0,255,163,0.1)',
                            border: '1px solid rgba(0,255,163,0.3)',
                            borderRadius: '6px',
                            color: '#00ffa3',
                            padding: '6px 10px',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            marginRight: '8px'
                          }}
                          title="Edit song title for Game of Tones"
                        >
                          ✏️ Edit
                        </button>
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

      {/* License Key Modal - TEMPORARILY DISABLED */}
      {false && showLicenseModal && (
                <div style={{ 
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(10px)',
          zIndex: 10000,
                  display: 'flex', 
          alignItems: 'center',
                  justifyContent: 'center',
          padding: 20
        }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
                    style={{
              background: 'rgba(42, 42, 42, 0.95)',
              backdropFilter: 'blur(20px)',
              borderRadius: 20,
              padding: 30,
              border: licenseError ? '2px solid rgba(255, 59, 48, 0.5)' : '2px solid rgba(255, 255, 255, 0.2)',
              maxWidth: 500,
              width: '100%',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ margin: 0, color: '#ffffff', fontSize: '1.5rem' }}>
                {isLicenseValidated ? '🔑 Update License Key' : '🔑 Enter License Key'}
              </h2>
              {isLicenseValidated && (
                  <button
                  onClick={() => setShowLicenseModal(false)}
                    style={{
                    background: 'none',
                      border: 'none',
                    color: '#ffffff',
                    fontSize: '1.5rem',
                      cursor: 'pointer',
                    padding: 5,
                    borderRadius: 5,
                    opacity: 0.7,
                    transition: 'opacity 0.2s ease'
                    }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                  >
                  ✕
                  </button>
              )}
                </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ 
                display: 'block', 
                color: '#ffffff', 
                fontSize: '0.9rem', 
                marginBottom: 8,
                opacity: 0.9 
              }}>
                Enter your TEMPO license key:
              </label>
              <input
                type={isLicenseValidated ? "password" : "text"}
                placeholder="TEMPO-ORG-2025-ABC123"
                value={licenseKey}
                onChange={(e) => handleLicenseKeyChange(e.target.value)}
                disabled={isJoiningRoom}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: licenseError ? '2px solid rgba(255, 59, 48, 0.5)' : '2px solid rgba(255, 255, 255, 0.2)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: '#ffffff',
                  fontSize: '1rem',
                  fontFamily: 'inherit',
                  outline: 'none',
                  transition: 'border-color 0.2s ease'
                }}
                onFocus={(e) => {
                  if (!licenseError) {
                    e.currentTarget.style.borderColor = 'rgba(0, 255, 136, 0.5)';
                  }
                }}
                onBlur={(e) => {
                  if (!licenseError) {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  }
                }}
              />
            </div>

            {isJoiningRoom && (
                <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 10,
                padding: '12px 16px',
                background: 'rgba(0, 255, 136, 0.1)',
                borderRadius: 8,
                border: '1px solid rgba(0, 255, 136, 0.2)',
                marginBottom: 15
              }}>
                <div style={{ 
                  width: 16, 
                  height: 16, 
                  border: '2px solid rgba(0, 255, 136, 0.3)',
                  borderTop: '2px solid #00ff88',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}></div>
                <span style={{ color: '#00ff88', fontSize: '0.9rem' }}>
                  Validating license key...
                </span>
              </div>
            )}

            {licenseError && (
              <div style={{ 
                color: '#ff3b30', 
                  fontSize: '0.9rem', 
                padding: '12px 16px',
                background: 'rgba(255, 59, 48, 0.1)',
                borderRadius: 8,
                border: '1px solid rgba(255, 59, 48, 0.3)',
                marginBottom: 15
              }}>
                {licenseError}
                </div>
            )}

            {isLicenseValidated && (
              <div style={{ 
                color: '#00ff88', 
                fontSize: '0.9rem', 
                padding: '12px 16px',
                background: 'rgba(0, 255, 136, 0.1)',
                borderRadius: 8,
                border: '1px solid rgba(0, 255, 136, 0.2)',
                marginBottom: 15
              }}>
                ✅ License key validated successfully
              </div>
            )}


            <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.7)', lineHeight: 1.4 }}>
              {isLicenseValidated ? (
                <div>
                  <p style={{ margin: '0 0 8px 0' }}>
                    You can update your license key here if you received a new one.
                  </p>
                  <p style={{ margin: 0 }}>
                    Your current license is working properly - no action needed.
                  </p>
                  </div>
              ) : (
                <div>
                  <p style={{ margin: '0 0 8px 0' }}>
                    Your license key is required to host TEMPO games and connect to Spotify.
                  </p>
                  <p style={{ margin: 0 }}>
                    Contact your administrator if you need a license key.
                  </p>
              </div>
          )}
        </div>
      </motion.div>
        </div>
      )}

      {/* Playlist Cleanup Modal */}
      {showPlaylistCleanup && (
            <motion.div
          className="modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
              style={{
                position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            zIndex: 1000
              }}
          onClick={() => setShowPlaylistCleanup(false)}
            >
              <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
                style={{
                  background: 'linear-gradient(135deg, #1a1a1a, #2a2a2a)',
              border: '1px solid rgba(0, 255, 136, 0.3)',
              borderRadius: '15px',
              padding: '24px',
              maxWidth: '800px',
              width: '90vw',
              maxHeight: '80vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ color: '#00ff88', margin: 0, fontSize: '1.5rem' }}>🗑️ Cleanup Output Playlists</h2>
              <button
                onClick={() => setShowPlaylistCleanup(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#fff',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  padding: '5px'
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <button
                onClick={loadGotPlaylists}
                disabled={isLoadingPlaylists}
                className="btn-primary"
                style={{ marginRight: '10px' }}
              >
                {isLoadingPlaylists ? '🔄 Loading...' : '🔍 Load My Output Playlists'}
              </button>
              
              {gotPlaylists.length > 0 && (
                <>
                  <button
                    onClick={() => selectAllPlaylists(selectedForDeletion.size !== gotPlaylists.length)}
                    className="btn-secondary"
                    style={{ marginRight: '10px' }}
                  >
                    {selectedForDeletion.size === gotPlaylists.length ? '❌ Deselect All' : '✅ Select All'}
                  </button>
                  
                  <button
                    onClick={deleteSelectedPlaylists}
                    disabled={selectedForDeletion.size === 0 || isDeletingPlaylists}
                    className="btn-danger"
                  >
                    {isDeletingPlaylists ? '🔄 Deleting...' : `🗑️ Delete Selected (${selectedForDeletion.size})`}
                  </button>
                </>
              )}
                </div>

            <div style={{ flex: 1, overflow: 'auto' }}>
              {gotPlaylists.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                  {isLoadingPlaylists ? 'Loading playlists...' : 'Click "Load My Output Playlists" to see your Game Of Tones playlists'}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {gotPlaylists.map((playlist) => (
                    <div
                      key={playlist.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '12px',
                        background: selectedForDeletion.has(playlist.id) 
                          ? 'rgba(220, 38, 38, 0.2)' 
                          : 'rgba(255, 255, 255, 0.05)',
                        border: selectedForDeletion.has(playlist.id)
                          ? '1px solid rgba(220, 38, 38, 0.5)'
                          : '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onClick={() => togglePlaylistSelection(playlist.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedForDeletion.has(playlist.id)}
                        onChange={() => togglePlaylistSelection(playlist.id)}
                        style={{ marginRight: '12px', cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', color: '#fff', marginBottom: '4px' }}>
                          {playlist.name.replace('Game Of Tones Output - ', '')}
                    </div>
                        <div style={{ fontSize: '0.8rem', color: '#888' }}>
                          {playlist.trackCount} songs • {playlist.createdAt !== 'Unknown' ? new Date(playlist.createdAt).toLocaleDateString() : 'Date unknown'}
                </div>
                        {playlist.description && (
                          <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '2px' }}>
                            {playlist.description}
                          </div>
                        )}
                      </div>
                      <a
                        href={playlist.external_urls?.spotify}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                            style={{ 
                          color: '#00ff88',
                          textDecoration: 'none',
                          fontSize: '0.8rem',
                          marginLeft: '10px'
                        }}
                      >
                        🎵 Open in Spotify
                      </a>
                          </div>
                        ))}
                      </div>
              )}
                    </div>
          </motion.div>
        </motion.div>
      )}

      {/* Bingo Verification Modal */}
      {pendingVerification && (
        <div 
                              style={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #1a1a1a, #2a2a2a)',
              border: '2px solid #00ff88',
              borderRadius: '15px',
              padding: '24px',
              maxWidth: '600px',
              width: '90vw',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 20px 60px rgba(0, 255, 136, 0.3)'
            }}
          >
            <h2 style={{ color: '#00ff88', marginBottom: '16px', textAlign: 'center' }}>
              🎯 BINGO VERIFICATION NEEDED
            </h2>
            
            <div style={{ marginBottom: '20px', textAlign: 'center' }}>
              <p style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '8px' }}>
                <strong>{pendingVerification.playerName}</strong> called BINGO!
              </p>
              <p style={{ color: '#ccc', fontSize: '0.9rem' }}>
                Pattern: <strong>{pendingVerification.winningPatternType || pendingVerification.requiredPattern}</strong>
              </p>
            </div>

            {/* Full Card Visualization */}
            {pendingVerification.playerCard && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: '#00ff88', marginBottom: '12px', fontSize: '1rem' }}>Player's Card:</h3>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(5, 1fr)', 
                  gap: '4px',
                  maxWidth: '400px',
                  margin: '0 auto',
                  background: 'rgba(0,0,0,0.3)',
                  padding: '8px',
                  borderRadius: '8px'
                }}>
                  {pendingVerification.playerCard.squares?.map((square: any) => {
                    const isInWinningPattern = pendingVerification.winningPatternPositions?.includes(square.position);
                    const wasPlayed = pendingVerification.playedSongs?.some((song: any) => song.id === square.songId);
                    const isMarked = square.marked;
                    const isInvalid = isMarked && !wasPlayed;
                    
                    let bgColor = 'rgba(255,255,255,0.1)';
                    let borderColor = 'rgba(255,255,255,0.3)';
                    let borderWidth = '1px';
                    
                    if (isInWinningPattern) {
                      borderWidth = '3px';
                      if (isInvalid) {
                        bgColor = 'rgba(255, 0, 0, 0.3)';
                        borderColor = '#ff4444';
                      } else if (wasPlayed && isMarked) {
                        bgColor = 'rgba(0, 255, 136, 0.3)';
                        borderColor = '#00ff88';
                      } else {
                        bgColor = 'rgba(255, 255, 0, 0.2)';
                        borderColor = '#ffaa00';
                      }
                    } else if (isInvalid) {
                      bgColor = 'rgba(255, 0, 0, 0.1)';
                      borderColor = 'rgba(255, 0, 0, 0.5)';
                    }
                    
                    return (
                      <div
                        key={square.position}
                        style={{
                          aspectRatio: '1',
                          background: bgColor,
                          border: `${borderWidth} solid ${borderColor}`,
                          borderRadius: '4px',
                          padding: '4px',
                          fontSize: '0.65rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          color: '#fff',
                          fontWeight: isInWinningPattern ? 'bold' : 'normal'
                        }}
                        title={`${square.songName} - ${square.artistName}\n${isInWinningPattern ? 'IN WINNING PATTERN' : ''}\n${isInvalid ? '❌ INVALID MARK' : wasPlayed ? '✅ PLAYED' : 'Not played'}`}
                      >
                        {isInWinningPattern && isInvalid && '⚠️'}
                        {isInWinningPattern && !isInvalid && wasPlayed && '✓'}
                        {square.songName.substring(0, 8)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Winning Pattern Squares List */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ color: '#00ff88', marginBottom: '12px', fontSize: '1rem' }}>
                Winning Pattern Squares ({pendingVerification.winningPatternPositions?.length || 0} squares):
              </h3>
              <div style={{ 
                maxHeight: '300px', 
                overflow: 'auto', 
                background: 'rgba(0,0,0,0.3)', 
                padding: '12px', 
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                {pendingVerification.winningPatternPositions?.map((position: string, index: number) => {
                  const square = pendingVerification.playerCard?.squares?.find((s: any) => s.position === position);
                  if (!square) return null;
                  
                  const wasPlayed = pendingVerification.playedSongs?.some((song: any) => song.id === square.songId);
                  const isMarked = square.marked;
                  const isInvalid = isMarked && !wasPlayed;
                  
                  return (
                    <div 
                      key={index}
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '10px',
                        marginBottom: '6px',
                        background: isInvalid ? 'rgba(255, 0, 0, 0.2)' : wasPlayed && isMarked ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '6px',
                        border: `2px solid ${isInvalid ? '#ff4444' : wasPlayed && isMarked ? '#00ff88' : 'rgba(255,255,255,0.2)'}`,
                        borderLeftWidth: isInvalid ? '6px' : wasPlayed && isMarked ? '6px' : '2px'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#fff', fontSize: '0.95rem', fontWeight: 'bold', marginBottom: '2px' }}>
                          {square.songName}
                        </div>
                        <div style={{ color: '#ccc', fontSize: '0.85rem' }}>
                          {square.artistName}
                        </div>
                        <div style={{ color: '#888', fontSize: '0.75rem', marginTop: '4px' }}>
                          Position: {position}
                        </div>
                      </div>
                      <div style={{ 
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: '4px'
                      }}>
                        {isInvalid ? (
                          <>
                            <span style={{ 
                              color: '#ff4444',
                              fontSize: '0.85rem',
                              fontWeight: 'bold',
                              backgroundColor: 'rgba(255, 0, 0, 0.2)',
                              padding: '4px 8px',
                              borderRadius: '4px'
                            }}>
                              ❌ INVALID MARK
                            </span>
                            <span style={{ 
                              color: '#ff8888',
                              fontSize: '0.75rem'
                            }}>
                              Not in played list
                            </span>
                          </>
                        ) : wasPlayed && isMarked ? (
                          <>
                            <span style={{ 
                              color: '#00ff88',
                              fontSize: '0.85rem',
                              fontWeight: 'bold',
                              backgroundColor: 'rgba(0, 255, 136, 0.2)',
                              padding: '4px 8px',
                              borderRadius: '4px'
                            }}>
                              ✅ VALID
                            </span>
                            <span style={{ 
                              color: '#88ffaa',
                              fontSize: '0.75rem'
                            }}>
                              Played & marked
                            </span>
                          </>
                        ) : (
                          <>
                            <span style={{ 
                              color: '#ffaa00',
                              fontSize: '0.85rem',
                              fontWeight: 'bold',
                              backgroundColor: 'rgba(255, 170, 0, 0.2)',
                              padding: '4px 8px',
                              borderRadius: '4px'
                            }}>
                              ⚠️ NOT MARKED
                            </span>
                            <span style={{ 
                              color: '#ffcc88',
                              fontSize: '0.75rem'
                            }}>
                              {wasPlayed ? 'Played but not marked' : 'Not played'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Verification Buttons */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <button
                onClick={approveBingo}
                disabled={isProcessingVerification}
                    style={{
                      background: 'linear-gradient(135deg, #00ff88, #00cc6d)',
                  color: '#000',
                      border: 'none',
                      padding: '12px 24px',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  cursor: isProcessingVerification ? 'not-allowed' : 'pointer',
                  opacity: isProcessingVerification ? 0.6 : 1
                }}
              >
                {isProcessingVerification ? '⏳ Processing...' : '✅ APPROVE BINGO'}
                  </button>
                  
                  <button
                onClick={() => {
                  const reason = prompt('Reason for rejection (optional):') || 'Invalid pattern';
                  rejectBingo(reason);
                }}
                disabled={isProcessingVerification}
                    style={{
                      background: 'linear-gradient(135deg, #ff4444, #cc3333)',
                  color: '#fff',
                      border: 'none',
                      padding: '12px 24px',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  cursor: isProcessingVerification ? 'not-allowed' : 'pointer',
                  opacity: isProcessingVerification ? 0.6 : 1
                }}
              >
                {isProcessingVerification ? '⏳ Processing...' : '❌ REJECT BINGO'}
                  </button>
                </div>

            {/* Debug Info */}
            {pendingVerification.debugInfo && (
                <div style={{ 
                marginTop: '16px', 
                padding: '8px', 
                background: 'rgba(0,0,0,0.2)', 
                borderRadius: '4px',
                fontSize: '0.8rem',
                color: '#ccc'
              }}>
                <strong>Debug:</strong> {pendingVerification.debugInfo.totalMarkedSquares} marked, {pendingVerification.debugInfo.totalPlayedSongs} played songs
                </div>
            )}
                  </div>
              </div>
      )}

      {/* Player Cards - PROPERLY PLACED AT TOP LEVEL */}
      {showPlayerCards && playerCards.size > 0 && (
        <motion.div 
          key="player-cards-section"
          initial={false}
          animate={{ opacity: 1 }}
          className="player-cards-section"
          style={{ 
            backgroundColor: 'rgba(255,0,0,0.1)', 
            border: '2px solid red',
            padding: '10px',
            margin: '10px 0'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '1rem' }}>
            <h2>👥 Player Cards & Progress</h2>
            <span style={{ 
              marginLeft: '10px', 
              fontSize: '0.8rem', 
              color: 'red',
              backgroundColor: 'rgba(255,0,0,0.2)',
              padding: '2px 6px',
              borderRadius: '3px'
            }}>
              DEBUG: {playerCards.size} cards, showPlayerCards: {showPlayerCards.toString()}
            </span>
          </div>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', 
            gap: 16 
          }}>
            {Array.from(playerCards.entries()).map(([playerId, playerData]) => (
              <motion.div 
                key={playerId}
                layout
                transition={{ duration: 0.2 }}
                style={{ 
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
                  const progress = calculateWinProgress(playerData.card, pattern, playerData.playedSongs || []);
                  const progressColor = progress.needed === 0 ? '#00ff88' : 
                                      progress.needed <= 2 ? '#ffaa00' : 
                                      progress.progress >= 50 ? '#66ccff' : '#888';
                  const progressText = progress.needed === 0 ? '🎉 BINGO!' : 
                                     progress.needed === 1 ? '1 more needed!' :
                                     `${progress.needed} more needed`;
                  const cheatingCount = progress.marked - progress.legitimate;
                  const patternText = `${progress.patternProgress}/${progress.totalNeeded} in pattern (${progress.progress}%)`;
                  
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
                      {cheatingCount > 0 && (
                        <div style={{
                          color: '#ff4444',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          marginBottom: '4px'
                        }}>
                          ⚠️ {cheatingCount} invalid mark{cheatingCount > 1 ? 's' : ''}
                        </div>
                      )}
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
                        {patternText}
                        {progress.marked !== progress.legitimate && (
                          <span style={{ color: '#ff8888', marginLeft: '4px' }}>
                            ({progress.marked} total marked)
                          </span>
                        )}
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
                  {playerData.card.squares.map((square: any) => {
                    const isPlayed = (playerData.playedSongs || []).includes(square.songId);
                    const isMarked = square.marked;
                    
                    // Determine square status and styling
                    let bgColor, borderColor, textColor, icon, statusText;
                    
                    if (isMarked && isPlayed) {
                      // ✅ Legitimate mark (played and marked)
                      bgColor = 'linear-gradient(135deg, #00ff88, #00cc6d)';
                      borderColor = '#00ff88';
                      textColor = '#001a0d';
                      icon = '✓';
                      statusText = 'Legitimate';
                    } else if (isMarked && !isPlayed) {
                      // ⚠️ Invalid mark (marked but not played - cheating!)
                      bgColor = 'linear-gradient(135deg, #ff6b6b, #ff4757)';
                      borderColor = '#ff4757';
                      textColor = '#ffffff';
                      icon = '⚠';
                      statusText = 'Invalid - Not played yet!';
                    } else if (!isMarked && isPlayed) {
                      // 🔵 Missed opportunity (played but not marked)
                      bgColor = 'linear-gradient(135deg, #4dabf7, #339af0)';
                      borderColor = '#339af0';
                      textColor = '#ffffff';
                      icon = '○';
                      statusText = 'Played but not marked';
                    } else {
                      // ⚪ Not played and not marked
                      bgColor = 'rgba(255,255,255,0.1)';
                      borderColor = 'rgba(255,255,255,0.3)';
                      textColor = '#ffffff';
                      icon = '';
                      statusText = 'Not played';
                    }
                    
                    return (
                      <div 
                        key={square.position}
                        style={{ 
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: bgColor,
                          border: `2px solid ${borderColor}`,
                          borderRadius: '8px',
                          padding: '4px',
                          fontSize: '0.7rem',
                          fontWeight: isMarked ? 700 : 400,
                          color: textColor,
                          textAlign: 'center',
                          lineHeight: 1.1,
                          overflow: 'hidden'
                        }}
                        title={`${square.songName} — ${square.artistName}\nStatus: ${statusText}`}
                      >
                        {icon && <span style={{ marginRight: 2 }}>{icon}</span>}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {square.songName.length > 12 ? square.songName.substring(0, 12) + '...' : square.songName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Add spinning animation for loading indicator */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .btn-danger {
          background: #dc2626;
          border: 1px solid #ef4444;
          color: white;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s ease;
        }
        .btn-danger:hover:not(:disabled) {
          background: #b91c1c;
          border-color: #dc2626;
        }
        .btn-danger:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>

      {/* Custom Pattern Modal */}
      <CustomPatternModal
        isOpen={showCustomPatternModal}
        onClose={() => setShowCustomPatternModal(false)}
        onSave={handleSaveCustomPattern}
      />

      {/* Song Title Edit Modal */}
      {editingSong && (
        <SongTitleEditModal
          isOpen={showSongTitleModal}
          onClose={() => {
            setShowSongTitleModal(false);
            setEditingSong(null);
          }}
          onSave={handleSaveSongTitle}
          songId={editingSong.id}
          originalTitle={editingSong.title}
          customTitle={customSongTitles[editingSong.id]}
          artistName={editingSong.artist}
        />
      )}

      {/* Song Replacement Modal */}
      {replacingSong && roomId && (
        <SongReplacementModal
          isOpen={showSongReplacementModal}
          onClose={() => {
            setShowSongReplacementModal(false);
            setReplacingSong(null);
          }}
          onReplace={handleSongReplaced}
          currentSong={replacingSong}
          roomId={roomId}
        />
      )}
    </div>
  );
};

export default HostView;

