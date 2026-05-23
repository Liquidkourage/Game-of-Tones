import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, RotateCcw } from 'lucide-react';

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
      handleSave();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="modal-overlay"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2
                style={{
                  color: '#00ffa3',
                  fontSize: '1.3rem',
                  fontWeight: '600',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                Alias track
              </h2>
              <button type="button" onClick={onClose} className="modal-close-btn" aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ padding: '20px 0' }}>
              <p style={{ color: '#b3b3b3', fontSize: '0.9rem', marginTop: 0, marginBottom: '16px' }}>
                Shown on bingo cards, the projector, and printouts. Playback still uses the original track.
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: '#b3b3b3', fontSize: '0.9rem', marginBottom: '8px' }}>
                  Original (from catalog)
                </label>
                <div
                  style={{
                    padding: '12px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    color: '#a0a0a0',
                    fontSize: '0.9rem',
                  }}
                >
                  {originalTitle}
                  <br />
                  <span style={{ fontSize: '0.85rem' }}>by {originalArtist || '—'}</span>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: '#00ffa3', fontSize: '0.9rem', marginBottom: '8px' }}>
                  Display title
                </label>
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => {
                    setEditedTitle(e.target.value);
                    updateChanges(e.target.value, editedArtist);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Title on cards and projector"
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'rgba(255,255,255,0.08)',
                    border: '2px solid rgba(0,255,163,0.3)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '1rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', color: '#00ffa3', fontSize: '0.9rem', marginBottom: '8px' }}>
                  Display artist
                </label>
                <input
                  type="text"
                  value={editedArtist}
                  onChange={(e) => {
                    setEditedArtist(e.target.value);
                    updateChanges(editedTitle, e.target.value);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Artist on cards and projector"
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'rgba(255,255,255,0.08)',
                    border: '2px solid rgba(0,255,163,0.3)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '1rem',
                    outline: 'none',
                  }}
                />
                {!artistOk && hasChanges ? (
                  <div style={{ fontSize: '0.8rem', color: '#ff6b6b', marginTop: '4px' }}>
                    Artist is required.
                  </div>
                ) : null}
              </div>

              <div style={{ fontSize: '0.8rem', color: '#888' }}>Ctrl+Enter to save · Escape to cancel</div>
            </div>

            <div
              className="modal-footer"
              style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'flex-end',
                paddingTop: '20px',
                borderTop: '1px solid rgba(255,255,255,0.1)',
              }}
            >
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
                <RotateCcw size={16} />
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
                <Save size={16} />
                Save alias
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SongAliasModal;
