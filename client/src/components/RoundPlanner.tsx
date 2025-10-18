import React, { useState, useEffect } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  Play, 
  CheckCircle, 
  Circle, 
  Plus, 
  Trash2, 
  GripVertical,
  Music,
  Folder,
  FolderOpen
} from 'lucide-react';

interface Playlist {
  id: string;
  name: string;
  tracks: number;
  description?: string;
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

interface RoundPlannerProps {
  rounds: EventRound[];
  onUpdateRounds: (rounds: EventRound[]) => void;
  playlists: Playlist[];
  currentRound: number;
  onStartRound: (roundIndex: number) => void;
  gameState: 'waiting' | 'playing' | 'ended';
}

// Add shimmer and pulse animation styles
const animationStyles = `
  @keyframes shimmer {
    0% { transform: translateX(-100%) rotate(45deg); }
    50% { transform: translateX(100%) rotate(45deg); }
    100% { transform: translateX(-100%) rotate(45deg); }
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 0.8; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.02); }
  }
  
  @keyframes glow {
    0%, 100% { filter: brightness(1) saturate(1); }
    50% { filter: brightness(1.2) saturate(1.3); }
  }
`;

// Inject styles
if (typeof document !== 'undefined' && !document.getElementById('animation-styles')) {
  const style = document.createElement('style');
  style.id = 'animation-styles';
  style.textContent = animationStyles;
  document.head.appendChild(style);
}

const RoundPlanner: React.FC<RoundPlannerProps> = ({
  rounds,
  onUpdateRounds,
  playlists,
  currentRound,
  onStartRound,
  gameState
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [draggedPlaylist, setDraggedPlaylist] = useState<Playlist | null>(null);
  const [dragOverBucket, setDragOverBucket] = useState<number | null>(null);

  // Utility function to ensure consistent round numbering
  const ensureSequentialNumbering = (roundsToNumber: EventRound[]) => {
    return roundsToNumber.map((round, index) => ({
      ...round,
      name: `Round ${index + 1}`
    }));
  };

  // Fix numbering on component mount if needed
  useEffect(() => {
    const hasInconsistentNumbering = rounds.some((round, index) => 
      round.name !== `Round ${index + 1}`
    );
    
    if (hasInconsistentNumbering) {
      console.log('🔢 Fixing inconsistent round numbering');
      const fixedRounds = ensureSequentialNumbering(rounds);
      onUpdateRounds(fixedRounds);
    }
  }, [rounds, onUpdateRounds]);

  const addRound = () => {
    const newRound: EventRound = {
      id: `round-${Date.now()}`,
      name: `Round ${rounds.length + 1}`,
      playlistIds: [],
      playlistNames: [],
      songCount: 0,
      status: 'unplanned'
    };
    const updatedRounds = [...rounds, newRound];
    const renumberedRounds = ensureSequentialNumbering(updatedRounds);
    onUpdateRounds(renumberedRounds);
  };

  const removeRound = (index: number) => {
    if (rounds.length > 1) {
      const filteredRounds = rounds.filter((_, i) => i !== index);
      const renumberedRounds = ensureSequentialNumbering(filteredRounds);
      onUpdateRounds(renumberedRounds);
    }
  };

  const addPlaylistToRound = (roundIndex: number, playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    const newRounds = [...rounds];
    const round = newRounds[roundIndex];
    
    // Don't add if already exists
    if (round.playlistIds.includes(playlistId)) return;
    
    // Add playlist to the round
    newRounds[roundIndex] = {
      ...round,
      playlistIds: [...round.playlistIds, playlist.id],
      playlistNames: [...round.playlistNames, playlist.name],
      songCount: round.songCount + playlist.tracks,
      status: round.status === 'unplanned' ? 'planned' : round.status
    };
    onUpdateRounds(newRounds);
  };

  const removePlaylistFromRound = (roundIndex: number, playlistId: string) => {
    const newRounds = [...rounds];
    const round = newRounds[roundIndex];
    const playlistIndex = round.playlistIds.indexOf(playlistId);
    
    if (playlistIndex === -1) return;
    
    const playlist = playlists.find(p => p.id === playlistId);
    const playlistTracks = playlist?.tracks || 0;
    
    newRounds[roundIndex] = {
      ...round,
      playlistIds: round.playlistIds.filter(id => id !== playlistId),
      playlistNames: round.playlistNames.filter((_, i) => i !== playlistIndex),
      songCount: Math.max(0, round.songCount - playlistTracks),
      status: round.playlistIds.length === 1 ? 'unplanned' : round.status
    };
    onUpdateRounds(newRounds);
  };

  // Playlist drag handlers
  const handlePlaylistDragStart = (e: React.DragEvent, playlist: Playlist) => {
    setDraggedPlaylist(playlist);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', playlist.id);
  };

  const handlePlaylistDragEnd = () => {
    setDraggedPlaylist(null);
    setDragOverBucket(null);
  };

  // Bucket drop handlers
  const handleBucketDragOver = (e: React.DragEvent, bucketIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    console.log('🎯 Drag over bucket:', bucketIndex);
    setDragOverBucket(bucketIndex);
  };

  const handleBucketDragLeave = (e: React.DragEvent) => {
    // Only clear drag over if we're actually leaving the bucket area
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverBucket(null);
    }
  };

  const handleBucketDrop = (e: React.DragEvent, bucketIndex: number) => {
    e.preventDefault();
    const playlistId = e.dataTransfer.getData('text/plain');
    
    console.log('🎯 Bucket drop:', { bucketIndex, playlistId });
    
    if (playlistId) {
      // Find the playlist from the playlists prop
      const playlist = playlists.find(p => p.id === playlistId);
      console.log('🎵 Found playlist:', playlist?.name);
      if (playlist) {
        addPlaylistToRound(bucketIndex, playlistId);
        console.log('✅ Added playlist to round');
      }
    }
    
    setDraggedPlaylist(null);
    setDragOverBucket(null);
  };

  const getStatusIcon = (status: EventRound['status'], isActive: boolean) => {
    if (isActive) return <Play className="w-4 h-4 text-green-400" />;
    
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'planned':
        return <Circle className="w-4 h-4 text-blue-400" />;
      case 'unplanned':
        return <Circle className="w-4 h-4 text-gray-400" />;
      default:
        return <Circle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getNextRoundIndex = () => {
    return rounds.findIndex(round => round.status === 'planned');
  };

  const canStartNextRound = () => {
    const nextIndex = getNextRoundIndex();
    return nextIndex !== -1 && gameState !== 'playing';
  };

  const canStartRound = (round: EventRound) => {
    return (round.playlistIds || []).length > 0 && round.status !== 'completed';
  };

  return (
    <div className="bg-rgba(42, 42, 42, 0.8) backdrop-blur-[20px] border border-rgba(0, 255, 136, 0.2) rounded-2xl p-6 mb-6 w-full max-w-none">
      <div 
        className="flex items-center justify-between cursor-pointer mb-4"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-3">
          <Folder className="w-6 h-6 text-[#00ff88]" />
          <h3 className="text-xl font-semibold text-white">Round Buckets</h3>
          <span className="text-sm text-gray-400">
            Drag playlists into buckets to organize rounds
          </span>
        </div>
        <div className="flex items-center gap-3">
          {canStartNextRound() && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartRound(getNextRoundIndex());
              }}
              className="px-4 py-2 bg-[#00ff88] text-black font-semibold rounded-lg hover:bg-[#00cc6a] transition-colors"
            >
              Start Next Round
            </button>
          )}
          {isCollapsed ? (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="space-y-4">
          {/* Instructions */}
          <div className="text-center text-gray-300 text-sm bg-gradient-to-r from-[#00ff88]/10 to-[#00ff88]/5 border border-[#00ff88]/20 rounded-lg p-4">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Music className="w-4 h-4 text-[#00ff88]" />
              <span className="font-semibold text-white">Round Organization</span>
            </div>
            <span>Drag playlists from above into round buckets to organize your event</span>
          </div>

          {/* Round Buckets */}
          <div className="flex gap-2 w-full min-w-0" style={{ width: '100vw', marginLeft: 'calc(-50vw + 50%)', marginRight: 'calc(-50vw + 50%)', paddingLeft: '2rem', paddingRight: '2rem' }}>
            {rounds.slice(0, 6).map((round, index) => {
              const isActive = index === currentRound && gameState === 'playing';
              const minRequired = round.songCount >= 60 ? 75 : 15;
              const isInsufficient = round.songCount > 0 && round.songCount < minRequired;
              const isDragOver = dragOverBucket === index;
              
              return (
                <div
                  key={round.id}
                  onDragOver={(e) => handleBucketDragOver(e, index)}
                  onDragLeave={(e) => handleBucketDragLeave(e)}
                  onDrop={(e) => handleBucketDrop(e, index)}
                  className={`relative transition-all duration-200 ${
                    isDragOver ? 'scale-105' : ''
                  }`}
                  style={{ flex: '2 1 0%', minWidth: '300px' }}
                >
                  {/* Bucket Container */}
                  <div 
                    className={`h-full min-h-[200px] p-4 rounded-2xl border-2 backdrop-blur-lg transition-all duration-300 shadow-lg ${
                      isActive
                        ? 'border-green-400 bg-gradient-to-br from-green-400/20 to-green-400/5 shadow-green-400/30'
                        : isDragOver
                        ? 'border-green-400 bg-gradient-to-br from-green-400/15 to-green-400/3 shadow-green-400/25'
                        : isInsufficient
                        ? 'border-yellow-400 bg-gradient-to-br from-yellow-400/15 to-yellow-400/3 shadow-yellow-400/20'
                        : 'border-white/30 bg-gradient-to-br from-white/10 to-white/2 hover:border-white/50 hover:shadow-white/10'
                    }`}
                    style={{
                      background: isActive 
                        ? 'linear-gradient(135deg, #00ff88 0%, rgba(0, 255, 136, 0.8) 20%, rgba(0, 255, 136, 0.3) 60%, rgba(0, 255, 136, 0.1) 100%)' 
                        : isDragOver 
                        ? 'linear-gradient(135deg, rgba(0, 255, 136, 0.6) 0%, rgba(0, 255, 136, 0.4) 30%, rgba(0, 255, 136, 0.2) 70%, rgba(0, 255, 136, 0.05) 100%)' 
                        : isInsufficient 
                        ? 'linear-gradient(135deg, #ff6b35 0%, rgba(255, 107, 53, 0.6) 30%, rgba(255, 107, 53, 0.2) 70%, rgba(255, 107, 53, 0.05) 100%)' 
                        : 'linear-gradient(135deg, rgba(138, 43, 226, 0.4) 0%, rgba(75, 0, 130, 0.3) 30%, rgba(25, 25, 112, 0.2) 70%, rgba(0, 0, 0, 0.1) 100%)',
                      borderColor: isActive || isDragOver 
                        ? '#00ff88' 
                        : isInsufficient 
                        ? '#ff6b35' 
                        : '#8a2be2',
                      borderWidth: '3px',
                      borderStyle: 'solid',
                      backdropFilter: 'blur(25px)',
                      boxShadow: isActive 
                        ? '0 0 50px rgba(0, 255, 136, 0.8), 0 0 100px rgba(0, 255, 136, 0.4), 0 15px 35px rgba(0, 0, 0, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.3)' 
                        : isDragOver 
                        ? '0 0 40px rgba(0, 255, 136, 0.6), 0 0 80px rgba(0, 255, 136, 0.3), 0 12px 30px rgba(0, 0, 0, 0.25), inset 0 2px 0 rgba(255, 255, 255, 0.2)' 
                        : isInsufficient
                        ? '0 0 35px rgba(255, 107, 53, 0.6), 0 0 70px rgba(255, 107, 53, 0.3), 0 10px 25px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
                        : '0 0 30px rgba(138, 43, 226, 0.4), 0 0 60px rgba(138, 43, 226, 0.2), 0 8px 20px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
                      position: 'relative',
                      overflow: 'hidden',
                      transform: isDragOver ? 'scale(1.02)' : 'scale(1)',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                >
                  {/* Animated Background Effect */}
                  <div 
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: isActive 
                        ? `linear-gradient(45deg, transparent 20%, rgba(0, 255, 136, 0.4) 40%, rgba(255, 255, 255, 0.2) 50%, rgba(0, 255, 136, 0.4) 60%, transparent 80%)`
                        : isDragOver
                        ? `linear-gradient(45deg, transparent 30%, rgba(0, 255, 136, 0.3) 50%, transparent 70%)`
                        : `linear-gradient(45deg, transparent 40%, rgba(138, 43, 226, 0.1) 50%, transparent 60%)`,
                      animation: isActive ? 'shimmer 2s ease-in-out infinite' : isDragOver ? 'shimmer 2.5s ease-in-out infinite' : 'shimmer 4s ease-in-out infinite',
                      pointerEvents: 'none'
                    }}
                  />
                  
                  {/* Pulsing Border Effect */}
                  {isActive && (
                    <div 
                      style={{
                        position: 'absolute',
                        top: '-3px',
                        left: '-3px',
                        right: '-3px',
                        bottom: '-3px',
                        borderRadius: '1rem',
                        background: 'linear-gradient(45deg, #00ff88, #00cc6a, #00ff88, #00cc6a)',
                        animation: 'pulse 2s ease-in-out infinite',
                        pointerEvents: 'none',
                        zIndex: -1
                      }}
                    />
                  )}
                  
                  {/* Bucket Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(round.status, isActive)}
                      <span className="font-semibold text-white">{round.name}</span>
                    </div>
                    {isActive && (
                      <span className="px-2 py-1 bg-[#00ff88] text-black text-xs font-bold rounded-full">
                        ACTIVE
                      </span>
                    )}
                  </div>

                  {/* Drop Zone */}
                  <div className="space-y-1 mb-3 min-h-[100px] flex flex-col">
                    {(round.playlistIds || []).length === 0 ? (
                      <div className={`flex-1 flex flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all ${
                        isDragOver 
                          ? 'border-[#00ff88]/80 bg-[#00ff88]/10 text-[#00ff88] shadow-inner' 
                          : 'border-white/30 bg-white/5 text-gray-400'
                      }`}>
                        <div className={`w-8 h-8 mb-2 rounded-full border-2 border-dashed flex items-center justify-center ${
                          isDragOver ? 'border-[#00ff88] bg-[#00ff88]/10' : 'border-gray-500'
                        }`}>
                          <Music className={`w-4 h-4 ${isDragOver ? 'text-[#00ff88]' : 'text-gray-500'}`} />
                        </div>
                        <span className="text-sm font-semibold">
                          {isDragOver ? 'Release to Add' : 'Empty Round'}
                        </span>
                        <span className="text-xs opacity-75">
                          {isDragOver ? 'Drop playlist here' : 'Drag playlists to fill'}
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-2 flex-1">
                        {(round.playlistIds || []).map((playlistId) => {
                          const playlist = playlists.find(p => p.id === playlistId);
                          if (!playlist) return null;
                          
                          // Clean playlist name - remove GoT prefix and trim
                          const cleanName = playlist.name.replace(/^\s*GoT\s*[-–:]*\s*/i, '').trim();
                          
                          return (
                            <div 
                              key={playlistId} 
                              className="group relative"
                              style={{
                                background: 'linear-gradient(135deg, rgba(0, 255, 136, 0.15) 0%, rgba(0, 255, 136, 0.08) 50%, rgba(0, 255, 136, 0.03) 100%)',
                                border: '2px solid rgba(0, 255, 136, 0.3)',
                                borderRadius: '12px',
                                padding: '12px 16px',
                                backdropFilter: 'blur(10px)',
                                boxShadow: '0 4px 12px rgba(0, 255, 136, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                position: 'relative',
                                overflow: 'hidden'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                                e.currentTarget.style.boxShadow = '0 8px 20px rgba(0, 255, 136, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
                                e.currentTarget.style.borderColor = 'rgba(0, 255, 136, 0.5)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 255, 136, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
                                e.currentTarget.style.borderColor = 'rgba(0, 255, 136, 0.3)';
                              }}
                            >
                              {/* Subtle shimmer effect */}
                              <div 
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  background: 'linear-gradient(45deg, transparent 40%, rgba(255, 255, 255, 0.1) 50%, transparent 60%)',
                                  animation: 'shimmer 3s ease-in-out infinite',
                                  pointerEvents: 'none'
                                }}
                              />
                              
                              <div className="flex items-center justify-between relative z-10">
                                <span 
                                  className="font-semibold text-white truncate"
                                  style={{ 
                                    fontSize: '0.9rem',
                                    textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)'
                                  }}
                                >
                                  {cleanName}
                                </span>
                                
                                {!isActive && round.status !== 'completed' && (
                                  <button
                                    onClick={() => removePlaylistFromRound(index, playlistId)}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 ml-3 flex-shrink-0"
                                    style={{
                                      width: '24px',
                                      height: '24px',
                                      borderRadius: '50%',
                                      background: 'linear-gradient(135deg, #ff4757 0%, #ff3742 100%)',
                                      border: 'none',
                                      color: 'white',
                                      fontSize: '14px',
                                      fontWeight: 'bold',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                      boxShadow: '0 2px 6px rgba(255, 71, 87, 0.4)',
                                      transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.transform = 'scale(1.1)';
                                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(255, 71, 87, 0.6)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.transform = 'scale(1)';
                                      e.currentTarget.style.boxShadow = '0 2px 6px rgba(255, 71, 87, 0.4)';
                                    }}
                                    title="Remove playlist"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {isDragOver && (
                          <div className="flex items-center justify-center gap-2 h-12 border-2 border-dashed border-[#00ff88]/80 bg-[#00ff88]/10 backdrop-blur-sm rounded-lg text-[#00ff88] text-sm font-medium shadow-inner">
                            <Plus className="w-4 h-4" />
                            <span>Add Another Playlist</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Bucket Footer */}
                  <div className="border-t border-rgba(255, 255, 255, 0.1) pt-3">
                    {round.songCount > 0 && (
                      <div className="text-xs text-gray-400 mb-2">
                        {(round.playlistIds || []).length} playlist{(round.playlistIds || []).length !== 1 ? 's' : ''} • {round.songCount} songs
                        {(() => {
                          if (isInsufficient) {
                            return <span className="text-yellow-400 ml-2">⚠️ Need {minRequired - round.songCount} more</span>;
                          } else if (round.songCount >= minRequired) {
                            return <span className="text-green-400 ml-2">✓ Ready</span>;
                          }
                          return null;
                        })()}
                      </div>
                    )}
                    
                    <div className="flex gap-2">
                      {!isActive && round.status !== 'completed' && canStartRound(round) && (
                        <button
                          onClick={() => onStartRound(index)}
                          className="flex-1 px-3 py-1 bg-[#00ff88] text-black text-xs font-semibold rounded hover:bg-[#00cc6a] transition-colors"
                        >
                          Start Round
                        </button>
                      )}
                      
                      {rounds.length > 1 && round.status !== 'active' && (
                        <button
                          onClick={() => removeRound(index)}
                          className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded hover:bg-red-500/30 transition-colors"
                          title="Remove round"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  </div>
                </div>
              );
            })}
            
                  {/* Add Round Button */}
                  {rounds.length < 6 && (
                    <div style={{ flex: '2 1 0%', minWidth: '300px' }}>
                      <button
                        onClick={addRound}
                        className="w-full h-full min-h-[200px] p-4 rounded-2xl border-2 border-dashed 
                                 text-gray-400 hover:text-white transition-all duration-300 
                                 flex flex-col items-center justify-center gap-3"
                        style={{
                          borderColor: '#8a2be2',
                          background: 'linear-gradient(135deg, rgba(138, 43, 226, 0.3) 0%, rgba(75, 0, 130, 0.2) 30%, rgba(25, 25, 112, 0.1) 70%, rgba(0, 0, 0, 0.05) 100%)',
                          backdropFilter: 'blur(25px)',
                          boxShadow: '0 0 25px rgba(138, 43, 226, 0.3), 0 0 50px rgba(138, 43, 226, 0.15), 0 6px 18px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
                          position: 'relative',
                          overflow: 'hidden',
                          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#00ff88';
                          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0, 255, 136, 0.4) 0%, rgba(138, 43, 226, 0.3) 50%, rgba(75, 0, 130, 0.2) 100%)';
                          e.currentTarget.style.boxShadow = '0 0 35px rgba(0, 255, 136, 0.4), 0 0 70px rgba(138, 43, 226, 0.2), 0 8px 25px rgba(0, 0, 0, 0.15)';
                          e.currentTarget.style.transform = 'scale(1.02)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#8a2be2';
                          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(138, 43, 226, 0.3) 0%, rgba(75, 0, 130, 0.2) 30%, rgba(25, 25, 112, 0.1) 70%, rgba(0, 0, 0, 0.05) 100%)';
                          e.currentTarget.style.boxShadow = '0 0 25px rgba(138, 43, 226, 0.3), 0 0 50px rgba(138, 43, 226, 0.15), 0 6px 18px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.15)';
                          e.currentTarget.style.transform = 'scale(1)';
                        }}
                      >
                        <div className="w-12 h-12 rounded-full border-2 border-dashed border-white/60 flex items-center justify-center mb-2">
                          <Plus className="w-6 h-6 text-white" />
                        </div>
                        <span className="font-semibold text-sm text-white">Create New Round</span>
                        <span className="text-xs opacity-90 text-white">Click to add round</span>
                      </button>
                    </div>
                  )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RoundPlanner;
