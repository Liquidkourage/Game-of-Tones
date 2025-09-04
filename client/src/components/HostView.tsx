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
  const [players] = useState<Player[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylists, setSelectedPlaylists] = useState<Playlist[]>([]);
  const [snippetLength, setSnippetLength] = useState(30);
  const [winners, setWinners] = useState<Player[]>([]);
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);
  const [isSpotifyConnecting, setIsSpotifyConnecting] = useState(false);
  const [mixFinalized, setMixFinalized] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState<boolean>(false);
  const [repeatState, setRepeatState] = useState<'off' | 'track' | 'context'>('off');
  const [randomStarts, setRandomStarts] = useState<boolean>(false);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [logs, setLogs] = useState<Array<{ level: 'info' | 'warn' | 'error'; message: string; ts: number }>>([]);
  const [revealMode, setRevealMode] = useState<'off' | 'artist' | 'title' | 'full'>('off');
  const [pattern, setPattern] = useState<'line' | 'four_corners' | 'x' | 'full_card'>('full_card');
  const [lockJoins, setLockJoins] = useState<boolean>(false);
  const [preQueueEnabled, setPreQueueEnabled] = useState<boolean>(false);
  const [preQueueWindow, setPreQueueWindow] = useState<number>(5);
  const [stripGoTPrefix, setStripGoTPrefix] = useState<boolean>(true);

  const addLog = (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    setLogs(prev => [{ level, message, ts: Date.now() }, ...prev].slice(0, 50));
  };

  // Advanced playback states
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 50,
    playbackRate: 1,
    currentSong: null,
    queue: [],
    currentQueueIndex: 0
  });
   
  const [isSeeking, setIsSeeking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(50);
  const [songList, setSongList] = useState<Song[]>([]);
  const [finalizedOrder, setFinalizedOrder] = useState<Song[] | null>(null);
  // Playlists paging/virtualization state
  const [playlistPage, setPlaylistPage] = useState(1); // pages of 50
  const [visiblePlaylists, setVisiblePlaylists] = useState<Playlist[]>([]);
  const [playlistQuery, setPlaylistQuery] = useState('');
  const [isLoadingMorePlaylists, setIsLoadingMorePlaylists] = useState(false);
  const [showSongList, setShowSongList] = useState(false);
  
  // Pause position tracking
  const [pausePosition, setPausePosition] = useState<number>(0);
  const [isPausedByInterface, setIsPausedByInterface] = useState(false);

  const loadPlaylists = useCallback(async () => {
    try {
      console.log('Loading playlists...');
      const response = await fetch(`${API_BASE || ''}/api/spotify/playlists`);
      if (response.status === 401) {
        console.warn('Spotify not connected (401) while loading playlists');
        setIsSpotifyConnected(false);
        setIsSpotifyConnecting(false);
        setSpotifyError('Spotify is not connected. Click Connect Spotify.');
        setPlaylists([]);
        return;
      }
      const data = await response.json();
      
      if (data.success) {
        setPlaylists(data.playlists);
        // initialize first page (50)
        setPlaylistPage(1);
        setVisiblePlaylists(data.playlists.slice(0, 50));
        console.log('Playlists loaded:', data.playlists.length, 'playlists');
      } else {
        console.error('Failed to load playlists:', data.error);
      }
    } catch (error) {
      console.error('Error loading playlists:', error);
    }
  }, []);

  // Append next page of playlists
  const loadMorePlaylists = useCallback(() => {
    if (!playlists || playlists.length === 0) return;
    if (isLoadingMorePlaylists) return;
    setIsLoadingMorePlaylists(true);
    const nextPage = playlistPage + 1;
    const next = playlists.slice(0, nextPage * 50);
    setVisiblePlaylists(next);
    setPlaylistPage(nextPage);
    setIsLoadingMorePlaylists(false);
  }, [playlists, playlistPage, isLoadingMorePlaylists]);

  // Filter playlists by query (client-side, debounced simple contains)
  const filteredPlaylists = (playlistQuery ? visiblePlaylists.filter(p => {
    const q = playlistQuery.toLowerCase();
    return (
      (p.name || '').toLowerCase().includes(q) ||
      (p.owner || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q)
    );
  }) : visiblePlaylists);

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
        setShuffleEnabled(!!data.playbackState.shuffle_state);
        const rep = (data.playbackState.repeat_state || 'off') as 'off' | 'track' | 'context';
        setRepeatState(rep);
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
      setGameState('playing');
      console.log('Game started:', data);
      setIsStartingGame(false);
      addLog('Game started', 'info');
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
      
      // Reset pause tracking for new song
      setPausePosition(0);
      setIsPausedByInterface(false);
      
      console.log('Song playing:', data);
      addLog(`Now playing: ${data.songName} — ${data.artistName}`, 'info');
      
      // Sync volume when song starts playing
      setTimeout(() => {
        fetchCurrentVolume();
      }, 500);
    });

    newSocket.on('bingo-called', (data: any) => {
      setWinners(prev => [...prev, data]);
      console.log('Bingo called by:', data.playerName);
    });

    newSocket.on('player-left', (data: any) => {
      console.log('Player left:', data);
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
      setIsPlaying(false);
      setGameState('ended');
      console.log('🛑 Game ended');
    });

    newSocket.on('game-reset', () => {
      setIsPlaying(false);
      setGameState('waiting');
      setCurrentSong(null);
      setWinners([]);
      setMixFinalized(false);
      setSongList([]);
      console.log('🔁 Game reset');
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
      alert('⚠️ ' + msg);
      addLog(`Playback warning: ${msg}`, 'warn');
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
        const response = await fetch(`${API_BASE || ''}/api/spotify/status`);
        const data = await response.json();

        if (data.connected) {
          console.log('Spotify already connected, loading playlists...');
          setIsSpotifyConnected(true);
          setIsSpotifyConnecting(false);
          await loadPlaylists();
          await loadDevices(); // Load devices when connected
          
          // Sync initial volume
          setTimeout(() => {
            fetchCurrentVolume();
          }, 1000);
        } else {
          console.log('Spotify not connected');
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
      
      // Check if Spotify is already connected
      const statusResponse = await fetch(`${API_BASE || ''}/api/spotify/status`);
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
        localStorage.setItem('spotify_return_url', returnUrl);
        if (roomId) {
          localStorage.setItem('spotify_room_id', roomId);
        }
        
        // Redirect to Spotify
        window.location.href = data.authUrl;
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
        randomStarts
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

  const updatePattern = (next: 'line' | 'four_corners' | 'x' | 'full_card') => {
    setPattern(next);
    if (socket && roomId) {
      socket.emit('set-pattern', { roomId, pattern: next });
      addLog(`Pattern set to ${next}`, 'info');
    }
  };

  const playSong = async (song: Song) => {
    if (!socket) {
      console.error('Socket not connected');
      return;
    }

    try {
      // If we're already playing this song, just resume
      if (isPlaying && currentSong?.id === song.id) {
        socket.emit('resume-song', { roomId });
        setIsPlaying(true);
        setPlaybackState(prev => ({ ...prev, isPlaying: true }));
        console.log('Resumed song via socket');
      } else {
        // Check if we were paused by the interface and need to resume from exact position
        if (isPausedByInterface && currentSong?.id === song.id) {
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
          // For new songs or external changes, just resume normally
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
        const spotifyVolume = (data.playbackState.device?.volume_percent ?? 50) as number;
        setPlaybackState(prev => ({ ...prev, volume: spotifyVolume }));
        console.log(`🔊 Synced volume from Spotify: ${spotifyVolume}%`);
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
        body: JSON.stringify({ deviceId: selectedDevice.id, play: true })
      });
      if (response.ok) {
        console.log('✅ Transferred playback to selected device');
        await fetchPlaybackState();
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

  const toggleShuffle = useCallback(async () => {
    if (!selectedDevice) {
      alert('Please select a device first');
      return;
    }
    const next = !shuffleEnabled;
    try {
      const response = await fetch(`${API_BASE || ''}/api/spotify/shuffle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shuffle: next, deviceId: selectedDevice.id })
      });
      if (response.ok) {
        setShuffleEnabled(next);
      }
    } catch (e) {
      console.error('❌ Error setting shuffle:', e);
    }
  }, [selectedDevice, shuffleEnabled]);

  const cycleRepeat = useCallback(async () => {
    if (!selectedDevice) {
      alert('Please select a device first');
      return;
    }
    const order: Array<'off' | 'context' | 'track'> = ['off', 'context', 'track'];
    const idx = order.indexOf(repeatState as any);
    const next = order[(idx + 1) % order.length];
    try {
      const response = await fetch(`${API_BASE || ''}/api/spotify/repeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: next, deviceId: selectedDevice.id })
      });
      if (response.ok) {
        setRepeatState(next);
      }
    } catch (e) {
      console.error('❌ Error setting repeat:', e);
    }
  }, [selectedDevice, repeatState]);

  // Debounced volume change with strict synchronization
  const handleVolumeChange = useCallback(async (newVolume: number) => {
    // Clear any existing timeout
    if (volumeTimeout) {
      clearTimeout(volumeTimeout);
    }

    // Set local state immediately for responsive UI
    setPlaybackState(prev => ({ ...prev, volume: newVolume }));
    setIsMuted(false);

    // Debounce the actual volume change to prevent rapid API calls
    const timeout = setTimeout(async () => {
      try {
        console.log(`🔊 Setting volume to ${newVolume}% on Spotify`);
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
          // Verify the volume was set correctly by fetching current state
          setTimeout(() => {
            fetchCurrentVolume();
          }, 100);
        } else {
          console.error('Failed to set volume, reverting to Spotify state');
          fetchCurrentVolume(); // Revert to actual Spotify volume
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
        console.log(`🔊 Unmuting, setting volume to ${previousVolume}%`);
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
          // Verify the volume was set correctly
          setTimeout(() => {
            fetchCurrentVolume();
          }, 100);
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
        console.log(`🔊 Muting, setting volume to 0%`);
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
          // Verify the volume was set correctly
          setTimeout(() => {
            fetchCurrentVolume();
          }, 100);
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
      console.log('🔧 Forcing device detection...');
      
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
      console.log('🔄 Refreshing Spotify connection...');
      
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

  // Periodic volume synchronization
  useEffect(() => {
    if (!isPlaying || !currentSong) return;
    const volumeSyncInterval = setInterval(() => {
      // Only sync volume every 15s to reduce noise
      fetchCurrentVolume();
    }, 15000);
    return () => clearInterval(volumeSyncInterval);
  }, [isPlaying, currentSong, fetchCurrentVolume]);

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
          setShuffleEnabled(!!data.playbackState.shuffle_state);
          const rep = (data.playbackState.repeat_state || 'off') as 'off' | 'track' | 'context';
          setRepeatState(rep);
          // Guards: ignore polling false near reconnect or a recent song event
          const now = Date.now();
          if (!spotifyIsPlaying) {
            if (now < ignorePollingUntilRef.current) return;
            if (now - lastSongEventAtRef.current < 15000) return;
          }
          if (spotifyIsPlaying !== isPlaying) {
            console.log(`🔄 Spotify playback state changed: ${spotifyIsPlaying}, updating interface`);
            setIsPlaying(spotifyIsPlaying);
            setPlaybackState(prev => ({ ...prev, isPlaying: spotifyIsPlaying, currentTime: spotifyPosition }));
            if (spotifyIsPlaying && isPausedByInterface) {
              console.log('🔄 Spotify resumed externally, clearing pause tracking');
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
      socket.emit('new-round', { roomId });
      addLog('New Round requested', 'info');
    }
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
          <h1>🎵 Game Host</h1>
          <div className="room-info">
            <span className="room-code">Room: {roomId}</span>
            <span className="player-count">{players.length} Players</span>
          </div>
        </div>

        {/* Main Content */}
        <div className="host-content">
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

          {/* Playlists - Virtualized + Paged */}
          <div className="setting-item">
            <label>Playlists:</label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Search playlists..."
                value={playlistQuery}
                onChange={(e) => setPlaylistQuery(e.target.value)}
                className="input"
                style={{ flex: 1, minWidth: 240 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={stripGoTPrefix} onChange={(e) => setStripGoTPrefix(!!e.target.checked)} />
                <span>Strip "GoT" preview</span>
              </label>
              <button className="btn-secondary" onClick={() => { setPlaylistQuery(''); }}>Clear</button>
              <button
                className="btn-secondary"
                onClick={() => {
                  const toAdd = filteredPlaylists.slice(0, 5).filter(fp => !selectedPlaylists.some(sp => sp.id === fp.id));
                  setSelectedPlaylists(prev => [...prev, ...toAdd]);
                }}
              >Add first 5 visible</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 12 }}>
              <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 8 }}>
                {filteredPlaylists.length === 0 && (
                  <div style={{ color: '#b3b3b3', fontStyle: 'italic' }}>No playlists</div>
                )}
                {filteredPlaylists.map((p) => {
                  const isSelected = !!selectedPlaylists.find(sp => sp.id === p.id);
                  const previewName = stripGoTPrefix ? (p.name || '').replace(/^\s*GoT\s*[-–:]*\s*/i, '').trim() : p.name;
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewName}</div>
                        <div style={{ fontSize: 12, color: '#b3b3b3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.owner} • {p.tracks} tracks</div>
                      </div>
                      <button
                        className={isSelected ? 'btn-secondary active' : 'btn-secondary'}
                        onClick={() => {
                          setSelectedPlaylists(prev => (
                            isSelected ? prev.filter(sp => sp.id !== p.id) : [...prev, p]
                          ));
                        }}
                      >
                        {isSelected ? 'Remove' : 'Add'}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 8, position: 'sticky', top: 8 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Selected ({selectedPlaylists.length})</div>
                {selectedPlaylists.length === 0 && (
                  <div style={{ color: '#b3b3b3', fontStyle: 'italic' }}>None selected</div>
                )}
                {selectedPlaylists.map((sp) => (
                  <div key={sp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px dashed rgba(255,255,255,0.08)' }}>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stripGoTPrefix ? (sp.name || '').replace(/^\s*GoT\s*[-–:]*\s*/i, '').trim() : sp.name}</div>
                    <button className="btn-secondary" onClick={() => setSelectedPlaylists(prev => prev.filter(x => x.id !== sp.id))}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Game Controls */}
          <motion.div 
            className="controls-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <h2>🎮 Game Controls</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '6px 0 10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ opacity: 0.85 }}>Snippet</span>
                <input
                  type="range"
                  min="5"
                  max="60"
                  value={snippetLength}
                  onChange={(e) => setSnippetLength(Number(e.target.value))}
                />
                <span style={{ width: 32, textAlign: 'right' }}>{snippetLength}s</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={randomStarts}
                  onChange={(e) => setRandomStarts(!!e.target.checked)}
                />
                <span>Random start</span>
              </label>
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
              <span style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.2)' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={preQueueEnabled}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setPreQueueEnabled(val);
                    if (socket && roomId) socket.emit('set-prequeue', { roomId, enabled: val, window: preQueueWindow });
                  }}
                />
                <span>Pre-queue next</span>
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={preQueueWindow}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(20, Number(e.target.value) || 1));
                  setPreQueueWindow(val);
                  if (socket && roomId && preQueueEnabled) socket.emit('set-prequeue', { roomId, enabled: true, window: val });
                }}
                style={{ width: 56, padding: '2px 6px', background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6 }}
              />
              <span>tracks</span>
            </div>
             <div className="control-buttons">
               {gameState === 'waiting' ? (
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
                     className="start-btn"
                     onClick={startGame}
                     disabled={selectedPlaylists.length === 0 || isSpotifyConnecting}
                   >
                     <Play className="btn-icon" />
                     {isSpotifyConnecting ? 'Connecting Spotify...' : 'Start Game'}
                   </button>
                 </>
               ) : (
                 <div className="game-status">
                   <p className="status-text">🎵 Game is running - Use the Now Playing controls below</p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn-secondary" onClick={endGame}>🛑 End Game</button>
                    <button className="btn-secondary" onClick={confirmAndResetGame}>🔁 Reset</button>
                    <button className="btn-secondary" onClick={confirmAndNewRound}>🆕 New Round</button>
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

          {/* Song List (moved below to avoid shifting playlist picker) */}
          {(finalizedOrder?.length || songList.length) > 0 && (
            <motion.div 
              className="song-list-section"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              <h2>🎵 {finalizedOrder ? 'Finalized Order' : 'Song List'} ({(finalizedOrder?.length || songList.length)} songs)</h2>
              <div className="song-list-controls">
                <button
                  onClick={() => setShowSongList(!showSongList)}
                  className="btn-secondary"
                >
                  {showSongList ? '📋 Hide Song List' : '📋 Show Song List'}
                </button>
                {!finalizedOrder && (
                  <button
                    onClick={generateSongList}
                    className="btn-secondary"
                  >
                    🔀 Reshuffle Songs
                  </button>
                )}
              </div>
              {showSongList && (
                <motion.div
                  className="song-list-display"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="song-list">
                    {(finalizedOrder || songList).map((song, index) => (
                      <div
                        key={`${song.id}-${index}`}
                        className="song-list-item"
                      >
                        <span className="song-number">{index + 1}</span>
                        <div className="song-info">
                          <span className="song-name">{song.name}</span>
                          <span className="song-artist">{song.artist}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* Logs */}
          {logs.length > 0 && (
            <motion.div 
              className="logs-section"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55 }}
            >
              <h2>📝 Host Logs</h2>
              <div style={{ maxHeight: 200, overflowY: 'auto', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 8 }}>
                {logs.map((entry, idx) => (
                  <div key={entry.ts + '-' + idx} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.8 }}>
                      {new Date(entry.ts).toLocaleTimeString()}
                    </span>
                    <span style={{ fontWeight: 600, color: entry.level === 'error' ? '#ff6b6b' : entry.level === 'warn' ? '#ffd166' : '#9be564' }}>
                      {entry.level.toUpperCase()}
                    </span>
                    <span>{entry.message}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

                       {/* Now Playing Interface - Integrated into main content */}
            {currentSong && (
             <motion.div 
               className="now-playing-section"
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               transition={{ delay: 0.6 }}
             >
               <h2>🎵 Now Playing</h2>
               <div className="now-playing-content">
                 {/* Song Info */}
                 <div className="song-info-display">
                   <div className="song-details">
                     <h3>{currentSong.name}</h3>
                     <p className="artist">{currentSong.artist}</p>
                   </div>
                 </div>

                 {/* Main Controls */}
                 <div className="main-controls">
                   <button onClick={handleSkipToPrevious} className="control-btn">
                     ⏮️
                   </button>
                                       <button onClick={isPlaying ? pauseSong : () => playSong(currentSong!)} className="control-btn play-btn">
                      {isPlaying ? '⏸️ Pause' : '▶️ Play'}
                    </button>
                   <button onClick={handleSkipToNext} className="control-btn">
                     ⏭️
                   </button>
                 </div>

                 {/* Progress Bar */}
                 <div className="progress-container">
                   <input
                     type="range"
                     min="0"
                     max={playbackState.duration}
                     value={playbackState.currentTime}
                     onChange={(e) => handleSeek(Number(e.target.value))}
                     onMouseDown={() => setIsSeeking(true)}
                     onMouseUp={() => setIsSeeking(false)}
                     className="progress-bar"
                   />
                   <div className="progress-info">
                     <span>{formatTime(playbackState.currentTime)}</span>
                     <span>{formatTime(playbackState.duration)}</span>
                   </div>
                 </div>

                 {/* Volume Control */}
                 <div className="volume-control">
                   <button
                     onClick={handleMuteToggle}
                     className="control-btn"
                     style={{ 
                       padding: '4px 8px', 
                       minWidth: 'auto',
                       background: isMuted ? 'rgba(255, 107, 107, 0.3)' : 'rgba(255, 255, 255, 0.15)'
                     }}
                   >
                     {isMuted ? '🔇' : '🔊'}
                   </button>
                   <input
                     type="range"
                     min="0"
                     max="100"
                     value={isMuted ? 0 : playbackState.volume}
                     onChange={(e) => handleVolumeChange(Number(e.target.value))}
                     className="volume-slider"
                   />
                   <span className="volume-label">{isMuted ? '0' : playbackState.volume}%</span>
                 </div>

                                   {/* Keyboard Shortcuts Help */}
                  <div className="advanced-controls-toggle">
                    <button
                      className="toggle-advanced-btn"
                      onClick={() => {
                        alert(`🎹 Keyboard Shortcuts:
• Spacebar: Play/Pause
• ← → Arrow Keys: Previous/Next
• M: Mute/Unmute
• Click and drag progress bar to seek`);
                      }}
                      style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                    >
                      ⌨️ Help
                    </button>
                  </div>
               </div>
             </motion.div>
           )}



          {/* Winners */}
          {winners.length > 0 && (
            <motion.div 
              className="winners-section"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
            >
              <h2>🏆 Winners</h2>
              <div className="winners-list">
                {winners.map((winner, index) => (
                  <div key={winner.id} className="winner-item">
                    <Trophy className="trophy-icon" />
                    <span>{winner.name}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>

      
    </div>
  );
};

export default HostView;