import React, { useState, useEffect } from 'react';
import type { BingoPattern, PatternCompositeSpec } from '../patternDefinitions';
import {
  ChevronDown,
  ChevronUp,
  Play,
  CheckCircle,
  Circle,
  Plus,
  Trash2,
  Music,
  Folder
} from 'lucide-react';

interface Playlist {
  id: string;
  name: string;
  tracks: number;
  description?: string;
  /** Present when row comes from YouTube Music merge (drag/drop resolution). */
  youtubeMusic?: boolean;
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
  bingoPattern?: BingoPattern;
  customPatternMask?: string[];
  patternComposite?: PatternCompositeSpec;
  freeSpaceEnabled?: boolean;
}

interface RoundPlannerProps {
  rounds: EventRound[];
  onUpdateRounds: (rounds: EventRound[]) => void;
  playlists: Playlist[];
  currentRound: number;
  onStartRound: (roundIndex: number) => void;
  /** Sync this round's playlists into the host mix + pattern/snippet UI without starting the live game */
  onSelectRoundForPrep?: (roundIndex: number) => void;
  gameState: 'waiting' | 'playing' | 'ended';
}

/**
 * Max round buckets in the planner. This is a UI cap so the grid stays manageable;
 * game logic stores rounds as an array and does not require exactly 6.
 */
