import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, RotateCcw } from 'lucide-react';

interface SongTitleEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (songId: string, customTitle: string) => void;
  songId: string;
  originalTitle: string;
  customTitle?: string;
  artistName: string;
}

const SongTitleEditModal: React.FC<SongTitleEditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  songId,
  originalTitle,
  customTitle,
  artistName
}) => {
  const [editedTitle, setEditedTitle] = useState(customTitle || originalTitle);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEditedTitle(customTitle || originalTitle);
      setHasChanges(false);
    }
  }, [isOpen, customTitle, originalTitle]);

  const handleTitleChange = (value: string) => {
    setEditedTitle(value);
    setHasChanges(value !== (customTitle || originalTitle));
  };

  const handleSave = () => {
    onSave(songId, editedTitle);
    onClose();
  };

  const handleReset = () => {
    setEditedTitle(originalTitle);
    setHasChanges(false);
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
            transition={{ type: "spring", duration: 0.3 }}
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 style={{ 
                color: '#00ffa3', 
                fontSize: '1.3rem', 
                fontWeight: '600',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                ✏️ Edit Song Title
              </h2>
              <button
                onClick={onClose}
                className="modal-close-btn"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#b3b3b3',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ padding: '20px 0' }}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ 
                  display: 'block', 
                  color: '#b3b3b3', 
                  fontSize: '0.9rem', 
                  marginBottom: '8px',
                  fontWeight: '500'
                }}>
                  Artist
                </label>
                <div style={{
                  padding: '12px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  color: '#e0e0e0',
                  fontSize: '1rem'
                }}>
                  {artistName}
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ 
                  display: 'block', 
                  color: '#b3b3b3', 
                  fontSize: '0.9rem', 
                  marginBottom: '8px',
                  fontWeight: '500'
                }}>
                  Original Title
                </label>
                <div style={{
                  padding: '12px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  color: '#a0a0a0',
                  fontSize: '0.9rem',
                  fontStyle: 'italic'
                }}>
                  {originalTitle}
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ 
                  display: 'block', 
                  color: '#00ffa3', 
                  fontSize: '0.9rem', 
                  marginBottom: '8px',
                  fontWeight: '500'
                }}>
                  Custom Title (for Game of Tones)
                </label>
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter custom title..."
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'rgba(255,255,255,0.08)',
                    border: '2px solid rgba(0,255,163,0.3)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '1rem',
                    outline: 'none',
                    transition: 'border-color 0.2s ease'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#00ffa3';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(0,255,163,0.3)';
                  }}
                />
                <div style={{ 
                  fontSize: '0.8rem', 
                  color: '#888', 
                  marginTop: '4px' 
                }}>
                  Press Ctrl+Enter to save, Escape to cancel
                </div>
              </div>

              {hasChanges && (
                <div style={{
                  padding: '12px',
                  background: 'rgba(0,255,163,0.1)',
                  border: '1px solid rgba(0,255,163,0.3)',
                  borderRadius: '8px',
                  marginBottom: '16px'
                }}>
                  <div style={{ color: '#00ffa3', fontSize: '0.9rem', fontWeight: '500' }}>
                    Preview: {editedTitle}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end',
              paddingTop: '20px',
              borderTop: '1px solid rgba(255,255,255,0.1)'
            }}>
              <button
                onClick={handleReset}
                disabled={!hasChanges}
                className="btn-secondary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  opacity: hasChanges ? 1 : 0.5,
                  cursor: hasChanges ? 'pointer' : 'not-allowed'
                }}
              >
                <RotateCcw size={16} />
                Reset
              </button>
              <button
                onClick={handleSave}
                disabled={!hasChanges}
                className="btn-primary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  opacity: hasChanges ? 1 : 0.5,
                  cursor: hasChanges ? 'pointer' : 'not-allowed'
                }}
              >
                <Save size={16} />
                Save Changes
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SongTitleEditModal;
