import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, Trash2 } from 'lucide-react';
import { saveCustomPattern, validatePatternPositions } from '../patternDefinitions';

export interface CustomPatternSavePayload {
  name: string;
  positions: string[];
  matchAllowRotation?: boolean;
  matchAllowMirror?: boolean;
}

interface CustomPatternModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (pattern: CustomPatternSavePayload) => void;
  initialPattern?: CustomPatternSavePayload;
}

const CustomPatternModal: React.FC<CustomPatternModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialPattern,
}) => {
  const [patternName, setPatternName] = useState('');
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [matchAllowRotation, setMatchAllowRotation] = useState(false);
  const [matchAllowMirror, setMatchAllowMirror] = useState(false);
  const [isValid, setIsValid] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialPattern) {
        setPatternName(initialPattern.name);
        setSelectedPositions(initialPattern.positions);
        setMatchAllowRotation(initialPattern.matchAllowRotation === true);
        setMatchAllowMirror(initialPattern.matchAllowMirror === true);
      } else {
        setPatternName('');
        setSelectedPositions([]);
        setMatchAllowRotation(false);
        setMatchAllowMirror(false);
      }
    }
  }, [isOpen, initialPattern]);

  useEffect(() => {
    setIsValid(patternName.trim().length > 0 && selectedPositions.length > 0 && validatePatternPositions(selectedPositions));
  }, [patternName, selectedPositions]);

  const togglePosition = (row: number, col: number) => {
    const position = `${row}-${col}`;
    setSelectedPositions((prev) =>
      prev.includes(position) ? prev.filter((p) => p !== position) : [...prev, position],
    );
  };

  const handleSave = () => {
    if (isValid) {
      onSave({
        name: patternName.trim(),
        positions: selectedPositions,
        ...(matchAllowRotation ? { matchAllowRotation: true as const } : {}),
        ...(matchAllowMirror ? { matchAllowMirror: true as const } : {}),
      });
      onClose();
    }
  };

  const handleClear = () => {
    setSelectedPositions([]);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="modal-overlay"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px',
        }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="modal-content"
          style={{
            backgroundColor: 'rgba(20, 20, 20, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '16px',
            padding: '24px',
            maxWidth: '500px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            backdropFilter: 'blur(10px)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#ffffff' }}>
              {initialPattern ? 'Edit Custom Pattern' : 'Create Custom Pattern'}
            </h2>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#ffffff',
                cursor: 'pointer',
                padding: '8px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={20} />
            </button>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#ffffff', fontWeight: '500' }}>
              Pattern Name
            </label>
            <input
              type="text"
              value={patternName}
              onChange={(e) => setPatternName(e.target.value)}
              placeholder="Enter pattern name..."
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                color: '#ffffff',
                fontSize: '1rem',
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: 8 }}>
              <label style={{ color: '#ffffff', fontWeight: '500' }}>Select Pattern Squares</label>
              <button
                onClick={handleClear}
                type="button"
                style={{
                  background: 'rgba(255, 0, 0, 0.2)',
                  border: '1px solid rgba(255, 0, 0, 0.3)',
                  color: '#ff6b6b',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Trash2 size={14} />
                Clear
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                marginBottom: 14,
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'rgba(0,0,0,0.25)',
              }}
            >
              <div style={{ fontSize: '0.78rem', color: '#b9c3cd', lineHeight: 1.45 }}>
                After you paint the shape, optional match rules (same idea as combined-pattern painted clauses):
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', color: '#e8ecf1', fontSize: '0.88rem' }}>
                <input
                  type="checkbox"
                  checked={matchAllowRotation}
                  onChange={(e) => setMatchAllowRotation(e.target.checked)}
                />
                Allow rotations (90° / 180° / 270°)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', color: '#e8ecf1', fontSize: '0.88rem' }}>
                <input
                  type="checkbox"
                  checked={matchAllowMirror}
                  onChange={(e) => setMatchAllowMirror(e.target.checked)}
                />
                Allow mirrors (horizontal / vertical)
              </label>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '4px',
                maxWidth: '300px',
                margin: '0 auto',
              }}
            >
              {Array.from({ length: 25 }, (_, index) => {
                const row = Math.floor(index / 5);
                const col = index % 5;
                const position = `${row}-${col}`;
                const isSelected = selectedPositions.includes(position);

                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => togglePosition(row, col)}
                    style={{
                      width: '50px',
                      height: '50px',
                      border: '2px solid rgba(255, 255, 255, 0.3)',
                      borderRadius: '8px',
                      background: isSelected ? '#00ff88' : 'rgba(255, 255, 255, 0.1)',
                      color: isSelected ? '#001a0d' : '#ffffff',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                      }
                    }}
                  >
                    {isSelected ? '✓' : ''}
                  </button>
                );
              })}
            </div>

            <div style={{ textAlign: 'center', marginTop: '12px', color: '#b3b3b3', fontSize: '0.9rem' }}>
              {selectedPositions.length} squares selected
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '12px 24px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#ffffff',
                cursor: 'pointer',
                fontSize: '1rem',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isValid}
              style={{
                padding: '12px 24px',
                borderRadius: '8px',
                border: 'none',
                background: isValid ? '#00ff88' : 'rgba(255, 255, 255, 0.2)',
                color: isValid ? '#001a0d' : '#666666',
                cursor: isValid ? 'pointer' : 'not-allowed',
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: '500',
              }}
            >
              <Save size={16} />
              {initialPattern ? 'Update Pattern' : 'Save Pattern'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default CustomPatternModal;
