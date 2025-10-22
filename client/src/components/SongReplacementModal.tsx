import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Music, Play, Pause, Loader2 } from 'lucide-react';

interface Song {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration_ms: number;
  preview_url?: string;
  uri: string;
}

interface SongReplacementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReplace: (newSongId: string) => void;
  currentSong: {
    id: string;
    name: string;
    artist: string;
    sourcePlaylistName?: string;
  };
  roomId: string;
}

const SongReplacementModal: React.FC<SongReplacementModalProps> = ({
  isOpen,
  onClose,
  onReplace,
  currentSong,
  roomId
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  // Clean up audio when component unmounts or modal closes
  useEffect(() => {
    return () => {
      if (audio) {
        audio.pause();
        audio.src = '';
      }
    };
  }, [audio]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setSelectedSong(null);
      setIsSearching(false);
      setIsReplacing(false);
      if (audio) {
        audio.pause();
        setAudio(null);
      }
      setPlayingPreview(null);
    }
  }, [isOpen, audio]);

  const searchSongs = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_BASE || ''}/api/spotify/search-tracks?q=${encodeURIComponent(query)}&limit=20`);
      const data = await response.json();
      
      if (data.success) {
        setSearchResults(data.tracks || []);
      } else {
        console.error('Search failed:', data.error);
        setSearchResults([]);
      }
    } catch (error) {
      console.error('Error searching songs:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    searchSongs(searchQuery);
  };

  const handleReplace = async () => {
    if (!selectedSong) return;

    setIsReplacing(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_BASE || ''}/api/spotify/replace-song`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId,
          oldSongId: currentSong.id,
          newSongId: selectedSong.id
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        onReplace(selectedSong.id);
        onClose();
      } else {
        console.error('Replace failed:', data.error);
        alert(`Failed to replace song: ${data.error}`);
      }
    } catch (error) {
      console.error('Error replacing song:', error);
      alert('Failed to replace song. Please try again.');
    } finally {
      setIsReplacing(false);
    }
  };

  const playPreview = (previewUrl: string, songId: string) => {
    if (audio) {
      audio.pause();
      audio.src = '';
    }

    if (playingPreview === songId) {
      setPlayingPreview(null);
      return;
    }

    const newAudio = new Audio(previewUrl);
    newAudio.volume = 0.5;
    newAudio.play();
    
    newAudio.onended = () => {
      setPlayingPreview(null);
    };

    newAudio.onerror = () => {
      setPlayingPreview(null);
    };

    setAudio(newAudio);
    setPlayingPreview(songId);
  };

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-gray-900 rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Replace Song</h2>
              <div className="text-gray-300">
                <div className="font-medium">Current: {currentSong.name}</div>
                <div className="text-sm">by {currentSong.artist}</div>
                {currentSong.sourcePlaylistName && (
                  <div className="text-xs text-gray-400">from {currentSong.sourcePlaylistName}</div>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X size={24} />
            </button>
          </div>

          {/* Search */}
          <form onSubmit={handleSearch} className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for a replacement song..."
                className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 animate-spin" size={20} />
              )}
            </div>
          </form>

          {/* Search Results */}
          <div className="flex-1 overflow-y-auto">
            {searchResults.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-white mb-3">Search Results</h3>
                {searchResults.map((song) => (
                  <div
                    key={song.id}
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      border: selectedSong?.id === song.id 
                        ? '2px solid #3b82f6' 
                        : '1px solid #374151',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      background: selectedSong?.id === song.id 
                        ? 'rgba(59, 130, 246, 0.1)' 
                        : '#1f2937',
                      marginBottom: '8px'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedSong?.id !== song.id) {
                        e.currentTarget.style.background = '#374151';
                        e.currentTarget.style.borderColor = '#6b7280';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedSong?.id !== song.id) {
                        e.currentTarget.style.background = '#1f2937';
                        e.currentTarget.style.borderColor = '#374151';
                      }
                    }}
                    onClick={() => setSelectedSong(song)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '8px' 
                        }}>
                          <div className="font-medium text-white">{song.name}</div>
                          {selectedSong?.id === song.id && (
                            <span style={{ 
                              color: '#3b82f6', 
                              fontSize: '16px',
                              fontWeight: 'bold'
                            }}>
                              ✓
                            </span>
                          )}
                        </div>
                        <div className="text-gray-300 text-sm">{song.artist}</div>
                        <div className="text-gray-400 text-xs">{song.album}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-gray-400 text-sm">
                          {formatDuration(song.duration_ms)}
                        </div>
                        {song.preview_url && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              playPreview(song.preview_url!, song.id);
                            }}
                            className="text-gray-400 hover:text-white transition-colors"
                          >
                            {playingPreview === song.id ? (
                              <Pause size={16} />
                            ) : (
                              <Play size={16} />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {searchQuery && !isSearching && searchResults.length === 0 && (
              <div className="text-center text-gray-400 py-8">
                <Music size={48} className="mx-auto mb-4 opacity-50" />
                <p>No songs found for "{searchQuery}"</p>
                <p className="text-sm">Try a different search term</p>
              </div>
            )}

            {!searchQuery && (
              <div className="text-center text-gray-400 py-8">
                <Search size={48} className="mx-auto mb-4 opacity-50" />
                <p>Search for a song to replace "{currentSong.name}"</p>
                <p className="text-sm">This will update both the game and the original playlist</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-700">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleReplace}
              disabled={!selectedSong || isReplacing}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
            >
              {isReplacing && <Loader2 size={16} className="animate-spin" />}
              Replace Song
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default SongReplacementModal;