const MAX_ROUND_BUCKETS = 12;

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
  onSelectRoundForPrep,
  gameState
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
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
    if (rounds.length >= MAX_ROUND_BUCKETS) return;
    const newRound: EventRound = {
      id: `round-${Date.now()}`,
      name: `Round ${rounds.length + 1}`,
      playlistIds: [],
      playlistNames: [],
      songCount: 0,
      status: 'unplanned',
      bingoPattern: 'line',
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
    for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i];
      if (r.status === 'planned' && (r.playlistIds || []).length > 0) return i;
    }
    return -1;
  };

  const nextRoundIndex = getNextRoundIndex();
  const canStartNextRound = () => nextRoundIndex !== -1 && gameState !== 'playing';

  const startNextRoundDisabledReason = (): string | null => {
    if (gameState === 'playing') {
      return 'Finish or pause the live game first, then start the next round.';
    }
    if (nextRoundIndex === -1) {
      const hasPlannedEmpty = rounds.some(
        r => r.status === 'planned' && (r.playlistIds || []).length === 0
      );
      if (hasPlannedEmpty) {
        return 'Add playlists to the next planned round until it shows Ready.';
      }
      return 'No round is queued yet — drag playlists into a bucket until it\'s planned and ready.';
    }
    return null;
  };

  const canStartRound = (round: EventRound) => {
    return (round.playlistIds || []).length > 0 && round.status !== 'completed';
  };

  return (
    <div className="bg-rgba(42, 42, 42, 0.8) backdrop-blur-[20px] border border-rgba(0, 255, 136, 0.2) rounded-2xl p-6 mb-6 w-full max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Folder className="w-6 h-6 text-[#00ff88] shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-white leading-tight">Round buckets</h3>
            <p className="text-sm text-gray-400 mt-1">
              Drag playlists from the list above into each bucket. Up to {MAX_ROUND_BUCKETS} rounds.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 w-full sm:w-auto">
          <button
            type="button"
            disabled={!canStartNextRound()}
            title={startNextRoundDisabledReason() || 'Start the next queued round (syncs playlists)'}
            onClick={() => {
              if (!canStartNextRound()) return;
              onStartRound(nextRoundIndex);
            }}
            className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-sm sm:text-base transition-colors min-h-[44px] ${
              canStartNextRound()
                ? 'bg-[#00ff88] text-black hover:bg-[#00cc6a] shadow-[0_0_20px_rgba(0,255,136,0.35)]'
                : 'bg-white/10 text-gray-500 cursor-not-allowed border border-white/10'
            }`}
          >
            <Play className="w-4 h-4 shrink-0" aria-hidden />
            Start next round
          </button>
          <button
            type="button"
            onClick={() => setIsCollapsed((c) => !c)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-white/20 text-gray-300 hover:bg-white/10 hover:text-white transition-colors min-h-[44px]"
            aria-expanded={!isCollapsed}
            aria-controls="round-planner-buckets"
            title={isCollapsed ? 'Expand round buckets' : 'Collapse round buckets'}
          >
            {isCollapsed ? (
              <>
                <ChevronDown className="w-5 h-5" aria-hidden />
                <span className="text-sm font-medium">Show</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-5 h-5" aria-hidden />
                <span className="text-sm font-medium">Hide</span>
              </>
            )}
          </button>
        </div>
      </div>
      {!canStartNextRound() && (
        <p className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-400/25 rounded-lg px-3 py-2 mb-3">
          {startNextRoundDisabledReason()}
        </p>
      )}

      {!isCollapsed && (
        <div id="round-planner-buckets" className="space-y-4">
          <div className="text-center text-gray-300 text-sm bg-gradient-to-r from-[#00ff88]/10 to-[#00ff88]/5 border border-[#00ff88]/20 rounded-lg p-4">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Music className="w-4 h-4 text-[#00ff88]" />
              <span className="font-semibold text-white">Round organization</span>
            </div>
            <span>Use <strong className="text-white">Load for prep</strong> on a bucket to sync the mix for Save / PDF without starting the round. Use <strong className="text-white">Start round</strong> when you want the live handoff (marks active and opens Game).</span>
          </div>

          {/* Round Buckets — grid wraps to multiple rows (see round-planner-buckets-wrap in HostView.css) */}
          <div className="round-planner-buckets-wrap">
            {rounds.slice(0, MAX_ROUND_BUCKETS).map((round, index) => {
              const isActive = index === currentRound && gameState === 'playing';
              const isMixTarget = index === currentRound && gameState !== 'playing';
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
                  style={{ minWidth: 0 }}
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
                    {isMixTarget && (
                      <span className="px-2 py-1 bg-[#38bdf8]/25 text-[#7dd3fc] border border-[#38bdf8]/40 text-xs font-bold rounded-full">
                        Mix target
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
                                    type="button"
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
                    
                    <div className="flex flex-wrap gap-2 items-stretch">
                      {onSelectRoundForPrep &&
                        gameState !== 'playing' &&
                        (round.playlistIds || []).length > 0 && (
                          <button
                            type="button"
                            onClick={() => onSelectRoundForPrep(index)}
                            title="Put this round’s playlists in the mix and sync pattern/snippet controls — does not mark the round started"
                            className="flex-1 min-w-[140px] min-h-[44px] px-3 py-2.5 bg-sky-500/20 text-sky-100 border border-sky-400/40 text-sm font-bold rounded-lg hover:bg-sky-500/30 transition-colors flex items-center justify-center gap-2"
                          >
                            Load for prep
                          </button>
                        )}
                      {!isActive && round.status !== 'completed' && canStartRound(round) && (
                        <button
                          type="button"
                          onClick={() => onStartRound(index)}
                          title="Mark this round active and open the Game tab (live event flow)"
                          className="flex-1 min-w-[140px] min-h-[44px] px-3 py-2.5 bg-[#00ff88] text-black text-sm font-bold rounded-lg hover:bg-[#00cc6a] transition-colors flex items-center justify-center gap-2 shadow-[0_0_12px_rgba(0,255,136,0.25)]"
                        >
                          <Play className="w-4 h-4 shrink-0" aria-hidden />
                          Start round
                        </button>
                      )}
                      
                      {rounds.length > 1 && round.status !== 'active' && (
                        <button
                          type="button"
                          onClick={() => removeRound(index)}
                          className="px-3 py-2.5 min-h-[44px] min-w-[44px] bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors flex items-center justify-center shrink-0"
                          title="Remove round"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  </div>
                </div>
              );
            })}
            
                  {/* Add Round Button */}
                  {rounds.length < MAX_ROUND_BUCKETS && (
                    <div style={{ minWidth: 0 }}>
                      <button
                        type="button"
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
                          <Plus className="w-6 h-6 text-white" style={{ color: '#ffffff' }} />
                        </div>
                        <span className="font-bold text-base text-white" style={{ color: '#ffffff' }}>+ Add round</span>
                        <span className="text-xs opacity-90 text-white" style={{ color: '#ffffff' }}>
                          {MAX_ROUND_BUCKETS - rounds.length} slot{MAX_ROUND_BUCKETS - rounds.length !== 1 ? 's' : ''} left (max {MAX_ROUND_BUCKETS})
                        </span>
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
