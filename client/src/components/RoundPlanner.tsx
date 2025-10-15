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
  Music
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
  playlistId: string | null;
  playlistName: string | null;
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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const addRound = () => {
    const newRound: EventRound = {
      id: `round-${Date.now()}`,
      name: `Round ${rounds.length + 1}`,
      playlistId: null,
      playlistName: null,
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

  const updateRoundPlaylist = (index: number, playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    const newRounds = [...rounds];
    newRounds[index] = {
      ...newRounds[index],
      playlistId: playlist.id,
      playlistName: playlist.name,
      songCount: playlist.tracks,
      status: newRounds[index].status === 'unplanned' ? 'planned' : newRounds[index].status
    };
    onUpdateRounds(newRounds);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) return;

    const newRounds = [...rounds];
    const draggedRound = newRounds[draggedIndex];
    newRounds.splice(draggedIndex, 1);
    newRounds.splice(dropIndex, 0, draggedRound);
    
    onUpdateRounds(newRounds);
    setDraggedIndex(null);
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

  return (
    <div className="bg-rgba(42, 42, 42, 0.8) backdrop-blur-[20px] border border-rgba(0, 255, 136, 0.2) rounded-2xl p-6 mb-6">
      <div 
        className="flex items-center justify-between cursor-pointer mb-4"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-3">
          <Music className="w-6 h-6 text-[#00ff88]" />
          <h3 className="text-xl font-semibold text-white">Event Rounds</h3>
          <span className="text-sm text-gray-400">
            ({rounds.filter(r => r.status === 'completed').length}/{rounds.length} completed)
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
        <div className="space-y-3">
          {rounds.map((round, index) => {
            const isActive = index === currentRound && gameState === 'playing';
            const minRequired = round.songCount >= 60 ? 75 : 15;
            const isInsufficient = round.songCount > 0 && round.songCount < minRequired;
            
            return (
              <div
                key={round.id}
                className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                  isActive 
                    ? 'bg-rgba(0, 255, 136, 0.1) border-[#00ff88]' 
                    : isInsufficient
                    ? 'bg-rgba(255, 193, 7, 0.1) border-rgba(255, 193, 7, 0.3) hover:bg-rgba(255, 193, 7, 0.15)'
                    : 'bg-rgba(255, 255, 255, 0.05) border-rgba(255, 255, 255, 0.1) hover:bg-rgba(255, 255, 255, 0.08)'
                }`}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
              >
                <GripVertical className="w-4 h-4 text-gray-500 cursor-grab" />
                
                {getStatusIcon(round.status, isActive)}
                
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-white">{round.name}</span>
                    {isActive && (
                      <span className="px-2 py-1 bg-[#00ff88] text-black text-xs font-bold rounded-full">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-4 mt-1">
                    {round.playlistId ? (
                      <select
                        value={round.playlistId}
                        onChange={(e) => updateRoundPlaylist(index, e.target.value)}
                        className="bg-rgba(255, 255, 255, 0.1) border border-rgba(255, 255, 255, 0.2) rounded-lg px-3 py-1 text-white text-sm"
                        disabled={round.status === 'completed' || isActive}
                      >
                        <option value={round.playlistId}>{round.playlistName}</option>
                        {playlists
                          .filter(p => p.id !== round.playlistId)
                          .map(playlist => {
                            const minRequired = playlist.tracks >= 60 ? 75 : 15;
                            const isInsufficient = playlist.tracks < minRequired;
                            const modeText = minRequired === 75 ? '1x75' : '5x15';
                            return (
                              <option key={playlist.id} value={playlist.id}>
                                {playlist.name} ({playlist.tracks} songs) {isInsufficient ? `⚠️ needs ${minRequired - playlist.tracks} more for ${modeText}` : `✓ ${modeText} ready`}
                              </option>
                            );
                          })}
                      </select>
                    ) : (
                      <select
                        value=""
                        onChange={(e) => updateRoundPlaylist(index, e.target.value)}
                        className="bg-rgba(255, 255, 255, 0.1) border border-rgba(255, 255, 255, 0.2) rounded-lg px-3 py-1 text-white text-sm"
                      >
                        <option value="">Select Playlist...</option>
                        {playlists.map(playlist => {
                          const minRequired = playlist.tracks >= 60 ? 75 : 15;
                          const isInsufficient = playlist.tracks < minRequired;
                          const modeText = minRequired === 75 ? '1x75' : '5x15';
                          return (
                            <option key={playlist.id} value={playlist.id}>
                              {playlist.name} ({playlist.tracks} songs) {isInsufficient ? `⚠️ needs ${minRequired - playlist.tracks} more for ${modeText}` : `✓ ${modeText} ready`}
                            </option>
                          );
                        })}
                      </select>
                    )}
                    
                    {round.songCount > 0 && (
                      <>
                        <span className="text-sm text-gray-400">
                          {round.songCount} songs
                        </span>
                        {(() => {
                          const minRequired = round.songCount >= 60 ? 75 : 15;
                          const isInsufficient = round.songCount < minRequired;
                          const modeText = minRequired === 75 ? '1x75' : '5x15';
                          
                          if (isInsufficient) {
                            return (
                              <span className="text-xs text-yellow-400 font-semibold">
                                ⚠️ Need {minRequired - round.songCount} more for {modeText}
                              </span>
                            );
                          } else {
                            return (
                              <span className="text-xs text-green-400 font-semibold">
                                ✓ {modeText} ready
                              </span>
                            );
                          }
                        })()}
                      </>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {!isActive && round.status !== 'completed' && round.playlistId && (
                    <button
                      onClick={() => onStartRound(index)}
                      className="p-2 bg-[#00ff88] text-black rounded-lg hover:bg-[#00cc6a] transition-colors"
                      title="Start this round"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  
                  {rounds.length > 1 && round.status !== 'active' && (
                    <button
                      onClick={() => removeRound(index)}
                      className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                      title="Remove round"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          
          <button
            onClick={addRound}
            className="flex items-center gap-2 w-full p-4 border-2 border-dashed border-rgba(255, 255, 255, 0.2) rounded-xl text-gray-400 hover:text-white hover:border-rgba(255, 255, 255, 0.4) transition-colors"
          >
            <Plus className="w-5 h-5" />
            Add Round
          </button>
        </div>
      )}
    </div>
  );
};

export default RoundPlanner;
