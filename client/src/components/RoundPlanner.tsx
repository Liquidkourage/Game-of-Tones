import React, { useState } from 'react';
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

  const addRound = () => {
    const newRound: EventRound = {
      id: `round-${Date.now()}`,
      name: `Round ${rounds.length + 1}`,
      playlistIds: [],
      playlistNames: [],
      songCount: 0,
      status: 'unplanned'
    };
    onUpdateRounds([...rounds, newRound]);
  };

  const removeRound = (index: number) => {
    if (rounds.length > 1) {
      const newRounds = rounds.filter((_, i) => i !== index);
      onUpdateRounds(newRounds);
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
    setDragOverBucket(bucketIndex);
  };

  const handleBucketDragLeave = () => {
    setDragOverBucket(null);
  };

  const handleBucketDrop = (e: React.DragEvent, bucketIndex: number) => {
    e.preventDefault();
    const playlistId = e.dataTransfer.getData('text/plain');
    
    if (draggedPlaylist && playlistId === draggedPlaylist.id) {
      addPlaylistToRound(bucketIndex, playlistId);
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
    <div className="bg-rgba(42, 42, 42, 0.8) backdrop-blur-[20px] border border-rgba(0, 255, 136, 0.2) rounded-2xl p-6 mb-6">
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
        <div className="space-y-6">
          {/* Playlist Source Area */}
          <div className="bg-rgba(255, 255, 255, 0.05) border border-rgba(255, 255, 255, 0.1) rounded-xl p-4">
            <h4 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Music className="w-5 h-5" />
              Available Playlists
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-48 overflow-y-auto">
              {playlists.map(playlist => {
                const minRequired = playlist.tracks >= 60 ? 75 : 15;
                const isInsufficient = playlist.tracks < minRequired;
                const modeText = minRequired === 75 ? '1x75' : '5x15';
                const isUsed = rounds.some(round => (round.playlistIds || []).includes(playlist.id));
                
                return (
                  <div
                    key={playlist.id}
                    draggable
                    onDragStart={(e) => handlePlaylistDragStart(e, playlist)}
                    onDragEnd={handlePlaylistDragEnd}
                    className={`p-3 rounded-lg border cursor-grab transition-all ${
                      draggedPlaylist?.id === playlist.id
                        ? 'opacity-50 scale-95'
                        : isUsed
                        ? 'bg-rgba(0, 255, 136, 0.1) border-rgba(0, 255, 136, 0.3) opacity-60'
                        : isInsufficient
                        ? 'bg-rgba(255, 193, 7, 0.1) border-rgba(255, 193, 7, 0.3) hover:bg-rgba(255, 193, 7, 0.15)'
                        : 'bg-rgba(255, 255, 255, 0.05) border-rgba(255, 255, 255, 0.2) hover:bg-rgba(255, 255, 255, 0.1)'
                    }`}
                  >
                    <div className="text-sm font-semibold text-white truncate">
                      {playlist.name}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {playlist.tracks} songs
                    </div>
                    <div className="text-xs mt-1">
                      {isUsed ? (
                        <span className="text-green-400">✓ In use</span>
                      ) : isInsufficient ? (
                        <span className="text-yellow-400">⚠️ {modeText}</span>
                      ) : (
                        <span className="text-green-400">✓ {modeText} ready</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Round Buckets */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {rounds.slice(0, 6).map((round, index) => {
              const isActive = index === currentRound && gameState === 'playing';
              const minRequired = round.songCount >= 60 ? 75 : 15;
              const isInsufficient = round.songCount > 0 && round.songCount < minRequired;
              const isDragOver = dragOverBucket === index;
              
              return (
                <div
                  key={round.id}
                  onDragOver={(e) => handleBucketDragOver(e, index)}
                  onDragLeave={handleBucketDragLeave}
                  onDrop={(e) => handleBucketDrop(e, index)}
                  className={`p-4 rounded-xl border-2 border-dashed transition-all min-h-[200px] ${
                    isActive
                      ? 'border-[#00ff88] bg-rgba(0, 255, 136, 0.1)'
                      : isDragOver
                      ? 'border-[#00ff88] bg-rgba(0, 255, 136, 0.05) scale-105'
                      : isInsufficient
                      ? 'border-rgba(255, 193, 7, 0.5) bg-rgba(255, 193, 7, 0.05)'
                      : 'border-rgba(255, 255, 255, 0.2) bg-rgba(255, 255, 255, 0.02) hover:border-rgba(255, 255, 255, 0.4)'
                  }`}
                >
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
                  <div className="space-y-2 mb-3 min-h-[100px]">
                    {(round.playlistIds || []).length === 0 ? (
                      <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
                        {isDragOver ? (
                          <span className="text-[#00ff88]">Drop playlist here</span>
                        ) : (
                          <span>Drag playlists here</span>
                        )}
                      </div>
                    ) : (
                      (round.playlistIds || []).map((playlistId) => {
                        const playlist = playlists.find(p => p.id === playlistId);
                        if (!playlist) return null;
                        
                        return (
                          <div key={playlistId} className="flex items-center gap-2 bg-rgba(255, 255, 255, 0.1) rounded-lg px-2 py-1">
                            <span className="text-xs text-white flex-1 truncate">
                              {playlist.name} ({playlist.tracks})
                            </span>
                            {!isActive && round.status !== 'completed' && (
                              <button
                                onClick={() => removePlaylistFromRound(index, playlistId)}
                                className="text-red-400 hover:text-red-300 text-xs p-1"
                                title="Remove playlist"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })
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
              );
            })}
            
            {/* Add Round Button */}
            {rounds.length < 6 && (
              <button
                onClick={addRound}
                className="p-4 border-2 border-dashed border-rgba(255, 255, 255, 0.2) rounded-xl text-gray-400 hover:text-white hover:border-rgba(255, 255, 255, 0.4) transition-colors min-h-[200px] flex flex-col items-center justify-center gap-2"
              >
                <Plus className="w-8 h-8" />
                <span>Add Round</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RoundPlanner;
