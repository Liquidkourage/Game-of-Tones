import React, { useState, useEffect } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import HostSubmodalPortal from './HostSubmodalPortal';
import './SongAliasModal.css';

interface SongAliasModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (songId: string, title: string, artist: string) => void;
  onClear: (songId: string) => void;
  songId: string;
  originalTitle: string;
  originalArtist: string;
  aliasTitle?: string;
  aliasArtist?: string;
}

const SongAliasModal: React.FC<SongAliasModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onClear,
  songId,
  originalTitle,
  originalArtist,
  aliasTitle,
  aliasArtist,
}) => {
  const [editedTitle, setEditedTitle] = useState(aliasTitle || originalTitle);
  const [editedArtist, setEditedArtist] = useState(aliasArtist || originalArtist);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEditedTitle(aliasTitle || originalTitle);
      setEditedArtist(aliasArtist || originalArtist);
      setHasChanges(false);
    }
  }, [isOpen, aliasTitle, aliasArtist, originalTitle, originalArtist]);

  const baselineTitle = aliasTitle || originalTitle;
  const baselineArtist = aliasArtist || originalArtist;

  const updateChanges = (title: string, artist: string) => {
    setHasChanges(title !== baselineTitle || artist !== baselineArtist);
  };

  const titleOk = editedTitle.trim().length > 0;
  const artistOk = editedArtist.trim().length > 0;
  const canSave = hasChanges && titleOk && artistOk;

  const handleSave = () => {
    if (!canSave) return;
    onSave(songId, editedTitle.trim(), editedArtist.trim());
    onClose();
  };

  const handleReset = () => {
    if (aliasTitle || aliasArtist) {
      onClear(songId);
    }
    setEditedTitle(originalTitle);
    setEditedArtist(originalArtist);
    setHasChanges(false);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSave();
    }
  };

  if (!isOpen) return null;

  return (
    <HostSubmodalPortal
      isOpen={isOpen}
      onClose={onClose}
      title="Alias track"
      subtitle="Shown on bingo cards, the projector, and printouts. Playback still uses the original track."
      titleId="host-song-alias-title"
      maxWidth="520px"
    >
      <div className="host-ui host-song-alias">
        <div className="host-song-alias__field">
          <span className="host-song-alias__field-label">Original (from catalog)</span>
          <div className="host-song-alias__original">
            {originalTitle}
            <br />
            <span className="host-song-alias__original-artist">by {originalArtist || '—'}</span>
          </div>
        </div>

        <div className="host-song-alias__field">
          <label className="host-song-alias__field-label host-song-alias__field-label--accent" htmlFor="host-song-alias-title-input">
            Display title
          </label>
          <input
            id="host-song-alias-title-input"
            type="text"
            className="host-field-text"
            value={editedTitle}
            onChange={(e) => {
              setEditedTitle(e.target.value);
              updateChanges(e.target.value, editedArtist);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Title on cards and projector"
            autoFocus
          />
        </div>

        <div className="host-song-alias__field">
          <label className="host-song-alias__field-label host-song-alias__field-label--accent" htmlFor="host-song-alias-artist-input">
            Display artist
          </label>
          <input
            id="host-song-alias-artist-input"
            type="text"
            className="host-field-text"
            value={editedArtist}
            onChange={(e) => {
              setEditedArtist(e.target.value);
              updateChanges(editedTitle, e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Artist on cards and projector"
          />
          {!artistOk && hasChanges ? (
            <div className="host-song-alias__error">Artist is required.</div>
          ) : null}
        </div>

        <p className="host-song-alias__hint">Ctrl+Enter to save · Escape to cancel</p>

        <div className="host-song-alias__actions">
          <button
            type="button"
            onClick={handleReset}
            disabled={!aliasTitle && !aliasArtist && !hasChanges}
            className="btn-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              opacity: aliasTitle || aliasArtist || hasChanges ? 1 : 0.5,
            }}
          >
            <RotateCcw size={16} aria-hidden />
            Reset to original
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              opacity: canSave ? 1 : 0.5,
            }}
          >
            <Save size={16} aria-hidden />
            Save alias
          </button>
        </div>
      </div>
    </HostSubmodalPortal>
  );
};

export default SongAliasModal;
